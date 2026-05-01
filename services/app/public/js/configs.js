(function () {
  let total = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function providerBadge(provider) {
    if (provider === 'gd') return '<span class="badge badge--blue">Google Drive</span>';
    if (provider === 'od') return '<span class="badge badge--purple">OneDrive</span>';
    return '<span class="badge badge--gray">Unknown</span>';
  }

  function storageText(config) {
    if (config.storageUsed === null || config.storageUsed === undefined) return '-';
    const used = window.App.utils.formatBytes(config.storageUsed);
    const totalSize = window.App.utils.formatBytes(config.storageTotal);
    return `${used} / ${totalSize}`;
  }

  function filterQuery() {
    const params = new URLSearchParams({
      limit: String(window.App.state.configPageSize),
      offset: String(window.App.state.currentConfigPage * window.App.state.configPageSize),
    });
    const search = $('configSearch')?.value.trim();
    const provider = $('configProviderFilter')?.value;
    const status = $('configStatusFilter')?.value;
    const startDate = $('configStartDate')?.value;
    const endDate = $('configEndDate')?.value;
    if (search) params.set('search', search);
    if (provider) params.set('provider', provider);
    if (status) params.set('status', status);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return params.toString();
  }

  async function loadConfigs() {
    try {
      const data = await window.App.api.request(`/api/configs?${filterQuery()}`);
      window.App.state.configs = data.items || [];
      total = data.total || 0;
      renderConfigsTable();
      renderPagination();
      if (window.App.Manager) window.App.Manager.refreshOptions();
      if (window.App.RcloneCommands) window.App.RcloneCommands.refreshOptions();
    } catch (err) {
      window.App.utils.toast(`Không tải được configs: ${err.message}`, true);
    }
  }

  function renderConfigsTable() {
    const tbody = $('configsTableBody');
    if (!tbody) return;
    const configs = window.App.state.configs || [];
    if (configs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-tertiary">Chưa có config.</td></tr>';
      return;
    }
    tbody.innerHTML = configs.map((config) => {
      const checked = window.App.state.selectedConfigIds.has(config.id) ? 'checked' : '';
      return `
        <tr>
          <td><input type="checkbox" class="config-select" data-id="${config.id}" aria-label="Select ${escapeHtml(config.remoteName)}" ${checked} /></td>
          <td><strong>${escapeHtml(config.remoteName)}</strong></td>
          <td>${providerBadge(config.provider)}</td>
          <td>${escapeHtml(config.emailOwner)}</td>
          <td><span class="${window.App.utils.statusBadgeClass(config.status)}">${escapeHtml(config.status || 'unknown')}</span></td>
          <td>${escapeHtml(storageText(config))}</td>
          <td>${window.App.utils.formatDate(config.createdAt)}</td>
          <td>
            <div class="table__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-action="view" data-id="${config.id}">👁 View</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="refresh" data-id="${config.id}">🔄 Refresh</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="check" data-id="${config.id}">📊 Check</button>
              <button type="button" class="btn btn--danger btn--sm" data-action="delete" data-id="${config.id}">🗑 Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  function renderPagination() {
    const page = window.App.state.currentConfigPage + 1;
    const totalPages = Math.max(Math.ceil(total / window.App.state.configPageSize), 1);
    $('configsPageText').textContent = `Page ${page} / ${totalPages} (${total})`;
    $('prevConfigsPageBtn').disabled = page <= 1;
    $('nextConfigsPageBtn').disabled = page >= totalPages;
  }

  async function getConfigById(id) {
    const existing = (window.App.state.configs || []).find((item) => item.id === id);
    if (existing) return existing;
    return window.App.api.request(`/api/configs/${id}`);
  }

  async function viewConfig(id) {
    try {
      const config = await getConfigById(id);
      $('configModalTitle').textContent = `${config.remoteName} rclone config`;
      $('configModalOutput').textContent = config.rcloneConfig || '';
      $('configModal').classList.add('modal--open');
    } catch (err) {
      window.App.utils.toast(`Không mở được config: ${err.message}`, true);
    }
  }

  async function refreshConfig(id) {
    try {
      await window.App.api.request(`/api/configs/${id}/refresh`, { method: 'POST' });
      await loadConfigs();
      window.App.utils.toast('Đã refresh token.');
    } catch (err) {
      window.App.utils.toast(`Refresh thất bại: ${err.message}`, true);
    }
  }

  async function checkConfig(id) {
    try {
      await window.App.api.request(`/api/configs/${id}/quota`);
      await loadConfigs();
      window.App.utils.toast('Đã cập nhật quota.');
    } catch (err) {
      window.App.utils.toast(`Check thất bại: ${err.message}`, true);
      await loadConfigs();
    }
  }

  async function deleteConfig(id) {
    if (!confirm('Xóa config này?')) return;
    try {
      await window.App.api.request(`/api/configs/${id}`, { method: 'DELETE' });
      window.App.state.selectedConfigIds.delete(id);
      await loadConfigs();
      window.App.utils.toast('Đã xóa config.');
    } catch (err) {
      window.App.utils.toast(`Không xóa được config: ${err.message}`, true);
    }
  }

  function selectedConfigs() {
    return (window.App.state.configs || []).filter((config) => window.App.state.selectedConfigIds.has(config.id));
  }

  function exportSelected() {
    const configs = selectedConfigs();
    if (configs.length === 0) {
      window.App.utils.toast('Chọn ít nhất một config để export.', true);
      return;
    }
    const text = configs.map((config) => config.rcloneConfig || '').filter(Boolean).join('\n\n');
    window.App.utils.downloadText('rclone-selected.conf', `${text}\n`, 'text/plain');
  }

  async function deleteSelected() {
    const ids = Array.from(window.App.state.selectedConfigIds);
    if (ids.length === 0) {
      window.App.utils.toast('Chọn ít nhất một config để xóa.', true);
      return;
    }
    if (!confirm(`Xóa ${ids.length} config đã chọn?`)) return;
    try {
      await Promise.all(ids.map((id) => window.App.api.request(`/api/configs/${id}`, { method: 'DELETE' })));
      window.App.state.selectedConfigIds.clear();
      await loadConfigs();
      window.App.utils.toast('Đã xóa các config đã chọn.');
    } catch (err) {
      window.App.utils.toast(`Bulk delete thất bại: ${err.message}`, true);
    }
  }

  function serviceAccountRemoteName(email) {
    return `gd-${(String(email || '').split('@')[0] || 'owner').replace(/[^a-z0-9]+/ig, '_')}`;
  }

  function parseServiceAccountJson() {
    let parsed;
    try {
      parsed = JSON.parse($('saJsonInput').value || '{}');
    } catch (_err) {
      throw new Error('Service Account JSON không hợp lệ.');
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Service Account JSON thiếu client_email hoặc private_key.');
    }
    return parsed;
  }

  function fillServiceAccountDefaults(parsed) {
    const ownerInput = $('saEmailOwner');
    const remoteInput = $('saRemoteName');
    if (ownerInput && !ownerInput.value.trim()) ownerInput.value = parsed.client_email || '';
    if (remoteInput && !remoteInput.value.trim()) remoteInput.value = serviceAccountRemoteName(ownerInput?.value || parsed.client_email);
  }

  async function loadServiceAccountJsonFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error('File không phải Service Account JSON hợp lệ.');
      }
      $('saJsonInput').value = JSON.stringify(parsed, null, 2);
      fillServiceAccountDefaults(parsed);
      window.App.utils.toast(`Đã nạp ${file.name}.`);
    } catch (err) {
      event.target.value = '';
      window.App.utils.toast(`Không đọc được file JSON: ${err.message}`, true);
    }
  }

  async function saveServiceAccountConfig() {
    try {
      const parsed = parseServiceAccountJson();
      fillServiceAccountDefaults(parsed);
      const emailOwner = $('saEmailOwner').value.trim();
      const remoteName = $('saRemoteName').value.trim() || serviceAccountRemoteName(emailOwner || parsed.client_email);
      if (!emailOwner) throw new Error('Thiếu email owner.');
      const useApp = $('saRootFolderMode').value === 'appDataFolder';
      const token = { access_token: 'service_account', refresh_token: '', expiry: new Date(Date.now()+31536000000).toISOString() };
      const config = `[${remoteName}]
type = drive
service_account_credentials = ${JSON.stringify(parsed)}
${useApp ? 'root_folder_id = appDataFolder\n' : ''}`;
      await window.App.api.request('/api/configs/save', { method:'POST', body: JSON.stringify({ config: { remoteName, provider:'gd', emailOwner, clientId:'service_account', clientSecret:'', scope:'drive', appDataFolder: useApp }, token, rcloneConfig: config }) });
      window.App.utils.toast('Đã lưu config từ service account JSON.');
      loadConfigs();
    } catch (err) { window.App.utils.toast(`Lưu SA thất bại: ${err.message}`, true); }
  }

  function bindEvents() {
    $('applyConfigFiltersBtn')?.addEventListener('click', () => {
      window.App.state.currentConfigPage = 0;
      loadConfigs();
    });
    $('prevConfigsPageBtn')?.addEventListener('click', () => {
      window.App.state.currentConfigPage = Math.max(window.App.state.currentConfigPage - 1, 0);
      loadConfigs();
    });
    $('nextConfigsPageBtn')?.addEventListener('click', () => {
      window.App.state.currentConfigPage += 1;
      loadConfigs();
    });
    $('selectAllConfigs')?.addEventListener('change', (event) => {
      (window.App.state.configs || []).forEach((config) => {
        if (event.target.checked) window.App.state.selectedConfigIds.add(config.id);
        else window.App.state.selectedConfigIds.delete(config.id);
      });
      renderConfigsTable();
    });
    $('configsTableBody')?.addEventListener('change', (event) => {
      const checkbox = event.target.closest('.config-select');
      if (!checkbox) return;
      if (checkbox.checked) window.App.state.selectedConfigIds.add(checkbox.dataset.id);
      else window.App.state.selectedConfigIds.delete(checkbox.dataset.id);
    });
    $('configsTableBody')?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      if (button.dataset.action === 'view') viewConfig(id);
      if (button.dataset.action === 'refresh') refreshConfig(id);
      if (button.dataset.action === 'check') checkConfig(id);
      if (button.dataset.action === 'delete') deleteConfig(id);
    });
    $('exportSelectedBtn')?.addEventListener('click', exportSelected);
    $('deleteSelectedBtn')?.addEventListener('click', deleteSelected);
    $('closeConfigModalBtn')?.addEventListener('click', () => $('configModal').classList.remove('modal--open'));
    $('configModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'configModal') $('configModal').classList.remove('modal--open');
    });
    $('saveSaConfigBtn')?.addEventListener('click', saveServiceAccountConfig);
    $('saJsonFile')?.addEventListener('change', loadServiceAccountJsonFile);
    $('copyConfigModalBtn')?.addEventListener('click', () => {
      window.App.utils.copyText($('configModalOutput').textContent, 'Đã copy config.');
    });
  }

  function init() {
    bindEvents();
  }

  window.App = window.App || {};
  window.App.Configs = {
    init,
    loadConfigs,
    getConfigById,
  };
})();
