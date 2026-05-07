import type {
  MarketPrefetchDayIpcPayload,
  MarketPrefetchIpcPayload,
  MarketPrefetchIpcResult,
  MarketSlicesIpcPayload,
  MarketSlicesIpcResult,
} from '@/logic/modules/market/marketElectronBridge';

declare global {
  interface Window {
    marketData?: {
      getSlices(payload: MarketSlicesIpcPayload): Promise<MarketSlicesIpcResult>;
      prefetchNextDay(
        payload: MarketPrefetchIpcPayload
      ): Promise<MarketPrefetchIpcResult>;
      prefetchDay(
        payload: MarketPrefetchDayIpcPayload
      ): Promise<MarketPrefetchIpcResult>;
    };
  }
}

export {};
