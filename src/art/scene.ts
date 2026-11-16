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
}

export type PatchKind = 'house' | 'road' | 'square' | 'garden' | 'field' | 'orchard' | 'meadow' | 'water' | 'vineyard';

export interface Patch {
  kind: PatchKind;
  points: Array<[number, number]>;
  ink: Ink;
  /** Direction the patch is stitched in, radians. */
  grain: number;
  seed: number;
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
