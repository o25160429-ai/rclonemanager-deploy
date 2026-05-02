const express = require('express');
const firebase = require('../services/firebase');
const {
  TAGS_COLLECTION,
  assertUniqueTagName,
  configsForTag,
  listTagsWithCounts,
  normalizeTagPayload,
  publicTag,
  removeTagFromConfigs,
} = require('../services/configTags');

const router = express.Router();

function publicConfigSummary(record) {
  if (!record) return null;
  const { clientSecret, accessToken, refreshToken, rcloneConfig, ...safe } = record;
  return safe;
}

router.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await listTagsWithCounts() });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const tag = normalizeTagPayload(req.body || {});
    if (!tag.name) {
      res.status(400).json({ error: 'Tag name is required.' });
      return;
    }
    await assertUniqueTagName(tag.name);
    const saved = await firebase.push(TAGS_COLLECTION, tag);
    res.status(201).json(publicTag(saved, 0));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/configs', async (req, res, next) => {
  try {
    const tag = await firebase.get(`${TAGS_COLLECTION}/${req.params.id}`);
    if (!tag) {
      res.status(404).json({ error: 'Tag not found.' });
      return;
    }
    const items = (await configsForTag(req.params.id)).map(publicConfigSummary);
    res.json({ items, total: items.length, tag: publicTag({ id: req.params.id, ...tag }, items.length) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const path = `${TAGS_COLLECTION}/${req.params.id}`;
    const existing = await firebase.get(path);
    if (!existing) {
      res.status(404).json({ error: 'Tag not found.' });
      return;
    }
    const tag = normalizeTagPayload(req.body || {}, existing);
    if (!tag.name) {
      res.status(400).json({ error: 'Tag name is required.' });
      return;
    }
    await assertUniqueTagName(tag.name, req.params.id);
    const saved = await firebase.set(path, { ...tag, id: req.params.id });
    const configs = await configsForTag(req.params.id);
    res.json(publicTag({ id: req.params.id, ...saved }, configs.length));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const path = `${TAGS_COLLECTION}/${req.params.id}`;
    const existing = await firebase.get(path);
    if (!existing) {
      res.status(404).json({ error: 'Tag not found.' });
      return;
    }
    await removeTagFromConfigs(req.params.id);
    await firebase.remove(path);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
