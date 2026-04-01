// IIE Photo Display — local server
// Run: node server.js
// Then open: http://localhost:3000  (display)
//            http://localhost:3000/upload  (upload page, QR code points here)

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const config = require('./display.config.js');

// ── Load environment variables ───────────────────────────────────────
// Locally: reads from .env file.
// On Railway: variables are injected directly into process.env — no file needed.
const env = {};
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split('\n')
    .forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      env[key.trim()] = rest.join('=').trim();
    });
} catch {
  // No .env file — running on Railway or another platform that injects env vars directly.
  // Fall through and read from process.env below.
}

// Merge process.env so Railway-injected variables are always available
// process.env takes precedence over .env file values
Object.keys(process.env).forEach(k => {
  if (process.env[k]) env[k] = process.env[k];
});

const REQUIRED = ['GOOGLE_API_KEY', 'DRIVE_FOLDER_ID', 'DRIVE_FOLDER_URL'];
REQUIRED.forEach(k => {
  if (!env[k] || env[k].startsWith('your_')) {
    console.error(`❌  Missing value for ${k} in .env`);
    process.exit(1);
  }
});

// Service account credentials: either inline JSON (Railway) or file path (local)
if (!process.env.SERVICE_ACCOUNT_JSON && (!env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH.startsWith('your_'))) {
  console.error('❌  Missing service account credentials. Set SERVICE_ACCOUNT_JSON (Railway) or GOOGLE_SERVICE_ACCOUNT_KEY_PATH (local) in .env');
  process.exit(1);
}

const API_KEY   = env.GOOGLE_API_KEY;
const FOLDER_ID = env.DRIVE_FOLDER_ID;

// ── Load service account key ─────────────────────────────────────────
// On Railway: paste the JSON contents into the SERVICE_ACCOUNT_JSON env var.
// Locally:    point GOOGLE_SERVICE_ACCOUNT_KEY_PATH to the downloaded JSON file.
let serviceAccount;
try {
  if (process.env.SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
  } else {
    serviceAccount = JSON.parse(fs.readFileSync(path.resolve(env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH), 'utf8'));
  }
} catch {
  console.error(`❌  Could not load service account credentials.`);
  console.error(`    Locally: set GOOGLE_SERVICE_ACCOUNT_KEY_PATH in .env`);
  console.error(`    Railway: set SERVICE_ACCOUNT_JSON env variable`);
  process.exit(1);
}

// ── JWT / OAuth2 for service account uploads ─────────────────────────
// We need a short-lived access token to write to Drive.
// This is done by signing a JWT with the service account private key
// and exchanging it for an access token — no external packages needed.
const crypto = require('crypto');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJwt(payload, privateKey) {
  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body    = base64url(Buffer.from(JSON.stringify(payload)));
  const signing = `${header}.${body}`;
  const sig     = base64url(crypto.sign('sha256', Buffer.from(signing), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }));
  return `${signing}.${sig}`;
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Cache the access token — they last 1 hour, refresh when close to expiry
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }, serviceAccount.private_key);

  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res  = await httpsPost('oauth2.googleapis.com', '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body);

  const parsed = JSON.parse(res.body);
  if (!parsed.access_token) throw new Error(`Token error: ${res.body}`);

  cachedToken = parsed.access_token;
  tokenExpiry = Date.now() + (parsed.expires_in * 1000);
  return cachedToken;
}

// ── Upload a buffer to Google Drive ──────────────────────────────────
async function uploadToDrive(filename, mimeType, buffer) {
  const token = await getAccessToken();

  // Step 1: initiate resumable upload session
  const metadata = JSON.stringify({ name: filename, parents: [FOLDER_ID] });
  const initRes  = await httpsPost(
    'www.googleapis.com',
    `/upload/drive/v3/files?uploadType=resumable`,
    {
      'Authorization':   `Bearer ${token}`,
      'Content-Type':    'application/json; charset=UTF-8',
      'X-Upload-Content-Type':   mimeType,
      'X-Upload-Content-Length': buffer.length,
    },
    metadata
  );

  if (initRes.status !== 200) throw new Error(`Drive initiate failed: ${initRes.body}`);
  const uploadUrl = initRes.headers.location;
  if (!uploadUrl) throw new Error('No upload URL returned from Drive');

  // Step 2: upload the actual bytes to the session URL
  const uploadUri = new URL(uploadUrl);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: uploadUri.hostname,
      path:     uploadUri.pathname + uploadUri.search,
      method:   'PUT',
      headers:  {
        'Content-Type':   mimeType,
        'Content-Length': buffer.length,
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) resolve(JSON.parse(raw));
        else reject(new Error(`Drive upload failed (${res.statusCode}): ${raw}`));
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

// ── Parse multipart/form-data (no external packages) ─────────────────
function parseMultipart(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) throw new Error('No boundary in content-type');
  const boundary = '--' + boundaryMatch[1];
  const parts    = [];
  const lines    = body.toString('binary').split('\r\n');
  let current    = null;
  let inBody     = false;
  let bodyLines  = [];

  for (const line of lines) {
    if (line.startsWith(boundary)) {
      if (current && bodyLines.length) {
        current.data = Buffer.from(bodyLines.join('\r\n'), 'binary');
        parts.push(current);
      }
      current  = { headers: {}, data: null };
      inBody   = false;
      bodyLines = [];
    } else if (!inBody && line === '') {
      inBody = true;
    } else if (!inBody && current) {
      const [k, ...v] = line.split(': ');
      if (k) current.headers[k.toLowerCase()] = v.join(': ');
    } else if (inBody) {
      bodyLines.push(line);
    }
  }

  return parts.filter(p => p.data).map(p => {
    const disp    = p.headers['content-disposition'] || '';
    const nameM   = disp.match(/name="([^"]+)"/);
    const fileM   = disp.match(/filename="([^"]+)"/);
    return {
      name:     nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : '',
      mime:     p.headers['content-type'] || 'application/octet-stream',
      data:     p.data,
    };
  });
}

// ── /api/upload ───────────────────────────────────────────────────────
async function handleUpload(req, res) {
  console.log('📥  Upload request received');
  const MAX_BYTES = config.upload.maxFileSizeMB * 1024 * 1024;

  // Collect request body
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BYTES + 65536) { // a little headroom for form fields
      req.destroy();
    } else {
      chunks.push(chunk);
    }
  });

  req.on('end', async () => {
    try {
      const body  = Buffer.concat(chunks);
      const ctype = req.headers['content-type'] || '';
      const parts = parseMultipart(body, ctype);
      const file  = parts.find(p => p.filename);

      if (!file) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No file found in upload' }));
        return;
      }

      // Validate type
      if (!config.upload.allowedTypes.includes(file.mime)) {
        res.writeHead(415, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `File type not allowed: ${file.mime}` }));
        return;
      }

      // Validate size
      if (file.data.length > MAX_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `File too large. Max ${config.upload.maxFileSizeMB}MB.` }));
        return;
      }

      // Sanitise filename and make it unique
      const ext      = path.extname(file.filename).toLowerCase() || '.jpg';
      const safeName = `photo_${Date.now()}${ext}`;

      console.log(`📤  Uploading to Drive: ${safeName} (${file.mime}, ${(file.data.length/1024).toFixed(0)}KB)`);
      await uploadToDrive(safeName, file.mime, file.data);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      console.log(`📸  Uploaded: ${safeName} (${(file.data.length / 1024).toFixed(0)}KB)`);

    } catch(e) {
      console.error('Upload error:', e.message);
      console.error('Stack:', e.stack);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upload failed. Please try again.' }));
    }
  });
}

// ── Helper: HTTPS GET → parsed JSON ──────────────────────────────────
function driveGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('Invalid JSON from Drive API')); }
      });
    }).on('error', reject);
  });
}

// ── /api/photos ───────────────────────────────────────────────────────
async function handlePhotos(res) {
  const IMAGE_TYPES = config.upload.allowedTypes.map(m => `mimeType='${m}'`).join(' or ');
  const q      = encodeURIComponent(`'${FOLDER_ID}' in parents and (${IMAGE_TYPES}) and trashed=false`);
  const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime)');
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=100&orderBy=modifiedTime%20desc&key=${API_KEY}`;

  try {
    const data = await driveGet(listUrl);
    if (data.error) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: data.error.message }));
      return;
    }
    const files = (data.files || []).map(f => ({
      id:   f.id,
      name: f.name,
      url:  `/api/image?id=${encodeURIComponent(f.id)}`,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(files));
  } catch(e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ── /api/image?id=... ─────────────────────────────────────────────────
function handleImage(req, res) {
  const idMatch = req.url.match(/[?&]id=([^&]+)/);
  if (!idMatch) { res.writeHead(400); res.end('Missing id'); return; }
  const fileId   = decodeURIComponent(idMatch[1]);
  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${API_KEY}`;
  https.get(driveUrl, driveRes => {
    const headers = { 'Cache-Control': 'public, max-age=300' };
    if (driveRes.headers['content-type'])   headers['Content-Type']   = driveRes.headers['content-type'];
    if (driveRes.headers['content-length']) headers['Content-Length'] = driveRes.headers['content-length'];
    res.writeHead(driveRes.statusCode, headers);
    driveRes.pipe(res);
  }).on('error', () => { res.writeHead(502); res.end('Image fetch failed'); });
}

// ── Determine public base URL ─────────────────────────────────────────
// Railway injects RAILWAY_PUBLIC_DOMAIN (e.g. "iie-display.up.railway.app")
// We also check RAILWAY_STATIC_URL as a fallback.
// Locally, fall back to LAN IP so phones on the same wifi can reach /upload.
function getBaseUrl() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN
    || process.env.RAILWAY_STATIC_URL
    || env.RAILWAY_PUBLIC_DOMAIN;

  if (railwayDomain) {
    // Strip any protocol prefix if already included
    const clean = railwayDomain.replace(/^https?:\/\//, '');
    return `https://${clean}`;
  }

  // Local fallback — LAN IP for same-network phone access
  const { networkInterfaces } = require('os');
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return `http://${iface.address}:${PORT}`;
    }
  }
  return `http://localhost:${PORT}`;
}

// ── Config injected into index.html ──────────────────────────────────
// Built as a function so getBaseUrl() uses the correct PORT value.
function buildClientConfig() {
  return JSON.stringify({
    driveUrl:     env.DRIVE_FOLDER_URL,
    uploadUrl:    `${getBaseUrl()}/upload`,
    rotationRate: config.photowall.rotationRate,
    refreshRate:  config.photowall.refreshRate,
    qrHeading:    config.display.qrHeading,
    qrSubtext:    config.display.qrSubtext,
  });
}

// ── Static file server ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

const PORT = parseInt(env.PORT || '3000', 10);

http.createServer(async (req, res) => {
  // CORS headers so phones on the same wifi can POST to /api/upload
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = req.url.split('?')[0];

  if (urlPath === '/api/photos' && req.method === 'GET')  { await handlePhotos(res); return; }
  if (urlPath === '/api/image'  && req.method === 'GET')  { handleImage(req, res);   return; }
  if (urlPath === '/api/upload' && req.method === 'POST') { await handleUpload(req, res); return; }

  // Block sensitive files
  if (['/server.js', '/.env', '/service-account-key.json'].includes(urlPath)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // Route /upload to upload.html
  const staticPath = urlPath === '/'        ? '/index.html'
                   : urlPath === '/upload'  ? '/upload.html'
                   : urlPath;

  const filePath = path.join(__dirname, staticPath);
  const ext      = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }

    if (staticPath === '/index.html') {
      const html = data.toString().replace('/*%%CONFIG%%*/', `const DISPLAY_CONFIG = ${buildClientConfig()};`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (staticPath === '/upload.html') {
      try {
        const uploadCfg = JSON.stringify({
          maxFileSizeMB: config.upload.maxFileSizeMB,
          allowedTypes:  config.upload.allowedTypes,
          pageTitle:     config.upload.pageTitle,
          pageSubtitle:  config.upload.pageSubtitle,
        });
        const html = data.toString().replace('/*%%UPLOAD_CONFIG%%*/', `const UPLOAD_CONFIG = ${uploadCfg};`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch(e) {
        console.error('❌  Failed to serve upload.html:', e.message);
        console.error('    config.upload value:', JSON.stringify(config.upload));
        res.writeHead(500); res.end('Server error serving upload page');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });

}).listen(PORT, () => {
  const base = getBaseUrl();
  console.log(`\n✅  IIE Photo Display`);
  console.log(`    Display  → ${base}`);
  console.log(`    Upload   → ${base}/upload  ← QR code points here`);
  console.log(`    Rotation : ${config.photowall.rotationRate / 1000}s per slide`);
  console.log(`    Refresh  : every ${config.photowall.refreshRate / 1000}s`);
  console.log(`    RAILWAY_PUBLIC_DOMAIN: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'not set'}`);
  console.log(`\n    Press Ctrl+C to stop.\n`);
});