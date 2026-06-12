import { buildDaySlicesPayload, buildLastKnownSeedPayload } from '../../electron/market-db-slice.cjs';
import {
  applyLastKnownSeed,
  buildCrossDayLastKnownBefore,
  tradingDaysBeforeMsk,
} from '../../src/logic/modules/analytics/crossDayLastKnown';
import { ANALYTICS_MODEL_TICKERS } from '../../src/logic/modules/analytics/modelConstants';
import {
  assertFullModelInputTensor,
  buildModelDayTensorFromDayBundle,
  foldTradingDayIntoLastKnown,
  type DayMinuteBundle,
  type ModelDayTensor,
} from '../../src/logic/modules/analytics/modelDayTensor';
import { minuteBundleFromSlicePayload } from '../../src/logic/modules/analytics/parityCheck';

/** Shared loader: calendar-day minutes + cross-day last_known (prepare_raw parity). */
export async function loadAnalyticsDayBundle(mskDate: string): Promise<DayMinuteBundle> {
  const res = await buildDaySlicesPayload({
    mskDateYyyymmdd: mskDate,
    symbols: [...ANALYTICS_MODEL_TICKERS],
    useCalendarDayMinutes: true,
  });
  if (!res.ok) {
    throw new Error(res.error ?? `day_load_failed:${mskDate}`);
  }
  return minuteBundleFromSlicePayload(res.minuteBySymbol);
}

async function loadLastKnownSeed(beforeMskDate: string) {
  const res = await buildLastKnownSeedPayload({
    beforeMskDate: beforeMskDate,
    symbols: [...ANALYTICS_MODEL_TICKERS],
  });
  if (!res.ok) {
    return null;
  }
  return res.closeBySymbol as Record<string, number | null>;
}

export async function loadAnalyticsDayTensor(mskDate: string): Promise<ModelDayTensor> {
  const seed = await loadLastKnownSeed(mskDate);
  const crossDay = await buildCrossDayLastKnownBefore(
    mskDate,
    loadAnalyticsDayBundle,
    null,
    null,
    seed
  );
  const bundle = await loadAnalyticsDayBundle(mskDate);
  const tensor = buildModelDayTensorFromDayBundle(bundle, mskDate, crossDay);
  assertFullModelInputTensor(tensor);
  return tensor;
}

/** Load source + target tensors; cross-day fold continues from source (faster than full replay). */
export async function loadAnalyticsDayTensorPair(
  sourceMsk: string,
  targetMsk: string
): Promise<{ prevTensor: ModelDayTensor; realTensor: ModelDayTensor }> {
  const seed = await loadLastKnownSeed(sourceMsk);
  let crossDay = await buildCrossDayLastKnownBefore(
    sourceMsk,
    loadAnalyticsDayBundle,
    null,
    null,
    seed
  );

  const sourceBundle = await loadAnalyticsDayBundle(sourceMsk);
  const prevTensor = buildModelDayTensorFromDayBundle(
    sourceBundle,
    sourceMsk,
    crossDay
  );
  assertFullModelInputTensor(prevTensor);

  crossDay = foldTradingDayIntoLastKnown(sourceBundle, sourceMsk, crossDay);
  const between = tradingDaysBeforeMsk(targetMsk).filter((d) => d >= sourceMsk);
  for (const msk of between) {
    if (msk === sourceMsk) {
      continue;
    }
    const bundle = await loadAnalyticsDayBundle(msk);
    crossDay = foldTradingDayIntoLastKnown(bundle, msk, crossDay);
  }

  const targetBundle = await loadAnalyticsDayBundle(targetMsk);
  const realTensor = buildModelDayTensorFromDayBundle(
    targetBundle,
    targetMsk,
    crossDay
  );
  assertFullModelInputTensor(realTensor);

  return { prevTensor, realTensor };
}
