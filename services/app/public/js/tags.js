(function () {
  const DEFAULT_COLOR = '#2563eb';

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

  function safeColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_COLOR;
  }

  function providerLabel(provider) {
    if (provider === 'gd') return 'Google Drive';
    if (provider === 'od') return 'OneDrive';
    return 'Unknown';
  }

  function tagBadge(tag) {
    if (!tag) return '';
    const color = safeColor(tag.color);
    return `<span class="tag-chip" style="--tag-color:${color}" title="${escapeHtml(tag.description || tag.name)}"><span class="tag-chip__dot" aria-hidden="true"></span>${escapeHtml(tag.name)}</span>`;
  }

  function renderTagBadges(tags, emptyText = 'Chưa gắn tag') {
    const items = (tags || []).filter(Boolean);
    if (items.length === 0) return `<span class="text-tertiary">${escapeHtml(emptyText)}</span>`;
    return `<span class="tag-chip-list">${items.map(tagBadge).join('')}</span>`;
  }

  function renderConfigTagFilter() {
    const select = $('configTagFilter');
    if (!select) return;
    const current = select.value;
    const tags = window.App.state.tags || [];
    select.innerHTML = '<option value="">All tags</option>' + tags
      .map((tag) => `<option value="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</option>`)
      .join('');
    if (current && tags.some((tag) => tag.id === current)) select.value = current;
  }

  function renderTagsTable() {
    const tbody = $('tagsTableBody');
    if (!tbody) return;
    const tags = window.App.state.tags || [];
    if (tags.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-tertiary">Chưa có tag.</td></tr>';
      return;
    }
    tbody.innerHTML = tags.map((tag) => {
      const color = safeColor(tag.color);
      const count = Number(tag.configCount || 0);
      return `
        <tr>
          <td data-label="Tag"><strong>${tagBadge(tag)}</strong></td>
          <td data-label="Color"><span class="tag-color-value"><span class="tag-color-swatch" style="--tag-color:${color}" aria-hidden="true"></span><code>${escapeHtml(color)}</code></span></td>
          <td data-label="Description">${escapeHtml(tag.description || '-')}</td>
          <td data-label="Configs"><button type="button" class="btn btn--secondary btn--sm" data-action="view-configs" data-id="${tag.id}">${count} configs</button></td>
          <td data-label="Actions">
            <div class="table__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-action="edit" data-id="${tag.id}">Edit</button>
              <button type="button" class="btn btn--danger btn--sm" data-action="delete" data-id="${tag.id}">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  async function loadTags({ silent = false } = {}) {
    try {
      const data = await window.App.api.request('/api/tags');
      window.App.state.tags = data.items || [];
      renderTagsTable();
      renderConfigTagFilter();
      return window.App.state.tags;
    } catch (err) {
      if (!silent) window.App.utils.toast(`Không tải được tags: ${err.message}`, true);
      window.App.state.tags = window.App.state.tags || [];
      renderTagsTable();
      renderConfigTagFilter();
      return window.App.state.tags;
    }
  }

  async function ensureTags() {
    if ((window.App.state.tags || []).length > 0) return window.App.state.tags;
    return loadTags({ silent: true });
  }

  function openTagForm(tag) {
    $('tagId').value = tag?.id || '';
    $('tagName').value = tag?.name || '';
    $('tagColor').value = safeColor(tag?.color);
    $('tagDescription').value = tag?.description || '';
    $('tagFormTitle').textContent = tag?.id ? 'Edit tag' : 'New tag';
    $('cancelTagBtn')?.classList.toggle('hidden', !tag?.id);
    $('tagName')?.focus();
  }

  function resetTagForm() {
    openTagForm(null);
  }

  async function submitTag(event) {
    event.preventDefault();
    const id = $('tagId').value;
    const payload = {
      name: $('tagName').value.trim(),
      color: $('tagColor').value || DEFAULT_COLOR,
      description: $('tagDescription').value.trim(),
    };
    if (!payload.name) {
      window.App.utils.toast('Tên tag là bắt buộc.', true);
      return;
    }

    try {
      await window.App.api.request(id ? `/api/tags/${id}` : '/api/tags', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      resetTagForm();
      await loadTags();
      await window.App.Configs?.loadConfigs();
      window.App.utils.toast('Đã lưu tag.');
    } catch (err) {
      window.App.utils.toast(`Không lưu được tag: ${err.message}`, true);
    }
  }

  async function deleteTag(id) {
    const tag = (window.App.state.tags || []).find((item) => item.id === id);
    if (!confirm(`Xóa tag "${tag?.name || id}" khỏi tất cả config?`)) return;
    try {
      await window.App.api.request(`/api/tags/${id}`, { method: 'DELETE' });
      resetTagForm();
      await loadTags();
      await window.App.Configs?.loadConfigs();
      window.App.utils.toast('Đã xóa tag.');
    } catch (err) {
      window.App.utils.toast(`Không xóa được tag: ${err.message}`, true);
    }
  }

  async function viewTagConfigs(id) {
    const tag = (window.App.state.tags || []).find((item) => item.id === id);
    try {
      const data = await window.App.api.request(`/api/tags/${id}/configs`);
      const items = data.items || [];
      $('tagUsageModalTitle').textContent = `${tag?.name || 'Tag'} · ${items.length} configs`;
      const tbody = $('tagUsageTableBody');
      if (tbody) {
        tbody.innerHTML = items.length
          ? items.map((config) => `
            <tr>
              <td><strong>${escapeHtml(config.remoteName)}</strong></td>
              <td>${escapeHtml(providerLabel(config.provider))}</td>
              <td>${escapeHtml(config.emailOwner)}</td>
              <td><span class="${window.App.utils.statusBadgeClass(config.status)}">${escapeHtml(config.status || 'unknown')}</span></td>
              <td>${window.App.utils.formatDate(config.updatedAt || config.createdAt)}</td>
            </tr>`).join('')
          : '<tr><td colspan="5" class="text-tertiary">Chưa có config gắn tag này.</td></tr>';
      }
      $('tagUsageModal').classList.add('modal--open');
    } catch (err) {
      window.App.utils.toast(`Không tải được configs theo tag: ${err.message}`, true);
    }
  }

  function bindEvents() {
    $('addTagBtn')?.addEventListener('click', resetTagForm);
    $('tagForm')?.addEventListener('submit', submitTag);
    $('cancelTagBtn')?.addEventListener('click', resetTagForm);
    $('refreshTagsBtn')?.addEventListener('click', () => loadTags());
    $('tagsTableBody')?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const tag = (window.App.state.tags || []).find((item) => item.id === button.dataset.id);
      if (button.dataset.action === 'edit') openTagForm(tag);
      if (button.dataset.action === 'delete') deleteTag(button.dataset.id);
      if (button.dataset.action === 'view-configs') viewTagConfigs(button.dataset.id);
    });
    $('closeTagUsageModalBtn')?.addEventListener('click', () => $('tagUsageModal').classList.remove('modal--open'));
    $('tagUsageModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'tagUsageModal') $('tagUsageModal').classList.remove('modal--open');
    });
  }

  function init() {
    bindEvents();
    resetTagForm();
  }

  window.App = window.App || {};
  window.App.Tags = {
    init,
    loadTags,
    ensureTags,
    renderTagBadges,
    tagBadge,
  };
})();
