# ReachDesk

Email and WhatsApp campaign manager. Import leads from Excel, CSV or Google Sheets, write one message with personal fields, preview it for every contact, and send in safe, spaced batches.

## Quick start

```bash
npm install
npm run demo     # safe mode: emails and WhatsApp messages are not really delivered
```

Open http://localhost:3000, create an account with the invite code `demo`, and import `sample-leads.xlsx` to try it.

When you are ready to send for real:

```bash
copy .env.example .env      # Windows  (macOS/Linux: cp .env.example .env)
npm start
```

Requires Node.js 18.17 or newer. `npm run dev` restarts the server when you edit code. Data is kept in a built-in Postgres in `data/pglite` unless you set `DATABASE_URL` (for example to a Neon database).

## Features

**Contacts**
- Import `.xlsx`, `.xls`, `.csv`, or a Google Sheet link (all tabs are read, you pick one)
- Visual column mapping with auto-detection of name, email and phone columns
- Every other column becomes a placeholder: `Business Name` becomes `{business_name}`
- Removes duplicates and rows with no email or phone; picks the first valid email in cells like `a@x.com, b@y.com`
- Normalizes phone numbers for WhatsApp (`0300 1234567` becomes `923001234567` with country code 92)
- Search, paginate, rename and delete lists

**Messages**
- Template library for email and WhatsApp (5 starter templates included)
- `{field}`, `{field|fallback}` and spintax `[[Hi|Hello|Hey]]`
- Live preview shaped like a real inbox or WhatsApp chat, stepping through real rows
- Warnings for placeholders that are empty in some rows
- Attachments (up to 5 files, 4 MB in total), HTML plus plain-text versions
- Unsubscribe footer with one-click `List-Unsubscribe` headers (Gmail and Yahoo bulk-sender rules)

**Sending**
- Send a test first, using the first contact's data
- Batch size, fixed delay and random extra delay between messages
- Skips anyone already reached on that channel in earlier campaigns
- Pause, resume, cancel, "send next batch" and "retry failed"
- Sending runs from the open campaign page with a live countdown, so it works on serverless hosts like Vercel; closing the page pauses it
- Stops the run on a login error instead of failing every contact
- Download results as Excel: your original columns plus status, sent time, subject and error

**WhatsApp, three ways**

| Mode | Setup | How it sends |
|---|---|---|
| Click-to-chat links | None | Opens WhatsApp with the message filled in; you press send; the row is marked sent |
| Cloud API, template | Meta business app | Automatic. Required for first contact. Map placeholders to `{{1}}`, `{{2}}` |
| Cloud API, free text | Meta business app | Automatic, only to people who messaged you in the last 24 hours |

**Safety**
- Do-not-contact list, filled automatically by unsubscribe links and applied to every campaign
- Sender passwords and tokens are never written to the server. They travel only with each send request. "Remember on this device" keeps them in the browser.
- Personal accounts: each person signs up with email, password and an invite code (`SIGNUP_CODE`), and sees only their own lists, templates, campaigns, history and do-not-contact list
- Passwords are stored as scrypt hashes; sessions last 30 days; repeated failed sign-ins are slowed down
- The first account created receives any data saved before accounts existed

## Gmail setup

1. Turn on 2-Step Verification for the Google account.
2. Create an App Password at https://myaccount.google.com/apppasswords.
3. In ReachDesk open **Settings**, enter the Gmail address and the 16-character App Password, then choose **Check connection**.

A personal Gmail account can send roughly 500 messages a day (Google Workspace allows more). For a new account, keep batches small and delays at 8 seconds or more.

## WhatsApp Cloud API setup

1. Create an app at https://developers.facebook.com and add the WhatsApp product.
2. Under WhatsApp → API Setup, copy the **Phone number ID** and a token. For production, create a permanent System User token in Business Settings.
3. Create a message template in WhatsApp Manager and wait for approval (needed to message people first).
4. Enter the values in **Settings** and choose **Check connection**.

This app uses only the official API or manual click-to-chat. Unofficial WhatsApp Web automation breaks WhatsApp's terms and gets numbers banned.

## Configuration

All settings are optional and live in `.env` (see `.env.example`).

| Variable | Purpose |
|---|---|
| `PORT` | Server port, default 3000 |
| `PUBLIC_URL` | Your public address, used in unsubscribe links |
| `SIGNUP_CODE` | Invite code required to create an account. Empty turns sign-up off |
| `SMTP_*` | Default email sender, used when Settings fields are blank |
| `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_API_VERSION` | Default WhatsApp sender |
| `MAIL_TRANSPORT=json` | Process emails without delivering them |
| `WA_DRY_RUN=1` | Fake WhatsApp sends |
| `DATABASE_URL` | Postgres connection string (Neon). Empty uses the built-in database in `data/pglite` |
| `DATA_FILE` | Old JSON data file copied into the database once on first start, default `data/db.json` |

## Project structure

```
app.js                Express app (Vercel runs this file as one function)
server/
  index.js            Local server: opens the database and listens on PORT
  demo.js             Starts the app in safe demo mode
  lib/db.js           Postgres: Neon via DATABASE_URL, or embedded PGlite locally
  lib/store.js        Campaign and template persistence
  lib/importer.js     Excel, CSV and Google Sheets parsing; results export
  lib/template.js     Placeholders, fallbacks, spintax, HTML conversion
  lib/phone.js        Phone and email normalization
  lib/providers.js    SMTP and WhatsApp Cloud API
  lib/compose.js      Builds each personalized message
  lib/sender.js       Sends one message per request, with pacing and a send lock
  lib/auth.js         Accounts, sessions and signed unsubscribe links
  routes/             REST API
public/
  index.html, css/app.css
  js/app.js           Router
  js/views/           Overview, contacts, templates, composer, campaigns, settings
```

## API summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/imports/file` | Upload a spreadsheet (multipart field `file`) |
| POST | `/api/imports/sheet` | Read a Google Sheet `{ url }` |
| POST | `/api/imports/:id/commit` | Save rows with a column mapping |
| GET | `/api/lists`, `/api/lists/:id/contacts` | Lists and contacts |
| GET/POST/PUT/DELETE | `/api/templates` | Templates |
| POST | `/api/campaigns/preview` | Audience counts and missing placeholders |
| POST | `/api/campaigns/test` | Send one test |
| POST | `/api/campaigns` | Create a campaign and start the first batch |
| POST | `/api/campaigns/:id/run`, `pause`, `resume`, `cancel`, `retry-failed` | Control sending |
| POST | `/api/campaigns/:id/send-next` | Send the next message (called by the open campaign page) |
| GET | `/api/campaigns/:id/export` | Results as `.xlsx` |
| GET/POST/DELETE | `/api/suppression` | Do-not-contact list |

## Deploying on Vercel with Neon

1. Create a project at https://neon.tech and copy its connection string (the pooled one, ending in `?sslmode=require`).
2. In Vercel, import the GitHub repository. Vercel detects the Express app in `app.js`; no build settings are needed.
3. In Vercel, open Settings → Environment Variables and add `DATABASE_URL` (the Neon string), `SIGNUP_CODE`, and `PUBLIC_URL` (your site address, for example `https://reachdesk.vercel.app`).
4. Deploy, open the site and create your account.

Tables are created automatically on the first request. To move data you already have into Neon, set `DATABASE_URL` in `.env` to the Neon string and run `npm start` once before anyone signs up: `data/db.json` is copied in, and the first account created receives it.

Sending runs from the open campaign page: each request sends one message, then the page waits the delay before asking for the next. Keep the campaign page open while it sends; closing it pauses sending until the page is opened again. Attachments are limited to 4 MB in total because Vercel caps request size.

### Other hosts

ReachDesk also runs as a normal Node server on a VPS, Render, Railway or Fly.io. Set `DATABASE_URL` there too, or keep `data/` on a persistent disk for the built-in database.

```bash
docker build -t reachdesk .
docker run -p 3000:3000 -v reachdesk-data:/app/data --env-file .env reachdesk
```

Before going public, set `PUBLIC_URL` to your domain so unsubscribe links work, and set a long, random `SIGNUP_CODE`. Create your own account first: the first account receives any data saved before accounts existed.

## Scaling later

Postgres handles large contact lists. If sending must continue with every browser closed, run ReachDesk on an always-on host and call `sendNext` from `server/lib/sender.js` on a timer, or move sending to a queue such as BullMQ with Redis.
