/**
 * Per-ticker CLOSE RMSE (cond_vae_test formulas) on SQLite → modelDayTensor → predict_worker.
 * Calendar window: 2020-01-01 .. 2025-12-31 (2026 excluded).
 *
 * Compare vs reference Validation Set RMSE from timeVAE/cond_vae_test.py (embedded below).
 *
 * Run:
 *   npx tsx scripts/benchmark-rmse-close-2020-2025.ts
 *   npx tsx scripts/benchmark-rmse-close-2020-2025.ts --from 20200101 --to 20251231 --max-pairs 50
 */
import tradingCalendar from '../src/data/generated/tradingCalendar.json';
import {
  ANALYTICS_BARS_PER_SESSION,
  ANALYTICS_MODEL_TICKERS,
  analyticsFeatureIndex,
} from '../src/logic/modules/analytics/modelConstants';
import {
  assertFullModelInputTensor,
  buildModelDayTensorFromDayBundle,
  foldTradingDayIntoLastKnown,
  type ModelDayTensor,
} from '../src/logic/modules/analytics/modelDayTensor';
import {
  buildCrossDayLastKnownBefore,
} from '../src/logic/modules/analytics/crossDayLastKnown';
import {
  loadAnalyticsDayBundle,
} from '../tests/console/analyticsDayLoader';
import { buildLastKnownSeedPayload } from '../electron/market-db-slice.cjs';

const { predictDay, shutdownWorker } = require('../electron/ml-bridge.cjs');

/** Reference PER-TICKER RMSE CLOSE — Validation Set from cond_vae_test.py console output. */
const REFERENCE_VALIDATION_RMSE: Record<string, number> = {
  GAZP: 2.5242,
  LKOH: 86.155701,
  ROSN: 7.4031,
  NVTK: 20.583401,
  TATN: 9.8564,
  SBER: 3.8944,
  VTBR: 2.4526,
  MOEX: 2.8882,
  CHMF: 19.043501,
  NLMK: 2.2276,
  GMKN: 2.4535,
  MGNT: 70.014702,
  MTSS: 3.3003,
  YDEX: 61.963799,
  RUAL: 0.7503,
  PLZL: 30.9025,
  AFLT: 1.2161,
  HYDR: 0.0139,
  IRAO: 0.0566,
  BR: 1.1664,
  EU: 950.949097,
};

type CliArgs = {
  fromMsk: string;
  toMsk: string;
  maxPairs: number | null;
  progressEvery: number;
};

function parseArgs(): CliArgs {
  let fromMsk = '20200101';
  let toMsk = '20251231';
  let maxPairs: number | null = null;
  let progressEvery = 25;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--from' && process.argv[i + 1]) {
      fromMsk = process.argv[++i];
    } else if (a === '--to' && process.argv[i + 1]) {
      toMsk = process.argv[++i];
    } else if (a === '--max-pairs' && process.argv[i + 1]) {
      maxPairs = Number(process.argv[++i]);
    } else if (a === '--progress-every' && process.argv[i + 1]) {
      progressEvery = Number(process.argv[++i]);
    }
  }
  return { fromMsk, toMsk, maxPairs, progressEvery };
}

function tradingDaysInRange(fromMsk: string, toMsk: string): string[] {
  return tradingCalendar.days
    .map((d) => d.mskDateYyyymmdd)
    .filter((d) => d >= fromMsk && d <= toMsk)
    .sort();
}

/** Same as cond_vae_test compute_metrics(..., mask=close) for one ticker. */
function accumulateCloseErrors(
  accum: Float64Array,
  real: ModelDayTensor,
  pred: number[][],
  tickerIdx: number
): void {
  const ci = analyticsFeatureIndex(tickerIdx, 'CLOSE');
  for (let t = 0; t < ANALYTICS_BARS_PER_SESSION; t++) {
    const r = real[t][ci];
    const p = pred[t][ci];
    if (!Number.isFinite(r) || !Number.isFinite(p)) {
      continue;
    }
    const err = r - p;
    accum[tickerIdx] += err * err;
    accum[tickerIdx + ANALYTICS_MODEL_TICKERS.length] += 1;
  }
}

function rmseFromAccum(accum: Float64Array, tickerIdx: number): number | null {
  const n = accum[tickerIdx + ANALYTICS_MODEL_TICKERS.length];
  if (n <= 0) {
    return null;
  }
  return Math.sqrt(accum[tickerIdx] / n);
}

async function loadLastKnownSeed(beforeMskDate: string) {
  const res = await buildLastKnownSeedPayload({
    beforeMskDate,
    symbols: [...ANALYTICS_MODEL_TICKERS],
  });
  if (!res.ok) {
    return null;
  }
  return res.closeBySymbol as Record<string, number | null>;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const days = tradingDaysInRange(args.fromMsk, args.toMsk);
  if (days.length < 2) {
    throw new Error(`not_enough_trading_days:${days.length}`);
  }

  const pairLimit =
    args.maxPairs == null ? days.length - 1 : Math.min(args.maxPairs, days.length - 1);

  console.log('='.repeat(120));
  console.log('PER-TICKER RMSE (CLOSE ONLY) — SQLite pipeline');
  console.log(
    `Window: ${args.fromMsk} .. ${args.toMsk} | pairs: ${pairLimit} / ${days.length - 1}`
  );
  console.log('Formula: sqrt(mean((real - pred)^2)) — same as cond_vae_test.py compute_metrics');
  console.log('='.repeat(120));

  const accum = new Float64Array(ANALYTICS_MODEL_TICKERS.length * 2);
  let skipped = 0;
  const t0 = Date.now();

  const firstDay = days[0];
  const seed = await loadLastKnownSeed(firstDay);
  let crossDay = await buildCrossDayLastKnownBefore(
    firstDay,
    loadAnalyticsDayBundle,
    null,
    null,
    seed
  );

  for (let i = 0; i < pairLimit; i++) {
    const sourceMsk = days[i];
    const targetMsk = days[i + 1];

    try {
      const sourceBundle = await loadAnalyticsDayBundle(sourceMsk);
      const prevTensor = buildModelDayTensorFromDayBundle(
        sourceBundle,
        sourceMsk,
        crossDay
      );
      assertFullModelInputTensor(prevTensor);

      const predRes = await predictDay(prevTensor);
      const pred = predRes.next_day as number[][];

      crossDay = foldTradingDayIntoLastKnown(sourceBundle, sourceMsk, crossDay);

      const targetBundle = await loadAnalyticsDayBundle(targetMsk);
      const realTensor = buildModelDayTensorFromDayBundle(
        targetBundle,
        targetMsk,
        crossDay
      );
      assertFullModelInputTensor(realTensor);

      for (let ti = 0; ti < ANALYTICS_MODEL_TICKERS.length; ti++) {
        accumulateCloseErrors(accum, realTensor, pred, ti);
      }

      crossDay = foldTradingDayIntoLastKnown(targetBundle, targetMsk, crossDay);
    } catch (e) {
      skipped += 1;
      if (skipped <= 5) {
        console.warn(`skip ${sourceMsk}→${targetMsk}:`, e);
      }
    }

    if ((i + 1) % args.progressEvery === 0 || i + 1 === pairLimit) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  progress ${i + 1}/${pairLimit} (${elapsed}s, skipped=${skipped})`);
    }
  }

  shutdownWorker();

  console.log('\n' + '='.repeat(120));
  console.log('PER-TICKER RMSE (CLOSE) — comparison vs cond_vae_test Validation Set');
  console.log('='.repeat(120));
  console.log(
    [
      'Ticker'.padEnd(6),
      'Ref(valid)'.padStart(12),
      'SQLite'.padStart(12),
      'Δ abs'.padStart(10),
      'Δ %'.padStart(10),
    ].join('  ')
  );
  console.log('-'.repeat(60));

  let sumRef = 0;
  let sumOurs = 0;
  let nTickers = 0;

  for (let ti = 0; ti < ANALYTICS_MODEL_TICKERS.length; ti++) {
    const sym = ANALYTICS_MODEL_TICKERS[ti];
    const ref = REFERENCE_VALIDATION_RMSE[sym];
    const ours = rmseFromAccum(accum, ti);
    if (ref == null || ours == null) {
      console.log(`${sym.padEnd(6)}  (missing)`);
      continue;
    }
    const delta = ours - ref;
    const pct = ref > 0 ? (delta / ref) * 100 : NaN;
    const pctStr = Number.isFinite(pct)
      ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
      : 'n/a';
    console.log(
      [
        sym.padEnd(6),
        ref.toFixed(4).padStart(12),
        ours.toFixed(4).padStart(12),
        delta.toFixed(4).padStart(10),
        pctStr.padStart(10),
      ].join('  ')
    );
    sumRef += ref;
    sumOurs += ours;
    nTickers += 1;
  }

  if (nTickers > 0) {
    const meanRef = sumRef / nTickers;
    const meanOurs = sumOurs / nTickers;
    const meanPct = ((meanOurs - meanRef) / meanRef) * 100;
    console.log('-'.repeat(60));
    console.log(
      `MEAN (unweighted, ${nTickers} tickers): ref=${meanRef.toFixed(4)}  ours=${meanOurs.toFixed(4)}  Δ=${meanPct >= 0 ? '+' : ''}${meanPct.toFixed(1)}%`
    );
  }

  console.log(`\nPairs evaluated: ${pairLimit - skipped} ok, ${skipped} skipped`);
  console.log(
    'Note: reference = last 10% npz chronology (Validation Set); ours = calendar 2020–2025 SQLite pipeline.'
  );
}

main().catch((e) => {
  shutdownWorker();
  console.error(e);
  process.exit(1);
});
