const express = require('express');
const firebase = require('../services/firebase');
const { COLLECTION, upsertByEmailOwner } = require('../services/configStore');
const { injectOneDriveDriveId, normalizeConfigRecord } = require('../utils/configBuilder');
const { encryptIfConfigured } = require('../utils/encryption');
const { refreshAccessToken } = require('../services/tokenRefresh');
const { fetchQuota, listFiles } = require('../services/cloudApi');

const router = express.Router();

function publicRecord(record) {
  if (!record) return null;
  const { clientSecret, ...safe } = record;
  safe.driveId = safe.driveId || safe.drive_id || '';
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
  const search = String(query.search || query.email || '').trim().toLowerCase();
  const start = query.startDate ? new Date(query.startDate).getTime() : null;
  const end = query.endDate ? new Date(query.endDate).getTime() + 86400000 - 1 : null;

  return items.filter((item) => {
    if (provider && item.provider !== provider) return false;
    if (status && item.status !== status) return false;
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
    res.status(saved.action === 'created' ? 201 : 200).json(publicRecord(saved.record));
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const all = await firebase.list(COLLECTION);
    const filtered = applyFilters(all, req.query)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    res.json({
      items: filtered.slice(offset, offset + limit).map(publicRecord),
      total: filtered.length,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const record = await firebase.get(`${COLLECTION}/${req.params.id}`);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }
    res.json(publicRecord(record));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await firebase.remove(`${COLLECTION}/${req.params.id}`);
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
  try {
    const path = `${COLLECTION}/${req.params.id}`;
    const record = await firebase.get(path);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }

    const quota = await fetchQuota(record);
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
        status: err.status || 'error',
        lastChecked: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (_updateErr) {
      // Keep the original cloud API error.
    }
    next(err);
  }
});

router.get('/:id/files', async (req, res, next) => {
  try {
    const path = `${COLLECTION}/${req.params.id}`;
    const record = await firebase.get(path);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }

    const data = await listFiles(record, req.query.pageToken);
    await firebase.update(path, {
      lastChecked: Date.now(),
      status: 'active',
      updatedAt: Date.now(),
    });
    res.json(data);
  } catch (err) {
    try {
      await firebase.update(`${COLLECTION}/${req.params.id}`, {
        status: err.status || 'error',
        lastChecked: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (_updateErr) {
      // Keep the original cloud API error.
    }
    next(err);
  }
});

module.exports = router;
