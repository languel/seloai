import { describe, expect, it } from 'vitest';
import { findPath } from '../../engine/pathfinding';
import { applyCommand } from '../commands';
import { SCENE_GENERATORS, wangValley } from '../sceneGenerators';
import { bakeScene, mapFromScene, type WorldScene } from '../worldScene';
import { validateWorldPack, WORLD_PACK_FORMAT, WORLD_PACK_VERSION } from '../worldPack';
import { GENERIC_WORLD_CONTEXT } from '../worldContext';

const valley = (seed = 4, params = {}): WorldScene => ({ recipe: { generator: 'wang-valley', params: wangValley.resolveParams(params), seed }, edits: [] });

describe('worlds authored as scenes', () => {
  it('bakes the same world from the same recipe', () => {
    expect(JSON.stringify(mapFromScene(valley(4)))).toBe(JSON.stringify(mapFromScene(valley(4))));
    expect(JSON.stringify(mapFromScene(valley(5)).collisionGrid)).not.toBe(JSON.stringify(mapFromScene(valley(4)).collisionGrid));
  });

  it('makes a valley playable: named places, spawns on open ground, all reachable from each other', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const map = mapFromScene(valley(seed));
      expect(map.pointsOfInterest!.length).toBeGreaterThanOrEqual(2);
      // Most of the land is open: a river or wood never walls off half the valley.
      const model0 = bakeScene(map.scene!).model;
      let land = 0;
      let open = 0;
      for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) if (model0.terrain[x][y] !== 'water') { land++; if (!map.collisionGrid[x][y]) open++; }
      expect(open / land).toBeGreaterThan(0.7);
      expect(map.spawnPoints.length).toBeGreaterThan(0);
      for (const p of [...map.pointsOfInterest!, ...map.spawnPoints]) expect(map.collisionGrid[p.x][p.y]).toBe(false);
      const [a, ...rest] = map.pointsOfInterest!;
      for (const b of rest) expect(findPath(map, { x: a.x, y: a.y }, { x: b.x, y: b.y }).length).toBeGreaterThan(0);
      // Water blocks, bridges do not.
      const model = bakeScene(map.scene!).model;
      for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
          if (model.terrain[x][y] === 'water') expect(map.collisionGrid[x][y]).toBe(true);
        }
      }
      expect(validateWorldPack({ format: WORLD_PACK_FORMAT, version: WORLD_PACK_VERSION, id: 'v', name: 'v', description: '', context: GENERIC_WORLD_CONTEXT, story: {}, map })).toEqual([]);
    }
  });

  it('keeps hand edits when the seed changes, and reports the ones that no longer apply', () => {
    let map = mapFromScene(valley(4));
    const doc = () => ({ map, cast: [], context: GENERIC_WORLD_CONTEXT });
    const house = bakeScene(map.scene!).model.features.find((f) => f.kind === 'house')!;
    map = applyCommand(doc(), { type: 'scene.edit', edit: { op: 'terrain', cells: [[3, 3], [4, 3]], terrain: 'water' } }).map;
    map = applyCommand(doc(), { type: 'scene.edit', edit: { op: 'remove', id: house.id! } }).map;
    map = applyCommand(doc(), { type: 'scene.edit', edit: { op: 'place', feature: { id: 'my-well', kind: 'well', x: 10, y: 10, w: 2, h: 2 } } }).map;
    let baked = bakeScene(map.scene!);
    expect(baked.model.terrain[3][3]).toBe('water');
    expect(map.collisionGrid[3][3]).toBe(true);
    expect(baked.model.features.some((f) => f.id === house.id)).toBe(false);
    expect(baked.model.features.some((f) => f.id === 'my-well')).toBe(true);
    expect(baked.skipped).toEqual([]);

    map = applyCommand(doc(), { type: 'scene.setRecipe', seed: 99 }).map;
    expect(map.scene!.edits.length).toBe(3);
    baked = bakeScene(map.scene!);
    expect(baked.model.terrain[3][3]).toBe('water');
    expect(baked.model.features.some((f) => f.id === 'my-well')).toBe(true);
    // The removed house was only in the first seed's world (unless the new one happens to share it).
    if (!bakeScene({ ...map.scene!, edits: [] }).model.features.some((f) => f.id === house.id)) {
      expect(baked.skipped.map((s) => s.index)).toEqual([1]);
    }
    map = applyCommand(doc(), { type: 'scene.clearEdits' }).map;
    expect(map.scene!.edits).toEqual([]);
  });

  it('turns a tile map into a frozen scene that keeps its walkability', () => {
    for (const generator of SCENE_GENERATORS.filter((g) => g.id === 'zmeyovo' || g.id === 'shevitsa')) {
      const map = mapFromScene({ recipe: { generator: generator.id, params: {}, seed: 0 }, edits: [] });
      const world = generator.generate({}, 0);
      expect(map.collisionGrid).toEqual(world.blocked);
      expect(map.pointsOfInterest!.length).toBe(world.model.landmarks.length);
    }
  });

  it('refuses edits an agent could get wrong, with a usable message', () => {
    const map = mapFromScene(valley(4));
    const doc = { map, cast: [], context: GENERIC_WORLD_CONTEXT };
    expect(() => applyCommand(doc, { type: 'scene.edit', edit: { op: 'terrain', cells: [], terrain: 'lava' as never } })).toThrow(/not a terrain/);
    expect(() => applyCommand(doc, { type: 'scene.create', generator: 'nope' })).toThrow(/Unknown world generator/);
    expect(applyCommand(doc, { type: 'scene.create', generator: 'wang-valley', params: { width: 99 }, seed: 3 }).map.width).toBe(14 * 6);
  });
});

describe('a procedural world runs', () => {
  it('the cast lives in the Valley: they stand on open ground and talk', async () => {
    const { runHeadless } = await import('../../headless/runHeadless');
    const { valleyPack } = await import('../packs/valley');
    const { findWorldPack } = await import('../packs');
    const map = valleyPack.build().map;
    const villagers = findWorldPack('balkan-myth')!.build().cast!;
    const result = await runHeadless({ map, villagers, seed: 3, simSeconds: 120 });
    for (const v of result.finalState) expect(map.collisionGrid[Math.round(v.x)][Math.round(v.y)]).toBe(false);
    const moved = result.finalState.filter((v) => {
      const home = villagers.find((c) => c.id === v.id)!.homeTile;
      return Math.hypot(v.x - home.x, v.y - home.y) > 1;
    });
    expect(moved.length).toBeGreaterThan(0);
    expect(result.trace.length).toBeGreaterThan(0);
  }, 30000);
});

describe('editing is local', () => {
  it('a placed house changes the decoration only near it', () => {
    const base = valley(4);
    const before = bakeScene(base).model.features.filter((f) => f.id?.startsWith('amb-'));
    const after = bakeScene({ ...base, edits: [{ op: 'place', feature: { id: 'h', kind: 'house', x: 6, y: 6, w: 2, h: 2 } }] }).model.features.filter((f) => f.id?.startsWith('amb-'));
    const key = (f: { id?: string }) => f.id!;
    const changed = [...before.filter((f) => !after.some((g) => key(g) === key(f))), ...after.filter((f) => !before.some((g) => key(g) === key(f)))];
    const far = changed.filter((f) => Math.hypot(f.x - 7, f.y - 7) > 12);
    expect(far.length).toBeLessThanOrEqual(changed.length * 0.1 + 1);
  });
});

describe('a patchwork village', () => {
  it('cuts an irregular quad grid whose faces are all four-sided and nearly square', async () => {
    const { irregularQuadGrid } = await import('../../art/irregularGrid');
    const mesh = irregularQuadGrid(4, 4, 9, 60);
    expect(mesh.faces.every((f) => f.length === 4)).toBe(true);
    // After relaxing, opposite sides of most quads are of similar length.
    const ratios = mesh.faces.map((f) => {
      const side = (a: number, b: number) => Math.hypot(mesh.vertices[a][0] - mesh.vertices[b][0], mesh.vertices[a][1] - mesh.vertices[b][1]);
      const s = [side(f[0], f[1]), side(f[1], f[2]), side(f[2], f[3]), side(f[3], f[0])];
      return Math.max(...s) / Math.min(...s);
    });
    expect(ratios.filter((r) => r < 2).length / ratios.length).toBeGreaterThan(0.8);
  });

  it('is playable: houses front roads, named places are reachable, and it is reproducible', async () => {
    const { patchworkVillage } = await import('../sceneGenerators');
    for (const seed of [1, 3, 8]) {
      const scene = { recipe: { generator: 'patchwork', params: patchworkVillage.resolveParams({}), seed }, edits: [] };
      const map = mapFromScene(scene);
      expect(JSON.stringify(mapFromScene(scene).collisionGrid)).toBe(JSON.stringify(map.collisionGrid));
      const model = bakeScene(map.scene!).model;
      const kinds = new Set(model.patches!.map((p) => p.kind));
      for (const k of ['house', 'square', 'field']) expect(kinds.has(k as never)).toBe(true);
      expect(map.pointsOfInterest!.length).toBeGreaterThanOrEqual(3);
      const [a, ...rest] = map.pointsOfInterest!;
      for (const b of rest) expect(findPath(map, { x: a.x, y: a.y }, { x: b.x, y: b.y }).length).toBeGreaterThan(0);
      // No ambient clutter on a patchwork: only the world's own features.
      expect(model.features.every((f) => !f.id?.startsWith('amb-'))).toBe(true);
    }
  });
});

describe('the patchwork village as a plan from above', () => {
  it('walks the streets, square and meadows, never through houses, gardens or fields', async () => {
    const { patchworkVillage } = await import('../sceneGenerators');
    for (const seed of [2, 7, 1061]) {
      const map = mapFromScene({ recipe: { generator: 'patchwork', params: patchworkVillage.resolveParams({}), seed }, edits: [] });
      const model = bakeScene(map.scene!).model;
      const at = (x: number, y: number) => model.patches!.find((p) => {
        let hit = false;
        for (let i = 0, j = p.points.length - 1; i < p.points.length; j = i++) {
          const [xi, yi] = p.points[i];
          const [xj, yj] = p.points[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      });
      for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
          const p = at(x + 0.5, y + 0.5);
          if (p && ['house', 'garden', 'field', 'orchard', 'vineyard', 'water'].includes(p.kind)) expect(map.collisionGrid[x][y]).toBe(true);
        }
      }
      // Every named place can be reached from the square along the streets, across bridges.
      const [a, ...rest] = map.pointsOfInterest!;
      for (const b of rest) expect(findPath(map, { x: a.x, y: a.y }, { x: b.x, y: b.y }).length).toBeGreaterThan(0);
    }
  });
});
