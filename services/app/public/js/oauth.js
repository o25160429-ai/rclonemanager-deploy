(function () {
  const RCLONE_GDRIVE_CLIENT_ID = '202264815644.apps.googleusercontent.com';
  const RCLONE_GDRIVE_CLIENT_SECRET = 'X4Z3ca8xfWDb1Voo-F9a7ZxJ';
  const RCLONE_ONEDRIVE_CLIENT_ID = 'b15665d9-eda6-4092-8539-0eec376afd59';
  const RCLONE_ONEDRIVE_CLIENT_SECRET = 'qtyfaBBYA403=unZUP40~_#';
  const AZURE_SECRET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const BUILTIN_PRESETS = {
    gd: [
      {
        label: 'rclone (GDrive client ID)',
        provider: 'gd',
        clientId: RCLONE_GDRIVE_CLIENT_ID,
        clientSecret: RCLONE_GDRIVE_CLIENT_SECRET,
        redirectUri: 'http://localhost:53682/',
        builtin: true,
      },
    ],
    od: [
      {
        label: 'rclone (OneDrive)',
        provider: 'od',
        clientId: RCLONE_ONEDRIVE_CLIENT_ID,
        clientSecret: RCLONE_ONEDRIVE_CLIENT_SECRET,
        redirectUri: 'http://localhost:53682/',
        builtin: true,
      },
    ],
  };

  let mode = 'auto';
  let provider = 'gd';
  let authUrl = '';
  let lastManualRecord = null;

  function $(id) {
    return document.getElementById(id);
  }

  function backendRedirectUri() {
    return `${window.App.api.baseUrl}/`;
  }

  function normalizedClientId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isRcloneOneDrivePublicClient(cfg) {
    return cfg.provider === 'od' && normalizedClientId(cfg.clientId) === RCLONE_ONEDRIVE_CLIENT_ID;
  }

  function isRcloneGDrivePublicClient(cfg) {
    return cfg.provider === 'gd' && normalizedClientId(cfg.clientId) === RCLONE_GDRIVE_CLIENT_ID;
  }

  function sanitizeConfig(cfg) {
    if (isRcloneGDrivePublicClient(cfg)) {
      return { ...cfg, clientSecret: RCLONE_GDRIVE_CLIENT_SECRET };
    }
    if (isRcloneOneDrivePublicClient(cfg)) {
      return { ...cfg, clientSecret: RCLONE_ONEDRIVE_CLIENT_SECRET };
    }
    return cfg;
  }

  function looksLikeAzureSecretId(value) {
    return AZURE_SECRET_ID_RE.test(String(value || '').trim());
  }

  function b64Utf8(value) {
    return btoa(unescape(encodeURIComponent(value)));
  }

  function fromB64Utf8(value) {
    return decodeURIComponent(escape(atob(value)));
  }

  function buildStateParam(cfg, emailOwner) {
    cfg = sanitizeConfig(cfg);
    const payload = {
      clientId: cfg.clientId,
      clientSecret: cfg.presetId ? '' : (cfg.clientSecret || ''),
      presetId: cfg.presetId || '',
      emailOwner: b64Utf8(emailOwner),
      provider: cfg.provider,
      remoteName: cfg.remoteName,
      scope: cfg.scope,
      driveType: cfg.driveType,
      redirectUri: cfg.redirectUri,
      nonce: Math.random().toString(36).slice(2),
    };
    return b64Utf8(JSON.stringify(payload));
  }

  function decodeStateParam(state) {
    const payload = JSON.parse(fromB64Utf8(state));
    payload.emailOwner = fromB64Utf8(payload.emailOwner || '');
    return payload;
  }

  function remoteNameFromEmail(email) {
    const username = String(email || '').trim().split('@')[0] || 'owner';
    return `${provider}-${username.replace(/[^a-z0-9]+/ig, '_')}`;
  }

  function selectedPreset() {
    return allPresetOptions()[Number($('oauthPreset')?.value || 0)] || null;
  }

  function usesStoredPreset(preset) {
    return Boolean(preset?.id && !preset.custom && !preset.builtin);
  }

  function buildAuthUrl(cfg, emailOwner) {
    cfg = sanitizeConfig(cfg);
    const state = buildStateParam(cfg, emailOwner);
    sessionStorage.setItem('rstate', state);
    sessionStorage.setItem('rcfg', JSON.stringify({ ...cfg, emailOwner }));

    if (cfg.provider === 'gd') {
      const scopeMap = {
        drive: 'https://www.googleapis.com/auth/drive',
        'drive.file': 'https://www.googleapis.com/auth/drive.file',
        'drive.readonly': 'https://www.googleapis.com/auth/drive.readonly',
      };
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: scopeMap[cfg.scope] || scopeMap.drive,
        access_type: 'offline',
        prompt: 'consent',
        state,
      })}`;
    }

    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'https://graph.microsoft.com/Files.ReadWrite offline_access',
      state,
      response_mode: 'query',
    })}`;
  }

  function renderGuides() {
    const key = `${provider}-${mode}`;
    const guideMap = {
      'gd-auto': 'guideGdAuto',
      'gd-paste': 'guideGdPaste',
      'od-auto': 'guideOdAuto',
      'od-paste': 'guideOdPaste',
    };
    Object.values(guideMap).forEach((id) => $(id)?.classList.add('hidden'));
    $(guideMap[key])?.classList.remove('hidden');
    $('guideModeBadge').textContent = `${providerLabel()} ${mode === 'auto' ? 'Direct' : 'Parse'}`;
  }

  function providerLabel() {
    return provider === 'gd' ? 'Google Drive' : 'OneDrive';
  }

  function updateProviderText() {
    const label = providerLabel();
    if ($('oauthProviderBadge')) $('oauthProviderBadge').textContent = label;
    if ($('oauthTitle')) $('oauthTitle').textContent = `Tạo ${label} config`;
    if ($('oauthSubtitle')) $('oauthSubtitle').textContent = `Chọn direct auth hoặc parse URL redirect để lưu config ${label}.`;
    if ($('credentialsPanelTitle')) $('credentialsPanelTitle').textContent = `${label} credentials`;
    if ($('oauthPresetLabel')) $('oauthPresetLabel').textContent = `${label} preset`;
  }

  function updateRedirectText() {
    const uri = backendRedirectUri();
    $('redirectUriDisplay').textContent = uri;
    document.querySelectorAll('.js-redirect-uri').forEach((el) => {
      el.textContent = uri;
    });
  }

  function updateModeUI() {
    document.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.classList.toggle('mode-card--selected', btn.dataset.mode === mode);
    });
    $('redirectAutoPanel').classList.toggle('hidden', mode !== 'auto');
    $('redirectPastePanel').classList.toggle('hidden', mode !== 'paste');
    $('oauthPrimaryIcon').textContent = mode === 'auto' ? '🚀' : '🔗';
    $('oauthPrimaryLabel').textContent = mode === 'auto' ? 'Direct Auth →' : 'Generate URL →';
    renderGuides();
    updateSecretRequired();
  }

  function updateProviderUI() {
    updateProviderText();
    $('scopeWrap').classList.toggle('hidden', provider !== 'gd');
    $('driveTypeWrap').classList.toggle('hidden', provider !== 'od');
    renderGuides();
    renderPresetOptions(true);
    applySelectedPreset();
    updateSecretRequired();
  }

  function selectMode(nextMode) {
    mode = nextMode;
    updateModeUI();
  }

  function setProvider(nextProvider) {
    provider = nextProvider;
    updateProviderUI();
  }

  function allPresetOptions() {
    const custom = [{
      label: 'Custom App',
      provider,
      clientId: '',
      clientSecret: '',
      redirectUri: backendRedirectUri(),
      custom: true,
    }];
    const saved = (window.App.state.presets || []).filter((item) => item.provider === provider);
    return custom.concat(saved, BUILTIN_PRESETS[provider] || []);
  }

  function renderPresetOptions(reset = false) {
    const select = $('oauthPreset');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '';
    allPresetOptions().forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = preset.builtin ? `${preset.label} (built-in)` : preset.label;
      select.appendChild(option);
    });
    if (!reset && previous && Number(previous) < select.options.length) select.value = previous;
  }

  function applySelectedPreset() {
    const preset = allPresetOptions()[Number($('oauthPreset').value || 0)];
    if (!preset) return;
    $('clientId').value = preset.clientId || '';
    $('clientSecret').value = preset.clientSecret || '';
    if (preset.custom) { $('clientId').value=''; $('clientSecret').value=''; }
    if (preset.redirectUri) $('customRedirectUri').value = preset.redirectUri;
    if (preset.builtin) selectMode('paste');
    updateSecretRequired();
  }

  function updateSecretRequired() {
    const cfg = {
      provider,
      clientId: $('clientId').value.trim(),
    };
    const isRcloneOneDrive = isRcloneOneDrivePublicClient(cfg);
    const isRcloneGDrive = isRcloneGDrivePublicClient(cfg);
    const isRequired = (provider === 'gd' && !isRcloneGDrive)
      || (provider === 'od' && mode !== 'paste' && !isRcloneOneDrive);
    $('clientSecretRequired').classList.toggle('hidden', !isRequired);
    $('clientSecret').placeholder = isRcloneGDrive || isRcloneOneDrive
      ? 'Dùng secret mặc định của rclone'
      : 'OAuth client secret';
  }

  function getFormConfig() {
    const redirectUri = mode === 'auto'
      ? backendRedirectUri()
      : ($('customRedirectUri').value.trim() || 'http://localhost:53682/');
    return sanitizeConfig({
      clientId: $('clientId').value.trim(),
      clientSecret: $('clientSecret').value.trim(),
      remoteName: $('remoteName').value.trim() || `${provider}-${($('emailOwner').value.trim().split('@')[0] || 'owner').replace(/[^a-z0-9]+/ig, '_')}`,
      scope: $('scope').value,
      driveType: $('driveType').value,
      provider,
      redirectUri,
      mode,
      googleRootFolderMode: $('googleRootFolderMode')?.value || 'normal',
    });
  }

  function validateConfig(cfg, emailOwner) {
    if (!emailOwner) return 'Nhập email owner.';
    if (!cfg.clientId) return 'Nhập Client ID.';
    if (cfg.clientSecret && looksLikeAzureSecretId(cfg.clientSecret)) {
      return 'Client Secret đang giống Azure Secret ID. Hãy copy cột Value trong Azure Certificates & secrets, không copy Secret ID.';
    }
    if (cfg.provider === 'gd' && !cfg.clientSecret && !isRcloneGDrivePublicClient(cfg)) return 'Google Drive cần Client Secret để exchange token.';
    if (cfg.provider === 'od' && cfg.mode !== 'paste' && !cfg.clientSecret && !isRcloneOneDrivePublicClient(cfg)) return 'OneDrive Direct Auth nên dùng client secret.';
    return '';
  }

  function showOauthStep(step) {
    ['oauthStepConfig', 'oauthStepAuthorize', 'oauthStepExchange', 'oauthStepResult', 'oauthStepError'].forEach((id) => {
      $(id).classList.toggle('oauth-step--active', id === step);
    });
  }

  function setFlow(n) {
    for (let i = 1; i <= 5; i += 1) {
      const el = $(`flowStep${i}`);
      el.classList.remove('flow__step--active', 'flow__step--done');
      if (i < n) el.classList.add('flow__step--done');
      if (i === n) el.classList.add('flow__step--active');
    }
  }

  function step1Action() {
    const cfg = getFormConfig();
    const emailOwner = $('emailOwner').value.trim();
    const validation = validateConfig(cfg, emailOwner);
    if (validation) {
      window.App.utils.toast(validation, true);
      return;
    }

    if (mode === 'auto' && !window.App.state.backend.online) {
      window.App.utils.toast('Backend offline. Chuyển sang Parse từ URL để chạy thủ công.', true);
      selectMode('paste');
      return;
    }

    authUrl = buildAuthUrl(cfg, emailOwner);
    if (mode === 'auto') {
      $('authUrlAuto').textContent = authUrl;
      $('autoWait').classList.remove('hidden');
      $('pasteFlow').classList.add('hidden');
      showOauthStep('oauthStepAuthorize');
      setFlow(3);
      window.location.href = authUrl;
      return;
    }

    $('authUrlPaste').textContent = authUrl;
    $('autoWait').classList.add('hidden');
    $('pasteFlow').classList.remove('hidden');
    showOauthStep('oauthStepAuthorize');
    setFlow(3);
  }

  function extractFromPastedUrl() {
    const raw = $('pastedUrl').value.trim();
    if (!raw) {
      window.App.utils.toast('Dán URL vào ô trên.', true);
      return;
    }

    let url;
    try {
      url = new URL(raw);
    } catch (_err) {
      window.App.utils.toast('URL không hợp lệ.', true);
      return;
    }

    const error = url.searchParams.get('error');
    if (error) {
      showErr(`OAuth error: ${error} - ${url.searchParams.get('error_description') || ''}`);
      return;
    }

    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const savedState = sessionStorage.getItem('rstate');
    if (!code) {
      window.App.utils.toast('Không tìm thấy code trong URL.', true);
      return;
    }
    if (savedState && returnedState && savedState !== returnedState) {
      showErr('State mismatch. Thử lại từ đầu.');
      return;
    }

    const cfg = JSON.parse(sessionStorage.getItem('rcfg') || '{}');
    exchangeCode(code, cfg);
  }

  async function exchangeCode(code, cfg) {
    showOauthStep('oauthStepExchange');
    setFlow(4);
    try {
      const result = await window.App.api.request('/api/oauth/exchange', {
        method: 'POST',
        body: JSON.stringify({ code, config: cfg }),
      });
      await buildServerConfig(result);
    } catch (err) {
      showErr(`Không exchange token qua backend: ${err.message}`);
    }
  }

  function setRcloneCheckStatus(label, tone = 'gray') {
    const status = $('oauthRcloneCheckStatus');
    if (!status) return;
    status.className = `badge badge--${tone}`;
    status.textContent = label;
  }

  function renderRcloneCheckOutput(result) {
    const output = $('oauthRcloneCheckOutput');
    if (!output) return;
    const body = result.json
      ? JSON.stringify(result.json, null, 2)
      : (result.stdout || '');
    const parseMessage = result.jsonParseError ? `\nJSON parse error: ${result.jsonParseError}` : '';
    const truncatedMessage = result.truncated ? '\nOutput truncated at 2 MB.' : '';
    output.textContent = `${body || '(empty)'}${parseMessage}${truncatedMessage}`;
    if (result.stderr) output.textContent += `\n\nstderr:\n${result.stderr}`;
  }

  async function runSavedConfigAbout(record) {
    if (!record.id || !record.remoteName) {
      setRcloneCheckStatus('Không có config id', 'yellow');
      $('oauthRcloneCheckOutput').textContent = 'Không thể chạy rclone about vì response thiếu config id hoặc remote name.';
      return;
    }

    const remote = `${record.remoteName}:`;
    const commandText = `rclone about ${remote} --json`;
    if ($('aboutCommand')) $('aboutCommand').textContent = commandText;
    setRcloneCheckStatus('Đang chạy', 'yellow');
    $('oauthRcloneCheckOutput').textContent = 'Backend đang chạy rclone about bằng config vừa lưu...';

    const result = await window.App.api.request('/api/rclone/run', {
      method: 'POST',
      body: JSON.stringify({
        command: ['about', remote, '--json'],
        configIds: [record.id],
        outputMode: 'json',
        timeoutMs: 120000,
      }),
      allowStatuses: [422],
    });

    renderRcloneCheckOutput(result);
    const ok = result.exitCode === 0 && !result.timedOut;
    setRcloneCheckStatus(ok ? 'OK' : 'Lỗi', ok ? 'green' : 'red');
    if (!ok) window.App.utils.toast('rclone about trả về lỗi. Xem panel Rclone about check.', true);
  }

  async function buildServerConfig(result) {
    const record = result.record || {};
    const conf = record.rcloneConfig || '';
    const remoteName = record.remoteName || 'myremote';
    $('configOutput').textContent = conf;
    $('testCommand').textContent = `rclone lsd ${remoteName}:`;
    if ($('aboutCommand')) $('aboutCommand').textContent = `rclone about ${remoteName}: --json`;
    setRcloneCheckStatus('Đang chạy', 'yellow');
    if ($('oauthRcloneCheckOutput')) $('oauthRcloneCheckOutput').textContent = 'Đang chờ backend chạy rclone about...';
    $('saveConfigBtn').textContent = result.action === 'updated' ? 'Đã cập nhật Firebase' : 'Đã lưu Firebase';
    $('saveConfigBtn').disabled = true;
    lastManualRecord = null;
    if (window.App.Configs) window.App.Configs.loadConfigs().catch(() => {});
    if (window.App.Manager) window.App.Manager.refreshOptions().catch(() => {});
    showOauthStep('oauthStepResult');
    setFlow(5);
    try {
      await runSavedConfigAbout(record);
    } catch (err) {
      setRcloneCheckStatus('Lỗi', 'red');
      if ($('oauthRcloneCheckOutput')) $('oauthRcloneCheckOutput').textContent = err.message;
      window.App.utils.toast(`Không chạy được rclone about: ${err.message}`, true);
    }
  }

  async function loadSavedCallbackResult(id, action) {
    try {
      const record = await window.App.api.request(`/api/configs/${encodeURIComponent(id)}`);
      await buildServerConfig({ action, record });
    } catch (err) {
      window.App.utils.toast(`Không tải được config vừa lưu để check rclone: ${err.message}`, true);
    }
  }

  async function saveManualConfig() {
    if (!lastManualRecord) {
      window.App.utils.toast('Chưa có config để lưu.', true);
      return;
    }
    try {
      const saved = await window.App.api.request('/api/configs/save', {
        method: 'POST',
        body: JSON.stringify(lastManualRecord),
      });
      window.App.utils.toast(`Đã lưu ${saved.remoteName}.`);
      if (window.App.Configs) await window.App.Configs.loadConfigs();
      if (window.App.Manager) await window.App.Manager.refreshOptions();
    } catch (err) {
      window.App.utils.toast(`Không lưu được Firebase: ${err.message}`, true);
    }
  }

  function showErr(message) {
    $('oauthFlowError').textContent = message;
    showOauthStep('oauthStepError');
  }

  function reset() {
    sessionStorage.removeItem('rcfg');
    sessionStorage.removeItem('rstate');
    lastManualRecord = null;
    $('saveConfigBtn').textContent = '☁️ Save to Firebase';
    $('saveConfigBtn').disabled = false;
    if ($('oauthRcloneCheckStatus')) setRcloneCheckStatus('Chưa chạy', 'gray');
    if ($('oauthRcloneCheckOutput')) $('oauthRcloneCheckOutput').textContent = 'Đang chờ config.';
    if ($('aboutCommand')) $('aboutCommand').textContent = 'rclone about myremote: --json';
    showOauthStep('oauthStepConfig');
    setFlow(1);
    history.replaceState({}, '', location.pathname + location.hash);
  }

  function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => selectMode(btn.dataset.mode));
    });
    $('oauthPreset')?.addEventListener('change', applySelectedPreset);
    $('emailOwner')?.addEventListener('blur', () => { if (!$('remoteName').value.trim()) $('remoteName').value = `${provider}-${($('emailOwner').value.trim().split('@')[0] || 'owner').replace(/[^a-z0-9]+/ig, '_')}`; });
    $('clientSecret')?.addEventListener('input', updateSecretRequired);
    $('clientId')?.addEventListener('input', updateSecretRequired);
    $('reloadPresetsBtn')?.addEventListener('click', async () => {
      if (window.App.Credentials) await window.App.Credentials.loadPresets();
      renderPresetOptions();
    });
    $('copyRedirectBtn')?.addEventListener('click', () => window.App.utils.copyText(backendRedirectUri(), 'Đã copy redirect URI.'));
    $('oauthPrimaryBtn')?.addEventListener('click', step1Action);
    $('copyAuthAutoBtn')?.addEventListener('click', () => window.App.utils.copyText(authUrl, 'Đã copy auth URL.'));
    $('copyAuthPasteBtn')?.addEventListener('click', () => window.App.utils.copyText(authUrl, 'Đã copy auth URL.'));
    $('openAuthAutoBtn')?.addEventListener('click', () => window.open(authUrl, '_blank', 'noopener'));
    $('openAuthPasteBtn')?.addEventListener('click', () => window.open(authUrl, '_blank', 'noopener'));
    $('extractTokenBtn')?.addEventListener('click', extractFromPastedUrl);
    $('oauthBackBtn')?.addEventListener('click', () => {
      showOauthStep('oauthStepConfig');
      setFlow(1);
    });
    $('copyConfigBtn')?.addEventListener('click', () => window.App.utils.copyText($('configOutput').textContent, 'Đã copy config.'));
    $('saveConfigBtn')?.addEventListener('click', saveManualConfig);
    $('newConfigBtn')?.addEventListener('click', reset);
    $('retryOauthBtn')?.addEventListener('click', reset);
  }

  function handleCallbackParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('saved') === 'true') {
      const action = params.get('action') === 'updated' ? 'cập nhật' : 'lưu';
      $('oauthSavedText').textContent = `Đã ${action} remote ${params.get('remote') || ''}.`;
      $('oauthSavedBanner').classList.remove('hidden');
      const id = params.get('id') || '';
      if (id) {
        loadSavedCallbackResult(id, params.get('action') || 'updated');
      }
      history.replaceState({}, '', location.pathname + location.hash);
      return;
    }
    if (params.get('error')) {
      $('oauthErrorText').textContent = params.get('error');
      $('oauthErrorBanner').classList.remove('hidden');
      history.replaceState({}, '', location.pathname + location.hash);
      return;
    }

    const code = params.get('code');
    if (!code) return;

    const returnedState = params.get('state');
    const savedState = sessionStorage.getItem('rstate');
    if (savedState && returnedState && savedState !== returnedState) {
      showErr('State mismatch. Vui lòng thử lại.');
      return;
    }

    let cfg = JSON.parse(sessionStorage.getItem('rcfg') || '{}');
    if (!cfg.clientId && returnedState) cfg = decodeStateParam(returnedState);
    exchangeCode(code, cfg);
  }

  function setBackendBanner() {
    $('backendOfflineBanner').classList.toggle('hidden', window.App.state.backend.online);
  }

  function init() {
    updateRedirectText();
    bindEvents();
    updateModeUI();
    updateProviderUI();
    handleCallbackParams();
    setBackendBanner();
  }

  window.App = window.App || {};
  window.App.OAuth = {
    init,
    setProviderFromRoute(next) { setProvider(next); },
    renderPresetOptions,
    setBackendBanner,
    buildAuthUrl,
  };
})();
