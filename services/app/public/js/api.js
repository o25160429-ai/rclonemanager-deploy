(function () {
  function authSessionToken() { return localStorage.getItem('google-session-token') || ''; }

  const backendBase = window.location.protocol === 'file:' ? 'http://localhost:53682' : window.location.origin;

  window.App = window.App || {};
  window.App.state = {
    backend: {
      online: false,
      firebase: 'unknown',
      version: '1.0.0',
      mode: 'unknown',
      runnerCommitShortId: '',
      runnerCommitAt: '',
      deployCodeEnabled: false,
    },
    presets: [],
    tags: [],
    configs: [],
    savedRcloneCommands: [],
    selectedConfigIds: new Set(),
    currentConfigPage: 0,
    configPageSize: 20,
  };

  async function request(path, options = {}) {
    const { allowStatuses = [], headers = {}, ...fetchOptions } = options;
    const response = await fetch(`${backendBase}${path}`, {
      credentials: window.location.protocol === 'file:' ? 'omit' : 'same-origin',
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(authSessionToken() ? { Authorization: `Bearer ${authSessionToken()}` } : {}),
        ...headers,
      },
    });

    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok && !allowStatuses.includes(response.status)) {
      const message = data && data.error ? data.error : `HTTP ${response.status}`;
      const err = new Error(message);
      err.status = response.status;
      throw err;
    }
    return data;
  }

  async function checkBackend(timeoutMs = 2000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${backendBase}/health`, {
        credentials: window.location.protocol === 'file:' ? 'omit' : 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json();
      window.App.state.backend = {
        online: response.ok,
        firebase: data.firebase || 'unknown',
        version: data.version || '1.0.0',
        mode: data.firebaseMode || 'unknown',
        message: data.message || '',
        runnerCommitShortId: data.runnerCommitShortId || '',
        runnerCommitAt: data.runnerCommitAt || '',
        deployCodeEnabled: Boolean(data.deployCodeEnabled),
      };
      return window.App.state.backend;
    } catch (err) {
      window.App.state.backend = {
        online: false,
        firebase: 'error',
        version: '1.0.0',
        mode: 'offline',
        message: err.message,
        runnerCommitShortId: '',
        runnerCommitAt: '',
        deployCodeEnabled: false,
      };
      return window.App.state.backend;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function toast(message, isError = false) {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const el = document.createElement('div');
    el.className = `toast${isError ? ' toast--error' : ''}`;
    el.textContent = message;
    region.appendChild(el);
    window.setTimeout(() => el.remove(), 3200);
  }

  async function copyText(text, message = 'Đã copy.') {
    await navigator.clipboard.writeText(text || '');
    toast(message);
  }

  function formatBytes(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    const bytes = Number(value);
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
  }

  function formatDate(value) {
    if (!value || value === '-') return value || '-';
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return value;
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `1.${yy}.${mm}${dd}.${hh}${min}`;
    } catch (_err) {
      return value;
    }
  }

  function downloadText(filename, text, type = 'text/plain') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function statusBadgeClass(status) {
    if (status === 'active') return 'badge badge--green';
    if (status === 'expired') return 'badge badge--yellow';
    if (status === 'error') return 'badge badge--red';
    return 'badge badge--gray';
  }

  window.App.api = {
    baseUrl: backendBase,
    request,
    checkBackend,
  };
  window.App.utils = {
    toast,
    copyText,
    formatBytes,
    formatDate,
    downloadText,
    statusBadgeClass,
  };
})();
