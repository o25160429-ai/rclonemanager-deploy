const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_LOG_BYTES = 64 * 1024;
const DEFAULT_STARTUP_WAIT_MS = 2500;
const DEFAULT_UNMOUNT_WAIT_MS = 6000;

const mounts = new Map();

function defaultMountRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..', '.docker-volumes');
}

function mountRoot() {
  return path.resolve(process.env.RCLONE_MANAGER_RCLONE_MOUNT_ROOT || defaultMountRoot());
}

function safeMountName(remoteName, fallback) {
  const normalized = String(remoteName || '')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  const safeFallback = String(fallback || 'config').replace(/[^a-z0-9._-]+/gi, '_');
  if (!normalized) return `remote-${safeFallback}`;
  return `${normalized}-${safeFallback}`.slice(0, 160);
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

function filebrowserBaseUrl() {
  const explicit = publicUrlFromEnv('RCLONE_MANAGER_FILEBROWSER_PUBLIC_URL');
  if (explicit) return explicit;

  const cloudflared = publicUrlFromEnv('CLOUDFLARED_TUNNEL_HOSTNAME_5');
  if (cloudflared) return cloudflared;

  const domain = resolveEnvValue('DOMAIN').trim();
  return domain ? `https://files.${domain}` : '';
}

function filebrowserUrlFor(mountName) {
  const base = filebrowserBaseUrl().replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/files/docker-volumes/${encodeURIComponent(mountName)}/`;
}

function publicMount(entry) {
  if (!entry) return null;
  return {
    configId: entry.configId,
    remoteName: entry.remoteName,
    mountName: entry.mountName,
    status: entry.status,
    mountedAt: entry.mountedAt || null,
    stoppedAt: entry.stoppedAt || null,
    mountPath: entry.mountPath,
    hostPath: `./.docker-volumes/${entry.mountName}`,
    filebrowserPath: `/srv/docker-volumes/${entry.mountName}`,
    filebrowserRelativePath: `docker-volumes/${entry.mountName}`,
    filebrowserUrl: filebrowserUrlFor(entry.mountName),
    error: entry.error || '',
  };
}

function appendBounded(target, chunk) {
  const next = `${target}${chunk.toString('utf8')}`;
  if (Buffer.byteLength(next, 'utf8') <= MAX_LOG_BYTES) return next;
  return next.slice(-MAX_LOG_BYTES);
}

async function writeTempConfig(configText) {
  const filename = `rclone-mount-${Date.now()}-${Math.random().toString(36).slice(2)}.conf`;
  const filePath = path.join(os.tmpdir(), filename);
  await fs.writeFile(filePath, `${String(configText || '').trim()}\n`, 'utf8');
  return filePath;
}

function isProcessAlive(entry) {
  return Boolean(entry?.child && !entry.exited && entry.child.exitCode === null);
}

function compactError(entry) {
  return String(entry?.error || entry?.stderr || entry?.stdout || '').trim().slice(0, 1200);
}

function httpError(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStartup(entry) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEFAULT_STARTUP_WAIT_MS) {
    if (entry.exited || entry.error) {
      throw httpError(`rclone mount thất bại${compactError(entry) ? `: ${compactError(entry)}` : '.'}`, 422);
    }
    await sleep(200);
  }

  if (!isProcessAlive(entry)) {
    throw httpError(`rclone mount không còn chạy${compactError(entry) ? `: ${compactError(entry)}` : '.'}`, 422);
  }
  const mounted = await isMountPoint(entry.mountPath);
  if (!mounted) {
    throw httpError(`rclone mount chưa gắn vào filesystem${compactError(entry) ? `: ${compactError(entry)}` : '.'}`, 422);
  }

  entry.status = 'mounted';
  entry.mountedAt = entry.mountedAt || Date.now();
  return publicMount(entry);
}

async function isMountPoint(targetPath) {
  try {
    const mountInfo = await fs.readFile('/proc/self/mountinfo', 'utf8');
    const normalized = path.resolve(targetPath);
    return mountInfo.split('\n').some((line) => {
      if (!line) return false;
      const fields = line.split(' ');
      const mountPoint = fields[4];
      return mountPoint && path.resolve(mountPoint) === normalized;
    });
  } catch (_err) {
    return false;
  }
}

function mountArgs(record, mountPath) {
  const args = [
    'mount',
    `${record.remoteName}:`,
    mountPath,
    '--vfs-cache-mode',
    process.env.RCLONE_MANAGER_RCLONE_MOUNT_VFS_CACHE_MODE || 'writes',
    '--dir-cache-time',
    process.env.RCLONE_MANAGER_RCLONE_MOUNT_DIR_CACHE_TIME || '1m',
    '--poll-interval',
    process.env.RCLONE_MANAGER_RCLONE_MOUNT_POLL_INTERVAL || '15s',
    '--umask',
    process.env.RCLONE_MANAGER_RCLONE_MOUNT_UMASK || '002',
  ];

  if (process.env.RCLONE_MANAGER_RCLONE_MOUNT_ALLOW_OTHER !== '0') args.push('--allow-other');
  return args;
}

async function startMount({ configId, record, configText }) {
  const existing = mounts.get(configId);
  if (isProcessAlive(existing)) return publicMount(existing);
  if (existing) mounts.delete(configId);

  if (!record?.remoteName) throw httpError('Config thiếu remoteName.', 400);
  if (!configText) throw httpError('Config thiếu rcloneConfig.', 400);

  const mountName = safeMountName(record.remoteName, configId);
  const mountPath = path.join(mountRoot(), mountName);
  await fs.mkdir(mountPath, { recursive: true });

  const configPath = await writeTempConfig(configText);
  const entry = {
    configId,
    remoteName: record.remoteName,
    mountName,
    mountPath,
    configPath,
    status: 'mounting',
    stdout: '',
    stderr: '',
    error: '',
    exited: false,
    stopRequested: false,
    mountedAt: null,
    stoppedAt: null,
  };
  mounts.set(configId, entry);

  const child = spawn('rclone', mountArgs(record, mountPath), {
    env: {
      ...process.env,
      RCLONE_CONFIG: configPath,
    },
    windowsHide: true,
  });

  entry.child = child;

  child.stdout.on('data', (chunk) => {
    entry.stdout = appendBounded(entry.stdout, chunk);
  });

  child.stderr.on('data', (chunk) => {
    entry.stderr = appendBounded(entry.stderr, chunk);
  });

  child.on('error', (err) => {
    entry.error = err.code === 'ENOENT' ? 'rclone executable was not found in PATH.' : err.message;
    entry.status = 'error';
    entry.exited = true;
    entry.stoppedAt = Date.now();
  });

  child.on('close', (exitCode, signal) => {
    entry.exitCode = exitCode;
    entry.signal = signal;
    entry.exited = true;
    entry.stoppedAt = Date.now();
    entry.status = entry.stopRequested ? 'unmounted' : 'error';
    if (!entry.stopRequested && !entry.error) {
      entry.error = compactError(entry) || `rclone mount exited with code ${exitCode ?? signal ?? 'unknown'}.`;
    }
    fs.unlink(configPath).catch(() => {});
  });

  try {
    return await waitForStartup(entry);
  } catch (err) {
    entry.status = 'error';
    entry.error = err.message;
    if (isProcessAlive(entry)) child.kill('SIGTERM');
    throw err;
  }
}

async function waitForExit(entry, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(entry)) return true;
    await sleep(200);
  }
  return !isProcessAlive(entry);
}

async function stopMount(configId) {
  const entry = mounts.get(configId);
  if (!entry) return { status: 'unmounted' };

  entry.stopRequested = true;
  entry.status = 'unmounting';
  if (isProcessAlive(entry)) entry.child.kill('SIGTERM');
  const stopped = await waitForExit(entry, DEFAULT_UNMOUNT_WAIT_MS);
  if (!stopped && isProcessAlive(entry)) entry.child.kill('SIGKILL');

  mounts.delete(configId);
  fs.unlink(entry.configPath).catch(() => {});
  return {
    ...publicMount({
      ...entry,
      status: 'unmounted',
      stoppedAt: Date.now(),
    }),
  };
}

function getMount(configId) {
  return publicMount(mounts.get(configId));
}

function listMounts() {
  return Array.from(mounts.values()).map(publicMount);
}

module.exports = {
  getMount,
  listMounts,
  startMount,
  stopMount,
};
