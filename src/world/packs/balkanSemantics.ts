import type { FeatureKind, Terrain, TileMeaning, TileSemantics } from '../../art/scene';
import { BALKAN_TILES, BALKAN_TILESET_COLS } from '../../engine/balkanTileset';

type Origin = { col: number; row: number; w: number; h: number };

const meanings = new Map<number, TileMeaning>();

function terrain(kind: Terrain, ...ids: number[]) {
  for (const id of ids) meanings.set(id, { ...meanings.get(id), terrain: kind });
}

function wangSet(kind: Terrain, base: number) {
  // Index 0 of a Wang set is "nothing set", so it carries no terrain.
  for (let i = 1; i < 16; i++) terrain(kind, base + i);
}

function feature(kind: FeatureKind, origin: Origin) {
  const id = origin.row * BALKAN_TILESET_COLS + origin.col;
  meanings.set(id, { ...meanings.get(id), feature: { kind, w: origin.w, h: origin.h } });
}

function single(kind: FeatureKind, id: number) {
  meanings.set(id, { ...meanings.get(id), feature: { kind, w: 1, h: 1 } });
}

const T = BALKAN_TILES;

terrain('water', T.WATER_BROOK, T.WATER_SHIMMER, T.WATER_SILT, T.BROOK_INT_ALT1, T.BROOK_INT_ALT2, T.BROOK_INT_ALT3);
wangSet('water', T.WANG_BROOK_BASE);
terrain(
  'road',
  T.ROAD_KHORO_H, T.ROAD_KHORO_V, T.ROAD_KHORO_CROSS,
  T.ROAD_H_ALT1, T.ROAD_H_ALT2, T.ROAD_H_ALT3, T.ROAD_H_ALT4,
  T.ROAD_V_ALT1, T.ROAD_V_ALT2, T.ROAD_V_ALT3, T.ROAD_V_ALT4,
  T.PLAZA_LINEN_STONE, T.PLAZA_STONE_ALT1, T.PLAZA_STONE_ALT2, T.PLAZA_STONE_ALT3, T.PLAZA_STONE_ALT4,
);
wangSet('road', T.WANG_ROAD_BASE);
terrain('dry', T.DROUGHT_CLAY, T.SCORCHED_COBBLE, T.DROUGHT_INT_ALT1, T.DROUGHT_INT_ALT2, T.DROUGHT_INT_ALT3, T.DROUGHT_INT_ALT4);
wangSet('dry', T.WANG_DROUGHT_BASE);
terrain('wall', T.FENCE_WATTLE_H, T.FENCE_WATTLE_V);
wangSet('wall', T.WANG_WALL_BASE);
terrain('bridge', T.BRIDGE_OAK_H, T.BRIDGE_OAK_V);

feature('house', T.REVIVAL_HOUSE_ORIGIN);
feature('house', T.HERB_HOUSE_ORIGIN);
feature('house', T.FORGE_CARDAK_ORIGIN);
feature('tree', T.TREE_OF_LIFE_ORIGIN);
feature('tree', T.SAMODIVA_GLADE_ORIGIN);
feature('tree', T.MARTENITSA_OAK_ORIGIN);
feature('pine', T.SAMODIVA_BIRCH_ORIGIN);
feature('pine', T.BALKAN_PINE_ORIGIN);
feature('well', T.LAMIA_WELL_ORIGIN);
feature('hearth', T.KUKERI_HEARTH_ORIGIN);
feature('star', T.ELBETITSA_ORIGIN);
feature('star', T.RHODOPE_ROSETTE_ORIGIN);
feature('pool', T.SPRING_POOL_ORIGIN);
feature('wheat', T.GOLDEN_WHEAT_ORIGIN);
single('flowers', T.SUNFLOWERS);
single('flowers', T.POPPY_BUSH);
single('flowers', T.GERANIUM_BOX);
for (const id of [T.WINE_BARREL, T.BLACKSMITH_ANVIL, T.VILLAGE_EDICT_BOARD, T.OAK_BENCH, T.UPRIGHT_LOOM, T.BRAZIER_POST, T.OBROK_CROSS]) {
  single('prop', id);
}

/** What each tile of the Balkan myth tileset means, independent of how it is drawn. */
export const balkanTileSemantics: TileSemantics = (tileId) => meanings.get(tileId);
