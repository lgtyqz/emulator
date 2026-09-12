# ROM Room

ROM Room is a small desktop launcher that wraps [EmulatorJS](https://emulatorjs.org/). Drop in a ROM, let the app detect its console, and switch games or emulator cores without restarting Electron.

## Run it

```bash
npm install
npm start
```

Development and packaging require Node.js 22.12 or newer.

The EmulatorJS runtime is loaded from its stable CDN the first time a core is used, so an internet connection is required for first launch. Runtime assets are then cached by Chromium. Your ROM files stay on your computer and are streamed through a private app protocol; ROM paths are never exposed to the web page.

## What is included

- Native file picker and drag-and-drop importing
- Automatic console detection for common ROM extensions
- Nintendo 3DS support through EmulatorJS's Azahar core (threaded WebAssembly)
- Local multiplayer defaults for two gamepads or two players sharing a keyboard
- Experimental LAN and internet NetPlay with app-to-app invitations
- Manual console override, including ambiguous disc formats
- Persistent recent-game library
- Optional per-launch BIOS selection
- Isolated EmulatorJS player that can be replaced without reloading the app
- Packaging commands for macOS, Windows, and Linux

## Commands

```bash
npm start       # launch the app
npm test        # run unit, signaling, tunnel, and console-detection tests
npm run prepare:netplay # fetch and verify cloudflared for this computer
npm run pack    # create an unpacked application
npm run dist    # create a platform installer
```

## ROMs and BIOS files

No games or BIOS files are included. Only use game and firmware files you are legally permitted to use. BIOS requirements vary by console and core.

Nintendo 3DS games must be decrypted dumps supported by Azahar. ROM Room recognizes `.3ds`, `.cci`, `.cia`, `.cxi`, and `.app` files; `.3dsx` homebrew executables are not supported by the current EmulatorJS core.

## Local multiplayer

EmulatorJS assigns compatible connected gamepads to Player 1 and Player 2. The default keyboard layout for Player 1 is the EmulatorJS layout; Player 2 uses `I/J/K/L` for up/left/down/right, `F/G/H/T` for B/Y/A/X, `C/B` for Select/Start, and `Y/U` for L/R. If controls were configured before these defaults were added, open **Controller Settings** in the player and choose **Reset** once.

The original SNES version of Kirby Super Star activates its second player during gameplay rather than at boot. Give Kirby a copy ability, create a helper, and then press any Player 2 action key to take control of the helper.

## Experimental NetPlay

Launch a game, choose **NetPlay**, and host either on the same network or through a temporary Cloudflare Quick Tunnel. Send the generated link or code to another ROM Room user. The guest opens **NetPlay → Join**, pastes the invitation, and chooses their own exact copy of the ROM. ROM and BIOS bytes are never included in an invitation or served by the signaling server.

New invitations automatically create and join a password-protected EmulatorJS room. Treat the invitation as the room credential. The host controls Player 1; guests control subsequent player slots using their usual local controls. EmulatorJS runs the host’s game and streams its video/audio to guests while sending guest inputs back to the host. A guest waits for this connection instead of continuing a separate solo game. The globe menu remains available for chat and room controls. Older invitations still require manually joining through that menu. Required BIOS files remain local and must be selected separately by every participant.

NetPlay uses the pinned EmulatorJS `4.3.0-pre` runtime because the feature is not present in stable 4.2.3. It is experimental. Internet signaling uses Cloudflare under its terms and privacy policy; Quick Tunnels are temporary and have no SLA. WebRTC is encrypted, but traffic can traverse the public TURN relay when a direct peer connection cannot be established. If the tunnel fails, a reachable LAN invitation remains available.

The first development launch downloads only the cloudflared 2026.8.3 artifact for the current platform and verifies its committed SHA-256 checksum. Packaging does the same for the target platform. Supported targets are macOS x64/arm64, Linux x64/arm64, and Windows x64. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license and service notices.

## EmulatorJS versions

Solo play is pinned to `https://cdn.emulatorjs.org/4.2.3/data/`. NetPlay is pinned to `https://cdn.emulatorjs.org/4.3.0-pre/data/`. Both runtimes are loaded only into the isolated player origin.
