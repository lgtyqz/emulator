'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('romRoom', {
  listGames: () => ipcRenderer.invoke('library:list'),
  pickFile: (kind = 'rom') => ipcRenderer.invoke('file:pick', kind),
  importDroppedFile: (file, kind = 'rom') => {
    const filePath = webUtils.getPathForFile(file);
    if (!filePath) return Promise.reject(new Error('That dropped item is not a local file.'));
    return ipcRenderer.invoke('file:register', filePath, kind);
  },
  launchGame: (id, system, biosId = null, netplaySessionId = null) => (
    ipcRenderer.invoke('game:launch', id, system, biosId, netplaySessionId)
  ),
  removeGame: (id) => ipcRenderer.invoke('game:remove', id),
  hostNetplay: (gameId, reach) => ipcRenderer.invoke('netplay:host', gameId, reach),
  resolveNetplayInvite: (input) => ipcRenderer.invoke('netplay:resolve-invite', input),
  joinNetplay: (inviteId, gameId) => ipcRenderer.invoke('netplay:join', inviteId, gameId),
  stopNetplay: () => ipcRenderer.invoke('netplay:stop'),
  getNetplayState: () => ipcRenderer.invoke('netplay:state'),
  copyText: (value) => ipcRenderer.invoke('clipboard:write', value),
  onNetplayInvite: (callback) => {
    const listener = (_event, code) => callback(code);
    ipcRenderer.on('netplay:invite', listener);
    return () => ipcRenderer.removeListener('netplay:invite', listener);
  },
  onNetplayStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('netplay:status', listener);
    return () => ipcRenderer.removeListener('netplay:status', listener);
  },
  onOpenRom: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:open-rom', listener);
    return () => ipcRenderer.removeListener('menu:open-rom', listener);
  }
});
