/**
 * Generative motifs in the spirit of Bulgarian shevitsa embroidery. Nothing here copies a
 * historical piece: each function is a small grammar (an axis, a symmetry, a set of head
 * forms, a counted band) that grows a new motif from a seed.
 */
import type { Rng } from '../core/rng';
import {
  cartouche,
  circle,
  curl,
  mirrored,
  petal,
  place,
  quadCurve,
  type Ink,
  type Pt,
  type Shape,
} from './shapes';

const UP = -Math.PI / 2;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Eight-pointed star: the elbetitsa, eight directions around one centre. */
export function star(size: number, inks: [Ink, Ink] = ['primary', 'secondary']): Shape[] {
  const shapes: Shape[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    shapes.push({ kind: 'area', points: petal(angle, size, size * 0.46), ink: inks[i % 2], grain: angle + UP });
  }
  shapes.push({ kind: 'knot', at: [0, 0], r: size * 0.16, ink: 'gold' });
  return shapes;
}

/** Four round petals around a bright centre. */
export function blossom(size: number, inks: [Ink, Ink] = ['primary', 'accent2']): Shape[] {
  const shapes: Shape[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const centre: Pt = [Math.cos(angle) * size * 0.52, Math.sin(angle) * size * 0.52];
    shapes.push({ kind: 'area', points: circle(centre, size * 0.44, 14), ink: inks[i % 2], grain: angle });
  }
  shapes.push({ kind: 'area', points: circle([0, 0], size * 0.24, 12), ink: 'gold', grain: 0 });
  return shapes;
}

/** A three-part bud opening upward. */
export function tulip(size: number, inks: [Ink, Ink] = ['primary', 'accent']): Shape[] {
  return [
    { kind: 'area', points: petal(-0.72, size * 0.86, size * 0.42), ink: inks[1], grain: UP - 0.72 },
    { kind: 'area', points: petal(0.72, size * 0.86, size * 0.42), ink: inks[1], grain: UP + 0.72 },
    { kind: 'area', points: petal(0, size, size * 0.5), ink: inks[0], grain: UP },
    { kind: 'knot', at: [0, -size * 1.12], r: size * 0.09, ink: 'gold' },
  ];
}

/** A hooked comb: a spine with teeth, read as a hand, a bird's tail or a branch. */
export function comb(size: number, ink: Ink = 'primary'): Shape[] {
  const teeth = 4;
  const w = size * 0.9;
  const tooth = w / (teeth * 2 - 1);
  const spine = size * 0.28;
  const points: Pt[] = [
    [-w / 2, 0],
    [w / 2, 0],
  ];
  for (let i = teeth - 1; i >= 0; i--) {
    const x0 = -w / 2 + i * tooth * 2;
    points.push([x0 + tooth, -spine], [x0 + tooth, -size], [x0, -size], [x0, -spine]);
  }
  return [{ kind: 'area', points, ink, grain: UP }];
}

/** Nested chevrons forming a striped leaf. */
export function chevronLeaf(size: number, inks: Ink[] = ['secondary', 'accent', 'primary']): Shape[] {
  return inks.map((ink, i): Shape => {
    const outer = size * (1 - i * 0.3);
    const inner = Math.max(0, outer - size * 0.22);
    return {
      kind: 'area',
      points: [
        [0, -outer * 0.2],
        [outer * 0.52, -outer],
        [outer * 0.52, -outer + (outer - inner)],
        [0, -inner * 0.2 + (outer - inner) * 0.35],
        [-outer * 0.52, -outer + (outer - inner)],
        [-outer * 0.52, -outer],
      ],
      ink,
      grain: UP,
    };
  });
}

type HeadKind = 'star' | 'blossom' | 'tulip' | 'comb' | 'leaf';
const HEAD_KINDS: readonly HeadKind[] = ['star', 'blossom', 'tulip', 'comb', 'leaf'];

/** A head form for a stem or a hand: the terminal that ends a branch. */
export function flowerHead(kind: HeadKind, size: number, rng: Rng): Shape[] {
  const warm = pick(rng, ['primary', 'accent2'] as const);
  const cool = pick(rng, ['secondary', 'accent'] as const);
  switch (kind) {
    case 'star':
      return place(star(size * 0.8, [warm, cool]), { dy: -size * 0.8 });
    case 'blossom':
      return place(blossom(size * 0.72, [warm, cool]), { dy: -size * 0.78 });
    case 'tulip':
      return tulip(size * 1.05, [warm, cool]);
    case 'comb':
      return comb(size * 1.05, warm);
    case 'leaf':
      return chevronLeaf(size * 1.2, [cool, pick(rng, ['accent', 'gold'] as const), warm]);
  }
}

/**
 * Tree of Life: one vertical axis with roots below, paired branches on the trunk and a crown
 * above. Each branch carries its own head form; left and right always mirror.
 */
export function treeOfLife(rng: Rng, height: number): Shape[] {
  const shapes: Shape[] = [];
  const levels = 2 + Math.floor(rng() * 2);

  // Roots: a mound and two inward curls.
  shapes.push({
    kind: 'area',
    points: [
      [-height * 0.13, 0],
      [height * 0.13, 0],
      [height * 0.05, -height * 0.09],
      [-height * 0.05, -height * 0.09],
    ],
    ink: 'primary',
    grain: 0,
  });
  shapes.push(
    ...mirrored([
      { kind: 'line', points: curl([height * 0.13, 0], height * 0.07, 0.8, 1, Math.PI * 0.5), ink: 'dark', weight: 0.55 },
    ]),
  );
  shapes.push({ kind: 'line', points: [[0, -height * 0.09], [0, -height * 0.86]], ink: 'dark', weight: 0.8 });

  for (let level = 1; level <= levels; level++) {
    const y = -height * (0.12 + (0.62 * level) / (levels + 0.4));
    const reach = height * between(rng, 0.26, 0.4) * (1 - level * 0.1);
    const rise = height * between(rng, 0.08, 0.2);
    const end: Pt = [reach, y - rise];
    const control: Pt = [reach * between(rng, 0.45, 0.8), y + height * 0.04];
    const branch = quadCurve([0, y], control, end);
    const tangent: Pt = [end[0] - control[0], end[1] - control[1]];
    const facing = Math.atan2(tangent[0], -tangent[1]);
    const size = height * between(rng, 0.16, 0.23);

    const side: Shape[] = [{ kind: 'line', points: branch, ink: 'dark', weight: 0.55 }];
    side.push(...place(flowerHead(pick(rng, HEAD_KINDS), size, rng), { dx: end[0], dy: end[1], rot: facing }));
    if (rng() < 0.75) {
      const mid = branch[Math.floor(branch.length * 0.5)];
      side.push({ kind: 'line', points: curl(mid, height * 0.045, 0.9, -1, Math.PI * 0.5), ink: 'dark', weight: 0.4 });
    }
    if (rng() < 0.5) side.push({ kind: 'knot', at: [reach * 0.42, y - rise * 1.5], r: height * 0.014, ink: 'gold' });
    shapes.push(...mirrored(side));
  }

  const crown = pick(rng, ['star', 'blossom', 'tulip'] as const);
  shapes.push(...place(flowerHead(crown, height * 0.27, rng), { dy: -height * 0.84 }));
  return shapes;
}

/**
 * Medallion: a cartouche at the centre with four-fold sprigs around it, enclosed by a frame
 * of knots. The whole has the symmetry of a square.
 */
export function medallion(rng: Rng, radius: number): Shape[] {
  const shapes: Shape[] = [];
  const squareness = between(rng, 3, 6);
  const body = cartouche(radius, squareness);
  shapes.push({ kind: 'area', points: body, ink: 'primary', grain: UP });
  shapes.push({ kind: 'line', points: cartouche(radius * 1.08, squareness), ink: 'gold', weight: 0.6, closed: true });

  const inset = radius * 0.44;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    shapes.push({
      kind: 'area',
      points: cartouche(radius * 0.24, 2.4, 16).map(([x, y]): Pt => [x + sx * inset, y + sy * inset]),
      ink: sx * sy > 0 ? 'secondary' : 'accent2',
      grain: Math.PI / 4,
    });
  }
  shapes.push({ kind: 'area', points: circle([0, 0], radius * 0.2, 14), ink: 'gold', grain: 0 });
  shapes.push({ kind: 'knot', at: [0, 0], r: radius * 0.07, ink: 'dark' });

  const axialHead = pick(rng, ['star', 'tulip', 'comb'] as const);
  const diagonalHead = pick(rng, ['blossom', 'leaf', 'star'] as const);
  for (let i = 0; i < 4; i++) {
    const axial: Shape[] = [
      { kind: 'line', points: [[0, -radius * 1.1], [0, -radius * 1.5]], ink: 'dark', weight: 0.7 },
      ...place(flowerHead(axialHead, radius * 0.7, rng), { dy: -radius * 1.5 }),
      ...mirrored([
        { kind: 'line', points: curl([0, -radius * 1.3], radius * 0.2, 0.85, 1, Math.PI), ink: 'dark', weight: 0.4 },
      ]),
    ];
    shapes.push(...place(axial, { rot: (i * Math.PI) / 2 }));

    const diagonal: Shape[] = [
      { kind: 'line', points: quadCurve([0, -radius * 1.25], [radius * 0.34, -radius * 1.6], [0, -radius * 1.95], 10), ink: 'dark', weight: 0.6 },
      ...place(flowerHead(diagonalHead, radius * 0.58, rng), { dy: -radius * 1.95 }),
    ];
    shapes.push(...place(diagonal, { rot: Math.PI / 4 + (i * Math.PI) / 2 }));
  }

  const frame = radius * 3.0;
  const count = 19;
  for (let i = 0; i < count; i++) {
    const t = -frame + (i / count) * frame * 2;
    for (const at of [[t, -frame], [frame, t], [-t, frame], [-frame, -t]] as Pt[]) {
      shapes.push({ kind: 'knot', at, r: radius * 0.055, ink: 'primary' });
    }
  }
  return shapes;
}

/**
 * Counted band: a chain of stepped diamonds between two guide lines, the geometric register
 * that borders a hem or a sleeve. Returns shapes spanning `cells` grid cells wide.
 */
export function countedBand(rng: Rng, cells: number, cell: number): Shape[] {
  const half = 3;
  const period = half * 2 + 2;
  const inks: Ink[] = ['primary', 'dark', 'secondary', 'primary', 'accent', 'accent2'];
  const stitches: Array<[number, number, Ink]> = [];
  const offset = Math.floor(rng() * inks.length);
  for (let i = 0; i * period + half * 2 < cells; i++) {
    const cx = i * period + half;
    const ink = inks[(i + offset) % inks.length];
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > half) continue;
        stitches.push([cx + dx, dy, d === 0 ? 'gold' : d === 1 ? 'dark' : ink]);
      }
    }
    // A single stitch above and below each gap keeps the rhythm going between diamonds.
    stitches.push([cx + half + 1, -half + 1, 'dark'], [cx + half + 1, half - 1, 'dark']);
  }
  const width = cells * cell;
  const shapes: Shape[] = [
    { kind: 'counted', origin: [0, 0], cell, cells: stitches },
    { kind: 'line', points: [[-cell, -(half + 1.4) * cell], [width, -(half + 1.4) * cell]], ink: 'primary', weight: 0.6 },
    { kind: 'line', points: [[-cell, (half + 1.4) * cell], [width, (half + 1.4) * cell]], ink: 'primary', weight: 0.6 },
  ];
  // Fringe: a zigzag edge, each point finished with a sequin.
  const tooth = cell * 2.6;
  const top = (half + 2.2) * cell;
  const fringeInks: Ink[] = ['primary', 'accent', 'secondary', 'accent2'];
  for (let i = 0; i * tooth < width; i++) {
    const x = i * tooth;
    shapes.push({
      kind: 'area',
      points: [[x, top], [x + tooth, top], [x + tooth / 2, top + tooth * 0.8]],
      ink: fringeInks[i % fringeInks.length],
      grain: UP,
    });
    shapes.push({ kind: 'knot', at: [x + tooth / 2, top + tooth * 1.05], r: cell * 0.45, ink: 'gold' });
  }
  return shapes;
}

/**
 * A whole cloth: a medallion above a row of small trees, a counted band and a fringe, with a
 * stitched selvedge down one side. This is the composition a village map or a title card
 * can borrow from.
 */
export function cloth(rng: Rng): Shape[] {
  const shapes: Shape[] = [];
  shapes.push(...place(medallion(rng, 12), { dy: -27 }));
  for (const dx of [-30, 0, 30]) {
    shapes.push(...place(treeOfLife(rng, 23), { dx, dy: 46 }));
  }
  // Loose knots between the trees, the way a maker fills a gap rather than leave it bare.
  for (const dx of [-15, 15]) {
    for (const [ox, oy] of [[0, 0], [-2.4, 3.2], [2.4, 3.2], [0, 6.4]] as const) {
      shapes.push({ kind: 'knot', at: [dx + ox, 30 + oy], r: 0.75, ink: ox === 0 ? 'primary' : 'gold' });
    }
  }
  const cell = 1.2;
  const cells = 78;
  shapes.push(...place(countedBand(rng, cells, cell), { dx: -(cells * cell) / 2, dy: 56 }));

  // Selvedge: alternating small crosses, as on the edge of a towel.
  for (let i = 0; i < 17; i++) {
    const y = -61 + i * 6.6;
    const ink: Ink = i % 2 ? 'dark' : 'accent2';
    shapes.push({ kind: 'line', points: [[-51.4, y], [-48.6, y]], ink, weight: 0.7 });
    shapes.push({ kind: 'line', points: [[-50, y - 1.4], [-50, y + 1.4]], ink, weight: 0.7 });
  }
  return shapes;
}
