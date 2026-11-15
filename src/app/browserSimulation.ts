import { brainRouter } from '../ai/brainRouter';
import { VillageSimulation } from '../engine/simulation';
import type { Conversation, ModelSettings, VillageMap, VillagerConfig } from '../engine/types';
import { inferWorldContext } from '../world/packs';
import type { WorldContext } from '../world/worldContext';

/**
 * The interactive wiring: a simulation whose mind and voice are the in-browser model router.
 *
 * With `timers: 'sim'` (what the running app uses) waits and the pacing of conversation
 * follow the world clock, so the time slider slows or speeds the whole world. That needs
 * something to keep stepping the simulation; the default waits in real time instead.
 */
export function createBrowserSimulation(
  map: VillageMap,
  villagers: VillagerConfig[],
  conversations: Conversation[],
  settings: ModelSettings,
  world?: WorldContext,
  options: { timers?: 'wall' | 'sim' } = {},
): VillageSimulation {
  return new VillageSimulation(map, villagers, conversations, settings, {
    mind: brainRouter,
    world: world ?? inferWorldContext(map),
    timers: options.timers ?? 'wall',
  });
}
