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

async function uploadToTelegram(fileBuffer, fileName, mimeType, caption) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
  }

  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2, 12);
  let parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT_ID}`,
  ];
  if (caption) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`);
  }
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const header = Buffer.from(parts.join('\r\n'), 'utf-8');
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

function buildAutoReplyHtml(message) {
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<div style="background:#f2f1ee;padding:32px 12px;font-family:'Courier New',Courier,monospace;">
  <div style="max-width:560px;margin:0 auto;background:#fafaf8;border:1px solid #e0dfd9;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:#111110;padding:0 28px;height:48px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;">
                <span style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#fafaf8;font-weight:400;">Synthrun</span>
              </td>
              <td style="vertical-align:middle;text-align:right;"></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:10px 28px;border-bottom:1px solid #e0dfd9;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td><span style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:0.12em;text-transform:uppercase;color:#888884;">&#9679; Message received</span></td>
              <td style="text-align:right;"><span style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#888884;">Response within 24 hrs</span></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:36px 28px 28px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:400;font-style:italic;color:#111110;line-height:1.15;letter-spacing:-0.02em;margin-bottom:20px;">
            <span style="font-style:normal;">Got it.</span><br><em>We'll be in touch.</em>
          </div>
          <p style="font-family:'Courier New',monospace;font-size:11px;line-height:1.85;color:#3a3a38;margin-bottom:14px;">${esc(message)}</p>
          <p style="font-family:'Courier New',monospace;font-size:11px;line-height:1.85;color:#3a3a38;margin-bottom:0;">In the meantime, feel free to look around at what we've shipped at <a href="https://synthrun.site" style="color:#111110;">synthrun.site</a> &mdash; services, process, and the stack we work with.</p>
          <div style="border-top:1px solid #e0dfd9;margin-top:24px;padding-top:20px;">
            <span style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:#888884;display:block;margin-bottom:12px;">What happens next</span>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
              <tr><td style="font-family:'Courier New',monospace;font-size:8px;color:#c4c4be;vertical-align:top;padding-top:2px;width:26px;">01</td><td style="font-family:'Courier New',monospace;font-size:10px;color:#3a3a38;line-height:1.7;">We read your message carefully &mdash; not a template response.</td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
              <tr><td style="font-family:'Courier New',monospace;font-size:8px;color:#c4c4be;vertical-align:top;padding-top:2px;width:26px;">02</td><td style="font-family:'Courier New',monospace;font-size:10px;color:#3a3a38;line-height:1.7;">We'll reply with relevant questions or a proposed next step.</td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="font-family:'Courier New',monospace;font-size:8px;color:#c4c4be;vertical-align:top;padding-top:2px;width:26px;">03</td><td style="font-family:'Courier New',monospace;font-size:10px;color:#3a3a38;line-height:1.7;">If it's a fit, we scope the project &mdash; no retainers before we've earned them.</td></tr>
            </table>
          </div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:0 28px 24px;">
          <a href="https://synthrun.site" style="display:inline-block;background:#111110;color:#fafaf8;text-decoration:none;font-family:'Courier New',monospace;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;padding:11px 20px;">Visit Synthrun &rarr;</a>
          <div style="margin-top:10px;font-family:'Courier New',monospace;font-size:9px;color:#888884;">Or reply to <a href="mailto:hello@synthrun.site" style="color:#888884;">hello@synthrun.site</a></div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:12px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td><span style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:#888884;">Synthrun</span></td>
              <td style="text-align:right;"><span style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:0.07em;text-transform:uppercase;color:#c4c4be;">&copy; 2026 Synthrun &middot; India &middot; US &amp; UK</span></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
</div>`;
}

async function sendAutoReplies({ fromEmail, fromName, subject, text, html, recipients }) {
  const db = admin.firestore();
  const autoReplyCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days

  for (const recipientEmail of recipients) {
    try {
      // Look up user settings by email
      const settingsSnap = await db.collection('user_settings').where('email', '==', recipientEmail).limit(1).get();
      if (settingsSnap.empty) continue;
      const uid = settingsSnap.docs[0].id;
      const settings = settingsSnap.docs[0].data();
      const ar = settings.autoReply;
      if (!ar || !ar.enabled || !ar.message) continue;

      // Check date range
      const now = new Date();
      if (ar.startDate && new Date(ar.startDate + 'T00:00:00') > now) continue;
      if (ar.endDate && new Date(ar.endDate + 'T23:59:59') < now) continue;

      // Check if already replied to this sender recently
      const repliedRef = db.collection('user_settings').doc(uid).collection('autoReplied').doc(fromEmail.replace(/[^a-zA-Z0-9]/g, '_'));
      const repliedSnap = await repliedRef.get();
      if (repliedSnap.exists) {
        const repliedAt = repliedSnap.data().repliedAt?.toDate?.() || new Date(repliedSnap.data().repliedAt);
        if (repliedAt > autoReplyCutoff) continue;
      }

      // Send the auto-reply
      const replySubject = ar.subject || `Re: ${subject || ''}`;
      const replyText = `${ar.message}\n\n---\nOn ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}, ${fromName || fromEmail} wrote:\n\n${text || '(no text)'}`;
      const replyHtml = buildAutoReplyHtml(ar.message);

      const brevoApiKey = getBrevoApiKey();
      const senderAddress = recipientEmail;
      const senderName = formatSenderName(recipientEmail);

      if (brevoApiKey) {
        await sendViaBrevoApi({
          senderAddress,
          fromName: senderName,
          userEmail: recipientEmail,
          to: fromEmail,
          subject: replySubject,
          text: replyText,
          htmlContent: replyHtml,
        });
      } else {
        const transporter = createTransport();
        await transporter.sendMail({
          from: `"${senderName}" <${senderAddress}>`,
          replyTo: recipientEmail,
          to: fromEmail,
          subject: replySubject,
          text: replyText,
          html: replyHtml,
        });
      }

      // Track that we replied
      await repliedRef.set({ repliedAt: admin.firestore.FieldValue.serverTimestamp(), to: fromEmail });
    } catch (err) {
      console.error(`sendAutoReplies: failed for ${recipientEmail}:`, err.message);
    }
  }
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

async function authenticateFull(req) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) throw new Error('Missing Authorization header');
  initFirebase();
  return admin.auth().verifyIdToken(idToken);
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

function parseEmailAddress(raw) {
  const str = String(raw || '').trim();
  const angleMatch = str.match(/<([^>]+)>/);
  const email = angleMatch ? sanitizeEmail(angleMatch[1]) : str.includes('@') ? sanitizeEmail(str) : '';
  let name = '';
  if (angleMatch) {
    name = str.slice(0, angleMatch.index).replace(/^["'\s]+|["'\s]+$/g, '');
  }
  return { name, email };
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
    return [];
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

  const ids = await Promise.all(
    recipients.map(async (recipientEmail) => {
      const snap = await db.collection('mail')
        .where('recipientEmail', '==', recipientEmail)
        .where('senderEmail', '==', sanitizeEmail(senderEmail))
        .where('subject', '==', String(subject))
        .limit(1)
        .get();

      if (snap.empty) {
        const ref = await db.collection('mail').add({ ...payload, recipientEmail });
        return ref.id;
      }
      return null;
    })
  );
  return ids.filter(Boolean);
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHtmlEmail(bodyHtml, { fromName, subject, to, userEmail }) {
  const date = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;padding:32px 12px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#111110;height:48px;">
<tr><td style="padding:0 28px;vertical-align:middle;">
<span style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#fafaf8;font-weight:500;">Synthrun Mail</span>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:28px 28px 8px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="font-size:12px;color:#888884;letter-spacing:0.04em;padding-bottom:4px;">From: ${htmlEscape(fromName)}</td>
</tr>
<tr>
<td style="font-size:12px;color:#888884;letter-spacing:0.04em;padding-bottom:4px;">To: ${htmlEscape(to)}</td>
</tr>
<tr>
<td style="font-size:12px;color:#888884;letter-spacing:0.04em;padding-bottom:4px;">Date: ${htmlEscape(date)}</td>
</tr>
<tr>
<td style="font-size:12px;color:#888884;letter-spacing:0.04em;">Subject: ${htmlEscape(subject)}</td>
</tr>
</table>
</td></tr>
<tr><td style="border-top:1px solid #e8e8e6;margin:0 28px;height:0;"></td></tr>
<tr><td style="padding:24px 28px 28px;font-size:15px;line-height:1.7;color:#222220;">
${bodyHtml}
</td></tr>
<tr><td style="border-top:1px solid #e8e8e6;height:0;"></td></tr>
<tr><td style="padding:16px 28px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#aaa;--darkreader-inline-color:#a09e9d;">Synthrun Mail</td>
<td style="text-align:right;font-size:10px;letter-spacing:0.06em;color:#ccc;">${htmlEscape(userEmail)}</td>
</tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
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
    const fileName = String(req.query.name || 'attachment').replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${fileName}"`);
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

const AUTH_PREFIX = (process.env.AUTH_PATH_PREFIX || '').replace(/^\/+|\/+$/g, '');

app.get('/firebase-config.js', (_req, res) => {
  try {
    const firebaseConfig = buildFirebaseConfig();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`
export const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 2)};
export const AUTH_BASE = ${JSON.stringify(AUTH_PREFIX)};
`);
  } catch (error) {
    res.status(error.statusCode || 500).setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(`throw new Error(${JSON.stringify(error.message)});`);
  }
});

// Auth path guard — block direct /login/ and /reset-password/ when prefix is set
if (AUTH_PREFIX) {
  const authPaths = ['/login', '/login/', '/login/index.html', '/reset-password', '/reset-password/', '/reset-password/index.html'];
  authPaths.forEach((p) => {
    app.get(p, (_req, res) => res.status(404).send('Not found'));
  });
}

app.post('/send', async (req, res) => {
  cors(req, res);

  try {
    const userEmail = await authenticate(req);
    const allowedDomain = process.env.ALLOWED_DOMAIN || 'synthrun.site';
    if (!userEmail.endsWith(`@${allowedDomain}`)) {
      return sendJson(res, 403, { error: 'Sender not authorised' });
    }

    const { to, cc, bcc, subject, body: text, htmlBody, attachments = [], fromName: customFromName } = req.body || {};
    const fallbackText = String(text || '').trim() || htmlToText(htmlBody);
    if (!to || !subject || (!fallbackText && !htmlBody)) {
      return sendJson(res, 400, { error: 'Missing required fields: to, subject, body' });
    }

    const senderAddress = userEmail;
    const fromName = customFromName || formatFromName(userEmail);

    const recipients = [sanitizeEmail(to)];
    if (cc) recipients.push(sanitizeEmail(cc));
    if (bcc) recipients.push(sanitizeEmail(bcc));
    const rawHtml = htmlBody || htmlEscape(fallbackText);
    const htmlContent = wrapHtmlEmail(rawHtml, { fromName, subject, to, userEmail });

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

  // Count C1 control characters (0x80-0x9F) — only discard if high ratio,
  // since charset-encoded text (ISO-8859-1, Windows-1252) legitimately contains these.
  let c1Count = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x00) return '';
    if (code >= 0x80 && code <= 0x9F) c1Count++;
  }
  if (str.length > 0 && c1Count / str.length > 0.3) {
    console.warn(`sanitizeIncomingText: high C1 control-char ratio ${(c1Count / str.length).toFixed(2)}, discarding. length=${str.length}`);
    return '';
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

async function downloadBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
}

async function processBrevoAttachments(attachments = [], caption) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  console.log(`/receive: processing ${attachments.length} attachments`);
  attachments.forEach((att, i) => {
    const ctype = pick(att, 'contentType', 'Content-Type', 'type', 'mimeType', 'mime') || '?';
    console.log(`/receive att[${i}]: keys=${JSON.stringify(Object.keys(att))}`, JSON.stringify({
      name: pick(att, 'name', 'filename', 'fileName'),
      size: att.size,
      contentType: ctype,
      disposition: att.disposition,
      contentID: att.contentID,
    }));
    // Log full attachment raw data (value types, not values) for debugging
    const summary = {};
    for (const k of Object.keys(att)) {
      const v = att[k];
      summary[k] = v === null ? 'null' : v === undefined ? 'undefined' : typeof v + '(' + String(v).slice(0, 40) + ')';
    }
    console.log(`/receive att[${i}] raw:`, JSON.stringify(summary));
  });

  return Promise.all(attachments.map(async (att) => {
    try {
      const name = pick(att, 'name', 'filename', 'fileName') || 'attachment';
      const contentType = pick(att, 'contentType', 'Content-Type', 'type', 'mimeType', 'mime') || 'application/octet-stream';
      const keys = Object.keys(att);
      let buffer;

      const rawContent = String(pick(att, 'content', 'data', 'base64', 'body') || '').trim();
      const rawUrl = pick(att, 'url', 'link', 'downloadUrl', 'href') || '';
      const downloadToken = pick(att, 'DownloadToken', 'downloadToken', 'token', 'attachmentToken') || '';
      const brevoApiKey = getBrevoApiKey();

      if (rawContent) {
        const stripped = rawContent.replace(/\s/g, '');
        if (/^https?:\/\//i.test(stripped)) {
          console.log(`/receive: content looks like URL for "${name}", downloading...`);
          buffer = await downloadBuffer(stripped);
        } else if (/^[A-Za-z0-9+/=]+$/.test(stripped) && stripped.length > 20) {
          buffer = Buffer.from(stripped, 'base64');
          console.log(`/receive: decoded base64 content for "${name}": ${buffer.length} bytes`);
        } else {
          buffer = Buffer.from(rawContent, 'utf-8');
          console.log(`/receive: using raw utf-8 content for "${name}": ${buffer.length} bytes`);
        }
      } else if (rawUrl) {
        console.log(`/receive: downloading from url for "${name}": ${rawUrl.slice(0, 100)}`);
        buffer = await downloadBuffer(rawUrl);
      } else if (downloadToken && brevoApiKey) {
        const brevoUrl = `https://api.brevo.com/v3/inbound/attachments/${downloadToken}`;
        console.log(`/receive: downloading via Brevo API for "${name}" (token=${downloadToken.slice(0, 20)}...)`);
        const resp = await fetch(brevoUrl, { headers: { 'api-key': brevoApiKey } });
        if (resp.ok) {
          buffer = Buffer.from(await resp.arrayBuffer());
        } else {
          console.warn(`/receive: Brevo API download failed for "${name}": ${resp.status}`);
        }
      } else {
        // Fallback: scan ALL keys for any value that looks like base64 content
        for (const k of keys) {
          const v = att[k];
          if (v && typeof v === 'string' && v.length > 50 && /^[A-Za-z0-9+/=\s]+$/.test(v) && v.length % 4 < 2) {
            console.log(`/receive: found base64-like content in key "${k}" for "${name}"`);
            buffer = Buffer.from(v.replace(/\s/g, ''), 'base64');
            break;
          }
        }
        if (!buffer) {
          console.warn(`/receive: no content/url/token for "${name}" — keys=${JSON.stringify(keys)}`);
          return {
            name, size: att.size || 0, type: contentType,
            content: rawContent || undefined,
            url: rawUrl || undefined,
          };
        }
      }

      if (!buffer || buffer.length === 0) {
        console.warn(`/receive: empty buffer for "${name}" — storing raw`);
        return {
          name, size: att.size || 0, type: contentType,
          content: rawContent || undefined,
          url: rawUrl || undefined,
        };
      }

      const { fileId } = await uploadToTelegram(buffer, name, contentType, caption);
      console.log(`/receive: uploaded "${name}" to Telegram, fileId=${fileId}`);
      return {
        name,
        size: att.size || buffer.length,
        type: contentType,
        fileId,
        url: `/attachment/${fileId}`,
      };
    } catch (error) {
      console.warn(`/receive: failed to process attachment "${pick(att, 'name', 'filename', 'fileName') || '?'}":`, error.message);
      const rawContent = String(pick(att, 'content', 'data', 'base64', 'body') || '');
      const rawUrl = pick(att, 'url', 'link', 'downloadUrl', 'href') || '';
      return {
        name: pick(att, 'name', 'filename', 'fileName') || 'attachment',
        size: att.size || 0,
        type: pick(att, 'contentType', 'Content-Type', 'type', 'mimeType', 'mime') || 'application/octet-stream',
        content: rawContent || undefined,
        url: rawUrl || undefined,
      };
    }
  }));
}

app.post('/telegram-forward', async (req, res) => {
  cors(req, res);
  try {
    const { name, type, content, caption } = req.body || {};
    if (!name || !content) {
      return sendJson(res, 400, { error: 'Missing name or content (base64)' });
    }

    const buffer = Buffer.from(String(content).replace(/\s/g, ''), 'base64');
    if (!buffer.length) {
      return sendJson(res, 400, { error: 'Empty content after base64 decode' });
    }

    const { fileId } = await uploadToTelegram(buffer, name, type || 'application/octet-stream', caption || '');
    return sendJson(res, 200, { ok: true, fileId });
  } catch (error) {
    console.error('/telegram-forward error:', error);
    return sendJson(res, 502, { error: error.message });
  }
});

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

    // 1. Store message immediately with lightweight attachment metadata (name/size/type only).
    //    This ensures the message shows up in inbox even if Telegram uploads are slow.
    const rawAttachments = Array.isArray(attachments) ? attachments : [];
    const parsedFrom = parseEmailAddress(from);
    const docIds = await storeMailboxMessages({
      senderEmail: parsedFrom.email || sanitizeEmail(from),
      fromName: parsedFrom.name,
      to: sanitizeEmail(to),
      cc: cc ? sanitizeEmail(cc) : '',
      bcc: bcc ? sanitizeEmail(bcc) : '',
      subject: subject || '(no subject)',
      text: cleanText,
      htmlContent: cleanHtml,
      attachments: rawAttachments.map((a) => ({ name: a.name || 'attachment', size: a.size || 0, type: a.contentType || a.type || 'application/octet-stream' })),
      skipSpamCheck: false,
    });

    // 2. Respond to Brevo immediately — the webhook can timeout while we upload.
    res.status(200).json({ ok: true });

    // 3. Auto-reply (background) — for internal recipients who have auto-reply enabled
    if (docIds.length) {
      const allRecipients = [...new Set([to, cc, bcc].map(sanitizeEmail).filter(Boolean).filter(isInternalMailbox))];
      if (allRecipients.length && parsedFrom.email) {
        sendAutoReplies({ fromEmail: parsedFrom.email, fromName: parsedFrom.name, subject, text: cleanText, html: cleanHtml, recipients: allRecipients }).catch((err) => {
          console.error('/receive: auto-reply error:', err);
        });
      }
    }

    // 4. Process attachments (Telegram upload) in the background and patch docs.
    if (docIds.length && rawAttachments.length) {
      const caption = `📧 From: ${fromName || from}  Subject: ${subject || '(no subject)'}`;
      processBrevoAttachments(rawAttachments, caption).then((processed) => {
        const db = admin.firestore();
        return Promise.all(docIds.map((id) =>
          db.collection('mail').doc(id).update({ attachments: processed })
        ));
      }).then(() => {
        console.log(`/receive: patched ${docIds.length} docs with processed attachments`);
      }).catch((err) => {
        console.error('/receive: background attachment processing failed:', err);
      });
    }
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

app.post('/send-custom-reset', async (req, res) => {
  cors(req, res);
  try {
    const { email } = req.body || {};
    if (!email) return sendJson(res, 400, { error: 'Missing email' });

    const sanitizedEmail = sanitizeEmail(email);
    let userRecord;
    try {
      initFirebase();
      userRecord = await admin.auth().getUserByEmail(sanitizedEmail);
    } catch {
      return sendJson(res, 200, { ok: true });
    }

    const resetLink = await admin.auth().generatePasswordResetLink(sanitizedEmail);

    let backupEmail = '';
    try {
      const fdb = admin.firestore();
      const settingsSnap = await fdb.collection('user_settings').doc(userRecord.uid).get();
      if (settingsSnap.exists) {
        backupEmail = settingsSnap.data().backupEmail || '';
      }
    } catch { /* ignore */ }

    const recipients = [sanitizedEmail];
    if (backupEmail) recipients.push(sanitizeEmail(backupEmail));

    const safeLink = htmlEscape(resetLink);
    const htmlTemplate = `
      <div style="font-family:'DM Mono',monospace;max-width:480px;margin:0 auto;padding:24px;color:#111110;">
        <div style="border:1px solid #e0dfd9;padding:32px;background:#fafaf8;">
          <p style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#888884;margin-bottom:24px;">Synthrun Mail — Password Reset</p>
          <h1 style="font-family:'Fraunces',serif;font-weight:300;font-size:24px;letter-spacing:-0.02em;margin:0 0 16px;">Reset your password</h1>
          <p style="font-size:13px;line-height:1.7;color:#3a3a38;margin-bottom:20px;">Click the button below to reset your Synthrun Mail password. This link expires in 1 hour.</p>
          <a href="${safeLink}" style="display:inline-block;padding:12px 24px;background:#111110;color:#fafaf8;text-decoration:none;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">Reset password</a>
          <p style="font-size:11px;color:#888884;margin-top:20px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      </div>`;

    const plainText = `Reset your Synthrun Mail password: ${resetLink}\n\nIf you didn't request this, ignore this email.`;

    const brevoApiKey = getBrevoApiKey();
    const uniqueRecipients = [...new Set(recipients)];

    for (const to of uniqueRecipients) {
      if (brevoApiKey) {
        await sendViaBrevoApi({
          senderAddress: process.env.FROM_EMAIL || 'mail@synthrun.site',
          fromName: process.env.FROM_NAME || 'Synthrun Mail',
          userEmail: process.env.FROM_EMAIL || 'mail@synthrun.site',
          to,
          subject: 'Reset your Synthrun Mail password',
          text: plainText,
          htmlContent: htmlTemplate,
          attachments: [],
        });
      } else {
        const transporter = createTransport();
        await transporter.sendMail({
          from: `"${process.env.FROM_NAME || 'Synthrun Mail'}" <${process.env.FROM_EMAIL || 'mail@synthrun.site'}>`,
          to,
          subject: 'Reset your Synthrun Mail password',
          text: plainText,
          html: htmlTemplate,
        });
      }
    }

    return sendJson(res, 200, { ok: true });
  } catch {
    return sendJson(res, 200, { ok: true });
  }
});

app.options('/send-backup-code', (req, res) => { cors(req, res); res.status(204).end(); });

app.post('/send-backup-code', async (req, res) => {
  cors(req, res);
  try {
    const decoded = await authenticateFull(req);
    const { backupEmail } = req.body || {};
    if (!backupEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(backupEmail)) {
      return sendJson(res, 400, { error: 'Invalid email' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const fdb = admin.firestore();
    await fdb.collection('user_settings').doc(decoded.uid).set({
      pendingBackup: { code, email: sanitizeEmail(backupEmail), expiresAt: admin.firestore.FieldValue.serverTimestamp() },
    }, { merge: true });

    const brevoApiKey = getBrevoApiKey();
    const to = sanitizeEmail(backupEmail);
    const subject = 'Your Synthrun Mail verification code';
    const text = `Your verification code is: ${code}\n\nEnter this code on the Synthrun Mail settings page to verify your backup email.\n\nThis code expires in 10 minutes.`;
    const html = `<div style="font-family:'DM Mono',monospace;max-width:480px;margin:0 auto;padding:24px;"><div style="border:1px solid #e0dfd9;padding:32px;background:#fafaf8;"><p style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#888884;margin-bottom:24px;">Synthrun Mail — Email Verification</p><p style="font-size:13px;color:#3a3a38;margin-bottom:16px;">Your verification code is:</p><p style="font-family:'Fraunces',serif;font-size:36px;font-weight:300;letter-spacing:0.08em;color:#111110;margin:0 0 20px;">${htmlEscape(code)}</p><p style="font-size:11px;color:#888884;">Enter this code on the settings page. It expires in 10 minutes.</p></div></div>`;

    if (brevoApiKey) {
      await sendViaBrevoApi({
        senderAddress: process.env.FROM_EMAIL || 'mail@synthrun.site',
        fromName: process.env.FROM_NAME || 'Synthrun Mail',
        userEmail: process.env.FROM_EMAIL || 'mail@synthrun.site',
        to,
        subject,
        text,
        htmlContent: html,
        attachments: [],
      });
    } else {
      const transporter = createTransport();
      await transporter.sendMail({
        from: `"${process.env.FROM_NAME || 'Synthrun Mail'}" <${process.env.FROM_EMAIL || 'mail@synthrun.site'}>`,
        to,
        subject,
        text,
        html,
      });
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, err.message === 'Missing Authorization header' ? 401 : 400, { error: err.message });
  }
});

app.options('/verify-backup-code', (req, res) => { cors(req, res); res.status(204).end(); });

app.post('/verify-backup-code', async (req, res) => {
  cors(req, res);
  try {
    const decoded = await authenticateFull(req);
    const { code } = req.body || {};
    if (!code) return sendJson(res, 400, { error: 'Missing code' });

    const fdb = admin.firestore();
    const settingsSnap = await fdb.collection('user_settings').doc(decoded.uid).get();

    // Special code "remove" — delete backup email without verification
    if (code === 'remove') {
      await fdb.collection('user_settings').doc(decoded.uid).set({
        backupEmail: '',
        pendingBackup: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return sendJson(res, 200, { ok: true, email: '' });
    }

    if (!settingsSnap.exists) return sendJson(res, 400, { error: 'No pending verification' });

    const data = settingsSnap.data();
    const pending = data.pendingBackup;
    if (!pending) return sendJson(res, 400, { error: 'No pending verification' });

    if (pending.code !== code) return sendJson(res, 400, { error: 'Invalid code' });

    const email = pending.email;
    await fdb.collection('user_settings').doc(decoded.uid).set({
      backupEmail: email,
      pendingBackup: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return sendJson(res, 200, { ok: true, email });
  } catch (err) {
    return sendJson(res, err.message === 'Missing Authorization header' ? 401 : 400, { error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Auth-prefixed routes (when AUTH_PATH_PREFIX is set)
if (AUTH_PREFIX) {
  const prefix = '/' + AUTH_PREFIX;
  app.get(prefix + '/login', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'login', 'index.html'));
  });
  app.get(prefix + '/reset', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'reset-password', 'index.html'));
  });
  app.get(prefix + '/settings', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'profile.html'));
  });
}

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
