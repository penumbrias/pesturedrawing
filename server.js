// server.js
// Express backend for PestureDrawing: Pinterest OAuth (PKCE) + proxy endpoints.

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();
app.use(cookieParser());

const {
  PINTEREST_CLIENT_ID,
  PINTEREST_CLIENT_SECRET,
  PINTEREST_REDIRECT_URI,
  ALLOWED_ORIGINS
} = process.env;

const allowedOrigins = (ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

function setAuthCookie(res, token) {
  res.cookie('pd_pin_token', token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/'
  });
}
function getAuthToken(req) {
  return req.cookies?.pd_pin_token || '';
}

// 1) Status
app.get('/api/auth/status', async (req, res) => {
  const token = getAuthToken(req);
  if (!token) return res.json({ authorized: false });
  // optional: look up current user
  try {
    const me = await axios.get('https://api.pinterest.com/v5/user_account', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.json({ authorized: true, user: me.data?.username || me.data?.id || null });
  } catch {
    return res.json({ authorized: false });
  }
});

// 2) Start login (regular OAuth2 code flow)
app.get('/api/auth/login', (req, res) => {
  const scopes = [
  'user_accounts:read',
  'boards:read',
  'pins:read',
].join(' ');
  const state = Buffer.from(JSON.stringify({
    next: req.query.next || ''
  })).toString('base64url');

  const authUrl = new URL('https://www.pinterest.com/oauth/');
  authUrl.searchParams.set('client_id', PINTEREST_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', PINTEREST_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  res.redirect(authUrl.toString());
});

// 3) Callback: exchange code for token
app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    const form = new URLSearchParams({
  grant_type: 'authorization_code',
  code,
  redirect_uri: PINTEREST_REDIRECT_URI,
  client_id: PINTEREST_CLIENT_ID,
  client_secret: PINTEREST_CLIENT_SECRET
});
const tokenRes = await axios.post('https://api.pinterest.com/v5/oauth/token', form, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
});

    const access = tokenRes.data?.access_token;
    if (!access) return res.status(400).send('No access token');

    setAuthCookie(res, access);

    let next = '/';
    if (state) {
      try { next = JSON.parse(Buffer.from(state, 'base64url').toString()).next || '/'; } catch {}
    }
    // bounce back to the app
    res.redirect(next);
  } catch (err) {
    console.error('OAuth token exchange failed', err?.response?.data || err.message);
    res.status(500).send('OAuth failed');
  }
});

// 4) Log out
app.get('/api/auth/logout', (req, res) => {
  res.clearCookie('pd_pin_token', { path: '/', secure: true, sameSite: 'none' });
  res.json({ ok: true });
});



// Get public/authorized boards for a user
app.get('/api/pinterest/users/:username/boards', async (req, res) => {
  const token = getAuthToken(req);
  const { username } = req.params;
  try {
    const r = await axios.get(`https://api.pinterest.com/v5/users/${encodeURIComponent(username)}/boards`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    // Normalize a little for the frontend
    const boards = (r.data?.items || []).map(b => ({
      id: b.id || b.board_id,
      name: b.name || b.title || b.id
    }));
    res.json({ boards });
  } catch (e) {
    console.error('Boards error', e?.response?.data || e.message);
    res.status(e?.response?.status || 500).json({ error: 'Failed to fetch boards' });
  }
});

// Get pins for a board
app.get('/api/pinterest/boards/:boardId/pins', async (req, res) => {
  const token = getAuthToken(req);
  const { boardId } = req.params;
  try {
    const r = await axios.get(`https://api.pinterest.com/v5/boards/${encodeURIComponent(boardId)}/pins`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const pins = (r.data?.items || []).map(p => ({
      image_url: p?.media?.images?.orig?.url || p?.link || p?.id
    })).filter(x => !!x.image_url);
    res.json({ pins });
  } catch (e) {
    console.error('Pins error', e?.response?.data || e.message);
    res.status(e?.response?.status || 500).json({ error: 'Failed to fetch pins' });
  }
});

