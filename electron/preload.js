const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {});

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
});
