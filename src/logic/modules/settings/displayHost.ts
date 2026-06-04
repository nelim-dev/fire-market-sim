import type { WindowDisplayMode } from './state';

export interface SettingsDisplayHost {
  getWindowMode(): Promise<WindowDisplayMode>;
  applyWindowMode(mode: WindowDisplayMode): Promise<void>;
}

export function createDefaultSettingsDisplayHost(): SettingsDisplayHost {
  return {
    async getWindowMode() {
      const api = window.electron;
      if (!api?.getWindowMode) {
        return 'windowed';
      }
      const result = await api.getWindowMode();
      return result.mode === 'fullscreen' ? 'fullscreen' : 'windowed';
    },
    async applyWindowMode(mode) {
      const api = window.electron;
      if (!api?.setWindowMode) {
        return;
      }
      await api.setWindowMode(mode);
    },
  };
}
