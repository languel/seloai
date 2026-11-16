import type { TileSemantics } from '../../art/scene';
import type { VillageMap } from '../../engine/types';
import { balkanTileSemantics } from './balkanSemantics';
import { GENERIC_WORLD_CONTEXT, type WorldContext } from '../worldContext';
import type { WorldPackDefinition } from '../worldPack';
import { SHEVITSA_CONTEXT, shevitsaPack } from './shevitsa';
import { ZMEYOVO_CONTEXT, zmeyovoPack } from './zmeyovo';

/** The worlds that ship with the app. The first is the default. */
export const WORLD_PACKS: WorldPackDefinition[] = [zmeyovoPack, shevitsaPack];

export const DEFAULT_WORLD_PACK_ID = zmeyovoPack.id;

export function findWorldPack(id: string): WorldPackDefinition | undefined {
  return WORLD_PACKS.find((pack) => pack.id === id);
}

/** The context of a bundled pack by id, or the neutral default for an unknown id. */
export function worldContextForPack(id: string): WorldContext {
  if (id === zmeyovoPack.id) return structuredClone(ZMEYOVO_CONTEXT);
  if (id === shevitsaPack.id) return structuredClone(SHEVITSA_CONTEXT);
  return structuredClone(GENERIC_WORLD_CONTEXT);
}

/**
 * Recovers the context for a map saved before worlds carried one, by recognising the
 * bundled tilesets. Anything unrecognised gets the neutral default.
 */
export function inferWorldContext(map: Pick<VillageMap, 'tileSetUrl'> | null | undefined): WorldContext {
  const url = map?.tileSetUrl ?? '';
  if (url.includes('balkan-myth')) return structuredClone(ZMEYOVO_CONTEXT);
  if (url.includes('shevitsa')) return structuredClone(SHEVITSA_CONTEXT);
  return structuredClone(GENERIC_WORLD_CONTEXT);
}

/** The meaning of a map's tiles, when its tileset is one a bundled pack describes. */
export function tileSemanticsForMap(map: Pick<VillageMap, 'tileSetUrl'> | null | undefined): TileSemantics | undefined {
  return (map?.tileSetUrl ?? '').includes('balkan-myth') ? balkanTileSemantics : undefined;
}
