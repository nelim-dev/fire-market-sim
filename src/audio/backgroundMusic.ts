import { BACKGROUND_MUSIC_SILENCE_MS, BACKGROUND_MUSIC_SRC } from './soundCatalog';

/**
 * Фоновая музыка: зацикленный сегмент трека, затем затишье 20 с, снова сегмент.
 */
export class BackgroundMusicController {
  private readonly audio: HTMLAudioElement;
  private segmentEndTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private trackDurationMs = 0;
  private enabled = true;
  private masterVolume = 0.8;
  private started = false;
  private inSilence = false;

  constructor() {
    this.audio = new Audio(BACKGROUND_MUSIC_SRC);
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.addEventListener('loadedmetadata', () => {
      const sec = this.audio.duration;
      if (Number.isFinite(sec) && sec > 0) {
        this.trackDurationMs = Math.round(sec * 1000);
      }
    });
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      this.applyVolume();
      return;
    }
    this.enabled = enabled;
    if (!enabled) {
      this.pauseForDisable();
      return;
    }
    this.applyVolume();
    if (this.started && !this.inSilence) {
      void this.audio.play().catch(() => {});
      this.scheduleSegmentEnd();
    }
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = volume;
    this.applyVolume();
  }

  /** Запуск цикла после первого взаимодействия пользователя (autoplay policy). */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    if (this.enabled) {
      this.startSegment();
    }
  }

  stop(): void {
    this.clearTimers();
    this.inSilence = false;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  dispose(): void {
    this.stop();
    this.started = false;
    this.audio.src = '';
  }

  private applyVolume(): void {
    this.audio.volume = this.enabled ? this.masterVolume : 0;
  }

  private pauseForDisable(): void {
    this.clearTimers();
    this.audio.pause();
  }

  private startSegment(): void {
    if (!this.enabled) {
      return;
    }
    this.inSilence = false;
    this.clearTimers();
    this.applyVolume();
    this.audio.loop = true;
    this.audio.currentTime = 0;
    void this.audio.play().catch(() => {
      /* autoplay blocked until user gesture */
    });
    this.scheduleSegmentEnd();
  }

  private scheduleSegmentEnd(): void {
    if (this.segmentEndTimer != null) {
      clearTimeout(this.segmentEndTimer);
    }
    const segmentMs =
      this.trackDurationMs > 0 ? this.trackDurationMs : 180_000;
    this.segmentEndTimer = setTimeout(() => this.beginSilence(), segmentMs);
  }

  private beginSilence(): void {
    this.clearTimers();
    this.inSilence = true;
    this.audio.pause();
    this.audio.loop = false;
    if (!this.enabled) {
      return;
    }
    this.silenceTimer = setTimeout(() => {
      if (this.enabled && this.started) {
        this.startSegment();
      }
    }, BACKGROUND_MUSIC_SILENCE_MS);
  }

  private clearTimers(): void {
    if (this.segmentEndTimer != null) {
      clearTimeout(this.segmentEndTimer);
      this.segmentEndTimer = null;
    }
    if (this.silenceTimer != null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
}
