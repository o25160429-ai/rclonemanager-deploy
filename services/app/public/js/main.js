(function () {
  const ROUTES = ['oauth-gd', 'oauth-od', 'credentials', 'configs', 'manager', 'rclone', 'settings'];

  function $(id) {
    return document.getElementById(id);
  }

  function routeFromHash() {
    const raw = window.location.hash.replace('#', '');
    return ROUTES.includes(raw) ? raw : 'oauth-gd';
  }

  let authLocked = false;
  let protectedDataLoaded = false;

  function setActiveRoute(route) {
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
    if (route === 'configs') window.App.Configs?.loadConfigs();
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
    $('exportAllConfigsBtn')?.addEventListener('click', exportAllConfigs);
  }

  function bindGlobalDialogs() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      document.querySelectorAll(".modal.modal--open").forEach((m)=>m.classList.remove("modal--open"));
    });
  }


  function setAppLocked(locked) {
    document.body.classList.toggle('auth-locked', locked);
    const selectors = ['#section-credentials', '#section-configs', '#section-manager', '#section-rclone', '#section-settings', '[data-route=credentials]', '[data-route=configs]', '[data-route=manager]', '[data-route=rclone]', '[data-route=settings]'];
    document.querySelectorAll(selectors.join(',')).forEach((el)=>{
      if (locked) el.setAttribute('aria-disabled','true');
      else el.removeAttribute('aria-disabled');
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

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js?v=20260501-5').catch(() => {});
      });
    }
  }

  async function init() {
    window.App.Theme?.init();
    window.App.Sidebar?.init();
    window.App.OAuth?.init();
    window.App.Credentials?.init();
    window.App.Configs?.init();
    window.App.Manager?.init();
    window.App.RcloneCommands?.init();
    bindSettings();
    bindGlobalDialogs();
    registerServiceWorker();
    const unlocked = await initGoogleLogin();

    await refreshBackendStatus();
    if (unlocked) await loadProtectedData();
    setActiveRoute(routeFromHash());
  }

  window.addEventListener('hashchange', () => setActiveRoute(routeFromHash()));
  document.addEventListener('DOMContentLoaded', init);
})();
