(function () {
  const CONFIG_VIEW_KEY = 'configs-view-mode';
  let total = 0;
  let mountsById = new Map();
  const pendingMountIds = new Set();
  let configViewMode = normalizeViewMode(localStorage.getItem(CONFIG_VIEW_KEY) || 'list');

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

  function normalizeViewMode(value) {
    return ['list', 'card', 'grid'].includes(value) ? value : 'list';
  }

  function applyConfigViewMode() {
    const mode = normalizeViewMode(configViewMode);
    const wrap = $('configsTableWrap');
    const select = $('configViewMode');
    if (select) select.value = mode;
    if (!wrap) return;
    wrap.classList.remove('configs-view-list', 'configs-view-card', 'configs-view-grid');
    wrap.classList.add(`configs-view-${mode}`);
  }

  function mountBadge(mount) {
    if (!mount) return '<span class="badge badge--gray">Not mounted</span>';
    if (mount.status === 'mounted') return '<span class="badge badge--green">Mounted</span>';
    if (mount.status === 'mounting' || mount.status === 'unmounting') return `<span class="badge badge--yellow">${escapeHtml(mount.status)}</span>`;
    if (mount.status === 'error') return '<span class="badge badge--red">Mount error</span>';
    return '<span class="badge badge--gray">Not mounted</span>';
  }

  function mountPathText(mount) {
    if (!mount?.hostPath) return '';
    const detail = mount.filebrowserRelativePath ? `Filebrowser: ${mount.filebrowserRelativePath}` : mount.hostPath;
    return `<span class="config-mount__path" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>`;
  }

  function filterQuery() {
    const params = new URLSearchParams({
      limit: String(window.App.state.configPageSize),
      offset: String(window.App.state.currentConfigPage * window.App.state.configPageSize),
    });
    const search = $('configSearch')?.value.trim();
    const provider = $('configProviderFilter')?.value;
    const status = $('configStatusFilter')?.value;
    const tagId = $('configTagFilter')?.value;
    const startDate = $('configStartDate')?.value;
    const endDate = $('configEndDate')?.value;
    if (search) params.set('search', search);
    if (provider) params.set('provider', provider);
    if (status) params.set('status', status);
    if (tagId) params.set('tagId', tagId);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    return params.toString();
  }

  async function loadConfigs() {
    try {
      await window.App.Tags?.ensureTags?.();
      const data = await window.App.api.request(`/api/configs?${filterQuery()}`);
      window.App.state.configs = data.items || [];
      total = data.total || 0;
      renderStats(data.stats);
      await loadMountStatuses();
      renderConfigsTable();
      renderPagination();
      fitConfigsTable();
      if (window.App.Manager) window.App.Manager.refreshOptions();
      if (window.App.RcloneCommands) window.App.RcloneCommands.refreshOptions();
    } catch (err) {
      window.App.utils.toast(`Không tải được configs: ${err.message}`, true);
    }
  }

  function renderStats(stats) {
    const wrap = $('headerStats');
    if (!wrap || !stats) return;

    const items = [
      { label: 'Total', value: stats.total || 0, color: 'gray' },
      { label: 'GD', value: stats.gd || 0, color: 'blue' },
      { label: 'OD', value: stats.od || 0, color: 'purple' },
      { label: 'Active', value: stats.active || 0, color: 'green' },
      { label: 'Error', value: stats.error || 0, color: 'red' },
    ];

    wrap.innerHTML = items
      .map(
        (item) => `
      <div class="header-stat-item" title="${item.label}">
        <span class="header-stat-label">${item.label}:</span>
        <span class="header-stat-value text-${item.color}">${item.value}</span>
      </div>
    `
      )
      .join('');
  }

  async function loadMountStatuses() {
    try {
      const data = await window.App.api.request('/api/configs/mounts');
      mountsById = new Map((data.items || []).map((mount) => [mount.configId, mount]));
    } catch (_err) {
      mountsById = new Map();
    }
  }

  function renderConfigsTable() {
    const tbody = $('configsTableBody');
    if (!tbody) return;
    const configs = window.App.state.configs || [];
    if (configs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-tertiary">Chưa có config.</td></tr>';
      return;
    }
    tbody.innerHTML = configs.map((config) => {
      const checked = window.App.state.selectedConfigIds.has(config.id) ? 'checked' : '';
      const mount = mountsById.get(config.id);
      const mounted = mount?.status === 'mounted' || mount?.status === 'mounting';
      const pending = pendingMountIds.has(config.id);
      const mountLabel = pending ? '⏳ Mounting' : (mounted ? '✅ Mounted' : '📂 Mount');
      const mountDisabled = pending || mounted ? 'disabled' : '';
      const unmountButton = mounted
        ? `<button type="button" class="btn btn--secondary btn--sm" data-action="unmount" data-id="${config.id}" ${pending ? 'disabled' : ''}>⏏ Unmount</button>`
        : '';
      const filebrowserButton = mount?.filebrowserUrl
        ? `<button type="button" class="btn btn--secondary btn--sm" data-action="open-files" data-id="${config.id}" title="${escapeHtml(mount.filebrowserUrl)}">🌐 Open</button>`
        : '';
      const copyMountPathButton = mount?.filebrowserRelativePath
        ? `<button type="button" class="btn btn--secondary btn--sm" data-action="copy-mount-path" data-id="${config.id}">📋 Path</button>`
        : '';
      
      const isList = configViewMode === 'list';

      if (isList) {
        return `
          <tr class="config-row-data">
            <td rowspan="2" class="td-select"><input type="checkbox" class="config-select" data-id="${config.id}" aria-label="Select ${escapeHtml(config.remoteName)}" ${checked} /></td>
            <td data-label="Remote / Email">
              <div class="config-info-main">
                <strong>${escapeHtml(config.remoteName)}</strong>
                <div class="text-tertiary text-xs">${escapeHtml(config.emailOwner)}</div>
              </div>
            </td>
            <td data-label="Provider">${providerBadge(config.provider)}</td>
            <td data-label="Status"><span class="${window.App.utils.statusBadgeClass(config.status)}">${escapeHtml(config.status || 'unknown')}</span></td>
            <td data-label="Tags">${window.App.Tags?.renderTagBadges?.(config.tags) || '<span class="text-tertiary text-xs">Chưa gắn tag</span>'}</td>
            <td data-label="Storage / Created">
              <div>${escapeHtml(storageText(config))}</div>
              <div class="text-tertiary text-xs">${window.App.utils.formatDate(config.createdAt)}</div>
            </td>
            <td data-label="Mount"><div class="config-mount">${mountBadge(mount)}${mountPathText(mount)}${mount?.error ? `<span class="config-mount__error">${escapeHtml(mount.error)}</span>` : ''}</div></td>
          </tr>
          <tr class="config-row-actions">
            <td colspan="6">
              <div class="table__actions">
                <button type="button" class="btn btn--secondary btn--sm" data-action="view" data-id="${config.id}">👁 View</button>
                <button type="button" class="btn btn--secondary btn--sm" data-action="refresh" data-id="${config.id}">🔄 Refresh</button>
                <button type="button" class="btn btn--secondary btn--sm" data-action="check" data-id="${config.id}">📊 Check</button>
                <button type="button" class="btn btn--secondary btn--sm" data-action="tags" data-id="${config.id}">🏷 Tags</button>
                <button type="button" class="btn btn--secondary btn--sm" data-action="mount" data-id="${config.id}" ${mountDisabled}>${mountLabel}</button>
                ${unmountButton}
                ${filebrowserButton}
                ${copyMountPathButton}
                <button type="button" class="btn btn--danger btn--sm" data-action="delete" data-id="${config.id}">🗑 Delete</button>
              </div>
            </td>
          </tr>`;
      }

      return `
        <tr>
          <td data-label="Select"><input type="checkbox" class="config-select" data-id="${config.id}" aria-label="Select ${escapeHtml(config.remoteName)}" ${checked} /></td>
          <td data-label="Remote"><strong>${escapeHtml(config.remoteName)}</strong></td>
          <td data-label="Provider">${providerBadge(config.provider)}</td>
          <td data-label="Email">${escapeHtml(config.emailOwner)}</td>
          <td data-label="Status"><span class="${window.App.utils.statusBadgeClass(config.status)}">${escapeHtml(config.status || 'unknown')}</span></td>
          <td data-label="Tags">${window.App.Tags?.renderTagBadges?.(config.tags) || '<span class="text-tertiary">Chưa gắn tag</span>'}</td>
          <td data-label="Storage">${escapeHtml(storageText(config))}</td>
          <td data-label="Created">${window.App.utils.formatDate(config.createdAt)}</td>
          <td data-label="Mount"><div class="config-mount">${mountBadge(mount)}${mountPathText(mount)}${mount?.error ? `<span class="config-mount__error">${escapeHtml(mount.error)}</span>` : ''}</div></td>
          <td data-label="Actions">
            <div class="table__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-action="view" data-id="${config.id}">👁 View</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="refresh" data-id="${config.id}">🔄 Refresh</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="check" data-id="${config.id}">📊 Check</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="tags" data-id="${config.id}">🏷 Tags</button>
              <button type="button" class="btn btn--secondary btn--sm" data-action="mount" data-id="${config.id}" ${mountDisabled}>${mountLabel}</button>
              ${unmountButton}
              ${filebrowserButton}
              ${copyMountPathButton}
              <button type="button" class="btn btn--danger btn--sm" data-action="delete" data-id="${config.id}">🗑 Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');
    applyConfigViewMode();
  }

  function renderPagination() {
    const page = window.App.state.currentConfigPage + 1;
    const totalPages = Math.max(Math.ceil(total / window.App.state.configPageSize), 1);
    $('configsPageText').textContent = `Page ${page} / ${totalPages} (${total})`;
    
    if ($('firstConfigsPageBtn')) $('firstConfigsPageBtn').disabled = page <= 1;
    if ($('prevConfigsPageBtn')) $('prevConfigsPageBtn').disabled = page <= 1;
    if ($('nextConfigsPageBtn')) $('nextConfigsPageBtn').disabled = page >= totalPages;
    if ($('lastConfigsPageBtn')) $('lastConfigsPageBtn').disabled = page >= totalPages;
    
    const jumpInput = $('configJumpPage');
    if (jumpInput) {
      jumpInput.value = page;
      jumpInput.max = totalPages;
    }
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
      if (err.status === 401) {
        try {
          window.App.utils.toast('Token hết hạn, đang tự động refresh...');
          await window.App.api.request(`/api/configs/${id}/refresh`, { method: 'POST' });
          await window.App.api.request(`/api/configs/${id}/quota`);
          await loadConfigs();
          window.App.utils.toast('Đã tự động refresh token và cập nhật quota.');
          return;
        } catch (refreshErr) {
          console.error('Auto-refresh failed:', refreshErr);
        }
      }
      window.App.utils.toast(`Check thất bại: ${err.message}`, true);
      await loadConfigs();
    }
  }

  function selectedTagIds(config) {
    return new Set([
      ...(Array.isArray(config.tagIds) ? config.tagIds : []),
      ...(Array.isArray(config.tags) ? config.tags.map((tag) => tag.id) : []),
    ].filter(Boolean));
  }

  function renderConfigTagChoices(config) {
    const wrap = $('configTagChoices');
    if (!wrap) return;
    const tags = window.App.state.tags || [];
    const selected = selectedTagIds(config);
    if (tags.length === 0) {
      wrap.innerHTML = '<div class="text-tertiary">Chưa có tag. Tạo tag trong Settings trước.</div>';
      return;
    }
    wrap.innerHTML = tags.map((tag) => `
      <label class="tag-choice">
        <input type="checkbox" class="config-tag-checkbox" value="${escapeHtml(tag.id)}" ${selected.has(tag.id) ? 'checked' : ''} />
        ${window.App.Tags?.tagBadge?.(tag) || escapeHtml(tag.name)}
        <span class="text-tertiary">${Number(tag.configCount || 0)} configs</span>
      </label>`).join('');
  }

  async function openTagsModal(id) {
    try {
      await window.App.Tags?.ensureTags?.();
      const config = await getConfigById(id);
      $('configTagsId').value = id;
      $('configTagsModalTitle').textContent = `${config.remoteName} tags`;
      renderConfigTagChoices(config);
      $('configTagsModal').classList.add('modal--open');
    } catch (err) {
      window.App.utils.toast(`Không mở được tag config: ${err.message}`, true);
    }
  }

  function closeTagsModal() {
    $('configTagsModal')?.classList.remove('modal--open');
  }

  async function saveConfigTags(event) {
    event.preventDefault();
    const id = $('configTagsId').value;
    const tagIds = Array.from(document.querySelectorAll('#configTagChoices .config-tag-checkbox:checked'))
      .map((checkbox) => checkbox.value);
    try {
      const saved = await window.App.api.request(`/api/configs/${id}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tagIds }),
      });
      window.App.state.configs = (window.App.state.configs || []).map((config) => (config.id === id ? saved : config));
      closeTagsModal();
      await window.App.Tags?.loadTags?.({ silent: true });
      await loadConfigs();
      window.App.utils.toast('Đã cập nhật tags cho config.');
    } catch (err) {
      window.App.utils.toast(`Không lưu được tags: ${err.message}`, true);
    }
  }

  async function mountConfig(id) {
    if (pendingMountIds.has(id)) return;
    pendingMountIds.add(id);
    renderConfigsTable();
    try {
      const data = await window.App.api.request(`/api/configs/${id}/mount`, { method: 'POST' });
      if (data.mount) mountsById.set(id, data.mount);
      renderConfigsTable();
      const location = data.mount?.filebrowserRelativePath || data.mount?.hostPath || '';
      window.App.utils.toast(location ? `Đã mount. Mở Filebrowser tại ${location}.` : 'Đã mount config.');
    } catch (err) {
      window.App.utils.toast(`Mount thất bại: ${err.message}`, true);
      await loadMountStatuses();
      renderConfigsTable();
    } finally {
      pendingMountIds.delete(id);
      renderConfigsTable();
    }
  }

  async function unmountConfig(id) {
    if (pendingMountIds.has(id)) return;
    pendingMountIds.add(id);
    renderConfigsTable();
    try {
      await window.App.api.request(`/api/configs/${id}/mount`, { method: 'DELETE' });
      mountsById.delete(id);
      renderConfigsTable();
      window.App.utils.toast('Đã unmount config.');
    } catch (err) {
      window.App.utils.toast(`Unmount thất bại: ${err.message}`, true);
      await loadMountStatuses();
      renderConfigsTable();
    } finally {
      pendingMountIds.delete(id);
      renderConfigsTable();
    }
  }

  function openMountedFiles(id) {
    const mount = mountsById.get(id);
    if (mount?.filebrowserUrl) {
      window.open(mount.filebrowserUrl, '_blank', 'noopener');
      return;
    }
    window.App.utils.toast('Chưa cấu hình RCLONE_MANAGER_FILEBROWSER_PUBLIC_URL. Dùng path trong Filebrowser để mở thư mục mounted.', true);
  }

  function copyMountPath(id) {
    const mount = mountsById.get(id);
    const path = mount?.filebrowserRelativePath || mount?.hostPath || '';
    if (!path) {
      window.App.utils.toast('Config này chưa có mount path.', true);
      return;
    }
    window.App.utils.copyText(path, 'Đã copy mount path.');
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

  function bindEvents() {
    $('applyConfigFiltersBtn')?.addEventListener('click', () => {
      window.App.state.currentConfigPage = 0;
      loadConfigs();
    });
    $('configViewMode')?.addEventListener('change', (event) => {
      configViewMode = normalizeViewMode(event.target.value);
      localStorage.setItem(CONFIG_VIEW_KEY, configViewMode);
      applyConfigViewMode();
    });
    $('prevConfigsPageBtn')?.addEventListener('click', () => {
      window.App.state.currentConfigPage = Math.max(window.App.state.currentConfigPage - 1, 0);
      loadConfigs();
    });
    $('nextConfigsPageBtn')?.addEventListener('click', () => {
      window.App.state.currentConfigPage += 1;
      loadConfigs();
    });
    $('firstConfigsPageBtn')?.addEventListener('click', () => {
      window.App.state.currentConfigPage = 0;
      loadConfigs();
    });
    $('lastConfigsPageBtn')?.addEventListener('click', () => {
      const totalPages = Math.max(Math.ceil(total / window.App.state.configPageSize), 1);
      window.App.state.currentConfigPage = totalPages - 1;
      loadConfigs();
    });
    
    function handleJump() {
      const page = parseInt($('configJumpPage')?.value || '1', 10);
      const totalPages = Math.max(Math.ceil(total / window.App.state.configPageSize), 1);
      if (isNaN(page) || page < 1 || page > totalPages) {
        window.App.utils.toast(`Trang không hợp lệ. Vui lòng chọn từ 1 đến ${totalPages}.`, true);
        return;
      }
      window.App.state.currentConfigPage = page - 1;
      loadConfigs();
    }
    
    $('configJumpBtn')?.addEventListener('click', handleJump);
    $('configJumpPage')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleJump();
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
      if (button.dataset.action === 'tags') openTagsModal(id);
      if (button.dataset.action === 'mount') mountConfig(id);
      if (button.dataset.action === 'unmount') unmountConfig(id);
      if (button.dataset.action === 'open-files') openMountedFiles(id);
      if (button.dataset.action === 'copy-mount-path') copyMountPath(id);
      if (button.dataset.action === 'delete') deleteConfig(id);
    });
    $('exportSelectedBtn')?.addEventListener('click', exportSelected);
    $('deleteSelectedBtn')?.addEventListener('click', deleteSelected);
    $('closeConfigModalBtn')?.addEventListener('click', () => $('configModal').classList.remove('modal--open'));
    $('configModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'configModal') $('configModal').classList.remove('modal--open');
    });
    $('copyConfigModalBtn')?.addEventListener('click', () => {
      window.App.utils.copyText($('configModalOutput').textContent, 'Đã copy config.');
    });
    $('configTagsForm')?.addEventListener('submit', saveConfigTags);
    $('closeConfigTagsModalBtn')?.addEventListener('click', closeTagsModal);
    $('cancelConfigTagsBtn')?.addEventListener('click', closeTagsModal);
    $('configTagsModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'configTagsModal') closeTagsModal();
    });
  }

  /**
   * Dynamically set the height of the configs table wrap so only
   * the rows scroll, with the header, filter, and pagination fixed.
   */
  function fitConfigsTable() {
    const wrap = $('configsTableWrap');
    if (!wrap) return;

    const section = document.getElementById('section-configs');
    if (!section || !section.classList.contains('section--active')) return;

    const wrapRect = wrap.getBoundingClientRect();
    const paginationBar = wrap.parentElement?.querySelector('.pagination-bar');
    const paginationH = paginationBar ? paginationBar.offsetHeight : 0;
    const siteFooter = document.querySelector('.footer');
    const footerH = siteFooter ? siteFooter.offsetHeight : 56;

    const available = window.innerHeight - wrapRect.top - paginationH - footerH;
    wrap.style.height = `${Math.max(available, 200)}px`;
    wrap.style.overflowY = 'auto';
    wrap.style.minHeight = '0';
  }

  function init() {
    bindEvents();
    applyConfigViewMode();

    // Refit on resize
    window.addEventListener('resize', fitConfigsTable);

    // Refit when section becomes active (class toggled by main.js)
    const section = document.getElementById('section-configs');
    if (section && 'MutationObserver' in window) {
      const observer = new MutationObserver(() => {
        if (section.classList.contains('section--active')) {
          // Small delay to let DOM settle
          requestAnimationFrame(fitConfigsTable);
        }
      });
      observer.observe(section, { attributes: true, attributeFilter: ['class'] });
    }
  }

  window.App = window.App || {};
  window.App.Configs = {
    init,
    loadConfigs,
    fitConfigsTable,
    getConfigById,
  };
})();
