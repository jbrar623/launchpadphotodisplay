# IIE Launchpad Pitch Competition 2026 Photo Display

## URL's for viewing

Main page: https://launchpadphotodisplay-production.up.railway.app

Uploading page: https://launchpadphotodisplay-production.up.railway.app/upload 

## Start Here! 

This web app was designed for the 2026 Launchpad Pitch competition, held by the Institute for Innovation and Entrepreneurship at MRU. This was created by me (Joban Brar), as an intern for the IIE, inspired by the work of Matthew Hrehirchuk and Taylor Amy, for a similar display used at MRUHacks! This webapp was deployed using Railway. 

# Deployement

Railway is a hosting platform that puts Node.js servers on the internet without little infrastructure management. To use Railway you can connect the repository, which Railway reads and detects as Node.js and provides you with a public and live URL you can use. 

For this project Railway was useful as the display pages is a real URL that can be used on any browser to present the images on a screen, and the upload pages is a real public URL that can work on any attendees phone regardless of their network or wifi connection. For this context of this short term project a free trial was used, generally railway is $5/month, and there are many alternatives for deployment. 

## Setup

### 1. Google Cloud

- Enable the **Google Drive API** in [Google Cloud Console](https://console.cloud.google.com)
- Create an **API key** and restrict it to Drive API only. This is for *reading* photos.
- Create a **Service account**, this is for *uploading* photos.
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

Drop `iie-logo.svg` (or any relevant logo) into the project folder, then:
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
   Railway sets `SERVICE_ACCOUNT_JSON` as the raw JSON string, so on Railway we parse it directly instead of reading a file.

5. Go to **Settings → Networking → Generate Domain**: Railway gives you a URL like `https://iie-display.up.railway.app`

6. Every time you `git push` to your repo, Railway automatically updates and redeploys.

### 4. On the day

1. Open `https://your-app.up.railway.app` on the projector laptop → press `F11` for fullscreen
2. The QR code on screen already points to `https://your-app.up.railway.app/upload`
3. Attendees scan → upload page opens on their phone → no Google account needed

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

## Controls

| Key | Action |
|-----|--------|
| `F11` | Fullscreen |
| `F` | Toggle fullscreen |
| `→` / `Space` | Next slide |
| `←` | Previous slide |


## Further reading
- [Deploying Node.js on Railway](https://docs.railway.com/guides/express)
- [Google Drive API docs](https://developers.google.com/drive/api/reference/rest/v3)
