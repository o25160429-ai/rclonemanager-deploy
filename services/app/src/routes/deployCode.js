const express = require('express');

const router = express.Router();

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function isEnabled() {
  return envFlag('DOCKER_DEPLOY_CODE_ENABLED', false)
    && envFlag('DOCKER_DEPLOY_CODE_APP_PROXY_ENABLED', true);
}

function sidecarBaseUrl() {
  const explicit = String(process.env.DOCKER_DEPLOY_CODE_INTERNAL_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = String(process.env.DOCKER_DEPLOY_CODE_PORT || '53999').trim() || '53999';
  return `http://deploy-code:${port}`;
}

function sidecarHeaders(extra = {}) {
  const token = String(process.env.DOCKER_DEPLOY_CODE_API_TOKEN || '').trim();
  return {
    ...(token ? { 'x-deploy-code-token': token } : {}),
    ...extra,
  };
}

async function parseSidecarResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text();
  if (!response.ok) {
    const err = new Error(data?.error || data || `deploy-code HTTP ${response.status}`);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data;
}


function queryStringFrom(req) {
  const search = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => search.append(key, String(item)));
    else if (value !== undefined && value !== null) search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function requestJson(pathname, options = {}) {
  if (!isEnabled()) {
    const err = new Error('deploy-code sidecar is disabled. Set DOCKER_DEPLOY_CODE_ENABLED=true.');
    err.status = 404;
    throw err;
  }
  const response = await fetch(`${sidecarBaseUrl()}${pathname}`, {
    method: options.method || 'GET',
    headers: sidecarHeaders(options.body ? { 'content-type': 'application/json' } : {}),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return parseSidecarResponse(response);
}

router.get('/status', async (_req, res, next) => {
  try {
    res.json(await requestJson('/status'));
  } catch (err) { next(err); }
});

router.get('/logs', async (req, res, next) => {
  try {
    if (!isEnabled()) {
      const err = new Error('deploy-code sidecar is disabled. Set DOCKER_DEPLOY_CODE_ENABLED=true.');
      err.status = 404;
      throw err;
    }
    const lines = encodeURIComponent(String(req.query.lines || '200'));
    const response = await fetch(`${sidecarBaseUrl()}/logs?lines=${lines}`, {
      headers: sidecarHeaders(),
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error(text || `deploy-code HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }
    res.type('text/plain').send(text);
  } catch (err) { next(err); }
});

router.post('/check', async (req, res, next) => {
  try {
    res.json(await requestJson('/check', { method: 'POST', body: req.body || {} }));
  } catch (err) { next(err); }
});

router.post('/deploy', async (req, res, next) => {
  try {
    res.json(await requestJson('/deploy', { method: 'POST', body: req.body || {} }));
  } catch (err) { next(err); }
});

router.post('/upload-zip', async (req, res, next) => {
  try {
    if (!isEnabled()) {
      const err = new Error('deploy-code sidecar is disabled. Set DOCKER_DEPLOY_CODE_ENABLED=true.');
      err.status = 404;
      throw err;
    }
    const headers = sidecarHeaders({
      'content-type': req.get('content-type') || 'application/zip',
    });
    const fileName = req.get('x-file-name');
    if (fileName) headers['x-file-name'] = fileName;
    const response = await fetch(`${sidecarBaseUrl()}/upload-zip`, {
      method: 'POST',
      headers,
      body: req,
      duplex: 'half',
    });
    const data = await parseSidecarResponse(response);
    res.json(data);
  } catch (err) { next(err); }
});


router.get('/services', async (_req, res, next) => {
  try {
    res.json(await requestJson('/services'));
  } catch (err) { next(err); }
});

router.get('/containers', async (req, res, next) => {
  try {
    res.json(await requestJson(`/containers${queryStringFrom(req)}`));
  } catch (err) { next(err); }
});

router.get('/containers/logs', async (req, res, next) => {
  try {
    res.json(await requestJson(`/containers/logs${queryStringFrom(req)}`));
  } catch (err) { next(err); }
});

router.post('/containers/logs', async (req, res, next) => {
  try {
    res.json(await requestJson('/containers/logs', { method: 'POST', body: req.body || {} }));
  } catch (err) { next(err); }
});

router.get('/containers/inspect', async (req, res, next) => {
  try {
    res.json(await requestJson(`/containers/inspect${queryStringFrom(req)}`));
  } catch (err) { next(err); }
});

router.post('/containers/inspect', async (req, res, next) => {
  try {
    res.json(await requestJson('/containers/inspect', { method: 'POST', body: req.body || {} }));
  } catch (err) { next(err); }
});

router.post('/containers/action', async (req, res, next) => {
  try {
    res.json(await requestJson('/containers/action', { method: 'POST', body: req.body || {} }));
  } catch (err) { next(err); }
});

['start', 'stop', 'restart', 'rebuild', 'up'].forEach((action) => {
  router.post(`/containers/${action}`, async (req, res, next) => {
    try {
      res.json(await requestJson(`/containers/${action}`, { method: 'POST', body: req.body || {} }));
    } catch (err) { next(err); }
  });
});

module.exports = router;
