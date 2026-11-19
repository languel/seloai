import type { DanceId, ModeId } from './theory';

/**
 * A musical direction, in story terms: what the scene feels like and how much is happening.
 * The listener writes one from the story, an agent or the Spinner can write one by hand, and
 * the composer plays whatever it is given. Changes land at the next phrase, never mid-phrase.
 */
export type Mood = 'pastoral' | 'lament' | 'mystery' | 'dread' | 'tension' | 'joy' | 'festive' | 'triumph';
export const MOOD_IDS: readonly Mood[] = ['pastoral', 'lament', 'mystery', 'dread', 'tension', 'joy', 'festive', 'triumph'];

export type Lead = 'kaval' | 'gaida';

export interface MusicCue {
  mood: Mood;
  /** 0 is a bare drone, about 0.3 a free-rhythm kaval, 0.5 a slow dance, 1 a wild horo. */
  intensity: number;
  /** A dance to play in; left out, the mood picks one. */
  dance?: DanceId;
  /** Which instrument carries the tune; left out, the intensity decides. */
  lead?: Lead;
  /** Move to this intensity quickly rather than easing over half a minute. */
  urgent?: boolean;
  /** Why: a few words for logs and the agent. */
  reason?: string;
}

export interface MoodProfile {
  mode: ModeId;
  /** Dances in order of preference; `free` is only played below a slow dance's intensity. */
  dances: readonly DanceId[];
  /** Where the mood sits when the scene is neither quiet nor busy. */
  base: number;
  /** How readily the tapan joins in, 0 to 1. */
  drums: number;
}

export const MOODS: Record<Mood, MoodProfile> = {
  pastoral: { mode: 'mixolydian', dances: ['pravo', 'daychovo', 'bavno'], base: 0.22, drums: 0.5 },
  lament: { mode: 'aeolian', dances: ['bavno', 'lesnoto'], base: 0.2, drums: 0.25 },
  mystery: { mode: 'phrygian', dances: ['paidushko', 'lesnoto'], base: 0.2, drums: 0.4 },
  dread: { mode: 'hijaz', dances: ['kopanitsa', 'paidushko'], base: 0.35, drums: 1 },
  tension: { mode: 'ukrainianDorian', dances: ['paidushko', 'kopanitsa', 'rachenitsa'], base: 0.5, drums: 0.9 },
  joy: { mode: 'ionian', dances: ['pravo', 'daychovo', 'rachenitsa'], base: 0.55, drums: 0.8 },
  festive: { mode: 'mixolydian', dances: ['rachenitsa', 'pravo', 'daychovo', 'kopanitsa'], base: 0.75, drums: 1 },
  triumph: { mode: 'ionian', dances: ['rachenitsa', 'kopanitsa'], base: 0.85, drums: 1 },
};

/** Below this the music is a drone with the odd long tone. */
export const DRONE_BELOW = 0.12;
/** From here the music is in a dance meter rather than free rhythm. */
export const METERED_FROM = 0.36;
/** From here the gaida takes the tune and the tapan plays the full pattern. */
export const GAIDA_FROM = 0.56;

export function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function isMood(v: unknown): v is Mood {
  return typeof v === 'string' && (MOOD_IDS as readonly string[]).includes(v);
}
