# How To Run Synthrun Mail

This repo now runs best as a single Node server. That server serves the app, exposes `/send`, and can be deployed to Render.

## Recommended local run

1. Install dependencies.

```bash
npm install
```

2. Start the mail server.

```bash
npm start
```

If you want to use the downloaded Firebase service-account file directly for local testing, set:

```bash
export FIREBASE_SERVICE_ACCOUNT_PATH="$PWD/synthrun-site-firebase-adminsdk-fbsvc-75da2cfca3.json"
```

3. Open the app in your browser.

```text
http://localhost:3000/
```

## What the server does

`render-server.js` does all of these things:

- serves the static mail app files,
- serves `/firebase-config.js` from environment variables,
- handles `POST /send`,
- verifies Firebase sign-in tokens unless debug bypass is enabled,
- sends mail through Brevo's HTTP API when `BREVO_API_KEY` is set, otherwise uses SMTP over TLS.

## Local test mode

If you want to test mail sending without Firebase auth and without a real SMTP provider, use debug mode.

1. Start the server on a free port.

```bash
PORT=3001 ALLOWED_BYPASS=1 SMTP_HOST=127.0.0.1 SMTP_PORT=1025 npm start
```

If the service-account file is present in the repo root, the server will use it automatically in non-production mode.

2. Point the app at that endpoint.

```js
localStorage.setItem('synthrun-send-endpoint', 'http://localhost:3001/send')
localStorage.setItem('synthrun-debug-user', 'aditya@synthrun.site')
location.reload()
```

3. Use the Compose button in the mail UI and send a test message.

## Why `python -m http.server 8000` failed

`python -m http.server` only serves static files. It cannot handle `POST /send`, so the browser gets `501 Unsupported method ('POST')`.

If you only want to serve the HTML files with Python, that is fine for viewing pages, but sending mail still requires the Node server.

## Production deploy on Render

1. Push the repo to GitHub.
2. Create a Render Web Service.
3. Use these commands:

```bash
npm install
npm start
```

4. Set the required environment variables in Render:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- or `FIREBASE_SERVICE_ACCOUNT_PATH` if you mount the file yourself
- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`
- `SENDER_ADDRESS`
- `FROM_NAME`
- `ALLOWED_DOMAIN`
- `BREVO_API_KEY` if you want to bypass SMTP IP restrictions

## Quick check

After startup, these URLs should work:

```text
http://localhost:3000/health
http://localhost:3000/firebase-config.js
```

If `/health` works but mail send fails, the usual cause is missing SMTP settings or a missing `BREVO_API_KEY` when SMTP is blocked.
