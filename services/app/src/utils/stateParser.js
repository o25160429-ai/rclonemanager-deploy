const { sanitizeOAuthConfig } = require('./oauthClients');

function decodeBase64Utf8(value) {
  return Buffer.from(String(value), 'base64').toString('utf8');
}

function decodeEmail(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (raw.includes('@')) return raw;
  try {
    return decodeURIComponent(escape(decodeBase64Utf8(raw)));
  } catch (_err) {
    return decodeBase64Utf8(raw);
  }
}

function parseStateParam(state) {
  if (!state) {
    const err = new Error('Missing OAuth state parameter.');
    err.status = 400;
    throw err;
  }

  let payload;
  try {
    payload = JSON.parse(decodeBase64Utf8(state));
  } catch (_err) {
    const err = new Error('Invalid OAuth state parameter.');
    err.status = 400;
    throw err;
  }

  const emailOwnerValue = payload.emailOwner || payload.email_owner || '';
  const required = ['clientId', 'provider', 'redirectUri', 'nonce'];
  const missing = required.filter((key) => !payload[key]);
  if (missing.length > 0) {
    const err = new Error(`OAuth state is missing: ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }

  if (!['gd', 'od'].includes(payload.provider)) {
    const err = new Error('Unsupported OAuth provider in state.');
    err.status = 400;
    throw err;
  }

  if (!/^[a-z0-9_-]{8,}$/i.test(String(payload.nonce))) {
    const err = new Error('Invalid OAuth state nonce.');
    err.status = 400;
    throw err;
  }

  return sanitizeOAuthConfig({
    clientId: String(payload.clientId),
    clientSecret: payload.clientSecret ? String(payload.clientSecret) : '',
    presetId: payload.presetId ? String(payload.presetId) : '',
    presetLabel: payload.presetLabel ? String(payload.presetLabel) : '',
    emailOwner: decodeEmail(emailOwnerValue),
    provider: payload.provider,
    remoteName: String(payload.remoteName || ''),
    scope: payload.scope || 'drive',
    driveType: payload.driveType || 'personal',
    redirectUri: String(payload.redirectUri),
    nonce: String(payload.nonce),
  });
}

module.exports = {
  parseStateParam,
};
