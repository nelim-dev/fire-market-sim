const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  quit() {
    return ipcRenderer.invoke('app:quit');
  },
  getWindowMode() {
    return ipcRenderer.invoke('window:get-mode');
  },
  setWindowMode(mode) {
    return ipcRenderer.invoke('window:set-mode', { mode });
  },
});

contextBridge.exposeInMainWorld('marketData', {
  getSlices(payload) {
    return ipcRenderer.invoke('market:get-slices', payload);
  },
  prefetchNextDay(payload) {
    return ipcRenderer.invoke('market:prefetch-next-day', payload);
  },
  prefetchDay(payload) {
    return ipcRenderer.invoke('market:prefetch-day', payload);
  },
  getDaySlices(payload) {
    return ipcRenderer.invoke('market:get-day-slices', payload);
  },
});

contextBridge.exposeInMainWorld('persistence', {
  listSaves() {
    return ipcRenderer.invoke('persistence:list-saves');
  },
  writeSave(snapshot) {
    return ipcRenderer.invoke('persistence:write-save', snapshot);
  },
  readSave(slotId) {
    return ipcRenderer.invoke('persistence:read-save', { slotId });
  },
});
