// Preload скрипт - мост между Electron и веб-приложением
// Пока оставим пустым, но он нужен для безопасности

const { contextBridge } = require('electron');

// В будущем здесь можно будет добавить API для взаимодействия
// между Electron и React приложением

contextBridge.exposeInMainWorld('electron', {
  // Здесь будут функции для доступа к файловой системе, если понадобится
});