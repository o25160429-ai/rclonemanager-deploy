const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('crypto');

const { router: oauthRouter } = require('./routes/oauth');
const configsRouter = require('./routes/configs');
const presetsRouter = require('./routes/presets');
const tagsRouter = require('./routes/tags');
const rcloneRouter = require('./routes/rclone');
const firebase = require('./services/firebase');

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const app = express();
const port = Number(process.env.RCLONE_MANAGER_PORT || process.env.PORT || process.env.APP_PORT || 53682);
const publicDir = path.join(__dirname, '..', 'public');

// --- Asset version cache busting ---
function resolveAssetVersion() {
  // 1. Prefer git commit short hash (most accurate)
  try {
    return execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..', '..', '..'), timeout: 3000 })
      .toString().trim();
  } catch (_) { /* not a git repo or git not available */ }
  // 2. Fallback: runner commit id injected by CI/CD
  if (process.env._DOTENVRTDB_RUNNER_COMMIT_SHORT_ID) {
    return process.env._DOTENVRTDB_RUNNER_COMMIT_SHORT_ID;
  }
  // 3. Last resort: process start timestamp (changes every restart)
  return String(Math.floor(Date.now() / 1000));
}

const ASSET_VERSION = resolveAssetVersion();
const indexHtmlPath = path.join(publicDir, 'index.html');
let _indexHtmlTemplate = null;

function getIndexHtml() {
  if (!_indexHtmlTemplate) {
    _indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf8');
  }
  return _indexHtmlTemplate.replaceAll('ASSET_VERSION', ASSET_VERSION);
}

console.log(`[assets] Cache-busting version: ${ASSET_VERSION}`);


function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveEnvValue(name, seen = new Set()) {
  if (seen.has(name)) return '';
  seen.add(name);
  return String(process.env[name] || '').replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, key) => resolveEnvValue(key, new Set(seen)));
}

function publicUrlFromEnv(name) {
  const value = resolveEnvValue(name).trim();
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function opsLinks() {
  return [
    { key: 'ttyd', label: 'ttyd', url: publicUrlFromEnv('CLOUDFLARED_TUNNEL_HOSTNAME_3') },
    { key: 'dozzle', label: 'dozzle', url: publicUrlFromEnv('CLOUDFLARED_TUNNEL_HOSTNAME_4') },
    { key: 'files', label: 'files', url: publicUrlFromEnv('CLOUDFLARED_TUNNEL_HOSTNAME_5') },
  ].filter((link) => link.url);
}

function runnerEnvItems() {
  const prefix = '_DOTENVRTDB_RUNNER';
  return Object.keys(process.env)
    .filter((key) => key.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, value: process.env[key] || '' }));
}

function sessionSecret() {
  return process.env.RCLONE_MANAGER_AUTH_SESSION_SECRET || process.env.RCLONE_MANAGER_BACKEND_API_KEY || 'change-me';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signSession(email) {
  const exp = Date.now() + (Number(process.env.RCLONE_MANAGER_AUTH_SESSION_TTL_MS || 86400000));
  const payload = `${email}|${exp}`;
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function verifySession(token) {
  try {
    const decoded = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const [email, expRaw, sig] = decoded.split('|');
    const exp = Number(expRaw || 0);
    if (!email || !exp || Date.now() > exp) return null;
    const payload = `${email}|${exp}`;
    const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
    if (!safeEqual(expected, sig)) return null;
    return { email, exp };
  } catch (_err) { return null; }
}

function firebaseAuthConfig() {
  return {
    apiKey: process.env.RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_API_KEY || '',
    authDomain: process.env.RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_AUTH_DOMAIN || '',
    databaseURL: process.env.RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_DATABASE_URL || '',
    projectId: process.env.RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.RCLONE_MANAGER_GOOGLE_AUTH_FIREBASE_APP_ID || '',
  };
}

function hasFirebaseAuthConfig() {
  const cfg = firebaseAuthConfig();
  return Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId);
}

function authRequired() {
  return envFlag('RCLONE_MANAGER_REQUIRE_GOOGLE_AUTH', true);
}

function authError(message, status = 401) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function verifyFirebaseIdToken(idToken) {
  const cfg = firebaseAuthConfig();
  if (!cfg.apiKey || !cfg.projectId) {
    throw authError('Firebase Auth env is not configured.', 503);
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw authError(data.error?.message || 'Invalid Firebase token.', 401);
  }

  const user = Array.isArray(data.users) ? data.users[0] : null;
  const email = String(user?.email || '').toLowerCase();
  if (!user || !email) throw authError('Firebase token has no email.', 401);
  if (user.emailVerified === false) throw authError('Google email is not verified.', 403);

  const providers = Array.isArray(user.providerUserInfo)
    ? user.providerUserInfo.map((item) => item.providerId).filter(Boolean)
    : [];
  if (providers.length > 0 && !providers.includes('google.com')) {
    throw authError('Google sign-in is required.', 403);
  }

  return {
    uid: user.localId,
    email,
    name: user.displayName || '',
    picture: user.photoUrl || '',
    providers,
  };
}

function assertAllowedEmail(user) {
  const allowed = parseAllowlist();
  if (allowed.length && !allowed.includes(user.email)) {
    throw authError('Email not allowed.', 403);
  }
}

async function requireGoogleAuth(req, res, next) {
  const required = authRequired();
  if (!required) return next();
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return res.status(401).json({ error: 'Google auth required.' });
  const session = verifySession(bearer);
  if (session) {
    req.user = session;
    return next();
  }

  try {
    const firebaseUser = await verifyFirebaseIdToken(bearer);
    assertAllowedEmail(firebaseUser);
    req.user = { email: firebaseUser.email, uid: firebaseUser.uid };
    return next();
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'Google auth required.' });
  }
}

function parseAllowlist() {
  return (process.env.RCLONE_MANAGER_ALLOWED_GMAILS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

function hasValidApiKey(req) {
  const key = process.env.RCLONE_MANAGER_BACKEND_API_KEY || '';
  if (!key) return false;
  const incoming = req.get('x-api-key') || req.query.apiKey || '';
  return safeEqual(incoming, key);
}

function isPublicApiPath(pathname) {
  return pathname.startsWith('/auth/') || pathname === '/auth/config';
}

async function requireApiAuth(req, res, next) {
  if (isPublicApiPath(req.path)) return next();
  if (hasValidApiKey(req)) {
    req.user = { authType: 'api-key' };
    return next();
  }

  if (authRequired()) return requireGoogleAuth(req, res, next);
  if (process.env.RCLONE_MANAGER_BACKEND_API_KEY) return res.status(401).json({ error: 'Invalid API key.' });
  return next();
}

async function googleLogin(req, res) {
  const idToken = String(req.body?.idToken || '');
  if (!idToken) return res.status(400).json({ error: 'Missing idToken.' });
  const user = await verifyFirebaseIdToken(idToken);
  assertAllowedEmail(user);
  const sessionToken = signSession(user.email);
  res.json({
    ok: true,
    email: user.email,
    name: user.name,
    picture: user.picture,
    sessionToken,
  });
}


app.set('trust proxy', true);

const allowedOrigins = (process.env.RCLONE_MANAGER_ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.post('/api/auth/google', (req, res, next) => {
  googleLogin(req, res).catch(next);
});
app.get('/api/auth/config', (_req, res) => {
  res.json({
    required: authRequired(),
    configured: hasFirebaseAuthConfig(),
    firebaseConfig: firebaseAuthConfig(),
    allowedGmailsConfigured: parseAllowlist().length > 0,
  });
});

app.get('/api/ops-links', (_req, res) => {
  res.json({ items: opsLinks() });
});

app.get('/api/auth/me', (req, res) => {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const session = verifySession(bearer);
  if (!session) return res.status(401).json({ error: 'Session expired.' });
  return res.json({ ok: true, email: session.email, exp: session.exp });
});

app.use('/api/oauth', oauthRouter);
app.use('/api', requireApiAuth);

app.get('/health', async (_req, res) => {
  const status = await firebase.getStatus();
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    firebase: status.connected ? 'connected' : 'error',
    firebaseMode: status.mode,
    message: status.message,
    runnerCommitShortId: process.env._DOTENVRTDB_RUNNER_COMMIT_SHORT_ID || '',
    runnerCommitAt: process.env._DOTENVRTDB_RUNNER_COMMIT_AT || '',
  });
});

app.get('/api/runner-env', (_req, res) => {
  const prefix = '_DOTENVRTDB_RUNNER';
  const items = runnerEnvItems();
  res.json({
    prefix,
    count: items.length,
    generatedAt: new Date().toISOString(),
    items,
  });
});

app.use('/api/configs', configsRouter);
app.use('/api/presets', presetsRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/rclone', rcloneRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getIndexHtml());
});

app.use(express.static(publicDir, {
  // Do NOT cache index.html itself — always serve fresh via the route above
  setHeaders(res, filePath) {
    if (filePath === indexHtmlPath) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

app.get('*', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getIndexHtml());
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = Number.isInteger(err.status)
    ? err.status
    : (Number.isInteger(err.httpStatus) ? err.httpStatus : 500);
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
});

firebase.initialize()
  .catch((err) => {
    console.warn(`Firebase initialization warning: ${err.message}`);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`rclone OAuth Manager listening on http://localhost:${port}/`);
    });
  });
