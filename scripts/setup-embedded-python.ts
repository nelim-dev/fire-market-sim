/**
 * Подготавливает embedded Python + TensorFlow для production-сборки Electron.
 * Запуск: npm run setup:ml-python
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const ROOT = path.join(__dirname, '..');
const ML_ROOT = path.join(ROOT, 'resources', 'ml');
const RUNTIME_DIR = path.join(ML_ROOT, 'python-runtime');
const PYTHON_VERSION = '3.11.9';
const EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;

async function download(url: string, dest: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`download failed: ${res.statusCode}`));
          return;
        }
        const file = createWriteStream(dest);
        pipeline(res, file).then(resolve).catch(reject);
      })
      .on('error', reject);
  });
}

function run(cmd: string, args: string[], cwd: string): void {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with ${r.status}`);
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.error('setup-embedded-python: only Windows is supported in this script');
    process.exit(1);
  }

  const zipPath = path.join(RUNTIME_DIR, 'python-embed.zip');
  console.log('Downloading embeddable Python...');
  if (!fs.existsSync(zipPath)) {
    await download(EMBED_URL, zipPath);
  }

  console.log('Extracting...');
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  run('powershell', [
    '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${RUNTIME_DIR}' -Force`,
  ], ROOT);

  const pthFile = path.join(RUNTIME_DIR, 'python311._pth');
  if (fs.existsSync(pthFile)) {
    let pth = fs.readFileSync(pthFile, 'utf8');
    if (!pth.includes('import site')) {
      pth = pth.replace('#import site', 'import site');
      fs.writeFileSync(pthFile, pth);
    }
  }

  const pythonExe = path.join(RUNTIME_DIR, 'python.exe');
  const requirements = path.join(ML_ROOT, 'python', 'requirements.txt');

  console.log('Installing pip + requirements (this may take several minutes)...');
  run(pythonExe, ['-m', 'ensurepip', '--upgrade'], RUNTIME_DIR);
  run(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip'], RUNTIME_DIR);
  run(
    pythonExe,
    ['-m', 'pip', 'install', '-r', requirements],
    RUNTIME_DIR
  );

  console.log('Verifying TensorFlow...');
  run(
    pythonExe,
    ['-c', "import tensorflow as tf; print('tensorflow', tf.__version__)"],
    RUNTIME_DIR
  );

  console.log(`Done. Runtime: ${RUNTIME_DIR}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
