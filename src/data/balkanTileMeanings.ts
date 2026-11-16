import type { FeatureKind, TileMeaningEntry, TileMeaningTable } from '../art/scene';
import { BALKAN_TILES, BALKAN_TILESET_COLS } from '../engine/balkanTileset';

type Origin = { col: number; row: number; w: number; h: number };

const T = BALKAN_TILES;

/** The fifteen set tiles of a Wang set (index 0 is "nothing set" and means nothing). */
function wangSet(base: number): number[] {
  return Array.from({ length: 15 }, (_, i) => base + i + 1);
}

function feature(kind: FeatureKind, origin: Origin, note: string): TileMeaningEntry {
  return { tiles: [origin.row * BALKAN_TILESET_COLS + origin.col], feature: { kind, w: origin.w, h: origin.h }, note };
}

function single(kind: FeatureKind, tiles: number[], note: string): TileMeaningEntry {
  return { tiles, feature: { kind, w: 1, h: 1 }, note };
}

/** What each tile of the Balkan myth tileset means, independent of how it is drawn. */
export const BALKAN_TILE_MEANINGS: TileMeaningTable = [
  {
    note: 'brook and its Wang edges',
    terrain: 'water',
    tiles: [T.WATER_BROOK, T.WATER_SHIMMER, T.WATER_SILT, T.BROOK_INT_ALT1, T.BROOK_INT_ALT2, T.BROOK_INT_ALT3, ...wangSet(T.WANG_BROOK_BASE)],
  },
  {
    note: 'khoro roads, plaza stone and their Wang edges',
    terrain: 'road',
    tiles: [
      T.ROAD_KHORO_H, T.ROAD_KHORO_V, T.ROAD_KHORO_CROSS,
      T.ROAD_H_ALT1, T.ROAD_H_ALT2, T.ROAD_H_ALT3, T.ROAD_H_ALT4,
      T.ROAD_V_ALT1, T.ROAD_V_ALT2, T.ROAD_V_ALT3, T.ROAD_V_ALT4,
      T.PLAZA_LINEN_STONE, T.PLAZA_STONE_ALT1, T.PLAZA_STONE_ALT2, T.PLAZA_STONE_ALT3, T.PLAZA_STONE_ALT4,
      ...wangSet(T.WANG_ROAD_BASE),
    ],
  },
  {
    note: 'drought clay',
    terrain: 'dry',
    tiles: [T.DROUGHT_CLAY, T.SCORCHED_COBBLE, T.DROUGHT_INT_ALT1, T.DROUGHT_INT_ALT2, T.DROUGHT_INT_ALT3, T.DROUGHT_INT_ALT4, ...wangSet(T.WANG_DROUGHT_BASE)],
  },
  { note: 'wattle fences', terrain: 'wall', tiles: [T.FENCE_WATTLE_H, T.FENCE_WATTLE_V, ...wangSet(T.WANG_WALL_BASE)] },
  { note: 'oak bridges', terrain: 'bridge', tiles: [T.BRIDGE_OAK_H, T.BRIDGE_OAK_V] },
  feature('house', T.REVIVAL_HOUSE_ORIGIN, 'revival house'),
  feature('house', T.HERB_HOUSE_ORIGIN, 'herb house'),
  feature('house', T.FORGE_CARDAK_ORIGIN, 'forge with a cardak'),
  feature('tree', T.TREE_OF_LIFE_ORIGIN, 'tree of life'),
  feature('tree', T.SAMODIVA_GLADE_ORIGIN, 'samodiva glade'),
  feature('tree', T.MARTENITSA_OAK_ORIGIN, 'martenitsa oak'),
  feature('pine', T.SAMODIVA_BIRCH_ORIGIN, 'samodiva birch'),
  feature('pine', T.BALKAN_PINE_ORIGIN, 'Balkan pine'),
  feature('well', T.LAMIA_WELL_ORIGIN, "the Lamia's well"),
  feature('hearth', T.KUKERI_HEARTH_ORIGIN, 'kukeri hearth'),
  feature('star', T.ELBETITSA_ORIGIN, 'elbetitsa'),
  feature('star', T.RHODOPE_ROSETTE_ORIGIN, 'Rhodope rosette'),
  feature('pool', T.SPRING_POOL_ORIGIN, 'spring pool'),
  feature('wheat', T.GOLDEN_WHEAT_ORIGIN, 'golden wheat'),
  single('flowers', [T.SUNFLOWERS, T.POPPY_BUSH, T.GERANIUM_BOX], 'flowers'),
  single(
    'prop',
    [T.WINE_BARREL, T.BLACKSMITH_ANVIL, T.VILLAGE_EDICT_BOARD, T.OAK_BENCH, T.UPRIGHT_LOOM, T.BRAZIER_POST, T.OBROK_CROSS],
    'barrel, anvil, edict board, bench, loom, brazier, wayside cross',
  ),
];
