(function () {
  'use strict';

  function installHostAudio(emu, netplay) {
    const originalCapture = netplay._captureHostAudio;
    let context;
    let destination;
    let sources = new Set();
    let resuming = false;

    function disconnect() {
      for (const source of sources) {
        try { source.disconnect(destination); } catch {}
      }
      sources.clear();
      if (destination) {
        for (const track of destination.stream.getTracks()) track.stop();
      }
      destination = null;
    }

    function capture() {
      const al = (emu.Module || emu.gameManager?.Module)?.AL?.currentCtx;
      // Prefer the final mixer when available; tapping it and its inputs would
      // double the volume. OpenAL cores expose per-source gain nodes instead.
      const mixer = emu.gameManager?.audioNode || al?.gain;
      const nodes = typeof mixer?.connect === 'function' ? [mixer]
        : Object.values(al?.sources || {}).map((source) => source?.gain).filter((node) => typeof node?.connect === 'function');
      const nextContext = nodes[0]?.context || al?.audioCtx || emu.gameManager?.audioContext;
      if (!nextContext || nextContext.state === 'closed') return null;
      if (context !== nextContext || !destination) {
        disconnect();
        context = nextContext;
        destination = context.createMediaStreamDestination();
      }
      if (context.state === 'suspended' && !resuming) {
        resuming = true;
        context.resume().catch(() => {}).finally(() => { resuming = false; });
      }
      const current = new Set(nodes.filter((node) => node.context === context));
      for (const source of sources) {
        if (!current.has(source)) {
          try { source.disconnect(destination); } catch {}
          sources.delete(source);
        }
      }
      for (const source of current) {
        if (!sources.has(source)) {
          source.connect(destination);
          sources.add(source);
        }
      }
      return destination.stream;
    }

    // Upstream captures once, even when OpenAL has no sources yet. Keep the
    // same destination and attach sources that appear after automatic hosting.
    netplay._captureHostAudio = capture;
    return {
      update() {
        const audio = capture();
        const stream = netplay.localStream;
        if (!audio || !stream) return;
        const track = audio.getAudioTracks()[0];
        if (!track || stream.getAudioTracks().includes(track)) return;
        for (const old of stream.getAudioTracks()) stream.removeTrack(old);
        stream.addTrack(track);
        // A core may initialize its entire audio context after video connects.
        // Reoffer through the runtime so existing guests receive the new track.
        for (const [id, peer] of Object.entries(netplay.peerConnections)) {
          peer.pc.close();
          delete netplay.peerConnections[id];
          netplay.createPeerConnection(id);
        }
      },
      dispose() {
        disconnect();
        netplay._captureHostAudio = originalCapture;
      }
    };
  }

  // Invitations connect to a dedicated signaling server. Let EmulatorJS own
  // the room handshake, guest video stream, and controller-port assignment.
  window.romRoomNetplay = function (emu, config, fail) {
    const netplay = emu?.netplay;
    if (!netplay || !['host', 'guest'].includes(config.netplayRole)) {
      fail('This emulator runtime could not initialize NetPlay.');
      return;
    }
    const hosting = config.netplayRole === 'host';
    const audio = hosting ? installHostAudio(emu, netplay) : null;
    netplay.name = hosting ? 'Host' : 'Guest';
    let stopped = false;
    let joined = false;
    let connected = false;
    let joining = false;
    let discovering = false;
    const deadline = Date.now() + 60000;
    let connectionDeadline = 0;
    let timer;

    function abort(message) {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      audio?.dispose();
      netplay.leaveRoom();
      // leaveRoom restores solo emulation; a failed invitation must not do so.
      emu.gameManager.toggleMainLoop(0);
      fail(message);
    }

    if (!hosting) emu.gameManager.toggleMainLoop(0);
    emu.displayMessage(hosting ? 'Creating NetPlay room…' : 'Waiting for the host’s NetPlay room…', 60000);

    async function check() {
      try {
        if (stopped) return;
        audio?.update();
        if (!hosting && !joining && !discovering) {
          // Keep the deadline running even if a network request never settles.
          discovering = true;
          netplay.getOpenRooms().then((rooms) => {
            if (stopped) return;
            const room = Object.entries(rooms).find(([, value]) => value.room_name === 'ROM Room');
            if (room) {
              joining = true;
              netplay.joinRoom(room[0], room[1].room_name, room[1].max, config.roomPassword);
            }
          }).catch((error) => abort(`NetPlay connection failed: ${error.message}`))
            .finally(() => { discovering = false; });
        }
        if (emu.isNetplay) {
          if (!joined) {
            joined = true;
            connectionDeadline = Date.now() + 30000;
            if (hosting) emu.displayMessage('NetPlay: Player 1. Waiting for guests.', 5000);
          }
          if (!hosting && !connected && netplay._gotVideoEver
            && Object.values(netplay.peerConnections).some((peer) => peer.dataChannel?.readyState === 'open')) {
            connected = true;
            emu.menu?.close();
            emu.displayMessage(`NetPlay connected: Player ${netplay.getUserIndex() + 1}`, 5000);
          }
        } else if (joined) {
          abort('The NetPlay room disconnected. Relaunch NetPlay to reconnect.');
          return;
        }
        if ((!joined && Date.now() >= deadline)
          || (!hosting && joined && !connected && Date.now() >= connectionDeadline)) {
          abort('NetPlay could not connect the game video and input channel. Check that the host is running and try the invitation again.');
          return;
        }
        timer = setTimeout(check, 500);
      } catch (error) {
        abort(`NetPlay connection failed: ${error.message}`);
      }
    }

    window.addEventListener('pagehide', () => {
      stopped = true;
      clearTimeout(timer);
      audio?.dispose();
      netplay.leaveRoom();
    }, { once: true });
    try {
      netplay.defineNetplayFunctions();
      if (hosting) netplay.openRoom('ROM Room', 4, config.roomPassword);
      check();
    } catch (error) {
      abort(`NetPlay connection failed: ${error.message}`);
    }
  };
})();
