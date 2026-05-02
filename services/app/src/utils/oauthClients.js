const RCLONE_GDRIVE_CLIENT_ID = '202264815644.apps.googleusercontent.com';
const RCLONE_GDRIVE_CLIENT_SECRET = 'X4Z3ca8xfWDb1Voo-F9a7ZxJ';
const RCLONE_ONEDRIVE_CLIENT_ID = 'b15665d9-eda6-4092-8539-0eec376afd59';
const RCLONE_ONEDRIVE_CLIENT_SECRET = 'qtyfaBBYA403=unZUP40~_#';
const ONEDRIVE_OAUTH_SCOPE = 'https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read offline_access';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizedClientId(value) {
  return String(value || '').trim().toLowerCase();
}

function isRcloneOneDriveClient(cfg) {
  return cfg?.provider === 'od'
    && normalizedClientId(cfg.clientId) === RCLONE_ONEDRIVE_CLIENT_ID;
}

function isRcloneGDriveClient(cfg) {
  return cfg?.provider === 'gd'
    && normalizedClientId(cfg.clientId) === RCLONE_GDRIVE_CLIENT_ID;
}

function isRcloneGDrivePublicClient(cfg) {
  return isRcloneGDriveClient(cfg);
}

function isRcloneOneDrivePublicClient(cfg) {
  return isRcloneOneDriveClient(cfg);
}

function looksLikeAzureSecretId(value) {
  return GUID_RE.test(String(value || '').trim());
}

function sanitizeOAuthConfig(cfg) {
  if (!cfg) return cfg;
  if (isRcloneGDriveClient(cfg)) {
    return {
      ...cfg,
      clientSecret: RCLONE_GDRIVE_CLIENT_SECRET,
    };
  }
  if (isRcloneOneDriveClient(cfg)) {
    return {
      ...cfg,
      clientSecret: RCLONE_ONEDRIVE_CLIENT_SECRET,
    };
  }
  return cfg;
}

function assertOAuthClientSecret(cfg) {
  if (!cfg?.clientSecret) return;
  if (looksLikeAzureSecretId(cfg.clientSecret)) {
    const err = new Error('Client Secret looks like an Azure Secret ID. Copy the secret Value from Azure Certificates & secrets, not the Secret ID.');
    err.status = 400;
    throw err;
  }
}

module.exports = {
  RCLONE_GDRIVE_CLIENT_ID,
  RCLONE_GDRIVE_CLIENT_SECRET,
  RCLONE_ONEDRIVE_CLIENT_ID,
  RCLONE_ONEDRIVE_CLIENT_SECRET,
  ONEDRIVE_OAUTH_SCOPE,
  isRcloneGDriveClient,
  isRcloneGDrivePublicClient,
  isRcloneOneDriveClient,
  isRcloneOneDrivePublicClient,
  looksLikeAzureSecretId,
  sanitizeOAuthConfig,
  assertOAuthClientSecret,
};
