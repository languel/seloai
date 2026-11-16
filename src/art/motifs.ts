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

function head(kind: HeadKind, size: number, rng: Rng): Shape[] {
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
    side.push(...place(head(pick(rng, HEAD_KINDS), size, rng), { dx: end[0], dy: end[1], rot: facing }));
    if (rng() < 0.75) {
      const mid = branch[Math.floor(branch.length * 0.5)];
      side.push({ kind: 'line', points: curl(mid, height * 0.045, 0.9, -1, Math.PI * 0.5), ink: 'dark', weight: 0.4 });
    }
    if (rng() < 0.5) side.push({ kind: 'knot', at: [reach * 0.42, y - rise * 1.5], r: height * 0.014, ink: 'gold' });
    shapes.push(...mirrored(side));
  }

  const crown = pick(rng, ['star', 'blossom', 'tulip'] as const);
  shapes.push(...place(head(crown, height * 0.27, rng), { dy: -height * 0.84 }));
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
      ...place(head(axialHead, radius * 0.7, rng), { dy: -radius * 1.5 }),
      ...mirrored([
        { kind: 'line', points: curl([0, -radius * 1.3], radius * 0.2, 0.85, 1, Math.PI), ink: 'dark', weight: 0.4 },
      ]),
    ];
    shapes.push(...place(axial, { rot: (i * Math.PI) / 2 }));

    const diagonal: Shape[] = [
      { kind: 'line', points: quadCurve([0, -radius * 1.25], [radius * 0.34, -radius * 1.6], [0, -radius * 1.95], 10), ink: 'dark', weight: 0.6 },
      ...place(head(diagonalHead, radius * 0.58, rng), { dy: -radius * 1.95 }),
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

export type Expression = 'calm' | 'glad' | 'grim' | 'awed' | 'sly';
export const EXPRESSIONS: readonly Expression[] = ['calm', 'glad', 'grim', 'awed', 'sly'];

export interface FigureOptions {
  /** Overall height in units. */
  height: number;
  /** Mood shown on the face. Chosen from the seed when omitted. */
  expression?: Expression;
  /** Index into the look's skin tones. Chosen from the seed when omitted. */
  skinTone?: number;
}

/** A barely-there face: eyes, brows, a nose stroke and a mouth that carries the mood. */
function face(centre: Pt, r: number, expression: Expression): Shape[] {
  const [cx, cy] = centre;
  const eyeY = cy - r * 0.08;
  const eyeX = r * 0.4;
  const shapes: Shape[] = [];
  const browTilt = { calm: 0, glad: -0.06, grim: 0.2, awed: -0.14, sly: 0.1 }[expression];
  for (const side of [-1, 1] as const) {
    const wide = expression === 'awed' ? 0.15 : 0.11;
    const lidded = expression === 'sly' && side === 1;
    if (lidded) {
      shapes.push({ kind: 'line', points: [[cx + side * eyeX - r * 0.14, eyeY], [cx + side * eyeX + r * 0.14, eyeY]], ink: 'dark', weight: 0.3 });
    } else {
      shapes.push({ kind: 'knot', at: [cx + side * eyeX, eyeY], r: r * wide, ink: 'dark' });
    }
    const browY = eyeY - r * (expression === 'awed' ? 0.42 : 0.3);
    shapes.push({
      kind: 'line',
      points: [
        [cx + side * (eyeX - r * 0.2), browY + r * browTilt * (expression === 'grim' ? -1 : 1)],
        [cx + side * (eyeX + r * 0.2), browY - r * browTilt * (expression === 'grim' ? -1 : 1)],
      ],
      ink: 'dark',
      weight: 0.28,
    });
  }
  shapes.push({ kind: 'line', points: [[cx, eyeY + r * 0.06], [cx - r * 0.07, cy + r * 0.3]], ink: 'dark', weight: 0.25 });

  const mouthY = cy + r * 0.56;
  const mouthW = r * 0.34;
  if (expression === 'awed') {
    shapes.push({ kind: 'knot', at: [cx, mouthY], r: r * 0.12, ink: 'primary' });
  } else {
    const bend = { calm: 0, glad: 0.16, grim: -0.14, sly: 0.1 }[expression];
    const skew = expression === 'sly' ? r * 0.1 : 0;
    shapes.push({
      kind: 'line',
      points: quadCurve([cx - mouthW, mouthY - skew * 0.4], [cx, mouthY + r * bend * 2], [cx + mouthW, mouthY - r * bend * 0.4 - skew], 6),
      ink: 'primary',
      weight: 0.32,
    });
  }
  return shapes;
}

/**
 * A standing figure in the manner of embroidered dancers and the mother-goddess sign:
 * a bell skirt, a small torso, raised or resting arms, a headdress. Every seed is a person.
 */
/** A figure split into parts that can move independently, with the joints they turn about. */
export interface FigureParts {
  legs: Shape[];
  skirt: Shape[];
  torso: Shape[];
  head: Shape[];
  armLeft: Shape[];
  armRight: Shape[];
  pivots: { waist: Pt; neck: Pt; shoulderLeft: Pt; shoulderRight: Pt };
  /** The slight lean this person stands with, in radians about the feet. */
  lean: number;
  /** The expression this person shows when nothing is happening to them. */
  restingExpression: Expression;
}

/** A standing figure drawn as one picture. */
export function figure(rng: Rng, options: FigureOptions): Shape[] {
  const p = figureParts(rng, options);
  return place([...p.legs, ...p.skirt, ...p.torso, ...p.head, ...p.armLeft, ...p.armRight], { rot: p.lean });
}

/**
 * The same figure as `figure`, kept in parts for animation. The seed decides the person;
 * `expression` changes only the face, so a character keeps their looks whatever their mood.
 */
export function figureParts(rng: Rng, options: FigureOptions): FigureParts {
  const { height } = options;
  const skirt: Shape[] = [];
  const legs: Shape[] = [];
  const torso: Shape[] = [];
  const headPart: Shape[] = [];
  let shapes = skirt;
  const skirtW = height * between(rng, 0.4, 0.58);
  const waistW = height * between(rng, 0.1, 0.15);
  const skirtH = height * between(rng, 0.44, 0.52);
  const shoulderY = -height * 0.7;
  const shoulderW = height * between(rng, 0.22, 0.31);
  const skirtInk = pick(rng, ['primary', 'secondary', 'accent2'] as const);
  const bodiceInk = pick(rng, ['secondary', 'accent', 'primary'] as const);

  const widthAt = (y: number) => waistW + (skirtW - waistW) * (1 + y / skirtH);
  const skirtOutline: Pt[] = [[-skirtW / 2, 0], [skirtW / 2, 0], [waistW / 2, -skirtH], [-waistW / 2, -skirtH]];
  // Garments are worked three ways: solid fill, an outline filled with a stitched pattern,
  // or a solid skirt under a contrasting apron.
  const skirtStyle = pick(rng, ['filled', 'filled', 'outlined', 'outlined', 'apron'] as const);
  if (skirtStyle === 'outlined') {
    shapes.push({ kind: 'line', points: skirtOutline, ink: skirtInk, weight: 0.8, closed: true });
    const pattern = pick(rng, ['dots', 'stripes', 'diamonds'] as const);
    if (pattern === 'stripes') {
      const stripes = 3 + Math.floor(rng() * 3);
      for (let i = 1; i <= stripes; i++) {
        const t = i / (stripes + 1) - 0.5;
        shapes.push({ kind: 'line', points: [[t * waistW, -skirtH], [t * skirtW, 0]], ink: i % 2 ? skirtInk : 'gold', weight: 0.45 });
      }
    } else {
      const rows = 4;
      for (let row = 1; row <= rows; row++) {
        const y = -skirtH * (row / (rows + 1));
        const count = row + 1;
        const w = widthAt(y) * 0.72;
        for (let i = 0; i < count; i++) {
          const x = count === 1 ? 0 : -w / 2 + (i / (count - 1)) * w;
          if (pattern === 'dots') {
            shapes.push({ kind: 'knot', at: [x, y], r: height * 0.012, ink: (row + i) % 2 ? skirtInk : 'gold' });
          } else {
            const d = height * 0.022;
            shapes.push({ kind: 'area', points: [[x, y - d], [x + d, y], [x, y + d], [x - d, y]], ink: (row + i) % 2 ? skirtInk : 'accent', grain: UP });
          }
        }
      }
    }
  } else {
    shapes.push({ kind: 'area', points: skirtOutline, ink: skirtInk, grain: UP });
    if (skirtStyle === 'apron') {
      const apronInk = pick(rng, ['gold', 'accent', 'secondary', 'primary'] as const);
      const top = -skirtH * 0.92;
      const bottom = -skirtH * 0.08;
      const apron: Pt[] = [
        [-widthAt(bottom) * 0.3, bottom],
        [widthAt(bottom) * 0.3, bottom],
        [widthAt(top) * 0.4, top],
        [-widthAt(top) * 0.4, top],
      ];
      shapes.push({ kind: 'area', points: apron, ink: apronInk === skirtInk ? 'gold' : apronInk, grain: 0 });
      shapes.push({ kind: 'line', points: apron, ink: 'dark', weight: 0.35, closed: true });
    }
  }
  const bands = 1 + Math.floor(rng() * 3);
  for (let i = 1; i <= bands; i++) {
    const y = -skirtH * (i / (bands + 1)) * 0.85;
    shapes.push({ kind: 'line', points: [[-widthAt(y) / 2, y], [widthAt(y) / 2, y]], ink: 'gold', weight: 0.7 });
  }
  for (const side of [-1, 1] as const) {
    const bx = side * skirtW * 0.17;
    legs.push({
      kind: 'area',
      points: [[bx - height * 0.035, 0], [bx + height * 0.035, 0], [bx + side * height * 0.075, height * 0.055], [bx - height * 0.04, height * 0.055]],
      ink: 'dark',
      grain: 0,
    });
  }
  const hemKnots = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < hemKnots; i++) {
    const x = -skirtW / 2 + ((i + 0.5) / hemKnots) * skirtW;
    shapes.push({ kind: 'knot', at: [x, -height * 0.035], r: height * 0.013, ink: i % 2 ? 'gold' : 'primary' });
  }

  shapes = torso;
  const bodice: Pt[] = [[-waistW / 2, -skirtH], [waistW / 2, -skirtH], [shoulderW / 2, shoulderY], [-shoulderW / 2, shoulderY]];
  if (rng() < 0.35) {
    // An open bodice: outline with a stitched placket down the front.
    shapes.push({ kind: 'line', points: bodice, ink: bodiceInk, weight: 0.8, closed: true });
    for (let i = 1; i <= 3; i++) {
      shapes.push({ kind: 'knot', at: [0, -skirtH + ((shoulderY + skirtH) * i) / 4], r: height * 0.011, ink: 'primary' });
    }
  } else {
    shapes.push({ kind: 'area', points: bodice, ink: bodiceInk, grain: 0 });
  }
  shapes.push({ kind: 'line', points: [[-waistW * 0.7, -skirtH], [waistW * 0.7, -skirtH]], ink: 'gold', weight: 1 });

  const headR = height * between(rng, 0.115, 0.14);
  const headY = shoulderY - headR * 1.12;
  // Draw from the seed even when overridden, so that every other trait stays the same.
  const restingExpression = pick(rng, EXPRESSIONS);
  const seededSkinTone = Math.floor(rng() * 5);
  const expression = options.expression ?? restingExpression;
  const skinTone = options.skinTone ?? seededSkinTone;
  const hairInk = pick(rng, ['dark', 'dark', 'gold', 'accent'] as const);
  shapes.push({
    kind: 'area',
    points: [[-headR * 0.3, shoulderY + headR * 0.1], [headR * 0.3, shoulderY + headR * 0.1], [headR * 0.3, headY + headR * 0.7], [-headR * 0.3, headY + headR * 0.7]],
    ink: 'skin',
    grain: UP,
    tone: skinTone,
  });
  shapes = headPart;
  shapes.push({ kind: 'area', points: circle([0, headY], headR, 18), ink: 'skin', grain: 0, tone: skinTone });
  // Hair: a cap over the crown, and for some a fall of hair to the shoulders.
  const hairline = headY - headR * 0.28;
  const cap: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    cap.push([Math.cos(a) * headR * 1.08, headY + Math.sin(a) * headR * 1.08]);
  }
  cap.push([headR * 1.08, hairline], [headR * 0.4, hairline - headR * 0.18], [-headR * 0.4, hairline - headR * 0.18], [-headR * 1.08, hairline]);
  shapes.push({ kind: 'area', points: cap, ink: hairInk, grain: UP });
  if (rng() < 0.55) {
    shapes.push(
      ...mirrored([
        { kind: 'line', points: quadCurve([headR * 1.02, hairline], [headR * 1.35, headY + headR * 0.7], [headR * 0.95, headY + headR * 1.7], 6), ink: hairInk, weight: 0.8 },
      ]),
    );
  }
  shapes.push(...face([0, headY], headR, expression));

  const headdress = pick(rng, ['crown', 'kerchief', 'horns', 'wreath'] as const);
  if (headdress === 'crown') {
    for (const dx of [-1, 0, 1]) {
      shapes.push({ kind: 'knot', at: [dx * headR * 0.9, headY - headR * (dx === 0 ? 1.75 : 1.4)], r: headR * 0.3, ink: 'gold' });
    }
  } else if (headdress === 'kerchief') {
    shapes.push({
      kind: 'area',
      points: [[-headR * 1.35, headY - headR * 0.1], [0, headY - headR * 2], [headR * 1.35, headY - headR * 0.1]],
      ink: 'primary',
      grain: UP,
    });
  } else if (headdress === 'horns') {
    shapes.push(
      ...mirrored([
        { kind: 'line', points: curl([headR * 0.5, headY - headR * 0.9], headR * 0.75, 0.7, -1, Math.PI), ink: 'dark', weight: 0.6 },
      ]),
    );
  } else {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      shapes.push({ kind: 'knot', at: [Math.cos(a) * headR * 1.45, headY + Math.sin(a) * headR * 1.45], r: headR * 0.22, ink: i % 2 ? 'accent' : 'primary' });
    }
  }

  // Arms are sleeves with some cloth to them: either the white chemise sleeve (an outline
  // with embroidered cuff bands) or a filled sleeve in the bodice colour, ending in a hand.
  const pose = pick(rng, ['raised', 'offering', 'akimbo', 'resting'] as const);
  const sleeveFilled = rng() < 0.4;
  const shoulder: Pt = [shoulderW / 2 - height * 0.01, shoulderY + height * 0.03];
  const armPath: Pt[] =
    pose === 'raised'
      ? [shoulder, [shoulderW / 2 + height * 0.13, shoulderY + height * 0.06], [shoulderW / 2 + height * 0.2, shoulderY - height * 0.13]]
      : pose === 'offering'
        ? [shoulder, [shoulderW / 2 + height * 0.1, shoulderY + height * 0.14], [shoulderW / 2 + height * 0.21, shoulderY + height * 0.1]]
        : pose === 'akimbo'
          ? [shoulder, [shoulderW / 2 + height * 0.15, -skirtH - height * 0.08], [waistW / 2 + height * 0.02, -skirtH - height * 0.01]]
          : [shoulder, [shoulderW / 2 + height * 0.07, shoulderY + height * 0.16], [shoulderW / 2 + height * 0.05, -skirtH + height * 0.08]];
  const arm: Shape[] = [];
  const widths = [height * 0.075, height * 0.085, height * 0.05];
  const left: Pt[] = [];
  const right: Pt[] = [];
  armPath.forEach((p, i) => {
    const prev = armPath[Math.max(0, i - 1)];
    const next = armPath[Math.min(armPath.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * widths[i] * 0.5;
    const ny = (dx / len) * widths[i] * 0.5;
    left.push([p[0] + nx, p[1] + ny]);
    right.push([p[0] - nx, p[1] - ny]);
  });
  const sleeve = [...left, ...right.reverse()];
  if (sleeveFilled) {
    arm.push({ kind: 'area', points: sleeve, ink: bodiceInk, grain: 0 });
  } else {
    arm.push({ kind: 'line', points: sleeve, ink: 'dark', weight: 0.45, closed: true });
  }
  // Cuff bands across the forearm.
  for (const t of [0.55, 0.78]) {
    const a0 = armPath[1];
    const a1 = armPath[2];
    const mx = a0[0] + (a1[0] - a0[0]) * t;
    const my = a0[1] + (a1[1] - a0[1]) * t;
    const dx = a1[0] - a0[0];
    const dy = a1[1] - a0[1];
    const len = Math.hypot(dx, dy) || 1;
    const half = height * 0.03;
    arm.push({ kind: 'line', points: [[mx - (dy / len) * half, my + (dx / len) * half], [mx + (dy / len) * half, my - (dx / len) * half]], ink: sleeveFilled ? 'gold' : 'primary', weight: 0.55 });
  }
  const hand = armPath[2];
  arm.push({ kind: 'area', points: circle(hand, height * 0.03, 10), ink: 'skin', grain: 0, tone: skinTone });
  if (pose === 'raised' && rng() < 0.6) {
    arm.push(...place(comb(height * 0.085, 'primary'), { dx: hand[0], dy: hand[1] - height * 0.02 }));
  } else if (pose === 'offering') {
    arm.push({ kind: 'line', points: [hand, [hand[0], hand[1] - height * 0.15]], ink: 'dark', weight: 0.45 });
    arm.push(...place(head(pick(rng, ['tulip', 'blossom', 'star'] as const), height * 0.085, rng), { dx: hand[0], dy: hand[1] - height * 0.15 }));
  }
  // Nobody stands perfectly straight: a slight lean about the feet.
  const lean = (rng() - 0.5) * 0.09;
  return {
    legs,
    skirt,
    torso,
    head: headPart,
    armLeft: place(arm, { mirrorX: true }),
    armRight: arm,
    pivots: {
      waist: [0, -skirtH],
      neck: [0, shoulderY],
      shoulderLeft: [-shoulder[0], shoulder[1]],
      shoulderRight: shoulder,
    },
    lean,
    restingExpression,
  };
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
