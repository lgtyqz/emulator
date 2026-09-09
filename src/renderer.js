(function createRomRoom() {
  'use strict';

  const { systems, getSystem, titleFromFile } = window.RomRoomSystems;
  const bridge = window.romRoom;
  const NETPLAY_DISCLOSURE_KEY = 'rom-room.netplay-cloudflare-disclosure.v1';

  const elements = {
    libraryList: document.querySelector('#libraryList'),
    libraryEmpty: document.querySelector('#libraryEmpty'),
    libraryCount: document.querySelector('#libraryCount'),
    systemSelect: document.querySelector('#systemSelect'),
    openButton: document.querySelector('#openButton'),
    emptyOpenButton: document.querySelector('#emptyOpenButton'),
    biosButton: document.querySelector('#biosButton'),
    netplayButton: document.querySelector('#netplayButton'),
    dropTarget: document.querySelector('#dropTarget'),
    dropOverlay: document.querySelector('#dropOverlay'),
    screenShell: document.querySelector('#screenShell'),
    idleState: document.querySelector('#idleState'),
    loadingState: document.querySelector('#loadingState'),
    loadingTitle: document.querySelector('#loadingTitle'),
    loadingMessage: document.querySelector('#loadingMessage'),
    errorState: document.querySelector('#errorState'),
    errorTitle: document.querySelector('#errorTitle'),
    errorMessage: document.querySelector('#errorMessage'),
    retryButton: document.querySelector('#retryButton'),
    dismissErrorButton: document.querySelector('#dismissErrorButton'),
    playerFrame: document.querySelector('#playerFrame'),
    nowPlaying: document.querySelector('#nowPlaying'),
    nowPlayingTitle: document.querySelector('#nowPlayingTitle'),
    nowPlayingSystem: document.querySelector('#nowPlayingSystem'),
    stopButton: document.querySelector('#stopButton'),
    consoleDialog: document.querySelector('#consoleDialog'),
    consoleDialogFile: document.querySelector('#consoleDialogFile'),
    dialogSystemSelect: document.querySelector('#dialogSystemSelect'),
    netplayDialog: document.querySelector('#netplayDialog'),
    netplayCloseButton: document.querySelector('#netplayCloseButton'),
    netplayHostTab: document.querySelector('#netplayHostTab'),
    netplayJoinTab: document.querySelector('#netplayJoinTab'),
    netplayHostPanel: document.querySelector('#netplayHostPanel'),
    netplayJoinPanel: document.querySelector('#netplayJoinPanel'),
    netplayHostGame: document.querySelector('#netplayHostGame'),
    netplayCloudflareConsentWrap: document.querySelector('#netplayCloudflareConsentWrap'),
    netplayCloudflareConsent: document.querySelector('#netplayCloudflareConsent'),
    netplayStartHostButton: document.querySelector('#netplayStartHostButton'),
    netplayHostSession: document.querySelector('#netplayHostSession'),
    netplayStatusDot: document.querySelector('#netplayStatusDot'),
    netplayStatusText: document.querySelector('#netplayStatusText'),
    netplayNextStep: document.querySelector('#netplayNextStep'),
    netplayEndpoints: document.querySelector('#netplayEndpoints'),
    netplayRetryButton: document.querySelector('#netplayRetryButton'),
    netplayStopButton: document.querySelector('#netplayStopButton'),
    netplayInviteInput: document.querySelector('#netplayInviteInput'),
    netplayCheckInviteButton: document.querySelector('#netplayCheckInviteButton'),
    netplayInvitePreview: document.querySelector('#netplayInvitePreview'),
    netplayInviteConnection: document.querySelector('#netplayInviteConnection'),
    netplayInviteGame: document.querySelector('#netplayInviteGame'),
    netplayInviteMatch: document.querySelector('#netplayInviteMatch'),
    netplayChooseRomButton: document.querySelector('#netplayChooseRomButton'),
    netplayJoinButton: document.querySelector('#netplayJoinButton'),
    netplayDialogError: document.querySelector('#netplayDialogError'),
    toast: document.querySelector('#toast')
  };

  const state = {
    games: [],
    activeGame: null,
    activeSystem: null,
    bios: null,
    launchToken: 0,
    launchTimer: null,
    dragDepth: 0,
    busy: false,
    toastTimer: null,
    playerIsNetplay: false,
    netplay: null,
    invite: null,
    inviteGame: null
  };

  function groupSystems(select, includeAuto = false) {
    if (!includeAuto) select.replaceChildren();
    const families = [...new Set(systems.map((system) => system.family))];
    for (const family of families) {
      const group = document.createElement('optgroup');
      group.label = family;
      for (const system of systems.filter((entry) => entry.family === family)) {
        const option = document.createElement('option');
        option.value = system.id;
        option.textContent = system.label;
        group.append(option);
      }
      select.append(group);
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  }

  function titleFor(game) {
    return titleFromFile(game?.name || '');
  }

  function systemFor(game) {
    return getSystem(game?.system)?.short || 'Choose console';
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    state.toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 3200);
  }

  function showView(view) {
    elements.idleState.hidden = view !== 'idle';
    elements.loadingState.hidden = view !== 'loading';
    elements.errorState.hidden = view !== 'error';
    elements.playerFrame.hidden = view !== 'player';
    elements.screenShell.classList.remove('is-idle', 'is-loading', 'is-playing', 'is-error');
    elements.screenShell.classList.add(`is-${view === 'player' ? 'playing' : view}`);
  }

  function updateBiosButton() {
    const label = elements.biosButton.querySelector('span');
    elements.biosButton.classList.toggle('has-bios', Boolean(state.bios));
    label.textContent = state.bios ? state.bios.name : 'BIOS';
    elements.biosButton.title = state.bios
      ? `${state.bios.name} selected — choose a different BIOS`
      : 'Choose optional console firmware';
  }

  function renderLibrary() {
    elements.libraryList.replaceChildren();
    elements.libraryCount.textContent = String(state.games.length);
    elements.libraryEmpty.hidden = state.games.length > 0;

    for (const game of state.games) {
      const item = document.createElement('li');
      item.className = 'library-item';
      item.dataset.id = game.id;
      if (state.activeGame?.id === game.id) item.classList.add('is-active');

      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'library-game';
      playButton.title = `Play ${titleFor(game)}`;

      const art = document.createElement('span');
      art.className = 'library-art';
      art.dataset.system = game.system || 'unknown';
      art.textContent = getSystem(game.system)?.short.slice(0, 3).toUpperCase() || '?';

      const copy = document.createElement('span');
      copy.className = 'library-copy';
      const title = document.createElement('strong');
      title.textContent = titleFor(game);
      const meta = document.createElement('small');
      meta.textContent = `${systemFor(game)} · ${formatBytes(game.size)}`;
      copy.append(title, meta);

      const chevron = document.createElement('span');
      chevron.className = 'library-chevron';
      chevron.textContent = '›';
      chevron.setAttribute('aria-hidden', 'true');
      playButton.append(art, copy, chevron);
      playButton.addEventListener('click', () => requestLaunch(game));

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'library-remove';
      removeButton.textContent = '×';
      removeButton.title = 'Remove from recents';
      removeButton.setAttribute('aria-label', `Remove ${titleFor(game)} from recents`);
      removeButton.addEventListener('click', () => removeGame(game));

      item.append(playButton, removeButton);
      elements.libraryList.append(item);
    }
  }

  async function chooseConsole(game) {
    elements.consoleDialog.returnValue = '';
    elements.consoleDialogFile.textContent = `${game.name} uses a file type shared by several systems.`;
    elements.dialogSystemSelect.value = state.activeSystem || 'psx';
    elements.consoleDialog.showModal();

    return new Promise((resolve) => {
      elements.consoleDialog.addEventListener('close', () => {
        resolve(elements.consoleDialog.returnValue === 'launch' ? elements.dialogSystemSelect.value : null);
      }, { once: true });
    });
  }

  async function endNetplay() {
    if (!state.netplay) return;
    try {
      await bridge.stopNetplay();
    } finally {
      state.netplay = null;
      state.playerIsNetplay = false;
      renderNetplaySession();
    }
  }

  async function confirmNetplayDisruption(action) {
    if (!state.netplay) return true;
    const role = state.netplay.role === 'host' ? 'hosted session and invitation' : 'NetPlay session';
    if (!window.confirm(`${action} will end the active ${role}. Continue?`)) return false;
    await endNetplay();
    return true;
  }

  async function requestLaunch(game, forcedSystem = null) {
    if (!await confirmNetplayDisruption('Launching another game')) return;
    let system = forcedSystem || game.system;
    if (!system) system = await chooseConsole(game);
    if (!system) return;
    await launchGame(game, system);
  }

  function playerUrl(launchData) {
    const url = new URL('rom-room://player/player.html');
    url.searchParams.set('session', launchData.playerSessionId);
    return url.toString();
  }

  async function launchGame(game, system, netplaySessionId = null) {
    const token = ++state.launchToken;
    window.clearTimeout(state.launchTimer);
    state.activeGame = { ...game, system };
    state.activeSystem = system;
    elements.systemSelect.value = system;
    elements.loadingTitle.textContent = titleFor(game);
    elements.loadingMessage.textContent = netplaySessionId
      ? `Starting experimental NetPlay · ${getSystem(system)?.label || system}`
      : `Starting ${getSystem(system)?.label || system}`;
    elements.nowPlaying.hidden = false;
    elements.nowPlayingTitle.textContent = titleFor(game);
    elements.nowPlayingSystem.textContent = getSystem(system)?.short || system;
    renderLibrary();
    showView('loading');

    try {
      const launchData = await bridge.launchGame(game.id, system, state.bios?.id || null, netplaySessionId);
      if (token !== state.launchToken) return;

      state.activeGame = launchData;
      state.activeSystem = launchData.system;
      state.playerIsNetplay = launchData.netplay;
      state.games = [
        launchData,
        ...state.games.filter((entry) => entry.id !== launchData.id)
      ];
      renderLibrary();
      elements.playerFrame.src = playerUrl(launchData);

      state.launchTimer = window.setTimeout(async () => {
        if (token === state.launchToken && !elements.loadingState.hidden) {
          showError(
            'The emulator is taking too long to respond.',
            'Check your internet connection, then try again. First-time core downloads can take a moment.'
          );
          if (netplaySessionId && state.netplay?.id === netplaySessionId) {
            await endNetplay().catch(() => {});
          }
        }
      }, 30000);
    } catch (error) {
      if (netplaySessionId && state.netplay?.id === netplaySessionId) {
        await endNetplay().catch(() => {});
      }
      if (token === state.launchToken) showError('This game could not be opened.', error.message);
    }
  }

  function showError(title, message) {
    window.clearTimeout(state.launchTimer);
    elements.errorTitle.textContent = title;
    elements.errorMessage.textContent = message || 'Check the selected console and try again.';
    showView('error');
  }

  async function stopGame(confirmDisruption = true) {
    if (confirmDisruption && !await confirmNetplayDisruption('Closing the game')) return;
    state.launchToken += 1;
    window.clearTimeout(state.launchTimer);
    if (state.netplay) await endNetplay().catch((error) => showToast(error.message || 'Could not close NetPlay cleanly.'));
    elements.playerFrame.src = 'about:blank';
    elements.playerFrame.hidden = true;
    state.activeGame = null;
    state.activeSystem = null;
    state.playerIsNetplay = false;
    elements.systemSelect.value = '';
    elements.nowPlaying.hidden = true;
    showView('idle');
    renderLibrary();
  }

  async function handleImported(game) {
    state.games = [game, ...state.games.filter((entry) => entry.id !== game.id)];
    renderLibrary();

    let system = elements.systemSelect.value || game.system;
    if (!system) system = await chooseConsole(game);
    if (!system) {
      showToast('Added to your library. Choose a console when you’re ready.');
      return;
    }
    await launchGame(game, system);
  }

  async function openRomPicker() {
    if (state.busy) return;
    if (!await confirmNetplayDisruption('Opening a ROM')) return;
    state.busy = true;
    elements.openButton.disabled = true;
    elements.emptyOpenButton.disabled = true;
    try {
      const game = await bridge.pickFile('rom');
      if (game) await handleImported(game);
    } catch (error) {
      showToast(error.message || 'Could not open that file.');
    } finally {
      state.busy = false;
      elements.openButton.disabled = false;
      elements.emptyOpenButton.disabled = false;
    }
  }

  async function chooseBios() {
    if (state.netplay) {
      showToast('Leave NetPlay before changing the local BIOS.');
      return;
    }
    try {
      const bios = await bridge.pickFile('bios');
      if (!bios) return;
      state.bios = bios;
      updateBiosButton();
      showToast(`${bios.name} selected${state.activeGame ? ' — restarting the game' : ''}.`);
      if (state.activeGame) await launchGame(state.activeGame, state.activeSystem);
    } catch (error) {
      showToast(error.message || 'Could not open that BIOS file.');
    }
  }

  async function removeGame(game) {
    try {
      if (state.activeGame?.id === game.id) {
        if (!await confirmNetplayDisruption('Removing the active game')) return;
        await stopGame();
      }
      state.games = await bridge.removeGame(game.id);
      renderLibrary();
      showToast('Removed from recents. The ROM file was not deleted.');
    } catch (error) {
      showToast(error.message || 'Could not update the library.');
    }
  }

  async function handleDrop(event) {
    event.preventDefault();
    state.dragDepth = 0;
    elements.dropOverlay.hidden = true;
    elements.screenShell.classList.remove('is-dragging');

    const file = [...event.dataTransfer.files][0];
    if (!file) return;
    try {
      if (!await confirmNetplayDisruption('Opening a ROM')) return;
      const game = await bridge.importDroppedFile(file, 'rom');
      await handleImported(game);
    } catch (error) {
      showToast(error.message || 'Could not import that file.');
    }
  }

  function bindDragAndDrop() {
    document.addEventListener('dragenter', (event) => {
      event.preventDefault();
      state.dragDepth += 1;
      elements.dropOverlay.hidden = false;
      elements.screenShell.classList.add('is-dragging');
    });
    document.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('dragleave', (event) => {
      event.preventDefault();
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) {
        elements.dropOverlay.hidden = true;
        elements.screenShell.classList.remove('is-dragging');
      }
    });
    document.addEventListener('drop', handleDrop);
  }

  function setNetplayTab(tab) {
    const host = tab === 'host';
    elements.netplayHostTab.classList.toggle('is-active', host);
    elements.netplayJoinTab.classList.toggle('is-active', !host);
    elements.netplayHostTab.setAttribute('aria-selected', String(host));
    elements.netplayJoinTab.setAttribute('aria-selected', String(!host));
    elements.netplayHostPanel.hidden = !host;
    elements.netplayJoinPanel.hidden = host;
  }

  function selectedReach() {
    return document.querySelector('input[name="netplayReach"]:checked')?.value || 'lan';
  }

  function updateReachDisclosure() {
    const internet = selectedReach() === 'internet';
    elements.netplayCloudflareConsentWrap.hidden = !internet;
    if (internet && window.localStorage.getItem(NETPLAY_DISCLOSURE_KEY) === 'accepted') {
      elements.netplayCloudflareConsent.checked = true;
    }
  }

  function setNetplayDialogError(message = '') {
    elements.netplayDialogError.textContent = message;
    elements.netplayDialogError.hidden = !message;
  }

  function statusIsBusy(status) {
    return ['hashing', 'server-starting', 'tunnel-starting', 'stopping'].includes(status?.state);
  }

  function renderNetplayStatus(status = state.netplay?.status) {
    const text = status?.detail || (state.netplay ? 'NetPlay is ready.' : 'No active NetPlay session.');
    elements.netplayStatusText.textContent = text;
    elements.netplayStatusDot.classList.toggle('is-busy', statusIsBusy(status));
    elements.netplayStatusDot.classList.toggle('is-error', Boolean(status?.state?.includes('error') || status?.state?.includes('disconnected')));
  }

  function copyButton(label, value) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    button.textContent = label;
    button.addEventListener('click', async () => {
      try {
        await bridge.copyText(value);
        showToast(`${label.replace('Copy ', '')} copied.`);
      } catch (error) {
        showToast(error.message || 'Could not copy the invitation.');
      }
    });
    return button;
  }

  function renderNetplayEndpoints(endpoints = state.netplay?.endpoints || []) {
    elements.netplayEndpoints.replaceChildren();
    for (const endpoint of endpoints) {
      const item = document.createElement('div');
      item.className = 'netplay-endpoint';
      const copy = document.createElement('div');
      const label = document.createElement('strong');
      label.textContent = endpoint.label;
      const hint = document.createElement('small');
      hint.textContent = endpoint.connection === 'internet'
        ? 'Temporary public signaling address'
        : 'Works for devices on this local network';
      copy.append(label, hint);
      const actions = document.createElement('div');
      actions.append(copyButton('Copy Link', endpoint.link), copyButton('Copy Code', endpoint.code));
      item.append(copy, actions);
      elements.netplayEndpoints.append(item);
    }
    if (!endpoints.length && state.netplay?.role === 'host') {
      const empty = document.createElement('p');
      empty.className = 'netplay-endpoint-empty';
      empty.textContent = 'No reachable invitation is available. Check your network, then stop sharing and retry.';
      elements.netplayEndpoints.append(empty);
    }
  }

  function renderNetplaySession() {
    const active = Boolean(state.netplay);
    const hosting = state.netplay?.role === 'host';
    elements.netplayHostSession.hidden = !active;
    elements.netplayStartHostButton.hidden = active;
    elements.netplayButton.classList.toggle('has-session', active);
    if (active) {
      renderNetplayStatus();
      renderNetplayEndpoints();
      const internetUnavailable = hosting && state.netplay.reach === 'internet'
        && !state.netplay.endpoints.some((endpoint) => endpoint.connection === 'internet');
      elements.netplayRetryButton.hidden = !internetUnavailable;
      elements.netplayStopButton.textContent = hosting ? 'Stop sharing' : 'Leave NetPlay';
      elements.netplayNextStep.textContent = hosting
        ? 'In the player, open the globe menu and create a password-protected room. Then send one invitation below. Invitations never contain the ROM or BIOS.'
        : 'In the player, open the globe menu, set your name, and choose the host’s room. Your ROM and BIOS remain on this device.';
    }
  }

  async function retryInternetHosting() {
    if (state.busy || state.netplay?.role !== 'host') return;
    if (!window.confirm('Retrying will replace the current invitation and restart the game. Continue?')) return;
    try {
      await endNetplay();
      const internetOption = document.querySelector('input[name="netplayReach"][value="internet"]');
      internetOption.checked = true;
      updateReachDisclosure();
      await startHosting();
    } catch (error) {
      setNetplayDialogError(error.message || 'Could not retry internet hosting.');
    }
  }

  function openNetplayDialog(tab = 'host', inviteCode = '') {
    setNetplayDialogError();
    elements.netplayHostGame.textContent = state.activeGame
      ? `${titleFor(state.activeGame)} · ${getSystem(state.activeSystem)?.short || state.activeSystem}`
      : 'Launch a game first';
    elements.netplayStartHostButton.disabled = !state.activeGame || Boolean(state.netplay);
    renderNetplaySession();
    setNetplayTab(tab);
    if (!elements.netplayDialog.open) elements.netplayDialog.showModal();
    if (inviteCode) {
      elements.netplayInviteInput.value = inviteCode;
      resolveInvite();
    }
  }

  async function startHosting() {
    if (!state.activeGame || state.busy) return;
    const reach = selectedReach();
    if (reach === 'internet' && !elements.netplayCloudflareConsent.checked) {
      setNetplayDialogError('Review and accept the Cloudflare and public relay disclosure before internet hosting.');
      return;
    }
    if (reach === 'internet') window.localStorage.setItem(NETPLAY_DISCLOSURE_KEY, 'accepted');

    state.busy = true;
    setNetplayDialogError();
    elements.netplayStartHostButton.disabled = true;
    elements.netplayHostSession.hidden = false;
    renderNetplayStatus({ state: 'hashing', detail: 'Hashing the ROM without loading it all into memory…' });
    try {
      const session = await bridge.hostNetplay(state.activeGame.id, reach);
      state.netplay = session;
      renderNetplaySession();
      await launchGame(state.activeGame, session.core, session.id);
      if (reach === 'internet' && !session.endpoints.some((endpoint) => endpoint.connection === 'internet')) {
        showToast('The internet tunnel failed. LAN hosting is still available.');
      }
    } catch (error) {
      state.netplay = await bridge.getNetplayState().catch(() => null);
      setNetplayDialogError(error.message || 'Could not start NetPlay.');
      renderNetplaySession();
    } finally {
      state.busy = false;
      elements.netplayStartHostButton.disabled = !state.activeGame || Boolean(state.netplay);
    }
  }

  async function stopSharing() {
    if (!state.netplay || state.busy) return;
    const activeGame = state.activeGame;
    const activeSystem = state.activeSystem;
    state.busy = true;
    elements.netplayStopButton.disabled = true;
    try {
      await endNetplay();
      if (activeGame && activeSystem) await launchGame(activeGame, activeSystem);
      showToast('NetPlay closed. The game restarted in solo mode.');
    } catch (error) {
      setNetplayDialogError(error.message || 'Could not stop NetPlay cleanly.');
    } finally {
      state.busy = false;
      elements.netplayStopButton.disabled = false;
      elements.netplayStartHostButton.hidden = false;
      elements.netplayStartHostButton.disabled = !state.activeGame;
    }
  }

  function renderInvitePreview() {
    const invite = state.invite;
    elements.netplayInvitePreview.hidden = !invite;
    if (!invite) return;
    elements.netplayInviteConnection.textContent = invite.connection === 'internet' ? 'Internet' : 'Same network';
    elements.netplayInviteGame.textContent = titleFromFile(invite.gameName);
    elements.netplayInviteMatch.textContent = state.inviteGame
      ? `Matched ${state.inviteGame.name}. The full ROM hash will be checked before launch.`
      : `Choose your own copy of ${invite.gameName}. ROMs are never transferred.`;
    elements.netplayJoinButton.disabled = !state.inviteGame;
  }

  async function resolveInvite() {
    if (state.busy) return;
    state.busy = true;
    setNetplayDialogError();
    elements.netplayCheckInviteButton.disabled = true;
    try {
      state.invite = await bridge.resolveNetplayInvite(elements.netplayInviteInput.value);
      state.inviteGame = state.invite.matchedGame;
      renderInvitePreview();
    } catch (error) {
      state.invite = null;
      state.inviteGame = null;
      renderInvitePreview();
      setNetplayDialogError(error.message || 'That invitation could not be read.');
    } finally {
      state.busy = false;
      elements.netplayCheckInviteButton.disabled = false;
    }
  }

  async function chooseInviteRom() {
    if (!state.invite || state.busy) return;
    state.busy = true;
    elements.netplayChooseRomButton.disabled = true;
    try {
      const game = await bridge.pickFile('rom');
      if (!game) return;
      state.games = [game, ...state.games.filter((entry) => entry.id !== game.id)];
      state.inviteGame = game;
      renderLibrary();
      renderInvitePreview();
    } catch (error) {
      setNetplayDialogError(error.message || 'Could not open that ROM.');
    } finally {
      state.busy = false;
      elements.netplayChooseRomButton.disabled = false;
    }
  }

  async function joinNetplay() {
    if (!state.invite || !state.inviteGame || state.busy) return;
    if (!await confirmNetplayDisruption('Joining this invitation')) return;
    state.busy = true;
    setNetplayDialogError();
    elements.netplayJoinButton.disabled = true;
    elements.netplayInviteMatch.textContent = 'Hashing and verifying your local ROM…';
    try {
      const session = await bridge.joinNetplay(state.invite.inviteId, state.inviteGame.id);
      state.netplay = session;
      await launchGame(state.inviteGame, session.core, session.id);
      elements.netplayDialog.close();
      showToast('NetPlay ready. Open the globe menu in the player to choose the host’s room.');
    } catch (error) {
      setNetplayDialogError(error.message || 'Could not join that NetPlay session.');
      renderInvitePreview();
    } finally {
      state.busy = false;
      elements.netplayJoinButton.disabled = !state.inviteGame;
    }
  }

  async function handleNetplayStatus(status) {
    if (state.netplay) state.netplay.status = status;
    renderNetplayStatus(status);
    if (status?.state === 'tunnel-disconnected' || status?.state === 'tunnel-error') {
      state.netplay = await bridge.getNetplayState().catch(() => state.netplay);
      renderNetplaySession();
    }
  }

  function bindNetplayEvents() {
    elements.netplayButton.addEventListener('click', () => openNetplayDialog('host'));
    elements.netplayCloseButton.addEventListener('click', () => elements.netplayDialog.close());
    elements.netplayHostTab.addEventListener('click', () => setNetplayTab('host'));
    elements.netplayJoinTab.addEventListener('click', () => setNetplayTab('join'));
    for (const input of document.querySelectorAll('input[name="netplayReach"]')) {
      input.addEventListener('change', updateReachDisclosure);
    }
    elements.netplayStartHostButton.addEventListener('click', startHosting);
    elements.netplayRetryButton.addEventListener('click', retryInternetHosting);
    elements.netplayStopButton.addEventListener('click', stopSharing);
    elements.netplayCheckInviteButton.addEventListener('click', resolveInvite);
    elements.netplayChooseRomButton.addEventListener('click', chooseInviteRom);
    elements.netplayJoinButton.addEventListener('click', joinNetplay);
    bridge.onNetplayInvite((code) => openNetplayDialog('join', code));
    bridge.onNetplayStatus(handleNetplayStatus);
  }

  function bindEvents() {
    elements.openButton.addEventListener('click', openRomPicker);
    elements.emptyOpenButton.addEventListener('click', openRomPicker);
    elements.biosButton.addEventListener('click', chooseBios);
    elements.stopButton.addEventListener('click', () => stopGame());
    elements.dismissErrorButton.addEventListener('click', () => stopGame());
    elements.retryButton.addEventListener('click', () => {
      if (state.activeGame && state.activeSystem) {
        const netplaySessionId = state.netplay?.id && state.playerIsNetplay ? state.netplay.id : null;
        launchGame(state.activeGame, state.activeSystem, netplaySessionId);
      }
    });

    elements.systemSelect.addEventListener('change', async () => {
      if (!state.activeGame) return;
      if (state.netplay) {
        elements.systemSelect.value = state.activeSystem;
        showToast('Leave NetPlay before changing the emulator core.');
        return;
      }
      const selected = elements.systemSelect.value;
      if (selected) {
        showToast(`Switching to ${getSystem(selected)?.label || selected}…`);
        await launchGame(state.activeGame, selected);
        return;
      }

      if (state.activeGame.system) {
        elements.systemSelect.value = state.activeSystem;
        showToast('Auto-detect is available when importing a new ROM.');
      }
    });

    window.addEventListener('message', (event) => {
      if (event.source !== elements.playerFrame.contentWindow) return;
      if (event.origin !== 'rom-room://player') return;
      if (event.data?.source !== 'rom-room-player') return;

      if (event.data.type === 'ready' || event.data.type === 'started') {
        window.clearTimeout(state.launchTimer);
        showView('player');
      } else if (event.data.type === 'error') {
        showError('EmulatorJS could not start this game.', event.data.detail);
        if (state.netplay) endNetplay().catch(() => {});
      } else if (event.data.type === 'exit') {
        stopGame(false);
      }
    });

    bridge.onOpenRom(openRomPicker);
    bindNetplayEvents();
    bindDragAndDrop();
  }

  async function initialize() {
    groupSystems(elements.systemSelect, true);
    groupSystems(elements.dialogSystemSelect);
    bindEvents();
    updateBiosButton();
    updateReachDisclosure();
    showView('idle');

    try {
      [state.games, state.netplay] = await Promise.all([
        bridge.listGames(),
        bridge.getNetplayState()
      ]);
      renderLibrary();
      renderNetplaySession();
    } catch (error) {
      showToast(error.message || 'Could not load your recent games.');
    }
  }

  initialize();
})();
