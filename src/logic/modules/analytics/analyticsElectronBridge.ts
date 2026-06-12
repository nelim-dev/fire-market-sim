import type { MlPredictIpcResult } from '@/global';
import type { MarketChartSeriesBundle } from '@/logic/modules/market/chartWindows';
import type {
  MarketLastKnownSeedIpcPayload,
  MarketLastKnownSeedIpcResult,
  MarketSlicesIpcResult,
} from '@/logic/modules/market/marketElectronBridge';
import { bundleFromOkPayload } from '@/logic/modules/market/marketElectronBridge';
import type { ModelDayTensor } from './modelDayTensor';

export async function predictDayFromElectron(
  prevDay: ModelDayTensor
): Promise<MlPredictIpcResult | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as Window;
  if (!w.ml?.predict) {
    return null;
  }
  return w.ml.predict({ prev_day: prevDay });
}

export async function fetchDaySlicesFromElectron(
  mskDateYyyymmdd: string,
  symbols: readonly string[]
): Promise<MarketChartSeriesBundle | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as Window;
  if (!w.marketData?.getDaySlices) {
    return null;
  }
  try {
    const res: MarketSlicesIpcResult = await w.marketData.getDaySlices({
      mskDateYyyymmdd,
      symbols: symbols.map((s) => s.toUpperCase()),
      useCalendarDayMinutes: true,
    });
    if (!res.ok) {
      console.warn('[analytics marketData]', res);
      return null;
    }
    return bundleFromOkPayload(res);
  } catch (e) {
    console.warn('[analytics marketData] getDaySlices failed', e);
    return null;
  }
}

export async function fetchLastKnownSeedFromElectron(
  beforeMskDate: string,
  symbols: readonly string[]
): Promise<Record<string, number | null> | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as Window;
  if (!w.marketData?.getLastKnownSeed) {
    return null;
  }
  try {
    const res: MarketLastKnownSeedIpcResult = await w.marketData.getLastKnownSeed({
      beforeMskDate,
      symbols: symbols.map((s) => s.toUpperCase()),
    });
    if (!res.ok) {
      return null;
    }
    return res.closeBySymbol;
  } catch (e) {
    console.warn('[analytics marketData] getLastKnownSeed failed', e);
    return null;
  }
}
