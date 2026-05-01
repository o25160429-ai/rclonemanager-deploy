(function () {
  const CACHE_KEY = 'credentials-presets-cache';
  const RCLONE_GDRIVE_CLIENT_ID = '202264815644.apps.googleusercontent.com';
  const RCLONE_GDRIVE_CLIENT_SECRET = 'X4Z3ca8xfWDb1Voo-F9a7ZxJ';
  const RCLONE_ONEDRIVE_CLIENT_ID = 'b15665d9-eda6-4092-8539-0eec376afd59';
  const RCLONE_ONEDRIVE_CLIENT_SECRET = 'qtyfaBBYA403=unZUP40~_#';
  const AZURE_SECRET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const revealedSecrets = new Set();

  function $(id) {
    return document.getElementById(id);
  }

  function providerLabel(provider) {
    return provider === 'gd' ? 'Google Drive' : 'OneDrive';
  }

  function normalizeClientId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isRcloneOneDrivePublicClient(preset) {
    return preset.provider === 'od' && normalizeClientId(preset.clientId) === RCLONE_ONEDRIVE_CLIENT_ID;
  }

  function isRcloneGDrivePublicClient(preset) {
    return preset.provider === 'gd' && normalizeClientId(preset.clientId) === RCLONE_GDRIVE_CLIENT_ID;
  }

  function looksLikeAzureSecretId(value) {
    return AZURE_SECRET_ID_RE.test(String(value || '').trim());
  }

  function cachePresets(items) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items || []));
  }

  function readCachedPresets() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    } catch (_err) {
      return [];
    }
  }

  async function loadPresets() {
    try {
      const data = await window.App.api.request('/api/presets');
      window.App.state.presets = data.items || [];
      cachePresets(window.App.state.presets);
    } catch (err) {
      window.App.state.presets = readCachedPresets();
      if (window.App.state.presets.length === 0) {
        window.App.utils.toast(`Không tải được presets: ${err.message}`, true);
      }
    }
    renderPresetsTable();
    window.App.OAuth?.renderPresetOptions();
  }

  function renderPresetsTable() {
    const tbody = $('credentialsTableBody');
    if (!tbody) return;
    const presets = window.App.state.presets || [];
    if (presets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-tertiary">Chưa có preset.</td></tr>';
      return;
    }
    tbody.innerHTML = presets.map((preset) => {
      const secretVisible = revealedSecrets.has(preset.id);
      const secret = preset.clientSecret || '';
      const displaySecret = secretVisible ? escapeHtml(secret || '(empty)') : '••••••••';
      return `
        <tr>
          <td>${escapeHtml(preset.label)}</td>
          <td><span class="badge ${preset.provider === 'gd' ? 'badge--blue' : 'badge--purple'}">${providerLabel(preset.provider)}</span></td>
          <td><code>${escapeHtml(compact(preset.clientId))}</code></td>
          <td>${displaySecret}</td>
          <td><code>${escapeHtml(preset.redirectUri || '')}</code></td>
          <td>
            <div class="table__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-action="toggle" data-id="${preset.id}" aria-label="Toggle client secret visibility">👁</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="test" data-id="${preset.id}">Test</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="edit" data-id="${preset.id}">Edit</button>
              <button type="button" class="btn btn--danger btn--sm" data-action="delete" data-id="${preset.id}">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function compact(value) {
    const text = String(value || '');
    if (text.length <= 32) return text;
    return `${text.slice(0, 16)}...${text.slice(-8)}`;
  }

  function openModal(preset) {
    $('credentialId').value = preset?.id || '';
    $('credentialLabel').value = preset?.label || '';
    $('credentialProvider').value = preset?.provider || 'gd';
    $('credentialClientId').value = preset?.clientId || '';
    $('credentialClientSecret').value = preset?.clientSecret || '';
    $('credentialClientSecret').type = 'password';
    $('credentialRedirectUri').value = preset?.redirectUri || `${window.App.api.baseUrl}/`;
    $('credentialModal').classList.add('modal--open');
    $('credentialLabel').focus();
  }

  function closeModal() {
    $('credentialModal').classList.remove('modal--open');
  }

  async function submitPreset(event) {
    event.preventDefault();
    const id = $('credentialId').value;
    let payload = {
      label: $('credentialLabel').value.trim(),
      provider: $('credentialProvider').value,
      clientId: $('credentialClientId').value.trim(),
      clientSecret: $('credentialClientSecret').value,
      redirectUri: $('credentialRedirectUri').value.trim() || `${window.App.api.baseUrl}/`,
    };
    if (!payload.label || !payload.clientId) {
      window.App.utils.toast('Label và Client ID là bắt buộc.', true);
      return;
    }
    if (isRcloneGDrivePublicClient(payload)) {
      payload = { ...payload, clientSecret: RCLONE_GDRIVE_CLIENT_SECRET };
    } else if (isRcloneOneDrivePublicClient(payload)) {
      payload = { ...payload, clientSecret: RCLONE_ONEDRIVE_CLIENT_SECRET };
    } else if (payload.clientSecret && looksLikeAzureSecretId(payload.clientSecret)) {
      window.App.utils.toast('Client Secret đang giống Azure Secret ID. Hãy copy cột Value trong Azure Certificates & secrets.', true);
      return;
    }

    try {
      await window.App.api.request(id ? `/api/presets/${id}` : '/api/presets', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      closeModal();
      await loadPresets();
      window.App.utils.toast('Đã lưu preset.');
    } catch (err) {
      window.App.utils.toast(`Không lưu được preset: ${err.message}`, true);
    }
  }

  async function deletePreset(id) {
    if (!confirm('Xóa preset này?')) return;
    try {
      await window.App.api.request(`/api/presets/${id}`, { method: 'DELETE' });
      await loadPresets();
      window.App.utils.toast('Đã xóa preset.');
    } catch (err) {
      window.App.utils.toast(`Không xóa được preset: ${err.message}`, true);
    }
  }

  function testPreset(id) {
    const preset = (window.App.state.presets || []).find((item) => item.id === id);
    if (!preset) return;
    const redirectUri = preset.redirectUri || `${window.App.api.baseUrl}/`;
    const state = btoa(JSON.stringify({ nonce: Math.random().toString(36).slice(2), test: true }));
    const url = preset.provider === 'gd'
      ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: preset.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
        access_type: 'offline',
        prompt: 'consent',
        state,
      })}`
      : `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({
        client_id: preset.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://graph.microsoft.com/Files.ReadWrite offline_access',
        response_mode: 'query',
        state,
      })}`;
    window.open(url, '_blank', 'noopener');
  }



  function parseCredentialsText(raw) {
    const text = String(raw || '');
    const picks = { clientId: '', clientSecret: '' };
    const patterns = [
      /client[_ -]?id["'=: ]+([a-z0-9._-]{12,}\.apps\.googleusercontent\.com)/i,
      /client[_ -]?id["'=: ]+([0-9a-f-]{36})/i,
      /application\s*\(client\)\s*id["'\s:]+([0-9a-f-]{36})/i,
      /client[_ -]?secret["'=: ]+([A-Za-z0-9~._\-#=]{16,128})/i,
      /"client_secret"\s*:\s*"([^"]{16,128})"/i
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      if (!picks.clientId && (m[1].includes('apps.googleusercontent.com') || /^[0-9a-f-]{36}$/i.test(m[1]))) picks.clientId = m[1];
      if (!picks.clientSecret && m[1].length >= 16 && !/apps\.googleusercontent\.com/i.test(m[1]) && !/^[0-9a-f-]{36}$/i.test(m[1])) picks.clientSecret = m[1];
    }
    return picks;
  }

  function bindEvents() {
    $('addCredentialBtn')?.addEventListener('click', () => openModal());
    $('refreshCredentialsBtn')?.addEventListener('click', loadPresets);
    $('credentialForm')?.addEventListener('submit', submitPreset);
    $('closeCredentialModalBtn')?.addEventListener('click', closeModal);
    $('cancelCredentialBtn')?.addEventListener('click', closeModal);
    $('toggleCredentialSecretBtn')?.addEventListener('click', () => {
      const input = $('credentialClientSecret');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
    $('credentialModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'credentialModal') closeModal();
    });
    $('parseCredentialQuickBtn')?.addEventListener('click', () => { const p = parseCredentialsText($('credentialQuickPaste')?.value); if (p.clientId || p.clientSecret) { openModal(); if (p.clientId) $('credentialClientId').value=p.clientId; if (p.clientSecret) $('credentialClientSecret').value=p.clientSecret; window.App.utils.toast('Đã parse dữ liệu vào form preset.'); } else window.App.utils.toast('Không parse được Client ID/Secret, vui lòng dán rõ hơn.', true); });
    $('credentialsTableBody')?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const preset = (window.App.state.presets || []).find((item) => item.id === id);
      if (button.dataset.action === 'toggle') {
        if (revealedSecrets.has(id)) revealedSecrets.delete(id);
        else revealedSecrets.add(id);
        renderPresetsTable();
      }
      if (button.dataset.action === 'test') testPreset(id);
      if (button.dataset.action === 'edit') openModal(preset);
      if (button.dataset.action === 'delete') deletePreset(id);
    });
  }

  function clearCache() {
    localStorage.removeItem(CACHE_KEY);
  }

  function init() {
    bindEvents();
  }

  window.App = window.App || {};
  window.App.Credentials = {
    init,
    loadPresets,
    clearCache,
  };
})();
