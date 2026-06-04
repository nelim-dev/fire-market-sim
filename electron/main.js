const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const {
  buildSlicesPayload,
  buildDaySlicesPayload,
  prefetchNextDayPayload,
  prefetchDayPayload,
} = require('./market-db-slice.cjs');

let mainWindow;

function getSavesDir() {
  return path.join(app.getPath('userData'), 'saves');
}

async function ensureSavesDir() {
  const dir = getSavesDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function buildSlotMetaFromSnapshot(snapshot) {
  return {
    slotId: snapshot.slotId,
    displayName: snapshot.displayName,
    savedAtEpochMs: snapshot.savedAtEpochMs,
    simulationEpochMs: snapshot.gameState?.simulationEpochMs ?? 0,
    cashRub: snapshot.gameState?.portfolio?.cashRub ?? 0,
  };
}

function registerPersistenceIpc() {
  ipcMain.removeHandler('persistence:list-saves');
  ipcMain.handle('persistence:list-saves', async () => {
    try {
      const dir = await ensureSavesDir();
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const slots = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue;
        }
        const filePath = path.join(dir, entry.name);
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          const snapshot = JSON.parse(raw);
          if (snapshot?.slotId && snapshot?.displayName) {
            slots.push(buildSlotMetaFromSnapshot(snapshot));
          }
        } catch {
          // skip corrupt files
        }
      }
      slots.sort((a, b) => b.savedAtEpochMs - a.savedAtEpochMs);
      return { ok: true, slots };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.removeHandler('persistence:write-save');
  ipcMain.handle('persistence:write-save', async (_event, snapshot) => {
    try {
      if (!snapshot?.slotId) {
        return { ok: false, error: 'invalid_payload' };
      }
      const dir = await ensureSavesDir();
      const filePath = path.join(dir, `${snapshot.slotId}.json`);
      const tmpPath = `${filePath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(snapshot), 'utf8');
      await fs.rename(tmpPath, filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.removeHandler('persistence:read-save');
  ipcMain.handle('persistence:read-save', async (_event, payload) => {
    try {
      const slotId = String(payload?.slotId ?? '');
      if (!slotId) {
        return { ok: false, error: 'invalid_slot_id' };
      }
      const dir = await ensureSavesDir();
      const filePath = path.join(dir, `${slotId}.json`);
      const raw = await fs.readFile(filePath, 'utf8');
      const snapshot = JSON.parse(raw);
      return { ok: true, snapshot };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.removeHandler('app:quit');
  ipcMain.handle('app:quit', () => {
    app.quit();
    return { ok: true };
  });
}

function registerWindowIpc() {
  ipcMain.removeHandler('window:get-mode');
  ipcMain.handle('window:get-mode', () => {
    if (!mainWindow) {
      return { ok: true, mode: 'windowed' };
    }
    const mode = mainWindow.isFullScreen() ? 'fullscreen' : 'windowed';
    return { ok: true, mode };
  });

  ipcMain.removeHandler('window:set-mode');
  ipcMain.handle('window:set-mode', (_event, payload) => {
    if (!mainWindow) {
      return { ok: false, error: 'no_window' };
    }
    const mode = payload?.mode === 'fullscreen' ? 'fullscreen' : 'windowed';
    mainWindow.setFullScreen(mode === 'fullscreen');
    return { ok: true, mode };
  });
}

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

  ipcMain.removeHandler('market:get-day-slices');
  ipcMain.handle('market:get-day-slices', async (_event, payload) => {
    return await buildDaySlicesPayload(payload ?? {});
  });
}

app.on('ready', () => {
  registerMarketIpc();
  registerPersistenceIpc();
  registerWindowIpc();
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