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
    for (const generator of SCENE_GENERATORS.filter((g) => g.id !== 'wang-valley')) {
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
