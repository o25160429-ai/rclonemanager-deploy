const express = require('express');
const firebase = require('../services/firebase');
const { encryptIfConfigured, decryptIfConfigured } = require('../utils/encryption');
const { assertOAuthClientSecret, sanitizeOAuthConfig } = require('../utils/oauthClients');
const {
  publicConfigsForPreset,
  recountAllPresetUsage,
  recountPresetUsage,
} = require('../services/credentialUsage');

const router = express.Router();
const COLLECTION = 'credentials_presets';

function storedConfigCount(record) {
  const count = Number(record?.configCount);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function publicPreset(record) {
  if (!record) return null;
  return {
    ...record,
    clientSecret: decryptIfConfigured(record.clientSecret || ''),
    configCount: storedConfigCount(record),
    configCountedAt: record.configCountedAt || null,
  };
}

function normalizePreset(body, existing = {}) {
  const now = Date.now();
  const preset = sanitizeOAuthConfig({
    label: body.label || existing.label || '',
    provider: body.provider || existing.provider || 'gd',
    clientId: body.clientId || existing.clientId || '',
    clientSecret: body.clientSecret !== undefined ? body.clientSecret : decryptIfConfigured(existing.clientSecret || ''),
    redirectUri: body.redirectUri || existing.redirectUri || 'http://localhost:53682/',
    createdAt: existing.createdAt || now,
    updatedAt: now,
  });
  assertOAuthClientSecret(preset);
  return {
    ...preset,
    clientSecret: encryptIfConfigured(preset.clientSecret),
    configCount: storedConfigCount(existing),
    configCountedAt: existing.configCountedAt || null,
  };
}

router.get('/', async (_req, res, next) => {
  try {
    const records = (await firebase.list(COLLECTION))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const items = records.map(publicPreset);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const preset = normalizePreset(req.body || {});
    if (!preset.label || !preset.clientId || !['gd', 'od'].includes(preset.provider)) {
      res.status(400).json({ error: 'label, provider and clientId are required.' });
      return;
    }
    const saved = await firebase.push(COLLECTION, preset);
    const counted = await recountPresetUsage(saved.id);
    res.status(201).json(publicPreset({ id: saved.id, ...(counted || saved) }));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const path = `${COLLECTION}/${req.params.id}`;
    const existing = await firebase.get(path);
    if (!existing) {
      res.status(404).json({ error: 'Preset not found.' });
      return;
    }
    const updated = await firebase.set(path, {
      ...normalizePreset(req.body || {}, existing),
      id: req.params.id,
    });
    const counted = await recountPresetUsage(req.params.id);
    res.json(publicPreset({ id: req.params.id, ...(counted || updated) }));
  } catch (err) {
    next(err);
  }
});

router.post('/recount', async (_req, res, next) => {
  try {
    await recountAllPresetUsage();
    const records = (await firebase.list(COLLECTION))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const items = records.map(publicPreset);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/configs', async (req, res, next) => {
  try {
    const preset = await firebase.get(`${COLLECTION}/${req.params.id}`);
    if (!preset) {
      res.status(404).json({ error: 'Preset not found.' });
      return;
    }
    const items = await publicConfigsForPreset({ id: req.params.id, ...preset });
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/recount', async (req, res, next) => {
  try {
    const preset = await recountPresetUsage(req.params.id);
    if (!preset) {
      res.status(404).json({ error: 'Preset not found.' });
      return;
    }
    res.json(publicPreset({ id: req.params.id, ...preset }));
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

module.exports = router;
