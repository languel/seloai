import type { VillageMap, VillagerConfig } from '../engine/types';
import type { WorldContext } from './worldContext';

/**
 * The authored world: everything a human or an agent edits. Runtime state (positions,
 * conversations, memories) belongs to the simulation, not to the document.
 */
export interface WorldDocument {
  map: VillageMap;
  cast: VillagerConfig[];
  context: WorldContext;
}
