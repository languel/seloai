import { describe, expect, it } from 'vitest';
import { findGenerator } from '../sceneGenerators';
import { mapFromScene, type WorldScene } from '../worldScene';

const scene = (layout: string, seed: number, extra: Record<string, number | boolean> = {}): WorldScene => ({
  recipe: { generator: 'textile', params: { layout, ...extra }, seed },
  edits: [],
});

/** Cells reachable on foot from a start cell. */
function reach(blocked: boolean[][], sx: number, sy: number): Set<string> {
  const seen = new Set<string>([`${sx},${sy}`]);
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (blocked[nx]?.[ny] !== false || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

describe('textile village', () => {
  it('is registered with a schema the editor can build controls from', () => {
    const g = findGenerator('textile')!;
    expect(g.params.map((p) => p.key)).toEqual(['layout', 'households', 'orchard', 'fields', 'river', 'stitches']);
  });

  for (const layout of ['carpet', 'sampler']) {
    it(`${layout}: every named place can be walked to from every other, across the bridge`, () => {
      for (const seed of [1, 7, 42, 1234]) {
        for (const [households, stitches] of [[2, 4], [4, 4], [6, 4], [4, 2], [4, 3], [4, 6], [4, 8]]) {
          const map = mapFromScene(scene(layout, seed, { households, stitches }));
          const places = map.pointsOfInterest ?? [];
          expect(places.length).toBeGreaterThanOrEqual(households + 3);
          const first = map.spawnPoints[0];
          const open = reach(map.collisionGrid, first.x, first.y);
          for (const p of [...places, ...map.spawnPoints]) expect(open.has(`${p.x},${p.y}`), `${p.label} (${layout}, seed ${seed})`).toBe(true);
          expect(places.some((p) => p.label === 'The plank bridge')).toBe(true);
        }
      }
    });

    it(`${layout}: the river stops a walker everywhere but the bridge`, () => {
      const map = mapFromScene(scene(layout, 7));
      const model = map.scene && findGenerator('textile')!.generate(findGenerator('textile')!.resolveParams({ layout }), 7).model;
      const water = model!.terrain.flatMap((col, x) => col.map((t, y) => (t === 'water' ? [x, y] : null))).filter(Boolean) as number[][];
      expect(water.length).toBeGreaterThan(10);
      for (const [x, y] of water) expect(map.collisionGrid[x][y]).toBe(true);
    });
  }

  it('is the same world for the same seed, and leaves most of the cloth bare', () => {
    const g = findGenerator('textile')!;
    const a = g.generate(g.resolveParams({}), 7).model.textile!;
    const b = g.generate(g.resolveParams({}), 7).model.textile!;
    expect(a.cells).toEqual(b.cells);
    const worked = a.cells.flat().filter(Boolean).length / (a.cells.length * a.cells[0].length);
    expect(worked).toBeLessThan(0.2);
  });
});
