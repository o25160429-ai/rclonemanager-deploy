const firebase = require('./firebase');

const COLLECTION = 'rclone_configs';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

async function findByEmailOwnerAndProvider(emailOwner, provider, appDataFolder=false, authType="oauth") {
  const normalized = normalizeEmail(emailOwner);
  const normalizedProvider = normalizeProvider(provider);
  const marker = appDataFolder ? "app" : "normal";
  if (!normalized || !normalizedProvider) return null;

  const items = await firebase.list(COLLECTION);
  return items
    .filter((item) =>
      normalizeEmail(item.emailOwner || item.email_owner) === normalized
      && normalizeProvider(item.provider) === normalizedProvider
      && String((item.appDataFolder ? "app" : "normal")) === marker
      && String(item.authType || "oauth") === String(authType || "oauth"))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0] || null;
}

async function upsertByEmailOwnerAndProvider(record) {
  const existing = await findByEmailOwnerAndProvider(record.emailOwner, record.provider, record.appDataFolder, record.authType);
  if (!existing) {
    return {
      action: 'created',
      record: await firebase.push(COLLECTION, record),
      previousRecord: null,
    };
  }

  const now = Date.now();
  const saved = await firebase.update(`${COLLECTION}/${existing.id}`, {
    ...record,
    id: existing.id,
    createdAt: existing.createdAt || record.createdAt || now,
    updatedAt: now,
  });

  return {
    action: 'updated',
    record: saved,
    previousRecord: existing,
  };
}

module.exports = {
  COLLECTION,
  findByEmailOwner: findByEmailOwnerAndProvider,
  findByEmailOwnerAndProvider,
  upsertByEmailOwner: upsertByEmailOwnerAndProvider,
  upsertByEmailOwnerAndProvider,
};
