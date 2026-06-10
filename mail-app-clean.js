import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const SEND_ENDPOINT = getSendEndpoint();
const LOGIN_URL = '/login/';
const ALLOWED_DOMAIN = 'synthrun.site';
const BOUNCE_ADDRESS_PATTERN = /^bounces-[^@]+@gw\.d\.sender-sib\.com$/i;
const FOLDER_LABELS = { inbox: 'Inbox', unread: 'Unread', sent: 'Sent', outbox: 'Outbox', archived: 'Archived', flagged: 'Flagged', important: 'Important', drafts: 'Drafts', trash: 'Trash', clients: 'Clients' };
const ROUTE_FOLDER_ALIASES = { all: 'inbox', inbox: 'inbox', unread: 'unread', sent: 'sent', outbox: 'outbox', archive: 'archived', archived: 'archived', flagged: 'flagged', important: 'important', drafts: 'drafts', draft: 'drafts', trash: 'trash', clients: 'clients' };
const ROUTE_FOLDER_SEGMENTS = { inbox: 'all', unread: 'unread', sent: 'sent', outbox: 'outbox', archived: 'archive', flagged: 'flagged', important: 'important', drafts: 'drafts', trash: 'trash', clients: 'clients' };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const loadingOverlay = document.getElementById('appLoadingOverlay');
const initialRouteState = getRouteStateFromLocation();

let currentUser = null;
let allMessages = [];
let currentFolder = initialRouteState.folder;
let activeMessageId = null;
let draftAttachments = [];
let uiBound = false;
let composeBusy = false;
let draftDocId = null;
let draftSaveTimer = null;
const DEBUG_USER = globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user') || '';

function getRouteStateFromLocation() {
  const segments = window.location.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  const firstSegment = String(segments[0] || '').toLowerCase();

  if (!segments.length || firstSegment === 'index.html' || firstSegment === 'index') {
    return { folder: 'inbox', messageId: null };
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
  if (window.location.pathname === nextPath) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ folder, messageId: messageId || null }, '', nextPath);
}

function updateFolderSelection(folder) {
  currentFolder = folder;
  document.getElementById('folderLabel').textContent = FOLDER_LABELS[folder] || folder;
  document.querySelectorAll('.side-link').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-btn').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll(`[data-folder="${folder}"]`).forEach((item) => item.classList.add('active'));
}

function showFolderView({ folder = currentFolder, replaceRoute = false } = {}) {
  updateFolderSelection(folder);
  activeMessageId = null;
  document.getElementById('emptyView').style.display = 'flex';
  document.getElementById('messageView').style.display = 'none';
  setMessageOpenState(false);
  syncRouteToLocation({ folder, messageId: null, replace: replaceRoute });
}

async function restoreRouteState() {
  const { folder, messageId } = getRouteStateFromLocation();
  updateFolderSelection(folder);
  activeMessageId = null;
  document.getElementById('emptyView').style.display = 'flex';
  document.getElementById('messageView').style.display = 'none';
  setMessageOpenState(false);

  if (!messageId) {
    syncRouteToLocation({ folder, messageId: null, replace: true });
    renderList();
    return;
  }

  const messageExists = allMessages.some((message) => message.id === messageId);
  if (!messageExists) {
    syncRouteToLocation({ folder, messageId: null, replace: true });
    renderList();
    return;
  }

  syncRouteToLocation({ folder, messageId, replace: true });
  renderList();
  await openMessage(messageId, { updateRoute: false, replaceRoute: true });
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
    slug: sanitizeEmail(user.email).split('@')[0],
    initials: user.email.split('@')[0].slice(0, 2).toUpperCase(),
  };
  document.getElementById('userAvatar').textContent = user.email.split('@')[0].slice(0, 2).toUpperCase();
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('statusUser').textContent = user.email;
  document.getElementById('compFromLabel').textContent = `from: ${user.email}`;

  if (!uiBound) {
    bindUi();
    uiBound = true;
  }

  // DEBUG helper: expose a function to get the current user's ID token from the console
  // Use in browser console: window._getIdToken().then(t => console.log(t))
  window._getIdToken = async () => (currentUser ? await currentUser.getIdToken() : null);

  await loadMessages();
  await restoreRouteState();
  setAppLoading(false);
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
    slug: sanitizeEmail(email).split('@')[0],
    initials: email.split('@')[0].slice(0, 2).toUpperCase(),
  };

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
  document.getElementById('discardBtn').addEventListener('click', closeCompose);
  document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('attachmentInput').click());
  document.getElementById('attachmentInput').addEventListener('change', onAttachmentsSelected);
  document.getElementById('composeOverlay').addEventListener('click', (event) => {
    if (event.target === document.getElementById('composeOverlay')) closeCompose();
  });

  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('searchInput').addEventListener('input', renderList);
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    showToast('Refreshing...');
    await loadMessages();
    showToast('Up to date.');
  });

  window.SYNTHRUN_REFRESH_INBOX = async () => {
    showFolderView({ folder: 'inbox', replaceRoute: true });
    await loadMessages();
  };

  document.getElementById('importantBtn').addEventListener('click', () => {
    if (activeMessageId) toggleImportant(activeMessageId);
  });
  document.getElementById('restoreBtn').addEventListener('click', () => {
    if (activeMessageId) restoreMessage(activeMessageId);
  });
  document.getElementById('deleteForeverBtn').addEventListener('click', () => {
    if (activeMessageId) deleteForever(activeMessageId);
  });
  document.getElementById('retryBtn').addEventListener('click', () => {
    if (activeMessageId) retryOutboxMessage(activeMessageId);
  });

  document.getElementById('userChip').addEventListener('click', () => {
    const menu = document.getElementById('userMenu');
    const open = menu.classList.toggle('show');
    document.getElementById('userChip').setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (event) => {
    const userChip = document.getElementById('userChip');
    if (!userChip.contains(event.target)) {
      document.getElementById('userMenu').classList.remove('show');
    }
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = LOGIN_URL;
  });

  document.getElementById('accountBtn').addEventListener('click', () => {
    const profile = window.SYNTHRUN_PROFILE_DATA || {};
    const slug = profile.slug || 'profile';
    window.location.href = `/${encodeURIComponent(slug)}.html`;
  });

  document.querySelectorAll('.side-link[data-folder]').forEach((link) => {
    link.addEventListener('click', () => {
      showFolderView({ folder: link.dataset.folder });
      renderList();
    });
  });

  ['compTo', 'compCc', 'compSubject', 'compBody', 'compHtmlBody'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', scheduleDraftSave);
  });

  tick();
  setInterval(tick, 1000);
}

async function loadMessages() {
  if (!currentUser) return;

  try {
    const snap = await getDocs(query(collection(db, 'mail'), where('recipientEmail', '==', currentUser.email)));
    allMessages = snap.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((left, right) => toMillis(right.receivedAt) - toMillis(left.receivedAt));
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

async function saveOutboxMessage(to, cc, subject, body, htmlBody = '') {
  try {
    const message = {
      folder: 'outbox',
      status: 'sending',
      from: currentUser.email,
      fromName: formatSenderName(currentUser.email),
      senderEmail: currentUser.email,
      to,
      cc,
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
  const message = allMessages.find((m) => m.id === id);
  if (!message || message.folder !== 'outbox') return;
  try {
    await updateOutboxStatus(id, { status: 'sending' });
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const bodyWithLinks = `${message.body || ''}${buildAttachmentText(attachments)}`;
    const finalHtmlBody = `${message.htmlBody || ''}${buildAttachmentHtml(attachments)}`;
    const debugUser = globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user');
    const idToken = debugUser ? null : await currentUser.getIdToken();
    const response = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...(debugUser ? { 'X-Debug-User': debugUser } : {}),
      },
      body: JSON.stringify({
        to: message.to,
        cc: message.cc,
        subject: message.subject,
        body: bodyWithLinks,
        htmlBody: finalHtmlBody,
        attachments,
        from: currentUser.email,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Worker returned ${response.status}`);
    }
    await updateOutboxStatus(id, { folder: 'sent', status: 'sent' });
    await loadMessages();
    showToast('Message sent.');
  } catch (error) {
    console.error('retryOutboxMessage:', error);
    await updateOutboxStatus(id, { status: 'failed' });
    showToast(`Send failed: ${error.message}`, true);
    await loadMessages();
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

function isBounceAddress(value) {
  return BOUNCE_ADDRESS_PATTERN.test(sanitizeEmail(value));
}

function isGenericSenderName(value) {
  const name = String(value || '').trim().toLowerCase();
  return !name || name === 'synthrun mail' || name === 'synthrun';
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

  if (sender.name && sender.email) {
    if (isGenericSenderName(sender.name)) {
      return sender.email;
    }
    return `${sender.name} <${sender.email}>`;
  }

  if (sender.name) {
    if (isGenericSenderName(sender.name) && sender.email) {
      return sender.email;
    }
    return sender.name;
  }

  if (sender.email) {
    return sender.email;
  }

  const fallback = sanitizeEmail(message.from);
  if (isBounceAddress(fallback)) {
    return 'Synthrun Mail';
  }

  return fallback || 'Unknown';
}

function renderList() {
  const container = document.getElementById('threadItems');
  const queryText = document.getElementById('searchInput').value.trim().toLowerCase();
  let messages = allMessages.slice();

  if (currentFolder === 'unread') messages = messages.filter((message) => message.unread && message.folder !== 'sent' && message.folder !== 'draft' && message.folder !== 'trash' && message.folder !== 'outbox');
  else if (currentFolder === 'sent') messages = messages.filter((message) => message.folder === 'sent');
  else if (currentFolder === 'outbox') messages = messages.filter((message) => message.folder === 'outbox');
  else if (currentFolder === 'archived') messages = messages.filter((message) => message.folder === 'archived');
  else if (currentFolder === 'flagged') messages = messages.filter((message) => message.flagged);
  else if (currentFolder === 'important') messages = messages.filter((message) => message.important);
  else if (currentFolder === 'drafts') messages = messages.filter((message) => message.folder === 'draft');
  else if (currentFolder === 'trash') messages = messages.filter((message) => message.folder === 'trash');
  else if (currentFolder === 'clients') messages = messages.filter((message) => Array.isArray(message.labels) && message.labels.includes('clients'));
  else messages = messages.filter((message) => message.folder !== 'sent' && message.folder !== 'draft' && message.folder !== 'trash' && message.folder !== 'outbox');

  if (queryText) {
    messages = messages.filter((message) => {
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      return [message.subject, message.from, message.to, message.body, ...attachments.map((item) => item.name)].some((value) =>
        String(value || '').toLowerCase().includes(queryText)
      );
    });
  }

  const inboxUnread = allMessages.filter((message) => message.unread && message.folder !== 'sent' && message.folder !== 'draft' && message.folder !== 'trash' && message.folder !== 'outbox').length;
  const draftCount = allMessages.filter((message) => message.folder === 'draft').length;
  const trashCount = allMessages.filter((message) => message.folder === 'trash').length;
  const importantCount = allMessages.filter((message) => message.important).length;
  const outboxCount = allMessages.filter((message) => message.folder === 'outbox').length;
  document.getElementById('badge-inbox').textContent = String(inboxUnread || 0);
  document.getElementById('badge-unread').textContent = String(inboxUnread || 0);
  document.getElementById('badge-archived').textContent = String(allMessages.filter((message) => message.folder === 'archived').length || 0);
  document.getElementById('badge-sent').textContent = String(allMessages.filter((message) => message.folder === 'sent').length || '—');
  document.getElementById('badge-important').textContent = String(importantCount || 0);
  document.getElementById('badge-drafts').textContent = String(draftCount || '—');
  document.getElementById('badge-trash').textContent = String(trashCount || 0);
  document.getElementById('badge-outbox').textContent = String(outboxCount || 0);
  document.getElementById('statusCount').textContent = `${messages.length} message${messages.length === 1 ? '' : 's'}`;

  container.innerHTML = '';
  if (!messages.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M3 8l7.9 5.3a2 2 0 0 0 2.2 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"/></svg>
        <p>No messages</p>
      </div>`;
    return;
  }

  messages.forEach((message) => {
    const item = document.createElement('div');
    item.className = `thread-item${message.unread ? ' unread' : ''}${message.id === activeMessageId ? ' active' : ''}`;
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.dataset.id = message.id;

    const timestamp = toDate(message.receivedAt);
    const attachmentCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
    const senderLabel = message.folder === 'sent' ? `To: ${message.to || ''}` : message.folder === 'outbox' ? getSenderLabel(message) : getSenderLabel(message);

    item.innerHTML = `
      <div>
        <div class="thread-from">${escapeHtml(senderLabel)}</div>
        <div class="thread-subject">${escapeHtml(message.subject || '(no subject)')}</div>
        <div class="thread-preview">${escapeHtml((message.body || '').slice(0, 80))}</div>
        ${message.folder === 'outbox' ? `<div class="thread-tags"><span class="thread-tag ${message.status === 'failed' ? 'tag-error' : message.status === 'sending' ? 'tag-pending' : ''}">${message.status === 'sending' ? 'Sending...' : message.status === 'failed' ? 'Failed' : 'Pending'}</span></div>` : ''}
        ${attachmentCount ? `<div class="thread-tags"><span class="thread-tag">📎 ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}</span></div>` : ''}
        ${Array.isArray(message.labels) && message.labels.length ? `<div class="thread-tags">${message.labels.map((label) => `<span class="thread-tag">${escapeHtml(label)}</span>`).join('')}</div>` : ''}
      </div>
      <div>
        <div class="thread-time">${formatTime(timestamp)}</div>
        <div class="thread-dot" aria-hidden="true"></div>
      </div>`;

    item.addEventListener('click', () => openMessage(message.id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openMessage(message.id);
    });
    container.appendChild(item);
  });
}

async function loadDraft() {
  if (!currentUser) return null;
  try {
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
  const to = document.getElementById('compTo').value.trim();
  const cc = document.getElementById('compCc').value.trim();
  const subject = document.getElementById('compSubject').value.trim();
  const rawBody = String(window.SYNTHRUN_GET_COMPOSE_BODY?.() || '').trim();
  const isHtmlMode = Boolean(window.SYNTHRUN_GET_COMPOSE_IS_HTML?.());
  if (!to && !cc && !subject && !rawBody) return;

  const data = {
    folder: 'draft',
    from: currentUser.email,
    fromName: formatSenderName(currentUser.email),
    senderEmail: currentUser.email,
    to,
    cc,
    subject,
    body: rawBody,
    htmlBody: isHtmlMode ? rawBody : '',
    senderUid: currentUser.uid,
    recipientEmail: currentUser.email,
    unread: false,
    flagged: false,
    important: false,
    isHtml: isHtmlMode,
    updatedAt: serverTimestamp(),
  };

  try {
    if (draftDocId) {
      await updateDoc(doc(db, 'mail', draftDocId), data);
    } else {
      const ref = await addDoc(collection(db, 'mail'), data);
      draftDocId = ref.id;
    }
    document.getElementById('composeUploadStatus').textContent = 'Draft saved';
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

async function openMessage(id, { updateRoute = true, replaceRoute = false } = {}) {
  const message = allMessages.find((entry) => entry.id === id);
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
  }

  document.querySelectorAll('.thread-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.id === id);
  });

  const timestamp = toDate(message.receivedAt);
  document.getElementById('viewSubject').textContent = message.subject || '(no subject)';
  document.getElementById('viewCount').textContent = message.folder === 'sent' ? 'Sent' : message.folder === 'outbox' ? 'Outbox' : 'Inbox';
  document.getElementById('viewDate').textContent = timestamp.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const attachmentMarkup = attachments.length
    ? `
      <div class="mail-attachments">
        <div class="mail-attachments-title">Attachments</div>
        <div class="mail-attachments-list">
          ${attachments.map((attachment) => `
            <a class="mail-attachment" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer">
              <span class="mail-attachment-name">${escapeHtml(attachment.name || 'attachment')}</span>
              <span class="mail-attachment-meta">${escapeHtml(formatBytes(attachment.size || 0))}</span>
            </a>`).join('')}
        </div>
      </div>`
    : '';

  document.getElementById('mailBodyScroll').innerHTML = `
    <div class="mail-bubble">
      <div class="mail-bubble-header">
        <div class="mail-sender-block">
          <div class="mail-sender-avatar">${escapeHtml(getSenderLabel(message).slice(0, 2).toUpperCase())}</div>
          <div>
            <div class="mail-sender-name">${escapeHtml(getSenderLabel(message))}</div>
            <div class="mail-sender-addr">To: ${escapeHtml(message.to || currentUser.email)}</div>
          </div>
        </div>
        <div class="mail-bubble-time">${timestamp.toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })}</div>
      </div>
      <div class="mail-bubble-body${message.htmlBody ? ' is-html' : ''}">${message.htmlBody || escapeHtml(message.body || '')}</div>
      ${attachmentMarkup}
    </div>`;

  document.getElementById('emptyView').style.display = 'none';
  document.getElementById('messageView').style.display = 'flex';
  const replyTarget = getSenderIdentity(message).email || message.from || '';
  document.getElementById('replyBtn').onclick = () => openCompose({ to: replyTarget, subject: `Re: ${message.subject || ''}`, prefill: `\n\n---\nFrom: ${getSenderLabel(message) || ''}\n${message.body || ''}` });
  document.getElementById('forwardBtn').onclick = () => openCompose({ subject: `Fwd: ${message.subject || ''}`, prefill: `\n\n---\nFrom: ${getSenderLabel(message) || ''}\n${message.body || ''}` });
  const isTrash = message.folder === 'trash';
  const isOutbox = message.folder === 'outbox';
  document.getElementById('deleteBtn').onclick = () => isTrash ? deleteForever(id) : trashMessage(id);
  document.getElementById('deleteBtn').title = isTrash ? 'Delete forever' : 'Trash';
  document.getElementById('deleteBtn').setAttribute('aria-label', isTrash ? 'Delete forever' : 'Move to trash');
  document.getElementById('archiveBtn').onclick = () => toggleArchive(id);
  document.getElementById('flagBtn').onclick = () => toggleFlag(id);
  document.getElementById('importantBtn').onclick = () => toggleImportant(id);
  document.getElementById('markUnreadBtn').onclick = () => markUnread(id);
  syncArchiveButtonState(message.folder === 'archived');
  syncFlagButtonState(message.flagged);
  syncImportantButtonState(message.important);

  document.getElementById('replyBtn').style.display = isTrash || isOutbox ? 'none' : '';
  document.getElementById('forwardBtn').style.display = isTrash || isOutbox ? 'none' : '';
  document.getElementById('restoreBtn').style.display = isTrash ? '' : 'none';
  document.getElementById('deleteForeverBtn').style.display = isTrash ? '' : 'none';
  document.getElementById('retryBtn').style.display = isOutbox && message.status === 'failed' ? '' : 'none';

  if (updateRoute) {
    syncRouteToLocation({ folder: currentFolder, messageId: id, replace: replaceRoute });
  }
}

window.SYNTHRUN_OPEN_MESSAGE = openMessage;

async function deleteMessage(id) {
  try {
    await deleteDoc(doc(db, 'mail', id));
    allMessages = allMessages.filter((message) => message.id !== id);
    closeMessageView({ replaceRoute: true });
    renderList();
    showToast('Message deleted.');
  } catch (error) {
    console.error('deleteMessage:', error);
    showToast('Could not delete.', true);
  }
}

async function toggleArchive(id) {
  const message = allMessages.find((entry) => entry.id === id);
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
    const movedMessage = allMessages.find((message) => message.id === id);
    if (movedMessage) {
      movedMessage.folder = folder;
    }
    showFolderView({ folder, replaceRoute: true });
    syncArchiveButtonState(folder === 'archived');
    renderList();
    showToast(successToast);
  } catch (error) {
    console.error('moveMessageFolder:', error);
    showToast(failureToast, true);
  }
}

async function toggleFlag(id) {
  const message = allMessages.find((entry) => entry.id === id);
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
  const message = allMessages.find((entry) => entry.id === id);
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
  const message = allMessages.find((entry) => entry.id === id);
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

async function trashMessage(id) {
  try {
    await updateDoc(doc(db, 'mail', id), { folder: 'trash' });
    const moved = allMessages.find((m) => m.id === id);
    if (moved) moved.folder = 'trash';
    closeMessageView({ replaceRoute: true });
    renderList();
    showToast('Moved to trash.');
  } catch (error) {
    console.error('trashMessage:', error);
    showToast('Could not trash message.', true);
  }
}

async function restoreMessage(id) {
  try {
    await updateDoc(doc(db, 'mail', id), { folder: 'inbox' });
    const restored = allMessages.find((m) => m.id === id);
    if (restored) restored.folder = 'inbox';
    closeMessageView({ replaceRoute: true });
    renderList();
    showToast('Restored to inbox.');
  } catch (error) {
    console.error('restoreMessage:', error);
    showToast('Could not restore message.', true);
  }
}

async function deleteForever(id) {
  try {
    await deleteDoc(doc(db, 'mail', id));
    allMessages = allMessages.filter((m) => m.id !== id);
    closeMessageView({ replaceRoute: true });
    renderList();
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

window.SYNTHRUN_CLOSE_MESSAGE_VIEW = closeMessageView;

function setAppLoading(isLoading) {
  if (!loadingOverlay) return;
  loadingOverlay.classList.toggle('hidden', !isLoading);
  loadingOverlay.setAttribute('aria-busy', String(isLoading));
}

function clearComposeValidation() {
  ['compTo', 'compSubject', 'compBody', 'composePlainBody', 'composeHtmlBody'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.classList.remove('invalid');
  });
}

function markComposeValidation({ to = false, subject = false, body = false, htmlBody = false } = {}) {
  const fieldMap = {
    compTo: to,
    compSubject: subject,
    compBody: body,
    composePlainBody: body && !htmlBody,
    composeHtmlBody: htmlBody,
  };

  Object.entries(fieldMap).forEach(([id, invalid]) => {
    const element = document.getElementById(id);
    if (element) element.classList.toggle('invalid', Boolean(invalid));
  });
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

async function openCompose({ to = '', cc = '', subject = '', prefill = '' } = {}) {
  const isReply = Boolean(to || cc || subject || prefill);
  if (!isReply) {
    const draft = await loadDraft();
    if (draft) {
      document.getElementById('compTo').value = draft.to || '';
      document.getElementById('compCc').value = draft.cc || '';
      document.getElementById('compSubject').value = draft.subject || '';
      if (draft.isHtml && draft.htmlBody) {
        const modeTemplateBtn = document.getElementById('modeTemplateBtn');
        if (modeTemplateBtn) modeTemplateBtn.click();
        const htmlBodyTA = document.getElementById('compHtmlBody');
        if (htmlBodyTA) htmlBodyTA.value = draft.htmlBody;
      } else {
        document.getElementById('compBody').value = draft.body || '';
      }
      setComposeStatus('Draft restored');
    }
    if (!draft) {
      document.getElementById('compTo').value = '';
      document.getElementById('compCc').value = '';
      document.getElementById('compSubject').value = '';
      document.getElementById('compBody').value = '';
    }
  } else {
    document.getElementById('compTo').value = to;
    document.getElementById('compCc').value = cc;
    document.getElementById('compSubject').value = subject;
    document.getElementById('compBody').value = prefill;
    setComposeStatus('');
  }
  document.getElementById('attachmentInput').value = '';
  draftAttachments = [];
  renderDraftAttachments();
  window.SYNTHRUN_RESET_COMPOSE_MODAL?.();
  clearComposeValidation();
  document.getElementById('composeOverlay').classList.add('show');
  document.getElementById('compTo').focus();
}

async function closeCompose() {
  if (composeBusy) return;
  await clearDraft();
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
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

async function sendMessage() {
  const to = document.getElementById('compTo').value.trim();
  const cc = document.getElementById('compCc').value.trim();
  const subject = document.getElementById('compSubject').value.trim();
  const isHtmlMode = Boolean(window.SYNTHRUN_GET_COMPOSE_IS_HTML?.());
  const rawBody = String(window.SYNTHRUN_GET_COMPOSE_BODY?.() || '').trim();
  const body = isHtmlMode ? stripHtmlToText(rawBody) : rawBody;
  const htmlBody = isHtmlMode ? rawBody : `<div style="font-family:monospace;font-size:14px;color:#111;white-space:pre-wrap;max-width:640px;margin:0 auto;padding:24px;">${escapeHtml(body)}</div>`;

  clearComposeValidation();

  const invalid = {
    to: !to,
    subject: !subject,
    body: !body && !draftAttachments.length && !(isHtmlMode && rawBody),
    htmlBody: isHtmlMode && !rawBody && !draftAttachments.length,
  };

  if (invalid.to || invalid.subject || invalid.body) {
    markComposeValidation(invalid);
    document.getElementById(invalid.to ? 'compTo' : invalid.subject ? 'compSubject' : isHtmlMode ? 'compHtmlBody' : 'compBody')?.focus();
    showToast('Fill in To, Subject, and add body text or an attachment.', true);
    return;
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
    const failedOutboxMessages = allMessages.filter((m) => m.folder === 'outbox' && m.status === 'failed');
    for (const msg of failedOutboxMessages) {
      deleteDoc(doc(db, 'mail', msg.id)).catch(() => {});
    }
    setComposeStatus('Saving to outbox...');
    outboxId = await saveOutboxMessage(to, cc, subject, body, htmlBody);
    setComposeStatus(draftAttachments.length ? 'Preparing attachments...' : 'Sending...');
    uploadedAttachments = await uploadDraftAttachments();
    const bodyWithLinks = `${body}${buildAttachmentText(uploadedAttachments)}`;
    const finalHtmlBody = `${htmlBody}${buildAttachmentHtml(uploadedAttachments)}`;
    const debugUser = globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user');
    const idToken = debugUser ? null : await currentUser.getIdToken();

    const response = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...(debugUser ? { 'X-Debug-User': debugUser } : {}),
      },
      body: JSON.stringify({ to, cc, subject, body: bodyWithLinks, htmlBody: finalHtmlBody, attachments: uploadedAttachments, from: currentUser.email }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || `Worker returned ${response.status}`);
    }

    await updateOutboxStatus(outboxId, { folder: 'sent', status: 'sent', attachments: uploadedAttachments });
    await clearDraft();
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    await loadMessages();
    composeBusy = false;
    closeCompose();
    showToast('Message sent.');
  } catch (error) {
    console.error('sendMessage:', error);
    setComposeStatus('');
    markComposeValidation(invalid);
    showToast(`Send failed: ${error.message}`, true);
    if (outboxId) {
      await updateOutboxStatus(outboxId, { status: 'failed', attachments: draftAttachments.length ? uploadedAttachments : [] });
    }
    await loadMessages();
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

function buildAttachmentText(attachments) {
  if (!attachments.length) return '';
  return ['','Attachments:','', ...attachments.map((attachment) => `- ${attachment.name}: ${attachment.url}`)].join('\n');
}

function buildAttachmentHtml(attachments) {
  if (!attachments.length) return '';
  return `
    <div style="margin-top:16px;border-top:1px solid #e0dfd9;padding-top:12px;">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#888;margin-bottom:8px;">Attachments</div>
      ${attachments.map((attachment) => `<div style="margin-bottom:8px;"><a href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer" style="color:#111;text-decoration:underline;">${escapeHtml(attachment.name)}</a> <span style="color:#888;font-size:11px;">(${escapeHtml(formatBytes(attachment.size))})</span></div>`).join('')}
    </div>`;
}

function getSendEndpoint() {
  const configuredUrl =
    globalThis.SYNTHRUN_SEND_ENDPOINT ||
    globalThis.SYNTHRUN_SEND_WORKER_URL ||
    localStorage.getItem('synthrun-send-endpoint') ||
    localStorage.getItem('synthrun-send-worker-url');
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

function toDate(value) {
  if (!value) return new Date();
  if (typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}

function toMillis(value) {
  return toDate(value).getTime();
}
