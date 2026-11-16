/**
 * Turns the semantic scene into shapes: the same vocabulary the motifs use, so the world
 * map is drawn by whichever look is active. Units: `UNITS_PER_TILE` per map cell.
 */
import { createSeededRng } from '../core/rng';
import { blossom, chevronLeaf, comb, star, treeOfLife, tulip } from './motifs';
import { cellRng, type SceneFeature, type SceneModel, type Terrain } from './scene';
import { circle, curl, place, type Ink, type Pt, type Shape } from './shapes';

export const UNITS_PER_TILE = 8;
const U = UNITS_PER_TILE;
const UP = -Math.PI / 2;

function house(feature: SceneFeature): Shape[] {
  const rng = createSeededRng(feature.seed);
  const w = feature.w * U * 0.86;
  const h = feature.h * U * 0.92;
  const wall = h * 0.46;
  const wallInk: Ink = (['accent2', 'secondary', 'primary'] as const)[Math.floor(rng() * 3)];
  const shapes: Shape[] = [
    { kind: 'line', points: [[-w / 2, 0], [w / 2, 0], [w / 2, -wall], [-w / 2, -wall]], ink: 'dark', weight: 0.8, closed: true },
    { kind: 'area', points: [[-w * 0.6, -wall], [w * 0.6, -wall], [0, -h]], ink: 'primary', grain: 0 },
    { kind: 'line', points: [[-w * 0.6, -wall], [0, -h], [w * 0.6, -wall]], ink: 'dark', weight: 0.6 },
    { kind: 'area', points: [[-w * 0.09, 0], [w * 0.09, 0], [w * 0.09, -wall * 0.62], [-w * 0.09, -wall * 0.62]], ink: 'dark', grain: UP },
  ];
  // Roof courses, and a carved gable sign.
  for (let i = 1; i <= 2; i++) {
    const t = i / 3;
    shapes.push({ kind: 'line', points: [[-w * 0.6 * (1 - t), -wall - (h - wall) * t], [w * 0.6 * (1 - t), -wall - (h - wall) * t]], ink: 'gold', weight: 0.4 });
  }
  shapes.push(...place(star(h * 0.07, ['gold', 'gold']), { dy: -wall - (h - wall) * 0.3 }));
  for (const side of [-1, 1]) {
    const cx = side * w * 0.29;
    const cy = -wall * 0.55;
    const s = w * 0.085;
    shapes.push({ kind: 'area', points: [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]], ink: wallInk, grain: 0 });
    shapes.push({ kind: 'line', points: [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]], ink: 'dark', weight: 0.35, closed: true });
  }
  // A band of stitches under the eaves, as on a real facade.
  for (let i = 0; i < 7; i++) {
    shapes.push({ kind: 'knot', at: [-w * 0.42 + (i / 6) * w * 0.84, -wall * 0.92], r: 0.45, ink: i % 2 ? 'primary' : 'gold' });
  }
  return shapes;
}

function pine(feature: SceneFeature): Shape[] {
  const h = feature.h * U * 0.95;
  const shapes: Shape[] = [{ kind: 'line', points: [[0, 0], [0, -h * 0.3]], ink: 'dark', weight: 0.7 }];
  for (let i = 0; i < 3; i++) {
    const base = -h * (0.18 + i * 0.24);
    const half = U * (0.5 - i * 0.11);
    shapes.push({ kind: 'area', points: [[-half, base], [half, base], [0, base - h * 0.36]], ink: 'accent', grain: UP });
  }
  return shapes;
}

function well(feature: SceneFeature): Shape[] {
  const r = Math.min(feature.w, feature.h) * U * 0.36;
  const shapes: Shape[] = [
    { kind: 'area', points: circle([0, 0], r, 24), ink: 'dark', grain: 0 },
    { kind: 'area', points: circle([0, 0], r * 0.68, 20), ink: 'secondary', grain: 0 },
    { kind: 'line', points: circle([0, 0], r * 1.16, 24), ink: 'gold', weight: 0.7, closed: true },
  ];
  // The serpent: coils wound about the rim.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const at: Pt = [Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5];
    shapes.push({ kind: 'line', points: curl(at, r * 0.42, 1.1, i % 2 ? 1 : -1, a), ink: 'accent', weight: 0.8 });
  }
  shapes.push({ kind: 'knot', at: [0, 0], r: r * 0.16, ink: 'gold' });
  return shapes;
}

function hearth(feature: SceneFeature): Shape[] {
  const r = Math.min(feature.w, feature.h) * U * 0.3;
  const shapes: Shape[] = [{ kind: 'line', points: circle([0, 0], r * 1.3, 20), ink: 'dark', weight: 0.9, closed: true }];
  shapes.push(...tulip(r * 1.1, ['primary', 'gold']).map((s) => s));
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    shapes.push({ kind: 'knot', at: [Math.cos(a) * r * 1.7, Math.sin(a) * r * 1.7], r: 0.5, ink: i % 2 ? 'primary' : 'gold' });
  }
  return place(shapes, { dy: -r * 0.2 });
}

function featureShapes(feature: SceneFeature): Shape[] {
  const footX = (feature.x + feature.w / 2) * U;
  const footY = (feature.y + feature.h) * U - U * 0.12;
  const centreY = (feature.y + feature.h / 2) * U;
  const rng = createSeededRng(feature.seed);
  switch (feature.kind) {
    case 'house':
      return place(house(feature), { dx: footX, dy: footY });
    case 'tree':
      return place(treeOfLife(rng, feature.h * U * 0.94), { dx: footX, dy: footY });
    case 'pine':
      return place(pine(feature), { dx: footX, dy: footY });
    case 'well':
      return place(well(feature), { dx: footX, dy: centreY });
    case 'hearth':
      return place(hearth(feature), { dx: footX, dy: centreY });
    case 'star':
      return place(star(Math.min(feature.w, feature.h) * U * 0.42), { dx: footX, dy: centreY });
    case 'pool':
      return place(
        [
          { kind: 'area', points: circle([0, 0], feature.w * U * 0.4, 20), ink: 'secondary', grain: 0 },
          { kind: 'line', points: circle([0, 0], feature.w * U * 0.47, 20), ink: 'gold', weight: 0.5, closed: true },
        ],
        { dx: footX, dy: centreY },
      );
    case 'wheat':
      return [-1, 0, 1].flatMap((i) => place(comb(feature.h * U * 0.6, 'gold'), { dx: footX + i * U * 0.55, dy: footY }));
    case 'flowers':
      return place(
        [{ kind: 'line', points: [[0, 0], [0, -U * 0.45]], ink: 'dark', weight: 0.4 }, ...place(blossom(U * 0.26), { dy: -U * 0.6 })],
        { dx: footX, dy: footY },
      );
    case 'prop':
      return place(chevronLeaf(U * 0.55, ['dark', 'gold']), { dx: footX, dy: footY });
  }
}

function terrainShapes(model: SceneModel): Shape[] {
  const shapes: Shape[] = [];
  const roadCells: Array<[number, number, Ink]> = [];
  const wallCells: Array<[number, number, Ink]> = [];
  const is = (x: number, y: number, kind: Terrain) => model.terrain[x]?.[y] === kind;

  for (let x = 0; x < model.width; x++) {
    for (let y = 0; y < model.height; y++) {
      const kind = model.terrain[x][y];
      const x0 = x * U;
      const y0 = y * U;
      const rng = cellRng(x, y);
      if (kind === 'water') {
        // Running waves: phase follows world x so neighbouring cells join up.
        for (const row of [0.28, 0.72]) {
          const points: Pt[] = [];
          for (let i = 0; i <= 6; i++) {
            const px = x0 + (i / 6) * U;
            points.push([px, y0 + row * U + Math.sin((px / U) * Math.PI * 2 + row * 5 + y * 1.7) * U * 0.11]);
          }
          shapes.push({ kind: 'line', points, ink: 'secondary', weight: 0.75 });
        }
      } else if (kind === 'road') {
        roadCells.push([x * 2, y * 2, 'gold'], [x * 2 + 1, y * 2 + 1, 'gold']);
      } else if (kind === 'wall') {
        for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
          wallCells.push([x * 2 + sx, y * 2 + sy, (sx + sy) % 2 ? 'primary' : 'dark']);
        }
      } else if (kind === 'dry') {
        const count = 1 + Math.floor(rng() * 2);
        for (let i = 0; i < count; i++) {
          shapes.push({ kind: 'knot', at: [x0 + rng() * U, y0 + rng() * U], r: 0.32 + rng() * 0.2, ink: rng() < 0.3 ? 'primary' : 'gold' });
        }
        if (rng() < 0.2) {
          const cx = x0 + rng() * U;
          const cy = y0 + rng() * U;
          shapes.push({ kind: 'line', points: [[cx - 1.2, cy], [cx, cy + 0.7], [cx + 1.3, cy - 0.3]], ink: 'dark', weight: 0.3 });
        }
      } else if (kind === 'bridge') {
        const across = is(x - 1, y, 'water') || is(x + 1, y, 'water');
        for (let i = 0; i < 4; i++) {
          const t = (i + 0.5) / 4;
          shapes.push({
            kind: 'line',
            points: across ? [[x0, y0 + t * U], [x0 + U, y0 + t * U]] : [[x0 + t * U, y0], [x0 + t * U, y0 + U]],
            ink: 'dark',
            weight: 0.7,
          });
        }
      } else if (rng() < 0.085) {
        // Meadow: the odd tuft, so open ground reads as grass without filling the cloth.
        const cx = x0 + 1.5 + rng() * (U - 3);
        const cy = y0 + 2 + rng() * (U - 3);
        shapes.push({ kind: 'line', points: [[cx - 1, cy - 1.6], [cx, cy], [cx + 1, cy - 1.6]], ink: 'accent', weight: 0.4 });
      }
    }
  }
  if (roadCells.length > 0) shapes.push({ kind: 'counted', origin: [U / 4, U / 4], cell: U / 2, cells: roadCells });
  if (wallCells.length > 0) shapes.push({ kind: 'counted', origin: [U / 4, U / 4], cell: U / 2, cells: wallCells });
  return shapes;
}

/** Everything that does not move, in drawing order. */
export function sceneShapes(model: SceneModel): Shape[] {
  return [...terrainShapes(model), ...model.features.flatMap(featureShapes)];
}
