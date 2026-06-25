require('dotenv').config();

// Production safety: fail fast if debug bypass is enabled
if (process.env.NODE_ENV === 'production' && String(process.env.ALLOWED_BYPASS || '0') === '1') {
  console.error('ERROR: ALLOWED_BYPASS must be disabled in production. Set ALLOWED_BYPASS=0 and re-deploy.');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const express = require('express');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim() || TELEGRAM_BOT_TOKEN.split(':')[0];

const app = express();
app.use(express.json({ limit: '50mb' }));

function initFirebase() {
  if (admin.apps && admin.apps.length) return;

  const localServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(
    __dirname,
    'synthrun-site-firebase-adminsdk-fbsvc-75da2cfca3.json'
  );

  let raw = '';
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64) {
    raw = Buffer.from(String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64).trim(), 'base64').toString('utf8');
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  }
  if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    raw = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8');
  }

  if (!raw && process.env.NODE_ENV !== 'production' && fs.existsSync(localServiceAccountPath)) {
    raw = fs.readFileSync(localServiceAccountPath, 'utf8');
  }

  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH. In production provide the service account as a secret (FIREBASE_SERVICE_ACCOUNT_JSON) and do not rely on checked-in files.'
      );
    }

    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH');
  }

  let serviceAccount;
  try {
    serviceAccount = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Use a single-line minified JSON string, or set FIREBASE_SERVICE_ACCOUNT_JSON_B64 with base64-encoded JSON, or set FIREBASE_SERVICE_ACCOUNT_PATH.'
    );
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true' || port === 465;

  if (!host) {
    throw new Error('Missing SMTP_HOST');
  }

  const transport = {
    host,
    port,
    secure,
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 2),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100),
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
    },
  };

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transport.auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  }

  return nodemailer.createTransport(transport);
}

function getBrevoApiKey() {
  return String(process.env.BREVO_API_KEY || process.env.BREVO_API_KEY_JSON || '').trim();
}

async function uploadToTelegram(fileBuffer, fileName, mimeType) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
  }

  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2, 12);
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT_ID}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
    'utf-8'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');

  const body = Buffer.concat([header, fileBuffer, footer]);

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });

  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram upload failed: ${result.description}`);
  return { fileId: result.result.document.file_id };
}

async function getTelegramFileUrl(fileId) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const result = await response.json();
  if (!result.ok) throw new Error('Telegram file not found');
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${result.result.file_path}`;
}

async function sendViaBrevoApi({ senderAddress, fromName, userEmail, to, cc, bcc, subject, text, htmlContent, attachments }) {
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    throw new Error('Missing BREVO_API_KEY');
  }

  const payload = {
    sender: {
      name: fromName,
      email: senderAddress,
    },
    to: [{ email: sanitizeEmail(to) }],
    subject: String(subject),
    textContent: String(text),
    htmlContent,
    replyTo: {
      email: userEmail,
    },
  };

  if (cc) {
    payload.cc = [{ email: sanitizeEmail(cc) }];
  }
  if (bcc) {
    payload.bcc = [{ email: sanitizeEmail(bcc) }];
  }

  if (Array.isArray(attachments) && attachments.length) {
    payload.attachment = attachments.map((attachment) => {
      const item = { name: attachment.name || 'attachment' };
      if (attachment.content) {
        item.content = attachment.content.toString('base64');
      } else {
        item.url = attachment.url;
      }
      return item;
    });
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(responseBody.message || `Brevo API returned ${response.status}`);
  }

  return responseBody;
}

function cors(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Debug-User');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function buildFirebaseConfig() {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    ...(process.env.FIREBASE_MEASUREMENT_ID ? { measurementId: process.env.FIREBASE_MEASUREMENT_ID } : {}),
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    const error = new Error(`Missing Firebase env vars: ${missing.join(', ')}`);
    error.statusCode = 500;
    throw error;
  }

  return config;
}

async function authenticate(req) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const debugUser = req.headers['x-debug-user'];

  if (process.env.ALLOWED_BYPASS === '1' && debugUser) {
    return String(debugUser).trim().toLowerCase();
  }

  if (!idToken) throw new Error('Missing Authorization header');

  initFirebase();
  const decoded = await admin.auth().verifyIdToken(idToken);
  if (!decoded.email) throw new Error('Token missing email');
  return decoded.email.toLowerCase();
}

function sanitizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function formatSenderName(email) {
  const localPart = String(email || '')
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

function formatFromName(email) {
  const template = String(process.env.FROM_NAME_TEMPLATE || '').trim();
  const senderEmail = sanitizeEmail(email);
  const name = formatSenderName(senderEmail);

  if (template) {
    return template
      .replaceAll('{name}', name)
      .replaceAll('{email}', senderEmail);
  }

  return `${name} from ${senderEmail}`;
}

function getAllowedDomain() {
  return String(process.env.ALLOWED_DOMAIN || 'synthrun.site').toLowerCase();
}

function isInternalMailbox(email) {
  return sanitizeEmail(email).endsWith(`@${getAllowedDomain()}`);
}

const SPAM_KEYWORDS = [
  'urgent', 'act now', 'free money', 'limited time', 'click here', 'congratulations',
  'you won', 'winner', 'cash prize', 'guaranteed', 'no risk', 'double your',
  'earn extra', 'work from home', 'make money', 'credit card', 'verify account',
  'account suspended', 'unusual activity', 'login attempt', 'password expired',
  'claim your', 'exclusive deal', 'order now', 'buy now', 'discount',
  'million dollars', 'lottery', 'selected winner', 'prize winner',
  'investment opportunity', 'weight loss', 'enlargement', 'pharmacy',
  'prescription', 'cheap prices', 'lowest price', '100% satisfied',
  'satisfaction guaranteed', 'accept credit cards', 'no medical',
  'social security', 'bank account', 'wire transfer', 'western union',
  'money order', 'cost per click', 'search engine', 'advertising',
  'traffic', 'seo', 'ranking', 'unsubscribe here',
];

function isProbablySpam({ from, subject, text, htmlContent }) {
  let score = 0;
  const body = String(text || htmlContent || '').toLowerCase();
  const subjectLower = String(subject || '').toLowerCase();

  // Keyword scoring
  for (const keyword of SPAM_KEYWORDS) {
    if (subjectLower.includes(keyword)) score += 3;
    if (body.includes(keyword)) score += 1;
  }

  // Suspicious patterns in subject
  if (/^[A-Z0-9\s!]{10,}$/.test(String(subject))) score += 2; // all caps
  if (/[!]{2,}/.test(String(subject))) score += 2;
  if (/\$\d/.test(String(subject))) score += 1;

  // Link ratio in body
  if (body.length > 100) {
    const links = (body.match(/https?:\/\/[^\s]+/g) || []).length;
    const linkRatio = links / (body.split(/\s+/).length || 1);
    if (linkRatio > 0.3) score += 3;
    if (linkRatio > 0.5) score += 2;
  }

  // All-caps body segments
  const words = body.split(/\s+/).filter((w) => w.length > 3);
  const capsWords = words.filter((w) => /^[A-Z]+$/.test(w)).length;
  if (words.length > 10 && capsWords / words.length > 0.4) score += 2;

  // Excessive HTML in plain-text field (likely disguised)
  if (text && text.includes('<') && text.includes('>')) score += 1;

  // Common spam phrases in body
  if (body.includes('click the link below')) score += 1;
  if (body.includes('confirm your')) score += 1;
  if (body.includes('you have been selected')) score += 2;

  return score >= 4;
}

async function storeMailboxMessages({ senderEmail, fromName, to, cc, bcc, subject, text, htmlContent, attachments, skipSpamCheck }) {
  const recipients = [...new Set([to, cc, bcc].map(sanitizeEmail).filter(Boolean).filter(isInternalMailbox))];
  if (!recipients.length) {
    return;
  }

  const db = admin.firestore();

  let folder = 'inbox';
  if (!skipSpamCheck) {
    const spam = isProbablySpam({ from: senderEmail, subject, text, htmlContent });
    if (spam) folder = 'spam';
  }

  const payload = {
    folder,
    from: senderEmail,
    fromName,
    senderEmail,
    subject: String(subject),
    body: String(text),
    htmlBody: String(htmlContent || ''),
    attachments: Array.isArray(attachments) ? attachments : [],
    unread: true,
    flagged: false,
    important: false,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await Promise.all(
    recipients.map(async (recipientEmail) => {
      const snap = await db.collection('mail')
        .where('recipientEmail', '==', recipientEmail)
        .where('senderEmail', '==', sanitizeEmail(senderEmail))
        .where('subject', '==', String(subject))
        .limit(1)
        .get();

      if (snap.empty) {
        await db.collection('mail').add({ ...payload, recipientEmail });
      }
    })
  );
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlToText(value) {
  return String(value || '')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function attachmentsToMailOptions(attachments = []) {
  return attachments.map((attachment) => ({
    filename: attachment.name || 'attachment',
    path: attachment.content ? undefined : attachment.url,
    content: attachment.content || undefined,
    contentType: attachment.type || undefined,
    knownLength: attachment.size || undefined,
  }));
}

async function resolveAttachmentContent(attachment) {
  if (!attachment || !attachment.url) return attachment;
  if (attachment.url.startsWith('/attachment/')) {
    const fileId = attachment.url.replace('/attachment/', '');
    try {
      const fileUrl = await getTelegramFileUrl(fileId);
      const resp = await fetch(fileUrl);
      if (resp.ok) {
        const buffer = Buffer.from(await resp.arrayBuffer());
        return { ...attachment, content: buffer, url: fileUrl };
      }
    } catch (_) {}
  }
  return attachment;
}

async function resolveAttachments(attachments = []) {
  return Promise.all(attachments.map(resolveAttachmentContent));
}

app.options('/send', (req, res) => {
  cors(req, res);
  res.status(204).end();
});

app.options('/upload', (req, res) => {
  cors(req, res);
  res.status(204).end();
});

app.get('/attachment/:fileId', async (req, res) => {
  cors(req, res);
  try {
    const fileUrl = await getTelegramFileUrl(req.params.fileId);
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) return sendJson(res, 502, { error: 'Failed to fetch attachment' });
    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const isDownload = req.query.download === '1';
    const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', isDownload ? 'attachment' : 'inline');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (error) {
    sendJson(res, 404, { error: error.message });
  }
});

app.post('/upload', async (req, res) => {
  cors(req, res);
  try {
    await authenticate(req);
    const { name, type, size, data: base64Data } = req.body || {};
    if (!name || !base64Data) return sendJson(res, 400, { error: 'Missing name or data' });

    const buffer = Buffer.from(base64Data, 'base64');
    const { fileId } = await uploadToTelegram(buffer, name, type || 'application/octet-stream');
    const url = `/attachment/${fileId}`;

    return sendJson(res, 200, { name, size, type: type || 'application/octet-stream', fileId, url });
  } catch (error) {
    const status = error.message === 'Missing Authorization header' ? 401 : 502;
    return sendJson(res, status, { error: error.message });
  }
});

app.get('/firebase-config.js', (_req, res) => {
  try {
    const firebaseConfig = buildFirebaseConfig();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`export const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 2)};`);
  } catch (error) {
    res.status(error.statusCode || 500).setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(`throw new Error(${JSON.stringify(error.message)});`);
  }
});

app.post('/send', async (req, res) => {
  cors(req, res);

  try {
    const userEmail = await authenticate(req);
    const allowedDomain = process.env.ALLOWED_DOMAIN || 'synthrun.site';
    if (!userEmail.endsWith(`@${allowedDomain}`)) {
      return sendJson(res, 403, { error: 'Sender not authorised' });
    }

    const { to, cc, bcc, subject, body: text, htmlBody, attachments = [] } = req.body || {};
    const fallbackText = String(text || '').trim() || htmlToText(htmlBody);
    if (!to || !subject || (!fallbackText && !htmlBody)) {
      return sendJson(res, 400, { error: 'Missing required fields: to, subject, body' });
    }

    const senderAddress = userEmail;
    const fromName = formatFromName(userEmail);

    const recipients = [sanitizeEmail(to)];
    if (cc) recipients.push(sanitizeEmail(cc));
    if (bcc) recipients.push(sanitizeEmail(bcc));
    const htmlContent = htmlBody || htmlEscape(fallbackText);

    const resolvedAttachments = await resolveAttachments(Array.isArray(attachments) ? attachments : []);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const absoluteUrlAttachments = resolvedAttachments.map((a) => ({
      ...a,
      url: a.url && a.url.startsWith('/') ? `${baseUrl}${a.url}` : a.url,
    }));

    const brevoApiKey = getBrevoApiKey();
    let info;
    if (brevoApiKey) {
      info = await sendViaBrevoApi({
        senderAddress,
        fromName,
        userEmail,
        to,
        cc,
        bcc,
        subject,
        text: fallbackText,
        htmlContent,
        attachments: absoluteUrlAttachments,
      });
    } else {
      const transporter = createTransport();
      info = await transporter.sendMail({
        from: `"${fromName}" <${senderAddress}>`,
        replyTo: userEmail,
        to: sanitizeEmail(to),
        ...(cc ? { cc: sanitizeEmail(cc) } : {}),
        ...(bcc ? { bcc: sanitizeEmail(bcc) } : {}),
        subject: String(subject),
        text: fallbackText,
        html: htmlContent,
        attachments: attachmentsToMailOptions(absoluteUrlAttachments),
        envelope: {
          from: senderAddress,
          to: recipients,
        },
      });
    }

    // Store attachments with proxy URLs (not expiring Telegram CDN URLs)
    const storeAttachments = resolvedAttachments.map((a) => {
      const { content, ...rest } = a;
      return { ...rest, url: rest.fileId ? `/attachment/${rest.fileId}` : (rest.url || '') };
    });

    try {
      await storeMailboxMessages({
        senderEmail: senderAddress,
        fromName,
        to,
        cc,
        bcc,
        subject,
        text: fallbackText,
        htmlContent,
        attachments: storeAttachments,
        skipSpamCheck: true,
      });
    } catch (storeError) {
      console.warn('Could not store mailbox copy:', storeError);
    }

    return sendJson(res, 200, { ok: true, messageId: info.messageId });
  } catch (error) {
    const status = error.message === 'Missing Authorization header' ? 401 : 502;
    return sendJson(res, status, { error: error.message });
  }
});

function sanitizeIncomingText(text) {
  if (!text) return '';
  const str = String(text);

  // Check for C1 control characters (0x80-0x9F) — these should never appear in real text.
  // Their presence means binary data was interpreted as text (e.g. inline image or attachment
  // content leaked into the body field by the upstream email parser).
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x80 && code <= 0x9F) {
      console.warn(`sanitizeIncomingText: C1 control char U+${code.toString(16).padStart(4, '0')} at pos ${i}, discarding. length=${str.length}`);
      return '';
    }
  }

  // Strip ASCII control characters (keep \t \n \r)
  let cleaned = '';
  let controlCount = 0;
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7F) {
      cleaned += ch;
    } else if (code === 0x09 || code === 0x0A || code === 0x0D) {
      cleaned += ch;
    } else {
      controlCount++;
    }
  }

  // If high ratio of control characters, discard
  if (cleaned.length > 0 && controlCount > str.length * 0.3) {
    console.warn(`sanitizeIncomingText: high control-char ratio ${(controlCount / str.length).toFixed(2)}, discarding. length=${str.length}`);
    return '';
  }

  // For longer texts, check readability via ASCII alphanumeric + space ratio
  if (cleaned.length > 100) {
    let alphaSpaceCount = 0;
    const sample = cleaned.slice(0, 500);
    for (const ch of sample) {
      const code = ch.charCodeAt(0);
      if (
        (code >= 0x41 && code <= 0x5A) ||
        (code >= 0x61 && code <= 0x7A) ||
        (code >= 0x30 && code <= 0x39) ||
        code === 0x20
      ) {
        alphaSpaceCount++;
      }
    }
    const ratio = alphaSpaceCount / sample.length;
    if (ratio < 0.25) {
      console.warn(`sanitizeIncomingText: low alphanumeric ratio ${ratio.toFixed(2)}, likely binary. length=${str.length}`);
      return '';
    }
  }

  return cleaned;
}

async function processBrevoAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  return Promise.all(attachments.map(async (att) => {
    try {
      if (att.content) {
        const buffer = Buffer.from(att.content, 'base64');
        const { fileId } = await uploadToTelegram(buffer, att.name || 'attachment', att.contentType || 'application/octet-stream');
        return {
          name: att.name || 'attachment',
          size: att.size || buffer.length,
          type: att.contentType || 'application/octet-stream',
          fileId,
          url: `/attachment/${fileId}`,
        };
      }
      return {
        name: att.name || 'attachment',
        size: att.size || 0,
        type: att.contentType || 'application/octet-stream',
        url: att.url || '',
      };
    } catch (error) {
      console.warn('Failed to process Brevo attachment:', att.name, error.message);
      return {
        name: att.name || 'attachment',
        size: att.size || 0,
        type: att.contentType || 'application/octet-stream',
        url: att.url || '',
      };
    }
  }));
}

app.options('/receive', (req, res) => {
  cors(req, res);
  res.status(204).end();
});

app.post('/receive', async (req, res) => {
  cors(req, res);
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendJson(res, 401, { error: 'Missing Authorization header' });
    }
    const token = authHeader.slice(7);
    const expectedToken = String(process.env.RECEIVE_TOKEN || '').trim();
    if (!expectedToken || token !== expectedToken) {
      return sendJson(res, 403, { error: 'Invalid token' });
    }

    const { from, to, cc, bcc, subject, text, html, attachments } = req.body;

    if (!from || !to) {
      return sendJson(res, 400, { error: 'Missing required fields: from, to' });
    }

    // Log incoming payload for debugging (truncated, no auth)
    const logText = String(text || '').slice(0, 200).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '?');
    const logHtml = String(html || '').slice(0, 200).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '?');
    console.log(`/receive from=${from} to=${to} subject="${String(subject || '').slice(0, 100)}" bodyLen=${String(text || '').length} htmlLen=${String(html || '').length} attCount=${Array.isArray(attachments) ? attachments.length : 0}`);
    console.log(`/receive body preview: ${JSON.stringify(logText)}`);

    const cleanText = sanitizeIncomingText(text || '');
    let cleanHtml = html || '';

    // Fallback: if text was discarded as binary but html exists, extract text from html
    if (!cleanText && cleanHtml) {
      console.log('/receive: body was binary, falling back to HTML-extracted text');
    }

    // Process Brevo-format attachments: upload base64 content to Telegram, store with fileId
    const processedAttachments = await processBrevoAttachments(attachments);
    if (processedAttachments.length) {
      console.log(`/receive: processed ${processedAttachments.length} attachments`);
    }

    await storeMailboxMessages({
      senderEmail: sanitizeEmail(from),
      fromName: from.split('@')[0] || 'Unknown',
      to: sanitizeEmail(to),
      cc: cc ? sanitizeEmail(cc) : '',
      bcc: bcc ? sanitizeEmail(bcc) : '',
      subject: subject || '(no subject)',
      text: cleanText,
      htmlContent: cleanHtml,
      attachments: processedAttachments,
      skipSpamCheck: false,
    });

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('/receive error:', error);
    return sendJson(res, 502, { error: error.message });
  }
});

app.get('/mail-app-clean.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'mail-app-clean.js'));
});

app.get('/templates.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'templates.js'));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get(/^\/[^/]+\.html$/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.use(
  express.static(__dirname, {
    dotfiles: 'ignore',
    extensions: ['html'],
  })
);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Render mail backend listening on port ${port}`);
});
