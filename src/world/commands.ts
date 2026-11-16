import { applyMacroStampToMap } from '../engine/tapestrySampler';
import type {
  PointOfInterest,
  SpawnPoint,
  TileGrid,
  TileMacroStamp,
  VillageMap,
  VillagerConfig,
} from '../engine/types';
import { paintWangCornerCell, paintWangEdgeCell } from '../engine/wangTiling';
import type { WorldDocument } from './document';
import { findGenerator, generatedFromTileMap, type SceneParams } from './sceneGenerators';
import { mapFromScene, type SceneEdit, type SceneRecipe, type WorldScene } from './worldScene';
import type { FeatureKind, Terrain } from '../art/scene';
import type { WorldContext } from './worldContext';

export type MapLayerId = 'bg0' | 'bg1' | 'obj0' | 'obj1';
export const MAP_LAYER_IDS: readonly MapLayerId[] = ['bg0', 'bg1', 'obj0', 'obj1'];

/**
 * Every edit to a world is one of these plain, serialisable commands. The interface and
 * agent tools both produce them, and `applyCommand` is the only code that performs them.
 */
export type WorldCommand =
  | { type: 'map.replace'; map: VillageMap }
  | { type: 'map.rename'; name: string }
  | { type: 'map.resize'; width: number; height: number; fillTile?: number }
  | { type: 'map.setTiles'; layer: MapLayerId; cells: Array<{ x: number; y: number; tile: number }> }
  | { type: 'map.fillRect'; layer: MapLayerId; x: number; y: number; width: number; height: number; tile: number }
  | { type: 'map.floodFill'; layer: MapLayerId; x: number; y: number; tile: number }
  | { type: 'map.setCollision'; cells: Array<{ x: number; y: number; blocked: boolean }> }
  | { type: 'map.collisionRect'; x: number; y: number; width: number; height: number; blocked: boolean }
  | { type: 'map.placeStamp'; stampId: string; x: number; y: number; layer?: MapLayerId; blocksMovement?: boolean }
  | {
      type: 'map.paintWang';
      kind: 'edge' | 'corner';
      layer: MapLayerId;
      /** First of the 16 consecutive tiles that make up the Wang set. */
      baseTileId: number;
      cells: Array<{ x: number; y: number }>;
      erase?: boolean;
      /** Tile written where the set is absent (default: empty). */
      emptyTileId?: number;
    }
  | { type: 'map.upsertPoi'; poi: PointOfInterest }
  | { type: 'map.removePoi'; id: string }
  | { type: 'map.upsertSpawn'; spawn: SpawnPoint }
  | { type: 'map.removeSpawn'; id: string }
  | { type: 'map.upsertStamp'; stamp: TileMacroStamp }
  | { type: 'map.removeStamp'; id: string }
  /** Make a new world from a generator. Replaces the map; the cast stays. */
  | { type: 'scene.create'; generator: string; params?: SceneParams; seed?: number; name?: string }
  /** Turn the current tile map into a scene (frozen as it is), so it can be edited as a place. */
  | { type: 'scene.fromTiles' }
  /** Change the generator, its parameters or the seed. Hand edits are kept. */
  | { type: 'scene.setRecipe'; generator?: string; params?: SceneParams; seed?: number }
  /** Add one hand edit on top of the generated world. */
  | { type: 'scene.edit'; edit: SceneEdit }
  | { type: 'scene.removeEdit'; index: number }
  | { type: 'scene.clearEdits' }
  | { type: 'cast.replace'; cast: VillagerConfig[] }
  | { type: 'cast.upsert'; member: VillagerConfig }
  | { type: 'cast.update'; id: string; patch: Partial<VillagerConfig> }
  | { type: 'cast.remove'; id: string }
  | { type: 'context.update'; patch: Partial<WorldContext> };

export type WorldCommandType = WorldCommand['type'];

export class WorldCommandError extends Error {}

function fail(message: string): never {
  throw new WorldCommandError(message);
}

function requireInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a number.`);
  return Math.round(value as number);
}

function inBounds(map: VillageMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

function emptyGrid(width: number, height: number, fill: number): TileGrid {
  return Array.from({ length: width }, () => Array<number>(height).fill(fill));
}

/** The four layer grids, padded so every map has all four. */
function layerGrids(map: VillageMap): Record<MapLayerId, TileGrid> {
  return {
    bg0: map.bgTiles[0] ?? emptyGrid(map.width, map.height, -1),
    bg1: map.bgTiles[1] ?? emptyGrid(map.width, map.height, -1),
    obj0: map.objectTiles[0] ?? emptyGrid(map.width, map.height, -1),
    obj1: map.objectTiles[1] ?? emptyGrid(map.width, map.height, -1),
  };
}

/** Returns a map with one layer replaced by an edited copy; other layers are shared. */
function editLayer(map: VillageMap, layer: MapLayerId, edit: (grid: TileGrid) => void): VillageMap {
  if (!MAP_LAYER_IDS.includes(layer)) fail(`Unknown layer "${String(layer)}".`);
  const grids = layerGrids(map);
  const copy = grids[layer].map((column) => [...column]);
  edit(copy);
  grids[layer] = copy;
  return { ...map, bgTiles: [grids.bg0, grids.bg1], objectTiles: [grids.obj0, grids.obj1] };
}

function editCollision(map: VillageMap, edit: (grid: boolean[][]) => void): VillageMap {
  const copy = Array.from({ length: map.width }, (_, x) =>
    Array.from({ length: map.height }, (_, y) => map.collisionGrid[x]?.[y] ?? false),
  );
  edit(copy);
  return { ...map, collisionGrid: copy };
}

function upsertById<T extends { id: string }>(list: T[] | undefined, item: T): T[] {
  const current = list ?? [];
  if (!item?.id) fail('An id is required.');
  return current.some((entry) => entry.id === item.id)
    ? current.map((entry) => (entry.id === item.id ? item : entry))
    : [...current, item];
}

function removeById<T extends { id: string }>(list: T[] | undefined, id: string, label: string): T[] {
  const current = list ?? [];
  if (!current.some((entry) => entry.id === id)) fail(`No ${label} with id "${id}".`);
  return current.filter((entry) => entry.id !== id);
}

function requirePlacement(map: VillageMap, x: number, y: number, label: string) {
  if (!inBounds(map, Math.round(x), Math.round(y))) {
    fail(`${label} at (${x}, ${y}) is outside the ${map.width}×${map.height} map.`);
  }
}

function applyMapCommand(map: VillageMap, command: Extract<WorldCommand, { type: `map.${string}` }>): VillageMap {
  switch (command.type) {
    case 'map.replace': {
      const next = command.map;
      if (!next || !Array.isArray(next.bgTiles) || typeof next.width !== 'number') fail('map is malformed.');
      return next;
    }
    case 'map.rename': {
      const name = String(command.name ?? '').trim();
      if (!name) fail('name must not be empty.');
      return { ...map, name };
    }
    case 'map.resize': {
      const width = requireInt(command.width, 'width');
      const height = requireInt(command.height, 'height');
      if (width < 4 || height < 4 || width > 256 || height > 256) fail('width and height must be between 4 and 256.');
      const fillTile = command.fillTile ?? 0;
      const grids = layerGrids(map);
      const resize = (grid: TileGrid, fill: number): TileGrid =>
        Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) => grid[x]?.[y] ?? fill));
      return {
        ...map,
        width,
        height,
        bgTiles: [resize(grids.bg0, fillTile), resize(grids.bg1, -1)],
        objectTiles: [resize(grids.obj0, -1), resize(grids.obj1, -1)],
        collisionGrid: Array.from({ length: width }, (_, x) =>
          Array.from({ length: height }, (_, y) => map.collisionGrid[x]?.[y] ?? false),
        ),
        spawnPoints: map.spawnPoints.filter((p) => p.x < width && p.y < height),
        pointsOfInterest: (map.pointsOfInterest ?? []).filter((p) => p.x < width && p.y < height),
      };
    }
    case 'map.setTiles':
      return editLayer(map, command.layer, (grid) => {
        for (const cell of command.cells ?? []) {
          const x = requireInt(cell.x, 'cell.x');
          const y = requireInt(cell.y, 'cell.y');
          if (inBounds(map, x, y)) grid[x][y] = requireInt(cell.tile, 'cell.tile');
        }
      });
    case 'map.fillRect': {
      const tile = requireInt(command.tile, 'tile');
      return editLayer(map, command.layer, (grid) => {
        for (let x = Math.max(0, command.x); x < Math.min(map.width, command.x + command.width); x++) {
          for (let y = Math.max(0, command.y); y < Math.min(map.height, command.y + command.height); y++) {
            grid[x][y] = tile;
          }
        }
      });
    }
    case 'map.floodFill': {
      const startX = requireInt(command.x, 'x');
      const startY = requireInt(command.y, 'y');
      requirePlacement(map, startX, startY, 'Fill origin');
      const tile = requireInt(command.tile, 'tile');
      return editLayer(map, command.layer, (grid) => {
        const target = grid[startX][startY];
        if (target === tile) return;
        const queue: Array<[number, number]> = [[startX, startY]];
        while (queue.length > 0) {
          const [x, y] = queue.pop()!;
          if (!inBounds(map, x, y) || grid[x][y] !== target) continue;
          grid[x][y] = tile;
          queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
      });
    }
    case 'map.setCollision':
      return editCollision(map, (grid) => {
        for (const cell of command.cells ?? []) {
          const x = requireInt(cell.x, 'cell.x');
          const y = requireInt(cell.y, 'cell.y');
          if (inBounds(map, x, y)) grid[x][y] = Boolean(cell.blocked);
        }
      });
    case 'map.collisionRect':
      return editCollision(map, (grid) => {
        for (let x = Math.max(0, command.x); x < Math.min(map.width, command.x + command.width); x++) {
          for (let y = Math.max(0, command.y); y < Math.min(map.height, command.y + command.height); y++) {
            grid[x][y] = Boolean(command.blocked);
          }
        }
      });
    case 'map.placeStamp': {
      const stamp = (map.stamps ?? []).find((s) => s.id === command.stampId);
      if (!stamp) fail(`No stamp with id "${command.stampId}".`);
      requirePlacement(map, command.x, command.y, 'Stamp');
      return applyMacroStampToMap(map, stamp, command.x, command.y, command.layer, command.blocksMovement);
    }
    case 'map.paintWang': {
      const base = requireInt(command.baseTileId, 'baseTileId');
      const empty = command.emptyTileId ?? -1;
      const paint = command.kind === 'corner' ? paintWangCornerCell : paintWangEdgeCell;
      return editLayer(map, command.layer, (grid) => {
        for (const cell of command.cells ?? []) {
          paint(grid, requireInt(cell.x, 'cell.x'), requireInt(cell.y, 'cell.y'), !command.erase, base, empty);
        }
      });
    }
    case 'map.upsertPoi':
      requirePlacement(map, command.poi?.x, command.poi?.y, 'Point of interest');
      return { ...map, pointsOfInterest: upsertById(map.pointsOfInterest, command.poi) };
    case 'map.removePoi':
      return { ...map, pointsOfInterest: removeById(map.pointsOfInterest, command.id, 'point of interest') };
    case 'map.upsertSpawn':
      requirePlacement(map, command.spawn?.x, command.spawn?.y, 'Spawn point');
      return { ...map, spawnPoints: upsertById(map.spawnPoints, command.spawn) };
    case 'map.removeSpawn':
      if (map.spawnPoints.length <= 1) fail('A map needs at least one spawn point.');
      return { ...map, spawnPoints: removeById(map.spawnPoints, command.id, 'spawn point') };
    case 'map.upsertStamp': {
      const stamp = command.stamp;
      if (!stamp || stamp.tiles?.length !== stamp.width * stamp.height) fail('stamp.tiles must hold width × height entries.');
      return { ...map, stamps: upsertById(map.stamps, stamp) };
    }
    case 'map.removeStamp':
      return { ...map, stamps: removeById(map.stamps, command.id, 'stamp') };
  }
}

const TERRAINS: readonly Terrain[] = ['ground', 'water', 'road', 'dry', 'wall', 'bridge'];

function requireScene(map: VillageMap): WorldScene {
  if (!map.scene) fail('This world is a tile map, not a scene. Run scene.fromTiles first, or scene.create.');
  return map.scene;
}

function rederive(map: VillageMap, scene: WorldScene): VillageMap {
  const titled = [...scene.edits].reverse().find((e): e is Extract<SceneEdit, { op: 'title' }> => e.op === 'title');
  try {
    return mapFromScene(scene, titled?.title ?? map.name);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function checkEdit(edit: SceneEdit) {
  if (!edit || typeof edit.op !== 'string') fail('A scene edit needs an op.');
  switch (edit.op) {
    case 'terrain':
      if (!TERRAINS.includes(edit.terrain)) fail(`"${edit.terrain}" is not a terrain (${TERRAINS.join(', ')}).`);
      if (!Array.isArray(edit.cells)) fail('cells must be a list of [x, y].');
      return;
    case 'place': {
      const f = edit.feature;
      if (!f?.id || !f.kind) fail('A placed feature needs an id and a kind.');
      requireInt(f.x, 'feature.x');
      requireInt(f.y, 'feature.y');
      if (!(f.w >= 1 && f.h >= 1)) fail('A placed feature needs a size of at least 1×1.');
      return;
    }
    case 'move':
    case 'remove':
    case 'removeLandmark':
    case 'removeSpawn':
      if (!edit.id) fail(`${edit.op} needs an id.`);
      return;
    case 'landmark':
      if (!edit.landmark?.id || !edit.landmark.label) fail('A landmark needs an id and a label.');
      return;
    case 'spawn':
      if (!edit.spawn?.id) fail('A spawn point needs an id.');
      return;
    case 'title':
      if (!edit.title?.trim()) fail('A title cannot be empty.');
      return;
    default:
      fail(`Unknown scene edit "${(edit as { op: string }).op}".`);
  }
}

function applySceneCommand(map: VillageMap, command: WorldCommand): VillageMap | undefined {
  switch (command.type) {
    case 'scene.create': {
      const generator = findGenerator(command.generator);
      if (!generator) fail(`Unknown world generator "${command.generator}".`);
      const recipe: SceneRecipe = {
        generator: generator.id,
        params: generator.resolveParams(command.params),
        seed: command.seed === undefined ? 1 : requireInt(command.seed, 'seed'),
      };
      return rederive({ ...map, name: command.name ?? '' }, { recipe, edits: [] });
    }
    case 'scene.fromTiles': {
      if (map.scene) fail('This world is already a scene.');
      return rederive(map, { recipe: { generator: 'tiles', params: {}, seed: 0 }, edits: [], base: generatedFromTileMap(map) });
    }
    case 'scene.setRecipe': {
      const scene = requireScene(map);
      if (scene.base) fail('This world was frozen from a tile map and has no generator to rerun.');
      const generatorId = command.generator ?? scene.recipe.generator;
      const generator = findGenerator(generatorId);
      if (!generator) fail(`Unknown world generator "${generatorId}".`);
      const params = generator.resolveParams({ ...(generatorId === scene.recipe.generator ? scene.recipe.params : {}), ...command.params });
      const seed = command.seed === undefined ? scene.recipe.seed : requireInt(command.seed, 'seed');
      return rederive(map, { ...scene, recipe: { generator: generatorId, params, seed } });
    }
    case 'scene.edit': {
      const scene = requireScene(map);
      checkEdit(command.edit);
      return rederive(map, { ...scene, edits: [...scene.edits, command.edit] });
    }
    case 'scene.removeEdit': {
      const scene = requireScene(map);
      const index = requireInt(command.index, 'index');
      if (index < 0 || index >= scene.edits.length) fail(`There is no edit ${index}.`);
      return rederive(map, { ...scene, edits: scene.edits.filter((_, i) => i !== index) });
    }
    case 'scene.clearEdits':
      return rederive(map, { ...requireScene(map), edits: [] });
    default:
      return undefined;
  }
}

/** Feature kinds a hand edit may place. */
export const PLACEABLE_FEATURES: readonly FeatureKind[] = ['house', 'tree', 'pine', 'well', 'hearth', 'star', 'pool', 'wheat', 'flowers', 'prop', 'field', 'vineyard', 'haystack', 'woodpile', 'sunflower'];

/**
 * Pure: returns the document that results from a command, or throws WorldCommandError
 * with a message an editor or an agent can act on. The input is never modified.
 */
export function applyCommand(doc: WorldDocument, command: WorldCommand): WorldDocument {
  if (!command || typeof command.type !== 'string') fail('A command needs a type.');
  switch (command.type) {
    case 'cast.replace':
      if (!Array.isArray(command.cast)) fail('cast must be a list.');
      return { ...doc, cast: command.cast };
    case 'cast.upsert':
      return { ...doc, cast: upsertById(doc.cast, command.member) };
    case 'cast.update': {
      if (!doc.cast.some((m) => m.id === command.id)) fail(`No character with id "${command.id}".`);
      if (command.patch?.id && command.patch.id !== command.id) fail('A character id cannot be changed.');
      return {
        ...doc,
        cast: doc.cast.map((m) => (m.id === command.id ? { ...m, ...command.patch, id: m.id } : m)),
      };
    }
    case 'cast.remove':
      return { ...doc, cast: removeById(doc.cast, command.id, 'character') };
    case 'context.update': {
      const patch = command.patch ?? {};
      return {
        ...doc,
        context: {
          ...doc.context,
          ...patch,
          storyLines: patch.storyLines
            ? { ...doc.context.storyLines, ...patch.storyLines }
            : doc.context.storyLines,
        },
      };
    }
    default: {
      if (command.type.startsWith('scene.')) return { ...doc, map: applySceneCommand(doc.map, command)! };
      if (!command.type.startsWith('map.')) fail(`Unknown command "${(command as { type: string }).type}".`);
      const map = applyMapCommand(doc.map, command as Extract<WorldCommand, { type: `map.${string}` }>);
      if (!map) fail(`Unknown command "${(command as { type: string }).type}".`);
      return { ...doc, map };
    }
  }
}
