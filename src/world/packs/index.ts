import { semanticsFromTable, type TileMeaningTable, type TileSemantics } from '../../art/scene';
import { BALKAN_TILE_MEANINGS } from '../../data/balkanTileMeanings';
import { SHEVITSA_TILE_MEANINGS } from '../../data/shevitsaTileMeanings';
import type { VillageMap } from '../../engine/types';
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

const semanticsCache = new WeakMap<TileMeaningTable, TileSemantics>();

/** The meaning of a map's tiles, from the table the map carries. */
export function tileSemanticsForMap(map: Pick<VillageMap, 'tileMeanings'> | null | undefined): TileSemantics | undefined {
  const table = map?.tileMeanings;
  if (!table || table.length === 0) return undefined;
  let semantics = semanticsCache.get(table);
  if (!semantics) {
    semantics = semanticsFromTable(table);
    semanticsCache.set(table, semantics);
  }
  return semantics;
}

/**
 * Gives a map saved before maps carried their tile meanings the table of the bundled world
 * whose tileset it uses. Maps that already carry a table, or use another tileset, are
 * returned unchanged.
 */
export function withBundledTileMeanings(map: VillageMap): VillageMap {
  if (map.tileMeanings) return map;
  const url = map.tileSetUrl ?? '';
  const table = url.includes('balkan-myth') ? BALKAN_TILE_MEANINGS : url.includes('shevitsa') ? SHEVITSA_TILE_MEANINGS : undefined;
  return table ? { ...map, tileMeanings: structuredClone(table) } : map;
}
