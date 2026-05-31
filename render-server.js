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

const app = express();
app.use(express.json({ limit: '15mb' }));

function initFirebase() {
  if (admin.apps && admin.apps.length) return;

  const localServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(
    __dirname,
    'synthrun-site-firebase-adminsdk-fbsvc-75da2cfca3.json'
  );

  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64) {
    raw = Buffer.from(String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64).trim(), 'base64').toString('utf8');
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

async function sendViaBrevoApi({ senderAddress, fromName, userEmail, to, cc, subject, text, htmlContent, attachments }) {
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

  if (Array.isArray(attachments) && attachments.length) {
    payload.attachment = attachments.map((attachment) => ({
      name: attachment.name || 'attachment',
      url: attachment.url,
    }));
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

async function storeMailboxMessages({ senderEmail, fromName, to, cc, subject, text, htmlContent, attachments }) {
  const recipients = [...new Set([to, cc].map(sanitizeEmail).filter(Boolean).filter(isInternalMailbox))];
  if (!recipients.length) {
    return;
  }

  const db = admin.firestore();
  const payload = {
    folder: 'inbox',
    from: senderEmail,
    fromName,
    senderEmail,
    subject: String(subject),
    body: String(text),
    htmlBody: String(htmlContent || ''),
    attachments: Array.isArray(attachments) ? attachments : [],
    unread: true,
    flagged: false,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await Promise.all(
    recipients.map((recipientEmail) => db.collection('mail').add({ ...payload, recipientEmail }))
  );
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attachmentsToMailOptions(attachments = []) {
  return attachments.map((attachment) => ({
    filename: attachment.name || 'attachment',
    path: attachment.url,
    contentType: attachment.type || undefined,
    knownLength: attachment.size || undefined,
  }));
}

app.options('/send', (req, res) => {
  cors(req, res);
  res.status(204).end();
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

    const { to, cc, subject, body: text, htmlBody, attachments = [] } = req.body || {};
    if (!to || !subject || !text) {
      return sendJson(res, 400, { error: 'Missing required fields: to, subject, body' });
    }

    const senderAddress = userEmail;
    const fromName = formatFromName(userEmail);

    const recipients = [sanitizeEmail(to)];
    if (cc) recipients.push(sanitizeEmail(cc));
    const htmlContent = htmlBody || `<div style="font-family:monospace;font-size:14px;color:#111;white-space:pre-wrap;max-width:640px;margin:0 auto;padding:24px;">${htmlEscape(text)}</div>`;

    const brevoApiKey = getBrevoApiKey();
    let info;
    if (brevoApiKey) {
      info = await sendViaBrevoApi({
        senderAddress,
        fromName,
        userEmail,
        to,
        cc,
        subject,
        text,
        htmlContent,
        attachments: Array.isArray(attachments) ? attachments : [],
      });
    } else {
      const transporter = createTransport();
      info = await transporter.sendMail({
        from: `"${fromName}" <${senderAddress}>`,
        replyTo: userEmail,
        to: sanitizeEmail(to),
        ...(cc ? { cc: sanitizeEmail(cc) } : {}),
        subject: String(subject),
        text: String(text),
        html: htmlContent,
        attachments: attachmentsToMailOptions(Array.isArray(attachments) ? attachments : []),
        envelope: {
          from: senderAddress,
          to: recipients,
        },
      });
    }

    try {
      await storeMailboxMessages({
        senderEmail: senderAddress,
        fromName,
        to,
        cc,
        subject,
        text,
        htmlContent,
        attachments: Array.isArray(attachments) ? attachments : [],
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

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(
  express.static(__dirname, {
    dotfiles: 'ignore',
    extensions: ['html'],
  })
);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Render mail backend listening on port ${port}`);
});
