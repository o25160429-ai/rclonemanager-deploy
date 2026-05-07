(function () {
  const ROUTES = ['oauth-gd', 'oauth-od', 'credentials', 'configs', 'manager', 'rclone', 'settings'];
  const LOCKED_ROUTES = new Set(['credentials', 'configs', 'manager', 'rclone', 'settings']);
  const LOCKED_SECTION_SELECTORS = [
    '#section-credentials',
    '#section-configs',
    '#section-manager',
    '#section-rclone',
    '#section-settings',
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function routeFromHash() {
    const raw = window.location.hash.replace('#', '').split('?')[0];
    return ROUTES.includes(raw) ? raw : 'oauth-gd';
  }

  function isLockedRoute(route) {
    return LOCKED_ROUTES.has(route);
  }

  function protectedMenuLinks() {
    return document.querySelectorAll('.sidebar__link[data-route], .bottom-nav__item[data-route]');
  }

  function setDisabledLabel(link, locked) {
    let label = link.querySelector('.nav-disabled-label');
    if (!locked) {
      label?.remove();
      return;
    }
    if (!label) {
      label = document.createElement('span');
      label.className = 'nav-disabled-label';
      label.textContent = 'disabled';
      link.appendChild(label);
    }
  }

  let authLocked = false;
  let protectedDataLoaded = false;

  function setActiveRoute(route) {
    const activeSection = route.startsWith('oauth-') ? 'oauth' : route;
    document.body.setAttribute('data-active-section', activeSection);
    if (authLocked && !route.startsWith('oauth-')) route = 'oauth-gd';

    ROUTES.forEach((name) => {
      const section = name.startsWith('oauth-') ? 'oauth' : name;
      $(`section-${section}`)?.classList.toggle('section--active', section === (route.startsWith('oauth-') ? 'oauth' : route));
    });

    document.querySelectorAll('[data-route]').forEach((link) => {
      const active = link.dataset.route === route;
      if (link.classList.contains('sidebar__link')) {
        link.classList.toggle('sidebar__link--active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      if (link.classList.contains('bottom-nav__item')) {
        link.classList.toggle('bottom-nav__item--active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    });

    window.App.Sidebar?.closeMobileSidebar();

    if (route === 'oauth-gd') window.App.OAuth?.setProviderFromRoute?.('gd');
    if (route === 'oauth-od') window.App.OAuth?.setProviderFromRoute?.('od');
    if (route === 'credentials') window.App.Credentials?.loadPresets();
    if (route === 'settings') {
      window.App.Tags?.loadTags();
      refreshDeployCodeStatus().catch(() => null);
    }
    if (route === 'configs') {
      window.App.Configs?.loadConfigs();
      // Delay to let section become visible before measuring
      requestAnimationFrame(() => window.App.Configs?.fitConfigsTable?.());
    }
    if (route === 'manager') window.App.Manager?.refreshOptions();
    if (route === 'rclone') {
      window.App.RcloneCommands?.refreshOptions();
      window.App.RcloneCommands?.loadSavedCommands();
    }
  }

  function runnerText(backend) {
    const parts = [];
    if (backend.runnerCommitShortId) parts.push(`commit ${backend.runnerCommitShortId}`);
    if (backend.runnerCommitAt) parts.push(backend.runnerCommitAt);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  }

  function updateBackendStatusUi() {
    const backend = window.App.state.backend;
    const badge = $('backendStatusBadge');
    const footer = $('footerStatus');
    const settingsStatus = $('settingsBackendStatus');
    const settingsVersion = $('settingsVersion');
    const settingsRunnerCommit = $('settingsRunnerCommit');
    const settingsRunnerCommitAt = $('settingsRunnerCommitAt');
    const settingsUrl = $('settingsBackendUrl');

    if (badge) {
      badge.className = `badge ${backend.online ? 'badge--green' : 'badge--red'}`;
      badge.textContent = backend.online ? `Backend ok${runnerText(backend)} · Firebase ${backend.firebase}` : 'Backend offline';
    }
    if (footer) {
      footer.textContent = backend.online
        ? `Backend ${backend.version}${runnerText(backend)} · Firebase ${backend.firebase} (${backend.mode})`
        : 'Backend offline';
    }
    if (settingsStatus) settingsStatus.textContent = backend.online ? `ok · Firebase ${backend.firebase}` : 'offline';
    if (settingsVersion) settingsVersion.textContent = backend.version || '-';
    if (settingsRunnerCommit) settingsRunnerCommit.textContent = backend.runnerCommitShortId || '-';
    if (settingsRunnerCommitAt) settingsRunnerCommitAt.textContent = backend.runnerCommitAt || '-';
    if (settingsUrl) settingsUrl.textContent = window.App.api.baseUrl;
    window.App.OAuth?.setBackendBanner();
  }

  async function loadProtectedData() {
    if (authLocked || protectedDataLoaded) return;
    await window.App.Credentials?.loadPresets();
    await window.App.Tags?.loadTags();
    await window.App.Configs?.loadConfigs();
    await window.App.Manager?.refreshOptions();
    await window.App.RcloneCommands?.refreshOptions();
    await window.App.RcloneCommands?.loadSavedCommands();
    protectedDataLoaded = true;
  }

  async function refreshBackendStatus() {
    await window.App.api.checkBackend();
    updateBackendStatusUi();
  }

  async function exportAllConfigs() {
    try {
      const data = await window.App.api.request('/api/configs?limit=10000&offset=0');
      window.App.utils.downloadText(
        'rclone-configs-backup.json',
        `${JSON.stringify(data.items || [], null, 2)}\n`,
        'application/json',
      );
    } catch (err) {
      window.App.utils.toast(`Không export được configs: ${err.message}`, true);
    }
  }


  function compactCommit(value) {
    const text = String(value || '').trim();
    return text ? text.slice(0, 12) : '-';
  }

  function setDeployCodeText(id, value) {
    const el = $(id);
    if (el) el.innerHTML = value || '-';
  }

  function deployCodeButtons() {
    const buttons = ['deployCodeRefreshBtn', 'deployCodeCheckBtn', 'deployCodeDeployBtn', 'deployCodeUploadZipBtn', 'deployCodeListContainersBtn', 'deployCodeContainerLogsBtn']
      .map((id) => $(id))
      .filter(Boolean);
    document.querySelectorAll('[data-container-action]').forEach((button) => buttons.push(button));
    return buttons;
  }

  function setDeployCodeBusy(busy) {
    deployCodeButtons().forEach((button) => { button.disabled = busy; });
  }

  function lastRunText(lastRun) {
    if (!lastRun) return '-';
    const parts = [lastRun.type || 'deploy', lastRun.status || 'unknown'];
    if (lastRun.shortCommit) parts.push(lastRun.shortCommit);
    if (lastRun.finishedAt) parts.push(lastRun.finishedAt);
    if (lastRun.error) parts.push(lastRun.error);
    return parts.filter(Boolean).join(' · ');
  }

  function renderDeployCodeStatus(data) {
    const cfg = data?.config || {};
    const git = data?.git || {};
    const local = compactCommit(git.localCommit);
    const remote = compactCommit(git.remoteCommit);
    const hasUpdate = local !== remote && local !== '-' && remote !== '-';

    setDeployCodeText('deployCodeEnabled', cfg.enabled ? '<span class="text-green">true</span>' : '<span class="text-red">false</span>');
    setDeployCodeText('deployCodeRunning', data?.running ? '<span class="text-green">true</span>' : '<span class="text-red">false</span>');
    setDeployCodeText('deployCodeLocalCommit', local);
    setDeployCodeText('deployCodeRemoteCommit', remote + (hasUpdate ? ' <span title="Có bản cập nhật mới trên remote">🆕</span>' : ''));
    setDeployCodeText('deployCodeLastResult', lastRunText(data?.lastRun));
    const logs = $('deployCodeLogs');
    if (logs) {
      const lines = [
        `enabled=${cfg.enabled ? 'true' : 'false'}`,
        `repo=${cfg.repoDir || '-'}`,
        `branch=${cfg.remote || 'origin'}/${cfg.branch || 'main'}`,
        `services=${(cfg.deployServices || []).join(',') || '-'}`,
        `poll=${cfg.pollEnabled ? 'on' : 'off'} autoDeploy=${cfg.autoDeployOnChange ? 'on' : 'off'}`,
        '',
        data?.logs || 'Chưa có log.',
      ];
      logs.textContent = lines.join('\n');
    }
  }

  async function refreshDeployCodeStatus(showToast = false) {
    try {
      const data = await window.App.api.request('/api/deploy-code/status', { allowStatuses: [404, 503] });
      if (data?.error) throw new Error(data.error);
      renderDeployCodeStatus(data);
      if (showToast) window.App.utils.toast('Đã tải deploy-code status.');
      return data;
    } catch (err) {
      setDeployCodeText('deployCodeEnabled', 'false');
      setDeployCodeText('deployCodeRunning', '-');
      const logs = $('deployCodeLogs');
      if (logs) logs.textContent = `Không tải được deploy-code status.\n${err.message || err}`;
      if (showToast) window.App.utils.toast(`Không tải được deploy-code: ${err.message || err}`, true);
      return null;
    }
  }

  async function checkDeployCodeGit() {
    setDeployCodeBusy(true);
    try {
      const data = await window.App.api.request('/api/deploy-code/check', { method: 'POST', body: JSON.stringify({ fetch: true }) });
      renderDeployCodeStatus(data.status || data);
      const changed = Boolean(data?.result?.changed);
      window.App.utils.toast(changed ? 'Có code mới trên Git.' : 'Git chưa có thay đổi mới.');
    } catch (err) {
      window.App.utils.toast(`Check git lỗi: ${err.message}`, true);
      await refreshDeployCodeStatus();
    } finally {
      setDeployCodeBusy(false);
    }
  }

  async function runDeployCode() {
    setDeployCodeBusy(true);
    try {
      const data = await window.App.api.request('/api/deploy-code/deploy', { method: 'POST', body: JSON.stringify({ force: false }) });
      renderDeployCodeStatus(data.status || data);
      window.App.utils.toast(data?.result?.status === 'no-change' ? 'Không có commit mới để deploy.' : 'Đã gửi lệnh deploy app.');
    } catch (err) {
      window.App.utils.toast(`Deploy lỗi: ${err.message}`, true);
      await refreshDeployCodeStatus();
    } finally {
      setDeployCodeBusy(false);
    }
  }

  async function uploadDeployCodeZip() {
    const input = $('deployCodeZipInput');
    const file = input?.files?.[0];
    if (!file) {
      window.App.utils.toast('Chọn file ZIP source trước khi upload.', true);
      return;
    }
    setDeployCodeBusy(true);
    try {
      const data = await window.App.api.request('/api/deploy-code/upload-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'x-file-name': file.name,
        },
        body: file,
      });
      renderDeployCodeStatus(data.status || data);
      window.App.utils.toast('Đã upload ZIP và gửi lệnh deploy.');
      if (input) input.value = '';
    } catch (err) {
      window.App.utils.toast(`Upload ZIP lỗi: ${err.message}`, true);
      await refreshDeployCodeStatus();
    } finally {
      setDeployCodeBusy(false);
    }
  }


  function deployCodeTargetPayload() {
    const services = ($('deployCodeServicesInput')?.value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const containers = ($('deployCodeContainersInput')?.value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return { services, containers };
  }

  function renderContainerControlOutput(data) {
    const out = $('deployCodeContainersOut');
    if (!out) return;
    if (data?.containers) {
      const rows = data.containers.map((item) => [
        item.name || '-',
        item.state || '-',
        item.status || '-',
        item.composeService ? `service=${item.composeService}` : '',
        item.allowed ? 'allowed' : 'blocked',
      ].filter(Boolean).join(' | '));
      out.textContent = [
        `allowAll=${data.allowAll ? 'true' : 'false'}`,
        `allowedServices=${(data.allowedServices || []).join(',') || '-'}`,
        `allowedContainers=${(data.allowedContainers || []).join(',') || '-'}`,
        '',
        ...(rows.length ? rows : ['Không có container phù hợp.']),
      ].join('\n');
      return;
    }
    if (data?.items) {
      out.textContent = data.items.map((item) => [
        `# ${item.targetType}: ${(item.targets || []).join(', ')}`,
        item.logs || '(empty logs)',
      ].join('\n')).join('\n\n');
      return;
    }
    if (data?.result) {
      out.textContent = JSON.stringify(data.result, null, 2);
      return;
    }
    out.textContent = JSON.stringify(data || {}, null, 2);
  }

  async function listDeployCodeContainers() {
    setDeployCodeBusy(true);
    try {
      const data = await window.App.api.request('/api/deploy-code/containers');
      renderContainerControlOutput(data);
      window.App.utils.toast('Đã tải danh sách container.');
    } catch (err) {
      window.App.utils.toast(`List container lỗi: ${err.message}`, true);
      renderContainerControlOutput({ error: err.message });
    } finally {
      setDeployCodeBusy(false);
    }
  }

  async function runDeployCodeContainerAction(action) {
    const payload = deployCodeTargetPayload();
    if (!payload.services.length && !payload.containers.length) {
      window.App.utils.toast('Nhập ít nhất một service hoặc container.', true);
      return;
    }
    setDeployCodeBusy(true);
    try {
      const data = await window.App.api.request(`/api/deploy-code/containers/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      renderContainerControlOutput(data);
      renderDeployCodeStatus(data.status || data);
      window.App.utils.toast(`Đã gửi lệnh ${action}.`);
    } catch (err) {
      window.App.utils.toast(`${action} lỗi: ${err.message}`, true);
      renderContainerControlOutput({ error: err.message });
      await refreshDeployCodeStatus();
    } finally {
      setDeployCodeBusy(false);
    }
  }

  async function readDeployCodeContainerLogs() {
    const payload = { ...deployCodeTargetPayload(), lines: 200 };
    if (!payload.services.length && !payload.containers.length) {
      window.App.utils.toast('Nhập service hoặc container để xem logs.', true);
      return;
    }
    setDeployCodeBusy(true);
    try {
      const data = await window.App.api.request('/api/deploy-code/containers/logs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      renderContainerControlOutput(data);
      window.App.utils.toast('Đã tải container logs.');
    } catch (err) {
      window.App.utils.toast(`Logs lỗi: ${err.message}`, true);
      renderContainerControlOutput({ error: err.message });
    } finally {
      setDeployCodeBusy(false);
    }
  }

  function bindDeployCode() {
    $('deployCodeRefreshBtn')?.addEventListener('click', () => refreshDeployCodeStatus(true));
    $('deployCodeCheckBtn')?.addEventListener('click', checkDeployCodeGit);
    $('deployCodeDeployBtn')?.addEventListener('click', runDeployCode);
    $('deployCodeUploadZipBtn')?.addEventListener('click', uploadDeployCodeZip);
    $('deployCodeListContainersBtn')?.addEventListener('click', listDeployCodeContainers);
    $('deployCodeContainerLogsBtn')?.addEventListener('click', readDeployCodeContainerLogs);
    document.querySelectorAll('[data-container-action]').forEach((button) => {
      button.addEventListener('click', () => runDeployCodeContainerAction(button.dataset.containerAction));
    });
  }

  function bindSettings() {
    localStorage.removeItem('backend-api-key');
    $('testConnectionBtn')?.addEventListener('click', async () => {
      await refreshBackendStatus();
      window.App.utils.toast(window.App.state.backend.online ? 'Backend connected.' : 'Backend offline.', !window.App.state.backend.online);
    });
    $('clearCacheBtn')?.addEventListener('click', () => {
      window.App.Credentials?.clearCache();
      window.App.utils.toast('Đã clear presets cache.');
    });
    bindForceReloadButtons();
    $('exportAllConfigsBtn')?.addEventListener('click', exportAllConfigs);
    bindDeployCode();
  }

  function getAppAssetVersion() {
    const metaVersion = document.querySelector('meta[name="app-asset-version"]')?.getAttribute('content');
    const commitVersion = document.querySelector('meta[name="app-commit-short-id"]')?.getAttribute('content');
    const version = (metaVersion || commitVersion || '').trim();
    return version && version !== 'ASSET_VERSION' && version !== 'APP_COMMIT_SHORT_ID'
      ? version
      : String(Date.now());
  }

  function messageServiceWorker(worker, payload) {
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => resolve(null), 1500);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timer);
        resolve(event.data || null);
      };
      worker.postMessage(payload, [channel.port2]);
    });
  }

  async function clearServiceWorkerCaches() {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => key.startsWith('rclone-oauth-manager-'))
        .map((key) => caches.delete(key)));
    }

    if (!('serviceWorker' in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(async (registration) => {
      const worker = registration.waiting || registration.active || registration.installing;
      await messageServiceWorker(worker, { type: 'CLEAR_CACHES' }).catch(() => null);
      await registration.unregister();
    }));
  }

  function reloadWithCacheBuster() {
    const url = new URL(window.location.href);
    url.searchParams.set('appReload', Date.now().toString());
    window.location.replace(url.toString());
  }

  function forceReloadButtons() {
    return document.querySelectorAll('[data-force-reload-app]');
  }

  function bindForceReloadButtons() {
    forceReloadButtons().forEach((button) => {
      if (button.dataset.forceReloadBound === '1') return;
      button.dataset.forceReloadBound = '1';
      button.addEventListener('click', forceReloadApp);
    });
  }

  async function forceReloadApp() {
    const buttons = Array.from(forceReloadButtons());
    buttons.forEach((button) => { button.disabled = true; });
    try {
      window.App.utils.toast('Đang xoá cache và tải lại code mới nhất...');
      await clearServiceWorkerCaches();
    } catch (err) {
      console.warn('[reload] Cache cleanup failed, continue hard reload:', err);
    } finally {
      reloadWithCacheBuster();
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderFooterOpsLinks(items) {
    const wrap = $('footerOpsLinks');
    if (!wrap) return;
    wrap.innerHTML = (items || []).map((item) => {
      const label = String(item.label || '').trim();
      const url = String(item.url || '').trim();
      if (!label || !url) return '';
      return `<a class="footer__link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    }).join('');
  }

  async function initFooterOpsLinks() {
    try {
      const data = await window.App.api.request('/api/ops-links');
      renderFooterOpsLinks(data.items || []);
    } catch (_err) {
      renderFooterOpsLinks([]);
    }
  }

  function formatRunnerEnv(data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const lines = [
      `prefix=${data?.prefix || '_DOTENVRTDB_RUNNER'}`,
      `count=${Number.isFinite(data?.count) ? data.count : items.length}`,
      data?.generatedAt ? `generatedAt=${data.generatedAt}` : '',
    ].filter(Boolean);

    if (!items.length) {
      lines.push('', 'Không tìm thấy biến môi trường nào có prefix _DOTENVRTDB_RUNNER.');
      return lines.join('\n');
    }

    lines.push('', ...items.map((item) => `${item.key}=${item.value ?? ''}`));
    return lines.join('\n');
  }

  async function showRunnerEnv() {
    const modal = $('runnerEnvModal');
    const output = $('runnerEnvOutput');
    const button = $('runnerEnvBtn');
    if (!modal || !output) return;

    modal.classList.add('modal--open');
    output.textContent = 'Đang tải các biến _DOTENVRTDB_RUNNER từ backend...';
    if (button) button.disabled = true;

    try {
      const data = await window.App.api.request('/api/runner-env');
      output.textContent = formatRunnerEnv(data);
    } catch (err) {
      output.textContent = `Không tải được thông tin _DOTENVRTDB_RUNNER.\n${err.message || err}`;
      window.App.utils.toast(`Không tải được runner env: ${err.message || err}`, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindRunnerEnvModal() {
    $('runnerEnvBtn')?.addEventListener('click', showRunnerEnv);
    $('closeRunnerEnvModalBtn')?.addEventListener('click', () => $('runnerEnvModal')?.classList.remove('modal--open'));
    $('runnerEnvModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'runnerEnvModal') $('runnerEnvModal')?.classList.remove('modal--open');
    });
  }

  function bindGlobalDialogs() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      document.querySelectorAll(".modal.modal--open").forEach((m)=>m.classList.remove("modal--open"));
    });
    document.addEventListener('click', (event) => {
      const link = event.target.closest('.sidebar__link[data-route], .bottom-nav__item[data-route]');
      if (!link || !authLocked || !isLockedRoute(link.dataset.route)) return;
      event.preventDefault();
      event.stopPropagation();
      window.App.utils.toast('Vui lòng đăng nhập Google trước khi sử dụng menu này.', true);
    });
  }


  function setAppLocked(locked) {
    document.body.classList.toggle('auth-locked', locked);
    document.querySelectorAll(LOCKED_SECTION_SELECTORS.join(',')).forEach((el)=>{
      if (locked) el.setAttribute('aria-disabled','true');
      else el.removeAttribute('aria-disabled');
    });
    protectedMenuLinks().forEach((link) => {
      const shouldLock = locked && isLockedRoute(link.dataset.route);
      link.classList.toggle('nav-link--disabled', shouldLock);
      setDisabledLabel(link, shouldLock);
      if (!link.dataset.tooltipBase && link.dataset.tooltip) link.dataset.tooltipBase = link.dataset.tooltip;
      if (shouldLock) {
        link.setAttribute('aria-disabled', 'true');
        if (link.dataset.tooltipBase) link.dataset.tooltip = `${link.dataset.tooltipBase} disabled`;
      } else {
        link.removeAttribute('aria-disabled');
        if (link.dataset.tooltipBase) link.dataset.tooltip = link.dataset.tooltipBase;
      }
    });
  }

  async function initGoogleLogin() {
    const panel = $('googleLoginPanel');
    const btnWrap = $('googleLoginButton');
    const status = $('googleLoginStatus');
    if (!panel || !btnWrap || !window.App.FirebaseClient) return true;

    const setStatus = (message) => {
      if (!status) return;
      status.textContent = message;
      status.title = message;
    };

    const renderAuthButton = ({ id, label, variant = 'primary', disabled = false, onClick }) => {
      btnWrap.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = id;
      btn.className = `btn btn--${variant} btn--sm sidebar-auth__button`;
      btn.textContent = label;
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.disabled = disabled;
      if (typeof onClick === 'function') btn.addEventListener('click', onClick);
      btnWrap.appendChild(btn);
    };

    const setLoggedOut = (message, badgeState = 'out', badgeLabel = 'Chưa đăng nhập', loginDisabled = false) => {
      authLocked = true;
      setAppLocked(true);
      protectedDataLoaded = false;
      renderAuthButton({
        id: 'googleFirebaseLoginBtn',
        label: badgeState === 'warn' ? badgeLabel : 'Đăng nhập Google',
        disabled: loginDisabled,
        onClick: async () => {
          try {
            setStatus('Đang mở Google sign-in...');
            await window.App.FirebaseClient.signIn();
          } catch (err) {
            setLoggedOut(`Đăng nhập lỗi: ${err.message}`);
          }
        },
      });
      setStatus(message || 'Chọn Gmail được cấp quyền');
      setActiveRoute(routeFromHash());
    };

    const setLoggedIn = async (email) => {
      renderAuthButton({
        id: 'googleLogoutBtn',
        label: `Đăng xuất ${email}`,
        variant: 'secondary',
        onClick: () => {
          window.App.FirebaseClient.signOut().catch(() => {});
          setLoggedOut('Đã đăng xuất. Vui lòng đăng nhập lại.');
        },
      });
      setStatus(email);
      setAppLocked(false);
      authLocked = false;
      await loadProtectedData().catch((err) => window.App.utils.toast(`Không tải được dữ liệu: ${err.message}`, true));
      setActiveRoute(routeFromHash());
    };

    try {
      const cfg = await window.App.FirebaseClient.init({
        onAuthStateChanged: async (state) => {
          if (!state.required) {
            panel.classList.add('hidden');
            setAppLocked(false);
            authLocked = false;
            return;
          }
          panel.classList.remove('hidden');
          if (!state.configured) {
            setLoggedOut('Firebase Auth chưa được cấu hình trong env.', 'warn', 'Chưa cấu hình', true);
            return;
          }
          if (state.authenticated) {
            await setLoggedIn(state.email);
            return;
          }
          setLoggedOut(state.error ? `Đăng nhập lỗi: ${state.error}` : 'Vui lòng đăng nhập bằng Gmail được cấp quyền.');
        },
      });
      if (!cfg.required) return true;
      panel.classList.remove('hidden');
      if (!cfg.configured) {
        setLoggedOut('Firebase Auth chưa được cấu hình trong env.', 'warn', 'Chưa cấu hình', true);
        return false;
      }

      setLoggedOut('Vui lòng đăng nhập bằng Gmail được cấp quyền.');
      const currentEmail = localStorage.getItem('google-login-email') || '';
      const existingToken = localStorage.getItem('google-session-token') || '';
      if (currentEmail && existingToken) {
        try {
          await window.App.api.request('/api/auth/me');
          await setLoggedIn(currentEmail);
          return true;
        } catch (_err) {
          localStorage.removeItem('google-session-token');
          localStorage.removeItem('google-login-email');
          setLoggedOut('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        }
      }
      return !authLocked;
    } catch (err) {
      panel.classList.remove('hidden');
      setLoggedOut(`Không khởi tạo được Firebase Auth: ${err.message}`);
      return false;
    }
  }

  function activateWaitingWorker(registration) {
    if (!registration?.waiting || !navigator.serviceWorker.controller) return;
    sessionStorage.setItem('sw-refresh-pending', '1');
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (sessionStorage.getItem('sw-refresh-pending') !== '1') return;
        sessionStorage.removeItem('sw-refresh-pending');
        reloadWithCacheBuster();
      });
      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(getAppAssetVersion())}`);
          registration.update().catch(() => {});
          activateWaitingWorker(registration);
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'installed') activateWaitingWorker(registration);
            });
          });
        } catch (_err) {
          // App still works without offline caching.
        }
      });
    }
  }

  async function init() {
    window.App.Theme?.init();
    window.App.Sidebar?.init();
    window.App.OAuth?.init();
    window.App.Credentials?.init();
    window.App.Tags?.init();
    window.App.Configs?.init();
    window.App.Manager?.init();
    window.App.RcloneCommands?.init();
    bindSettings();
    bindGlobalDialogs();
    bindRunnerEnvModal();
    initFooterOpsLinks();
    registerServiceWorker();
    const unlocked = await initGoogleLogin();

    await refreshBackendStatus();
    if (unlocked) await loadProtectedData();
    setActiveRoute(routeFromHash());
  }

  window.addEventListener('hashchange', () => setActiveRoute(routeFromHash()));
  document.addEventListener('DOMContentLoaded', init);
})();
