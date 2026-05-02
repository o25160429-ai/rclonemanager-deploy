(function () {
  const RCLONE_GDRIVE_CLIENT_ID = '202264815644.apps.googleusercontent.com';
  const RCLONE_GDRIVE_CLIENT_SECRET = 'X4Z3ca8xfWDb1Voo-F9a7ZxJ';
  const RCLONE_ONEDRIVE_CLIENT_ID = 'b15665d9-eda6-4092-8539-0eec376afd59';
  const RCLONE_ONEDRIVE_CLIENT_SECRET = 'qtyfaBBYA403=unZUP40~_#';
  const ONEDRIVE_OAUTH_SCOPE = 'https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read offline_access';
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
  let pendingManualExchange = null;
  let lastOauthContext = {};

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

  function decodeStateEmail(value) {
    if (!value) return '';
    try {
      return fromB64Utf8(value);
    } catch (_err) {
      return String(value || '');
    }
  }

  function buildStateParam(cfg, emailOwner) {
    cfg = sanitizeConfig(cfg);
    const payload = {
      clientId: cfg.clientId,
      clientSecret: cfg.presetId ? '' : (cfg.clientSecret || ''),
      presetId: cfg.presetId || '',
      presetLabel: cfg.presetLabel || '',
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
    payload.emailOwner = decodeStateEmail(payload.emailOwner || payload.email_owner || '');
    return payload;
  }

  function safeDecodeStateParam(state) {
    if (!state) return {};
    try {
      return decodeStateParam(state);
    } catch (_err) {
      return {};
    }
  }

  function nonEmptyValues(source) {
    return Object.fromEntries(Object.entries(source || {}).filter(([_key, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string') return value.trim() !== '';
      return true;
    }));
  }

  function readSavedConfig() {
    try {
      return JSON.parse(sessionStorage.getItem('rcfg') || '{}');
    } catch (_err) {
      return {};
    }
  }

  function presetLabelFromSource(source = {}) {
    const explicit = String(
      source.presetLabel
      || source.preset_label
      || source.credentialPresetLabel
      || source.credentialPresetName
      || ''
    ).trim();
    if (explicit) return explicit;

    const presetId = String(source.presetId || source.preset_id || source.credentialPresetId || '').trim();
    const sourceProvider = String(source.provider || provider || '').trim();
    const sourceClientId = normalizedClientId(source.clientId);
    const presets = [
      ...(window.App.state.presets || []),
      ...(BUILTIN_PRESETS[sourceProvider] || []),
    ];

    if (presetId) {
      const byId = presets.find((preset) => String(preset.id || '') === presetId);
      if (byId?.label) return byId.label;
    }

    if (sourceClientId) {
      const byClientId = presets.find((preset) =>
        (!sourceProvider || String(preset.provider || sourceProvider) === sourceProvider)
        && normalizedClientId(preset.clientId) === sourceClientId);
      if (byClientId?.label) return byClientId.label;
    }

    return presetId ? `Preset ${presetId}` : 'Custom App';
  }

  function oauthIdentityFrom(source = {}) {
    if (Object.keys(source || {}).length === 0) {
      return { clientId: '', emailOwner: '', presetLabel: '' };
    }
    return {
      clientId: String(source.clientId || '').trim(),
      emailOwner: String(source.emailOwner || source.email_owner || '').trim(),
      presetLabel: presetLabelFromSource(source),
    };
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value || '-';
  }

  function renderOauthIdentity(source = {}) {
    lastOauthContext = { ...source };
    const identity = oauthIdentityFrom(source);
    setText('oauthExchangeClientId', identity.clientId);
    setText('oauthExchangeEmailOwner', identity.emailOwner);
    setText('oauthExchangePresetLabel', identity.presetLabel);
    setText('oauthResultClientId', identity.clientId);
    setText('oauthResultEmailOwner', identity.emailOwner);
    setText('oauthResultPresetLabel', identity.presetLabel);
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

  function authUrlWithLoginHint(baseUrl, params, emailOwner) {
    const search = new URLSearchParams(params);
    const loginHint = String(emailOwner || '').trim();
    if (loginHint) search.set('login_hint', loginHint);
    return `${baseUrl}?${search}`;
  }

  function currentUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, '');
    const queryIndex = hash.indexOf('?');
    if (queryIndex >= 0) {
      new URLSearchParams(hash.slice(queryIndex + 1)).forEach((value, key) => {
        params.set(key, value);
      });
    }
    return params;
  }

  function firstParam(params, names) {
    for (const name of names) {
      const value = params.get(name);
      if (value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  }

  function hasOauthFormParams(params) {
    return [
      'type', 'mode', 'flow',
      'label-preset', 'preset-label', 'labelPreset', 'preset', 'preset-id', 'presetId',
      'email-owner', 'emailOwner', 'email_owner', 'email', 'login_hint',
      'remote', 'remote-name', 'remoteName',
      'scope', 'drive-type', 'driveType',
      'root-folder', 'rootFolder', 'googleRootFolderMode',
      'redirect-uri', 'redirectUri',
      'client-id', 'clientId',
      'client-secret', 'clientSecret',
    ].some((name) => params.has(name));
  }

  function normalizeModeParam(value) {
    const modeName = String(value || '').trim().toLowerCase();
    if (['direct', 'auto', 'direct-auth'].includes(modeName)) return 'auto';
    if (['paste', 'parse', 'manual', 'url', 'parse-url'].includes(modeName)) return 'paste';
    return '';
  }

  function normalizeLookup(value) {
    return String(value || '').trim().toLowerCase();
  }

  function selectPresetFromParams(params, preserveMode) {
    const select = $('oauthPreset');
    if (!select) return false;
    const presetId = firstParam(params, ['preset-id', 'presetId', 'preset']);
    const presetLabel = firstParam(params, ['label-preset', 'preset-label', 'labelPreset']);
    if (!presetId && !presetLabel) return false;

    const options = allPresetOptions();
    const idNeedle = normalizeLookup(presetId);
    const labelNeedle = normalizeLookup(presetLabel);
    let index = -1;

    if (idNeedle) {
      index = options.findIndex((preset) => normalizeLookup(preset.id) === idNeedle);
    }
    if (index < 0 && labelNeedle) {
      index = options.findIndex((preset) => normalizeLookup(preset.label) === labelNeedle);
    }
    if (index < 0 && labelNeedle) {
      index = options.findIndex((preset) => normalizeLookup(preset.label).includes(labelNeedle));
    }
    if (index < 0) return false;

    select.value = String(index);
    applySelectedPreset({ preserveMode });
    return true;
  }

  function applyUrlParams() {
    const params = currentUrlParams();
    if (!hasOauthFormParams(params)) return false;

    const modeFromParam = normalizeModeParam(firstParam(params, ['type', 'mode', 'flow']));
    const preserveMode = Boolean(modeFromParam);
    const selectedByParam = selectPresetFromParams(params, preserveMode);

    const emailOwner = firstParam(params, ['email-owner', 'emailOwner', 'email_owner', 'email', 'login_hint']);
    if (emailOwner && $('emailOwner')) $('emailOwner').value = emailOwner;

    const remoteName = firstParam(params, ['remote', 'remote-name', 'remoteName']);
    if (remoteName && $('remoteName')) $('remoteName').value = remoteName;

    const scope = firstParam(params, ['scope']);
    if (scope && $('scope')) $('scope').value = scope;

    const driveType = firstParam(params, ['drive-type', 'driveType']);
    if (driveType && $('driveType')) $('driveType').value = driveType;

    const rootFolder = firstParam(params, ['root-folder', 'rootFolder', 'googleRootFolderMode']);
    if (rootFolder && $('googleRootFolderMode')) $('googleRootFolderMode').value = rootFolder;

    const redirectUri = firstParam(params, ['redirect-uri', 'redirectUri']);
    if (redirectUri && $('customRedirectUri')) $('customRedirectUri').value = redirectUri;

    const clientId = firstParam(params, ['client-id', 'clientId']);
    if (clientId && $('clientId')) $('clientId').value = clientId;

    const clientSecret = firstParam(params, ['client-secret', 'clientSecret']);
    if (clientSecret && $('clientSecret')) {
      $('clientSecret').value = clientSecret;
      $('clientSecret').disabled = false;
    }

    if (!selectedByParam && (clientId || clientSecret)) updateSecretRequired();
    if (modeFromParam) selectMode(modeFromParam);
    updateSecretRequired();
    return true;
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
      return authUrlWithLoginHint('https://accounts.google.com/o/oauth2/v2/auth', {
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: scopeMap[cfg.scope] || scopeMap.drive,
        access_type: 'offline',
        prompt: 'consent',
        state,
      }, emailOwner);
    }

    return authUrlWithLoginHint('https://login.microsoftonline.com/common/oauth2/v2.0/authorize', {
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: ONEDRIVE_OAUTH_SCOPE,
      state,
      response_mode: 'query',
    }, emailOwner);
  }

  function buildProviderLoginUrl(emailOwner) {
    const loginHint = String(emailOwner || '').trim();
    if (provider === 'gd') {
      const params = new URLSearchParams({
        continue: 'https://myaccount.google.com/',
      });
      if (loginHint) {
        params.set('Email', loginHint);
        params.set('login_hint', loginHint);
      }
      return `https://accounts.google.com/AccountChooser?${params}`;
    }

    const params = new URLSearchParams({ auth: '2' });
    if (loginHint) params.set('login_hint', loginHint);
    return `https://www.office.com/?${params}`;
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
    if ($('providerLoginBtn')) {
      $('providerLoginBtn').textContent = `Login ${provider === 'gd' ? 'Google' : 'Microsoft'}`;
      $('providerLoginBtn').title = `Mở trang đăng nhập ${label}`;
    }
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

  async function loadOAuthPresets() {
    try {
      const data = await window.App.api.request('/api/oauth/presets');
      window.App.state.presets = data.items || [];
      renderPresetOptions();
      if (Object.keys(lastOauthContext).length > 0) renderOauthIdentity(lastOauthContext);
      if (!applyUrlParams()) applySelectedPreset();
    } catch (err) {
      window.App.utils.toast(`Không tải được OAuth presets: ${err.message}`, true);
      renderPresetOptions();
      applyUrlParams();
    }
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

  function applySelectedPreset(options = {}) {
    const preset = selectedPreset();
    if (!preset) return;
    const storedPreset = usesStoredPreset(preset);
    $('clientId').value = preset.clientId || '';
    $('clientSecret').value = storedPreset ? '' : (preset.clientSecret || '');
    $('clientSecret').disabled = storedPreset;
    if (storedPreset) $('clientSecret').placeholder = 'Dùng client secret đã lưu trên backend';
    if (preset.custom) { $('clientId').value=''; $('clientSecret').value=''; $('clientSecret').disabled = false; }
    if (preset.redirectUri) $('customRedirectUri').value = preset.redirectUri;
    if (preset.builtin && !options.preserveMode) selectMode('paste');
    updateSecretRequired();
  }

  function updateSecretRequired() {
    const preset = selectedPreset();
    const storedPreset = usesStoredPreset(preset);
    const cfg = {
      provider,
      clientId: $('clientId').value.trim(),
    };
    const isRcloneOneDrive = isRcloneOneDrivePublicClient(cfg);
    const isRcloneGDrive = isRcloneGDrivePublicClient(cfg);
    $('clientSecretRequired').classList.add('hidden');
    $('clientSecret').placeholder = storedPreset
      ? 'Backend dùng client secret đã lưu theo preset'
      : (isRcloneGDrive || isRcloneOneDrive
      ? 'Dùng secret mặc định của rclone'
      : 'Tùy chọn, backend sẽ tìm secret theo Client ID nếu có preset');
  }

  function getFormConfig() {
    const preset = selectedPreset();
    const storedPreset = usesStoredPreset(preset);
    const redirectUri = mode === 'auto'
      ? backendRedirectUri()
      : ($('customRedirectUri').value.trim() || 'http://localhost:53682/');
    return sanitizeConfig({
      clientId: $('clientId').value.trim(),
      clientSecret: storedPreset ? '' : $('clientSecret').value.trim(),
      presetId: storedPreset ? preset.id : '',
      presetLabel: preset?.label || '',
      hasStoredClientSecret: storedPreset && preset.hasClientSecret,
      remoteName: $('remoteName').value.trim(),
      scope: $('scope').value,
      driveType: $('driveType').value,
      provider,
      redirectUri,
      mode,
      googleRootFolderMode: $('googleRootFolderMode')?.value || 'normal',
    });
  }

  function validateConfig(cfg) {
    if (!cfg.clientId) return 'Nhập Client ID.';
    if (cfg.clientSecret && looksLikeAzureSecretId(cfg.clientSecret)) {
      return 'Client Secret đang giống Azure Secret ID. Hãy copy cột Value trong Azure Certificates & secrets, không copy Secret ID.';
    }
    return '';
  }

  function openProviderLogin() {
    const emailOwner = $('emailOwner')?.value.trim() || '';
    window.open(buildProviderLoginUrl(emailOwner), '_blank', 'noopener');
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
    const validation = validateConfig(cfg);
    if (validation) {
      window.App.utils.toast(validation, true);
      return;
    }
    if (!cfg.remoteName && emailOwner) {
      cfg.remoteName = remoteNameFromEmail(emailOwner);
      $('remoteName').value = cfg.remoteName;
    }

    if (mode === 'auto' && !window.App.state.backend.online) {
      window.App.utils.toast('Backend offline. Chuyển sang Parse từ URL để chạy thủ công.', true);
      selectMode('paste');
      return;
    }

    hideAuthCodePreview();
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

  function hideAuthCodePreview() {
    pendingManualExchange = null;
    $('authCodePreviewPanel')?.classList.add('hidden');
    if ($('authPreviewEmailOwner')) $('authPreviewEmailOwner').textContent = '-';
    if ($('authPreviewPresetLabel')) $('authPreviewPresetLabel').textContent = '-';
    if ($('authPreviewClientId')) $('authPreviewClientId').textContent = '-';
    if ($('authPreviewConfigCount')) $('authPreviewConfigCount').textContent = '0';
  }

  function renderAuthCodePreview(preview) {
    $('authPreviewEmailOwner').textContent = preview.emailOwner || 'Tự lấy sau exchange';
    $('authPreviewPresetLabel').textContent = preview.presetLabel || 'Custom App';
    $('authPreviewClientId').textContent = preview.clientId || '-';
    $('authPreviewConfigCount').textContent = String(preview.configCount || 0);
    $('authCodePreviewPanel').classList.remove('hidden');
  }

  function configFromReturnedState(returnedState) {
    const stateCfg = safeDecodeStateParam(returnedState);
    const savedCfg = readSavedConfig();
    return {
      ...nonEmptyValues(savedCfg),
      ...nonEmptyValues(stateCfg),
    };
  }

  async function previewAuthCode(rawUrl, code, returnedState) {
    const cfg = configFromReturnedState(returnedState);
    if (!cfg.clientId) {
      window.App.utils.toast('Không tìm thấy cấu hình OAuth đã tạo. Hãy Generate URL lại.', true);
      return;
    }

    $('extractTokenBtn').disabled = true;
    $('extractTokenBtn').textContent = 'Đang parse...';
    try {
      const preview = await window.App.api.request('/api/oauth/preview', {
        method: 'POST',
        body: JSON.stringify({ redirectUrl: rawUrl, config: cfg }),
      });
      pendingManualExchange = { code, cfg };
      renderAuthCodePreview(preview);
    } catch (err) {
      hideAuthCodePreview();
      showErr(`Không preview được auth code: ${err.message}`);
    } finally {
      $('extractTokenBtn').disabled = false;
      $('extractTokenBtn').textContent = '⚡ Parse URL';
    }
  }

  function confirmManualExchange() {
    if (!pendingManualExchange) {
      window.App.utils.toast('Chưa có auth code đã parse.', true);
      return;
    }
    exchangeCode(pendingManualExchange.code, pendingManualExchange.cfg);
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

    previewAuthCode(raw, code, returnedState);
  }

  async function exchangeCode(code, cfg) {
    renderOauthIdentity(cfg);
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

    const result = await window.App.api.request(`/api/oauth/check/${encodeURIComponent(record.id)}`, {
      method: 'POST',
      body: JSON.stringify({}),
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
    renderOauthIdentity(record);
    $('configOutput').textContent = conf;
    $('testCommand').textContent = `rclone lsd ${remoteName}:`;
    if ($('aboutCommand')) $('aboutCommand').textContent = `rclone about ${remoteName}: --json`;
    setRcloneCheckStatus('Đang chạy', 'yellow');
    if ($('oauthRcloneCheckOutput')) $('oauthRcloneCheckOutput').textContent = 'Đang chờ backend chạy rclone about...';
    $('saveConfigBtn').textContent = result.action === 'updated' ? 'Đã cập nhật Firebase' : 'Đã lưu Firebase';
    $('saveConfigBtn').disabled = true;
    lastManualRecord = null;
    hideAuthCodePreview();
    if (!document.body.classList.contains('auth-locked')) {
      if (window.App.Configs) window.App.Configs.loadConfigs().catch(() => {});
      if (window.App.Manager) window.App.Manager.refreshOptions().catch(() => {});
    }
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
      const result = await window.App.api.request(`/api/oauth/result/${encodeURIComponent(id)}`);
      await buildServerConfig({ action, record: result.record });
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
    renderOauthIdentity();
    hideAuthCodePreview();
    $('remoteName').value = '';
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
    $('genRemoteNameBtn')?.addEventListener('click', () => {
      const email = $('emailOwner').value.trim();
      if (!email) {
        window.App.utils.toast('Nhập email owner trước khi gen remote name.', true);
        return;
      }
      $('remoteName').value = remoteNameFromEmail(email);
    });
    $('clientSecret')?.addEventListener('input', updateSecretRequired);
    $('clientId')?.addEventListener('input', updateSecretRequired);
    $('reloadPresetsBtn')?.addEventListener('click', async () => {
      await loadOAuthPresets();
      renderPresetOptions();
    });
    $('copyRedirectBtn')?.addEventListener('click', () => window.App.utils.copyText(backendRedirectUri(), 'Đã copy redirect URI.'));
    $('providerLoginBtn')?.addEventListener('click', openProviderLogin);
    $('oauthPrimaryBtn')?.addEventListener('click', step1Action);
    $('copyAuthAutoBtn')?.addEventListener('click', () => window.App.utils.copyText(authUrl, 'Đã copy auth URL.'));
    $('copyAuthPasteBtn')?.addEventListener('click', () => window.App.utils.copyText(authUrl, 'Đã copy auth URL.'));
    $('openAuthAutoBtn')?.addEventListener('click', () => window.open(authUrl, '_blank', 'noopener'));
    $('openAuthPasteBtn')?.addEventListener('click', () => window.open(authUrl, '_blank', 'noopener'));
    $('extractTokenBtn')?.addEventListener('click', extractFromPastedUrl);
    $('confirmExchangeBtn')?.addEventListener('click', confirmManualExchange);
    $('clearAuthPreviewBtn')?.addEventListener('click', hideAuthCodePreview);
    $('pastedUrl')?.addEventListener('input', hideAuthCodePreview);
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

    const cfg = configFromReturnedState(returnedState);
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
    applyUrlParams();
    loadOAuthPresets();
    handleCallbackParams();
    setBackendBanner();
  }

  window.App = window.App || {};
  window.App.OAuth = {
    init,
    setProviderFromRoute(next) {
      setProvider(next);
      applyUrlParams();
    },
    renderPresetOptions,
    setBackendBanner,
    buildAuthUrl,
    buildProviderLoginUrl,
    applyUrlParams,
  };
})();
