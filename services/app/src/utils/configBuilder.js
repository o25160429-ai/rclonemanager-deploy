const { sanitizeOAuthConfig } = require('./oauthClients');

function toExpiry(expiresIn) {
  return new Date(Date.now() + Number(expiresIn || 3600) * 1000).toISOString();
}

function buildTokenJson(token, existingRefreshToken) {
  const expiry = token.expiry || toExpiry(token.expires_in);
  return {
    access_token: token.access_token,
    token_type: token.token_type || 'Bearer',
    refresh_token: token.refresh_token || existingRefreshToken || '',
    expiry,
  };
}

function normalizeDriveId(cfg, token = {}, options = {}) {
  return cfg.driveId || cfg.drive_id || token.driveId || token.drive_id || options.driveId || options.drive_id || '';
}

function injectOneDriveDriveId(rcloneConfig, driveId, driveType = 'personal') {
  if (!rcloneConfig) return rcloneConfig;
  const lines = String(rcloneConfig).split(/\r?\n/);
  const hasDriveId = /^\s*drive_id\s*=/mi.test(rcloneConfig);
  const hasDriveType = /^\s*drive_type\s*=/mi.test(rcloneConfig);
  if ((hasDriveId || !driveId) && hasDriveType) return rcloneConfig;

  const driveTypeIndex = lines.findIndex((line) => /^\s*drive_type\s*=/.test(line));
  if (driveId && !hasDriveId && driveTypeIndex >= 0) {
    lines.splice(driveTypeIndex, 0, `drive_id = ${driveId}`);
  } else if (driveId && !hasDriveId) {
    lines.push(`drive_id = ${driveId}`);
  }

  if (!hasDriveType) {
    lines.push(`drive_type = ${driveType || 'personal'}`);
  }
  return lines.join('\n');
}

function buildRcloneConfig(cfg, token, existingRefreshToken = '', options = {}) {
  cfg = sanitizeOAuthConfig(cfg);
  const tokenJson = buildTokenJson(token, existingRefreshToken);
  const tokenText = JSON.stringify(tokenJson);

  if (cfg.provider === 'gd') {
    return {
      expiry: tokenJson.expiry,
      refreshToken: tokenJson.refresh_token,
      rcloneConfig: [
        `[${cfg.remoteName}]`,
        'type = drive',
        `client_id = ${cfg.clientId}`,
        `client_secret = ${cfg.clientSecret || ''}`,
        `scope = ${cfg.scope || 'drive'}`,
        `token = ${tokenText}`,
        ...(cfg.googleRootFolderMode === 'appDataFolder' || cfg.appDataFolder ? ['root_folder_id = appDataFolder'] : []),
      ].join('\n'),
    };
  }

  const lines = [
    `[${cfg.remoteName}]`,
    'type = onedrive',
    `client_id = ${cfg.clientId}`,
  ];
  if (cfg.clientSecret) lines.push(`client_secret = ${cfg.clientSecret}`);
  lines.push(`token = ${tokenText}`);
  const driveId = normalizeDriveId(cfg, token, options);
  if (driveId) lines.push(`drive_id = ${driveId}`);
  lines.push(`drive_type = ${cfg.driveType || 'personal'}`);

  return {
    expiry: tokenJson.expiry,
    refreshToken: tokenJson.refresh_token,
    rcloneConfig: lines.join('\n'),
  };
}

function normalizeConfigRecord(cfg, token, options = {}) {
  cfg = sanitizeOAuthConfig(cfg);
  const driveId = cfg.provider === 'od' ? normalizeDriveId(cfg, token, options) : '';
  const built = options.rcloneConfig
    ? {
      expiry: options.expiry || token.expiry || toExpiry(token.expires_in),
      refreshToken: token.refresh_token || options.refreshToken || '',
      rcloneConfig: cfg.provider === 'od' ? injectOneDriveDriveId(options.rcloneConfig, driveId) : options.rcloneConfig,
    }
    : buildRcloneConfig(cfg, token, options.refreshToken, { driveId });

  const now = Date.now();
  return {
    remoteName: cfg.remoteName || 'myremote',
    provider: cfg.provider,
    emailOwner: cfg.emailOwner || cfg.email_owner || '',
    clientId: cfg.clientId || '',
    clientSecret: cfg.clientSecret || '',
    scope: cfg.provider === 'gd' ? (cfg.scope || 'drive') : '',
    driveType: cfg.provider === 'od' ? (cfg.driveType || 'personal') : '',
    driveId,
    accessToken: token.access_token || options.accessToken || '',
    refreshToken: built.refreshToken,
    expiry: built.expiry,
    rcloneConfig: built.rcloneConfig,
    createdAt: options.createdAt || now,
    updatedAt: options.updatedAt || now,
    status: options.status || 'active',
    appDataFolder: Boolean(cfg.googleRootFolderMode === 'appDataFolder' || cfg.appDataFolder),
    authType: cfg.authType || options.authType || 'oauth',
    lastChecked: options.lastChecked ?? null,
    storageUsed: options.storageUsed ?? null,
    storageTotal: options.storageTotal ?? null,
  };
}

module.exports = {
  buildRcloneConfig,
  injectOneDriveDriveId,
  normalizeConfigRecord,
};
