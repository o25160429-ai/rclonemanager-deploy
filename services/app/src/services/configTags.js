const firebase = require('./firebase');

const TAGS_COLLECTION = 'config_tags';
const CONFIGS_COLLECTION = 'rclone_configs';
const DEFAULT_TAG_COLOR = '#2563eb';
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeColor(value) {
  const color = String(value || '').trim();
  return COLOR_RE.test(color) ? color.toLowerCase() : DEFAULT_TAG_COLOR;
}

function normalizeTagIds(value) {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === 'string'
      ? value.split(',')
      : (value && typeof value === 'object' ? Object.values(value) : []));
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean)));
}

function publicTag(record, configCount = 0) {
  if (!record) return null;
  return {
    ...record,
    name: normalizeName(record.name),
    color: normalizeColor(record.color),
    description: String(record.description || '').trim(),
    configCount,
  };
}

function tagIdsForRecord(record) {
  return normalizeTagIds(record?.tagIds || record?.tags);
}

function countConfigsForTag(configs, tagId) {
  return configs.filter((config) => tagIdsForRecord(config).includes(tagId)).length;
}

async function listTagsWithCounts() {
  const [tags, configs] = await Promise.all([
    firebase.list(TAGS_COLLECTION),
    firebase.list(CONFIGS_COLLECTION),
  ]);
  return tags
    .map((tag) => publicTag(tag, countConfigsForTag(configs, tag.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }));
}

async function tagsById() {
  const items = await listTagsWithCounts();
  return new Map(items.map((tag) => [tag.id, tag]));
}

function tagsForConfig(record, lookup) {
  return tagIdsForRecord(record)
    .map((tagId) => lookup.get(tagId))
    .filter(Boolean)
    .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));
}

function normalizeTagPayload(body = {}, existing = {}) {
  const now = Date.now();
  return {
    name: normalizeName(body.name ?? existing.name),
    color: normalizeColor(body.color ?? existing.color),
    description: String(body.description ?? existing.description ?? '').trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

async function assertUniqueTagName(name, currentId = '') {
  const normalized = normalizeName(name).toLowerCase();
  const tags = await firebase.list(TAGS_COLLECTION);
  const duplicate = tags.find((tag) =>
    tag.id !== currentId && normalizeName(tag.name).toLowerCase() === normalized);
  if (duplicate) {
    const err = new Error('Tag name already exists.');
    err.status = 409;
    throw err;
  }
}

async function removeTagFromConfigs(tagId) {
  const configs = await firebase.list(CONFIGS_COLLECTION);
  await Promise.all(configs.map(async (config) => {
    const tagIds = tagIdsForRecord(config);
    if (!tagIds.includes(tagId)) return;
    await firebase.update(`${CONFIGS_COLLECTION}/${config.id}`, {
      tagIds: tagIds.filter((id) => id !== tagId),
      updatedAt: Date.now(),
    });
  }));
}

async function configsForTag(tagId) {
  const configs = await firebase.list(CONFIGS_COLLECTION);
  return configs
    .filter((config) => tagIdsForRecord(config).includes(tagId))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
}

module.exports = {
  TAGS_COLLECTION,
  normalizeTagIds,
  normalizeTagPayload,
  publicTag,
  listTagsWithCounts,
  tagsById,
  tagsForConfig,
  tagIdsForRecord,
  assertUniqueTagName,
  removeTagFromConfigs,
  configsForTag,
};
