// server.js
// Express backend for PestureDrawing: Pinterest OAuth (PKCE) + proxy endpoints.



require('dotenv').config(); // optional (local dev)
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ==== Required env vars ====
const {
  PINTEREST_CLIENT_ID,
  PINTEREST_CLIENT_SECRET,
  PINTEREST_REDIRECT_URI,
  ALLOWED_ORIGINS // e.g. "https://pesturedrawing.com,https://<user>.github.io"
} = process.env;

// ---- CORS (GitHub Pages + custom domain) ----
const allowedOrigins = (ALLOWED_ORIGINS || 'https://pesturedrawing.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    // allow same-origin / server-to-server / curl
    if (!origin) return cb(null, true);
    const ok = allowedOrigins.some(o => origin === o || (o.startsWith('https://*.') && origin.endsWith(o.slice('https://*'.length))));
    cb(null, ok);
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// ---- Cookie helpers ----
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,         // must be true for SameSite=None
  sameSite: 'none',     // needed when frontend is on a different site (e.g., GitHub Pages)
  path: '/',
  maxAge: 5 * 60 * 1000 // 5 minutes
};

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function randomB64Url(n = 32) { return b64url(crypto.randomBytes(n)); }
function sha256B64Url(str) {
  const h = crypto.createHash('sha256').update(str).digest();
  return b64url(h);
}

// ================= OAuth: Start =================
// GET /api/auth/start  -> { url }
app.get('/api/auth/start', (req, res) => {
  try {
    if (!PINTEREST_CLIENT_ID || !PINTEREST_REDIRECT_URI) {
      return res.status(500).json({ error: 'Server not configured for OAuth' });
    }

    const state = randomB64Url(16);
    const codeVerifier = randomB64Url(64);
    const codeChallenge = sha256B64Url(codeVerifier);

    // Save short-lived verifier + state in HttpOnly cookies
    res.cookie('pd_state', state, COOKIE_OPTS);
    res.cookie('pd_verifier', codeVerifier, COOKIE_OPTS);

    // Pinterest OAuth authorize URL (v5)
    const scopes = ['user_accounts:read', 'boards:read', 'pins:read'].join(' ');
    const params = new URLSearchParams({
      client_id: PINTEREST_CLIENT_ID,
      redirect_uri: PINTEREST_REDIRECT_URI,
      response_type: 'code',
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const url = `https://www.pinterest.com/oauth/?${params.toString()}`;
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Failed to start auth' });
  }
});

// ================= OAuth: Exchange =================
// POST /api/auth/exchange  body: { code, state } -> { access_token, ... }
app.post('/api/auth/exchange', async (req, res) => {
  try {
    const { code, state } = req.body || {};
    const cookieState = req.cookies.pd_state;
    const verifier = req.cookies.pd_verifier;

    if (!code || !state) return res.status(400).json({ error: 'Missing code/state' });
    if (!cookieState || !verifier) return res.status(400).json({ error: 'Missing auth cookies' });
    if (state !== cookieState) return res.status(400).json({ error: 'Invalid state' });

    // Exchange code -> token (Pinterest v5)
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: PINTEREST_REDIRECT_URI,
      client_id: PINTEREST_CLIENT_ID,
      code_verifier: verifier
    });

    // If your app is confidential, include client_secret:
    if (PINTEREST_CLIENT_SECRET) form.set('client_secret', PINTEREST_CLIENT_SECRET);

    const tokenRes = await axios.post('https://api.pinterest.com/v5/oauth/token', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // Clear one-time cookies
    res.clearCookie('pd_state', { ...COOKIE_OPTS, maxAge: 0 });
    res.clearCookie('pd_verifier', { ...COOKIE_OPTS, maxAge: 0 });

    // Send token payload back to frontend (frontend stores access_token)
    res.json(tokenRes.data);
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({
      error: 'Token exchange failed',
      details: e.response?.data || e.message
    });
  }
});

// ================ Pinterest API Proxies =================
// Expect Authorization: Bearer <access_token> from the frontend.

function getBearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

// GET /api/boards
app.get('/api/boards', async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const r = await axios.get('https://api.pinterest.com/v5/boards?page_size=100', {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({
      error: 'Failed to fetch boards',
      details: e.response?.data || e.message
    });
  }
});

// GET /api/boards/:boardId/pins
app.get('/api/boards/:boardId/pins', async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { boardId } = req.params;
  try {
    const r = await axios.get(`https://api.pinterest.com/v5/boards/${encodeURIComponent(boardId)}/pins?page_size=100`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({
      error: 'Failed to fetch pins',
      details: e.response?.data || e.message
    });
  }
});

// Optional: healthcheck
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`PestureDrawing backend listening on :${PORT}`);
  if (!PINTEREST_CLIENT_ID || !PINTEREST_REDIRECT_URI) {
    console.warn('⚠️  Missing required env vars: PINTEREST_CLIENT_ID, PINTEREST_REDIRECT_URI');
  }
});
