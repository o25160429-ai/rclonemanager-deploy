const fs = require('fs');
const admin = require('firebase-admin');

const memoryDb = {
  rclone_configs: {},
  rclone_commands: {},
  credentials_presets: {},
  config_tags: {},
  app_config: {},
};

let initialized = false;
let mode = 'offline';
let statusMessage = 'Firebase env vars are not configured; using local memory store.';
let adminDb = null;
let restBaseUrl = '';
let restSecret = '';

function normalizePath(path) {
  return String(path || '').replace(/^\/+|\/+$/g, '');
}

function splitPath(path) {
  const clean = normalizePath(path);
  return clean ? clean.split('/') : [];
}

function getMemory(path) {
  return splitPath(path).reduce((node, part) => (node ? node[part] : undefined), memoryDb);
}

function setMemory(path, value) {
  const parts = splitPath(path);
  const last = parts.pop();
  const parent = parts.reduce((node, part) => {
    if (!node[part] || typeof node[part] !== 'object') node[part] = {};
    return node[part];
  }, memoryDb);
  parent[last] = value;
}

function removeMemory(path) {
  const parts = splitPath(path);
  const last = parts.pop();
  const parent = parts.reduce((node, part) => (node ? node[part] : undefined), memoryDb);
  if (parent && last) delete parent[last];
}

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function generatePushId() {
  const stamp = Date.now().toString(36).padStart(8, '0');
  const random = Math.random().toString(36).slice(2, 14).padEnd(12, '0');
  return `-${stamp}${random}`;
}

function restUrl(path) {
  const clean = normalizePath(path);
  const separator = restBaseUrl.includes('?') ? '&' : '?';
  return `${restBaseUrl.replace(/\/+$/, '')}/${clean}.json${separator}auth=${encodeURIComponent(restSecret)}`;
}

async function restRequest(path, options = {}) {
  const response = await fetch(restUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data && data.error ? data.error : `Firebase REST request failed (${response.status})`);
  }
  return data;
}

async function initialize() {
  if (initialized) return;

  const databaseUrl = process.env.RCLONE_MANAGER_FIREBASE_DATABASE_URL;
  const serviceAccountJson = process.env.RCLONE_MANAGER_FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.RCLONE_MANAGER_FIREBASE_SERVICE_ACCOUNT_PATH;
  const databaseSecret = process.env.RCLONE_MANAGER_FIREBASE_DATABASE_SECRET;

  if (databaseUrl && (serviceAccountJson || serviceAccountPath)) {
    let credentialData;
    if (serviceAccountJson) {
      credentialData = JSON.parse(serviceAccountJson);
    } else {
      credentialData = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(credentialData),
        databaseURL: databaseUrl,
      });
    }
    adminDb = admin.database();
    mode = 'serviceAccount';
    statusMessage = 'Connected with Firebase service account.';
  } else if (databaseUrl && databaseSecret) {
    restBaseUrl = databaseUrl;
    restSecret = databaseSecret;
    mode = 'secret';
    statusMessage = 'Connected with Firebase database secret.';
    await restRequest('app_config', { method: 'GET' });
  }

  initialized = true;
}

async function getStatus() {
  if (!initialized) {
    try {
      await initialize();
    } catch (err) {
      statusMessage = err.message;
      initialized = true;
    }
  }

  return {
    connected: mode === 'serviceAccount' || mode === 'secret',
    mode,
    message: statusMessage,
  };
}

async function get(path) {
  await getStatus();
  const clean = normalizePath(path);
  if (mode === 'serviceAccount') {
    const snapshot = await adminDb.ref(clean).once('value');
    return snapshot.val();
  }
  if (mode === 'secret') {
    return restRequest(clean, { method: 'GET' });
  }
  return clone(getMemory(clean)) || null;
}

async function set(path, value) {
  await getStatus();
  const clean = normalizePath(path);
  if (mode === 'serviceAccount') {
    await adminDb.ref(clean).set(value);
    return value;
  }
  if (mode === 'secret') {
    return restRequest(clean, { method: 'PUT', body: JSON.stringify(value) });
  }
  setMemory(clean, clone(value));
  return value;
}

async function update(path, value) {
  await getStatus();
  const current = (await get(path)) || {};
  const next = { ...current, ...value };
  await set(path, next);
  return next;
}

async function remove(path) {
  await getStatus();
  const clean = normalizePath(path);
  if (mode === 'serviceAccount') {
    await adminDb.ref(clean).remove();
    return;
  }
  if (mode === 'secret') {
    await restRequest(clean, { method: 'DELETE' });
    return;
  }
  removeMemory(clean);
}

async function list(path) {
  const value = (await get(path)) || {};
  return Object.entries(value).map(([id, item]) => ({ id, ...item }));
}

async function push(path, value) {
  const id = generatePushId();
  const record = { ...value, id };
  await set(`${normalizePath(path)}/${id}`, record);
  return record;
}

module.exports = {
  initialize,
  getStatus,
  get,
  set,
  update,
  remove,
  list,
  push,
};
