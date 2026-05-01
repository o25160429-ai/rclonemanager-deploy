const firebase = require('./firebase');
const { COLLECTION: CONFIGS_COLLECTION } = require('./configStore');

const PRESETS_COLLECTION = 'credentials_presets';

function normalizeClientId(value) {
  return String(value || '').trim().toLowerCase();
}

function isConfigUsingPreset(config, preset) {
  if (!config || !preset) return false;
  const explicitPresetId = String(config.credentialPresetId || config.presetId || '');
  if (explicitPresetId) return explicitPresetId === String(preset.id || '');
  return String(config.provider || '') === String(preset.provider || '')
    && normalizeClientId(config.clientId) === normalizeClientId(preset.clientId);
}

function publicConfigUsage(record) {
  if (!record) return null;
  return {
    id: record.id,
    remoteName: record.remoteName || '',
    provider: record.provider || '',
    emailOwner: record.emailOwner || '',
    status: record.status || 'unknown',
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    credentialPresetId: record.credentialPresetId || record.presetId || '',
  };
}

async function configsForPreset(preset) {
  const configs = await firebase.list(CONFIGS_COLLECTION);
  return configs
    .filter((config) => isConfigUsingPreset(config, preset))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
}

async function countConfigsForPreset(preset) {
  return (await configsForPreset(preset)).length;
}

async function recountPresetUsage(id) {
  const path = `${PRESETS_COLLECTION}/${id}`;
  const preset = await firebase.get(path);
  if (!preset) return null;
  const presetWithId = { id, ...preset };
  const count = await countConfigsForPreset(presetWithId);
  return firebase.update(path, {
    configCount: count,
    configCountedAt: Date.now(),
  });
}

async function recountAllPresetUsage() {
  const presets = await firebase.list(PRESETS_COLLECTION);
  const updated = [];
  for (const preset of presets) {
    updated.push(await recountPresetUsage(preset.id));
  }
  return updated;
}

async function recountPresetUsageForConfigs(configs) {
  const candidates = (Array.isArray(configs) ? configs : [configs]).filter(Boolean);
  if (candidates.length === 0) return [];

  const presets = await firebase.list(PRESETS_COLLECTION);
  const presetIds = new Set();
  for (const preset of presets) {
    if (candidates.some((config) => isConfigUsingPreset(config, preset))) {
      presetIds.add(preset.id);
    }
  }

  const updated = [];
  for (const id of presetIds) {
    updated.push(await recountPresetUsage(id));
  }
  return updated;
}

async function publicConfigsForPreset(preset) {
  return (await configsForPreset(preset)).map(publicConfigUsage);
}

module.exports = {
  countConfigsForPreset,
  publicConfigsForPreset,
  recountAllPresetUsage,
  recountPresetUsage,
  recountPresetUsageForConfigs,
};
