(function () {
  'use strict';

  // Invitations connect to a dedicated signaling server. Let EmulatorJS own
  // the room handshake, guest video stream, and controller-port assignment.
  window.romRoomNetplay = function (emu, config, fail) {
    const netplay = emu?.netplay;
    if (!netplay || !['host', 'guest'].includes(config.netplayRole)) {
      fail('This emulator runtime could not initialize NetPlay.');
      return;
    }
    const hosting = config.netplayRole === 'host';
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
