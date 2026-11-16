/**
 * People, in the manner of embroidered dancers and the mother-goddess sign. A seed decides
 * the person; the options decide how they are shown: the expression, a skirted or trousered
 * build, and whether they face us, turn side-on, or walk away.
 *
 * Every trait is drawn from the seed first, in a fixed order (`drawTraits`), and only then
 * turned into shapes. That keeps a person the same person in every view and every mood.
 */
import type { Rng } from '../core/rng';
import { comb, flowerHead } from './motifs';
import { circle, curl, mirrored, place, quadCurve, type Ink, type Pt, type Shape } from './shapes';

const UP = -Math.PI / 2;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export type Expression = 'calm' | 'glad' | 'grim' | 'awed' | 'sly';
export const EXPRESSIONS: readonly Expression[] = ['calm', 'glad', 'grim', 'awed', 'sly'];

/** Skirted: the bell skirt and bodice. Trousered: shirt, vest, sash, trousers and boots. */
export type FigureBuild = 'skirted' | 'trousered';
/** Front faces us; side is in profile facing right (mirror it for left); back walks away. */
export type FigureView = 'front' | 'side' | 'back';

/**
 * What sort of being the figure is. A world pack picks this per cast member; the figure code
 * only knows how to draw each kind. `human` is the default villager.
 */
export type FigureKind = 'human' | 'serpent' | 'kuker' | 'samodiva';
export const FIGURE_KINDS: readonly FigureKind[] = ['human', 'serpent', 'kuker', 'samodiva'];

export interface FigureOptions {
  /** Overall height in units. */
  height: number;
  kind?: FigureKind;
  /** Mood shown on the face. Chosen from the seed when omitted. */
  expression?: Expression;
  /** Index into the look's skin tones. Chosen from the seed when omitted. */
  skinTone?: number;
  build?: FigureBuild;
  view?: FigureView;
  /**
   * `bold` is for figures seen small (about 60 pixels tall or less on screen): a slightly
   * larger head, bigger eyes, a heavier mouth that carries the mood, and no nose, so the
   * face still reads. The default `full` keeps every mark.
   */
  detail?: FigureDetail;
}

export type FigureDetail = 'full' | 'bold';

/** A figure split into parts that can move independently, with the joints they turn about. */
export interface FigureParts {
  legLeft: Shape[];
  legRight: Shape[];
  skirt: Shape[];
  torso: Shape[];
  head: Shape[];
  armLeft: Shape[];
  armRight: Shape[];
  pivots: { waist: Pt; neck: Pt; shoulderLeft: Pt; shoulderRight: Pt; hipLeft: Pt; hipRight: Pt };
  /** The slight lean this person stands with, in radians about the feet. */
  lean: number;
  /** The expression this person shows when nothing is happening to them. */
  restingExpression: Expression;
}

type BaseHeaddress = 'crown' | 'kerchief' | 'horns' | 'wreath';
/** Women's headdresses: the four originals and five more; horns are now a rare one. */
type Headdress = BaseHeaddress | 'sokai' | 'coins' | 'sprig' | 'veil' | 'braids';
/**
 * How much of each original choice a skirted figure keeps; the rest of that draw goes to the
 * newer headdresses. Horns keep only a sliver, so a horned woman is a rare sight.
 */
const KEEP_SHARE: Record<BaseHeaddress, number> = { crown: 0.55, kerchief: 0.6, wreath: 0.55, horns: 0.1 };
const NEWER_HEADDRESSES: readonly Headdress[] = ['sokai', 'coins', 'sprig', 'veil', 'braids'];
type Pose = 'raised' | 'offering' | 'akimbo' | 'resting';

interface Traits {
  skirtW: number;
  waistW: number;
  skirtH: number;
  shoulderW: number;
  skirtInk: Ink;
  bodiceInk: Ink;
  skirtStyle: 'filled' | 'outlined' | 'apron';
  pattern?: 'dots' | 'stripes' | 'diamonds';
  stripes?: number;
  apronInk?: Ink;
  bands: number;
  hemKnots: number;
  openBodice: boolean;
  headR: number;
  restingExpression: Expression;
  seededSkinTone: number;
  hairInk: Ink;
  /** Long hair falling to the shoulders; on a trousered figure, a moustache. */
  hairFalls: boolean;
  /** What a skirted figure wears on her head. */
  headdress: Headdress;
  /** The four-way choice the seed made, which trousered figures read. */
  baseHeaddress: BaseHeaddress;
  pose: Pose;
  sleeveFilled: boolean;
  carriesComb: boolean;
  flower: Shape[] | null;
  lean: number;
  /** Hair to the waist (a samodiva). Set by the kind, never drawn from the seed. */
  longHair?: boolean;
  /** Draw for a small size. Set from the options, never drawn from the seed. */
  bold?: boolean;
}

/** Every random choice about a person, always drawn in this order. */
function drawTraits(rng: Rng, height: number): Traits {
  const skirtW = height * between(rng, 0.4, 0.58);
  const waistW = height * between(rng, 0.1, 0.15);
  const skirtH = height * between(rng, 0.44, 0.52);
  const shoulderW = height * between(rng, 0.22, 0.31);
  const skirtInk = pick(rng, ['primary', 'secondary', 'accent2'] as const);
  const bodiceInk = pick(rng, ['secondary', 'accent', 'primary'] as const);
  const skirtStyle = pick(rng, ['filled', 'filled', 'outlined', 'outlined', 'apron'] as const);
  let pattern: Traits['pattern'];
  let stripes: number | undefined;
  let apronInk: Ink | undefined;
  if (skirtStyle === 'outlined') {
    pattern = pick(rng, ['dots', 'stripes', 'diamonds'] as const);
    if (pattern === 'stripes') stripes = 3 + Math.floor(rng() * 3);
  } else if (skirtStyle === 'apron') {
    apronInk = pick(rng, ['gold', 'accent', 'secondary', 'primary'] as const);
  }
  const bands = 1 + Math.floor(rng() * 3);
  const hemKnots = 5 + Math.floor(rng() * 4);
  const openBodice = rng() < 0.35;
  const headR = height * between(rng, 0.115, 0.14);
  const restingExpression = pick(rng, EXPRESSIONS);
  const seededSkinTone = Math.floor(rng() * 5);
  const hairInk = pick(rng, ['dark', 'dark', 'gold', 'accent'] as const);
  const hairFalls = rng() < 0.55;
  // One draw, as before, so nothing else about a person shifts. The rest of that same draw
  // decides whether she keeps the original choice or wears one of the newer headdresses.
  const headdressDraw = rng();
  const baseHeaddress = (['crown', 'kerchief', 'horns', 'wreath'] as const)[Math.floor(headdressDraw * 4)];
  const rest = (headdressDraw * 4) % 1;
  const keep = KEEP_SHARE[baseHeaddress];
  const headdress: Headdress =
    rest < keep ? baseHeaddress : NEWER_HEADDRESSES[Math.min(NEWER_HEADDRESSES.length - 1, Math.floor(((rest - keep) / (1 - keep)) * NEWER_HEADDRESSES.length))];
  const pose = pick(rng, ['raised', 'offering', 'akimbo', 'resting'] as const);
  const sleeveFilled = rng() < 0.4;
  let carriesComb = false;
  let flower: Shape[] | null = null;
  if (pose === 'raised') carriesComb = rng() < 0.6;
  else if (pose === 'offering') flower = flowerHead(pick(rng, ['tulip', 'blossom', 'star'] as const), height * 0.085, rng);
  const lean = (rng() - 0.5) * 0.09;
  return {
    skirtW,
    waistW,
    skirtH,
    shoulderW,
    skirtInk,
    bodiceInk,
    skirtStyle,
    pattern,
    stripes,
    apronInk,
    bands,
    hemKnots,
    openBodice,
    headR,
    restingExpression,
    seededSkinTone,
    hairInk,
    hairFalls,
    headdress,
    baseHeaddress,
    pose,
    sleeveFilled,
    carriesComb,
    flower,
    lean,
  };
}

/** Squeezes shapes horizontally and shifts them: a front drawing turned side-on. */
function squeezeX(shapes: Shape[], k: number, dx = 0): Shape[] {
  const p = ([x, y]: Pt): Pt => [x * k + dx, y];
  return shapes.map((s): Shape => {
    switch (s.kind) {
      case 'area':
        return { ...s, points: s.points.map(p) };
      case 'line':
        return { ...s, points: s.points.map(p) };
      case 'knot':
        return { ...s, at: p(s.at), r: s.r * Math.max(0.75, k) };
      case 'counted':
        return s;
    }
  });
}

/** A barely-there face: eyes, brows, a nose stroke and a mouth that carries the mood. */
function face(centre: Pt, r: number, expression: Expression, bold = false): Shape[] {
  const [cx, cy] = centre;
  const eyeY = cy - r * 0.08;
  const eyeX = r * 0.4;
  const shapes: Shape[] = [];
  const browTilt = { calm: 0, glad: -0.06, grim: 0.2, awed: -0.14, sly: 0.1 }[expression] * (bold ? 1.6 : 1);
  // Seen small, only the brows that change the mood are worth their thread.
  const brows = !bold || expression === 'grim' || expression === 'awed' || expression === 'sly';
  for (const side of [-1, 1] as const) {
    const wide = bold ? (expression === 'awed' ? 0.21 : 0.19) : expression === 'awed' ? 0.15 : 0.11;
    const lidded = expression === 'sly' && side === 1;
    if (lidded) {
      shapes.push({ kind: 'line', points: [[cx + side * eyeX - r * 0.14, eyeY], [cx + side * eyeX + r * 0.14, eyeY]], ink: 'dark', weight: bold ? 0.6 : 0.3 });
    } else {
      shapes.push({ kind: 'knot', at: [cx + side * eyeX, eyeY], r: r * wide, ink: 'dark' });
    }
    if (!brows) continue;
    const browY = eyeY - r * (expression === 'awed' ? 0.42 : 0.3) - (bold ? r * 0.06 : 0);
    shapes.push({
      kind: 'line',
      points: [
        [cx + side * (eyeX - r * 0.2), browY + r * browTilt * (expression === 'grim' ? -1 : 1)],
        [cx + side * (eyeX + r * 0.2), browY - r * browTilt * (expression === 'grim' ? -1 : 1)],
      ],
      ink: 'dark',
      weight: bold ? 0.55 : 0.28,
    });
  }
  if (!bold) shapes.push({ kind: 'line', points: [[cx, eyeY + r * 0.06], [cx - r * 0.07, cy + r * 0.3]], ink: 'dark', weight: 0.25 });

  const mouthY = cy + r * (bold ? 0.5 : 0.56);
  const mouthW = r * (bold ? 0.4 : 0.34);
  if (expression === 'awed') {
    shapes.push({ kind: 'knot', at: [cx, mouthY], r: r * (bold ? 0.2 : 0.12), ink: 'primary' });
  } else {
    const bend = { calm: 0, glad: 0.16, grim: -0.14, sly: 0.1 }[expression] * (bold ? 1.5 : 1);
    const skew = expression === 'sly' ? r * (bold ? 0.16 : 0.1) : 0;
    shapes.push({
      kind: 'line',
      points: quadCurve([cx - mouthW, mouthY - skew * 0.4], [cx, mouthY + r * bend * 2], [cx + mouthW, mouthY - r * bend * 0.4 - skew], 6),
      ink: 'primary',
      weight: bold ? 0.65 : 0.32,
    });
  }
  return shapes;
}

/** The same face in profile, looking right: one eye, a nose that breaks the outline. */
function profileFace(centre: Pt, r: number, expression: Expression, skinTone: number, bold = false): Shape[] {
  const [cx, cy] = centre;
  const eyeY = cy - r * 0.08;
  const shapes: Shape[] = [];
  shapes.push({
    kind: 'area',
    points: [[cx + r * 0.86, cy - r * 0.18], [cx + r * 1.2, cy + r * 0.2], [cx + r * 0.88, cy + r * 0.32]],
    ink: 'skin',
    grain: 0,
    tone: skinTone,
  });
  if (expression === 'sly') {
    shapes.push({ kind: 'line', points: [[cx + r * 0.32, eyeY], [cx + r * 0.58, eyeY]], ink: 'dark', weight: bold ? 0.6 : 0.3 });
  } else {
    shapes.push({ kind: 'knot', at: [cx + r * 0.46, eyeY], r: r * (expression === 'awed' ? 0.15 : 0.11) * (bold ? 1.7 : 1), ink: 'dark' });
  }
  const tilt = { calm: 0, glad: -0.05, grim: 0.18, awed: -0.14, sly: 0.08 }[expression];
  const browY = eyeY - r * (expression === 'awed' ? 0.42 : 0.3);
  if (!bold || expression !== 'calm') {
    shapes.push({ kind: 'line', points: [[cx + r * 0.28, browY - r * tilt], [cx + r * 0.66, browY + r * tilt]], ink: 'dark', weight: bold ? 0.55 : 0.28 });
  }
  const mouthY = cy + r * 0.56;
  if (expression === 'awed') {
    shapes.push({ kind: 'knot', at: [cx + r * 0.74, mouthY], r: r * (bold ? 0.17 : 0.1), ink: 'primary' });
  } else {
    const bend = { calm: 0, glad: 0.14, grim: -0.12, sly: 0.08 }[expression];
    shapes.push({
      kind: 'line',
      points: quadCurve([cx + r * 0.5, mouthY - r * bend], [cx + r * 0.66, mouthY + r * bend], [cx + r * 0.84, mouthY], 4),
      ink: 'primary',
      weight: bold ? 0.6 : 0.32,
    });
  }
  return shapes;
}

function headdressShapes(t: Traits, headY: number, view: FigureView, build: FigureBuild): Shape[] {
  const r = t.headR;
  const shapes: Shape[] = [];
  if (build === 'trousered') {
    // Men's headwear from the same choice: a fur kalpak, a flat cap, horns, or bare-headed
    // with a flower tucked at the ear.
    if (t.baseHeaddress === 'crown') {
      const lean = view === 'side' ? -r * 0.25 : 0;
      shapes.push({
        kind: 'area',
        points: [
          [-r * 1.0, headY - r * 0.55],
          [r * 1.0, headY - r * 0.55],
          [r * 0.95 + lean, headY - r * 1.75],
          [r * 0.55 + lean, headY - r * 2.15],
          [-r * 0.55 + lean, headY - r * 2.15],
          [-r * 0.95 + lean, headY - r * 1.75],
        ],
        ink: 'dark',
        grain: UP,
      });
    } else if (t.baseHeaddress === 'kerchief') {
      const brim = view === 'side' ? r * 1.35 : r * 1.15;
      const back = view === 'side' ? -r * 1.05 : -r * 1.15;
      shapes.push({
        kind: 'area',
        points: [[back, headY - r * 0.45], [brim, headY - r * 0.45], [r * 0.8, headY - r * 1.25], [-r * 0.85, headY - r * 1.25]],
        ink: t.bodiceInk === 'primary' ? 'dark' : t.bodiceInk,
        grain: 0,
      });
      shapes.push({ kind: 'line', points: [[back, headY - r * 0.5], [brim, headY - r * 0.5]], ink: 'gold', weight: 0.5 });
    } else if (t.baseHeaddress === 'horns') {
      const horn: Shape = { kind: 'line', points: curl([r * 0.5, headY - r * 0.9], r * 0.75, 0.7, -1, Math.PI), ink: 'dark', weight: 0.6 };
      shapes.push(...(view === 'side' ? [horn] : mirrored([horn])));
    } else if (view !== 'back') {
      const x = view === 'side' ? -r * 0.15 : r * 0.95;
      shapes.push({ kind: 'knot', at: [x, headY - r * 0.55], r: r * 0.26, ink: 'primary' });
      shapes.push({ kind: 'knot', at: [x + r * 0.28, headY - r * 0.35], r: r * 0.16, ink: 'accent' });
    }
    return shapes;
  }
  if (t.headdress === 'crown') {
    const xs = view === 'side' ? [-0.6, 0.05, 0.6] : [-1, 0, 1];
    xs.forEach((dx, i) => {
      shapes.push({ kind: 'knot', at: [dx * r * 0.9, headY - r * (i === 1 ? 1.75 : 1.4)], r: r * 0.3, ink: 'gold' });
    });
  } else if (t.headdress === 'kerchief') {
    const points: Pt[] =
      view === 'side'
        ? [[r * 0.75, headY - r * 0.75], [-r * 0.2, headY - r * 1.6], [-r * 1.55, headY + r * 0.35], [-r * 0.6, headY + r * 0.1]]
        : [[-r * 1.35, headY - r * 0.1], [0, headY - r * 2], [r * 1.35, headY - r * 0.1]];
    shapes.push({ kind: 'area', points, ink: 'primary', grain: UP });
  } else if (t.headdress === 'horns') {
    const horn: Shape = { kind: 'line', points: curl([r * 0.5, headY - r * 0.9], r * 0.75, 0.7, -1, Math.PI), ink: 'dark', weight: 0.6 };
    shapes.push(...(view === 'side' ? [horn] : mirrored([horn])));
  } else if (t.headdress !== 'wreath') {
    shapes.push(...newerHeaddress(t, headY, view));
  } else {
    const count = view === 'side' ? 5 : 7;
    for (let i = 0; i < count; i++) {
      const a = Math.PI + (i / (count - 1)) * Math.PI;
      const x = Math.cos(a) * r * 1.45 * (view === 'side' ? 0.8 : 1);
      shapes.push({ kind: 'knot', at: [x, headY + Math.sin(a) * r * 1.45], r: r * 0.22, ink: i % 2 ? 'accent' : 'primary' });
    }
  }
  return shapes;
}

/**
 * The newer women's headdresses, after regional dress: a tall wrapped sokai hung with
 * coins, a band of coins over the brow with braids, a sprig of flowers (a kitka) at the
 * ear, an embroidered veil framing the face, and braids wound round the crown.
 */
function newerHeaddress(t: Traits, headY: number, view: FigureView): Shape[] {
  const r = t.headR;
  const out: Shape[] = [];
  const side = view === 'side';
  const back = view === 'back';
  const k = side ? 0.78 : 1;
  const dx = side ? -r * 0.2 : 0;
  if (t.headdress === 'sokai') {
    out.push({
      kind: 'area',
      points: [[-r * 1.15 * k + dx, headY - r * 0.45], [r * 1.15 * k + dx, headY - r * 0.45], [r * 0.95 * k + dx, headY - r * 2.3], [-r * 0.95 * k + dx, headY - r * 2.3]],
      ink: t.bodiceInk === 'primary' ? 'secondary' : 'primary',
      grain: 0,
    });
    for (const [row, y] of [[0, 0.95], [1, 1.6]] as const) {
      const n = side ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const x = (-0.8 + (1.6 * i) / (n - 1)) * r * k + dx;
        out.push({ kind: 'knot', at: [x, headY - r * y], r: r * (row ? 0.12 : 0.15), ink: 'gold' });
      }
    }
    out.push({ kind: 'line', points: [[-r * 0.95 * k + dx, headY - r * 2.3], [r * 0.95 * k + dx, headY - r * 2.3]], ink: 'gold', weight: 0.6 });
    if (back || side) {
      const bx = side ? -r * 0.9 : 0;
      out.push({ kind: 'area', points: [[bx - r * 0.3, headY - r * 0.5], [bx + r * 0.3, headY - r * 0.5], [bx + r * 0.35, headY + r * 1.7], [bx - r * 0.35, headY + r * 1.7]], ink: 'primary', grain: Math.PI / 2 });
    }
  } else if (t.headdress === 'coins') {
    const span = side ? [-r * 0.2, r * 1.0] : [-r * 1.0, r * 1.0];
    const band: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const x = span[0] + ((span[1] - span[0]) * i) / 8;
      band.push([x, headY - r * 0.62 + Math.pow(x / r, 2) * r * 0.12]);
    }
    out.push({ kind: 'line', points: band, ink: 'gold', weight: 0.7 });
    if (!back) {
      for (let i = 1; i < band.length - 1; i++) out.push({ kind: 'knot', at: [band[i][0], band[i][1] + r * 0.16], r: r * 0.11, ink: 'gold' });
    }
    // Two braids, tied with red thread.
    const braids = side ? [-r * 0.85] : back ? [-r * 0.25, r * 0.25] : [-r * 1.0, r * 1.0];
    for (const x of braids) {
      out.push({ kind: 'line', points: [[x, headY + r * 0.1], [x * 1.05, headY + r * 2.1]], ink: t.hairInk, weight: 0.9 });
      out.push({ kind: 'knot', at: [x * 1.05, headY + r * 2.15], r: r * 0.14, ink: 'primary' });
    }
  } else if (t.headdress === 'sprig') {
    const cx = side ? -r * 0.55 : r * 0.95;
    const blossoms: Pt[] = [[cx, headY - r * 0.7], [cx + r * 0.32, headY - r * 0.32], [cx - r * 0.18, headY - r * 1.08]];
    out.push({ kind: 'line', points: [[cx - r * 0.2, headY - r * 0.2], [cx + r * 0.25, headY - r * 1.25]], ink: 'accent', weight: 0.5 });
    blossoms.forEach(([x, y], i) => {
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        out.push({ kind: 'knot', at: [x + Math.cos(a) * r * 0.16, y + Math.sin(a) * r * 0.16], r: r * 0.1, ink: i === 1 ? 'accent2' : 'primary' });
      }
      out.push({ kind: 'knot', at: [x, y], r: r * 0.08, ink: 'gold' });
    });
  } else if (t.headdress === 'veil') {
    const ink: Ink = t.bodiceInk === 'secondary' ? 'accent' : 'secondary';
    const points: Pt[] = back
      ? [[-r * 1.25, headY + r * 1.4], [-r * 1.15, headY - r * 0.4], [-r * 0.6, headY - r * 1.25], [r * 0.6, headY - r * 1.25], [r * 1.15, headY - r * 0.4], [r * 1.25, headY + r * 1.4]]
      : side
        ? [[-r * 1.4, headY + r * 1.4], [-r * 1.2, headY - r * 0.5], [-r * 0.5, headY - r * 1.25], [r * 0.55, headY - r * 1.15], [r * 0.7, headY - r * 0.75], [-r * 0.2, headY - r * 0.55], [-r * 0.75, headY + r * 1.35]]
        : [
            [-r * 1.25, headY + r * 1.4], [-r * 1.15, headY - r * 0.4], [-r * 0.6, headY - r * 1.25], [r * 0.6, headY - r * 1.25], [r * 1.15, headY - r * 0.4], [r * 1.25, headY + r * 1.4],
            [r * 0.98, headY + r * 1.3], [r * 0.98, headY - r * 0.3], [-r * 0.98, headY - r * 0.3], [-r * 0.98, headY + r * 1.3],
          ];
    out.push({ kind: 'area', points, ink, grain: UP });
    if (!back) {
      const n = side ? 4 : 7;
      for (let i = 0; i < n; i++) {
        const x = side ? -r * 0.15 + (i / (n - 1)) * r * 0.75 : -r * 0.85 + (i / (n - 1)) * r * 1.7;
        out.push({ kind: 'knot', at: [x, headY - r * (side ? 0.72 : 0.42)], r: r * 0.1, ink: i % 2 ? 'gold' : 'primary' });
      }
    }
  } else if (t.headdress === 'braids') {
    const count = side ? 7 : 9;
    for (let i = 0; i < count; i++) {
      const a = Math.PI * 1.05 + (i / (count - 1)) * Math.PI * 0.9;
      const x = Math.cos(a) * r * 1.02 * (side ? 0.85 : 1) + dx * 0.5;
      out.push({ kind: 'knot', at: [x, headY + Math.sin(a) * r * 1.02], r: r * 0.22, ink: t.hairInk });
      if (i % 2) out.push({ kind: 'knot', at: [x, headY + Math.sin(a) * r * 1.02], r: r * 0.08, ink: 'gold' });
    }
    out.push({ kind: 'knot', at: [side ? -r * 0.95 : r * 0.85, headY - r * 0.75], r: r * 0.16, ink: 'primary' });
  }
  return out;
}

function headShapes(t: Traits, headY: number, view: FigureView, build: FigureBuild, expression: Expression, skinTone: number): Shape[] {
  const r = t.headR;
  const shapes: Shape[] = [];
  shapes.push({ kind: 'area', points: circle([0, headY], r, 18), ink: 'skin', grain: 0, tone: skinTone });
  const long = build === 'skirted' && t.hairFalls;
  const fall = (x: number, flare: number, drop: number): Shape => ({
    kind: 'line',
    points: quadCurve([x, headY - r * 0.28], [x + flare, headY + r * 0.7], [x * 0.93, headY + r * drop], 6),
    ink: t.hairInk,
    weight: 0.8,
  });

  if (view === 'back') {
    // From behind: the whole crown in hair, cropped short at the nape on a trousered figure.
    const crown = circle([0, headY - r * 0.04], r * 1.07, 18);
    const nape = headY + r * (build === 'trousered' ? 0.3 : 1.1);
    shapes.push({ kind: 'area', points: crown.map(([x, y]): Pt => [x, Math.min(y, nape)]), ink: t.hairInk, grain: UP });
    const drop = t.longHair ? 4.2 : 1.9;
    if (long) shapes.push(...mirrored([fall(r * 0.8, r * 0.45, drop)]));
    if (long) shapes.push({ kind: 'line', points: [[0, headY + r * 0.6], [0, headY + r * (drop + 0.2)]], ink: t.hairInk, weight: 0.9 });
  } else if (view === 'side') {
    const cap: Pt[] = [];
    const sweep = build === 'trousered' ? 0.85 : 1.1;
    for (let i = 0; i <= 12; i++) {
      const a = -0.38 * Math.PI - (i / 12) * sweep * Math.PI;
      cap.push([Math.cos(a) * r * 1.08, headY + Math.sin(a) * r * 1.08]);
    }
    cap.push([-r * 0.15, headY + r * 0.2], [r * 0.05, headY - r * 0.45]);
    shapes.push({ kind: 'area', points: cap, ink: t.hairInk, grain: UP });
    if (long) shapes.push(fall(-r * 0.95, -r * 0.35, t.longHair ? 4 : 1.8));
    shapes.push(...profileFace([0, headY], r, expression, skinTone, t.bold));
    if (build === 'trousered' && t.hairFalls) {
      shapes.push({ kind: 'line', points: quadCurve([r * 0.95, headY + r * 0.38], [r * 0.82, headY + r * 0.5], [r * 0.6, headY + r * 0.58], 4), ink: t.hairInk, weight: 0.55 });
    }
  } else {
    // Hair: a cap over the crown, and for some a fall of hair to the shoulders.
    const hairline = headY - r * (build === 'trousered' ? 0.42 : 0.28);
    const cap: Pt[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + (i / 12) * Math.PI;
      cap.push([Math.cos(a) * r * 1.08, headY + Math.sin(a) * r * 1.08]);
    }
    cap.push([r * 1.08, hairline], [r * 0.4, hairline - r * 0.18], [-r * 0.4, hairline - r * 0.18], [-r * 1.08, hairline]);
    shapes.push({ kind: 'area', points: cap, ink: t.hairInk, grain: UP });
    if (long) {
      shapes.push(
        ...mirrored([
          {
            kind: 'line',
            points: quadCurve([r * 1.02, hairline], [r * (t.longHair ? 1.6 : 1.35), headY + r * (t.longHair ? 1.6 : 0.7)], [r * (t.longHair ? 1.25 : 0.95), headY + r * (t.longHair ? 4 : 1.7)], t.longHair ? 8 : 6),
            ink: t.hairInk,
            weight: t.longHair ? 1 : 0.8,
          },
        ]),
      );
    }
    shapes.push(...face([0, headY], r, expression, t.bold));
    if (build === 'trousered' && t.hairFalls) {
      // A moustache, curled at the ends.
      shapes.push(
        ...mirrored([
          { kind: 'line', points: quadCurve([r * 0.04, headY + r * 0.4], [r * 0.3, headY + r * 0.36], [r * 0.46, headY + r * 0.52], 5), ink: t.hairInk, weight: 0.55 },
        ]),
      );
    }
  }
  shapes.push(...headdressShapes(t, headY, view, build));
  return shapes;
}

/** A sleeve along an arm path, ending in a hand, with cuff bands across the forearm. */
function armShapes(t: Traits, height: number, armPath: Pt[], skinTone: number, build: FigureBuild): Shape[] {
  const arm: Shape[] = [];
  const widths = build === 'trousered' ? [height * 0.085, height * 0.09, height * 0.055] : [height * 0.075, height * 0.085, height * 0.05];
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
  if (t.sleeveFilled) arm.push({ kind: 'area', points: sleeve, ink: t.bodiceInk, grain: 0 });
  else arm.push({ kind: 'line', points: sleeve, ink: 'dark', weight: 0.45, closed: true });
  for (const at of [0.55, 0.78]) {
    const a0 = armPath[1];
    const a1 = armPath[2];
    const mx = a0[0] + (a1[0] - a0[0]) * at;
    const my = a0[1] + (a1[1] - a0[1]) * at;
    const dx = a1[0] - a0[0];
    const dy = a1[1] - a0[1];
    const len = Math.hypot(dx, dy) || 1;
    const half = height * 0.03;
    arm.push({
      kind: 'line',
      points: [[mx - (dy / len) * half, my + (dx / len) * half], [mx + (dy / len) * half, my - (dx / len) * half]],
      ink: t.sleeveFilled ? 'gold' : 'primary',
      weight: 0.55,
    });
  }
  const hand = armPath[2];
  arm.push({ kind: 'area', points: circle(hand, height * 0.03, 10), ink: 'skin', grain: 0, tone: skinTone });
  return arm;
}

/** The headdress a seed gives a skirted figure, for the lab and tests. */
export function headdressFor(rng: Rng, height = 30): Headdress {
  return drawTraits(rng, height).headdress;
}

/** A standing figure drawn as one picture. */
export function figure(rng: Rng, options: FigureOptions): Shape[] {
  const p = figureParts(rng, options);
  return place([...p.legLeft, ...p.legRight, ...p.skirt, ...p.torso, ...p.head, ...p.armLeft, ...p.armRight], { rot: p.lean });
}

/**
 * The figure kept in parts for animation. The seed decides the person; `expression` changes
 * only the face and `view` only the angle, so a character keeps their looks throughout.
 */
export function figureParts(rng: Rng, options: FigureOptions): FigureParts {
  const t = drawTraits(rng, options.height);
  t.bold = options.detail === 'bold';
  const kind = options.kind ?? 'human';
  // A kind overrides some traits after they are drawn, so the seed's other choices stay put.
  if (kind === 'samodiva') {
    Object.assign(t, { hairFalls: true, longHair: true, headdress: 'wreath', sleeveFilled: false, skirtStyle: 'outlined', pattern: 'dots' });
  } else if (kind === 'serpent') {
    Object.assign(t, { headdress: 'crown', hairInk: 'accent' });
  } else if (kind === 'kuker') {
    Object.assign(t, { sleeveFilled: true, bodiceInk: 'gold', hairFalls: false });
  }
  const build: FigureBuild = kind === 'kuker' ? 'trousered' : kind === 'human' ? options.build ?? 'skirted' : 'skirted';
  const view = options.view ?? 'front';
  const expression = options.expression ?? t.restingExpression;
  const skinTone = options.skinTone ?? t.seededSkinTone;
  const { height } = options;
  const parts =
    build === 'trousered' ? trouseredParts(t, height, view, expression, skinTone) : skirtedParts(t, height, view, expression, skinTone);
  const shaped =
    kind === 'serpent'
      ? { ...parts, skirt: serpentTail(t, height, view), legLeft: [], legRight: [] }
      : kind === 'kuker'
        ? kukerParts(parts, t, height, view)
        : parts;
  // Seen small, a bigger head (grown from the neck) keeps the face and headdress readable.
  return t.bold ? { ...shaped, head: scaleAbout(shaped.head, shaped.pivots.neck, BOLD_HEAD) } : shaped;
}

const BOLD_HEAD = 1.14;

/** Scales shapes about a point: line weights and knot sizes grow with them. */
function scaleAbout(shapes: Shape[], [ox, oy]: Pt, k: number): Shape[] {
  const p = ([x, y]: Pt): Pt => [ox + (x - ox) * k, oy + (y - oy) * k];
  return shapes.map((s): Shape => {
    switch (s.kind) {
      case 'area':
        return { ...s, points: s.points.map(p) };
      case 'line':
        return { ...s, points: s.points.map(p), weight: s.weight * k };
      case 'knot':
        return { ...s, at: p(s.at), r: s.r * k };
      case 'counted':
        return s;
    }
  });
}

/**
 * A lamia's coiled serpent body from the waist down: a tapering S of scales that loops on
 * the ground and lifts its tip, worked in the hair ink with gold scale knots.
 */
function serpentTail(t: Traits, height: number, view: FigureView): Shape[] {
  const flip = view === 'back' ? -1 : 1;
  const waistY = -t.skirtH;
  const spine: Pt[] = [
    [0, waistY],
    [height * 0.06 * flip, waistY * 0.7],
    [-height * 0.07 * flip, waistY * 0.38],
    [height * 0.02 * flip, -height * 0.05],
    [height * 0.2 * flip, -height * 0.015],
    [height * 0.33 * flip, -height * 0.05],
    [height * 0.36 * flip, -height * 0.13],
    [height * 0.3 * flip, -height * 0.18],
  ];
  // Smooth the spine with midpoint curves, then offset each side by a tapering width.
  const smooth: Pt[] = [];
  for (let i = 0; i < spine.length - 1; i++) {
    const a = spine[i];
    const b = spine[i + 1];
    const c = spine[Math.min(spine.length - 1, i + 2)];
    const m1: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m2: Pt = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    smooth.push(...quadCurve(i === 0 ? a : m1, b, m2, 6).slice(i === 0 ? 0 : 1));
  }
  const n = smooth.length;
  const left: Pt[] = [];
  const right: Pt[] = [];
  const widthAt = (i: number) => t.waistW * 1.25 * (1 - i / n) + height * 0.012;
  smooth.forEach((p, i) => {
    const prev = smooth[Math.max(0, i - 1)];
    const next = smooth[Math.min(n - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const w = widthAt(i) / 2;
    left.push([p[0] - (dy / len) * w, p[1] + (dx / len) * w]);
    right.push([p[0] + (dy / len) * w, p[1] - (dx / len) * w]);
  });
  const ink: Ink = t.hairInk === 'accent' ? 'accent' : 'secondary';
  const shapes: Shape[] = [{ kind: 'area', points: [...left, ...right.reverse()], ink, grain: 0 }];
  shapes.push({ kind: 'line', points: smooth.slice(0, n - 2), ink: 'gold', weight: 0.35 });
  for (let i = 2; i < n - 2; i += 3) {
    shapes.push({ kind: 'knot', at: smooth[i], r: Math.max(0.18, widthAt(i) * 0.16), ink: i % 2 ? 'gold' : 'primary' });
  }
  // A girdle where the woman meets the serpent.
  shapes.push({ kind: 'line', points: [[-t.waistW * 0.75, waistY], [t.waistW * 0.75, waistY]], ink: 'gold', weight: 1 });
  return shapes;
}

/**
 * A kuker mummer: a shaggy goatskin coat to the knee over the trousered figure, a belt of
 * bronze bells, and a tall horned wooden mask with tassels in place of a face.
 */
function kukerParts(parts: FigureParts, t: Traits, height: number, view: FigureView): FigureParts {
  const shoulderY = -height * 0.7;
  const shoulderW = t.shoulderW * 1.25;
  const waistW = t.waistW * 1.6;
  const sashY = -height * 0.45;
  const hemY = -height * 0.2;
  const squeeze = view === 'side' ? 0.62 : 1;
  const fur = (outline: Pt[], strands: number): Shape[] => {
    // Undyed goatskin: the gold role reads as fleece in thread and as an outline in ink.
    const shapes: Shape[] = [{ kind: 'area', points: outline.map(([x, y]): Pt => [x * squeeze, y]), ink: 'gold', grain: Math.PI / 2 }];
    const minY = Math.min(...outline.map((p) => p[1]));
    const maxY = Math.max(...outline.map((p) => p[1]));
    for (let i = 0; i < strands; i++) {
      const y = minY + ((i + 0.5) / strands) * (maxY - minY);
      const halfW = Math.max(...outline.map((p) => Math.abs(p[0]))) * squeeze * 0.75;
      const x = ((i * 0.618) % 1) * 2 * halfW - halfW;
      shapes.push({ kind: 'line', points: [[x, y], [x + height * 0.012, y + height * 0.035]], ink: 'dark', weight: 0.3 });
    }
    return shapes;
  };
  const torso = fur(
    [[-waistW / 2, sashY], [waistW / 2, sashY], [shoulderW / 2, shoulderY + height * 0.01], [0, shoulderY - height * 0.02], [-shoulderW / 2, shoulderY + height * 0.01]],
    9,
  );
  torso.push({ kind: 'area', points: [[-waistW * 0.55, sashY + height * 0.025], [waistW * 0.55, sashY + height * 0.025], [waistW * 0.52, sashY - height * 0.03], [-waistW * 0.52, sashY - height * 0.03]].map(([x, y]): Pt => [x * squeeze, y]), ink: 'primary', grain: 0 });
  // Bronze bells hanging from the belt.
  const bells = view === 'side' ? [-0.15, 0.2] : [-0.38, -0.12, 0.12, 0.38];
  for (const b of bells) {
    const x = b * waistW * squeeze;
    torso.push({ kind: 'knot', at: [x, sashY + height * 0.05], r: height * 0.026, ink: 'gold' });
    torso.push({ kind: 'knot', at: [x, sashY + height * 0.072], r: height * 0.008, ink: 'dark' });
  }
  const skirtOutline: Pt[] = [[-waistW * 0.55, sashY], [waistW * 0.55, sashY], [waistW * 0.78, hemY], [-waistW * 0.78, hemY]];
  const skirt = fur(skirtOutline, 7);
  for (let i = 0; i < 9; i++) {
    const x = (-waistW * 0.75 + (i / 8) * waistW * 1.5) * squeeze;
    skirt.push({ kind: 'line', points: [[x, hemY - height * 0.01], [x + height * 0.006, hemY + height * 0.03]], ink: 'dark', weight: 0.45 });
  }
  return { ...parts, torso, skirt, head: kukerMask(t, height, view) };
}

function kukerMask(t: Traits, height: number, view: FigureView): Shape[] {
  const r = t.headR * 1.1;
  const headY = -height * 0.7 - t.headR * 1.12;
  const out: Shape[] = [];
  const w = view === 'side' ? r * 0.8 : r * 1.2;
  const face: Pt[] =
    view === 'side'
      ? [[-w, headY - r * 1.5], [w * 0.6, headY - r * 1.5], [w * 0.9, headY - r * 0.2], [w * 1.5, headY + r * 0.4], [w * 0.7, headY + r * 1.1], [-w, headY + r * 1.1]]
      : [[-w, headY - r * 1.5], [w, headY - r * 1.5], [w * 1.05, headY + r * 0.6], [w * 0.6, headY + r * 1.15], [-w * 0.6, headY + r * 1.15], [-w * 1.05, headY + r * 0.6]];
  out.push({ kind: 'area', points: face, ink: view === 'back' ? 'gold' : 'accent2', grain: UP });
  if (view !== 'back') {
    const eyes = view === 'side' ? [w * 0.35] : [-w * 0.45, w * 0.45];
    for (const x of eyes) {
      out.push({ kind: 'knot', at: [x, headY - r * 0.35], r: r * 0.2, ink: 'gold' });
      out.push({ kind: 'knot', at: [x, headY - r * 0.35], r: r * 0.09, ink: 'dark' });
    }
    // Bared teeth: a zigzag mouth.
    const mouthL = view === 'side' ? w * 0.3 : -w * 0.55;
    const mouthR = view === 'side' ? w * 1.2 : w * 0.55;
    const zig: Pt[] = [];
    for (let i = 0; i <= 6; i++) zig.push([mouthL + ((mouthR - mouthL) * i) / 6, headY + r * (0.5 + (i % 2 ? 0.18 : 0))]);
    out.push({ kind: 'line', points: zig, ink: 'gold', weight: 0.55 });
    // Small mirrors sewn across the brow.
    for (const x of view === 'side' ? [0, w * 0.4] : [-w * 0.6, 0, w * 0.6]) out.push({ kind: 'knot', at: [x, headY - r * 1.05], r: r * 0.13, ink: 'gold' });
  }
  const horn: Shape = { kind: 'line', points: curl([w * 0.7, headY - r * 1.4], r * 0.95, 0.85, -1, Math.PI), ink: 'dark', weight: 0.9 };
  out.push(...(view === 'side' ? [horn] : mirrored([horn])));
  // Tassels hanging from the sides of the mask.
  for (const side of view === 'side' ? [-1] : [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x = side * (w + r * 0.12) - side * k * r * 0.18;
      out.push({ kind: 'line', points: [[x, headY + r * 0.1], [x, headY + r * (0.9 + k * 0.25)]], ink: k % 2 ? 'gold' : 'accent2', weight: 0.5 });
      out.push({ kind: 'knot', at: [x, headY + r * (0.95 + k * 0.25)], r: r * 0.12, ink: k % 2 ? 'gold' : 'primary' });
    }
  }
  return out;
}

function skirtedParts(t: Traits, height: number, view: FigureView, expression: Expression, skinTone: number): FigureParts {
  const { skirtW, waistW, skirtH, shoulderW, skirtInk, bodiceInk } = t;
  const shoulderY = -height * 0.7;
  const skirt: Shape[] = [];
  const widthAt = (y: number) => waistW + (skirtW - waistW) * (1 + y / skirtH);
  const skirtOutline: Pt[] = [[-skirtW / 2, 0], [skirtW / 2, 0], [waistW / 2, -skirtH], [-waistW / 2, -skirtH]];
  // Garments are worked three ways: solid fill, an outline filled with a stitched pattern,
  // or a solid skirt under a contrasting apron.
  if (t.skirtStyle === 'outlined') {
    skirt.push({ kind: 'line', points: skirtOutline, ink: skirtInk, weight: 0.8, closed: true });
    if (t.pattern === 'stripes') {
      const stripes = t.stripes ?? 3;
      for (let i = 1; i <= stripes; i++) {
        const s = i / (stripes + 1) - 0.5;
        skirt.push({ kind: 'line', points: [[s * waistW, -skirtH], [s * skirtW, 0]], ink: i % 2 ? skirtInk : 'gold', weight: 0.45 });
      }
    } else {
      const rows = 4;
      for (let row = 1; row <= rows; row++) {
        const y = -skirtH * (row / (rows + 1));
        const count = row + 1;
        const w = widthAt(y) * 0.72;
        for (let i = 0; i < count; i++) {
          const x = count === 1 ? 0 : -w / 2 + (i / (count - 1)) * w;
          if (t.pattern === 'dots') {
            skirt.push({ kind: 'knot', at: [x, y], r: height * 0.012, ink: (row + i) % 2 ? skirtInk : 'gold' });
          } else {
            const d = height * 0.022;
            skirt.push({ kind: 'area', points: [[x, y - d], [x + d, y], [x, y + d], [x - d, y]], ink: (row + i) % 2 ? skirtInk : 'accent', grain: UP });
          }
        }
      }
    }
  } else {
    skirt.push({ kind: 'area', points: skirtOutline, ink: skirtInk, grain: UP });
    if (t.skirtStyle === 'apron' && view !== 'back') {
      const apronInk = t.apronInk ?? 'gold';
      const top = -skirtH * 0.92;
      const bottom = -skirtH * 0.08;
      const apron: Pt[] = [
        [-widthAt(bottom) * 0.3, bottom],
        [widthAt(bottom) * 0.3, bottom],
        [widthAt(top) * 0.4, top],
        [-widthAt(top) * 0.4, top],
      ];
      skirt.push({ kind: 'area', points: apron, ink: apronInk === skirtInk ? 'gold' : apronInk, grain: 0 });
      skirt.push({ kind: 'line', points: apron, ink: 'dark', weight: 0.35, closed: true });
    }
  }
  for (let i = 1; i <= t.bands; i++) {
    const y = -skirtH * (i / (t.bands + 1)) * 0.85;
    skirt.push({ kind: 'line', points: [[-widthAt(y) / 2, y], [widthAt(y) / 2, y]], ink: 'gold', weight: 0.7 });
  }
  const feet: Shape[][] = [];
  for (const side of [-1, 1] as const) {
    const bx = view === 'side' ? side * skirtW * 0.05 : side * skirtW * 0.17;
    const toe = view === 'side' ? 1 : side;
    feet.push([
      {
        kind: 'area',
        points: [[bx - height * 0.035, 0], [bx + height * 0.035, 0], [bx + toe * height * 0.075, height * 0.055], [bx - height * 0.04, height * 0.055]],
        ink: 'dark',
        grain: 0,
      },
    ]);
  }
  for (let i = 0; i < t.hemKnots; i++) {
    const x = -skirtW / 2 + ((i + 0.5) / t.hemKnots) * skirtW;
    skirt.push({ kind: 'knot', at: [x, -height * 0.035], r: height * 0.013, ink: i % 2 ? 'gold' : 'primary' });
  }

  const torso: Shape[] = [];
  const bodice: Pt[] = [[-waistW / 2, -skirtH], [waistW / 2, -skirtH], [shoulderW / 2, shoulderY], [-shoulderW / 2, shoulderY]];
  if (t.openBodice) {
    // An open bodice: outline with a stitched placket down the front.
    torso.push({ kind: 'line', points: bodice, ink: bodiceInk, weight: 0.8, closed: true });
    if (view !== 'back') {
      for (let i = 1; i <= 3; i++) {
        torso.push({ kind: 'knot', at: [0, -skirtH + ((shoulderY + skirtH) * i) / 4], r: height * 0.011, ink: 'primary' });
      }
    }
  } else {
    torso.push({ kind: 'area', points: bodice, ink: bodiceInk, grain: 0 });
  }
  torso.push({ kind: 'line', points: [[-waistW * 0.7, -skirtH], [waistW * 0.7, -skirtH]], ink: 'gold', weight: 1 });

  const { headR } = t;
  const headY = shoulderY - headR * 1.12;
  torso.push({
    kind: 'area',
    points: [[-headR * 0.3, shoulderY + headR * 0.1], [headR * 0.3, shoulderY + headR * 0.1], [headR * 0.3, headY + headR * 0.7], [-headR * 0.3, headY + headR * 0.7]],
    ink: 'skin',
    grain: UP,
    tone: skinTone,
  });
  const headPart = headShapes(t, headY, view, 'skirted', expression, skinTone);

  // Arms are sleeves with some cloth to them: either the white chemise sleeve (an outline
  // with embroidered cuff bands) or a filled sleeve in the bodice colour, ending in a hand.
  const shoulder: Pt = [shoulderW / 2 - height * 0.01, shoulderY + height * 0.03];
  const armPath = armPathFor(t.pose, view, shoulder, shoulderW, shoulderY, waistW, skirtH, height);
  const arm = armShapes(t, height, armPath, skinTone, 'skirted');
  if (view !== 'side') addCarried(arm, t, armPath[2], height);

  return finish(
    view,
    { legLeft: feet[0], legRight: feet[1], skirt, torso, head: headPart, arm },
    {
      waist: [0, -skirtH],
      neck: [0, shoulderY],
      shoulder,
      hipLeft: [view === 'side' ? 0 : -skirtW * 0.17, -height * 0.06],
      hipRight: [view === 'side' ? 0 : skirtW * 0.17, -height * 0.06],
    },
    t,
    { torsoK: 0.62, skirtK: 0.7, skirtDx: -skirtW * 0.04 },
  );
}

function trouseredParts(t: Traits, height: number, view: FigureView, expression: Expression, skinTone: number): FigureParts {
  const shoulderY = -height * 0.7;
  const shoulderW = t.shoulderW * 1.12;
  const waistW = t.waistW * 1.45;
  const sashY = -height * 0.45;
  const hemY = -height * 0.35;
  // Legs start where the shirt tail ends, so nothing shows through the open shirt.
  const hipY = hemY - height * 0.004;
  const ankleY = -height * 0.05;
  // Wool trousers are dark or undyed; the seed's skirt choice picks which.
  const trousersInk: Ink = t.skirtInk === 'secondary' ? 'secondary' : 'dark';
  const whiteTrousers = t.skirtStyle === 'outlined';

  const legs: Shape[][] = [];
  for (const side of [-1, 1] as const) {
    const leg: Shape[] = [];
    const x = view === 'side' ? side * height * 0.012 : side * height * 0.065;
    const wTop = height * (view === 'side' ? 0.11 : 0.1);
    const wBot = height * 0.068;
    const outline: Pt[] = [[x - wTop / 2, hipY], [x + wTop / 2, hipY], [x + wBot / 2, ankleY], [x - wBot / 2, ankleY]];
    if (whiteTrousers) {
      leg.push({ kind: 'line', points: outline, ink: 'dark', weight: 0.5, closed: true });
      // Braided cord down the outer seam.
      const outer = view === 'side' ? x : x + side * wTop * 0.32;
      leg.push({ kind: 'line', points: [[outer, hipY + height * 0.02], [outer + (view === 'side' ? 0 : side * height * 0.008), ankleY - height * 0.1]], ink: 'gold', weight: 0.5 });
    } else {
      leg.push({ kind: 'area', points: outline, ink: trousersInk, grain: UP });
    }
    // Leg wraps tied with criss-cross cords, as with rawhide sandals.
    for (let i = 0; i < Math.min(3, t.bands + 1); i++) {
      const y = ankleY - height * (0.025 + i * 0.03);
      leg.push({ kind: 'line', points: [[x - wBot * 0.55, y], [x + wBot * 0.55, y - height * 0.02]], ink: i % 2 ? 'gold' : 'primary', weight: 0.4 });
    }
    const toe = view === 'side' ? 1 : side;
    leg.push({
      kind: 'area',
      points: [[x - height * 0.04, ankleY], [x + height * 0.04, ankleY], [x + toe * height * 0.09, height * 0.035], [x - height * 0.045, height * 0.035]],
      ink: 'dark',
      grain: 0,
    });
    legs.push(leg);
  }

  // The shirt tail (or a short tunic skirt) below the sash.
  const skirt: Shape[] = [];
  const tail: Pt[] = [[-waistW * 0.55, sashY], [waistW * 0.55, sashY], [waistW * 0.68, hemY], [-waistW * 0.68, hemY]];
  if (t.skirtStyle === 'apron') {
    skirt.push({ kind: 'area', points: tail, ink: t.apronInk ?? 'gold', grain: UP });
  } else {
    // The undyed shirt is drawn as an outline with a couple of folds, like the chemise sleeves.
    skirt.push({ kind: 'line', points: tail, ink: 'dark', weight: 0.4, closed: true });
    for (const s of [-0.25, 0.25]) {
      skirt.push({ kind: 'line', points: [[s * waistW, sashY + height * 0.02], [s * waistW * 1.25, hemY - height * 0.005]], ink: 'dark', weight: 0.25 });
    }
  }
  const tailKnots = Math.max(3, Math.round(t.hemKnots / 2));
  for (let i = 0; i < tailKnots; i++) {
    const x = -waistW * 0.6 + ((i + 0.5) / tailKnots) * waistW * 1.2;
    skirt.push({ kind: 'knot', at: [x, hemY - height * 0.012], r: height * 0.011, ink: i % 2 ? 'gold' : 'primary' });
  }

  // Shirt, vest and sash.
  const torso: Shape[] = [];
  const shirt: Pt[] = [[-waistW / 2, sashY], [waistW / 2, sashY], [shoulderW / 2, shoulderY], [-shoulderW / 2, shoulderY]];
  torso.push({ kind: 'line', points: shirt, ink: 'dark', weight: 0.45, closed: true });
  const vestInk = t.bodiceInk;
  if (view === 'back') {
    torso.push({ kind: 'area', points: shirt.map(([x, y]): Pt => [x * 0.94, y + height * 0.012]), ink: vestInk, grain: 0 });
  } else {
    for (const side of [-1, 1] as const) {
      const panel: Pt[] = [
        [side * waistW * 0.5, sashY],
        [side * waistW * 0.1, sashY],
        [side * shoulderW * 0.12, shoulderY + height * 0.03],
        [side * shoulderW * 0.5, shoulderY],
      ];
      if (t.openBodice) torso.push({ kind: 'line', points: panel, ink: vestInk, weight: 0.7, closed: true });
      else torso.push({ kind: 'area', points: panel, ink: vestInk, grain: 0 });
    }
    for (let i = 1; i <= 3; i++) {
      const y = sashY + ((shoulderY - sashY) * i) / 4;
      torso.push({ kind: 'knot', at: [-waistW * 0.13, y], r: height * 0.01, ink: 'gold' });
      torso.push({ kind: 'knot', at: [waistW * 0.13, y], r: height * 0.01, ink: 'gold' });
    }
  }
  const sash: Pt[] = [[-waistW * 0.58, sashY + height * 0.025], [waistW * 0.58, sashY + height * 0.025], [waistW * 0.55, sashY - height * 0.035], [-waistW * 0.55, sashY - height * 0.035]];
  torso.push({ kind: 'area', points: sash, ink: 'primary', grain: 0 });
  torso.push({ kind: 'line', points: [[-waistW * 0.55, sashY - height * 0.005], [waistW * 0.55, sashY - height * 0.005]], ink: 'gold', weight: 0.45 });

  const { headR } = t;
  const headY = shoulderY - headR * 1.12;
  torso.push({
    kind: 'area',
    points: [[-headR * 0.34, shoulderY + headR * 0.1], [headR * 0.34, shoulderY + headR * 0.1], [headR * 0.34, headY + headR * 0.7], [-headR * 0.34, headY + headR * 0.7]],
    ink: 'skin',
    grain: UP,
    tone: skinTone,
  });
  const headPart = headShapes(t, headY, view, 'trousered', expression, skinTone);

  const shoulder: Pt = [shoulderW / 2 - height * 0.01, shoulderY + height * 0.03];
  const armPath = armPathFor(t.pose, view, shoulder, shoulderW, shoulderY, waistW, -sashY, height);
  const arm = armShapes(t, height, armPath, skinTone, 'trousered');
  if (view !== 'side') addCarried(arm, t, armPath[2], height);

  return finish(
    view,
    { legLeft: legs[0], legRight: legs[1], skirt, torso, head: headPart, arm },
    {
      waist: [0, sashY],
      neck: [0, shoulderY],
      shoulder,
      hipLeft: [view === 'side' ? 0 : -height * 0.065, hipY],
      hipRight: [view === 'side' ? 0 : height * 0.065, hipY],
    },
    t,
    { torsoK: 0.6, skirtK: 0.66, skirtDx: 0 },
  );
}

function armPathFor(
  pose: Pose,
  view: FigureView,
  shoulder: Pt,
  shoulderW: number,
  shoulderY: number,
  waistW: number,
  skirtH: number,
  height: number,
): Pt[] {
  if (view === 'side') {
    // Side-on, the near arm hangs from the middle of the body, a little forward.
    const s: Pt = [0, shoulderY + height * 0.03];
    return [s, [height * 0.02, shoulderY + height * 0.16], [height * 0.05, -skirtH + height * 0.09]];
  }
  return pose === 'raised'
    ? [shoulder, [shoulderW / 2 + height * 0.13, shoulderY + height * 0.06], [shoulderW / 2 + height * 0.2, shoulderY - height * 0.13]]
    : pose === 'offering'
      ? [shoulder, [shoulderW / 2 + height * 0.1, shoulderY + height * 0.14], [shoulderW / 2 + height * 0.21, shoulderY + height * 0.1]]
      : pose === 'akimbo'
        ? [shoulder, [shoulderW / 2 + height * 0.15, -skirtH - height * 0.08], [waistW / 2 + height * 0.02, -skirtH - height * 0.01]]
        : [shoulder, [shoulderW / 2 + height * 0.07, shoulderY + height * 0.16], [shoulderW / 2 + height * 0.05, -skirtH + height * 0.08]];
}

function addCarried(arm: Shape[], t: Traits, hand: Pt, height: number) {
  if (t.pose === 'raised' && t.carriesComb) {
    arm.push(...place(comb(height * 0.085, 'primary'), { dx: hand[0], dy: hand[1] - height * 0.02 }));
  } else if (t.pose === 'offering' && t.flower) {
    arm.push({ kind: 'line', points: [hand, [hand[0], hand[1] - height * 0.15]], ink: 'dark', weight: 0.45 });
    arm.push(...place(t.flower, { dx: hand[0], dy: hand[1] - height * 0.15 }));
  }
}

/** Mirrors the arm for the far side and turns the body side-on where the view asks for it. */
function finish(
  view: FigureView,
  p: { legLeft: Shape[]; legRight: Shape[]; skirt: Shape[]; torso: Shape[]; head: Shape[]; arm: Shape[] },
  joints: { waist: Pt; neck: Pt; shoulder: Pt; hipLeft: Pt; hipRight: Pt },
  t: Traits,
  side: { torsoK: number; skirtK: number; skirtDx: number },
): FigureParts {
  const isSide = view === 'side';
  return {
    legLeft: p.legLeft,
    legRight: p.legRight,
    skirt: isSide ? squeezeX(p.skirt, side.skirtK, side.skirtDx) : p.skirt,
    torso: isSide ? squeezeX(p.torso, side.torsoK) : p.torso,
    head: p.head,
    // Side-on, the far arm is hidden behind the body.
    armLeft: isSide ? [] : place(p.arm, { mirrorX: true }),
    armRight: p.arm,
    pivots: {
      waist: joints.waist,
      neck: joints.neck,
      shoulderLeft: isSide ? [0, joints.shoulder[1]] : [-joints.shoulder[0], joints.shoulder[1]],
      shoulderRight: isSide ? [0, joints.shoulder[1]] : joints.shoulder,
      hipLeft: joints.hipLeft,
      hipRight: joints.hipRight,
    },
    lean: t.lean,
    restingExpression: t.restingExpression,
  };
}
