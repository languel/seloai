/**
 * The motif grammar: counted-thread patterns grown from typed parameters and a seed, the way
 * a world grows from a generator. Each grammar builds a grid of cells (an ink role or empty)
 * inside a symmetry, so a motif is new every seed yet keeps the build of its kind.
 *
 * The forms are the common stock of Balkan counted work: the eight-pointed star of the
 * elbetitsa, stepped lozenges with sawtooth edges, the tree of life, solar rosettes, stepped
 * labyrinths, and border bands (wave meanders and chevron friezes). There is no hooked
 * cross among them, by rule. Colours are never chosen here, only ink roles.
 */
import { createSeededRng, type Rng } from '../core/rng';
import type { Ink, Shape } from './shapes';

export type Cell = Ink | null;

/** A motif: rows of cells, indexed [y][x]. */
export interface MotifGrid {
  w: number;
  h: number;
  cells: Cell[][];
}

export type MotifParamValue = number | boolean | string;
export type MotifParams = Record<string, MotifParamValue>;

export type MotifParamSpec =
  | { key: string; label: string; type: 'int' | 'float'; min: number; max: number; step?: number; default: number }
  | { key: string; label: string; type: 'bool'; default: boolean }
  | { key: string; label: string; type: 'enum'; options: readonly string[]; default: string }
  | { key: string; label: string; type: 'ink'; default: Ink };

export interface MotifGrammar {
  id: string;
  name: string;
  /** "medallion" motifs stand alone; "band" motifs repeat sideways as borders. */
  form: 'medallion' | 'band';
  params: readonly MotifParamSpec[];
  generate(params: MotifParams, rng: Rng): MotifGrid;
}

const INKS: readonly Ink[] = ['primary', 'secondary', 'accent', 'accent2', 'gold', 'dark'];

function blank(w: number, h: number): MotifGrid {
  return { w, h, cells: Array.from({ length: h }, () => Array<Cell>(w).fill(null)) };
}

/** Fills in defaults and clamps values, like the world generators. */
export function resolveMotifParams(grammar: MotifGrammar, params: MotifParams | undefined): MotifParams {
  const out: MotifParams = {};
  for (const spec of grammar.params) {
    const raw = params?.[spec.key];
    if (spec.type === 'bool') out[spec.key] = typeof raw === 'boolean' ? raw : spec.default;
    else if (spec.type === 'enum') out[spec.key] = typeof raw === 'string' && spec.options.includes(raw) ? raw : spec.default;
    else if (spec.type === 'ink') out[spec.key] = typeof raw === 'string' && INKS.includes(raw as Ink) ? raw : spec.default;
    else {
      const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.default;
      const c = Math.max(spec.min, Math.min(spec.max, n));
      out[spec.key] = spec.type === 'int' ? Math.round(c) : c;
    }
  }
  return out;
}

/** A medallion of radius r built from one function of folded coordinates. */
function medallion(r: number, at: (ax: number, ay: number, x: number, y: number) => Cell): MotifGrid {
  const size = r * 2 + 1;
  const g = blank(size, size);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) g.cells[y + r][x + r] = at(Math.abs(x), Math.abs(y), x, y);
  }
  return g;
}

/** Marks the edge of a filled region in an outline ink, keeping the inside. */
function outline(g: MotifGrid, ink: Ink): MotifGrid {
  const out = g.cells.map((row) => [...row]);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!g.cells[y][x]) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !g.cells[y + dy]?.[x + dx]);
      if (edge) out[y][x] = ink;
    }
  }
  return { ...g, cells: out };
}

// ---------------------------------------------------------------------------------------

/** The elbetitsa: an eight-pointed star of stepped arms along the axes and the diagonals. */
const star: MotifGrammar = {
  id: 'star',
  name: 'Eight-pointed star',
  form: 'medallion',
  params: [
    { key: 'radius', label: 'Size', type: 'int', min: 5, max: 14, default: 9 },
    { key: 'arm', label: 'Arm width', type: 'float', min: 1, max: 4, step: 0.25, default: 2.5 },
    { key: 'diagonal', label: 'Diagonal arms', type: 'float', min: 0, max: 1, step: 0.05, default: 0.8 },
    { key: 'bands', label: 'Bands inside', type: 'int', min: 1, max: 4, default: 2 },
    { key: 'centre', label: 'Centre', type: 'enum', options: ['lozenge', 'cross', 'dot', 'open'], default: 'lozenge' },
    { key: 'outline', label: 'Outline', type: 'ink', default: 'dark' },
    { key: 'fill', label: 'Fill', type: 'ink', default: 'primary' },
    { key: 'accent', label: 'Accent', type: 'ink', default: 'gold' },
  ],
  generate(p, rng) {
    const r = p.radius as number;
    const arm = (p.arm as number) + (rng() - 0.5) * 0.5;
    const diag = p.diagonal as number;
    const bands = p.bands as number;
    const inside = (ax: number, ay: number) => {
      const a = Math.max(ax, ay);
      const b = Math.min(ax, ay);
      if (a > r) return false;
      // Arms along the axes, narrowing in steps toward their points.
      if (b <= Math.floor(arm * (1 - a / (r + 1)) + 0.5)) return true;
      // Arms along the diagonals.
      const along = (a + b) / 2;
      const off = (a - b) / 2;
      return diag > 0 && off <= Math.floor(arm * diag * (1 - along / (r * 0.78)) + 0.5);
    };
    const filled = medallion(r, (ax, ay) => {
      if (!inside(ax, ay)) return null;
      const band = Math.floor((Math.max(ax, ay) + Math.min(ax, ay) * 0.5) / Math.max(1.5, r / (bands + 1)));
      return band % 2 ? (p.accent as Ink) : (p.fill as Ink);
    });
    const g = outline(filled, p.outline as Ink);
    const c = r;
    const centre = p.centre as string;
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const d = Math.abs(x) + Math.abs(y);
        if (centre === 'lozenge' && d <= 2) g.cells[c + y][c + x] = d === 2 ? (p.outline as Ink) : d === 0 ? (p.accent as Ink) : (p.fill as Ink);
        if (centre === 'cross' && (x === 0 || y === 0) && d <= 2) g.cells[c + y][c + x] = p.outline as Ink;
        if (centre === 'dot' && d === 0) g.cells[c][c] = p.outline as Ink;
        if (centre === 'open' && d <= 1) g.cells[c + y][c + x] = null;
      }
    }
    return g;
  },
};

/** A stepped lozenge with nested rings and a sawtooth edge, spurs at its points. */
const lozenge: MotifGrammar = {
  id: 'lozenge',
  name: 'Stepped lozenge',
  form: 'medallion',
  params: [
    { key: 'radius', label: 'Size', type: 'int', min: 4, max: 14, default: 8 },
    { key: 'rings', label: 'Rings', type: 'int', min: 1, max: 5, default: 3 },
    { key: 'teeth', label: 'Sawtooth edge', type: 'bool', default: true },
    { key: 'spurs', label: 'Spurs at the points', type: 'int', min: 0, max: 4, default: 2 },
    { key: 'solid', label: 'Solid rings', type: 'bool', default: false },
    { key: 'outline', label: 'Outline', type: 'ink', default: 'dark' },
    { key: 'fill', label: 'Fill', type: 'ink', default: 'primary' },
    { key: 'accent', label: 'Accent', type: 'ink', default: 'accent' },
  ],
  generate(p, rng) {
    const r = p.radius as number;
    const rings = p.rings as number;
    const gap = Math.max(2, Math.floor(r / rings));
    const spurs = p.spurs as number;
    const pad = spurs + (p.teeth ? 1 : 0);
    const R = r + pad;
    const twist = rng() < 0.5;
    return medallion(R, (ax, ay, x, y) => {
      const d = ax + ay;
      if (d <= r) {
        if (d % gap === 0) return p.outline as Ink;
        const ring = Math.floor(d / gap);
        if (p.solid) return ring % 2 ? (p.accent as Ink) : (p.fill as Ink);
        // Open rings: a chequer inside each band, turned on alternate seeds.
        return (x + y + (twist ? 1 : 0)) % 2 === 0 ? (ring % 2 ? (p.accent as Ink) : (p.fill as Ink)) : null;
      }
      // A sawtooth just outside the outer ring.
      if (p.teeth && d === r + 1 && (x - y) % 2 === 0) return p.outline as Ink;
      // Straight spurs running on from the four points.
      if ((ax === 0 || ay === 0) && d <= r + spurs) return p.accent as Ink;
      return null;
    });
  },
};

/** The tree of life: a trunk on one axis, paired branches ending in flowers, roots below. */
const tree: MotifGrammar = {
  id: 'tree',
  name: 'Tree of life',
  form: 'medallion',
  params: [
    { key: 'height', label: 'Height', type: 'int', min: 11, max: 27, default: 19 },
    { key: 'levels', label: 'Branch levels', type: 'int', min: 2, max: 5, default: 3 },
    { key: 'flower', label: 'Flowers', type: 'enum', options: ['lozenge', 'cross', 'bud', 'mixed'], default: 'mixed' },
    { key: 'leaves', label: 'Leaves', type: 'bool', default: true },
    { key: 'trunk', label: 'Trunk', type: 'ink', default: 'dark' },
    { key: 'bloom', label: 'Flowers', type: 'ink', default: 'primary' },
    { key: 'second', label: 'Second flowers', type: 'ink', default: 'accent2' },
    { key: 'leaf', label: 'Leaves', type: 'ink', default: 'accent' },
  ],
  generate(p, rng) {
    const H = p.height as number;
    const levels = p.levels as number;
    const half = Math.floor(H * 0.42);
    const W = half * 2 + 1;
    const g = blank(W, H);
    const c = half;
    const set = (x: number, y: number, ink: Ink) => {
      for (const sx of [c + x, c - x]) if (y >= 0 && y < H && sx >= 0 && sx < W) g.cells[y][sx] = ink;
    };
    const flowerAt = (x: number, y: number, kind: string, ink: Ink) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (kind === 'lozenge' && d === 1) set(x + dx, y + dy, ink);
          if (kind === 'cross' && d <= 1) set(x + dx, y + dy, d === 0 ? (p.trunk as Ink) : ink);
          if (kind === 'bud' && (d === 0 || (dy === -1 && dx === 0))) set(x + dx, y + dy, ink);
        }
      }
      if (kind === 'lozenge') set(x, y, p.trunk as Ink);
    };
    // Roots: an inverted V with curled ends.
    for (let k = 0; k <= Math.min(half - 1, 4); k++) set(k, H - 1 - Math.floor(k / 2), p.trunk as Ink);
    // Trunk.
    for (let y = 2; y < H - 1; y++) g.cells[y][c] = p.trunk as Ink;
    // Branches: rising diagonals from the trunk, shorter toward the top.
    for (let level = 0; level < levels; level++) {
      const y0 = Math.floor(H - 4 - (level * (H - 7)) / levels);
      const len = Math.max(2, Math.round((half - 1) * (1 - level / (levels + 0.6))));
      for (let k = 1; k <= len; k++) {
        set(k, y0 - k, p.trunk as Ink);
        if (p.leaves && k % 2 === 0 && k < len) set(k, y0 - k + 1, p.leaf as Ink);
      }
      const kinds = ['lozenge', 'cross', 'bud'];
      const kind = p.flower === 'mixed' ? kinds[Math.floor(rng() * 3)] : (p.flower as string);
      flowerAt(len, y0 - len - 1, kind, level % 2 ? (p.second as Ink) : (p.bloom as Ink));
    }
    // A crown at the top.
    flowerAt(0, 1, 'lozenge', p.bloom as Ink);
    g.cells[0][c] = p.second as Ink;
    return g;
  },
};

/** A solar rosette: rays turning round a centre, with rings. */
const rosette: MotifGrammar = {
  id: 'rosette',
  name: 'Solar rosette',
  form: 'medallion',
  params: [
    { key: 'radius', label: 'Size', type: 'int', min: 5, max: 14, default: 9 },
    { key: 'rays', label: 'Rays', type: 'int', min: 8, max: 16, default: 10 },
    { key: 'twist', label: 'Twist', type: 'float', min: -0.4, max: 0.4, step: 0.02, default: 0.12 },
    { key: 'rings', label: 'Rings', type: 'int', min: 0, max: 3, default: 1 },
    { key: 'ray', label: 'Rays', type: 'ink', default: 'gold' },
    { key: 'ring', label: 'Rings', type: 'ink', default: 'primary' },
    { key: 'core', label: 'Centre', type: 'ink', default: 'dark' },
  ],
  generate(p, rng) {
    const r = p.radius as number;
    // At least eight rays, and only a gentle turn unless there are many: a sun of a few
    // strongly turning rays reads as a whirling hooked cross, which this project never draws.
    const n = Math.max(8, p.rays as number);
    const maxTwist = n >= 12 ? 0.4 : 0.12;
    const twist = Math.max(-maxTwist, Math.min(maxTwist, (p.twist as number) + (rng() - 0.5) * 0.04));
    const rings = p.rings as number;
    const width = 0.42 + rng() * 0.12;
    return medallion(r, (_ax, _ay, x, y) => {
      const d = Math.hypot(x, y);
      if (d > r + 0.4) return null;
      if (d < 1.6) return p.core as Ink;
      for (let k = 1; k <= rings; k++) if (Math.abs(d - (r * k) / (rings + 1)) < 0.5) return p.ring as Ink;
      if (Math.abs(d - r) < 0.55) return p.ring as Ink;
      const a = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
      return ((a * n + d * twist) % 1 + 1) % 1 < width ? (p.ray as Ink) : null;
    });
  },
};

/** A stepped labyrinth: concentric stepped squares, each broken by a gap that turns. */
const labyrinth: MotifGrammar = {
  id: 'labyrinth',
  name: 'Stepped labyrinth',
  form: 'medallion',
  params: [
    { key: 'radius', label: 'Size', type: 'int', min: 4, max: 13, default: 8 },
    { key: 'turn', label: 'Gaps turn', type: 'int', min: 0, max: 3, default: 1 },
    { key: 'diamond', label: 'On its point', type: 'bool', default: false },
    { key: 'wall', label: 'Walls', type: 'ink', default: 'accent2' },
    { key: 'second', label: 'Second walls', type: 'ink', default: 'secondary' },
  ],
  generate(p, rng) {
    const r = p.radius as number;
    const turn = p.turn as number;
    const start = Math.floor(rng() * 4);
    return medallion(r, (ax, ay, x, y) => {
      const ring = p.diamond ? Math.floor((ax + ay) / 1.5) : Math.max(ax, ay);
      if (ring % 2 !== 0 || ring === 0) return ring === 0 ? (p.wall as Ink) : null;
      // Which side of the ring this cell is on, and where this ring's gap sits.
      const side = Math.abs(x) >= Math.abs(y) ? (x > 0 ? 0 : 2) : y > 0 ? 1 : 3;
      const gapSide = (start + (ring / 2) * turn) % 4;
      const along = side % 2 === 0 ? y : x;
      if (side === gapSide && Math.abs(along) <= 0) return null;
      return (ring / 2) % 2 ? (p.second as Ink) : (p.wall as Ink);
    });
  },
};

/** A wave meander for borders: a stepped line rising and falling, with edge lines. */
const meander: MotifGrammar = {
  id: 'meander',
  name: 'Wave meander band',
  form: 'band',
  params: [
    { key: 'height', label: 'Height', type: 'int', min: 3, max: 9, default: 5 },
    { key: 'period', label: 'Repeat', type: 'int', min: 4, max: 14, default: 8 },
    { key: 'repeats', label: 'Repeats', type: 'int', min: 2, max: 8, default: 4 },
    { key: 'stepped', label: 'Stepped', type: 'bool', default: true },
    { key: 'edges', label: 'Edge lines', type: 'bool', default: true },
    { key: 'wave', label: 'Wave', type: 'ink', default: 'secondary' },
    { key: 'edge', label: 'Edges', type: 'ink', default: 'dark' },
  ],
  generate(p) {
    const h = p.height as number;
    const period = p.period as number;
    const W = period * (p.repeats as number);
    const H = h + (p.edges ? 4 : 0);
    const g = blank(W, H);
    const top = p.edges ? 2 : 0;
    let prev = -1;
    for (let x = 0; x < W; x++) {
      const phase = (x % period) / period;
      const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      const y = top + Math.round((p.stepped ? Math.round(tri * (h - 1) / 1) : tri * (h - 1)));
      g.cells[y][x] = p.wave as Ink;
      // Join steps with a vertical run, so the line reads as one thread.
      if (prev >= 0) for (let k = Math.min(prev, y); k <= Math.max(prev, y); k++) g.cells[k][x] = p.wave as Ink;
      prev = y;
    }
    if (p.edges) for (let x = 0; x < W; x++) g.cells[0][x] = g.cells[H - 1][x] = p.edge as Ink;
    return g;
  },
};

/** A chevron frieze: nested Vs in alternating threads. */
const chevron: MotifGrammar = {
  id: 'chevron',
  name: 'Chevron frieze band',
  form: 'band',
  params: [
    { key: 'height', label: 'Height', type: 'int', min: 3, max: 9, default: 5 },
    { key: 'period', label: 'Repeat', type: 'int', min: 3, max: 10, default: 4 },
    { key: 'repeats', label: 'Repeats', type: 'int', min: 4, max: 16, default: 8 },
    { key: 'thickness', label: 'Thickness', type: 'int', min: 1, max: 3, default: 1 },
    { key: 'first', label: 'First thread', type: 'ink', default: 'gold' },
    { key: 'second', label: 'Second thread', type: 'ink', default: 'primary' },
  ],
  generate(p) {
    const h = p.height as number;
    const period = p.period as number;
    const W = period * (p.repeats as number);
    const g = blank(W, h);
    const mid = (h - 1) / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < W; x++) {
        const v = x + Math.abs(y - mid);
        if (v % period < (p.thickness as number)) g.cells[y][x] = Math.floor(v / period) % 2 ? (p.second as Ink) : (p.first as Ink);
      }
    }
    return g;
  },
};

export const MOTIF_GRAMMARS: readonly MotifGrammar[] = [star, lozenge, tree, rosette, labyrinth, meander, chevron];

export function findGrammar(id: string): MotifGrammar | undefined {
  return MOTIF_GRAMMARS.find((g) => g.id === id);
}

export interface MotifRecipe {
  grammar: string;
  params: MotifParams;
  seed: number;
}

/** A motif from its recipe. The same recipe always gives the same motif. */
export function growMotif(recipe: MotifRecipe): MotifGrid {
  const grammar = findGrammar(recipe.grammar);
  if (!grammar) throw new Error(`Unknown motif grammar "${recipe.grammar}".`);
  return grammar.generate(resolveMotifParams(grammar, recipe.params), createSeededRng(recipe.seed * 2654435761 + 7));
}

/** A motif as counted stitches, centred on the origin, `cell` units per stitch. */
export function motifShape(grid: MotifGrid, cell: number): Shape {
  const cells: Array<[number, number, Ink]> = [];
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) if (grid.cells[y][x]) cells.push([x, y, grid.cells[y][x]!]);
  return { kind: 'counted', origin: [(-grid.w * cell) / 2 + cell / 2, (-grid.h * cell) / 2 + cell / 2], cell, cells };
}
