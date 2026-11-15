import { brainRouter } from '../ai/brainRouter';
import { createSeededRng, hashString } from '../core/rng';
import { DEFAULT_MODEL_SETTINGS } from '../data/defaultData';
import { VillageSimulation } from '../engine/simulation';
import { createSilentMind } from './silentMind';
import type { ModelSettings, VillageMap, VillagerConfig } from '../engine/types';
import type { WorldContext } from '../world/worldContext';

/** Fixed origin for timestamps in reproducible runs, so records do not depend on the wall clock. */
export const HEADLESS_EPOCH_MS = Date.UTC(2026, 0, 1);

export interface HeadlessRunOptions {
  seed: number;
  /** How much simulated time to run. */
  simSeconds: number;
  map: VillageMap;
  villagers: VillagerConfig[];
  /** Setting-specific knowledge from the world pack. */
  world?: WorldContext;
  settings?: Partial<ModelSettings>;
  /** Simulated milliseconds per step (the kernel caps a step at 100). */
  stepMs?: number;
}

export interface TraceEvent {
  /** Simulated milliseconds since the start of the run. */
  t: number;
  conversationId: string;
  senderId: string;
  kind: string;
  text: string;
}

export interface HeadlessRunResult {
  seed: number;
  simSeconds: number;
  ticks: number;
  trace: TraceEvent[];
  finalState: Array<{ id: string; x: number; y: number; state: string; intention: string }>;
  /** Hash of the trace and final state: equal digests mean identical runs. */
  digest: string;
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/**
 * Runs a world with no browser, no models and no audio, driven by a seed.
 * The same seed and inputs always produce the same trace.
 */
export async function runHeadless(options: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const stepMs = Math.max(1, Math.min(100, options.stepMs ?? 100));
  const settings: ModelSettings = {
    ...DEFAULT_MODEL_SETTINGS,
    inferenceMode: 'story-sim',
    localApiEnabled: false,
    enableOmniTts: false,
    enableWebSpeechFallback: false,
    ambientAudioEnabled: false,
    proximityRadiusTiles: 0,
    ...options.settings,
  };

  const sim: VillageSimulation = new VillageSimulation(
    structuredClone(options.map),
    structuredClone(options.villagers),
    [],
    settings,
    {
      mind: createSilentMind(),
      world: options.world,
      rng: createSeededRng(options.seed),
      timestamp: (simTimeMs) => HEADLESS_EPOCH_MS + Math.round(simTimeMs),
      timers: 'sim',
    },
  );
  brainRouter.configureStoryRuntime({
    random: createSeededRng(options.seed ^ 0x9e3779b9),
    now: () => HEADLESS_EPOCH_MS + Math.round(sim.simTimeMs),
    delay: (ms) => sim.waitSimTime(ms),
  });

  const ticks = Math.ceil((options.simSeconds * 1000) / stepMs);
  for (let i = 0; i < ticks; i++) {
    sim.stepFrame(stepMs / 1000);
    await settle();
  }

  const trace: TraceEvent[] = sim.conversations
    .flatMap((conv) =>
      conv.messages.map((m) => ({
        t: m.timestamp - HEADLESS_EPOCH_MS,
        conversationId: conv.id,
        senderId: m.senderId,
        kind: m.kind ?? 'speech',
        text: m.text,
      })),
    )
    .sort((a, b) => a.t - b.t);
  const finalState = [...sim.runtimes.values()].map((rt) => ({
    id: rt.id,
    x: Math.round(rt.x * 100) / 100,
    y: Math.round(rt.y * 100) / 100,
    state: rt.state,
    intention: rt.currentIntention ?? '',
  }));
  const digest = hashString(JSON.stringify({ trace, finalState })).toString(16).padStart(8, '0');

  return { seed: options.seed, simSeconds: options.simSeconds, ticks, trace, finalState, digest };
}
