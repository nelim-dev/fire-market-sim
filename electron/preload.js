const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {});

contextBridge.exposeInMainWorld('marketData', {
  getSlices(payload) {
    return ipcRenderer.invoke('market:get-slices', payload);
  },
});
