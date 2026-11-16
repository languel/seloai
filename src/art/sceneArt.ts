/**
 * Turns the semantic scene into shapes: the same vocabulary the motifs use, so the world
 * map is drawn by whichever look is active. Units: `UNITS_PER_TILE` per map cell.
 */
import { createSeededRng } from '../core/rng';
import { ribbon } from './lettering';
import { blossom, chevronLeaf, comb, treeOfLife, tulip } from './motifs';
import { cellRng, type Patch, type SceneFeature, type SceneModel, type Terrain } from './scene';
import { circle, curl, place, type Ink, type Pt, type Shape } from './shapes';
import { motifShape } from './patternGrammar';
import type { PatternReference } from './patternReferences';
import { seedOf, transposed, worldBand, worldMedallion, worldReferences } from './worldMotifs';

export const UNITS_PER_TILE = 8;
const U = UNITS_PER_TILE;
const UP = -Math.PI / 2;

function house(feature: SceneFeature, refs: PatternReference[]): Shape[] {
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
  // A small medallion from the world's patterns, carved in the gable.
  const gable = worldMedallion(feature.seed, refs, 3);
  const gableCell = ((h - wall) * 0.42) / Math.max(gable.w, gable.h);
  shapes.push(...place([motifShape(gable, gableCell)], { dy: -wall - (h - wall) * 0.32 }));
  for (const side of [-1, 1]) {
    const cx = side * w * 0.29;
    const cy = -wall * 0.55;
    const s = w * 0.085;
    shapes.push({ kind: 'area', points: [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]], ink: wallInk, grain: 0 });
    shapes.push({ kind: 'line', points: [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]], ink: 'dark', weight: 0.35, closed: true });
  }
  // A band of the world's pattern under the eaves, as on a real facade.
  const bandCell = 0.42;
  const band = worldBand(feature.seed + 1, refs, (w * 0.84) / bandCell, 3);
  shapes.push(...place([motifShape(band, bandCell)], { dy: -wall * 0.9 }));
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

function featureShapes(feature: SceneFeature, refs: PatternReference[]): Shape[] {
  const footX = (feature.x + feature.w / 2) * U;
  const footY = (feature.y + feature.h) * U - U * 0.12;
  const centreY = (feature.y + feature.h / 2) * U;
  const rng = createSeededRng(feature.seed);
  switch (feature.kind) {
    case 'house':
      return place(house(feature, refs), { dx: footX, dy: footY });
    case 'tree':
      return place(treeOfLife(rng, feature.h * U * 0.94), { dx: footX, dy: footY });
    case 'pine':
      return place(pine(feature), { dx: footX, dy: footY });
    case 'well':
      return place(well(feature), { dx: footX, dy: centreY });
    case 'hearth':
      return place(hearth(feature), { dx: footX, dy: centreY });
    case 'star': {
      // A dancing ground: a medallion grown from the world's patterns, filling the ground.
      const motif = worldMedallion(feature.seed, refs);
      const cell = (Math.min(feature.w, feature.h) * U * 0.9) / Math.max(motif.w, motif.h);
      return place([motifShape(motif, cell)], { dx: footX, dy: centreY });
    }
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
    case 'grove':
      return place(treeOfLife(rng, feature.h * U * 0.78), { dx: footX, dy: footY });
    case 'sapling':
      return place(pine({ ...feature, h: feature.h * 0.72 }), { dx: footX, dy: footY });
    case 'fence':
      return fence(feature);
    case 'haystack':
      return place(haystack(), { dx: footX, dy: footY });
    case 'woodpile':
      return place(woodpile(), { dx: footX, dy: footY });
    case 'sunflower':
      return place(sunflower(), { dx: footX, dy: footY });
    case 'hen':
      return place(bird(rng() < 0.5, 'gold', 'primary'), { dx: footX, dy: footY - U * 0.1 });
    case 'duck':
      return place(bird(rng() < 0.5, 'gold', 'accent'), { dx: footX, dy: centreY + U * 0.1 });
    case 'field':
      return strips(feature, false);
    case 'vineyard':
      return strips(feature, true);
    case 'reeds':
      return place(reeds(rng), { dx: footX, dy: footY });
    case 'rosette':
      return place(rosette(rng), { dx: footX, dy: centreY });
  }
}

/** A wattle fence round a yard: posts with two woven rails, open at the house and the gate. */
function fence(feature: SceneFeature): Shape[] {
  const x0 = feature.x * U + U * 0.2;
  const x1 = (feature.x + feature.w) * U - U * 0.2;
  const y0 = feature.y * U + U * 0.15;
  const y1 = (feature.y + feature.h) * U - U * 0.25;
  const gate = [(x0 + x1) / 2 - U * 0.45, (x0 + x1) / 2 + U * 0.45];
  const shapes: Shape[] = [];
  const run = (a: Pt, b: Pt) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const posts = Math.max(1, Math.round(len / (U * 0.75)));
    for (let i = 0; i <= posts; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / posts;
      const y = a[1] + ((b[1] - a[1]) * i) / posts;
      shapes.push({ kind: 'line', points: [[x, y], [x, y - U * 0.42]], ink: 'dark', weight: 0.45 });
    }
    for (const lift of [0.14, 0.3]) {
      shapes.push({ kind: 'line', points: [[a[0], a[1] - U * lift], [b[0], b[1] - U * lift]], ink: 'gold', weight: 0.4 });
    }
  };
  run([x0, y0], [x0, y1]);
  run([x1, y0], [x1, y1]);
  run([x0, y1], [gate[0], y1]);
  run([gate[1], y1], [x1, y1]);
  return shapes;
}

function haystack(): Shape[] {
  const w = U * 0.42;
  const h = U * 0.8;
  const dome: Pt[] = [[-w, 0], ...Array.from({ length: 9 }, (_, i): Pt => {
    const a = Math.PI + (i / 8) * Math.PI;
    return [Math.cos(a) * w, -h * 0.35 + Math.sin(a) * h * 0.65];
  }), [w, 0]];
  return [
    { kind: 'area', points: dome, ink: 'gold', grain: UP },
    { kind: 'line', points: [[0, -h], [0, -h - U * 0.18]], ink: 'dark', weight: 0.5 },
    { kind: 'line', points: [[-w * 0.7, -h * 0.35], [w * 0.7, -h * 0.35]], ink: 'dark', weight: 0.3 },
  ];
}

function woodpile(): Shape[] {
  const shapes: Shape[] = [];
  const r = U * 0.11;
  for (const [row, count] of [[0, 3], [1, 2], [2, 1]] as const) {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * r * 2.2;
      const y = -r - row * r * 1.9;
      shapes.push({ kind: 'line', points: circle([x, y], r, 8), ink: 'dark', weight: 0.4, closed: true });
      shapes.push({ kind: 'knot', at: [x, y], r: r * 0.35, ink: 'gold' });
    }
  }
  return shapes;
}

function sunflower(): Shape[] {
  const h = U * 0.95;
  const shapes: Shape[] = [
    { kind: 'line', points: [[0, 0], [U * 0.04, -h]], ink: 'accent', weight: 0.5 },
    { kind: 'area', points: [[0, -h * 0.4], [U * 0.28, -h * 0.55], [U * 0.05, -h * 0.5]], ink: 'accent', grain: 0 },
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    shapes.push({ kind: 'knot', at: [U * 0.04 + Math.cos(a) * U * 0.17, -h + Math.sin(a) * U * 0.17], r: U * 0.07, ink: 'gold' });
  }
  shapes.push({ kind: 'knot', at: [U * 0.04, -h], r: U * 0.1, ink: 'dark' });
  return shapes;
}

/** A small bird: a hen in a yard, a duck on the water. */
function bird(facingLeft: boolean, body: Ink, head: Ink): Shape[] {
  const s = U * 0.26;
  const shapes: Shape[] = [
    { kind: 'area', points: [[-s, -s * 0.2], [-s * 0.4, -s * 0.9], [s * 0.6, -s * 0.8], [s, -s * 0.3], [s * 0.5, 0], [-s * 0.6, 0]], ink: body, grain: 0 },
    { kind: 'knot', at: [s * 0.75, -s * 1.05], r: s * 0.32, ink: head },
    { kind: 'area', points: [[s * 1.0, -s * 1.1], [s * 1.35, -s * 0.98], [s * 1.0, -s * 0.9]], ink: 'primary', grain: 0 },
    { kind: 'line', points: [[-s, -s * 0.25], [-s * 1.35, -s * 0.85]], ink: 'dark', weight: 0.35 },
  ];
  return facingLeft ? place(shapes, { mirrorX: true }) : shapes;
}

/** Strip fields: parallel rows of grain, or vines on posts, inside a stitched boundary. */
function strips(feature: SceneFeature, vines: boolean): Shape[] {
  const x0 = feature.x * U + U * 0.25;
  const x1 = (feature.x + feature.w) * U - U * 0.25;
  const y0 = feature.y * U + U * 0.3;
  const y1 = (feature.y + feature.h) * U - U * 0.2;
  const shapes: Shape[] = [
    { kind: 'line', points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], ink: 'dark', weight: 0.3, closed: true },
  ];
  const rows = Math.max(2, Math.round((y1 - y0) / (U * 0.55)));
  for (let r = 0; r < rows; r++) {
    const y = y0 + ((r + 0.7) / rows) * (y1 - y0);
    if (vines) {
      shapes.push({ kind: 'line', points: [[x0 + U * 0.2, y - U * 0.3], [x1 - U * 0.2, y - U * 0.3]], ink: 'dark', weight: 0.25 });
      for (let x = x0 + U * 0.35; x < x1 - U * 0.2; x += U * 0.7) {
        shapes.push({ kind: 'line', points: [[x, y], [x, y - U * 0.38]], ink: 'dark', weight: 0.35 });
        shapes.push({ kind: 'line', points: curl([x + U * 0.08, y - U * 0.22], U * 0.12, 1, 1, 0), ink: 'accent', weight: 0.35 });
        shapes.push({ kind: 'knot', at: [x + U * 0.22, y - U * 0.12], r: U * 0.06, ink: 'accent2' });
      }
    } else {
      const ink: Ink = r % 2 ? 'gold' : 'accent';
      for (let x = x0 + U * 0.2; x < x1 - U * 0.1; x += U * 0.32) {
        shapes.push({ kind: 'line', points: [[x - U * 0.06, y], [x + U * 0.06, y - U * 0.26]], ink, weight: 0.35 });
      }
    }
  }
  return shapes;
}

function reeds(rng: () => number): Shape[] {
  const shapes: Shape[] = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * U * 0.16 + (rng() - 0.5) * U * 0.06;
    const h = U * (0.55 + rng() * 0.3);
    shapes.push({ kind: 'line', points: [[x, 0], [x + (i - 1) * U * 0.06, -h]], ink: 'accent', weight: 0.35 });
    if (i !== 1) {
      // A cattail head: a small upright oval at the top of the stem.
      const cx = x + (i - 1) * U * 0.06;
      const cy = -h - U * 0.1;
      shapes.push({ kind: 'area', points: circle([cx, cy], U * 0.05, 8).map(([px, py]): Pt => [px, cy + (py - cy) * 2.2]), ink: 'dark', grain: UP });
    }
  }
  return shapes;
}

/** A tiny four-knot rosette: one repeat of the meadow's all-over pattern. */
function rosette(rng: () => number): Shape[] {
  const r = U * 0.12;
  const ink: Ink = rng() < 0.5 ? 'accent' : 'gold';
  return [
    ...[0, 1, 2, 3].map((i): Shape => ({ kind: 'knot', at: [Math.cos((i * Math.PI) / 2) * r, Math.sin((i * Math.PI) / 2) * r], r: 0.32, ink })),
    { kind: 'knot', at: [0, 0], r: 0.3, ink: 'primary' },
  ];
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
  shapes.push(...edgeLines(model));
  if (roadCells.length > 0) shapes.push({ kind: 'counted', origin: [U / 4, U / 4], cell: U / 2, cells: roadCells });
  if (wallCells.length > 0) shapes.push({ kind: 'counted', origin: [U / 4, U / 4], cell: U / 2, cells: wallCells });
  return shapes;
}

/**
 * Stitched edges where terrain changes: a road becomes a couched band with a dark line down
 * each side, and water gets a bank line. Neighbouring segments are joined into runs so the
 * stitches flow along an edge instead of restarting at every cell.
 */
function edgeLines(model: SceneModel): Shape[] {
  const shapes: Shape[] = [];
  const kindAt = (x: number, y: number) => model.terrain[x]?.[y];
  const roadish = (t: Terrain | undefined) => t === 'road' || t === 'bridge';
  const waterish = (t: Terrain | undefined) => t === 'water' || t === 'bridge';
  const edges: Array<{ test: (t: Terrain | undefined) => boolean; ink: Ink; weight: number; inset: number }> = [
    { test: roadish, ink: 'dark', weight: 0.45, inset: 0.06 },
    { test: waterish, ink: 'secondary', weight: 0.55, inset: -0.04 },
  ];
  for (const edge of edges) {
    // Horizontal runs (top and bottom edges of cells), then vertical runs.
    for (const side of [-1, 1] as const) {
      for (let y = 0; y < model.height; y++) {
        let start = -1;
        for (let x = 0; x <= model.width; x++) {
          const on = x < model.width && edge.test(kindAt(x, y)) && !edge.test(kindAt(x, y + side));
          if (on && start < 0) start = x;
          if (!on && start >= 0) {
            const ey = (side < 0 ? y : y + 1) * U - side * edge.inset * U;
            shapes.push({ kind: 'line', points: [[start * U, ey], [x * U, ey]], ink: edge.ink, weight: edge.weight });
            start = -1;
          }
        }
      }
      for (let x = 0; x < model.width; x++) {
        let start = -1;
        for (let y = 0; y <= model.height; y++) {
          const on = y < model.height && edge.test(kindAt(x, y)) && !edge.test(kindAt(x + side, y));
          if (on && start < 0) start = y;
          if (!on && start >= 0) {
            const ex = (side < 0 ? x : x + 1) * U - side * edge.inset * U;
            shapes.push({ kind: 'line', points: [[ex, start * U], [ex, y * U]], ink: edge.ink, weight: edge.weight });
            start = -1;
          }
        }
      }
    }
  }
  return shapes;
}

/**
 * The cloth's own border: a double rule around the whole world with a running chevron of
 * the main thread between, and a knot rosette at each corner, like the edge of a towel.
 */
function clothBorder(model: SceneModel, refs: PatternReference[]): Shape[] {
  const w = model.width * U;
  const h = model.height * U;
  const outer = U * 0.3;
  const inner = U * 0.95;
  const mid = (outer + inner) / 2;
  const rect = (d: number): Pt[] => [[d, d], [w - d, d], [w - d, h - d], [d, h - d]];
  const shapes: Shape[] = [
    { kind: 'line', points: rect(outer), ink: 'dark', weight: 0.6, closed: true },
    { kind: 'line', points: rect(inner), ink: 'dark', weight: 0.45, closed: true },
  ];
  // A band of the world's pattern between the rules, run round all four sides, with a
  // medallion at each corner.
  const seed = seedOf(model.title ?? 'cloth');
  const bandH = 5;
  const cell = ((inner - outer) * 0.86) / bandH;
  const across = worldBand(seed, refs, (w - inner * 2) / cell, bandH);
  const down = transposed(worldBand(seed, refs, (h - inner * 2) / cell, bandH));
  shapes.push(...place([motifShape(across, cell)], { dx: w / 2, dy: mid }));
  shapes.push(...place([motifShape(across, cell)], { dx: w / 2, dy: h - mid }));
  shapes.push(...place([motifShape(down, cell)], { dx: mid, dy: h / 2 }));
  shapes.push(...place([motifShape(down, cell)], { dx: w - mid, dy: h / 2 }));
  const corner = worldMedallion(seed + 3, refs, 3);
  const cornerCell = ((inner - outer) * 1.1) / Math.max(corner.w, corner.h);
  for (const [cx, cy] of [[mid, mid], [w - mid, mid], [w - mid, h - mid], [mid, h - mid]] as const) {
    shapes.push(...place([motifShape(corner, cornerCell)], { dx: cx, dy: cy }));
  }
  return shapes;
}

/**
 * A patchwork ground, in the manner of a Klee village: every patch filled in its own thread
 * and stitch direction, dark couched seams between them, houses marked with a gable and a
 * door, vineyards with rows of knots, roads left as bare linen.
 */
function patchShapes(patches: Patch[]): Shape[] {
  const shapes: Shape[] = [];
  for (const p of patches) {
    const pts = p.points.map(([x, y]): Pt => [x * U, y * U]);
    if (p.kind !== 'road') shapes.push({ kind: 'area', points: pts, ink: p.ink, grain: p.grain });
    if (p.kind === 'house') {
      // A gable and a door, small marks inside the patch, as Klee draws his houses.
      const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
      const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      const size = Math.min(...pts.map((q) => Math.hypot(q[0] - cx, q[1] - cy))) * 0.7;
      shapes.push({ kind: 'line', points: [[cx - size, cy], [cx, cy - size * 0.8], [cx + size, cy]], ink: 'dark', weight: 0.45 });
      shapes.push({ kind: 'line', points: [[cx, cy + size * 0.15], [cx, cy + size * 0.75]], ink: 'dark', weight: 0.55 });
    } else if (p.kind === 'water') {
      // Water: wavy running lines across the patch, like the river elsewhere on the cloth.
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      for (let y = Math.min(...ys) + 1.6; y < Math.max(...ys) - 0.8; y += 2.2) {
        const wave: Pt[] = [];
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.8) {
          const q: Pt = [x, y + Math.sin(x * 0.9) * 0.55];
          if (pointIn(q, pts)) wave.push(q);
          else if (wave.length > 1) {
            shapes.push({ kind: 'line', points: [...wave], ink: 'dark', weight: 0.3 });
            wave.length = 0;
          } else wave.length = 0;
        }
        if (wave.length > 1) shapes.push({ kind: 'line', points: wave, ink: 'dark', weight: 0.3 });
      }
    } else if (p.kind === 'vineyard') {
      const rng = createSeededRng(p.seed);
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      for (let x = Math.min(...xs) + 2; x < Math.max(...xs) - 1; x += 2.6) {
        for (let y = Math.min(...ys) + 2; y < Math.max(...ys) - 1; y += 2.2) {
          if (pointIn([x, y], pts)) shapes.push({ kind: 'knot', at: [x + (rng() - 0.5) * 0.6, y], r: 0.45, ink: 'dark' });
        }
      }
    }
    // The seam: a dark running line round the patch, like the cut edges in a quilt.
    shapes.push({ kind: 'line', points: pts, ink: 'dark', weight: 0.32, closed: true });
  }
  return shapes;
}

function pointIn([x, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Everything that does not move, in drawing order. */
export function sceneShapes(model: SceneModel): Shape[] {
  const refs = worldReferences(model.motifs);
  const ground = model.patches ? patchShapes(model.patches) : terrainShapes(model);
  const shapes = [...ground, ...model.features.flatMap((f) => featureShapes(f, refs)), ...clothBorder(model, refs)];
  if (model.title) {
    // The place name, stitched into the top of the cloth like the heading of a sampler.
    shapes.push(...place(ribbon(model.title, { cell: 1.1, ink: 'primary', rule: 'dark' }), { dx: (model.width * U) / 2, dy: U * 1.7 }));
  }
  return shapes;
}
