import type {
  MarketDaySlicesIpcPayload,
  MarketLastKnownSeedIpcPayload,
  MarketLastKnownSeedIpcResult,
  MarketPrefetchDayIpcPayload,
  MarketPrefetchIpcPayload,
  MarketPrefetchIpcResult,
  MarketSlicesIpcPayload,
  MarketSlicesIpcResult,
} from '@/logic/modules/market/marketElectronBridge';
import type {
  PersistedGameSnapshot,
  SaveSlotMeta,
} from '@/logic/modules/persistence/snapshot';

type PersistenceIpcResult<T> =
  | { ok: true } & T
  | { ok: false; error?: string };

export type MlPredictIpcPayload = {
  prev_day: number[][];
};

export type MlPredictIpcResult =
  | { ok: true; next_day: number[][] }
  | { ok: false; error: string };

declare global {
  interface Window {
    electron?: {
      quit(): Promise<{ ok: boolean }>;
      getWindowMode(): Promise<{ ok: boolean; mode?: 'windowed' | 'fullscreen' }>;
      setWindowMode(
        mode: 'windowed' | 'fullscreen'
      ): Promise<{ ok: boolean; mode?: 'windowed' | 'fullscreen'; error?: string }>;
    };
    marketData?: {
      getSlices(payload: MarketSlicesIpcPayload): Promise<MarketSlicesIpcResult>;
      prefetchNextDay(
        payload: MarketPrefetchIpcPayload
      ): Promise<MarketPrefetchIpcResult>;
      prefetchDay(
        payload: MarketPrefetchDayIpcPayload
      ): Promise<MarketPrefetchIpcResult>;
      getDaySlices(payload: MarketDaySlicesIpcPayload): Promise<MarketSlicesIpcResult>;
      getLastKnownSeed(
        payload: MarketLastKnownSeedIpcPayload
      ): Promise<MarketLastKnownSeedIpcResult>;
    };
    ml?: {
      predict(payload: MlPredictIpcPayload): Promise<MlPredictIpcResult>;
    };
    persistence?: {
      listSaves(): Promise<
        PersistenceIpcResult<{ slots: SaveSlotMeta[] }>
      >;
      writeSave(
        snapshot: PersistedGameSnapshot
      ): Promise<PersistenceIpcResult<Record<string, never>>>;
      readSave(
        slotId: string
      ): Promise<PersistenceIpcResult<{ snapshot: PersistedGameSnapshot }>>;
    };
  }
}

export {};
