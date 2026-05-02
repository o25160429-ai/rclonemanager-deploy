const { ONEDRIVE_OAUTH_SCOPE, assertOAuthClientSecret, sanitizeOAuthConfig } = require('../utils/oauthClients');

async function postForm(url, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const detail = data.error_description || data.error || response.statusText;
    throw new Error(`Token exchange failed: ${detail}`);
  }
  return data;
}

async function exchangeOAuthCode(cfg, code) {
  cfg = sanitizeOAuthConfig(cfg);
  assertOAuthClientSecret(cfg);

  if (cfg.provider === 'gd') {
    return postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret || '',
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    });
  }

  const params = {
    code,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    scope: ONEDRIVE_OAUTH_SCOPE,
  };
  if (cfg.clientSecret) params.client_secret = cfg.clientSecret;

  return postForm('https://login.microsoftonline.com/common/oauth2/v2.0/token', params);
}

module.exports = {
  exchangeOAuthCode,
};
