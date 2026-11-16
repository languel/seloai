/**
 * The view-independent reading of a world: what is where, in terms a renderer of any kind
 * can use (terrain kinds and placed features), rather than which tile image sits in a cell.
 */
import { createSeededRng, hashString } from '../core/rng';
import type { PointOfInterest, VillageMap } from '../engine/types';

export type Terrain = 'ground' | 'water' | 'road' | 'dry' | 'wall' | 'bridge';
export type FeatureKind = 'house' | 'tree' | 'pine' | 'well' | 'hearth' | 'star' | 'pool' | 'wheat' | 'flowers' | 'prop';

export interface TileMeaning {
  terrain?: Terrain;
  /** A placed object whose top-left cell this tile is, with its footprint in cells. */
  feature?: { kind: FeatureKind; w: number; h: number };
}

/** What a tile id means in a given tileset. Supplied by the world pack. */
export type TileSemantics = (tileId: number) => TileMeaning | undefined;

export interface SceneFeature {
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
          if (meaning.terrain && meaning.terrain !== 'ground') terrain[x][y] = meaning.terrain;
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
  return { width: map.width, height: map.height, terrain, features, landmarks: map.pointsOfInterest ?? [] };
}

/** A stable random stream for one cell, so scattered detail does not move between redraws. */
export function cellRng(x: number, y: number, salt = 0) {
  return createSeededRng((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791));
}
