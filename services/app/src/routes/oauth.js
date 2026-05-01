const express = require('express');
const firebase = require('../services/firebase');
const { parseStateParam } = require('../utils/stateParser');
const { exchangeOAuthCode } = require('../services/tokenExchange');
const { COLLECTION, upsertByEmailOwner } = require('../services/configStore');
const { fetchOneDriveDrive } = require('../services/cloudApi');
const { runRclone } = require('../services/rcloneRunner');
const { injectOneDriveDriveId, normalizeConfigRecord } = require('../utils/configBuilder');
const { decryptIfConfigured, encryptIfConfigured } = require('../utils/encryption');
const { sanitizeOAuthConfig } = require('../utils/oauthClients');
const { recountPresetUsageForConfigs } = require('../services/credentialUsage');

const router = express.Router();
const PRESETS_COLLECTION = 'credentials_presets';

function requestBaseUrl(req) {
  const host = req.get('host');
  if (!host) return 'http://localhost:53682/';

  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${host}/`;
}

function frontendRedirect(req, params) {
  const base = process.env.FRONTEND_URL || requestBaseUrl(req);
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function publicRecord(record) {
  if (!record) return null;
  const { clientSecret, ...safe } = record;
  safe.driveId = safe.driveId || safe.drive_id || '';
  if (safe.provider === 'od' && safe.driveId) {
    safe.rcloneConfig = injectOneDriveDriveId(safe.rcloneConfig, safe.driveId, safe.driveType);
  }
  return safe;
}

function publicOAuthPreset(record) {
  if (!record) return null;
  return {
    id: record.id || '',
    label: record.label || '',
    provider: record.provider || 'gd',
    clientId: record.clientId || '',
    redirectUri: record.redirectUri || '',
    hasClientSecret: Boolean(record.clientSecret),
    storedSecret: true,
  };
}

function normalizeRequestConfig(body) {
  const cfg = body.config || body.cfg || body;
  return sanitizeOAuthConfig({
    clientId: String(cfg.clientId || '').trim(),
    clientSecret: cfg.clientSecret ? String(cfg.clientSecret) : '',
    presetId: String(cfg.presetId || cfg.preset_id || '').trim(),
    emailOwner: String(cfg.emailOwner || cfg.email_owner || '').trim(),
    provider: cfg.provider,
    remoteName: String(cfg.remoteName || '').trim(),
    scope: cfg.scope || 'drive',
    driveType: cfg.driveType || 'personal',
    redirectUri: String(cfg.redirectUri || '').trim(),
  });
}

function normalizedClientId(value) {
  return String(value || '').trim().toLowerCase();
}

async function findPresetByClientId(cfg) {
  const clientId = normalizedClientId(cfg.clientId);
  if (!clientId || !cfg.provider) return null;
  const presets = await firebase.list(PRESETS_COLLECTION);
  return presets
    .filter((preset) => String(preset.provider || '') === String(cfg.provider || '')
      && normalizedClientId(preset.clientId) === clientId)
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0] || null;
}

function configWithPresetSecret(cfg, preset) {
  if (!preset) return cfg;
  return sanitizeOAuthConfig({
    ...cfg,
    presetId: cfg.presetId || preset.id || '',
    clientId: preset.clientId || cfg.clientId,
    clientSecret: cfg.clientSecret || decryptIfConfigured(preset.clientSecret || ''),
    redirectUri: cfg.redirectUri || preset.redirectUri || '',
  });
}

async function resolvePresetConfig(cfg) {
  if (cfg.clientId && cfg.clientSecret) return cfg;

  let preset = null;
  if (cfg.presetId) {
    preset = await firebase.get(`${PRESETS_COLLECTION}/${cfg.presetId}`);
    if (!preset) {
      const err = new Error('OAuth preset not found.');
      err.status = 404;
      throw err;
    }
    preset = { id: cfg.presetId, ...preset };
  } else if (!cfg.clientSecret) {
    preset = await findPresetByClientId(cfg);
  }

  if (!preset) return cfg;

  if (preset.provider && preset.provider !== cfg.provider) {
    const err = new Error('OAuth preset provider does not match selected provider.');
    err.status = 400;
    throw err;
  }
  return configWithPresetSecret(cfg, preset);
}

function validateExchangeInput(code, cfg) {
  const missing = [];
  if (!code) missing.push('code');
  if (!cfg.clientId) missing.push('clientId');
  if (!cfg.emailOwner) missing.push('emailOwner');
  if (!cfg.provider) missing.push('provider');
  if (!cfg.remoteName) missing.push('remoteName');
  if (!cfg.redirectUri) missing.push('redirectUri');
  if (missing.length > 0) {
    const err = new Error(`Missing OAuth exchange fields: ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (!['gd', 'od'].includes(cfg.provider)) {
    const err = new Error('Unsupported OAuth provider.');
    err.status = 400;
    throw err;
  }
  try {
    new URL(cfg.redirectUri);
  } catch (_err) {
    const err = new Error('redirectUri must be a valid URL.');
    err.status = 400;
    throw err;
  }
}

async function exchangeAndSave(code, cfg) {
  const resolvedCfg = await resolvePresetConfig(cfg);
  const token = await exchangeOAuthCode(resolvedCfg, code);
  if (resolvedCfg.provider === 'od' && token.access_token) {
    const drive = await fetchOneDriveDrive(token.access_token);
    resolvedCfg.driveId = drive.id || '';
  }

  const record = normalizeConfigRecord(resolvedCfg, token);
  record.clientSecret = encryptIfConfigured(record.clientSecret);
  const saved = await upsertByEmailOwner(record);
  await recountPresetUsageForConfigs([saved.record, saved.previousRecord]);
  return {
    cfg: resolvedCfg,
    token,
    saved,
  };
}

function rcloneConfigForRecord(record) {
  const driveId = record.driveId || record.drive_id || '';
  if (record.provider === 'od' && driveId) {
    return injectOneDriveDriveId(record.rcloneConfig || '', driveId, record.driveType);
  }
  return record.rcloneConfig || '';
}

async function runRecordAbout(record) {
  return runRclone({
    command: ['about', `${record.remoteName}:`, '--json'],
    configText: rcloneConfigForRecord(record),
    outputMode: 'json',
    timeoutMs: 120000,
  });
}

async function handleOAuthCallback(req, res) {
  if (req.query.error) {
    const detail = req.query.error_description || req.query.error;
    res.redirect(frontendRedirect(req, { error: detail }));
    return;
  }

  try {
    const cfg = parseStateParam(req.query.state);
    const { saved } = await exchangeAndSave(req.query.code, cfg);

    res.redirect(frontendRedirect(req, {
      saved: 'true',
      id: saved.record.id,
      remote: saved.record.remoteName,
      action: saved.action,
    }));
  } catch (err) {
    res.redirect(frontendRedirect(req, { error: err.message }));
  }
}

router.post('/exchange', async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim();
    const cfg = normalizeRequestConfig(req.body || {});
    validateExchangeInput(code, cfg);

    const { saved } = await exchangeAndSave(code, cfg);
    res.status(saved.action === 'created' ? 201 : 200).json({
      action: saved.action,
      record: publicRecord(saved.record),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/presets', async (_req, res, next) => {
  try {
    const items = (await firebase.list(PRESETS_COLLECTION))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .map(publicOAuthPreset);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/result/:id', async (req, res, next) => {
  try {
    const record = await firebase.get(`${COLLECTION}/${req.params.id}`);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }
    res.json({ record: publicRecord(record) });
  } catch (err) {
    next(err);
  }
});

router.post('/check/:id', async (req, res, next) => {
  try {
    const record = await firebase.get(`${COLLECTION}/${req.params.id}`);
    if (!record) {
      res.status(404).json({ error: 'Config not found.' });
      return;
    }
    const result = await runRecordAbout(record);
    res.status(result.exitCode === 0 && !result.timedOut ? 200 : 422).json(result);
  } catch (err) {
    if (err.code === 'ENOENT') {
      err.message = 'rclone executable was not found in PATH.';
      err.status = 500;
    }
    next(err);
  }
});

module.exports = {
  handleOAuthCallback,
  router,
};
