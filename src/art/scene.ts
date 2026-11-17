/**
 * The view-independent reading of a world: what is where, in terms a renderer of any kind
 * can use (terrain kinds and placed features), rather than which tile image sits in a cell.
 */
import { createSeededRng, hashString } from '../core/rng';
import type { PointOfInterest, VillageMap } from '../engine/types';
import type { Ink } from './shapes';

export type Terrain = 'ground' | 'water' | 'road' | 'dry' | 'wall' | 'bridge';
export type FeatureKind =
  | 'house'
  | 'tree'
  | 'pine'
  | 'well'
  | 'hearth'
  | 'star'
  | 'pool'
  | 'wheat'
  | 'flowers'
  | 'prop'
  // Ambient detail, added by `withAmbience` (src/art/ambient.ts) rather than by a world.
  | 'grove'
  | 'sapling'
  | 'fence'
  | 'haystack'
  | 'woodpile'
  | 'sunflower'
  | 'hen'
  | 'field'
  | 'vineyard'
  | 'reeds'
  | 'duck'
  | 'rosette';

export interface TileMeaning {
  terrain?: Terrain;
  /** Terrain to use instead where the cell cannot be walked (a ridge with open passes). */
  blockedTerrain?: Terrain;
  /** A placed object whose top-left cell this tile is, with its footprint in cells. */
  feature?: { kind: FeatureKind; w: number; h: number };
}

/** What a tile id means in a given tileset. Supplied by the world pack. */
export type TileSemantics = (tileId: number) => TileMeaning | undefined;

/**
 * Tile meanings as plain data, so they travel inside a world pack and a saved map. Each
 * entry gives one meaning to a list of tile ids. Later entries add to earlier ones, so a
 * tile can take its terrain from one entry and a feature from another.
 */
export interface TileMeaningEntry extends TileMeaning {
  tiles: number[];
  /** What the tiles are, for people reading the pack. Not used by the renderer. */
  note?: string;
}

export type TileMeaningTable = TileMeaningEntry[];

const TERRAINS: readonly Terrain[] = ['ground', 'water', 'road', 'dry', 'wall', 'bridge'];

export function semanticsFromTable(table: TileMeaningTable): TileSemantics {
  const meanings = new Map<number, TileMeaning>();
  for (const { tiles, note: _note, ...meaning } of table) {
    for (const id of tiles) meanings.set(id, { ...meanings.get(id), ...meaning });
  }
  return (tileId) => meanings.get(tileId);
}

/** Problems with a tile meaning table read from outside; an empty list means it is usable. */
export function validateTileMeanings(table: unknown): string[] {
  if (!Array.isArray(table)) return ['tileMeanings must be a list.'];
  const problems: string[] = [];
  table.forEach((entry, i) => {
    const e = entry as Partial<TileMeaningEntry> | null;
    if (!e || typeof e !== 'object') return void problems.push(`tileMeanings[${i}] is not an object.`);
    if (!Array.isArray(e.tiles) || e.tiles.some((t) => !Number.isInteger(t))) problems.push(`tileMeanings[${i}].tiles must be a list of tile ids.`);
    for (const field of ['terrain', 'blockedTerrain'] as const) {
      if (e[field] !== undefined && !TERRAINS.includes(e[field] as Terrain)) problems.push(`tileMeanings[${i}].${field} "${e[field]}" is not a terrain.`);
    }
    const f = e.feature;
    if (f !== undefined && (typeof f?.kind !== 'string' || !(f.w >= 1) || !(f.h >= 1))) problems.push(`tileMeanings[${i}].feature needs a kind and a size.`);
  });
  return problems;
}

export interface SceneFeature {
  /** Stable name for edits to refer to; generators set it, ambient features use `amb-`. */
  id?: string;
  kind: FeatureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  /** Which layer it sits on; by default the one its kind belongs to (see `layerOf`). */
  layer?: SceneLayer;
  /** A turn about the centre of its footprint, radians. */
  angle?: number;
  /** For a pattern (a dancing ground, a rosette): the pattern reference it is grown from. */
  ref?: string;
  /** For a house: which kind of building (default: the folk house with a carved gable). */
  variant?: BuildingVariant;
  /** For a house: drawn or stitched, instead of the world's own house look. */
  look?: HouseLook;
}

/**
 * How a world's houses are worked: `drawn` (the folk houses of grid worlds, the solid
 * fold-out houses of a patchwork), `stitched` (counted cross-stitch, upright as on a
 * sampler) or `stitched-turned` (counted cross-stitch laid along the street, like the drawn
 * houses).
 */
export type HouseLook = 'drawn' | 'stitched' | 'stitched-turned';

export const HOUSE_LOOKS: readonly HouseLook[] = ['drawn', 'stitched', 'stitched-turned'];

export const isStitched = (look?: HouseLook) => look === 'stitched' || look === 'stitched-turned';

/**
 * A pattern laid on the cloth with a brush: a stroke (motifs stamped along a path, or a
 * border band following it) or a fill (a half-drop lattice of motifs over the cells
 * painted). Points are in cells: the path of a stroke, the cells of a fill.
 */
export interface PatternMark {
  id: string;
  mode: 'stroke' | 'fill';
  points: Array<[number, number]>;
  /** The pattern reference it is grown from (the world's own when absent). */
  ref?: string;
  /** Size of each motif, in cells across. */
  size: number;
  /** Distance between motifs, as a multiple of their size. */
  spacing: number;
}

/** Kinds of building a house can be, besides the default folk house. */
export type BuildingVariant = 'cottage' | 'long' | 'tall' | 'barn' | SpecialBuilding;

export const BUILDING_VARIANTS: ReadonlyArray<{ id: BuildingVariant; name: string; size: [number, number] }> = [
  { id: 'cottage', name: 'cottage', size: [2, 2] },
  { id: 'long', name: 'long house', size: [3, 2] },
  { id: 'tall', name: 'tall house', size: [2, 2] },
  { id: 'barn', name: 'barn', size: [3, 2] },
  { id: 'church', name: 'church', size: [3, 3] },
  { id: 'inn', name: 'inn', size: [3, 2] },
  { id: 'smithy', name: 'smithy', size: [2, 2] },
  { id: 'bakery', name: 'bakery', size: [2, 2] },
  { id: 'mill', name: 'mill', size: [3, 2] },
];

/**
 * Layers, bottom to top, as in a tile map: the ground (terrain and plots) under flat
 * plantings and patterns, then works, buildings and animals. Each can be hidden or locked
 * in the editor. Flat layers are drawn in layer order; upright things (trees, houses,
 * animals) are drawn front to back by where they stand, so a tree can stand before a house.
 */
export type SceneLayer = 'ground' | 'patterns' | 'plantings' | 'works' | 'buildings' | 'life';

export const SCENE_LAYERS: ReadonlyArray<{ id: SceneLayer; name: string }> = [
  { id: 'ground', name: 'Ground' },
  { id: 'patterns', name: 'Patterns' },
  { id: 'plantings', name: 'Plantings' },
  { id: 'works', name: 'Works' },
  { id: 'buildings', name: 'Buildings' },
  { id: 'life', name: 'Animals' },
];

const KIND_LAYER: Record<FeatureKind, SceneLayer> = {
  star: 'patterns',
  rosette: 'patterns',
  field: 'plantings',
  vineyard: 'plantings',
  tree: 'plantings',
  pine: 'plantings',
  grove: 'plantings',
  sapling: 'plantings',
  flowers: 'plantings',
  wheat: 'plantings',
  sunflower: 'plantings',
  reeds: 'plantings',
  well: 'works',
  hearth: 'works',
  pool: 'works',
  prop: 'works',
  fence: 'works',
  haystack: 'works',
  woodpile: 'works',
  house: 'buildings',
  hen: 'life',
  duck: 'life',
};

/** Kinds that lie flat on the ground rather than standing up from it. */
export const FLAT_KINDS: ReadonlySet<FeatureKind> = new Set(['star', 'rosette', 'field', 'vineyard', 'pool']);

export function layerOf(feature: Pick<SceneFeature, 'kind' | 'layer'>): SceneLayer {
  return feature.layer ?? KIND_LAYER[feature.kind] ?? 'works';
}

export function kindsOnLayer(layer: SceneLayer, kinds: readonly FeatureKind[]): FeatureKind[] {
  return kinds.filter((k) => KIND_LAYER[k] === layer);
}

export interface SceneModel {
  width: number;
  height: number;
  /** Indexed [x][y]. */
  terrain: Terrain[][];
  features: SceneFeature[];
  landmarks: PointOfInterest[];
  /** The place name to stitch onto the cloth, if any. */
  title?: string;
  /** Ids of the pattern references the world's motifs are grown from (default: Shevitsa). */
  motifs?: string[];
  /**
   * A patchwork world: the ground as irregular patches (houses, fields, gardens, roads), in
   * the manner of a Klee village, drawn instead of the cell terrain. Points are in cells.
   */
  patches?: Patch[];
  /** The full (undrawn-in) faces of a patchwork village: inside them, gaps are streets. */
  villageOutline?: Array<Array<[number, number]>>;
  /** Bridges over a patchwork's stream. */
  bridges?: Bridge[];
  /** Which way the stream flows, radians, so its waves run one way. */
  streamFlow?: number;
  /** How the world's houses are worked (default `drawn`). */
  houseLook?: HouseLook;
  /**
   * How large houses are drawn against people, as a multiple of the old size (default 2:
   * twice as wide and tall, so a door is a person's height).
   */
  houseScale?: number;
  /** Patterns laid with the brush, on the patterns layer. */
  patternMarks?: PatternMark[];
  /** The world's own threads (see WORLD_PALETTES), used under the full-colour look. */
  palette?: string;
  /**
   * How strongly the world is drawn behind the people, 0.3 to 1 (default 1): the rest is a
   * wash of linen, so characters stay legible over a busy cloth.
   */
  backdrop?: number;
  /** One family of stitch for the whole cloth (see `src/art/stitchStyles.ts`; default mixed). */
  stitch?: 'mixed' | 'cross' | 'satin';
  /** The cloth's thread weight: one width for every stitch in the world (default 1). */
  threadWeight?: number;
  /** Wash the places people walk (streets, square, meadows) back to near-plain linen. */
  quietPaths?: boolean;
  /**
   * How things share the cloth: `overlap` (the default: trees and houses crowd and cross
   * each other) or `packed` (as in counted work, nothing on a layer touches another).
   */
  packing?: 'overlap' | 'packed';
}

/** What a plot of a patchwork village holds (`road` is kept only for older saved worlds). */
export type PatchKind =
  | 'house'
  | 'road'
  | 'square'
  | 'garden'
  | 'field'
  | 'orchard'
  | 'meadow'
  | 'water'
  | 'vineyard'
  | 'yard'
  | 'pasture'
  | 'wood';

/** Buildings with a name and a shape of their own, near the square or by the stream. */
export type SpecialBuilding = 'church' | 'inn' | 'smithy' | 'bakery' | 'mill';

/**
 * A plot of a patchwork village, seen from above: its outline (already drawn in from the
 * streets around it), what it holds, its thread, and the direction it is stitched in.
 */
export interface Patch {
  /** Stable index within its world, for hand edits. */
  id?: number;
  kind: PatchKind;
  points: Array<[number, number]>;
  ink: Ink;
  /** Direction the patch is stitched in, radians. */
  grain: number;
  seed: number;
  /** Index of the edge (from point i to i+1) that fronts the widest street. */
  front?: number;
  /** A named building standing on this plot. */
  special?: SpecialBuilding;
  /**
   * The plot's full face on the plan (before the streets are taken off) and, for each of its
   * edges, half the width of the street there (0 where it runs on into its neighbour). Kept
   * so a plot can be merged with a neighbour or split, and drawn in again.
   */
  face?: Array<[number, number]>;
  halves?: number[];
}

/** A bridge carrying a street over the stream: from a to b along the street, `half` wide. */
export interface Bridge {
  a: [number, number];
  b: [number, number];
  half: number;
}

export function buildSceneModel(map: VillageMap, semantics?: TileSemantics): SceneModel {
  const terrain: Terrain[][] = Array.from({ length: map.width }, () => Array<Terrain>(map.height).fill('ground'));
  const features: SceneFeature[] = [];
  const layers = [...map.bgTiles, ...map.objectTiles];

  if (semantics) {
    for (const layer of layers) {
      for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
          const id = layer[x]?.[y] ?? -1;
          if (id < 0) continue;
          const meaning = semantics(id);
          if (!meaning) continue;
          const blocked = map.collisionGrid[x]?.[y] === true;
          const kind = (blocked && meaning.blockedTerrain) || meaning.terrain;
          if (kind && kind !== 'ground') terrain[x][y] = kind;
          if (meaning.feature) {
            features.push({ ...meaning.feature, x, y, seed: hashString(`${meaning.feature.kind}:${x}:${y}`) });
          }
        }
      }
    }
  } else {
    // With no tile meanings, what is known is where one cannot walk and where the named
    // places are. That is enough for a legible map: walls as stitched bands, a star at
    // each landmark.
    for (let x = 0; x < map.width; x++) {
      for (let y = 0; y < map.height; y++) {
        if (map.collisionGrid[x]?.[y]) terrain[x][y] = 'wall';
      }
    }
    for (const poi of map.pointsOfInterest ?? []) {
      const x = Math.max(0, Math.min(map.width - 2, Math.round(poi.x) - 1));
      const y = Math.max(0, Math.min(map.height - 2, Math.round(poi.y) - 1));
      features.push({ kind: 'star', x, y, w: 2, h: 2, seed: hashString(`poi:${poi.id}`) });
    }
  }
  features.sort((a, b) => a.y + a.h - (b.y + b.h));
  const title = map.name.split(/[:(]/)[0].trim();
  return { width: map.width, height: map.height, terrain, features, landmarks: map.pointsOfInterest ?? [], title };
}

/** A stable random stream for one cell, so scattered detail does not move between redraws. */
export function cellRng(x: number, y: number, salt = 0) {
  return createSeededRng((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791));
}
