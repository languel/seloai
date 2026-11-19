import { mixerLevels, setLevel, type MixerChannel } from '../ai/mixer';
import type { ModelSettings } from '../engine/types';
import type { MusicAmounts } from '../music/player';
import { villageMusic } from '../music/villageMusic';

/**
 * Ways to listen to the village: how much the characters talk, how much the Scribe tells, how
 * much music there is and how loud each part is, set together. "Ambient" is only music and
 * people going about their business; "Chronicle" lets the Scribe lead.
 */
export interface SoundMode {
  id: string;
  label: string;
  about: string;
  /** Characters talking among themselves, 0 to 1. */
  talk: number;
  /** The Scribe telling, 0 to 1. */
  scribe: number;
  /** The story's tempo, 0 slow to 1 brisk. */
  pace: number;
  music: boolean;
  /** How much ambience, in-between and song, each 0 to 1. */
  amounts: MusicAmounts;
  levels: Partial<Record<MixerChannel, number>>;
}

export const SOUND_MODES: SoundMode[] = [
  { id: 'story', label: 'Story', about: 'The usual mix: conversations, the Scribe framing scenes, music underneath.', talk: 0.5, scribe: 0.5, pace: 0.5, music: true, amounts: { ambience: 0.6, between: 0.6, song: 0.5 }, levels: { voices: 1, narrator: 1, music: 0.8 } },
  { id: 'chatty', label: 'Chatty', about: 'The characters talk a lot; the Scribe and the music step back.', talk: 0.9, scribe: 0.3, pace: 0.65, music: true, amounts: { ambience: 0.45, between: 0.35, song: 0.25 }, levels: { voices: 1, narrator: 0.9, music: 0.5 } },
  { id: 'chronicle', label: 'Chronicle', about: 'The Scribe leads, telling scenes and village life; fewer conversations.', talk: 0.3, scribe: 0.9, pace: 0.4, music: true, amounts: { ambience: 0.6, between: 0.8, song: 0.45 }, levels: { voices: 0.9, narrator: 1, music: 0.6 } },
  { id: 'village', label: 'Village life', about: 'People mostly go about their work; a word now and then, the Scribe noting the day, music.', talk: 0.12, scribe: 0.62, pace: 0.3, music: true, amounts: { ambience: 0.7, between: 0.5, song: 0.7 }, levels: { voices: 0.85, narrator: 0.9, music: 0.85 } },
  { id: 'ambient', label: 'Ambient', about: 'Only music and people going about their business: no talk, no narration; ambience and songs in turn.', talk: 0, scribe: 0, pace: 0.3, music: true, amounts: { ambience: 0.85, between: 0.4, song: 0.8 }, levels: { music: 1 } },
];

/** Sets everything a mode names. `updateSettings` changes the world's settings (talk and Scribe). */
export function applySoundMode(mode: SoundMode, updateSettings: (patch: Partial<ModelSettings>) => void) {
  updateSettings({ talkDensity: mode.talk, scribeDensity: mode.scribe, storyPace: mode.pace });
  for (const [ch, v] of Object.entries(mode.levels)) setLevel(ch as MixerChannel, v, 0.8);
  villageMusic.setAmounts(mode.amounts);
  if (villageMusic.enabled !== mode.music) villageMusic.setEnabled(mode.music);
}

/** The mode the current settings match, if any. */
export function currentSoundMode(settings: Pick<ModelSettings, 'talkDensity' | 'scribeDensity' | 'storyPace'>): SoundMode | null {
  const near = (a: number | undefined, b: number) => Math.abs((a ?? 0.5) - b) < 0.02;
  const levels = mixerLevels();
  return (
    SOUND_MODES.find(
      (m) =>
        near(settings.talkDensity, m.talk) &&
        near(settings.scribeDensity, m.scribe) &&
        near(settings.storyPace, m.pace) &&
        (['ambience', 'between', 'song'] as const).every((k) => Math.abs(villageMusic.amounts[k] - m.amounts[k]) < 0.02) &&
        villageMusic.enabled === m.music &&
        Object.entries(m.levels).every(([ch, v]) => Math.abs(levels[ch as MixerChannel] - v) < 0.02),
    ) ?? null
  );
}

export const findSoundMode = (id: string) => SOUND_MODES.find((m) => m.id === id.toLowerCase() || m.label.toLowerCase() === id.toLowerCase()) ?? null;
