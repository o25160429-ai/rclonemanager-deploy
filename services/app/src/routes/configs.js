const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const firebase = require('../services/firebase');
const { COLLECTION, upsertByEmailOwner } = require('../services/configStore');
const { injectOneDriveDriveId, normalizeConfigRecord } = require('../utils/configBuilder');
const { encryptIfConfigured } = require('../utils/encryption');
const { refreshAccessToken } = require('../services/tokenRefresh');
const { fetchOneDriveDrive, fetchQuota, listFiles } = require('../services/cloudApi');
const { runRclone } = require('../services/rcloneRunner');
const { getMount, listMounts, startMount, stopMount } = require('../services/rcloneMounts');
const { recountPresetUsageForConfigs } = require('../services/credentialUsage');
const {
  normalizeTagIds,
  tagIdsForRecord,
  tagsById,
  tagsForConfig,
} = require('../services/configTags');

const router = express.Router();

function isServiceAccountRecord(record) {
  return record?.provider === 'gd'
    && (record.authType === 'service_account' || record.clientId === 'service_account');
}

function recordStatusFromError(err) {
  if (err.recordStatus) return err.recordStatus;
  if (err.status === 'expired') return 'expired';
  return 'error';
}

function ensureHttpStatus(err) {
  if (Number.isInteger(err.status)) return err;
  if (Number.isInteger(err.httpStatus)) {
    err.status = err.httpStatus;
    return err;
  }
  err.status = err.status === 'expired' ? 401 : 500;
  return err;
}

function redactRcloneDetail(value) {
  return String(value || '')
    .replace(/(service_account_credentials\s*=\s*)\{.*\}/gis, '$1[redacted]')
    .replace(/("private_key"\s*:\s*")[^"]+(")/gis, '$1[redacted]$2')
    .trim()
    .slice(0, 1200);
}

function remoteRef(record) {
  const remoteName = String(record.remoteName || '').trim();
  if (!remoteName) {
    const err = new Error('Config thiếu remoteName.');
    err.status = 400;
    throw err;
  }
  return `${remoteName}:`;
}

function extractDriveId(rcloneConfig) {
  const match = String(rcloneConfig || '').match(/^\s*drive_id\s*=\s*(.+?)\s*$/mi);
  return match ? match[1].trim() : '';
}

async function refreshThenFetchOneDrive(record, path) {
  const refreshed = await refreshAccessToken(record);
  const nextRecord = { ...record, ...refreshed };
  await firebase.update(path, refreshed);
  return {
    record: nextRecord,
    drive: await fetchOneDriveDrive(nextRecord),
  };
}

async function ensureOneDriveDriveId(id, record) {
  if (record.provider !== 'od') return record;

  let driveId = record.driveId || record.drive_id || extractDriveId(record.rcloneConfig);
  if (driveId) {
    const rcloneConfig = injectOneDriveDriveId(record.rcloneConfig || '', driveId, record.driveType);
    if (!record.driveId || rcloneConfig !== record.rcloneConfig) {
      await firebase.update(`${COLLECTION}/${id}`, {
        driveId,
        rcloneConfig,
        updatedAt: Date.now(),
      });
    }
    return { ...record, driveId, rcloneConfig };
  }

  const path = `${COLLECTION}/${id}`;
  let current = record;
  let drive;
  try {
    drive = await fetchOneDriveDrive(current);
  } catch (err) {
    if (err.status !== 'expired') throw err;
    const refreshed = await refreshThenFetchOneDrive(current, path);
    current = refreshed.record;
    drive = refreshed.drive;
  }

  driveId = drive.id || '';
  if (!driveId) {
    const err = new Error(`Không xác định được OneDrive drive_id cho ${record.remoteName || id}. Hãy auth lại config này.`);
    err.status = 422;
    throw err;
  }

  const rcloneConfig = injectOneDriveDriveId(current.rcloneConfig || '', driveId, current.driveType);
  await firebase.update(path, {
    driveId,
    rcloneConfig,
    updatedAt: Date.now(),
    status: 'active',
  });
  return { ...current, driveId, rcloneConfig, status: 'active' };
}

function configTextForRecord(record) {
  const driveId = record.driveId || record.drive_id || '';
  if (record.provider === 'od' && driveId) {
    return injectOneDriveDriveId(record.rcloneConfig || '', driveId, record.driveType);
  }
  return record.rcloneConfig || '';
}

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

function publicUrlFromValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function firstCsvItem(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0] || '';
}

function rcloneGuiPublicUrl() {
  const explicit = resolveEnvValue('RCLONE_MANAGER_GUI_PUBLIC_URL').trim();
  if (explicit) return publicUrlFromValue(explicit);

  const caddyHost = firstCsvItem(resolveEnvValue('RCLONE_MANAGER_GUI_CADDY_HOSTS'));
  if (caddyHost) return publicUrlFromValue(caddyHost);

  const domain = resolveEnvValue('DOMAIN').trim();
  return domain ? `https://rclone-gui.${domain}` : '';
}

function rcloneGuiConfigPath() {
  return path.resolve(
    resolveEnvValue('RCLONE_MANAGER_GUI_CONFIG_PATH').trim()
      || '/mnt/docker-volumes/rclone-manager-gui/config/rclone.conf',
  );
}

function rcloneGuiMetaPath() {
  return path.join(path.dirname(rcloneGuiConfigPath()), 'selection.json');
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function rcloneGuiStatus() {
  const configPath = rcloneGuiConfigPath();
  const [meta, stat] = await Promise.all([
    readJsonFile(rcloneGuiMetaPath()),
    fs.stat(configPath).catch((err) => {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }),
  ]);

  return {
    enabled: envFlag('RCLONE_MANAGER_GUI_ENABLED', false),
    publicUrl: rcloneGuiPublicUrl(),
    configPath,
    published: Boolean(stat && stat.size > 0),
    configSize: stat?.size || 0,
    generatedAt: meta?.generatedAt || (stat ? stat.mtime.toISOString() : ''),
    selectedConfigIds: Array.isArray(meta?.selectedConfigIds) ? meta.selectedConfigIds : [],
    remotes: Array.isArray(meta?.remotes) ? meta.remotes : [],
    autoMountSelected: envFlag('RCLONE_MANAGER_GUI_AUTO_MOUNT_SELECTED', true),
  };
}

function normalizeConfigIds(value) {
  const ids = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
}

async function selectedGuiRecords(configIds) {
  if (!configIds.length) {
    const err = new Error('Chọn ít nhất một config để publish sang rclone GUI.');
    err.status = 400;
    throw err;
  }

  const items = [];
  const seenRemoteNames = new Set();
  for (const id of configIds) {
    const record = await firebase.get(`${COLLECTION}/${id}`);
    if (!record) {
      const err = new Error(`Config not found: ${id}`);
      err.status = 404;
      throw err;
    }

    const readyRecord = await ensureOneDriveDriveId(id, record);
    const remoteName = String(readyRecord.remoteName || '').trim();
    if (!remoteName) {
      const err = new Error(`Config ${id} thiếu remoteName.`);
      err.status = 400;
      throw err;
    }
    if (seenRemoteNames.has(remoteName)) {
      const err = new Error(`Remote name bị trùng trong danh sách đã chọn: ${remoteName}`);
      err.status = 409;
      throw err;
    }
    seenRemoteNames.add(remoteName);

    const configText = configTextForRecord(readyRecord).trim();
    if (!configText) {
      const err = new Error(`Config ${remoteName} thiếu rcloneConfig.`);
      err.status = 400;
      throw err;
    }
    items.push({ id, record: readyRecord, remoteName, configText });
  }
  return items;
}

function guiConfigText(items) {
  const generatedAt = new Date().toISOString();
  const header = [
    '# Generated by rclone OAuth Manager for the built-in rclone GUI.',
    `# generated_at = ${generatedAt}`,
    `# remotes = ${items.map((item) => item.remoteName).join(', ')}`,
  ].join('\n');
  return `${header}\n\n${items.map((item) => item.configText).join('\n\n')}\n`;
}

async function autoMountGuiRecords(items) {
  if (!envFlag('RCLONE_MANAGER_GUI_AUTO_MOUNT_SELECTED', true)) return [];

  return Promise.all(items.map(async (item) => {
    try {
      const mount = await startMount({
        configId: item.id,
        record: item.record,
        configText: item.configText,
      });
      return { id: item.id, remoteName: item.remoteName, ok: true, mount };
    } catch (err) {
      return { id: item.id, remoteName: item.remoteName, ok: false, error: err.message || String(err) };
    }
  }));
}

async function runConfigRcloneJson(record, command, action) {
  const result = await runRclone({
    command,
    configText: record.rcloneConfig || '',
    outputMode: 'json',
    timeoutMs: 120000,
  });

  if (result.timedOut || result.exitCode !== 0) {
    const detail = redactRcloneDetail(result.stderr || result.stdout || `exit code ${result.exitCode}`);
    const err = new Error(`${action} thất bại${detail ? `: ${detail}` : '.'}`);
    err.status = 422;
    err.recordStatus = 'error';
    throw err;
  }
  if (result.jsonParseError) {
    const err = new Error(`${action} trả về JSON không hợp lệ: ${result.jsonParseError}`);
    err.status = 502;
    err.recordStatus = 'error';
    throw err;
  }
  return result.json;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchServiceAccountQuota(record) {
  const remote = remoteRef(record);
  try {
    const about = await runConfigRcloneJson(record, ['about', remote, '--json'], 'rclone about');
    return {
      provider: 'gd',
      user: record.emailOwner ? { emailAddress: record.emailOwner } : null,
      storageUsed: numberOrNull(about.used) || 0,
      storageTotal: numberOrNull(about.total),
      raw: about,
    };
  } catch (aboutErr) {
    const size = await runConfigRcloneJson(record, ['size', remote, '--json'], 'rclone size');
    return {
      provider: 'gd',
      user: record.emailOwner ? { emailAddress: record.emailOwner } : null,
      storageUsed: numberOrNull(size.bytes) || 0,
      storageTotal: null,
      raw: size,
      fallbackReason: aboutErr.message,
    };
  }
}

async function listServiceAccountFiles(record) {
  const data = await runConfigRcloneJson(
    record,
    ['lsjson', remoteRef(record), '--max-depth', '1'],
    'rclone lsjson',
  );
  return {
    files: (Array.isArray(data) ? data : []).map((file) => ({
      id: file.ID || file.Id || file.Path || file.Name || '',
      name: file.Name || file.Path || '',
      size: file.IsDir ? null : numberOrNull(file.Size),
      type: file.IsDir ? 'folder' : (file.MimeType || 'file'),
      modified: file.ModTime || '',
    })),
    nextPageToken: null,
  };
}

function publicRecord(record, tagLookup = null) {
  if (!record) return null;
  const { clientSecret, ...safe } = record;
  safe.driveId = safe.driveId || safe.drive_id || '';
  safe.tagIds = tagIdsForRecord(safe);
  safe.tags = tagLookup ? tagsForConfig(safe, tagLookup) : [];
  if (safe.provider === 'od' && safe.driveId) {
    safe.rcloneConfig = injectOneDriveDriveId(safe.rcloneConfig, safe.driveId, safe.driveType);
  }
  return safe;
}

function parseManualSave(body) {
  const cfg = body.config || body.cfg || body;
  const token = body.token || body.tokens || {
    access_token: body.accessToken,
    refresh_token: body.refreshToken,
    token_type: body.tokenType || 'Bearer',
    expires_in: body.expiresIn || 3600,
    expiry: body.expiry,
  };

  const record = normalizeConfigRecord(cfg, token, {
    rcloneConfig: body.rcloneConfig,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiry: body.expiry,
    driveId: body.driveId || body.drive_id || cfg.driveId || cfg.drive_id,
  });
  record.clientSecret = encryptIfConfigured(record.clientSecret);
  return record;
}

function applyFilters(items, query) {
  const provider = query.provider;
  const status = query.status;
  const tagId = String(query.tagId || '').trim();
  const search = String(query.search || query.email || '').trim().toLowerCase();
  const start = query.startDate ? new Date(query.startDate).getTime() : null;
  const end = query.endDate ? new Date(query.endDate).getTime() + 86400000 - 1 : null;

  return items.filter((item) => {
    if (provider && item.provider !== provider) return false;
    if (status && item.status !== status) return false;
    if (tagId && !tagIdsForRecord(item).includes(tagId)) return false;
    if (search) {
      const haystack = `${item.emailOwner || ''} ${item.remoteName || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (start && Number(item.createdAt || 0) < start) return false;
    if (end && Number(item.createdAt || 0) > end) return false;
    return true;
  });
}

router.post('/save', async (req, res, next) => {
  try {
    const record = parseManualSave(req.body || {});
    if (!record.remoteName || !record.provider || !record.accessToken || !record.rcloneConfig) {
      res.status(400).json({ error: 'remoteName, provider, accessToken and rcloneConfig are required.' });
      return;
    }

    record.authType = record.clientId === "service_account" ? "service_account" : (record.authType || "oauth");
    const saved = await upsertByEmailOwner(record);
    await recountPresetUsageForConfigs([saved.record, saved.previousRecord]);
    res.status(saved.action === 'created' ? 201 : 200).json(publicRecord(saved.record));
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const [all, tagLookup] = await Promise.all([
      firebase.list(COLLECTION),
      tagsById(),
    ]);
    const filtered = applyFilters(all, req.query)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const stats = {
      total: all.length,
      gd: all.filter((i) => i.provider === 'gd').length,
      od: all.filter((i) => i.provider === 'od').length,
      active: all.filter((i) => i.status === 'active').length,
      error: all.filter((i) => i.status === 'error' || i.status === 'expired').length,
    };
    res.json({
      items: filtered.slice(offset, offset + limit).map((record) => publicRecord(record, tagLookup)),
      total: filtered.length,
      stats,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/mounts', (_req, res) => {
  res.json({ items: listMounts() });
});

router.get('/gui', async (_req, res, next) => {
  try {
    res.json(await rcloneGuiStatus());
  } catch (err) {
    next(err);
  }
});

router.post('/gui', async (req, res, next) => {
  try {
    const configIds = normalizeConfigIds(req.body?.configIds || req.body?.ids);
    const items = await selectedGuiRecords(configIds);
    const configPath = rcloneGuiConfigPath();
    const generatedAt = new Date().toISOString();

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, guiConfigText(items), { encoding: 'utf8', mode: 0o600 });

    const mountResults = await autoMountGuiRecords(items);
    const meta = {
      generatedAt,
      selectedConfigIds: items.map((item) => item.id),
      remotes: items.map((item) => ({
        id: item.id,
        remoteName: item.remoteName,
        provider: item.record.provider || '',
        emailOwner: item.record.emailOwner || '',
      })),
      configPath,
      publicUrl: rcloneGuiPublicUrl(),
      autoMountSelected: envFlag('RCLONE_MANAGER_GUI_AUTO_MOUNT_SELECTED', true),
      mountResults,
    };
    await fs.writeFile(rcloneGuiMetaPath(), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    res.json({
      ...await rcloneGuiStatus(),
      count: items.length,
      remoteNames: items.map((item) => item.remoteName),
      mountResults,
      mountWarnings: mountResults.filter((item) => !item.ok),
    });
  } catch (err) {
    next(ensureHttpStatus(err));
  }
});

router.get('/:id/mount', (req, res) => {
  res.json({ mount: getMount(req.params.id) });
});

router.post('/:id/mount', async (req, res, next) => {
  try {
    const record = await firebase.get(`${COLLECTION}/${req.params.id}`);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }

    const readyRecord = await ensureOneDriveDriveId(req.params.id, record);
    const mount = await startMount({
      configId: req.params.id,
      record: readyRecord,
      configText: configTextForRecord(readyRecord),
    });
    res.json({ mount });
  } catch (err) {
    next(ensureHttpStatus(err));
  }
});

router.delete('/:id/mount', async (req, res, next) => {
  try {
    const mount = await stopMount(req.params.id);
    res.json({ mount });
  } catch (err) {
    next(ensureHttpStatus(err));
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const record = await firebase.get(`${COLLECTION}/${req.params.id}`);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }
    res.json(publicRecord(record, await tagsById()));
  } catch (err) {
    next(err);
  }
});

router.put('/:id/tags', async (req, res, next) => {
  try {
    const path = `${COLLECTION}/${req.params.id}`;
    const record = await firebase.get(path);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }

    const tagLookup = await tagsById();
    const tagIds = normalizeTagIds(req.body?.tagIds || req.body?.tags || []);
    const unknownIds = tagIds.filter((tagId) => !tagLookup.has(tagId));
    if (unknownIds.length > 0) {
      res.status(400).json({ error: `Unknown tag id: ${unknownIds.join(', ')}` });
      return;
    }

    const saved = await firebase.update(path, {
      tagIds,
      updatedAt: Date.now(),
    });
    res.json(publicRecord(saved, tagLookup));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const record = await firebase.get(`${COLLECTION}/${req.params.id}`);
    await stopMount(req.params.id).catch(() => {});
    await firebase.remove(`${COLLECTION}/${req.params.id}`);
    await recountPresetUsageForConfigs(record);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/:id/refresh', async (req, res, next) => {
  try {
    const path = `${COLLECTION}/${req.params.id}`;
    const record = await firebase.get(path);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }

    const updates = await refreshAccessToken(record);
    const saved = await firebase.update(path, updates);
    res.json(publicRecord(saved));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/quota', async (req, res, next) => {
  const path = `${COLLECTION}/${req.params.id}`;
  try {
    let record = await firebase.get(path);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }

    const fetchQuotaWithRetry = async (currentRecord) => {
      return isServiceAccountRecord(currentRecord)
        ? await fetchServiceAccountQuota(currentRecord)
        : await fetchQuota(currentRecord);
    };

    let quota;
    try {
      quota = await fetchQuotaWithRetry(record);
    } catch (err) {
      if (err.status !== 'expired' || isServiceAccountRecord(record) || !record.refreshToken) {
        throw err;
      }
      // Auto-refresh and retry once
      const updates = await refreshAccessToken(record);
      await firebase.update(path, updates);
      record = { ...record, ...updates };
      quota = await fetchQuotaWithRetry(record);
    }

    await firebase.update(path, {
      storageUsed: quota.storageUsed,
      storageTotal: quota.storageTotal,
      driveId: quota.driveId || record.driveId || record.drive_id || '',
      rcloneConfig: quota.driveId ? injectOneDriveDriveId(record.rcloneConfig, quota.driveId, record.driveType) : record.rcloneConfig,
      lastChecked: Date.now(),
      status: 'active',
      updatedAt: Date.now(),
    });
    res.json(quota);
  } catch (err) {
    try {
      await firebase.update(`${COLLECTION}/${req.params.id}`, {
        status: recordStatusFromError(err),
        lastChecked: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (_updateErr) {
      // Keep original error
    }
    next(ensureHttpStatus(err));
  }
});

router.get('/:id/files', async (req, res, next) => {
  const path = `${COLLECTION}/${req.params.id}`;
  try {
    let record = await firebase.get(path);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }

    const listFilesWithRetry = async (currentRecord) => {
      return isServiceAccountRecord(currentRecord)
        ? await listServiceAccountFiles(currentRecord)
        : await listFiles(currentRecord, req.query.pageToken);
    };

    let data;
    try {
      data = await listFilesWithRetry(record);
    } catch (err) {
      if (err.status !== 'expired' || isServiceAccountRecord(record) || !record.refreshToken) {
        throw err;
      }
      const updates = await refreshAccessToken(record);
      await firebase.update(path, updates);
      record = { ...record, ...updates };
      data = await listFilesWithRetry(record);
    }

    await firebase.update(path, {
      lastChecked: Date.now(),
      status: 'active',
      updatedAt: Date.now(),
    });
    res.json(data);
  } catch (err) {
    try {
      await firebase.update(`${COLLECTION}/${req.params.id}`, {
        status: recordStatusFromError(err),
        lastChecked: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (_updateErr) {
      // Keep original error
    }
    next(ensureHttpStatus(err));
  }
});

module.exports = router;
