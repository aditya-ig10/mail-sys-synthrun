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
const LOGIN_URL = './login/';
const ALLOWED_DOMAIN = 'synthrun.site';
const BOUNCE_ADDRESS_PATTERN = /^bounces-[^@]+@gw\.d\.sender-sib\.com$/i;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null;
let allMessages = [];
let currentFolder = 'inbox';
let activeMessageId = null;
let draftAttachments = [];
let uiBound = false;
let composeBusy = false;
const DEBUG_USER = globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user') || '';

if (DEBUG_USER) {
  bootDebugUser(DEBUG_USER);
}

onAuthStateChanged(auth, async (user) => {
  if (DEBUG_USER) return;
  if (!user || !user.email || !user.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    window.location.href = LOGIN_URL;
    return;
  }

  currentUser = user;
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
});

function bootDebugUser(email) {
  currentUser = {
    email,
    uid: 'debug-user',
    async getIdToken() {
      return null;
    },
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
    renderList();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDebugUi, { once: true });
  } else {
    initializeDebugUi();
  }
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

  const folderLabels = { inbox: 'Inbox', unread: 'Unread', sent: 'Sent', flagged: 'Flagged', clients: 'Clients' };
  document.querySelectorAll('.side-link[data-folder]').forEach((link) => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.side-link').forEach((item) => item.classList.remove('active'));
      link.classList.add('active');
      currentFolder = link.dataset.folder;
      document.getElementById('folderLabel').textContent = folderLabels[currentFolder] || currentFolder;
      activeMessageId = null;
      document.getElementById('emptyView').style.display = 'flex';
      document.getElementById('messageView').style.display = 'none';
      renderList();
    });
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

async function saveSentMessage(to, cc, subject, body, attachments = []) {
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
      attachments,
      senderUid: currentUser.uid,
      recipientEmail: currentUser.email,
      unread: false,
      flagged: false,
      receivedAt: serverTimestamp(),
    };

    await addDoc(collection(db, 'mail'), message);
  } catch (error) {
    console.error('saveSentMessage:', error);
  }
}

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

  if (currentFolder === 'unread') messages = messages.filter((message) => message.unread && message.folder !== 'sent');
  else if (currentFolder === 'sent') messages = messages.filter((message) => message.folder === 'sent');
  else if (currentFolder === 'flagged') messages = messages.filter((message) => message.flagged);
  else if (currentFolder === 'clients') messages = messages.filter((message) => Array.isArray(message.labels) && message.labels.includes('clients'));
  else messages = messages.filter((message) => message.folder !== 'sent');

  if (queryText) {
    messages = messages.filter((message) => {
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      return [message.subject, message.from, message.to, message.body, ...attachments.map((item) => item.name)].some((value) =>
        String(value || '').toLowerCase().includes(queryText)
      );
    });
  }

  const inboxUnread = allMessages.filter((message) => message.unread && message.folder !== 'sent').length;
  document.getElementById('badge-inbox').textContent = String(inboxUnread || 0);
  document.getElementById('badge-unread').textContent = String(inboxUnread || 0);
  document.getElementById('badge-sent').textContent = String(allMessages.filter((message) => message.folder === 'sent').length || '—');
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
    const senderLabel = message.folder === 'sent' ? `To: ${message.to || ''}` : getSenderLabel(message);

    item.innerHTML = `
      <div>
        <div class="thread-from">${escapeHtml(senderLabel)}</div>
        <div class="thread-subject">${escapeHtml(message.subject || '(no subject)')}</div>
        <div class="thread-preview">${escapeHtml((message.body || '').slice(0, 80))}</div>
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

async function openMessage(id) {
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
  document.getElementById('viewCount').textContent = message.folder === 'sent' ? 'Sent' : 'Inbox';
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
      <div class="mail-bubble-body">${escapeHtml(message.body || '')}</div>
      ${attachmentMarkup}
    </div>`;

  document.getElementById('emptyView').style.display = 'none';
  document.getElementById('messageView').style.display = 'flex';
  const replyTarget = getSenderIdentity(message).email || message.from || '';
  document.getElementById('replyBtn').onclick = () => openCompose({ to: replyTarget, subject: `Re: ${message.subject || ''}`, prefill: `\n\n---\nFrom: ${getSenderLabel(message) || ''}\n${message.body || ''}` });
  document.getElementById('forwardBtn').onclick = () => openCompose({ subject: `Fwd: ${message.subject || ''}`, prefill: `\n\n---\nFrom: ${getSenderLabel(message) || ''}\n${message.body || ''}` });
  document.getElementById('deleteBtn').onclick = () => deleteMessage(id);
  document.getElementById('archiveBtn').onclick = () => archiveMessage(id);
  document.getElementById('flagBtn').onclick = () => toggleFlag(id);
  document.getElementById('markUnreadBtn').onclick = () => markUnread(id);
}

async function deleteMessage(id) {
  try {
    await deleteDoc(doc(db, 'mail', id));
    allMessages = allMessages.filter((message) => message.id !== id);
    activeMessageId = null;
    setMessageOpenState(false);
    document.getElementById('emptyView').style.display = 'flex';
    document.getElementById('messageView').style.display = 'none';
    renderList();
    showToast('Message deleted.');
  } catch (error) {
    console.error('deleteMessage:', error);
    showToast('Could not delete.', true);
  }
}

async function archiveMessage(id) {
  try {
    await updateDoc(doc(db, 'mail', id), { folder: 'archived' });
    allMessages = allMessages.filter((message) => message.id !== id);
    activeMessageId = null;
    setMessageOpenState(false);
    document.getElementById('emptyView').style.display = 'flex';
    document.getElementById('messageView').style.display = 'none';
    renderList();
    showToast('Archived.');
  } catch (error) {
    console.error('archiveMessage:', error);
    showToast('Could not archive.', true);
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

function closeMessageView() {
  activeMessageId = null;
  setMessageOpenState(false);

  const emptyView = document.getElementById('emptyView');
  const messageView = document.getElementById('messageView');
  if (emptyView) emptyView.style.display = 'flex';
  if (messageView) messageView.style.display = 'none';
}

function setMessageOpenState(isOpen) {
  document.getElementById('mailPanel')?.classList.toggle('message-open', Boolean(isOpen));
}

window.SYNTHRUN_CLOSE_MESSAGE_VIEW = closeMessageView;

function openCompose({ to = '', cc = '', subject = '', prefill = '' } = {}) {
  document.getElementById('compTo').value = to;
  document.getElementById('compCc').value = cc;
  document.getElementById('compSubject').value = subject;
  document.getElementById('compBody').value = prefill;
  document.getElementById('attachmentInput').value = '';
  draftAttachments = [];
  setComposeStatus('');
  renderDraftAttachments();
  document.getElementById('composeOverlay').classList.add('show');
  document.getElementById('compTo').focus();
}

function closeCompose() {
  if (composeBusy) return;
  document.getElementById('composeOverlay').classList.remove('show');
  document.getElementById('attachmentInput').value = '';
  draftAttachments = [];
  setComposeStatus('');
  renderDraftAttachments();
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

async function uploadDraftAttachments() {
  const uploads = [];
  const total = draftAttachments.length;

  for (let index = 0; index < draftAttachments.length; index += 1) {
    const file = draftAttachments[index];
    setComposeStatus(`Uploading ${index + 1}/${total}: ${file.name}`);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const path = `mail-attachments/${currentUser.uid}/${uniqueId}-${safeName}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file, { contentType: file.type || 'application/octet-stream' });
    const url = await getDownloadURL(fileRef);
    uploads.push({
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      url,
      path,
    });
  }

  setComposeStatus(total ? `Uploaded ${total} file${total === 1 ? '' : 's'}` : '');
  return uploads;
}

async function sendMessage() {
  const to = document.getElementById('compTo').value.trim();
  const cc = document.getElementById('compCc').value.trim();
  const subject = document.getElementById('compSubject').value.trim();
  const body = document.getElementById('compBody').value.trim();

  if (!to || !subject || (!body && !draftAttachments.length)) {
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

  try {
    setComposeStatus(draftAttachments.length ? 'Preparing attachments...' : 'Sending...');
    const attachments = await uploadDraftAttachments();
    const bodyWithLinks = `${body}${buildAttachmentText(attachments)}`;
    const htmlBody = `<div style="font-family:monospace;font-size:14px;color:#111;white-space:pre-wrap;max-width:640px;margin:0 auto;padding:24px;">${escapeHtml(body)}${buildAttachmentHtml(attachments)}</div>`;
    const debugUser = globalThis.SYNTHRUN_DEBUG_USER || localStorage.getItem('synthrun-debug-user');
    const idToken = debugUser ? null : await currentUser.getIdToken();

    const response = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...(debugUser ? { 'X-Debug-User': debugUser } : {}),
      },
      body: JSON.stringify({ to, cc, subject, body: bodyWithLinks, htmlBody, attachments, from: currentUser.email }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || `Worker returned ${response.status}`);
    }

    await saveSentMessage(to, cc, subject, body, attachments);
    await loadMessages();
    composeBusy = false;
    closeCompose();
    showToast('Message sent.');
  } catch (error) {
    console.error('sendMessage:', error);
    setComposeStatus('');
    showToast(`Send failed: ${error.message}`, true);
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
