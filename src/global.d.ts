import type {
  MarketSlicesIpcPayload,
  MarketSlicesIpcResult,
} from '@/logic/modules/market/marketElectronBridge';

declare global {
  interface Window {
    marketData?: {
      getSlices(payload: MarketSlicesIpcPayload): Promise<MarketSlicesIpcResult>;
    };
  }
}

export {};
