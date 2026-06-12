'use strict';

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

let worker = null;
let workerReady = false;
let workerStarting = null;
let nextId = 1;
const pending = new Map();

function resolveMlRoot() {
  if (process.env.ML_RESOURCES_ROOT) {
    return process.env.ML_RESOURCES_ROOT;
  }
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'ml');
    if (require('fs').existsSync(packaged)) {
      return packaged;
    }
  }
  return path.join(__dirname, '..', 'resources', 'ml');
}

function resolvePythonExecutable() {
  if (process.env.ML_PYTHON) {
    return process.env.ML_PYTHON;
  }
  const embedded = path.join(resolveMlRoot(), 'python-runtime', 'python.exe');
  if (require('fs').existsSync(embedded)) {
    return embedded;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function rejectAllPending(error) {
  for (const [, handlers] of pending) {
    handlers.reject(error);
  }
  pending.clear();
}

function startWorker() {
  if (workerStarting) {
    return workerStarting;
  }
  workerStarting = new Promise((resolve, reject) => {
    const mlRoot = resolveMlRoot();
    const scriptPath = path.join(mlRoot, 'python', 'predict_worker.py');
    const python = resolvePythonExecutable();

    worker = spawn(python, [scriptPath], {
      cwd: mlRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        TF_CPP_MIN_LOG_LEVEL: '3',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    const rl = readline.createInterface({ input: worker.stdout });
    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const id = msg.id;
      if (id == null || !pending.has(id)) {
        return;
      }
      const handlers = pending.get(id);
      pending.delete(id);
      if (msg.ok) {
        handlers.resolve(msg);
      } else {
        handlers.reject(new Error(msg.error || 'ml_worker_error'));
      }
    });

    worker.stderr.on('data', (chunk) => {
      if (process.env.NODE_ENV === 'development') {
        process.stderr.write(`[ml-worker] ${chunk}`);
      }
    });

    worker.on('error', (err) => {
      workerReady = false;
      worker = null;
      workerStarting = null;
      rejectAllPending(err);
      reject(err);
    });

    worker.on('exit', (code) => {
      workerReady = false;
      worker = null;
      workerStarting = null;
      rejectAllPending(new Error(`ml_worker_exited:${code}`));
    });

    sendRaw({ cmd: 'ping', id: '__boot__' })
      .then(() => {
        workerReady = true;
        resolve();
      })
      .catch(reject);
  });
  return workerStarting;
}

function sendRaw(payload) {
  return new Promise((resolve, reject) => {
    if (!worker || !worker.stdin.writable) {
      reject(new Error('ml_worker_not_running'));
      return;
    }
    const id = payload.id;
    pending.set(id, { resolve, reject });
    worker.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

async function ensureWorker() {
  if (workerReady && worker) {
    return;
  }
  await startWorker();
}

async function predictDay(prevDay) {
  await ensureWorker();
  const id = String(nextId++);
  const res = await sendRaw({ cmd: 'predict', id, prev_day: prevDay });
  return {
    ok: true,
    next_day: res.next_day,
  };
}

function shutdownWorker() {
  if (worker) {
    worker.kill();
    worker = null;
  }
  workerReady = false;
  workerStarting = null;
  rejectAllPending(new Error('ml_worker_shutdown'));
}

function registerMlIpc(ipcMain) {
  ipcMain.removeHandler('ml:predict');
  ipcMain.handle('ml:predict', async (_event, payload) => {
    try {
      const prevDay = payload?.prev_day;
      if (!Array.isArray(prevDay) || prevDay.length !== 107) {
        return { ok: false, error: 'invalid_prev_day_shape' };
      }
      const result = await predictDay(prevDay);
      return result;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
}

module.exports = {
  registerMlIpc,
  predictDay,
  shutdownWorker,
  resolveMlRoot,
  resolvePythonExecutable,
  ensureWorker,
};
