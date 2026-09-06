(function createRomRoom() {
  'use strict';

  const { systems, getSystem, titleFromFile } = window.RomRoomSystems;
  const bridge = window.romRoom;

  const elements = {
    libraryList: document.querySelector('#libraryList'),
    libraryEmpty: document.querySelector('#libraryEmpty'),
    libraryCount: document.querySelector('#libraryCount'),
    systemSelect: document.querySelector('#systemSelect'),
    openButton: document.querySelector('#openButton'),
    emptyOpenButton: document.querySelector('#emptyOpenButton'),
    biosButton: document.querySelector('#biosButton'),
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
    toastTimer: null
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

  async function requestLaunch(game, forcedSystem = null) {
    let system = forcedSystem || game.system;
    if (!system) system = await chooseConsole(game);
    if (!system) return;
    await launchGame(game, system);
  }

  function playerUrl(launchData) {
    const url = new URL('rom-room://player/player.html');
    url.searchParams.set('core', launchData.system);
    url.searchParams.set('rom', launchData.romUrl);
    url.searchParams.set('name', titleFor(launchData));
    url.searchParams.set('gameId', String(launchData.gameId));
    if (launchData.biosUrl) url.searchParams.set('bios', launchData.biosUrl);
    return url.toString();
  }

  async function launchGame(game, system) {
    const token = ++state.launchToken;
    window.clearTimeout(state.launchTimer);
    state.activeGame = { ...game, system };
    state.activeSystem = system;
    elements.systemSelect.value = system;
    elements.loadingTitle.textContent = titleFor(game);
    elements.loadingMessage.textContent = `Starting ${getSystem(system)?.label || system}`;
    elements.nowPlaying.hidden = false;
    elements.nowPlayingTitle.textContent = titleFor(game);
    elements.nowPlayingSystem.textContent = getSystem(system)?.short || system;
    renderLibrary();
    showView('loading');

    try {
      const launchData = await bridge.launchGame(game.id, system, state.bios?.id || null);
      if (token !== state.launchToken) return;

      state.activeGame = launchData;
      state.games = [
        launchData,
        ...state.games.filter((entry) => entry.id !== launchData.id)
      ];
      renderLibrary();
      elements.playerFrame.src = playerUrl(launchData);

      state.launchTimer = window.setTimeout(() => {
        if (token === state.launchToken && !elements.loadingState.hidden) {
          showError(
            'The emulator is taking too long to respond.',
            'Check your internet connection, then try again. First-time core downloads can take a moment.'
          );
        }
      }, 30000);
    } catch (error) {
      if (token === state.launchToken) showError('This game could not be opened.', error.message);
    }
  }

  function showError(title, message) {
    window.clearTimeout(state.launchTimer);
    elements.errorTitle.textContent = title;
    elements.errorMessage.textContent = message || 'Check the selected console and try again.';
    showView('error');
  }

  function stopGame() {
    state.launchToken += 1;
    window.clearTimeout(state.launchTimer);
    elements.playerFrame.src = 'about:blank';
    elements.playerFrame.hidden = true;
    state.activeGame = null;
    state.activeSystem = null;
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
      if (state.activeGame?.id === game.id) stopGame();
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

  function bindEvents() {
    elements.openButton.addEventListener('click', openRomPicker);
    elements.emptyOpenButton.addEventListener('click', openRomPicker);
    elements.biosButton.addEventListener('click', chooseBios);
    elements.stopButton.addEventListener('click', stopGame);
    elements.dismissErrorButton.addEventListener('click', stopGame);
    elements.retryButton.addEventListener('click', () => {
      if (state.activeGame && state.activeSystem) launchGame(state.activeGame, state.activeSystem);
    });

    elements.systemSelect.addEventListener('change', async () => {
      if (!state.activeGame) return;
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
      } else if (event.data.type === 'exit') {
        stopGame();
      }
    });

    bridge.onOpenRom(openRomPicker);
    bindDragAndDrop();
  }

  async function initialize() {
    groupSystems(elements.systemSelect, true);
    groupSystems(elements.dialogSystemSelect);
    bindEvents();
    updateBiosButton();
    showView('idle');

    try {
      state.games = await bridge.listGames();
      renderLibrary();
    } catch (error) {
      showToast(error.message || 'Could not load your recent games.');
    }
  }

  initialize();
})();
