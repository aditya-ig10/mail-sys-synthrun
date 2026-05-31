# Synthrun Mail

Synthrun Mail is now a compact Render-based mail app:

- the frontend is served as static HTML and JavaScript,
- Firebase handles auth, Firestore, and storage,
- `render-server.js` verifies Firebase ID tokens,
- `POST /send` sends mail through a pooled SMTP transport over TLS.

## Current layout

```text
login/index.html    Sign-in page
index.html          Main mailbox UI
mail-app-clean.js   Mail client logic
render-server.js    Render backend and send API
render.yaml         Render blueprint
package.json        Runtime dependencies and start script
firestore.rules     Firestore security rules
```

## What was removed

The repository no longer keeps the old Cloudflare, Vercel, and duplicate client files. The checked-in Firebase config file is also gone; the backend now serves `/firebase-config.js` dynamically from environment variables.

If you keep `mail.synthrun.site` on Vercel, the repo now includes [vercel.json](vercel.json) to proxy `/send`, `/firebase-config.js`, and `/health` to the Render backend at `https://mail-sys-synthrun.onrender.com`.

## Deploy on Render

1. Push this repo to GitHub.
2. Create a new Render Web Service from the repo or use the included `render.yaml`.
3. Set the build command to `npm install` and the start command to `npm start`.
4. Add the environment variables below.
5. Deploy.

## Deploy on Vercel

If you want `mail.synthrun.site` to stay on Vercel, deploy the static frontend there and keep the backend on Render.

1. Set the project root to this repo.
2. Leave the build settings as the default static deployment.
3. Ensure [vercel.json](vercel.json) stays in the repo so API requests proxy to Render.
4. Point the `mail.synthrun.site` DNS record to Vercel, not Render.
5. In Render, keep the backend live at its own URL and set `ALLOWED_ORIGIN=https://mail.synthrun.site`.

### Security & production checklist

- Do NOT commit `.env` or service account JSON files to the repository. Add `.env` to `.gitignore` and store secrets in the Render dashboard.
- In Render set `FIREBASE_SERVICE_ACCOUNT_JSON` (the entire JSON string), or set `FIREBASE_SERVICE_ACCOUNT_PATH` to a mounted secret file. Do not rely on checked-in files in production.
- If Render keeps rejecting the JSON, use `FIREBASE_SERVICE_ACCOUNT_JSON_B64` with a base64-encoded copy of the same service-account file.
- Add `BREVO_API_KEY` as a secret (preferred) to use the Brevo HTTP API for reliable delivery.
- Ensure `ALLOWED_BYPASS` is set to `0` (the server will refuse to start with `ALLOWED_BYPASS=1` in `NODE_ENV=production`).
- Rotate any API keys you exposed during testing and re-create them in the provider dashboard.
- Verify SPF/DKIM/DMARC for `synthrun.site` in your Brevo (or other provider) dashboard to improve deliverability.
- After deployment, run a production test and check `GET /health` and your Render logs for any runtime errors.

### Required environment variables

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- or `FIREBASE_SERVICE_ACCOUNT_PATH` for local testing with a mounted JSON file
- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_MEASUREMENT_ID` if you use Analytics
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`
- `SENDER_ADDRESS`
- `FROM_NAME`
- `ALLOWED_DOMAIN` defaults to `synthrun.site`
- `ALLOWED_ORIGIN` if the frontend is hosted elsewhere
- `ALLOWED_BYPASS` should stay `0` except for local debug testing

## SMTP provider recommendation

Use a provider that supports verified sending domains and TLS, such as Amazon SES, Mailgun, Brevo, or Postmark. The app uses Nodemailer pooling, so it avoids reconnecting on every send and is fast enough for normal mailbox workflows.

For Brevo, keep one shared gateway and let each signed-in mailbox send as its own Synthrun address, such as `support@synthrun.site` or `hello@synthrun.site`. The server now uses the authenticated Synthrun mailbox as the `From` address and derives the display name from the mailbox local part.

Set `FROM_NAME_TEMPLATE={name} from {email}` to render headers like `Aditya from aditya@synthrun.site`.

## Local run

```bash
npm install
npm start
```

For local testing, the server will also auto-load `synthrun-site-firebase-adminsdk-fbsvc-75da2cfca3.json` from the repo root when `NODE_ENV` is not `production`.

Then open the app through the Render service or locally and test `POST /send`. The backend also exposes:

- `GET /health`
- `GET /firebase-config.js`

## Mail flow

1. A signed-in Firebase user composes a message in `index.html`.
2. The browser sends the Firebase ID token to `POST /send`.
3. `render-server.js` verifies the token and sends mail through SMTP over TLS.
4. The UI saves the sent copy into Firestore.

## Firestore rules

Use the rules in `firestore.rules` to keep each mailbox isolated by `recipientEmail` and the authenticated Firebase user.

The server now stores recipient inbox copies for internal `@synthrun.site` recipients, so messages sent from `devansh@synthrun.site` render with the real mailbox in the app instead of a Brevo bounce alias.
