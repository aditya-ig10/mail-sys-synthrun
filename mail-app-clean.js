import { firebaseConfig, AUTH_BASE } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const SEND_ENDPOINT = getSendEndpoint();
const LOGIN_URL = AUTH_BASE ? '/' + AUTH_BASE + '/login' : '/login/';
const ALLOWED_DOMAIN = 'synthrun.site';
const BOUNCE_ADDRESS_PATTERN = /^bounces-[^@]+@gw\.d\.sender-sib\.com$/i;
const FOLDER_LABELS = { inbox: 'Inbox', unread: 'Unread', sent: 'Sent', outbox: 'Outbox', archived: 'Archived', flagged: 'Flagged', important: 'Important', drafts: 'Drafts', trash: 'Trash', clients: 'Clients', spam: 'Spam' };
const ROUTE_FOLDER_ALIASES = { all: 'inbox', inbox: 'inbox', unread: 'unread', sent: 'sent', outbox: 'outbox', archive: 'archived', archived: 'archived', flagged: 'flagged', important: 'important', drafts: 'drafts', draft: 'drafts', trash: 'trash', clients: 'clients', spam: 'spam' };
const ROUTE_FOLDER_SEGMENTS = { inbox: 'all', unread: 'unread', sent: 'sent', outbox: 'outbox', archived: 'archive', flagged: 'flagged', important: 'important', drafts: 'drafts', trash: 'trash', clients: 'clients', spam: 'spam' };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const loadingOverlay = document.getElementById('appLoadingOverlay');
const initialRouteState = getRouteStateFromLocation();
window.SYNTHRUN_UPDATE_LOADING?.(1);

let currentUser = null;
let allMessages = [];
let messageMap = new Map();
let currentFolder = initialRouteState.folder;
let activeMessageId = null;
let selectedIds = new Set();
let userLabels = [];
let draftAttachments = [];
let uiBound = false;
let composeBusy = false;
let draftDocId = null;
let draftSaveTimer = null;

function updateSelectedCount() {
  const el = document.getElementById('selectedCount');
  const bulk = document.getElementById('bulkActions');
  const emptyTrashBtn = document.getElementById('emptyTrashBtn');
  if (selectedIds.size) {
    el.textContent = `${selectedIds.size} selected`;
    el.style.display = '';
    if (bulk) bulk.style.display = 'flex';
    if (emptyTrashBtn) emptyTrashBtn.style.display = 'none';
    // Trash multi-select: only Restore / Delete forever make sense here.
    // (bulkMoreLabels keeps its own inline visibility — excluded on purpose.)
    const inTrash = currentFolder === 'trash';
    document.querySelectorAll('#bulkMoreDropdown .bulk-more-item.bulk-normal, #bulkMoreDropdown .bulk-more-sep.bulk-normal').forEach((item) => { item.style.display = inTrash ? 'none' : ''; });
    document.querySelectorAll('#bulkMoreDropdown .bulk-trash-only').forEach((item) => { item.style.display = inTrash ? '' : 'none'; });
  } else {
    el.style.display = 'none';
    if (bulk) bulk.style.display = 'none';
    if (emptyTrashBtn) emptyTrashBtn.style.display = currentFolder === 'trash' ? '' : 'none';
  }
}

function toggleSelected(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  const item = document.querySelector(`.thread-item[data-id="${id}"]`);
  if (item) {
    item.classList.toggle('selected');
    const cb = item.querySelector('.thread-avatar-checkbox');
    if (cb) cb.classList.toggle('checked');
  }
  updateSelectedCount();
}
// Debug impersonation is a local-dev-only escape hatch. It is NEVER honored
// on hosted builds — an attacker able to write localStorage for our origin
// must already own the browser, but documenting a prod backdoor is still a
// takeover path on any preview deploy (Fix E2 / Phase 0).
const IS_LOCAL_DEV = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const DEBUG_USER = IS_LOCAL_DEV ? (globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user') || '') : '';
const SETTINGS_CACHE_KEY = 'synthrun-settings';

function loadCachedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCachedSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch { /* quota exceeded — ignore */ }
}

function applySettings(s) {
  // Defaults: synthrun layout + compact density unless explicitly changed.
  const v = s || {};
  document.body.classList.toggle('layout-gmail', (v.layout || 'synthrun') === 'gmail');
  document.body.classList.toggle('density-compact', (v.density || 'compact') === 'compact');
}

async function fetchSettingsFromFirebase(uid) {
  try {
    const snap = await getDoc(doc(db, 'user_settings', uid));
    if (snap.exists()) {
      const s = snap.data();
      saveCachedSettings(s);
      applySettings(s);
      applySendingIdentity(s);
    }
  } catch { /* ignore */ }
}

function applySendingIdentity(s) {
  if (!s) return;
  window.SYNTHRUN_SENDING_IDENTITY = {
    displayName: String(s.displayName || '').slice(0, 80),
    signature: s.signature && typeof s.signature === 'object'
      ? { enabled: Boolean(s.signature.enabled), text: String(s.signature.text || '').slice(0, 1000) }
      : { enabled: false, text: '' },
  };
  refreshFromLabel();
}

function refreshFromLabel() {
  if (!currentUser) return;
  const identity = window.SYNTHRUN_SENDING_IDENTITY;
  const label = identity?.displayName
    ? `${identity.displayName} <${currentUser.email}>`
    : `from: ${currentUser.email}`;
  const el = document.getElementById('compFromLabel');
  if (el) el.textContent = label;
}

async function loadUserLabels() {
  if (!currentUser) return;
  try {
    const snap = await getDocs(collection(db, 'user_settings', currentUser.uid, 'labels'));
    userLabels = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSidebarLabels();
  } catch { userLabels = []; }
}

function renderSidebarLabels() {
  const container = document.getElementById('sidebarCustomLabels');
  if (!container) return;
  const visible = userLabels.filter(l => l.hidden !== true);
  if (!visible.length) { container.innerHTML = ''; return; }
  container.innerHTML = visible.map(l =>
    `<button class="side-link" data-folder="label:${l.name}" type="button" ${l.description ? 'title="' + escapeHtml(l.description) + '"' : ''}>
      <span class="side-link-left"><span class="label-swatch" style="background:${l.color || '#888'};display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;"></span>${escapeHtml(l.name)}</span>
    </button>`
  ).join('');
  container.querySelectorAll('.side-link[data-folder]').forEach((link) => {
    link.addEventListener('click', () => {
      showFolderView({ folder: link.dataset.folder });
    });
  });
}

async function assignLabel(messageId, labelName, silent) {
  if (!currentUser) return;
  try {
    const ref = doc(db, 'mail', messageId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const labels = snap.data().labels || [];
    const idx = labels.indexOf(labelName);
    if (idx > -1) labels.splice(idx, 1);
    else labels.push(labelName);
    await updateDoc(ref, { labels });
    const msg = messageMap.get(messageId);
    if (msg) msg.labels = labels;
    if (!silent) renderList();
  } catch { showToast('Failed to update label.', true); }
}

function getMessageLabels(messageId) {
  const msg = messageMap.get(messageId);
  return (msg && Array.isArray(msg.labels)) ? msg.labels : [];
}

function getRouteStateFromLocation() {
  const segments = window.location.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  const firstSegment = String(segments[0] || '').toLowerCase();

  if (!segments.length || firstSegment === 'index.html' || firstSegment === 'index') {
    // Warm start: reopen the last folder from cookie instead of inbox.
    return { folder: getLastFolderCookie() || 'inbox', messageId: null };
  }

  const routeFolder = ROUTE_FOLDER_ALIASES[firstSegment];
  if (routeFolder) {
    return { folder: routeFolder, messageId: segments[1] || null };
  }

  return { folder: 'inbox', messageId: segments[0] || null };
}

function buildRoutePath(folder = currentFolder, messageId = activeMessageId) {
  const baseSegment = ROUTE_FOLDER_SEGMENTS[folder] || 'all';
  return messageId ? `/${baseSegment}/${encodeURIComponent(messageId)}` : `/${baseSegment}`;
}

function syncRouteToLocation({ folder = currentFolder, messageId = activeMessageId, replace = false } = {}) {
  const nextPath = buildRoutePath(folder, messageId);
  try {
    document.cookie = `synthrun-last-folder=${encodeURIComponent(folder)};path=/;max-age=${30 * 86400};SameSite=Lax`;
  } catch { /* cookies blocked — route still works */ }
  if (window.location.pathname === nextPath) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ folder, messageId: messageId || null }, '', nextPath);
}

function getLastFolderCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)synthrun-last-folder=([^;]*)/);
    const v = m ? decodeURIComponent(m[1]).slice(0, 80) : '';
    if (!v) return '';
    if (FOLDER_LABELS[v]) return v;
    if (v.startsWith('label:') && v.length > 6) return v;
    return '';
  } catch { return ''; }
}

function updateFolderSelection(folder) {
  currentFolder = folder;
  document.getElementById('folderLabel').textContent = folder.startsWith('label:') ? folder.slice(6) : (FOLDER_LABELS[folder] || folder);
  const retentionNotice = document.getElementById('retentionNotice');
  if (retentionNotice) {
    retentionNotice.textContent = (folder === 'trash' || folder === 'spam') ? '· auto-deletes after 30 days' : '';
  }
  document.querySelectorAll('.side-link').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll(`[data-folder="${folder}"]`).forEach((item) => item.classList.add('active'));
  const emptyTrashBtn = document.getElementById('emptyTrashBtn');
  if (emptyTrashBtn) emptyTrashBtn.style.display = folder === 'trash' ? '' : 'none';
}

function showFolderView({ folder = currentFolder, replaceRoute = false } = {}) {
  selectedIds.clear();
  updateFolderSelection(folder);
  activeMessageId = null;
  document.getElementById('emptyView').style.display = 'flex';
  document.getElementById('messageView').style.display = 'none';
  setMessageOpenState(false);
  syncRouteToLocation({ folder, messageId: null, replace: replaceRoute });
  // Paint immediately (fetching placeholder if the folder is cold), then
  // paint emails exactly once when the page arrives.
  renderList();
  ensureFolderLoaded(folder).then(() => {
    if (currentFolder === folder && !activeMessageId) renderList();
  });
}

async function restoreRouteState() {
  const { folder, messageId } = getRouteStateFromLocation();
  updateFolderSelection(folder);
  activeMessageId = null;

  document.getElementById('emptyView').style.display = 'flex';
  document.getElementById('messageView').style.display = 'none';
  setMessageOpenState(false);

  await ensureFolderLoaded(folder);

  if (messageId) {
    // Peek first: draft links reopen in the composer, everything else in
    // the reader — so a reload on any email link lands on the same email.
    let target = messageMap.get(messageId);
    if (!target) {
      try {
        const snap = await getDoc(doc(db, 'mail', messageId));
        if (snap.exists()) {
          target = { id: snap.id, ...snap.data() };
          messageMap.set(target.id, target);
          allMessages.unshift(target);
        }
      } catch { target = null; }
    }
    if (target && target.folder === 'draft') {
      updateFolderSelection('drafts');
      syncRouteToLocation({ folder: 'drafts', messageId: null, replace: true });
      await openCompose({ draftId: target.id });
    } else {
      await openMessage(messageId, { replaceRoute: true });
    }
  }

  syncRouteToLocation({ folder, messageId: messageId || null, replace: true });
  renderList();
}

window.addEventListener('popstate', () => {
  if (!uiBound) return;
  restoreRouteState();
});

if (DEBUG_USER) {
  bootDebugUser(DEBUG_USER);
}

onAuthStateChanged(auth, async (user) => {
  if (DEBUG_USER) return;
  if (!user || !user.email || !user.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    window.location.replace(LOGIN_URL);
    return;
  }

  currentUser = user;
  window.SYNTHRUN_PROFILE_DATA = {
    email: user.email,
    name: formatSenderName(user.email),
    slug: user.uid,
    initials: user.email.split('@')[0].slice(0, 2).toUpperCase(),
  };
  window.__signOut = async () => { await signOut(auth); window.location.href = LOGIN_URL; };
  document.getElementById('userAvatar').textContent = user.email.split('@')[0].slice(0, 2).toUpperCase();
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('statusUser').textContent = user.email;
  document.getElementById('compFromLabel').textContent = `from: ${user.email}`;

  if (!uiBound) {
    bindUi();
    uiBound = true;
  }

  window._getIdToken = async () => (currentUser ? await currentUser.getIdToken() : null);

  // Apply user settings (layout, density) — cache in localStorage for instant load
  const cached = loadCachedSettings();
  applySettings(cached);
  applySendingIdentity(cached);

  window.SYNTHRUN_UPDATE_LOADING?.(2);
  // First load fans out in parallel: mail pages + counts, fresh profile
  // settings (identity/appearance), and label definitions — so the reader,
  // badges and label colors are all ready before first paint.
  await Promise.all([
    loadMessages(),
    fetchSettingsFromFirebase(user.uid).catch(() => {}),
    loadUserLabels().catch(() => {}),
  ]);
  await restoreRouteState();
  window.SYNTHRUN_UPDATE_LOADING?.(5);
  setAppLoading(false);
  applyAutoLabels().catch(() => {});
});

function bootDebugUser(email) {
  currentUser = {
    email,
    uid: 'debug-user',
    async getIdToken() {
      return null;
    },
  };

  window.SYNTHRUN_PROFILE_DATA = {
    email,
    name: formatSenderName(email),
    slug: 'debug-user',
    initials: email.split('@')[0].slice(0, 2).toUpperCase(),
  };

  window.SYNTHRUN_UPDATE_LOADING?.(2);

  const initials = email.split('@')[0].slice(0, 2).toUpperCase();
  const initializeDebugUi = () => {
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('userEmail').textContent = email;
    document.getElementById('statusUser').textContent = email;
    document.getElementById('compFromLabel').textContent = `from: ${email}`;

    if (!uiBound) {
      bindUi();
      uiBound = true;
    }

    window._getIdToken = async () => null;
    allMessages = [];
    window.SYNTHRUN_UPDATE_LOADING?.(3);
    window.SYNTHRUN_UPDATE_LOADING?.(4);
    updateFolderSelection(currentFolder);
    renderList();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDebugUi, { once: true });
  } else {
    initializeDebugUi();
  }
  setAppLoading(false);
}

function bindUi() {
  document.getElementById('composeBtn').addEventListener('click', () => openCompose());
  document.getElementById('closeCompose').addEventListener('click', closeCompose);
  document.getElementById('discardBtn').addEventListener('click', () => closeCompose({ discard: true }));
  document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('attachmentInput').click());
  document.getElementById('attachmentInput').addEventListener('change', onAttachmentsSelected);
  document.getElementById('composeOverlay').addEventListener('click', (event) => {
    if (event.target === document.getElementById('composeOverlay')) closeCompose();
  });

  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 200);
  });
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    showToast('Refreshing...');
    await loadMessages();
    showToast('Up to date.');
  });

  window.SYNTHRUN_REFRESH_INBOX = async () => {
    showFolderView({ folder: 'inbox', replaceRoute: true });
    await loadMessages();
  };

  document.getElementById('restoreBtn').addEventListener('click', () => {
    if (activeMessageId) restoreMessage(activeMessageId);
  });
  document.getElementById('deleteForeverBtn').addEventListener('click', () => {
    if (activeMessageId) deleteForever(activeMessageId);
  });
  document.getElementById('retryBtn').addEventListener('click', () => {
    if (activeMessageId) retryOutboxMessage(activeMessageId);
  });
  document.getElementById('printBtn').addEventListener('click', () => {
    if (activeMessageId) window.print();
  });

  // User-chip, nav, sign-out handled by spa-nav.js via data-spa-link + window.__signOut

  document.querySelectorAll('.side-link[data-folder]').forEach((link) => {
    link.addEventListener('click', () => {
      // Single render: showFolderView fetches (if needed) then renders once.
      showFolderView({ folder: link.dataset.folder });
    });
  });

  ['compTo', 'compCc', 'compBcc', 'compSubject', 'compHtmlBody'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', scheduleDraftSave);
  });

  tick();
  setInterval(tick, 1000);
  document.addEventListener('keydown', handleGlobalShortcuts);

  function bulkAction(fn) {
    return () => Promise.all([...selectedIds].map(fn)).then(() => {
      selectedIds.clear();
      renderList();
      refreshCounts();
    });
  }

  document.getElementById('bulkTrashBtn').addEventListener('click', bulkAction((id) => {
    const msg = messageMap.get(id);
    const prev = msg?.folder || currentFolder;
    const updates = { folder: 'trash', previousFolder: prev, trashedAt: serverTimestamp() };
    return updateDoc(doc(db, 'mail', id), updates).then(() => {
      if (msg) { msg.folder = 'trash'; msg.previousFolder = prev; }
    });
  }));
  document.getElementById('bulkArchiveBtn').addEventListener('click', bulkAction((id) => {
    const msg = messageMap.get(id);
    const prev = msg?.folder || currentFolder;
    return updateDoc(doc(db, 'mail', id), { folder: 'archived', previousFolder: prev }).then(() => {
      if (msg) { msg.folder = 'archived'; msg.previousFolder = prev; }
    });
  }));
  document.getElementById('bulkFlagBtn').addEventListener('click', bulkAction((id) => {
    const msg = messageMap.get(id);
    const next = !msg?.flagged;
    if (msg) msg.flagged = next;
    return updateDoc(doc(db, 'mail', id), { flagged: next });
  }));
  document.getElementById('bulkReadBtn').addEventListener('click', bulkAction((id) => {
    const msg = messageMap.get(id);
    if (msg) msg.unread = false;
    return updateDoc(doc(db, 'mail', id), { unread: false });
  }));
  document.getElementById('bulkUnreadBtn').addEventListener('click', bulkAction((id) => {
    const msg = messageMap.get(id);
    if (msg) msg.unread = true;
    return updateDoc(doc(db, 'mail', id), { unread: true });
  }));

  // Trash-only bulk actions (shown instead of the normal set in Trash).
  document.getElementById('bulkRestoreBtn').addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => {
        const msg = messageMap.get(id);
        const target = restoreTargetFolder(msg?.previousFolder);
        const updates = { folder: target, previousFolder: null, trashedAt: null, spamAt: null };
        return updateDoc(doc(db, 'mail', id), updates).then(() => {
          if (msg) msg.folder = target;
        });
      }));
      selectedIds.clear();
      renderList();
      refreshCounts();
      showToast(`Restored ${ids.length} message${ids.length === 1 ? '' : 's'}.`);
    } catch {
      showToast('Could not restore selection.', true);
    }
  });
  document.getElementById('bulkDeleteForeverBtn').addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!confirm(`Permanently delete ${ids.length} message${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
      await Promise.all(ids.map((id) => deleteDoc(doc(db, 'mail', id))));
      allMessages = allMessages.filter((m) => !selectedIds.has(m.id));
      ids.forEach((id) => messageMap.delete(id));
      selectedIds.clear();
      renderList();
      refreshCounts();
      showToast('Permanently deleted.');
    } catch {
      showToast('Could not delete selection.', true);
    }
  });

  // Label dropdown
  document.getElementById('labelBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('labelDropdown').classList.toggle('open');
  });
  document.addEventListener('click', () => document.getElementById('labelDropdown').classList.remove('open'));
  document.getElementById('labelDropdown').addEventListener('click', (e) => e.stopPropagation());

  // Empty trash
  const emptyTrashBtn = document.getElementById('emptyTrashBtn');
  if (emptyTrashBtn) {
    emptyTrashBtn.addEventListener('click', async () => {
      const trashIds = allMessages.filter(m => m.folder === 'trash').map(m => m.id);
      if (!trashIds.length) return;
      if (!confirm(`Permanently delete ${trashIds.length} message${trashIds.length === 1 ? '' : 's'} from trash?`)) return;
      try {
        await Promise.all(trashIds.map(id => deleteDoc(doc(db, 'mail', id))));
        allMessages = allMessages.filter(m => m.folder !== 'trash');
        trashIds.forEach(id => messageMap.delete(id));
        selectedIds.clear();
        renderList();
        refreshCounts();
        showToast('Trash emptied.');
      } catch (e) {
        console.error('emptyTrash:', e);
        showToast('Could not empty trash.', true);
      }
    });
  }

  // Bulk more dropdown — open/close
  document.getElementById('bulkMoreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('bulkMoreDropdown').classList.toggle('open');
    document.getElementById('bulkMoreLabels').style.display = 'none';
  });
  document.addEventListener('click', () => {
    document.getElementById('bulkMoreDropdown').classList.remove('open');
  });
  document.getElementById('bulkMoreDropdown').addEventListener('click', (e) => e.stopPropagation());

  // Bulk label — expand labels inline in dropdown
  document.getElementById('bulkLabelBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const labelsEl = document.getElementById('bulkMoreLabels');
    const hidden = labelsEl.style.display === 'none';
    labelsEl.style.display = hidden ? '' : 'none';
    if (hidden) {
      if (!userLabels.length) {
        labelsEl.innerHTML = '<div class="bulk-more-item" style="cursor:default;color:var(--subtle);font-size:0.7rem">No labels</div>';
      } else {
        labelsEl.innerHTML = userLabels.map(l =>
          `<button class="bulk-more-item" data-bulk-label="${escapeHtml(l.name)}" type="button">
            <span class="label-dot" style="background:${l.color || '#888'};width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0;"></span>
            <span>${escapeHtml(l.name)}</span>
          </button>`
        ).join('');
        labelsEl.querySelectorAll('[data-bulk-label]').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('bulkMoreDropdown').classList.remove('open');
            const labelName = el.dataset.bulkLabel;
            Promise.all([...selectedIds].map(id => assignLabel(id, labelName, true))).then(() => {
              selectedIds.clear();
              renderList();
              showToast(`Label "${labelName}" applied.`);
            });
          });
        });
      }
    }
  });
}

// ─── AUTO-LABEL ENGINE ──────────────────────────────────

async function applyAutoLabels() {
  if (!currentUser || !allMessages.length) return;
  try {
    const snap = await getDocs(collection(db, 'user_settings', currentUser.uid, 'autoLabelRules'));
    const rules = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.enabled !== false && r.value);
    if (!rules.length) return;
    const updates = [];
    for (const msg of allMessages) {
      const existing = Array.isArray(msg.labels) ? msg.labels : [];
      const senderEmail = (msg.senderEmail || msg.from || '').toLowerCase();
      const body = (msg.body || '').toLowerCase();
      const subject = (msg.subject || '').toLowerCase();
      const recipient = (msg.recipientEmail || msg.to || '').toLowerCase();
      const cc = (msg.cc || []).map(a => (a.email || a).toLowerCase()).join(' ');
      const domain = senderEmail.split('@')[1] || '';
      const allRecipients = recipient + ' ' + cc;
      for (const rule of rules) {
        if (existing.includes(rule.labelName)) continue;
        const val = rule.value.toLowerCase();
        const exact = rule.matchMode === 'exact';
        let match = false;
        if (rule.type === 'domain') {
          match = exact ? domain === val : domain.includes(val);
        } else if (rule.type === 'keyword') {
          match = exact ? body === val || subject === val : body.includes(val) || subject.includes(val);
        } else if (rule.type === 'sender') {
          match = exact ? senderEmail === val : senderEmail.includes(val);
        } else if (rule.type === 'subject') {
          match = exact ? subject === val : subject.includes(val);
        } else if (rule.type === 'recipient') {
          match = exact ? allRecipients === val : allRecipients.includes(val);
        }
        if (match) {
          existing.push(rule.labelName);
          updates.push(updateDoc(doc(db, 'mail', msg.id), { labels: existing.slice() }).catch(() => {}));
          msg.labels = existing.slice();
        }
      }
    }
    if (updates.length) await Promise.all(updates);
    if (updates.length) renderList();
  } catch { /* ignore */ }
}

// ─── PAGINATED LOADING (Phase 1/A5) ─────────────────────────────
// The mailbox no longer pulls the whole collection. Each folder keeps its
// own cursor; the thread list renders the loaded window and offers
// "Load older messages". Badge counts come from cheap count() aggregations.
// NOTE: first run needs composite indexes on
// mail(recipientEmail, receivedAt desc) and
// mail(recipientEmail, folder, receivedAt desc) — Firestore logs the link.
const PAGE_SIZE = 50;
let folderCursors = {};
let folderExhausted = {};
let folderCounts = { inboxTotal: 0, inboxUnread: 0, sent: 0, outbox: 0, spam: 0, archived: 0, trash: 0, draft: 0, important: 0 };
let loadingMore = false;

// Folders with a concrete `folder` value page exactly server-side.
// Pseudo-folders (inbox view, unread, flagged, important, clients, labels)
// page over recency and filter client-side.
function folderQueryKey(folder) {
  if (folder === 'sent') return 'sent';
  if (folder === 'outbox') return 'outbox';
  if (folder === 'archived') return 'archived';
  if (folder === 'trash') return 'trash';
  if (folder === 'spam') return 'spam';
  if (folder === 'drafts') return 'draft';
  return 'all';
}

// Firestore reports a failed-precondition with an index-creation link when
// a composite index is missing. Folder queries degrade to client filtering
// in that case instead of rendering an empty folder.
function isMissingIndexError(error) {
  if (!error) return false;
  if (String(error.code || '') === 'failed-precondition') return true;
  return /index/i.test(String(error.message || ''));
}

function mergeMessages(docs) {  let added = 0;
  for (const entry of docs) {
    if (!messageMap.has(entry.id)) {
      const m = { id: entry.id, ...entry.data() };
      messageMap.set(m.id, m);
      allMessages.push(m);
      added += 1;
    }
  }
  if (added) {
    allMessages.sort((left, right) => toMillis(right.receivedAt) - toMillis(left.receivedAt));
  }
  return added;
}

function indexMessagesForContacts(msgs) {
  const contacts = [];
  for (const m of msgs) {
    if (m.from && !contacts.some(c => c.email === m.from.toLowerCase())) {
      contacts.push({ email: m.from.toLowerCase(), name: m.fromName || '' });
    }
    if (m.senderEmail && !contacts.some(c => c.email === m.senderEmail.toLowerCase())) {
      contacts.push({ email: m.senderEmail.toLowerCase(), name: m.fromName || '' });
    }
    if (m.to) {
      for (const addr of m.to.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (!contacts.some(c => c.email === addr)) {
          contacts.push({ email: addr, name: '' });
        }
      }
    }
  }
  window.SYNTHRUN_ADD_CONTACTS?.(contacts);
}

async function loadFolderPage(folder, { render = true } = {}) {
  if (!currentUser || loadingMore) return 0;
  const key = folderQueryKey(folder);
  if (folderExhausted[key]) return 0;
  loadingMore = true;
  try {
    const base = collection(db, 'mail');
    const runPage = (withFolderFilter) => {
      const constraints = [where('recipientEmail', '==', currentUser.email)];
      if (withFolderFilter) constraints.push(where('folder', '==', key));
      constraints.push(orderBy('receivedAt', 'desc'));
      if (folderCursors[key]) constraints.push(startAfter(folderCursors[key]));
      constraints.push(limit(PAGE_SIZE));
      return getDocs(query(base, ...constraints));
    };
    let snap;
    let exact = key === 'all';
    try {
      // Exact server-side paging needs composite index
      // mail(recipientEmail, folder, receivedAt desc).
      snap = await runPage(key !== 'all');
    } catch (error) {
      if (key !== 'all' && isMissingIndexError(error)) {
        // Index not built yet: over-fetch recency on the base index and
        // filter locally instead of showing an empty folder.
        console.warn(`loadFolderPage: no composite index for "${key}", using client filter`);
        snap = await runPage(false);
        exact = false;
      } else {
        throw error;
      }
    }
    if (!snap.empty) {
      folderCursors[key] = snap.docs[snap.docs.length - 1];
    }
    let docs = snap.docs;
    if (!exact) {
      docs = docs.filter((d) => d.data().folder === key);
      if (snap.docs.length === 0) folderExhausted[key] = true;
    } else if (snap.docs.length < PAGE_SIZE) {
      folderExhausted[key] = true;
    }
    const added = mergeMessages(docs);
    indexMessagesForContacts(docs.map((d) => ({ id: d.id, ...d.data() })));
    if (render) renderList();
    return added;
  } catch (error) {
    console.error('loadFolderPage:', error);
    if (isMissingIndexError(error)) {
      showToast('Search index building — retry in a minute.', true);
    } else {
      showToast('Could not load messages — check Firestore rules.', true);
    }
    return 0;
  } finally {
    loadingMore = false;
  }
}

async function ensureFolderLoaded(folder) {
  const key = folderQueryKey(folder);
  if (!(key in folderCursors) && !folderExhausted[key]) {
    await loadFolderPage(folder, { render: false });
  }
}

let countsIndexWarned = false;

async function refreshCounts() {
  if (!currentUser) return;
  const base = collection(db, 'mail');
  const mine = where('recipientEmail', '==', currentUser.email);
  // NOTE: firebase 10.12.2 exposes getCountFromServer (not getCountFromFirestore).
  // Each count degrades independently: multi-filter counts need composite
  // indexes, so a missing one must not zero out the badges that did load.
  const countQ = (extra = []) => getCountFromServer(query(base, mine, ...extra)).then((s) => s.data().count).catch(() => null);
  try {
    const [total, unreadAll, unreadSpam, unreadTrash, sent, outbox, spam, archived, trash, draft, important] = await Promise.all([
      countQ(),
      countQ([where('unread', '==', true)]),
      countQ([where('folder', '==', 'spam'), where('unread', '==', true)]),
      countQ([where('folder', '==', 'trash'), where('unread', '==', true)]),
      countQ([where('folder', '==', 'sent')]),
      countQ([where('folder', '==', 'outbox')]),
      countQ([where('folder', '==', 'spam')]),
      countQ([where('folder', '==', 'archived')]),
      countQ([where('folder', '==', 'trash')]),
      countQ([where('folder', '==', 'draft')]),
      countQ([where('important', '==', true)]),
    ]);
    const keep = (v, fallback) => (v == null ? fallback : v);
    folderCounts.sent = keep(sent, folderCounts.sent);
    folderCounts.outbox = keep(outbox, folderCounts.outbox);
    folderCounts.spam = keep(spam, folderCounts.spam);
    folderCounts.archived = keep(archived, folderCounts.archived);
    folderCounts.trash = keep(trash, folderCounts.trash);
    folderCounts.draft = keep(draft, folderCounts.draft);
    folderCounts.important = keep(important, folderCounts.important);
    if (total != null) {
      folderCounts.inboxTotal = Math.max(0, total - folderCounts.sent - folderCounts.outbox - folderCounts.spam - folderCounts.archived - folderCounts.trash - folderCounts.draft);
    }
    if (unreadAll != null && unreadSpam != null && unreadTrash != null) {
      folderCounts.inboxUnread = Math.max(0, unreadAll - unreadSpam - unreadTrash);
    }
    if (total == null && !countsIndexWarned) {
      countsIndexWarned = true;
      showToast('Mailbox counts unavailable — search index building.', true);
    }
    updateBadges();
  } catch (error) {
    console.warn('refreshCounts:', error);
  }
}

function updateBadges() {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };
  set('badge-inbox', folderCounts.inboxTotal || 0);
  set('badge-unread', folderCounts.inboxUnread || 0);
  set('badge-archived', folderCounts.archived || 0);
  set('badge-sent', folderCounts.sent || '—');
  set('badge-important', folderCounts.important || 0);
  set('badge-drafts', folderCounts.draft || '—');
  set('badge-trash', folderCounts.trash || 0);
  set('badge-outbox', folderCounts.outbox || 0);
  set('badge-spam', folderCounts.spam || 0);
}

async function loadMessages() {
  if (!currentUser) return;

  try {
    window.SYNTHRUN_UPDATE_LOADING?.(3);
    allMessages = [];
    messageMap = new Map();
    folderCursors = {};
    folderExhausted = {};
    selectedIds.clear();
    await Promise.all([refreshCounts(), loadFolderPage(currentFolder, { render: false })]);
    window.SYNTHRUN_UPDATE_LOADING?.(4);
    renderList();
  } catch (error) {
    console.error('loadMessages:', error);
    showToast('Could not load messages — check Firestore rules.', true);
  }
}

async function saveSentMessage(to, cc, subject, body, attachments = [], htmlBody = '') {
  try {
    const message = {
      folder: 'sent',
      from: currentUser.email,
      fromName: formatSenderName(currentUser.email),
      senderEmail: currentUser.email,
      to,
      cc,
      subject,
      body,
      htmlBody,
      attachments,
      senderUid: currentUser.uid,
      recipientEmail: currentUser.email,
      unread: false,
      flagged: false,
      important: false,
      receivedAt: serverTimestamp(),
    };

    await addDoc(collection(db, 'mail'), message);
  } catch (error) {
    console.error('saveSentMessage:', error);
  }
}

async function saveOutboxMessage(to, cc, bcc, subject, body, htmlBody = '', idempotencyKey = '', inReplyTo = '') {
  try {
    const message = {
      folder: 'outbox',
      status: 'sending',
      idempotencyKey,
      inReplyTo,
      from: currentUser.email,
      fromName: formatSenderName(currentUser.email),
      senderEmail: currentUser.email,
      to,
      cc,
      bcc,
      subject,
      body,
      htmlBody,
      attachments: [],
      senderUid: currentUser.uid,
      recipientEmail: currentUser.email,
      unread: false,
      flagged: false,
      important: false,
      receivedAt: serverTimestamp(),
    };
    const docRef = await addDoc(collection(db, 'mail'), message);
    return docRef.id;
  } catch (error) {
    console.error('saveOutboxMessage:', error);
    return null;
  }
}

async function updateOutboxStatus(id, updates) {
  if (!id) return;
  try {
    await updateDoc(doc(db, 'mail', id), updates);
  } catch (error) {
    console.error('updateOutboxStatus:', error);
  }
}

async function retryOutboxMessage(id) {
  const message = messageMap.get(id);
  if (!message || message.folder !== 'outbox') return;
  try {
    await updateOutboxStatus(id, { status: 'sending' });
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const idempotencyKey = message.idempotencyKey || (window.crypto?.randomUUID ? window.crypto.randomUUID() : 'k' + Date.now().toString(36));
    const bodyWithLinks = `${message.body || ''}${buildAttachmentText(attachments)}`;
    const finalHtmlBody = `${message.htmlBody || ''}${buildAttachmentHtml(attachments)}`;
    const debugUser = globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user');
    const idToken = debugUser ? null : await currentUser.getIdToken();
    const response = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...(debugUser ? { 'X-Debug-User': debugUser } : {}),
      },
      body: JSON.stringify({
        to: message.to,
        cc: message.cc || '',
        bcc: message.bcc || '',
        subject: message.subject,
        body: bodyWithLinks,
        htmlBody: finalHtmlBody,
        attachments,
        idempotencyKey,
        inReplyTo: message.inReplyTo || '',
        fromName: window.SYNTHRUN_SENDING_IDENTITY?.displayName || undefined,
        from: currentUser.email,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Worker returned ${response.status}`);
    }
    await updateOutboxStatus(id, { folder: 'sent', status: 'sent' });
    const retried = messageMap.get(id);
    if (retried) retried.folder = 'sent';
    renderList();
    refreshCounts();
    showToast('Message sent.');
  } catch (error) {
    console.error('retryOutboxMessage:', error);
    await updateOutboxStatus(id, { status: 'failed' });
    const failed = messageMap.get(id);
    if (failed) failed.status = 'failed';
    renderList();
    showToast(`Send failed: ${error.message}`, true);
  }
}
window.SYNTHRUN_RETRY_OUTBOX = retryOutboxMessage;

function formatSenderName(senderEmail) {
  const localPart = String(senderEmail || '')
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim();

  if (!localPart) {
    return 'Synthrun';
  }

  return localPart
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function sanitizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Recipient reads must never depend on a single DOM node: union the hidden
// field, the rendered chips, and any still-typing text, then tokenize once.
// A stale hidden input can no longer blank the recipients on send.
function readRecipientBox(boxId) {
  const box = document.getElementById(boxId);
  if (!box) return '';
  const hidden = box.querySelector('input[type="hidden"]');
  const rendered = [...box.querySelectorAll('.chip')].map((c) => (c.firstChild ? c.firstChild.textContent : '') || '');
  const typing = box.querySelector('.chip-input')?.value || '';
  const combined = [...(hidden ? [hidden.value] : []), ...rendered, typing].join(',');
  if (window.SYNTHRUN_SPLIT_EMAILS) {
    try {
      return window.SYNTHRUN_SPLIT_EMAILS(combined, []).valid.join(', ');
    } catch { /* fall through */ }
  }
  return (hidden ? hidden.value : '').trim();
}

function isBounceAddress(value) {
  return BOUNCE_ADDRESS_PATTERN.test(sanitizeEmail(value));
}

function isGenericSenderName(value) {
  const name = String(value || '').trim().toLowerCase();
  return !name || name === 'synthrun mail' || name === 'synthrun';
}

function isSystemGeneratedEmail(email) {
  const atIdx = email.indexOf('@');
  if (atIdx < 0) return false;
  const local = email.slice(0, atIdx);
  if (local.length > 20) return true;
  return /^[a-f0-9]{8,}(-[a-f0-9]{4,}){2,}/i.test(local);
}

function formatSenderEmail(email) {
  const atIdx = email.indexOf('@');
  if (atIdx < 0) return email;
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (isSystemGeneratedEmail(email)) {
    return domain;
  }
  return email;
}

function getSenderIdentity(message) {
  const senderEmail = sanitizeEmail(message.senderEmail || message.fromEmail || message.from);
  const senderName = String(message.fromName || message.senderName || '').trim();
  const safeEmail = senderEmail && !isBounceAddress(senderEmail) ? senderEmail : '';
  const safeFrom = sanitizeEmail(message.from);
  const fallbackEmail = safeFrom && !isBounceAddress(safeFrom) ? safeFrom : '';

  return {
    email: safeEmail || fallbackEmail || '',
    name: senderName,
  };
}

function getSenderLabel(message) {
  const sender = getSenderIdentity(message);
  const name = sender.name && !isGenericSenderName(sender.name) ? sender.name : '';

  if (name) return name;

  const email = sender.email || sanitizeEmail(message.from) || '';
  if (email && !isBounceAddress(email)) return formatSenderEmail(email);

  const fallback = sanitizeEmail(message.from);
  if (isBounceAddress(fallback)) return 'Synthrun Mail';

  const formatted = formatSenderEmail(fallback);
  return formatted || 'Unknown';
}

// Per-folder empty states (Phase 5/J1): every dead end gets an explanation
// and one primary action instead of a bare "No messages".
function folderEmptyState(folder, hasQuery) {
  const wrap = (title, sub, action) => `
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M3 8l7.9 5.3a2 2 0 0 0 2.2 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"/></svg>
        <p><strong>${title}</strong></p>
        <p>${sub}</p>
        ${action || ''}
      </div>`;
  const composeBtn = '<p><button type="button" class="reply-btn primary" data-empty-action="compose">Compose</button></p>';
  if (hasQuery) {
    return wrap('No results', 'Try different keywords or load older messages.', '<p><button type="button" class="reply-btn" data-empty-action="clear-search">Clear search</button></p>');
  }
  if (folder === 'inbox') return wrap('Inbox zero', "You're all caught up.", composeBtn);
  if (folder === 'unread') return wrap('All caught up', 'No unread messages.', '');
  if (folder === 'sent') return wrap('No sent mail yet', 'Mail you send lands here.', composeBtn);
  if (folder === 'drafts') return wrap('No drafts', 'Unsent ideas live here.', composeBtn);
  if (folder === 'outbox') return wrap('Outbox clear', 'Queued and failed sends appear here.', '');
  if (folder === 'trash') return wrap('Trash is empty', 'Deleted mail is removed after 30 days.', '');
  if (folder === 'spam') return wrap('No spam', 'Suspicious mail lands here for 30 days.', '');
  if (folder === 'archived') return wrap('Nothing archived', 'Archived mail skips the inbox without being deleted.', '');
  if (folder === 'flagged') return wrap('Nothing flagged', 'Flag messages to triage them here.', '');
  if (folder === 'important') return wrap('Nothing important', 'Mark messages important to find them fast.', '');
  if (folder === 'clients') return wrap('No client mail', 'Messages labelled "clients" appear here.', '');
  if (folder.startsWith('label:')) return wrap(escapeHtml(folder.slice(6)), 'No messages carry this label yet.', '');
  return wrap('Nothing here', 'Messages will appear in this view.', '');
}

function renderList() {
  const container = document.getElementById('threadItems');
  const queryText = document.getElementById('searchInput').value.trim().toLowerCase();
  let messages = allMessages.slice();

  if (currentFolder === 'unread') messages = messages.filter((message) => message.unread && message.folder !== 'sent' && message.folder !== 'draft' && message.folder !== 'trash' && message.folder !== 'outbox' && message.folder !== 'spam');
  else if (currentFolder === 'sent') messages = messages.filter((message) => message.folder === 'sent');
  else if (currentFolder === 'outbox') messages = messages.filter((message) => message.folder === 'outbox');
  else if (currentFolder === 'archived') messages = messages.filter((message) => message.folder === 'archived');
  else if (currentFolder === 'flagged') messages = messages.filter((message) => message.flagged);
  else if (currentFolder === 'important') messages = messages.filter((message) => message.important);
  else if (currentFolder === 'drafts') messages = messages.filter((message) => message.folder === 'draft');
  else if (currentFolder === 'trash') messages = messages.filter((message) => message.folder === 'trash');
  else if (currentFolder === 'clients') messages = messages.filter((message) => Array.isArray(message.labels) && message.labels.includes('clients'));
  else if (currentFolder === 'spam') messages = messages.filter((message) => message.folder === 'spam');
  else if (currentFolder.startsWith('label:')) {
    const labelName = currentFolder.slice(6);
    messages = messages.filter((message) => Array.isArray(message.labels) && message.labels.includes(labelName));
  }
  else messages = messages.filter((message) => message.folder !== 'sent' && message.folder !== 'draft' && message.folder !== 'trash' && message.folder !== 'outbox' && message.folder !== 'spam');

  if (queryText) {
    messages = messages.filter((message) => {
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      return [message.subject, message.from, message.to, message.body, ...attachments.map((item) => item.name)].some((value) =>
        String(value || '').toLowerCase().includes(queryText)
      );
    });
  }

  // Badges come from server count() aggregations (see refreshCounts) so they
  // stay truthful while the list itself is a paged window.
  updateBadges();
  const folderKey = folderQueryKey(currentFolder);
  const fullyLoaded = Boolean(folderExhausted[folderKey]);
  document.getElementById('statusCount').textContent =
    `${messages.length} message${messages.length === 1 ? '' : 's'}${messages.length && !fullyLoaded ? ' · more below' : ''}`;

  container.innerHTML = '';
  updateSelectedCount();
  if (queryText && !fullyLoaded) {
    const hint = document.createElement('div');
    hint.className = 'search-scope-hint';
    hint.textContent = 'Searching loaded messages — load older for full results.';
    container.appendChild(hint);
  }
  if (!messages.length) {
    if (!(folderKey in folderCursors) && !fullyLoaded && !queryText) {
      // Folder never fetched: fetching placeholder, never a false empty state.
      container.innerHTML = '<div class="empty-state"><p>Fetching mail…</p></div>';
      return;
    }
    container.innerHTML = folderEmptyState(currentFolder, Boolean(queryText));
    container.querySelector('[data-empty-action="compose"]')?.addEventListener('click', () => openCompose({}));
    container.querySelector('[data-empty-action="clear-search"]')?.addEventListener('click', () => {
      document.getElementById('searchInput').value = '';
      renderList();
    });
    return;
  }

  messages.forEach((message) => {
    const item = document.createElement('div');
    const msgLabels = Array.isArray(message.labels) ? message.labels : [];
    let labelColor = '';
    if (msgLabels.length) {
      const firstLabelName = msgLabels[0];
      const found = userLabels.find(l => l.name === firstLabelName);
      if (found && found.color) labelColor = found.color;
    }
    item.className = `thread-item${message.unread ? ' unread' : ''}${message.id === activeMessageId ? ' active' : ''}${labelColor ? ' has-labels' : ''}`;
    if (labelColor) item.style.setProperty('--label-color', labelColor);
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.dataset.id = message.id;

    const timestamp = toDate(message.receivedAt);
    const attachmentCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
    const senderLabel = message.folder === 'sent' ? `To: ${message.to || ''}` : message.folder === 'outbox' ? getSenderLabel(message) : getSenderLabel(message);

    item.innerHTML = `
      <div class="thread-avatar" data-id="${message.id}">
        <svg class="thread-avatar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>
        <div class="thread-avatar-checkbox${selectedIds.has(message.id) ? ' checked' : ''}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>
        </div>
      </div>
      <div class="thread-body">
        <div class="thread-from">${escapeHtml(senderLabel)}</div>
        <div class="thread-subject">${escapeHtml(message.subject || '(no subject)')}</div>
        <div class="thread-preview">${escapeHtml(cleanPreviewText(stripMarkdown(fixEncoding(message.body || ''))).slice(0, 120))}</div>
        ${message.folder === 'outbox' ? `<div class="thread-tags"><span class="thread-tag ${message.status === 'failed' ? 'tag-error' : message.status === 'sending' ? 'tag-pending' : ''}">${message.status === 'sending' ? 'Sending...' : message.status === 'failed' ? 'Failed' : 'Pending'}</span></div>` : ''}
        ${attachmentCount ? `<div class="thread-tags"><span class="thread-tag">📎 ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}</span></div>` : ''}
        ${Array.isArray(message.labels) && message.labels.length ? `<div class="thread-tags">${message.labels.map((label) => `<span class="thread-tag">${escapeHtml(label)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="thread-aside"><div class="thread-time">${formatTime(timestamp)}</div><div class="thread-menu-wrap"><button class="thread-menu-btn" data-id="${message.id}" title="More" type="button"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button><div class="thread-menu-dropdown" data-menu-id="${message.id}"></div></div></div>`;

    const avatarEl = item.querySelector('.thread-avatar');
    avatarEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelected(message.id);
    });

    const openItem = () => {
      // Drafts open back in the composer (multi-draft, Phase 1/A2) —
      // everything else opens in the reader.
      if (message.folder === 'draft') openCompose({ draftId: message.id });
      else openMessage(message.id);
    };
    item.addEventListener('click', openItem);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openItem();
    });

    if (selectedIds.has(message.id)) {
      item.classList.add('selected');
    }

    const menuBtn = item.querySelector('.thread-menu-btn');
    const menuDropdown = item.querySelector('.thread-menu-dropdown');
    if (menuBtn && menuDropdown) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.thread-menu-dropdown.open').forEach(d => { if (d !== menuDropdown) d.classList.remove('open'); });
        menuDropdown.classList.toggle('open');
        if (menuDropdown.classList.contains('open') && userLabels.length) {
          const msgLabels = getMessageLabels(message.id);
          menuDropdown.innerHTML = userLabels.map(l => {
            const active = msgLabels.includes(l.name);
            return `<div class="menu-label-item${active ? ' active-label' : ''}" data-message-id="${message.id}" data-label="${escapeHtml(l.name)}" data-color="${l.color || '#888'}">
              <span class="menu-label-dot" style="background:${l.color || '#888'}"></span>
              <span class="menu-label-name">${escapeHtml(l.name)}</span>
              <span class="menu-label-check">${active ? '✓' : ''}</span>
            </div>`;
          }).join('');
          menuDropdown.querySelectorAll('.menu-label-item').forEach(el => {
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              const msgId = el.dataset.messageId;
              const labelName = el.dataset.label;
              assignLabel(msgId, labelName);
              el.classList.toggle('active-label');
              el.querySelector('.menu-label-check').textContent = el.classList.contains('active-label') ? '✓' : '';
              menuDropdown.classList.remove('open');
            });
          });
        } else if (menuDropdown.classList.contains('open')) {
          menuDropdown.innerHTML = '<div class="menu-label-item" style="cursor:default;color:var(--muted);font-size:10px;">No labels</div>';
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.thread-menu-wrap')) {
        document.querySelectorAll('.thread-menu-dropdown.open').forEach(d => d.classList.remove('open'));
      }
    }, { once: false });

    container.appendChild(item);
  });

  if (messages.length && !folderExhausted[folderQueryKey(currentFolder)]) {
    const wrap = document.createElement('div');
    wrap.className = 'load-more-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'load-more-btn';
    btn.textContent = loadingMore ? 'Loading…' : 'Load older messages';
    btn.disabled = loadingMore;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Loading…';
      await loadFolderPage(currentFolder);
    });
    wrap.appendChild(btn);
    container.appendChild(wrap);
  }
}

async function loadDraft(draftId = null) {
  if (!currentUser) return null;
  try {
    if (draftId) {
      const snap = await getDoc(doc(db, 'mail', draftId));
      if (!snap.exists() || snap.data().folder !== 'draft') return null;
      draftDocId = snap.id;
      return { id: snap.id, ...snap.data() };
    }
    const snap = await getDocs(query(
      collection(db, 'mail'),
      where('recipientEmail', '==', currentUser.email)
    ));
    const draftDoc = snap.docs.find((d) => d.data().folder === 'draft');
    if (!draftDoc) return null;
    draftDocId = draftDoc.id;
    return { id: draftDoc.id, ...draftDoc.data() };
  } catch (err) {
    console.warn('loadDraft:', err);
    return null;
  }
}

async function saveDraft() {
  if (!currentUser) return;
  window.SYNTHRUN_FLUSH_CHIPS?.();
  const to = readRecipientBox('toChips') || document.getElementById('compTo').value.trim();
  const cc = readRecipientBox('ccChips') || document.getElementById('compCc').value.trim();
  const bcc = readRecipientBox('bccChips') || document.getElementById('compBcc').value.trim();
  const subject = document.getElementById('compSubject').value.trim();
  // Single HTML editor (compose redesign): raw HTML in, plain text derived.
  const rawBody = String(window.SYNTHRUN_GET_COMPOSE_BODY?.() || '').trim();
  if (!to && !cc && !bcc && !subject && !rawBody) return;

  const data = {
    folder: 'draft',
    from: currentUser.email,
    fromName: formatSenderName(currentUser.email),
    senderEmail: currentUser.email,
    to,
    cc,
    bcc,
    subject,
    body: stripHtmlToText(rawBody),
    htmlBody: rawBody,
    // Only already-uploaded attachments persist — local File objects carry
    // no URL yet and are re-attached from the composer (Phase 1/A2).
    attachments: draftAttachments
      .filter((f) => f && f.url)
      .map((f) => ({ name: f.name, size: f.size, type: f.type, url: f.url, ...(f.fileId ? { fileId: f.fileId } : {}) })),
    senderUid: currentUser.uid,
    recipientEmail: currentUser.email,
    unread: false,
    flagged: false,
    important: false,
    isHtml: true,
    updatedAt: serverTimestamp(),
  };

  try {
    if (draftDocId) {
      await updateDoc(doc(db, 'mail', draftDocId), data);
    } else {
      const ref = await addDoc(collection(db, 'mail'), data);
      draftDocId = ref.id;
    }
    document.getElementById('composeUploadStatus').textContent =
      `Draft saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    console.warn('saveDraft:', err);
  }
}

async function clearDraft() {
  if (!draftDocId) return;
  try {
    await deleteDoc(doc(db, 'mail', draftDocId));
  } catch (err) {
    console.warn('clearDraft:', err);
  }
  draftDocId = null;
}

function scheduleDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraft, 2000);
}

// Subject threading (Phase 4/L1): collapse any existing Re:/Fwd: chain
// (case-insensitive, repeated) and apply exactly one prefix. Empty subjects
// become "(no subject)" — never a bare "Re:".
function normalizeSubject(subject, prefix) {
  let s = String(subject || '').trim();
  let prev = null;
  while (prev !== s) {
    prev = s;
    s = s.replace(/^\s*(re|fwd?|fw)(\[\d+\])?:\s*/i, '');
  }
  if (!s) s = '(no subject)';
  return `${prefix} ${s}`;
}

function splitEmails(value) {
  return String(value || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

let composeInReplyTo = '';

async function openMessage(id, { updateRoute = true, replaceRoute = false } = {}) {
  let message = messageMap.get(id);
  if (!message) {
    // Deep link / not-yet-paged message: fetch it directly (Phase 1/A5).
    try {
      const snap = await getDoc(doc(db, 'mail', id));
      if (snap.exists()) {
        message = { id: snap.id, ...snap.data() };
        messageMap.set(id, message);
        allMessages.unshift(message);
      }
    } catch { /* fall through to not-found */ }
  }
  if (!message) return;
  activeMessageId = id;
  setMessageOpenState(true);

  if (message.unread) {
    message.unread = false;
    try {
      await updateDoc(doc(db, 'mail', id), { unread: false });
    } catch (error) {
      console.warn('Could not clear unread flag:', error);
    }
    document.querySelectorAll(`.thread-item[data-id="${id}"]`).forEach(el => el.classList.remove('unread'));
    if (folderCounts.inboxUnread > 0) folderCounts.inboxUnread -= 1;
    updateBadges();
  }

  document.querySelectorAll('.thread-item.active').forEach(el => el.classList.remove('active'));
  document.querySelector(`.thread-item[data-id="${id}"]`)?.classList.add('active');

  const timestamp = toDate(message.receivedAt);
  document.getElementById('viewSubject').textContent = message.subject || '(no subject)';
  document.getElementById('viewCount').textContent = message.folder === 'sent' ? 'Sent' : message.folder === 'outbox' ? 'Outbox' : message.folder === 'spam' ? 'Spam' : 'Inbox';
  document.getElementById('viewDate').textContent = timestamp.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  // Fresh viewer token for authed /attachment/* links (Fix E3). Fetched once
  // per open; data: and third-party URLs are left untouched by withAuth.
  let attachmentAuthToken = '';
  if (attachments.length && currentUser && typeof currentUser.getIdToken === 'function') {
    try { attachmentAuthToken = await currentUser.getIdToken(); } catch { attachmentAuthToken = ''; }
  }
  const attachmentMarkup = attachments.length
    ? `
      <div class="mail-attachments">
        <div class="mail-attachments-title">Attachments</div>
        <div class="mail-attachments-list">
          ${attachments.map((attachment) => {
            const rawUrl = getAttachmentUrl(attachment, attachmentAuthToken);
            const isDataUrl = rawUrl.startsWith('data:');
            const previewUrl = escapeHtml(rawUrl);
            const downloadUrl = escapeHtml(isDataUrl ? rawUrl : (rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'download=1'));
            const fileName = escapeHtml(attachment.name || 'attachment');
            const downloadAttr = `download="${fileName}"`;
            return `
            <div class="mail-attachment">
              <a class="mail-attachment-preview" href="${previewUrl}" target="_blank" rel="noreferrer">
                <span class="mail-attachment-name">${fileName}</span>
                <span class="mail-attachment-meta">${escapeHtml(formatBytes(attachment.size || 0))}</span>
              </a>
              <a class="mail-attachment-download" href="${downloadUrl}" ${downloadAttr} title="Download ${fileName}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </a>
            </div>`}).join('')}
        </div>
      </div>`
    : '';

  const bodyText = isProbablyBinary(message.body) ? '' : fixEncoding(message.body || '');
  const htmlBodyText = isProbablyBinary(message.htmlBody) ? '' : fixEncoding(message.htmlBody || '');

  let bodyHtml = '';
  let isBodyHtml = false;
  if (htmlBodyText && hasHtmlTags(htmlBodyText)) {
    bodyHtml = sanitizeHtml(htmlBodyText);
    isBodyHtml = true;
  } else if (htmlBodyText && !hasHtmlTags(htmlBodyText)) {
    bodyHtml = escapeHtml(htmlBodyText);
  } else if (bodyText && hasHtmlTags(bodyText)) {
    bodyHtml = sanitizeHtml(bodyText);
    isBodyHtml = true;
  } else if (bodyText) {
    // Plain text stays plain: escaped + pre-wrap CSS. The old auto-Markdown
    // path rendered unsanitized HTML from regex substitution (XSS, Phase 3/B2).
    bodyHtml = escapeHtml(bodyText);
  }

  const replyBody = htmlBodyText && hasHtmlTags(htmlBodyText) ? stripHtmlToText(htmlBodyText) : (bodyText || '');

  const pendingAttachmentsNote = (message.attachmentStatus === 'pending' && attachments.length)
    ? `<div class="mail-bubble"><div class="mail-bubble-body" style="color:var(--subtle);font-size:12px;">Processing attachments… they will appear here in a moment.</div></div>`
    : '';

  const senderId = getSenderIdentity(message);
  const senderEmailFull = senderId.email || '';
  const toListFull = splitEmails(message.to || currentUser.email);
  const toShort = toListFull.length > 1 ? `${toListFull[0]} +${toListFull.length - 1}` : (toListFull[0] || '');
  const ccFull = String(message.cc || '').trim();
  const fullDate = timestamp.toLocaleString([], { dateStyle: 'full', timeStyle: 'long' });

  document.getElementById('mailBodyScroll').innerHTML = `
    ${pendingAttachmentsNote}
    <div class="mail-bubble">
      <div class="mail-bubble-header">
        <div class="mail-sender-block">
          <div class="mail-sender-avatar">${escapeHtml(getSenderLabel(message).slice(0, 2).toUpperCase())}</div>
          <div>
            <div class="mail-sender-name">${escapeHtml(getSenderLabel(message))}</div>
            <div class="mail-sender-addr">${escapeHtml(senderEmailFull)} → ${escapeHtml(toShort)}</div>
          </div>
        </div>
        <div class="mail-bubble-time">${timestamp.toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })}</div>
      </div>
      <div class="mail-details-toggle-row"><button class="mail-details-toggle" id="mailDetailsToggle" type="button" aria-expanded="false">Show details</button></div>
      <div class="mail-details" id="mailDetails" hidden>
        <div class="mail-details-row"><span>From</span><span>${escapeHtml(getSenderLabel(message))} &lt;${escapeHtml(senderEmailFull) || '—'}&gt;</span></div>
        <div class="mail-details-row"><span>To</span><span>${escapeHtml(toListFull.join(', ') || '—')}</span></div>
        ${ccFull ? `<div class="mail-details-row"><span>Cc</span><span>${escapeHtml(ccFull)}</span></div>` : ''}
        <div class="mail-details-row"><span>Date</span><span>${escapeHtml(fullDate)}</span></div>
        <div class="mail-details-row"><span>Subject</span><span>${escapeHtml(message.subject || '(no subject)')}</span></div>
        <div class="mail-details-row"><span>Mailed-by</span><span>synthrun.site</span></div>
        <div class="mail-details-row"><span>Message-ID</span><span>${escapeHtml(message.providerMessageId || '—')}</span></div>
      </div>
      <div class="mail-bubble-body${isBodyHtml ? ' is-html' : ''}" id="mailBodyContent">${isBodyHtml ? '' : bodyHtml}</div>
      ${attachmentMarkup}
    </div>`;

  // Encapsulate HTML email content in a shadow root to isolate its CSS
  if (isBodyHtml) {
    const host = document.getElementById('mailBodyContent');
    if (host && !host.shadowRoot) {
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>:host{all:initial;display:block;overflow-wrap:break-word;word-break:break-word;line-height:1.7;font-size:14px;color:#222;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}:host img{max-width:100%;height:auto}:host a{color:#111}:host table{max-width:100%!important}:host td{word-break:break-word}:host blockquote{border-left:2px solid #ddd;margin:1em 0;padding:0 1em;color:#666}</style><div>${bodyHtml}</div>`;
    }
  }

  document.getElementById('emptyView').style.display = 'none';
  document.getElementById('messageView').style.display = 'flex';
  document.getElementById('viewSubject').title = message.subject || '(no subject)';
  const detailsToggle = document.getElementById('mailDetailsToggle');
  detailsToggle?.addEventListener('click', () => {
    const details = document.getElementById('mailDetails');
    const willOpen = details.hidden;
    details.hidden = !willOpen;
    detailsToggle.textContent = willOpen ? 'Hide details' : 'Show details';
    detailsToggle.setAttribute('aria-expanded', String(willOpen));
  });
  const replyTarget = getSenderIdentity(message).email || message.from || '';
  const replyQuote = `\n\n---\nFrom: ${getSenderLabel(message) || ''}\n${replyBody}`;
  document.getElementById('replyBtn').onclick = () => openCompose({ to: replyTarget, subject: normalizeSubject(message.subject, 'Re:'), prefill: replyQuote, inReplyTo: message.providerMessageId || message.id });
  const hasHtmlContent = htmlBodyText && hasHtmlTags(htmlBodyText);
  document.getElementById('forwardBtn').onclick = () => openCompose({ subject: normalizeSubject(message.subject, 'Fwd:'), prefill: replyQuote, htmlBody: hasHtmlContent ? buildForwardedHtml(message, bodyHtml, timestamp) : '' });
  // Reply-all: sender in To, everyone else from To/Cc except me and sender.
  const meLower = (currentUser.email || '').toLowerCase();
  const replyAllCc = [...new Set([...toListFull, ...splitEmails(ccFull)].filter((a) => a && a !== meLower && a !== replyTarget.toLowerCase()))];
  document.getElementById('replyAllBtn').onclick = () => openCompose({ to: replyTarget, cc: replyAllCc.join(', '), subject: normalizeSubject(message.subject, 'Re:'), prefill: replyQuote, inReplyTo: message.providerMessageId || message.id });
  const isTrash = message.folder === 'trash';
  const isOutbox = message.folder === 'outbox';
  const isSpam = message.folder === 'spam';
  document.getElementById('deleteBtn').onclick = () => (isTrash || isOutbox) ? deleteForever(id) : trashMessage(id);
  document.getElementById('deleteBtn').title = isTrash ? 'Delete forever' : isSpam ? 'Move to trash' : 'Trash';
  document.getElementById('deleteBtn').setAttribute('aria-label', isTrash ? 'Delete forever' : isSpam ? 'Move to trash' : 'Move to trash');
  document.getElementById('archiveBtn').onclick = () => isSpam ? markAsNotSpam(id) : toggleArchive(id);
  document.getElementById('flagBtn').onclick = () => toggleFlag(id);
  document.getElementById('importantBtn').onclick = () => toggleImportant(id);
  document.getElementById('markUnreadBtn').onclick = () => markUnread(id);
  syncArchiveButtonState(message.folder === 'archived');
  if (isSpam) {
    document.getElementById('archiveBtn').title = 'Not spam';
    document.getElementById('archiveBtn').setAttribute('aria-label', 'Mark as not spam');
  }
  syncFlagButtonState(message.flagged);
  syncImportantButtonState(message.important);

  // Populate label dropdown
  const msgLabels = getMessageLabels(id);
  const labelDropdown = document.getElementById('labelDropdown');
  if (userLabels.length) {
    labelDropdown.innerHTML = userLabels.map(l => {
      const active = msgLabels.includes(l.name);
      return `<div class="label-dropdown-item${active ? ' active' : ''}" data-label="${escapeHtml(l.name)}">
        <span class="label-dot" style="background:${l.color || '#888'}"></span>
        <span>${escapeHtml(l.name)}</span>
        <span class="label-check">✓</span>
      </div>`;
    }).join('');
    labelDropdown.querySelectorAll('.label-dropdown-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        assignLabel(id, el.dataset.label);
        el.classList.toggle('active');
      });
    });
  } else {
    labelDropdown.innerHTML = '<div class="label-dropdown-item" style="cursor:default;color:var(--muted);">No labels — create in Settings</div>';
  }

  document.getElementById('replyBtn').style.display = isTrash || isOutbox || isSpam ? 'none' : '';
  document.getElementById('replyAllBtn').style.display = (isTrash || isOutbox || isSpam || !replyAllCc.length) ? 'none' : '';
  document.getElementById('forwardBtn').style.display = isTrash || isOutbox || isSpam ? 'none' : '';
  document.getElementById('notSpamBtn').style.display = isSpam ? '' : 'none';
  document.getElementById('restoreBtn').style.display = isTrash ? '' : 'none';
  document.getElementById('deleteForeverBtn').style.display = (isTrash || isSpam || isOutbox) ? '' : 'none';
  document.getElementById('retryBtn').style.display = isOutbox && message.status === 'failed' ? '' : 'none';

  if (isSpam) {
    document.getElementById('notSpamBtn').onclick = () => markAsNotSpam(id);
  }

  if (updateRoute) {
    syncRouteToLocation({ folder: currentFolder, messageId: id, replace: replaceRoute });
  }
}

window.SYNTHRUN_OPEN_MESSAGE = openMessage;

async function deleteMessage(id) {
  try {
    await deleteDoc(doc(db, 'mail', id));
    allMessages = allMessages.filter((message) => message.id !== id);
    messageMap.delete(id);
    closeMessageView({ replaceRoute: true });
    renderList();
    refreshCounts();
    showToast('Message deleted.');
  } catch (error) {
    console.error('deleteMessage:', error);
    showToast('Could not delete.', true);
  }
}

async function toggleArchive(id) {
  const message = messageMap.get(id);
  if (!message) return;
  if (message.folder === 'archived') {
    await unarchiveMessage(id);
    return;
  }
  await archiveMessage(id);
}

async function archiveMessage(id) {
  await moveMessageFolder(id, 'archived', 'Archived.', 'Could not archive.');
}

async function unarchiveMessage(id) {
  await moveMessageFolder(id, 'inbox', 'Moved to inbox.', 'Could not unarchive.');
}

async function moveMessageFolder(id, folder, successToast, failureToast) {
  try {
    await updateDoc(doc(db, 'mail', id), { folder });
    const movedMessage = messageMap.get(id);
    if (movedMessage) {
      movedMessage.folder = folder;
    }
    showFolderView({ folder, replaceRoute: true });
    syncArchiveButtonState(folder === 'archived');
    renderList();
    refreshCounts();
    showToast(successToast);
  } catch (error) {
    console.error('moveMessageFolder:', error);
    showToast(failureToast, true);
  }
}

async function toggleFlag(id) {
  const message = messageMap.get(id);
  if (!message) return;
  const nextValue = !message.flagged;
  message.flagged = nextValue;

  try {
    await updateDoc(doc(db, 'mail', id), { flagged: nextValue });
  } catch (error) {
    console.warn('toggleFlag update failed:', error);
  }

  syncFlagButtonState(nextValue);
  renderList();
  showToast(nextValue ? 'Flagged.' : 'Unflagged.');
}

async function markUnread(id) {
  const message = messageMap.get(id);
  if (!message) return;
  message.unread = true;

  try {
    await updateDoc(doc(db, 'mail', id), { unread: true });
  } catch (error) {
    console.warn('markUnread update failed:', error);
  }

  renderList();
  showToast('Marked unread.');
}

async function toggleImportant(id) {
  const message = messageMap.get(id);
  if (!message) return;
  const nextValue = !message.important;
  message.important = nextValue;

  try {
    await updateDoc(doc(db, 'mail', id), { important: nextValue });
  } catch (error) {
    console.warn('toggleImportant update failed:', error);
  }

  syncImportantButtonState(nextValue);
  renderList();
  showToast(nextValue ? 'Marked important.' : 'Unmarked important.');
}

function syncImportantButtonState(isImportant) {
  const btn = document.getElementById('importantBtn');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(Boolean(isImportant)));
}

// Retention (Phase 1): every trash/spam/archive move records where the
// message came from and when, so restore returns it correctly and the
// nightly purge can expire it after 30 days.
function restoreTargetFolder(prev) {
  if (prev && !['trash', 'spam', 'outbox'].includes(prev)) return prev;
  return 'inbox';
}

async function trashMessage(id) {
  const message = messageMap.get(id);
  const prev = message?.folder || currentFolder;
  try {
    await updateDoc(doc(db, 'mail', id), { folder: 'trash', previousFolder: prev, trashedAt: serverTimestamp() });
    const moved = messageMap.get(id);
    if (moved) { moved.folder = 'trash'; moved.previousFolder = prev; }
    closeMessageView({ replaceRoute: true });
    renderList();
    refreshCounts();
    showToast('Moved to trash.');
  } catch (error) {
    console.error('trashMessage:', error);
    showToast('Could not trash message.', true);
  }
}

async function restoreMessage(id) {
  const target = restoreTargetFolder(messageMap.get(id)?.previousFolder);
  try {
    await updateDoc(doc(db, 'mail', id), { folder: target, previousFolder: null, trashedAt: null, spamAt: null });
    const restored = messageMap.get(id);
    if (restored) restored.folder = target;
    closeMessageView({ replaceRoute: true });
    renderList();
    refreshCounts();
    showToast(target === 'inbox' ? 'Restored to inbox.' : 'Restored.');
  } catch (error) {
    console.error('restoreMessage:', error);
    showToast('Could not restore message.', true);
  }
}

async function markAsNotSpam(id) {
  const target = restoreTargetFolder(messageMap.get(id)?.previousFolder);
  try {
    await updateDoc(doc(db, 'mail', id), { folder: target, previousFolder: null, trashedAt: null, spamAt: null });
    const msg = messageMap.get(id);
    if (msg) msg.folder = target;
    closeMessageView({ replaceRoute: true });
    renderList();
    refreshCounts();
    showToast('Moved to inbox.');
  } catch (error) {
    console.error('markAsNotSpam:', error);
    showToast('Could not move to inbox.', true);
  }
}

async function deleteForever(id) {
  if (!confirm('Permanently delete this message? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'mail', id));
    allMessages = allMessages.filter((m) => m.id !== id);
    messageMap.delete(id);
    closeMessageView({ replaceRoute: true });
    renderList();
    refreshCounts();
    showToast('Permanently deleted.');
  } catch (error) {
    console.error('deleteForever:', error);
    showToast('Could not delete.', true);
  }
}

function closeMessageView({ replaceRoute = false } = {}) {
  activeMessageId = null;
  setMessageOpenState(false);

  const emptyView = document.getElementById('emptyView');
  const messageView = document.getElementById('messageView');
  if (emptyView) emptyView.style.display = 'flex';
  if (messageView) messageView.style.display = 'none';

  syncRouteToLocation({ folder: currentFolder, messageId: null, replace: replaceRoute });
}

function setMessageOpenState(isOpen) {
  document.getElementById('mailPanel')?.classList.toggle('message-open', Boolean(isOpen));
}

function syncFlagButtonState(isFlagged) {
  const flagButton = document.getElementById('flagBtn');
  if (!flagButton) return;
  flagButton.setAttribute('aria-pressed', String(Boolean(isFlagged)));
}

function syncArchiveButtonState(isArchived) {
  const archiveButton = document.getElementById('archiveBtn');
  if (!archiveButton) return;
  const archived = Boolean(isArchived);
  archiveButton.setAttribute('aria-pressed', String(archived));
  archiveButton.title = archived ? 'Unarchive' : 'Archive';
  archiveButton.setAttribute('aria-label', archived ? 'Unarchive message' : 'Archive message');
}

window.SYNTHRUN_TOGGLE_SELECT_ALL = function() {
  const container = document.getElementById('threadItems');
  if (!container) return;
  const visible = container.querySelectorAll('.thread-item');
  if (visible.length === selectedIds.size) {
    selectedIds.clear();
    container.querySelectorAll('.thread-item').forEach((el) => el.classList.remove('selected'));
    container.querySelectorAll('.thread-avatar-checkbox').forEach((el) => el.classList.remove('checked'));
  } else {
    selectedIds.clear();
    container.querySelectorAll('.thread-item').forEach((el) => {
      const id = el.dataset.id;
      if (id) selectedIds.add(id);
      el.classList.add('selected');
    });
    container.querySelectorAll('.thread-avatar-checkbox').forEach((el) => el.classList.add('checked'));
  }
  updateSelectedCount();
};

window.SYNTHRUN_CLOSE_MESSAGE_VIEW = closeMessageView;

function setAppLoading(isLoading) {
  if (!loadingOverlay) return;
  if (!isLoading) {
    window.SYNTHRUN_UPDATE_LOADING?.(5);
    // Minimum display so the loader is actually seen (3s animation loop);
    // emails are already painted underneath by the time this runs.
    const elapsed = Date.now() - (window.__bootStart || Date.now());
    const wait = Math.max(0, 1100 - elapsed);
    setTimeout(() => {
      window.__hideLoader?.();
    }, wait);
  } else {
    loadingOverlay.classList.remove('hidden');
    loadingOverlay.setAttribute('aria-busy', 'true');
  }
}

function clearComposeValidation() {
  ['compTo', 'compSubject', 'compHtmlBody', 'composeHtmlBody'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.classList.remove('invalid');
  });
}

function markComposeValidation({ to = false, subject = false, htmlBody = false } = {}) {
  const fieldMap = {
    compTo: to,
    compSubject: subject,
    compHtmlBody: htmlBody,
    composeHtmlBody: htmlBody,
  };

  Object.entries(fieldMap).forEach(([id, invalid]) => {
    const element = document.getElementById(id);
    if (element) element.classList.toggle('invalid', Boolean(invalid));
  });
}

// Plain text → minimal HTML for the single compose editor (compose redesign).
function textToHtml(text) {
  return escapeHtml(String(text || '')).replace(/\n/g, '<br>');
}

function stripHtmlToText(html) {
  const markup = String(html || '');
  const withoutBlocks = markup
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');

  const container = document.createElement('div');
  container.innerHTML = withoutBlocks;
  return container.textContent.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function buildForwardedHtml(message, bodyHtml, timestamp) {
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const sender = esc(getSenderLabel(message) || '');
  const date = timestamp.toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
  const subject = esc(message.subject || '(no subject)');
  const to = esc(message.to || '');
  return `<div style="border-left:2px solid #d4d4d0;padding-left:16px;margin:24px 0 16px;">
  <div style="font-size:10px;letter-spacing:0.05em;color:#888884;margin-bottom:10px;font-family:'Courier New',monospace;">
    <strong style="color:#555;font-weight:600;">From:</strong> ${sender}<br>
    <strong style="color:#555;font-weight:600;">To:</strong> ${to}<br>
    <strong style="color:#555;font-weight:600;">Date:</strong> ${date}<br>
    <strong style="color:#555;font-weight:600;">Subject:</strong> ${subject}
  </div>
  <div>
    ${bodyHtml}
  </div>
</div>`;
}

async function openCompose({ to = '', cc = '', bcc = '', subject = '', prefill = '', htmlBody = '', draftId = null, inReplyTo = '' } = {}) {
  composeInReplyTo = String(inReplyTo || '');
  // Opening an existing draft from the Drafts folder (multi-draft, A2).
  let editingDraft = null;
  if (draftId) {
    editingDraft = messageMap.get(draftId) || null;
    if (!editingDraft || editingDraft.folder !== 'draft') {
      editingDraft = await loadDraft(draftId);
    }
    if (!editingDraft) {
      showToast('Draft not found.', true);
      return;
    }
    draftDocId = editingDraft.id;
  }
  const isReply = Boolean(draftId || to || cc || bcc || subject || prefill);
  document.getElementById('compTo').value = to;
  document.getElementById('compCc').value = cc;
  document.getElementById('compBcc').value = bcc;
  if (!isReply) {
    // Fresh compose is always blank — drafts live in the Drafts folder and
    // reopen from there (no more single-draft auto-restore).
    draftDocId = null;
    document.getElementById('compSubject').value = '';
    document.getElementById('compHtmlBody').value = '';
    setComposeStatus('');
  } else if (editingDraft) {
    document.getElementById('compTo').value = editingDraft.to || '';
    document.getElementById('compCc').value = editingDraft.cc || '';
    document.getElementById('compBcc').value = editingDraft.bcc || '';
    if (editingDraft.cc) window.SYNTHRUN_OPEN_CC?.();
    if (editingDraft.bcc) window.SYNTHRUN_OPEN_BCC?.();
    document.getElementById('compSubject').value = editingDraft.subject || '';
    // Single HTML editor: stored HTML goes in raw, legacy plain drafts are
    // escaped so they render exactly as written.
    document.getElementById('compHtmlBody').value =
      editingDraft.htmlBody || textToHtml(editingDraft.body || '');
    draftAttachments = Array.isArray(editingDraft.attachments)
      ? editingDraft.attachments.map((a) => ({ name: a.name, size: a.size, type: a.type, url: a.url, fileId: a.fileId }))
      : [];
    setComposeStatus(draftAttachments.length ? `Draft restored · ${draftAttachments.length} attachment${draftAttachments.length === 1 ? '' : 's'}` : 'Draft restored');
  } else {
    document.getElementById('compSubject').value = subject;
    document.getElementById('compHtmlBody').value = htmlBody || textToHtml(prefill);
    // Reply-all (and any reply carrying Cc/Bcc) must reveal those fields.
    if (cc) window.SYNTHRUN_OPEN_CC?.();
    if (bcc) window.SYNTHRUN_OPEN_BCC?.();
    setComposeStatus('');
  }
  document.getElementById('attachmentInput').value = '';
  if (!editingDraft) draftAttachments = [];
  renderDraftAttachments();
  window.SYNTHRUN_RESET_COMPOSE_MODAL?.();
  clearComposeValidation();
  window.SYNTHRUN_INIT_CHIP_INPUT?.('toChips', 'recipient@example.com');
  window.SYNTHRUN_INIT_CHIP_INPUT?.('ccChips');
  window.SYNTHRUN_INIT_CHIP_INPUT?.('bccChips');
  document.getElementById('composeOverlay').classList.add('show');
  document.getElementById('toChips').querySelector('.chip-input')?.focus();
}

async function closeCompose({ discard = false } = {}) {
  if (composeBusy) return;
  if (discard) {
    if (!confirm('Discard this draft? This cannot be undone.')) return;
    await clearDraft();
  }
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  composeInReplyTo = '';
  document.getElementById('composeOverlay').classList.remove('show');
  document.getElementById('attachmentInput').value = '';
  draftAttachments = [];
  setComposeStatus('');
  renderDraftAttachments();
  window.SYNTHRUN_RESET_COMPOSE_MODAL?.();
  clearComposeValidation();
}

function renderDraftAttachments() {
  const container = document.getElementById('attachmentList');
  const count = document.getElementById('attachmentCount');
  count.textContent = `${draftAttachments.length} file${draftAttachments.length === 1 ? '' : 's'}`;

  if (!draftAttachments.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = draftAttachments.map((file, index) => `
    <div class="attachment-chip">
      <div>
        <div class="attachment-chip-name">${escapeHtml(file.name)}</div>
        <div class="attachment-chip-meta">${escapeHtml(formatBytes(file.size))}</div>
      </div>
      <button type="button" class="attachment-chip-remove" data-index="${index}" aria-label="Remove attachment">×</button>
    </div>`).join('');

  container.querySelectorAll('.attachment-chip-remove').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      draftAttachments.splice(index, 1);
      renderDraftAttachments();
    });
  });
}

async function onAttachmentsSelected(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const maxSize = 10 * 1024 * 1024;
  const remainingSlots = Math.max(0, 5 - draftAttachments.length);
  const acceptedFiles = [];

  for (const file of files.slice(0, remainingSlots)) {
    if (file.size > maxSize) {
      showToast(`Skipped ${file.name}: over 10 MB`, true);
      continue;
    }
    acceptedFiles.push(file);
  }

  if (files.length > remainingSlots) {
    showToast('Maximum 5 attachments per message.', true);
  }

  draftAttachments = [...draftAttachments, ...acceptedFiles];
  event.target.value = '';
  renderDraftAttachments();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadDraftAttachments() {
  const uploads = [];
  const total = draftAttachments.length;
  const debugUser = globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user');
  const idToken = debugUser ? null : await currentUser.getIdToken();
  const progressEl = document.getElementById('uploadProgress');
  const progressBar = document.getElementById('uploadProgressBar');

  if (total) {
    progressEl.style.display = 'block';
    progressBar.style.width = '0%';
  }

  for (let index = 0; index < draftAttachments.length; index += 1) {
    const file = draftAttachments[index];
    if (file.url) {
      uploads.push({ name: file.name, size: file.size, type: file.type, fileId: file.fileId, url: file.url });
      continue;
    }
    const pct = Math.round(((index) / total) * 100);
    progressBar.style.width = `${pct}%`;
    setComposeStatus(`Uploading ${index + 1}/${total}: ${file.name}`);
    const base64 = await fileToBase64(file);
    const response = await fetch('/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...(debugUser ? { 'X-Debug-User': debugUser } : {}),
      },
      body: JSON.stringify({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        data: base64,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed with ${response.status}`);
    }
    const result = await response.json();
    uploads.push({
      name: result.name,
      size: result.size,
      type: result.type,
      fileId: result.fileId,
      url: result.url,
    });
  }

  setComposeStatus(total ? `Uploaded ${total} file${total === 1 ? '' : 's'}` : '');
  if (total) {
    progressBar.style.width = '100%';
    setTimeout(() => { progressEl.style.display = 'none'; }, 800);
  }
  return uploads;
}

function themedEmailWrapper(bodyHtml) {
  return `<div style="font-family:monospace;font-size:14px;white-space:pre-wrap;max-width:640px;margin:0 auto;padding:24px;">${bodyHtml}</div>`;
}

async function sendMessage() {
  if (composeBusy) return;
  window.SYNTHRUN_FLUSH_CHIPS?.();
  const to = readRecipientBox('toChips') || document.getElementById('compTo').value.trim();
  const cc = readRecipientBox('ccChips') || document.getElementById('compCc').value.trim();
  const bcc = readRecipientBox('bccChips') || document.getElementById('compBcc').value.trim();
  const subject = document.getElementById('compSubject').value.trim();
  // Single HTML editor (compose redesign): HTML is the source of truth,
  // plain text is derived for the text part, search and previews.
  const rawBody = String(window.SYNTHRUN_GET_COMPOSE_BODY?.() || '').trim();
  // Flush may leave an invalid address as red text — block send until fixed.
  const badBox = ['toChips', 'ccChips', 'bccChips']
    .map((cid) => document.getElementById(cid))
    .find((box) => box && box.classList.contains('invalid'));
  if (badBox) {
    clearComposeValidation();
    showToast('Fix the highlighted email address before sending.', true);
    badBox.querySelector('.chip-input')?.focus();
    return;
  }
  let body = stripHtmlToText(rawBody);
  let htmlBody = rawBody;

  clearComposeValidation();

  const invalid = {
    to: !to,
    subject: !subject,
    htmlBody: !rawBody && !draftAttachments.length,
  };

  if (invalid.to || invalid.subject || invalid.htmlBody) {
    markComposeValidation(invalid);
    document.getElementById(invalid.to ? 'compTo' : invalid.subject ? 'compSubject' : 'compHtmlBody')?.focus();
    showToast('Fill in To, Subject, and add body text or an attachment.', true);
    return;
  }

  // Sending identity (Phase 6): display name travels as From, signature is
  // appended after validation so it can't satisfy the "has body" check.
  const sendingIdentity = window.SYNTHRUN_SENDING_IDENTITY || {};
  const signatureText = sendingIdentity.signature?.enabled ? String(sendingIdentity.signature.text || '').trim() : '';
  if (signatureText) {
    body += `\n\n-- \n${signatureText}`;
    htmlBody += `<br><div>--</div><div>${escapeHtml(signatureText).replace(/\n/g, '<br>')}</div>`;
  }

  const button = document.getElementById('sendBtn');
  const attachButton = document.getElementById('attachBtn');
  const discardButton = document.getElementById('discardBtn');
  button.disabled = true;
  button.classList.add('loading');
  attachButton.disabled = true;
  discardButton.disabled = true;
  composeBusy = true;

  let outboxId = null;
  let uploadedAttachments = [];

  try {
    // NOTE (retention fix A3 / Phase 0): failed outbox messages are never
    // auto-deleted. The user retries or discards each one explicitly from
    // the Outbox view.
    setComposeStatus('Saving to outbox...');
    const idempotencyKey = window.crypto?.randomUUID ? window.crypto.randomUUID() : 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    outboxId = await saveOutboxMessage(to, cc, bcc, subject, body, htmlBody, idempotencyKey, composeInReplyTo);
    if (outboxId) {
      const outboxEntry = { id: outboxId, folder: 'outbox', status: 'sending', idempotencyKey, inReplyTo: composeInReplyTo, from: currentUser.email, to, cc, bcc, subject, body, htmlBody, attachments: [], senderUid: currentUser.uid, recipientEmail: currentUser.email, unread: false, flagged: false, important: false };
      allMessages.unshift(outboxEntry);
      messageMap.set(outboxId, outboxEntry);
    }
    setComposeStatus(draftAttachments.length ? 'Preparing attachments...' : 'Sending...');
    uploadedAttachments = await uploadDraftAttachments();
    console.log(`[send] to=${to.split(',').filter(Boolean).length} cc=${cc.split(',').filter(Boolean).length} bcc=${bcc.split(',').filter(Boolean).length} subjectLen=${subject.length}`);
    const bodyWithLinks = `${body}${buildAttachmentText(uploadedAttachments)}`;
    const finalHtmlBody = `${htmlBody}${buildAttachmentHtml(uploadedAttachments)}`;
    const debugUser = globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user');
    const idToken = debugUser ? null : await currentUser.getIdToken();

    const response = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...(debugUser ? { 'X-Debug-User': debugUser } : {}),
      },
      body: JSON.stringify({ to, cc, bcc, subject, body: bodyWithLinks, htmlBody: finalHtmlBody, attachments: uploadedAttachments, idempotencyKey, inReplyTo: composeInReplyTo, fromName: sendingIdentity.displayName || undefined, from: currentUser.email }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || `Worker returned ${response.status}`);
    }

    await updateOutboxStatus(outboxId, { folder: 'sent', status: 'sent', attachments: uploadedAttachments });
    await clearDraft();
    composeInReplyTo = '';
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    composeBusy = false;
    closeCompose();
    const msg = messageMap.get(outboxId);
    if (msg) { msg.folder = 'sent'; msg.status = 'sent'; }
    renderList();
    refreshCounts();
    showToast('Message sent.');
    window.SYNTHRUN_ADD_CONTACTS?.([to, cc, bcc].filter(Boolean).flatMap(s => s.split(',').map(a => ({ email: a.trim(), name: '' }))));
  } catch (error) {
    console.error('sendMessage:', error);
    setComposeStatus('');
    markComposeValidation(invalid);
    showToast(`Send failed: ${error.message}`, true);
    if (outboxId) {
      await updateOutboxStatus(outboxId, { status: 'failed', attachments: draftAttachments.length ? uploadedAttachments : [] });
      const msg = messageMap.get(outboxId);
      if (msg) msg.status = 'failed';
    }
    renderList();
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
    attachButton.disabled = false;
    discardButton.disabled = false;
    composeBusy = false;
    if (!document.getElementById('composeOverlay').classList.contains('show')) {
      setComposeStatus('');
    }
  }
}

function getAttachmentUrl(attachment, authToken = '') {
  if (!attachment) return '';
  // /attachment/* requires auth (Fix E3). The viewer's fresh token is
  // appended for in-app reading only — never embed it in outgoing mail HTML
  // (it would leak the sender's token to recipients and expire in ~1h).
  const withAuth = (url) => {
    if (!authToken || url.startsWith('data:') || url.includes('api.telegram.org')) return url;
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'auth=' + encodeURIComponent(authToken);
  };
  // Has a proxy URL (telegram fileId stored) — use it with filename
  if (attachment.url && attachment.url.startsWith('/attachment/')) {
    const name = attachment.name || 'attachment';
    const sep = attachment.url.includes('?') ? '&' : '?';
    return withAuth(attachment.url + sep + 'name=' + encodeURIComponent(name));
  }
  // Has a telegram CDN URL and fileId — build proxy URL
  if (attachment.url && attachment.url.includes('api.telegram.org') && attachment.fileId) {
    const base = '/attachment/' + attachment.fileId;
    return withAuth(base + '?name=' + encodeURIComponent(attachment.name || 'attachment'));
  }
  // Has raw Brevo base64 content (no fileId) — inline data URL fallback
  if (attachment.content && typeof attachment.content === 'string' && attachment.content.length > 50) {
    const mime = attachment.type || attachment.contentType || 'application/octet-stream';
    return 'data:' + mime + ';base64,' + attachment.content;
  }
  // Whatever URL Brevo provided (may expire)
  return attachment.url || '';
}

function buildAttachmentText(attachments) {
  if (!attachments.length) return '';
  return ['','Attachments:','', ...attachments.map((attachment) => `- ${attachment.name}: ${attachment.url}`)].join('\n');
}

function buildAttachmentHtml(attachments) {
  if (!attachments.length) return '';
  // Intentionally bare proxy URLs (no ?auth=): the sender's token must never
  // be embedded in mail read by recipients. In-app clicks resolve via the
  // reader; external recipients hit the login-required endpoint (E3).
  // Phase 7 replaces this with signed Storage URLs.
  return `
    <div style="margin-top:16px;border-top:1px solid #e0dfd9;padding-top:12px;">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">Attachments</div>
      ${attachments.map((attachment) => `<div style="margin-bottom:8px;"><a href="${escapeHtml(getAttachmentUrl(attachment))}" target="_blank" rel="noreferrer" style="text-decoration:underline;">${escapeHtml(attachment.name)}</a> <span style="font-size:11px;">(${escapeHtml(formatBytes(attachment.size))})</span></div>`).join('')}
    </div>`;
}

function getSendEndpoint() {
  // A stored override can redirect the Firebase ID token to an arbitrary
  // host, so it is only honored on local dev (Fix E2 / Phase 0).
  const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const configuredUrl = isLocalDev ? (
    globalThis.SYNTHRUN_SEND_ENDPOINT ||
    globalThis.SYNTHRUN_SEND_WORKER_URL ||
    localStorage.getItem('synthrun-send-endpoint') ||
    localStorage.getItem('synthrun-send-worker-url')
  ) : '';
  if (configuredUrl) return configuredUrl;
  return '/send';
}


function formatTime(date) {
  const now = new Date();
  const diff = now - date;
  if (diff < 86400000 && now.getDate() === date.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 604800000) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanPreviewText(text) {
  return String(text)
    .replace(/\u00c2/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/https?:\/\/([^\s/]+)[^\s]*/g, '$1/…')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function fixEncoding(text) {
  let s = String(text);
  // Fix common UTF-8 double-encoding artifacts (Latin-1 → UTF-8 misinterpretation)
  s = s.replace(/\u00c3\u00a9/g, '\u00e9'); // é
  s = s.replace(/\u00c3\u00a8/g, '\u00e8'); // è
  s = s.replace(/\u00c3\u00aa/g, '\u00ea'); // ê
  s = s.replace(/\u00c3\u00ab/g, '\u00eb'); // ë
  s = s.replace(/\u00c3\u00a0/g, '\u00e0'); // à
  s = s.replace(/\u00c3\u00a2/g, '\u00e2'); // â
  s = s.replace(/\u00c3\u00a4/g, '\u00e4'); // ä
  s = s.replace(/\u00c3\u00a1/g, '\u00e1'); // á
  s = s.replace(/\u00c3\u00a3/g, '\u00e3'); // ã
  s = s.replace(/\u00c3\u00a5/g, '\u00e5'); // å
  s = s.replace(/\u00c3\u00a7/g, '\u00e7'); // ç
  s = s.replace(/\u00c3\u00b1/g, '\u00f1'); // ñ
  s = s.replace(/\u00c3\u00b3/g, '\u00f3'); // ó
  s = s.replace(/\u00c3\u00b6/g, '\u00f6'); // ö
  s = s.replace(/\u00c3\u00ba/g, '\u00fa'); // ú
  s = s.replace(/\u00c3\u00bc/g, '\u00fc'); // ü
  s = s.replace(/\u00c3\u0089/g, '\u00c9'); // É
  s = s.replace(/\u00c3\u0081/g, '\u00c1'); // Á
  s = s.replace(/\u00c3\u0093/g, '\u00d3'); // Ó
  s = s.replace(/\u00c3\u009a/g, '\u00da'); // Ú
  s = s.replace(/\u00c3\u0091/g, '\u00d1'); // Ñ
  // NOTE (Phase 3/B1): smart quotes, em/en dashes and other typography are
  // preserved as-is (UTF-8 end-to-end). Only control chars are stripped.
  // Fix remaining control chars
  s = s.replace(/[ --]/g, '');
  return s;
}

function stripMarkdown(text) {
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[>\s]+/gm, '')
    .trim();
}

function isProbablyBinary(text) {
  if (!text) return false;
  const str = String(text);
  let nullCount = 0;
  let c1Count = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x00) nullCount++;
    if (code >= 0x80 && code <= 0x9F) c1Count++;
  }
  if (nullCount > 0 && nullCount / str.length > 0.05) return true;
  return str.length > 0 && c1Count / str.length > 0.5;
}

function hasHtmlTags(text) {
  return /<[a-z][\s\S]*>/i.test(String(text));
}

// Lightweight HTML sanitizer for inbound mail (Phase 3/B3). Parses with
// DOMParser and strips scripts, plugins, forms, event handlers, and
// javascript: URLs; forces safe link targets. Runs before shadow-DOM inject.
function sanitizeHtml(dirty) {
  const markup = String(dirty || '');
  if (!markup) return '';
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(markup, 'text/html');
  const dangerousTags = new Set(['SCRIPT', 'OBJECT', 'EMBED', 'APPLET', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'META', 'LINK', 'STYLE', 'IFRAME', 'FRAME', 'BASE']);
  parsedDoc.querySelectorAll([...dangerousTags].join(',')).forEach((el) => el.remove());
  parsedDoc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name); continue;
      }
      if (name === 'srcdoc') el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return parsedDoc.body ? parsedDoc.body.innerHTML : '';
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show${isError ? ' err' : ''}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3200);
}

function setComposeStatus(message) {
  document.getElementById('composeUploadStatus').textContent = message;
}

function tick() {
  document.getElementById('statusTime').textContent = new Date().toLocaleTimeString();
}

// Keyboard shortcuts (Phase 5/J10): c compose · / search · j/k navigate ·
// e archive · # trash · u unread · r reply · f forward · Esc back · ? help.
// Never fires while typing in a field.
function isTypingTarget(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return Boolean(el.isContentEditable);
}

function focusThreadItem(offset) {
  const items = [...document.querySelectorAll('#threadItems .thread-item')];
  if (!items.length) return;
  const idx = items.findIndex((el) => el.classList.contains('active'));
  const next = items[idx < 0 ? 0 : Math.min(items.length - 1, Math.max(0, idx + offset))] || items[0];
  if (next) {
    next.focus();
    next.click();
    next.scrollIntoView({ block: 'nearest' });
  }
}

function handleGlobalShortcuts(event) {
  if (event.defaultPrevented) return;
  const overlayOpen = document.getElementById('composeOverlay')?.classList.contains('show');
  if (event.key === 'Escape') {
    if (overlayOpen && !composeBusy) { closeCompose(); return; }
    if (window.SYNTHRUN_TOGGLE_SHORTCUTS?.isOpen()) { window.SYNTHRUN_TOGGLE_SHORTCUTS(false); return; }
    if (activeMessageId) { closeMessageView(); return; }
    return;
  }
  if (isTypingTarget(event.target)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key;
  if (key === 'c' || key === 'C') { event.preventDefault(); openCompose({}); }
  else if (key === '/') { event.preventDefault(); document.getElementById('searchInput')?.focus(); }
  else if (key === '?') { event.preventDefault(); window.SYNTHRUN_TOGGLE_SHORTCUTS?.(); }
  else if (key === 'j' || key === 'J') { event.preventDefault(); focusThreadItem(1); }
  else if (key === 'k' || key === 'K') { event.preventDefault(); focusThreadItem(-1); }
  else if (key === 'e' || key === 'E') { if (activeMessageId) { event.preventDefault(); toggleArchive(activeMessageId); } }
  else if (key === '#') { if (activeMessageId) { event.preventDefault(); trashMessage(activeMessageId); } }
  else if (key === 'u' || key === 'U') { if (activeMessageId) { event.preventDefault(); markUnread(activeMessageId); } }
  else if (key === 'r' || key === 'R') {
    const btn = document.getElementById('replyBtn');
    if (activeMessageId && btn && btn.style.display !== 'none') { event.preventDefault(); btn.click(); }
  } else if (key === 'f' || key === 'F') {
    const btn = document.getElementById('forwardBtn');
    if (activeMessageId && btn && btn.style.display !== 'none') { event.preventDefault(); btn.click(); }
  }
}

function toDate(value) {
  if (!value) return new Date();
  if (typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}

function toMillis(value) {
  return toDate(value).getTime();
}
