/**
 * A2: parity cond_vae_test на интегрированном пайплайне приложения.
 *
 * SQLite (minute) → modelDayTensor (107×105, ВСЕ 21 тикера) → predict_worker → real next day.
 *
 * Запуск:
 *   npm run test:a2
 *   npm run test:a2:plot
 *
 * --plot-symbols — только для PNG; в модель всегда уходит полный тензор 21×5.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ANALYTICS_BARS_PER_SESSION,
  ANALYTICS_FEAT_DIM,
  ANALYTICS_MODEL_TICKERS,
} from '../../src/logic/modules/analytics/modelConstants';
import { assertFullModelInputTensor } from '../../src/logic/modules/analytics/modelDayTensor';
import {
  buildAnalyticsParityReport,
  buildParityPlotPayload,
  formatParityReportTable,
  formatTickerChannelStats,
} from '../../src/logic/modules/analytics/parityCheck';
import { loadAnalyticsDayTensorPair } from './analyticsDayLoader';
import { exitCode, printResult } from './runner';

const { predictDay, shutdownWorker } = require('../../electron/ml-bridge.cjs');

const M = 'A2-parity';
const DEFAULT_SOURCE = '20191230';
const DEFAULT_TARGET = '20200103';
const DEFAULT_PLOT_SYMBOLS = ['GAZP', 'BR'];

type CliArgs = {
  source: string;
  target: string;
  plotSymbols: string[];
  plot: boolean;
};

function parseSymbolList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function parseArgs(argv: string[]): CliArgs {
  let source = process.env.ANALYTICS_PARITY_SOURCE ?? DEFAULT_SOURCE;
  let target = process.env.ANALYTICS_PARITY_TARGET ?? DEFAULT_TARGET;
  let plotSymbols = [...DEFAULT_PLOT_SYMBOLS];
  let plot = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source' && argv[i + 1]) {
      source = argv[++i];
    } else if (a === '--target' && argv[i + 1]) {
      target = argv[++i];
    } else if ((a === '--plot-symbols' || a === '--symbols') && argv[i + 1]) {
      const chunks: string[] = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        chunks.push(argv[++i]);
      }
      plotSymbols = parseSymbolList(chunks.join(' '));
    } else if (a === '--plot') {
      plot = true;
    }
  }

  return { source, target, plotSymbols, plot };
}

function runPlotScript(payloadPath: string, outDir: string): void {
  const pyScript = path.join(
    process.cwd(),
    'resources',
    'ml',
    'python',
    'analytics_cond_parity.py'
  );
  const python = process.env.ML_PYTHON ?? 'python';
  const result = spawnSync(
    python,
    [pyScript, '--input', payloadPath, '--out-dir', outDir],
    { encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
  );
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'plot_script_failed');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let failures = 0;
  let testNum = 0;

  const run = async (description: string, fn: () => void | Promise<void>) => {
    testNum++;
    try {
      await fn();
      printResult(M, testNum, description, true);
    } catch (e) {
      failures++;
      printResult(
        M,
        testNum,
        description,
        false,
        e instanceof Error ? e.message : String(e)
      );
    }
  };

  try {
    await run(`load days ${args.source} → ${args.target}`, async () => {
      const { prevTensor, realTensor } = await loadAnalyticsDayTensorPair(
        args.source,
        args.target
      );

      assertFullModelInputTensor(prevTensor);
      if (prevTensor.length !== ANALYTICS_BARS_PER_SESSION) {
        throw new Error(`input rows ${prevTensor.length}, expected ${ANALYTICS_BARS_PER_SESSION}`);
      }
      if (prevTensor[0].length !== ANALYTICS_FEAT_DIM) {
        throw new Error(`input cols ${prevTensor[0].length}, expected ${ANALYTICS_FEAT_DIM}`);
      }
      console.log(
        `[${M}] model input: shape (${ANALYTICS_BARS_PER_SESSION}, ${ANALYTICS_FEAT_DIM}) — all ${ANALYTICS_MODEL_TICKERS.length} tickers`
      );

      const predRes = await predictDay(prevTensor);
      if (!predRes.ok || !predRes.next_day) {
        throw new Error('predict_failed');
      }
      const predTensor = predRes.next_day as number[][];
      assertFullModelInputTensor(predTensor);

      const report = buildAnalyticsParityReport(
        args.source,
        args.target,
        prevTensor,
        predTensor,
        realTensor,
        [...ANALYTICS_MODEL_TICKERS]
      );

      console.log('\n' + formatParityReportTable(report) + '\n');

      for (const sym of args.plotSymbols) {
        console.log(formatTickerChannelStats(prevTensor, sym, 'INPUT'));
        console.log(formatTickerChannelStats(predTensor, sym, 'PRED'));
        console.log(formatTickerChannelStats(realTensor, sym, 'REAL'));
      }
      console.log('');

      const plotSymbols = args.plotSymbols.filter((s) =>
        ANALYTICS_MODEL_TICKERS.includes(s as (typeof ANALYTICS_MODEL_TICKERS)[number])
      );
      const symbolsForPlot =
        plotSymbols.length > 0 ? plotSymbols : [...DEFAULT_PLOT_SYMBOLS];

      if (args.plot) {
        const outDir = path.join(process.cwd(), 'tmp', 'analytics-parity');
        fs.mkdirSync(outDir, { recursive: true });
        const payload = buildParityPlotPayload(
          report,
          prevTensor,
          predTensor,
          realTensor,
          symbolsForPlot
        );
        const payloadPath = path.join(outDir, 'parity-payload.json');
        fs.writeFileSync(payloadPath, JSON.stringify(payload));
        runPlotScript(payloadPath, outDir);
        console.log(`[${M}] Графики: ${outDir}`);
      } else {
        console.log(`[${M}] Подсказка: npm run test:a2:plot для PNG`);
      }
    });
  } finally {
    shutdownWorker();
    exitCode(failures);
  }
}

void main();
