/**
 * A world authored as a place: a recipe (a generator, its parameters and a seed) plus the
 * hand edits made on top of it. Baking runs the generator, applies the edits and returns
 * the SceneModel the art looks draw; `mapFromScene` derives everything the simulation
 * needs (where people can walk, the named places, where they start) from that model.
 *
 * Edits are kept apart from the recipe, so changing a parameter or the seed never throws
 * away hand work. An edit that no longer makes sense in the new world (it moves a house
 * the new seed did not build) is skipped and reported, not lost.
 */
import { withAmbience } from '../art/ambient';
import type { BuildingVariant, FeatureKind, HouseLook, PatchKind, PatternMark, SceneFeature, SceneLayer, SceneModel, Terrain } from '../art/scene';
import { mergePlots, plotInk, pointInPolygon, rasterizePatches, splitPlot } from './patchworkVillage';
import { hashString } from '../core/rng';
import type { PointOfInterest, SpawnPoint, VillageMap } from '../engine/types';
import { findGenerator, type GeneratedWorld, type SceneParams } from './sceneGenerators';

export interface SceneRecipe {
  generator: string;
  params: SceneParams;
  seed: number;
}

export type SceneEdit =
  | { op: 'terrain'; cells: Array<[number, number]>; terrain: Terrain }
  | { op: 'place'; feature: PlacedFeature }
  /** Many features at once (a scattered grove, a flock), as one step. */
  | { op: 'scatter'; features: PlacedFeature[] }
  | { op: 'move'; id: string; x: number; y: number }
  /** Turn a feature about the centre of its footprint (radians, absolute). */
  | { op: 'rotate'; id: string; angle: number }
  /** Move a feature to another layer. */
  | { op: 'layer'; id: string; layer: SceneLayer }
  | { op: 'remove'; id: string }
  /** Many features cut away at once (an erase brush stroke), as one step. */
  | { op: 'removeMany'; ids: string[] }
  | { op: 'landmark'; landmark: PointOfInterest }
  | { op: 'removeLandmark'; id: string }
  | { op: 'spawn'; spawn: SpawnPoint }
  | { op: 'removeSpawn'; id: string }
  | { op: 'title'; title: string }
  /** How the world's houses are worked: drawn or stitched. */
  | { op: 'houseLook'; look: HouseLook }
  /** The world's own threads (an id from WORLD_PALETTES). */
  | { op: 'palette'; palette: string }
  /** How strongly the world is drawn behind the people, and whether the paths are quiet. */
  | { op: 'backdrop'; strength?: number; quietPaths?: boolean }
  /** A pattern stroke or fill laid with the brush. */
  | { op: 'patternMark'; mark: PatternMark }
  /** In a patchwork village: what a plot holds (house, garden, field, …). */
  | { op: 'plot'; id: number; kind: PatchKind }
  /** In a patchwork village: two neighbouring plots made one (the street between goes). */
  | { op: 'mergePlots'; a: number; b: number }
  /** In a patchwork village: a plot cut in two by a new lane through (x, y), across its front. */
  | { op: 'splitPlot'; id: number; x: number; y: number };

/** Ids the two halves of a split plot take: stable for the edit that made them. */
export function splitIds(editIndex: number): [number, number] {
  return [100000 + editIndex * 2, 100001 + editIndex * 2];
}

export interface PlacedFeature {
  id: string;
  kind: FeatureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  layer?: SceneLayer;
  angle?: number;
  ref?: string;
  variant?: BuildingVariant;
  look?: HouseLook;
}

export interface WorldScene {
  recipe: SceneRecipe;
  edits: SceneEdit[];
  /**
   * A frozen generator output, for worlds that cannot be regenerated from parameters (a
   * tile map read once through its meanings). When present the recipe is not run.
   */
  base?: GeneratedWorld;
}

export interface BakedScene {
  model: SceneModel;
  spawns: SpawnPoint[];
  /** Cells blocked before any edit, when the source world authored its own walkability. */
  baseBlocked?: boolean[][];
  /** Cells an edit touched: their walkability is worked out from the scene, never the base. */
  touched: Set<number>;
  /** Indexes into `edits` that could not be applied, with the reason. */
  skipped: Array<{ index: number; reason: string }>;
}

const cellKey = (x: number, y: number) => x * 100003 + y;

function touchRect(touched: Set<number>, x: number, y: number, w: number, h: number) {
  for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) touched.add(cellKey(i, j));
}

const bakeCache = new WeakMap<WorldScene, BakedScene>();

/**
 * Runs the recipe (or reads the frozen base), then applies the edits in order. Scenes are
 * never changed in place (every command makes a new one), so a bake is cached per scene.
 * Treat the result as read-only.
 */
export function bakeScene(scene: WorldScene): BakedScene {
  const hit = bakeCache.get(scene);
  if (hit) return hit;
  const baked = bakeSceneUncached(scene);
  bakeCache.set(scene, baked);
  return baked;
}

function bakeSceneUncached(scene: WorldScene): BakedScene {
  const generated = scene.base ?? runRecipe(scene.recipe);
  const model: SceneModel = {
    ...generated.model,
    terrain: generated.model.terrain.map((col) => [...col]),
    features: generated.model.features.map((f) => ({ ...f })),
    landmarks: generated.model.landmarks.map((l) => ({ ...l })),
  };
  let spawns = generated.spawns.map((s) => ({ ...s }));
  const touched = new Set<number>();
  const skipped: BakedScene['skipped'] = [];
  const lateRemovals: Array<{ index: number; id: string }> = [];
  let plotsChanged = false;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < model.width && y < model.height;

  scene.edits.forEach((edit, index) => {
    switch (edit.op) {
      case 'terrain':
        for (const [x, y] of edit.cells) {
          if (!inside(x, y)) continue;
          model.terrain[x][y] = edit.terrain;
          touched.add(cellKey(x, y));
        }
        return;
      case 'place':
      case 'scatter': {
        const list = edit.op === 'place' ? [edit.feature] : edit.features;
        const placed = list.filter((f) => inside(f.x, f.y));
        if (placed.length === 0) return void skipped.push({ index, reason: `${list[0]?.kind ?? 'it'} is outside the world` });
        const ids = new Set(placed.map((f) => f.id));
        model.features = model.features.filter((g) => !g.id || !ids.has(g.id));
        for (const f of placed) {
          model.features.push({ ...f, seed: hashString(`${f.kind}:${f.id}`) });
          touchRect(touched, f.x, f.y, f.w, f.h);
        }
        return;
      }
      case 'rotate':
      case 'layer': {
        const f = model.features.find((g) => g.id === edit.id);
        if (!f) return void skipped.push({ index, reason: `nothing called ${edit.id} to ${edit.op === 'rotate' ? 'turn' : 'move'}` });
        if (edit.op === 'rotate') f.angle = edit.angle;
        else f.layer = edit.layer;
        return;
      }
      case 'move': {
        const f = model.features.find((g) => g.id === edit.id);
        if (!f) return void skipped.push({ index, reason: `nothing called ${edit.id} to move` });
        if (!inside(edit.x, edit.y)) return void skipped.push({ index, reason: `${edit.id} would leave the world` });
        touchRect(touched, f.x, f.y, f.w, f.h);
        f.x = edit.x;
        f.y = edit.y;
        touchRect(touched, f.x, f.y, f.w, f.h);
        return;
      }
      case 'houseLook':
        model.houseLook = edit.look;
        return;
      case 'palette':
        model.palette = edit.palette;
        return;
      case 'backdrop':
        if (edit.strength !== undefined) model.backdrop = edit.strength;
        if (edit.quietPaths !== undefined) model.quietPaths = edit.quietPaths;
        return;
      case 'patternMark':
        model.patternMarks = [...(model.patternMarks ?? []).filter((m) => m.id !== edit.mark.id), { ...edit.mark, points: edit.mark.points.map(([x, y]) => [x, y]) }];
        return;
      case 'removeMany': {
        const ids = new Set(edit.ids);
        if (model.patternMarks) model.patternMarks = model.patternMarks.filter((m) => !ids.has(m.id));
        for (const f of model.features) if (f.id && ids.has(f.id)) touchRect(touched, f.x, f.y, f.w, f.h);
        for (const id of edit.ids) if (id.startsWith('amb-') && !model.features.some((f) => f.id === id)) lateRemovals.push({ index, id });
        model.features = model.features.filter((f) => !f.id || !ids.has(f.id));
        return;
      }
      case 'remove': {
        const f = model.features.find((g) => g.id === edit.id);
        if (!f && model.patternMarks?.some((m) => m.id === edit.id)) {
          model.patternMarks = model.patternMarks.filter((m) => m.id !== edit.id);
          return;
        }
        if (!f) {
          // Ambient detail is only added after the edits; try again once it exists.
          if (edit.id.startsWith('amb-')) lateRemovals.push({ index, id: edit.id });
          else skipped.push({ index, reason: `nothing called ${edit.id} to remove` });
          return;
        }
        touchRect(touched, f.x, f.y, f.w, f.h);
        model.features = model.features.filter((g) => g !== f);
        return;
      }
      case 'landmark':
        if (!inside(edit.landmark.x, edit.landmark.y)) return void skipped.push({ index, reason: `${edit.landmark.label} is outside the world` });
        model.landmarks = [...model.landmarks.filter((l) => l.id !== edit.landmark.id), { ...edit.landmark }];
        return;
      case 'removeLandmark':
        if (!model.landmarks.some((l) => l.id === edit.id)) return void skipped.push({ index, reason: `no landmark ${edit.id}` });
        model.landmarks = model.landmarks.filter((l) => l.id !== edit.id);
        return;
      case 'spawn':
        if (!inside(edit.spawn.x, edit.spawn.y)) return void skipped.push({ index, reason: `${edit.spawn.label} is outside the world` });
        spawns = [...spawns.filter((s) => s.id !== edit.spawn.id), { ...edit.spawn }];
        return;
      case 'removeSpawn':
        if (!spawns.some((s) => s.id === edit.id)) return void skipped.push({ index, reason: `no spawn point ${edit.id}` });
        spawns = spawns.filter((s) => s.id !== edit.id);
        return;
      case 'title':
        model.title = edit.title;
        return;
      case 'plot': {
        const i = model.patches?.findIndex((p) => p.id === edit.id) ?? -1;
        if (i < 0 || !model.patches) return void skipped.push({ index, reason: `no plot ${edit.id}` });
        const plot = model.patches[i];
        model.patches = model.patches.map((p, k) => (k === i ? { ...plot, kind: edit.kind, ink: plotInk(edit.kind, plot.seed) } : p));
        plotsChanged = true;
        return;
      }
      case 'mergePlots': {
        const a = model.patches?.find((p) => p.id === edit.a);
        const b = model.patches?.find((p) => p.id === edit.b);
        if (!a || !b || a === b) return void skipped.push({ index, reason: `no plots ${edit.a} and ${edit.b} to merge` });
        const merged = mergePlots(a, b);
        if (!merged) return void skipped.push({ index, reason: `plots ${edit.a} and ${edit.b} do not share a whole edge` });
        model.patches = model.patches!.filter((p) => p !== b).map((p) => (p === a ? merged : p));
        plotsChanged = true;
        return;
      }
      case 'splitPlot': {
        const plot = model.patches?.find((p) => p.id === edit.id);
        if (!plot) return void skipped.push({ index, reason: `no plot ${edit.id} to split` });
        const halves = splitPlot(plot, [edit.x, edit.y], splitIds(index));
        if (!halves) return void skipped.push({ index, reason: `plot ${edit.id} is too small to split there` });
        model.patches = model.patches!.flatMap((p) => (p === plot ? halves : [p]));
        plotsChanged = true;
        return;
      }
    }
  });
  // Plots changed: where people can walk follows what the plots now hold.
  if (plotsChanged && model.patches) {
    const outline = model.villageOutline ?? [];
    model.terrain = rasterizePatches(model.patches, model.width, model.height, (x, y) => outline.some((poly) => pointInPolygon([x, y], poly)));
  }

  model.features.sort((a, b) => a.y + a.h - (b.y + b.h));
  const seed = scene.base ? hashString(model.title ?? 'world') : scene.recipe.seed;
  // A patchwork world is already a full quilt; ambient detail would only crowd it.
  let ambient = model.patches ? model : withAmbience(model, seed);
  for (const { index, id } of lateRemovals) {
    if (!ambient.features.some((f) => f.id === id)) skipped.push({ index, reason: `nothing called ${id} to remove` });
    ambient = { ...ambient, features: ambient.features.filter((f) => f.id !== id) };
  }
  return { model: ambient, spawns, baseBlocked: generated.blocked, touched, skipped };
}

function runRecipe(recipe: SceneRecipe): GeneratedWorld {
  const generator = findGenerator(recipe.generator);
  if (!generator) throw new Error(`Unknown world generator "${recipe.generator}".`);
  return generator.generate(generator.resolveParams(recipe.params), recipe.seed);
}

const BLOCKING_TERRAIN: ReadonlySet<Terrain> = new Set(['water', 'wall']);

/**
 * Which cells of a feature's footprint stop a walker. Buildings and wells block all but
 * their top row (so people pass behind a roof); trees only their trunk; flat things such
 * as fields, flowers and dancing grounds, and all ambient detail, block nothing.
 */
function blockedCells(f: SceneFeature): Array<[number, number]> {
  if (f.id?.startsWith('amb-')) return [];
  const cells: Array<[number, number]> = [];
  const rect = (x0: number, y0: number, w: number, h: number) => {
    for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) cells.push([x, y]);
  };
  switch (f.kind) {
    case 'house':
    case 'well':
    case 'hearth':
    case 'pool':
      rect(f.x, f.y + (f.h > 1 ? 1 : 0), f.w, Math.max(1, f.h - 1));
      break;
    case 'tree':
    case 'pine':
    case 'grove':
    case 'sapling':
      rect(f.x, f.y + f.h - 1, f.w, 1);
      break;
    case 'prop':
    case 'haystack':
    case 'woodpile':
      rect(f.x, f.y, f.w, f.h);
      break;
    default:
      break;
  }
  return cells;
}

/** Marks open cells cut off from the largest open region as blocked, so no one is stranded. */
function closePockets(grid: boolean[][]) {
  const w = grid.length;
  const h = grid[0]?.length ?? 0;
  const region = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  for (let sx = 0; sx < w; sx++) {
    for (let sy = 0; sy < h; sy++) {
      if (grid[sx][sy] || region[sx * h + sy] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [[sx, sy]];
      region[sx * h + sy] = id;
      while (stack.length) {
        const [x, y] = stack.pop()!;
        size++;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || grid[nx][ny] || region[nx * h + ny] >= 0) continue;
          region[nx * h + ny] = id;
          stack.push([nx, ny]);
        }
      }
      sizes.push(size);
    }
  }
  if (sizes.length < 2) return;
  const main = sizes.indexOf(Math.max(...sizes));
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (!grid[x][y] && region[x * h + y] !== main) grid[x][y] = true;
}

/** Where people cannot walk, worked out from the scene (and the base grid where untouched). */
export function walkabilityFor(baked: BakedScene): boolean[][] {
  const { model, baseBlocked, touched } = baked;
  const grid: boolean[][] = Array.from({ length: model.width }, (_, x) =>
    Array.from({ length: model.height }, (_, y) => BLOCKING_TERRAIN.has(model.terrain[x][y])),
  );
  for (const f of model.features) {
    for (const [x, y] of blockedCells(f)) if (grid[x]?.[y] !== undefined) grid[x][y] = true;
  }
  if (baseBlocked) {
    for (let x = 0; x < model.width; x++) {
      for (let y = 0; y < model.height; y++) {
        if (!touched.has(cellKey(x, y)) && baseBlocked[x]?.[y] !== undefined) grid[x][y] = baseBlocked[x][y];
      }
    }
  } else {
    closePockets(grid);
  }
  return grid;
}

function nearestOpen(grid: boolean[][], x: number, y: number): [number, number] {
  const w = grid.length;
  const h = grid[0]?.length ?? 0;
  const sx = Math.max(0, Math.min(w - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(y)));
  for (let r = 0; r < Math.max(w, h); r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = sx + dx;
        const ny = sy + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && !grid[nx][ny]) return [nx, ny];
      }
    }
  }
  return [sx, sy];
}

const TILE_DIM = 32;

/**
 * A playable map for a scene: size, walkability, named places and start points, with the
 * scene kept on the map so it can be redrawn and edited. It carries no tiles.
 */
export function mapFromScene(scene: WorldScene, name?: string): VillageMap {
  const baked = bakeScene(scene);
  const { model } = baked;
  const collisionGrid = walkabilityFor(baked);
  const empty = () => Array.from({ length: model.width }, () => Array<number>(model.height).fill(-1));
  // Landmarks and spawns stand on open ground, so a character can reach them.
  const pointsOfInterest = model.landmarks.map((l) => {
    if (!collisionGrid[l.x]?.[l.y]) return l;
    const [x, y] = nearestOpen(collisionGrid, l.x, l.y);
    return { ...l, x, y };
  });
  const spawnSource = baked.spawns.length > 0 ? baked.spawns : pointsOfInterest.map((l) => ({ id: `spawn-${l.id}`, label: l.label, x: l.x, y: l.y }));
  const spawnPoints = (spawnSource.length > 0 ? spawnSource : [{ id: 'spawn-centre', label: 'The middle', x: model.width / 2, y: model.height / 2 }]).map(
    (s) => {
      const [x, y] = nearestOpen(collisionGrid, s.x, s.y);
      return { ...s, x, y };
    },
  );
  return {
    name: name ?? model.title ?? 'A procedural world',
    tileDim: TILE_DIM,
    width: model.width,
    height: model.height,
    tileSetUrl: '',
    tileSetDimX: 0,
    tileSetDimY: 0,
    bgTiles: [empty()],
    objectTiles: [empty()],
    collisionGrid,
    animatedSprites: [],
    spawnPoints,
    pointsOfInterest,
    scene,
  };
}
