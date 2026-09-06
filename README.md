# ROM Room

ROM Room is a small desktop launcher that wraps [EmulatorJS](https://emulatorjs.org/). Drop in a ROM, let the app detect its console, and switch games or emulator cores without restarting Electron.

## Run it

```bash
npm install
npm start
```

The EmulatorJS runtime is loaded from its stable CDN the first time a core is used, so an internet connection is required for first launch. Runtime assets are then cached by Chromium. Your ROM files stay on your computer and are streamed through a private app protocol; ROM paths are never exposed to the web page.

## What is included

- Native file picker and drag-and-drop importing
- Automatic console detection for common ROM extensions
- Nintendo 3DS support through EmulatorJS's Azahar core (threaded WebAssembly)
- Manual console override, including ambiguous disc formats
- Persistent recent-game library
- Optional per-launch BIOS selection
- Isolated EmulatorJS player that can be replaced without reloading the app
- Packaging commands for macOS, Windows, and Linux

## Commands

```bash
npm start       # launch the app
npm test        # run console-detection tests
npm run pack    # create an unpacked application
npm run dist    # create a platform installer
```

## ROMs and BIOS files

No games or BIOS files are included. Only use game and firmware files you are legally permitted to use. BIOS requirements vary by console and core.

Nintendo 3DS games must be decrypted dumps supported by Azahar. ROM Room recognizes `.3ds`, `.cci`, `.cia`, `.cxi`, and `.app` files; `.3dsx` homebrew executables are not supported by the current EmulatorJS core.

## EmulatorJS version

The player uses `https://cdn.emulatorjs.org/stable/data/`. To make the app fully offline, download an official EmulatorJS release and change `EJS_DATA_PATH` in `src/player.js` to the packaged data directory.
