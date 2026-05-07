const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const {
  buildSlicesPayload,
  prefetchNextDayPayload,
  prefetchDayPayload,
} = require('./market-db-slice.cjs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'FIRE Market Simulator'
  });

  // В режиме разработки загружаем localhost:3000
  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools(); // Открываем DevTools в режиме разработки
  } else {
    // В продакшене загружаем собранное приложение
    mainWindow.loadURL(`file://${path.join(__dirname, '../out/index.html')}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerMarketIpc() {
  ipcMain.removeHandler('market:get-slices');
  ipcMain.handle('market:get-slices', async (_event, payload) => {
    const epochMs = Number(payload?.epochMs);
    const symbols = Array.isArray(payload?.symbols) ? payload.symbols : [];
    const fromEpochMs = Number(payload?.fromEpochMs);
    if (!Number.isFinite(epochMs) || symbols.length === 0) {
      return { ok: false, error: 'invalid_payload' };
    }
    return await buildSlicesPayload({
      epochMs,
      symbols,
      ...(Number.isFinite(fromEpochMs) ? { fromEpochMs } : {}),
    });
  });

  ipcMain.removeHandler('market:prefetch-next-day');
  ipcMain.handle('market:prefetch-next-day', async (_event, payload) => {
    return await prefetchNextDayPayload(payload ?? {});
  });

  ipcMain.removeHandler('market:prefetch-day');
  ipcMain.handle('market:prefetch-day', async (_event, payload) => {
    return await prefetchDayPayload(payload ?? {});
  });
}

app.on('ready', () => {
  registerMarketIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});