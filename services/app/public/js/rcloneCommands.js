(function () {
  const PRESETS = {
    lsd: { outputMode: 'raw', requiresTarget: false },
    lsjson: { outputMode: 'json', requiresTarget: false },
    size_json: { outputMode: 'json', requiresTarget: false },
    about_json: { outputMode: 'json', requiresTarget: false },
    tree: { outputMode: 'raw', requiresTarget: false },
    copy: { outputMode: 'raw', requiresTarget: true, supportsDryRun: true },
    sync: { outputMode: 'raw', requiresTarget: true, supportsDryRun: true },
    move: { outputMode: 'raw', requiresTarget: true, supportsDryRun: true },
    check: { outputMode: 'raw', requiresTarget: true },
  };

  let configs = [];

  function $(id) {
    return document.getElementById(id);
  }

  function optionLabel(config) {
    const provider = config.provider === 'gd' ? 'GD' : 'OD';
    return `${config.remoteName} (${provider}) - ${config.emailOwner || 'no email'}`;
  }

  function selectedConfig(selectId) {
    const id = $(selectId)?.value;
    if (!id) return null;
    return configs.find((item) => item.id === id) || null;
  }

  function quoteArg(value) {
    const text = String(value || '');
    if (!text) return '""';
    if (!/[\s"']/.test(text)) return text;
    return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }

  function cleanRemotePath(value) {
    return String(value || '').trim().replace(/^\/+/, '');
  }

  function remoteRef(config, subPath) {
    const path = cleanRemotePath(subPath);
    return quoteArg(`${config.remoteName}:${path}`);
  }

  function oneDrivePersonalVaultFilter(source) {
    if (source?.provider !== 'od' || !$('rcloneExcludePersonalVault')?.checked) return '';
    return ' --exclude "/Personal Vault/**"';
  }

  function selectedConfigIds() {
    return Array.from(new Set([
      $('rcloneSourceConfigSelect')?.value,
      $('rcloneTargetConfigSelect')?.value,
    ].filter(Boolean)));
  }

  function renderConfigOptions() {
    const source = $('rcloneSourceConfigSelect');
    const target = $('rcloneTargetConfigSelect');
    if (!source || !target) return;

    const previousSource = source.value;
    const previousTarget = target.value;
    source.innerHTML = '';
    target.innerHTML = '<option value="">No target</option>';

    configs.forEach((config) => {
      const sourceOption = document.createElement('option');
      sourceOption.value = config.id;
      sourceOption.textContent = optionLabel(config);
      source.appendChild(sourceOption);

      const targetOption = document.createElement('option');
      targetOption.value = config.id;
      targetOption.textContent = optionLabel(config);
      target.appendChild(targetOption);
    });

    if (previousSource && Array.from(source.options).some((option) => option.value === previousSource)) {
      source.value = previousSource;
    }
    if (previousTarget && Array.from(target.options).some((option) => option.value === previousTarget)) {
      target.value = previousTarget;
    }
  }

  async function refreshOptions() {
    try {
      const data = await window.App.api.request('/api/configs?limit=500&offset=0');
      configs = data.items || [];
      renderConfigOptions();
    } catch (err) {
      window.App.utils.toast(`Không tải được configs cho rclone: ${err.message}`, true);
    }
  }

  function renderSavedCommands() {
    const select = $('rcloneSavedCommandSelect');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">Choose command</option>';
    (window.App.state.savedRcloneCommands || []).forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    });
    if (previous && Array.from(select.options).some((option) => option.value === previous)) {
      select.value = previous;
    }
  }

  async function loadSavedCommands() {
    try {
      const data = await window.App.api.request('/api/rclone/saved-commands');
      window.App.state.savedRcloneCommands = data.items || [];
      renderSavedCommands();
    } catch (err) {
      window.App.utils.toast(`Không tải được saved commands: ${err.message}`, true);
    }
  }

  function buildCommand() {
    const presetKey = $('rclonePreset')?.value || 'lsd';
    const preset = PRESETS[presetKey] || PRESETS.lsd;
    const source = selectedConfig('rcloneSourceConfigSelect');
    const target = selectedConfig('rcloneTargetConfigSelect');
    const sourcePath = $('rcloneSourcePath')?.value || '';
    const targetPath = $('rcloneTargetPath')?.value || '';
    const dryRun = $('rcloneDryRun')?.checked;

    if (!source) {
      window.App.utils.toast('Chọn source config trước.', true);
      return '';
    }
    if (preset.requiresTarget && !target) {
      window.App.utils.toast('Preset này cần target config.', true);
      return '';
    }

    let command;
    if (presetKey === 'lsd') command = `rclone lsd ${remoteRef(source, '')}`;
    if (presetKey === 'lsjson') command = `rclone lsjson ${remoteRef(source, sourcePath)}`;
    if (presetKey === 'size_json') command = `rclone size ${remoteRef(source, sourcePath)} --json`;
    if (presetKey === 'about_json') command = `rclone about ${remoteRef(source, '')} --json`;
    if (presetKey === 'tree') command = `rclone tree ${remoteRef(source, sourcePath)}`;
    if (presetKey === 'check') command = `rclone check ${remoteRef(source, sourcePath)} ${remoteRef(target, targetPath)} --one-way`;
    if (['copy', 'sync', 'move'].includes(presetKey)) {
      command = `rclone ${presetKey} ${remoteRef(source, sourcePath)} ${remoteRef(target, targetPath)} -P`;
      if (dryRun) command += ' --dry-run';
    }

    if (command) command += oneDrivePersonalVaultFilter(source);
    $('rcloneCommandInput').value = command || '';
    $('rcloneOutputMode').value = preset.outputMode;
    return command;
  }

  async function postRun(payload) {
    return window.App.api.request('/api/rclone/run', {
      method: 'POST',
      body: JSON.stringify(payload),
      allowStatuses: [422],
    });
  }

  function renderResult(result, elapsedMs) {
    const stdout = $('rcloneStdout');
    const stderr = $('rcloneStderr');
    const meta = $('rcloneResultMeta');
    if (!stdout || !stderr || !meta) return;

    const output = result.json
      ? JSON.stringify(result.json, null, 2)
      : (result.stdout || '');
    const parseMessage = result.jsonParseError ? `\nJSON parse error: ${result.jsonParseError}` : '';
    const truncatedMessage = result.truncated ? '\nOutput truncated at 2 MB.' : '';

    stdout.textContent = output || '(empty)';
    stderr.textContent = `${result.stderr || ''}${parseMessage}${truncatedMessage}`.trim() || '(empty)';
    meta.textContent = `exit ${result.exitCode ?? '-'} · ${elapsedMs}ms${result.timedOut ? ' · timed out' : ''}`;
  }

  async function runCommand() {
    const command = $('rcloneCommandInput')?.value.trim();
    if (!command) {
      window.App.utils.toast('Nhập hoặc build command trước.', true);
      return;
    }
    const timeoutSeconds = Math.min(Math.max(Number($('rcloneTimeoutSeconds')?.value || 900), 1), 900);

    const runButtons = [$('rcloneRunBtn'), $('rcloneRunInlineBtn')].filter(Boolean);
    const start = Date.now();
    runButtons.forEach((button) => {
      button.disabled = true;
    });
    $('rcloneRunStatus').textContent = 'Running...';

    try {
      const result = await postRun({
        command,
        configIds: selectedConfigIds(),
        outputMode: $('rcloneOutputMode')?.value || 'raw',
        timeoutMs: timeoutSeconds * 1000,
      });
      renderResult(result, Date.now() - start);
      $('rcloneRunStatus').textContent = result.exitCode === 0 && !result.timedOut ? 'Done' : 'Finished with error';
      if (result.exitCode !== 0 || result.timedOut) {
        window.App.utils.toast('Rclone command trả về lỗi. Xem stderr.', true);
      }
    } catch (err) {
      $('rcloneRunStatus').textContent = 'Failed';
      window.App.utils.toast(`Không chạy được rclone: ${err.message}`, true);
    } finally {
      runButtons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  async function saveCommand() {
    const command = $('rcloneCommandInput')?.value.trim();
    const name = $('rcloneSaveName')?.value.trim();
    if (!name || !command) {
      window.App.utils.toast('Nhập name và command trước khi lưu.', true);
      return;
    }
    try {
      await window.App.api.request('/api/rclone/saved-commands', {
        method: 'POST',
        body: JSON.stringify({
          name,
          command,
          outputMode: $('rcloneOutputMode')?.value || 'raw',
        }),
      });
      await loadSavedCommands();
      window.App.utils.toast('Đã lưu command.');
    } catch (err) {
      window.App.utils.toast(`Không lưu được command: ${err.message}`, true);
    }
  }

  function selectedSavedCommand() {
    const id = $('rcloneSavedCommandSelect')?.value;
    return (window.App.state.savedRcloneCommands || []).find((item) => item.id === id) || null;
  }

  function loadSelectedSavedCommand() {
    const item = selectedSavedCommand();
    if (!item) {
      window.App.utils.toast('Chọn saved command trước.', true);
      return;
    }
    $('rcloneSaveName').value = item.name || '';
    $('rcloneCommandInput').value = item.command || '';
    $('rcloneOutputMode').value = item.outputMode || 'raw';
  }

  async function deleteSelectedSavedCommand() {
    const item = selectedSavedCommand();
    if (!item) {
      window.App.utils.toast('Chọn saved command trước.', true);
      return;
    }
    if (!confirm(`Xóa command "${item.name}"?`)) return;
    try {
      await window.App.api.request(`/api/rclone/saved-commands/${item.id}`, { method: 'DELETE' });
      await loadSavedCommands();
      window.App.utils.toast('Đã xóa command.');
    } catch (err) {
      window.App.utils.toast(`Không xóa được command: ${err.message}`, true);
    }
  }

  function updatePresetState() {
    const preset = PRESETS[$('rclonePreset')?.value] || PRESETS.lsd;
    $('rcloneDryRun').disabled = !preset.supportsDryRun;
    if (preset.outputMode) $('rcloneOutputMode').value = preset.outputMode;
  }

  function bindEvents() {
    $('rcloneBuildBtn')?.addEventListener('click', buildCommand);
    $('rcloneCopyCommandBtn')?.addEventListener('click', () => window.App.utils.copyText($('rcloneCommandInput')?.value || '', 'Đã copy command.'));
    $('rcloneRunBtn')?.addEventListener('click', runCommand);
    $('rcloneRunInlineBtn')?.addEventListener('click', runCommand);
    $('rcloneReloadBtn')?.addEventListener('click', async () => {
      await refreshOptions();
      await loadSavedCommands();
    });
    $('rcloneSaveCommandBtn')?.addEventListener('click', saveCommand);
    $('rcloneLoadSavedBtn')?.addEventListener('click', loadSelectedSavedCommand);
    $('rcloneDeleteSavedBtn')?.addEventListener('click', deleteSelectedSavedCommand);
    $('rcloneSavedCommandSelect')?.addEventListener('change', loadSelectedSavedCommand);
    $('rclonePreset')?.addEventListener('change', updatePresetState);
  }

  function init() {
    bindEvents();
    updatePresetState();
  }

  window.App = window.App || {};
  window.App.RcloneCommands = {
    init,
    refreshOptions,
    loadSavedCommands,
  };
})();
