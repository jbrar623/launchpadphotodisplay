# IIE Photo Display

## What is Railway?

Railway is a hosting platform that puts your Node.js server on the internet without you having to manage any infrastructure. You connect your GitHub repo, Railway detects it's a Node.js app, and gives you a live public URL automatically. No servers to configure, no SSL certificates to set up, no terminal commands beyond `git push`.

For this project that means:
- The **display page** is a real URL you open in any browser — no `node server.js` needed on the day
- The **upload page** is a real public URL that works on any phone on any network — no wifi restrictions
- Environment variables (API keys, secrets) are stored securely in Railway's dashboard, not in any file

**Pricing:** Railway gives you a 30-day free trial with $5 in credits. After that the Hobby plan is $5/month — but since this server is mostly idle between events, actual usage will likely stay well under that. See [railway.com/pricing](https://railway.com/pricing) for details.

---

## Setup

### 1. Google Cloud

- Enable the **Google Drive API** in [Google Cloud Console](https://console.cloud.google.com)
- Create an **API key** — restrict it to Drive API only. This is for *reading* photos.
- Create a **Service account** — this is for *uploading* photos.
  - Go to the **Keys** tab → Add Key → Create new key → JSON → Download
  - Rename the downloaded file to `service-account-key.json` and put it in this folder
  - Share your Drive folder with the service account's `client_email` address as **Editor**

### 2. Local development (optional, for testing before deploying)

Fill in `.env`:
```
GOOGLE_API_KEY=...
DRIVE_FOLDER_ID=...
DRIVE_FOLDER_URL=...
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json
```

Drop `iie-logo.png` into the project folder, then:
```
node server.js
```

Open `http://localhost:3000` for the display, `http://localhost:3000/upload` for the upload page.

### 3. Deploy to Railway

1. Push this project to a **private** GitHub repository
   - Make sure `.gitignore` is committed — it keeps `.env` and `service-account-key.json` out of git
   - `service-account-key.json` must NOT be committed. Set its contents as an env variable instead (see step 3d below)

2. Go to [railway.com](https://railway.com) → sign up with GitHub → **New Project** → **Deploy from GitHub repo** → select your repo

3. In the Railway dashboard for your project, go to **Variables** and add:
   ```
   GOOGLE_API_KEY         = your api key
   DRIVE_FOLDER_ID        = your folder id
   DRIVE_FOLDER_URL       = https://drive.google.com/drive/folders/...
   SERVICE_ACCOUNT_JSON   = (paste the entire contents of service-account-key.json here)
   ```
   Note: instead of a file path, we paste the JSON contents directly as an env variable when deployed.

4. Update `server.js` to handle the inline JSON by changing the service account loading line:
   Railway sets `SERVICE_ACCOUNT_JSON` as the raw JSON string, so on Railway we parse it directly instead of reading a file. This is already handled in the code — it checks `process.env.SERVICE_ACCOUNT_JSON` first, then falls back to the file path for local development.

5. Go to **Settings → Networking → Generate Domain** — Railway gives you a URL like `https://iie-display.up.railway.app`

6. Every time you `git push` to your repo, Railway automatically redeploys. No manual steps.

### 4. On the day

1. Open `https://your-app.up.railway.app` on the projector laptop → press `F11` for fullscreen
2. The QR code on screen already points to `https://your-app.up.railway.app/upload`
3. Students scan → upload page opens on their phone → no Google account, no wifi switching needed

---

## Folder structure

```
iie-display/
├── index.html                # Display page (projector)
├── upload.html               # Mobile upload page (QR code points here)
├── server.js                 # Node server
├── display.config.js         # All display settings — edit freely
├── package.json              # Tells Railway how to run the app
├── .env                      # Local secrets only — never commit
├── .gitignore                # Keeps secrets out of git
├── service-account-key.json  # Local only — never commit (use env var on Railway)
├── iie-logo.png              # Your logo
└── README.md
```

---

## Configuration (`display.config.js`)

| Setting | What it does |
|---|---|
| `photowall.rotationRate` | How long each photo is shown (ms) |
| `photowall.refreshRate` | How often Drive is polled for new uploads (ms) |
| `upload.maxFileSizeMB` | Max file size per upload |
| `upload.allowedTypes` | Accepted image MIME types |
| `upload.pageTitle` | Title on the upload page |
| `upload.pageSubtitle` | Subtitle on the upload page |
| `display.qrHeading` | Heading on the QR card |
| `display.qrSubtext` | Subtext on the QR card |

---

## Controls

| Key | Action |
|-----|--------|
| `F11` | Fullscreen |
| `F` | Toggle fullscreen |
| `→` / `Space` | Next slide |
| `←` | Previous slide |

---

## Further reading

- [Railway docs](https://docs.railway.com)
- [Deploying Node.js on Railway](https://docs.railway.com/guides/express)
- [Railway pricing](https://railway.com/pricing)
- [Google Drive API docs](https://developers.google.com/drive/api/reference/rest/v3)