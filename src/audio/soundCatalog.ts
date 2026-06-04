/**
 * Реестр звуковых эффектов. Добавление нового типа:
 * 1) расширить SoundEffectId;
 * 2) добавить запись в SOUND_EFFECT_SOURCES.
 */
export type SoundEffectId = 'ui.click';

export const SOUND_EFFECT_SOURCES: Record<SoundEffectId, string> = {
  'ui.click': '/audio/click_004.ogg',
};

export const BACKGROUND_MUSIC_SRC = '/audio/background-music.mp3';

/** Пауза между циклами фоновой музыки, мс */
export const BACKGROUND_MUSIC_SILENCE_MS = 20_000;

/** Музыка тише SFX при том же значении ползунка (0.5 = вдвое тише). */
export const MUSIC_RELATIVE_GAIN = 0.5;
