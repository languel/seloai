/**
 * Ductus: a hand of single-stroke letters, each written as the pen would write it, stroke by
 * stroke and in order. Because a letter is a few centre lines rather than an outline, it can
 * be modulated freely (slant, weight, wobble, roundness) and sewn in any stitch, and it can
 * be stitched on stroke by stroke as it is "written".
 *
 * The letterforms are original to this project: a plain, slightly rounded print hand.
 * Coordinates are in x-heights: the baseline is y = 0, the x-height y = 1, capitals 1.45,
 * ascenders 1.65 and descenders down to -0.6 (y grows upward here; drawing flips it).
 */
import { createSeededRng } from '../core/rng';

type P = [number, number];
interface Glyph {
  w: number;
  strokes: P[][];
}

// Shared shapes: the bowl of a, d, g and q, and a full oval.
const BOWL: P[] = [[0.56, 0.82], [0.32, 1.0], [0.06, 0.62], [0.14, 0.06], [0.44, 0.12], [0.56, 0.48]];
const O: P[] = [[0.32, 1.0], [0.05, 0.66], [0.12, 0.08], [0.38, 0.0], [0.62, 0.34], [0.55, 0.86], [0.32, 1.0]];
const CAP_O: P[] = [[0.36, 1.45], [0.06, 1.05], [0.08, 0.25], [0.36, 0.0], [0.66, 0.35], [0.64, 1.1], [0.36, 1.45]];
const dot = (x: number, y: number): P[] => [[x, y], [x + 0.015, y + 0.035]];

const GLYPHS: Record<string, Glyph> = {
  a: { w: 0.74, strokes: [BOWL, [[0.58, 1.0], [0.56, 0.14], [0.68, 0.0]]] },
  b: { w: 0.68, strokes: [[[0.08, 1.65], [0.05, 0.04]], [[0.07, 0.6], [0.35, 0.96], [0.62, 0.6], [0.5, 0.08], [0.1, 0.1]]] },
  c: { w: 0.62, strokes: [[[0.58, 0.8], [0.35, 1.0], [0.06, 0.6], [0.15, 0.08], [0.42, 0.0], [0.6, 0.15]]] },
  d: { w: 0.74, strokes: [BOWL, [[0.58, 1.65], [0.56, 0.14], [0.68, 0.0]]] },
  e: { w: 0.64, strokes: [[[0.08, 0.5], [0.58, 0.58], [0.45, 0.95], [0.15, 0.92], [0.05, 0.45], [0.2, 0.05], [0.45, 0.0], [0.6, 0.15]]] },
  f: { w: 0.52, strokes: [[[0.6, 1.55], [0.44, 1.68], [0.27, 1.5], [0.25, 0.6], [0.22, -0.04]], [[0.04, 0.95], [0.5, 0.98]]] },
  g: { w: 0.72, strokes: [BOWL, [[0.58, 1.0], [0.56, -0.34], [0.4, -0.6], [0.12, -0.5]]] },
  h: { w: 0.7, strokes: [[[0.08, 1.65], [0.05, 0.0]], [[0.06, 0.6], [0.3, 0.98], [0.55, 0.85], [0.6, 0.4], [0.6, 0.0]]] },
  i: { w: 0.34, strokes: [[[0.15, 0.95], [0.13, 0.1], [0.25, 0.0]], dot(0.17, 1.32)] },
  j: { w: 0.38, strokes: [[[0.25, 0.95], [0.24, -0.4], [0.1, -0.6], [-0.05, -0.5]], dot(0.27, 1.32)] },
  k: { w: 0.62, strokes: [[[0.08, 1.65], [0.05, 0.0]], [[0.52, 0.95], [0.08, 0.4]], [[0.25, 0.55], [0.58, 0.0]]] },
  l: { w: 0.34, strokes: [[[0.15, 1.65], [0.12, 0.12], [0.25, 0.0]]] },
  m: { w: 0.94, strokes: [[[0.05, 0.95], [0.04, 0.0]], [[0.05, 0.6], [0.22, 0.95], [0.42, 0.8], [0.45, 0.0]], [[0.44, 0.6], [0.62, 0.95], [0.82, 0.8], [0.86, 0.0]]] },
  n: { w: 0.68, strokes: [[[0.05, 0.95], [0.04, 0.0]], [[0.05, 0.6], [0.28, 0.97], [0.55, 0.82], [0.58, 0.0]]] },
  o: { w: 0.68, strokes: [O] },
  p: { w: 0.68, strokes: [[[0.06, 0.95], [0.04, -0.6]], [[0.06, 0.7], [0.35, 0.98], [0.62, 0.62], [0.5, 0.08], [0.08, 0.12]]] },
  q: { w: 0.74, strokes: [BOWL, [[0.58, 1.0], [0.56, -0.6], [0.7, -0.45]]] },
  r: { w: 0.52, strokes: [[[0.06, 0.95], [0.05, 0.0]], [[0.06, 0.6], [0.25, 0.95], [0.5, 0.92]]] },
  s: { w: 0.6, strokes: [[[0.52, 0.85], [0.3, 1.0], [0.08, 0.82], [0.15, 0.6], [0.45, 0.42], [0.55, 0.18], [0.32, 0.0], [0.04, 0.12]]] },
  t: { w: 0.52, strokes: [[[0.25, 1.4], [0.22, 0.12], [0.38, 0.0], [0.5, 0.08]], [[0.05, 0.95], [0.48, 0.97]]] },
  u: { w: 0.72, strokes: [[[0.05, 0.95], [0.06, 0.3], [0.22, 0.0], [0.48, 0.1], [0.57, 0.5]], [[0.58, 0.95], [0.57, 0.1], [0.68, 0.0]]] },
  v: { w: 0.63, strokes: [[[0.03, 0.95], [0.3, 0.0], [0.6, 0.95]]] },
  w: { w: 0.92, strokes: [[[0.03, 0.95], [0.22, 0.0], [0.45, 0.7], [0.66, 0.0], [0.88, 0.95]]] },
  x: { w: 0.6, strokes: [[[0.05, 0.95], [0.55, 0.0]], [[0.55, 0.95], [0.05, 0.0]]] },
  y: { w: 0.63, strokes: [[[0.03, 0.95], [0.3, 0.05]], [[0.6, 0.95], [0.28, -0.3], [0.12, -0.58], [0.0, -0.55]]] },
  z: { w: 0.62, strokes: [[[0.05, 0.95], [0.55, 0.95], [0.05, 0.02], [0.58, 0.02]]] },

  A: { w: 0.72, strokes: [[[0.02, 0.0], [0.35, 1.45], [0.68, 0.0]], [[0.15, 0.55], [0.56, 0.55]]] },
  B: { w: 0.68, strokes: [[[0.06, 0.0], [0.06, 1.45]], [[0.06, 1.45], [0.45, 1.42], [0.55, 1.1], [0.4, 0.78], [0.06, 0.76]], [[0.4, 0.78], [0.62, 0.5], [0.5, 0.08], [0.06, 0.0]]] },
  C: { w: 0.7, strokes: [[[0.65, 1.2], [0.42, 1.45], [0.1, 1.2], [0.03, 0.6], [0.2, 0.08], [0.45, 0.0], [0.67, 0.22]]] },
  D: { w: 0.72, strokes: [[[0.06, 0.0], [0.06, 1.45]], [[0.06, 1.45], [0.45, 1.38], [0.66, 0.8], [0.5, 0.12], [0.06, 0.0]]] },
  E: { w: 0.66, strokes: [[[0.6, 1.45], [0.06, 1.45], [0.06, 0.0], [0.62, 0.0]], [[0.06, 0.74], [0.48, 0.74]]] },
  F: { w: 0.62, strokes: [[[0.6, 1.45], [0.06, 1.45], [0.06, 0.0]], [[0.06, 0.74], [0.45, 0.74]]] },
  G: { w: 0.72, strokes: [[[0.65, 1.2], [0.42, 1.45], [0.1, 1.2], [0.03, 0.6], [0.2, 0.08], [0.48, 0.0], [0.66, 0.25], [0.66, 0.62], [0.4, 0.62]]] },
  H: { w: 0.7, strokes: [[[0.06, 0.0], [0.06, 1.45]], [[0.62, 0.0], [0.62, 1.45]], [[0.06, 0.74], [0.62, 0.74]]] },
  I: { w: 0.32, strokes: [[[0.15, 0.0], [0.15, 1.45]]] },
  J: { w: 0.58, strokes: [[[0.5, 1.45], [0.5, 0.3], [0.35, 0.0], [0.12, 0.05], [0.04, 0.3]]] },
  K: { w: 0.66, strokes: [[[0.06, 0.0], [0.06, 1.45]], [[0.6, 1.45], [0.06, 0.55]], [[0.25, 0.75], [0.62, 0.0]]] },
  L: { w: 0.58, strokes: [[[0.06, 1.45], [0.06, 0.0], [0.55, 0.0]]] },
  M: { w: 0.86, strokes: [[[0.05, 0.0], [0.1, 1.45], [0.42, 0.5], [0.74, 1.45], [0.8, 0.0]]] },
  N: { w: 0.7, strokes: [[[0.06, 0.0], [0.06, 1.45], [0.62, 0.0], [0.62, 1.45]]] },
  O: { w: 0.74, strokes: [CAP_O] },
  P: { w: 0.64, strokes: [[[0.06, 0.0], [0.06, 1.45], [0.45, 1.42], [0.6, 1.1], [0.45, 0.74], [0.06, 0.72]]] },
  Q: { w: 0.76, strokes: [CAP_O, [[0.4, 0.3], [0.72, -0.08]]] },
  R: { w: 0.68, strokes: [[[0.06, 0.0], [0.06, 1.45], [0.45, 1.42], [0.6, 1.1], [0.45, 0.74], [0.06, 0.72]], [[0.3, 0.73], [0.64, 0.0]]] },
  S: { w: 0.66, strokes: [[[0.6, 1.25], [0.38, 1.45], [0.1, 1.3], [0.1, 0.95], [0.5, 0.65], [0.62, 0.3], [0.42, 0.0], [0.05, 0.15]]] },
  T: { w: 0.68, strokes: [[[0.02, 1.45], [0.66, 1.45]], [[0.34, 1.45], [0.34, 0.0]]] },
  U: { w: 0.7, strokes: [[[0.06, 1.45], [0.06, 0.4], [0.3, 0.0], [0.56, 0.12], [0.64, 0.5], [0.64, 1.45]]] },
  V: { w: 0.7, strokes: [[[0.02, 1.45], [0.34, 0.0], [0.68, 1.45]]] },
  W: { w: 0.95, strokes: [[[0.02, 1.45], [0.22, 0.0], [0.47, 1.0], [0.72, 0.0], [0.93, 1.45]]] },
  X: { w: 0.68, strokes: [[[0.04, 1.45], [0.64, 0.0]], [[0.64, 1.45], [0.04, 0.0]]] },
  Y: { w: 0.68, strokes: [[[0.03, 1.45], [0.34, 0.7], [0.66, 1.45]], [[0.34, 0.7], [0.34, 0.0]]] },
  Z: { w: 0.7, strokes: [[[0.05, 1.45], [0.62, 1.45], [0.05, 0.0], [0.65, 0.0]]] },

  '0': { w: 0.6, strokes: [[[0.3, 1.35], [0.05, 0.9], [0.08, 0.25], [0.3, 0.0], [0.55, 0.35], [0.52, 1.05], [0.3, 1.35]]] },
  '1': { w: 0.5, strokes: [[[0.12, 1.1], [0.32, 1.35], [0.3, 0.0]]] },
  '2': { w: 0.64, strokes: [[[0.06, 1.1], [0.3, 1.35], [0.55, 1.15], [0.5, 0.75], [0.05, 0.0], [0.6, 0.02]]] },
  '3': { w: 0.64, strokes: [[[0.08, 1.2], [0.32, 1.35], [0.55, 1.15], [0.45, 0.78], [0.25, 0.72]], [[0.45, 0.72], [0.6, 0.4], [0.42, 0.02], [0.05, 0.12]]] },
  '4': { w: 0.66, strokes: [[[0.48, 0.0], [0.48, 1.35], [0.03, 0.42], [0.62, 0.42]]] },
  '5': { w: 0.64, strokes: [[[0.58, 1.35], [0.12, 1.35], [0.08, 0.78], [0.4, 0.82], [0.6, 0.45], [0.45, 0.05], [0.05, 0.12]]] },
  '6': { w: 0.64, strokes: [[[0.52, 1.3], [0.25, 1.2], [0.06, 0.6], [0.15, 0.05], [0.45, 0.02], [0.58, 0.38], [0.4, 0.72], [0.08, 0.55]]] },
  '7': { w: 0.62, strokes: [[[0.05, 1.35], [0.6, 1.35], [0.22, 0.0]]] },
  '8': { w: 0.64, strokes: [[[0.32, 0.75], [0.08, 1.05], [0.3, 1.35], [0.55, 1.1], [0.32, 0.75], [0.05, 0.38], [0.3, 0.0], [0.6, 0.35], [0.32, 0.75]]] },
  '9': { w: 0.64, strokes: [[[0.55, 0.8], [0.25, 0.65], [0.06, 0.95], [0.25, 1.35], [0.55, 1.2], [0.52, 0.4], [0.3, 0.0], [0.08, 0.1]]] },

  '.': { w: 0.28, strokes: [dot(0.1, 0.02)] },
  ',': { w: 0.28, strokes: [[[0.14, 0.08], [0.1, -0.25]]] },
  '!': { w: 0.32, strokes: [[[0.15, 1.45], [0.13, 0.4]], dot(0.13, 0.03)] },
  '?': { w: 0.6, strokes: [[[0.08, 1.2], [0.3, 1.42], [0.52, 1.2], [0.45, 0.85], [0.28, 0.65], [0.27, 0.38]], dot(0.27, 0.03)] },
  "'": { w: 0.26, strokes: [[[0.12, 1.45], [0.1, 1.15]]] },
  '’': { w: 0.26, strokes: [[[0.12, 1.45], [0.1, 1.15]]] },
  '"': { w: 0.4, strokes: [[[0.1, 1.45], [0.08, 1.15]], [[0.28, 1.45], [0.26, 1.15]]] },
  '-': { w: 0.5, strokes: [[[0.06, 0.5], [0.42, 0.52]]] },
  '—': { w: 0.9, strokes: [[[0.06, 0.5], [0.84, 0.52]]] },
  ':': { w: 0.3, strokes: [dot(0.12, 0.03), dot(0.12, 0.8)] },
  ';': { w: 0.3, strokes: [dot(0.13, 0.8), [[0.14, 0.08], [0.1, -0.25]]] },
  '(': { w: 0.38, strokes: [[[0.3, 1.5], [0.08, 0.7], [0.3, -0.2]]] },
  ')': { w: 0.38, strokes: [[[0.08, 1.5], [0.3, 0.7], [0.08, -0.2]]] },
  '/': { w: 0.5, strokes: [[[0.45, 1.5], [0.05, -0.2]]] },
  '&': { w: 0.72, strokes: [[[0.66, 0.0], [0.15, 0.95], [0.25, 1.4], [0.45, 1.3], [0.4, 1.0], [0.08, 0.55], [0.15, 0.08], [0.4, 0.02], [0.66, 0.5]]] },
};

const SPACE_W = 0.38;

function glyphFor(ch: string): Glyph | null {
  if (GLYPHS[ch]) return GLYPHS[ch];
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (GLYPHS[base]) return GLYPHS[base];
  const lower = base.toLowerCase();
  return GLYPHS[lower] ?? null;
}

/** Width of a character in x-heights (0 for characters this hand has no form for). */
export function ductusAdvance(ch: string): number {
  if (ch === ' ') return SPACE_W;
  return (glyphFor(ch)?.w ?? 0) + 0.08;
}

export interface DuctusStyle {
  /** Forward lean, as a share of height (0.2 is a gentle italic). */
  slant: number;
  /** How much each letter wobbles, as if written by hand (0 to 1). */
  wobble: number;
  /** Seed for the wobble, so a letter written twice is not written identically. */
  seed: number;
}

function catmull(points: P[], steps: number): P[] {
  if (points.length < 3) return points;
  const out: P[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * The strokes of a character, smoothed, slanted and wobbled, centred on its own middle and
 * in x-heights with y pointing down (ready to draw). Empty for spaces and unknown characters.
 */
export function ductusStrokes(ch: string, style: DuctusStyle): P[][] {
  const g = glyphFor(ch);
  if (!g) return [];
  const rng = createSeededRng(style.seed);
  const amp = 0.035 * style.wobble;
  // A whole-letter wobble (a little tilt and stretch) plus a small jitter at each point.
  const tilt = (rng() - 0.5) * 0.12 * style.wobble;
  const stretch = 1 + (rng() - 0.5) * 0.1 * style.wobble;
  return g.strokes.map((stroke) => {
    const jittered = stroke.map(([x, y]): P => [x + (rng() - 0.5) * 2 * amp, y * stretch + (rng() - 0.5) * 2 * amp]);
    const isDot = stroke.length === 2 && Math.hypot(stroke[1][0] - stroke[0][0], stroke[1][1] - stroke[0][1]) < 0.06;
    const smooth = isDot ? jittered : catmull(jittered, 5);
    return smooth.map(([x, y]): P => {
      const sx = x + y * (style.slant + tilt) - g.w / 2;
      return [sx, -(y - 0.5)];
    });
  });
}

export type DuctusStitch = 'back' | 'running' | 'stem' | 'chain';

/**
 * Sews strokes onto a canvas. `size` is the x-height in pixels, `weight` the thread
 * thickness as a share of it, and `progress` (0..1) how much of the letter has been
 * written, stroke by stroke in order.
 */
export function drawDuctus(
  ctx: CanvasRenderingContext2D,
  strokes: P[][],
  size: number,
  colour: string,
  weight: number,
  stitch: DuctusStitch,
  progress = 1,
  shadow = true,
) {
  const lengths = strokes.map((s) => s.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]) : 0), 0) || 0.04);
  const total = lengths.reduce((a, b) => a + b, 0);
  let budget = total * Math.max(0, Math.min(1, progress));
  const lw = Math.max(0.6, size * weight);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const passes = shadow ? [0, 1] : [1];
  // Work out the visible part of each stroke once.
  const parts: P[][] = [];
  strokes.forEach((s, i) => {
    if (budget <= 0) return;
    if (budget >= lengths[i]) {
      parts.push(s);
      budget -= lengths[i];
      return;
    }
    const cut: P[] = [s[0]];
    let left = budget;
    for (let k = 1; k < s.length && left > 0; k++) {
      const d = Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]);
      if (d <= left) {
        cut.push(s[k]);
        left -= d;
      } else {
        const f = left / d;
        cut.push([s[k - 1][0] + (s[k][0] - s[k - 1][0]) * f, s[k - 1][1] + (s[k][1] - s[k - 1][1]) * f]);
        left = 0;
      }
    }
    parts.push(cut);
    budget = 0;
  });
  for (const pass of passes) {
    ctx.save();
    if (pass === 0) {
      ctx.translate(lw * 0.45, lw * 0.6);
      ctx.strokeStyle = 'rgba(40, 26, 12, 0.22)';
      ctx.fillStyle = 'rgba(40, 26, 12, 0.22)';
    } else {
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
    }
    for (const s of parts) {
      const pts = s.map(([x, y]): P => [x * size, y * size]);
      if (pts.length < 2) continue;
      const isDot = pts.length === 2 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < size * 0.08;
      if (isDot) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], lw * 0.75, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (stitch === 'stem') {
        // Stem stitch: short slanted stitches overlapping along the line, like a twisted cord.
        ctx.lineWidth = lw * 0.85;
        const len = Math.max(lw * 2.4, size * 0.16);
        walk(pts, len * 0.45, (x, y, a) => {
          const dx = Math.cos(a + 0.45) * len * 0.5;
          const dy = Math.sin(a + 0.45) * len * 0.5;
          ctx.beginPath();
          ctx.moveTo(x - dx, y - dy);
          ctx.lineTo(x + dx, y + dy);
          ctx.stroke();
        });
        continue;
      }
      if (stitch === 'chain') {
        // Chain stitch: small loops one after another.
        ctx.lineWidth = lw * 0.6;
        const len = Math.max(lw * 3, size * 0.18);
        walk(pts, len, (x, y, a) => {
          ctx.beginPath();
          ctx.ellipse(x, y, len * 0.55, lw * 1.1, a, 0, Math.PI * 2);
          ctx.stroke();
        });
        continue;
      }
      ctx.lineWidth = lw;
      if (stitch === 'running') ctx.setLineDash([Math.max(1.5, size * 0.14), Math.max(1, size * 0.09)]);
      else ctx.setLineDash([Math.max(2, size * 0.2), Math.max(0.4, lw * 0.35)]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

/** Calls `at` every `spacing` pixels along a polyline, with the direction of travel. */
function walk(pts: P[], spacing: number, at: (x: number, y: number, angle: number) => void) {
  let carry = spacing * 0.5;
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1];
    const [x1, y1] = pts[k];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const a = Math.atan2(y1 - y0, x1 - x0);
    let s = carry;
    while (s <= d) {
      at(x0 + ((x1 - x0) * s) / d, y0 + ((y1 - y0) * s) / d, a);
      s += spacing;
    }
    carry = s - d;
  }
}
