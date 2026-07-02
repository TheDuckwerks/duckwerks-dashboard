const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '../data/ebay-tokens.json');
const TOKEN_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const AUTH_URL   = 'https://auth.ebay.com/oauth2/authorize';
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.reputation',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
].join(' ');

function clientCredentials() {
  const id     = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set');
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); }
  catch { return null; }
}

function writeTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

async function refreshAccessToken(refreshToken) {
  // Do NOT send `scope` in the refresh body — eBay rejects it.
  // Refreshed token inherits scopes from the original grant.
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${clientCredentials()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token refresh failed: ${text}`);
  }
  return res.json();
}

async function getAccessToken() {
  const tokens = readTokens();
  if (!tokens) throw new Error('eBay not authorized. Visit /api/ebay/auth to set up.');

  const expiresAt = tokens.expires_at || 0;
  if (Date.now() < expiresAt - 60_000) {
    return tokens.access_token; // Still valid with 1-minute buffer
  }

  // Refresh — refresh_token itself stays the same across refreshes
  const fresh = await refreshAccessToken(tokens.refresh_token);
  const updated = {
    ...tokens,
    access_token: fresh.access_token,
    expires_at:   Date.now() + fresh.expires_in * 1000,
  };
  writeTokens(updated);
  return updated.access_token;
}

function authRedirectUrl() {
  const params = new URLSearchParams({
    client_id:     process.env.EBAY_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  process.env.EBAY_RUNAME,
    scope:         SCOPES,
    state:         'duckwerks',
  });
  return `${AUTH_URL}?${params}`;
}

async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${clientCredentials()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: process.env.EBAY_RUNAME,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token exchange failed: ${text}`);
  }
  return res.json();
}

// ── App token (client credentials) — for Browse API, no user auth needed ─────
const BROWSE_SCOPE = 'https://api.ebay.com/oauth/api_scope';
let _appToken = null; // { token, expires_at }

async function getAppToken() {
  if (_appToken && Date.now() < _appToken.expires_at - 60_000) {
    return _appToken.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${clientCredentials()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope:      BROWSE_SCOPE,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay app token failed: ${text}`);
  }
  const data = await res.json();
  _appToken = { token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return _appToken.token;
}

module.exports = { getAccessToken, getAppToken, authRedirectUrl, exchangeCodeForTokens, readTokens, writeTokens };
