import type { brainRouter } from '../ai/brainRouter';
import type { Rng } from '../core/rng';
import type { WorldContext } from '../world/worldContext';

/**
 * Everything the simulation asks of a mind and a voice. The simulation only sees this
 * interface; the browser wires the model router to it and a headless run can wire anything.
 */
export type SimMind = Pick<
  typeof brainRouter,
  | 'decideVillagerNextAction'
  | 'generateVillagerReply'
  | 'generateNarratorReply'
  | 'generateSceneBeat'
  | 'reflectMemory'
  | 'converseWithVoice'
  | 'speakLine'
  | 'speakThought'
  | 'speakNarration'
  | 'refreshActiveSpatialMix'
  | 'flushAudioQueue'
  | 'setSpeechPaused'
  | 'log'
> &
  /** Optional: forget story-level memory (scene hooks used) when the story is reset. */
  Partial<Pick<typeof brainRouter, 'resetStoryMemory'>>;

export interface SimPorts {
  mind: SimMind;
  /** Setting-specific knowledge from the active world pack. Defaults to a neutral village. */
  world?: WorldContext;
  /** Source of all simulation randomness. Defaults to Math.random (not reproducible). */
  rng?: Rng;
  /** Timestamp for messages and memories, given the current sim time. Defaults to the wall clock. */
  timestamp?: (simTimeMs: number) => number;
  /**
   * 'wall' waits in real time (interactive use). 'sim' waits in simulation time, so waits
   * advance only when the simulation is stepped, which makes a run reproducible.
   */
  timers?: 'wall' | 'sim';
}
