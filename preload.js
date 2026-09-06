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
  launchGame: (id, system, biosId = null) => ipcRenderer.invoke('game:launch', id, system, biosId),
  removeGame: (id) => ipcRenderer.invoke('game:remove', id),
  onOpenRom: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:open-rom', listener);
    return () => ipcRenderer.removeListener('menu:open-rom', listener);
  }
});
