/**
 * Chrome for things drawn over the world: speech and thought bubbles, name ribbons and
 * place labels. The outlines are shapes drawn through the active look, so a bubble is a
 * stitched patch on the thread looks and an inked outline on the line-art looks. Text is
 * drawn separately as real text so it stays crisp.
 */
import { createSeededRng } from '../core/rng';
import { PALETTES, renderEmbroidery, renderLineArt, type LookOptions, type PaletteName } from './looks';
import type { Ink, Pt, Shape } from './shapes';

/** Pixels per shape unit for overlay chrome; fixes stitch length relative to the text. */
const UNIT = 2.4;
/** Room around a cached box for stitches, shadow and wobble. */
const MARGIN = 6;
const MAX_CACHE = 96;

export type BubbleKind = 'speech' | 'thought';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BubbleTail {
  side: 'top' | 'bottom' | 'left' | 'right';
  /** The two points where the tail leaves the box edge, and its tip. */
  base: [Pt, Pt];
  tip: Pt;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Where a bubble's tail should leave the box and point, given the speaker's head. The tail
 * leaves from the side that faces the head most directly, so a bubble pushed beside a head
 * by the layout still reads as attached to it.
 */
export function bubbleTail(box: Box, anchor: Pt, maxLength = 15): BubbleTail {
  const [ax, ay] = anchor;
  const gaps = {
    bottom: ay - (box.y + box.h),
    top: box.y - ay,
    left: box.x - ax,
    right: ax - (box.x + box.w),
  };
  let side: BubbleTail['side'] = 'bottom';
  let best = -Infinity;
  for (const key of ['bottom', 'left', 'right', 'top'] as const) {
    // Prefer the bottom edge a little: it is the conventional reading of a speech tail.
    const score = gaps[key] + (key === 'bottom' ? 4 : 0);
    if (score > best) {
      best = score;
      side = key;
    }
  }
  const half = 4;
  let base: [Pt, Pt];
  let mid: Pt;
  if (side === 'bottom' || side === 'top') {
    const edgeY = side === 'bottom' ? box.y + box.h : box.y;
    const bx = clamp(ax, box.x + 10, box.x + box.w - 10);
    base = [
      [bx - half, edgeY],
      [bx + half, edgeY],
    ];
    mid = [bx, edgeY];
  } else {
    const edgeX = side === 'right' ? box.x + box.w : box.x;
    const by = clamp(ay, box.y + 7, box.y + box.h - 7);
    base = [
      [edgeX, by - half],
      [edgeX, by + half],
    ];
    mid = [edgeX, by];
  }
  const dx = ax - mid[0];
  const dy = ay - mid[1];
  const dist = Math.hypot(dx, dy);
  const length = clamp(dist - 3, 5, maxLength);
  const tip: Pt = dist < 0.01 ? mid : [mid[0] + (dx / dist) * length, mid[1] + (dy / dist) * length];
  return { side, base, tip };
}

function isThreadLook(look: PaletteName): boolean {
  return look !== 'ink' && look !== 'night';
}

function draw(ctx: CanvasRenderingContext2D, look: PaletteName, shapes: Shape[], originPx: Pt, seed: number) {
  const options: LookOptions = { unit: UNIT, origin: originPx, palette: PALETTES[look], seed };
  if (isThreadLook(look)) renderEmbroidery(ctx, shapes, options);
  else renderLineArt(ctx, shapes, options);
}

/** A rounded rectangle as a polyline in pixels, with a seeded hand-drawn waver. */
function roundedOutline(w: number, h: number, r: number, seed: number, waver: number): Pt[] {
  const rng = createSeededRng(seed);
  const radius = Math.min(r, w / 2, h / 2);
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, start: number) => {
    for (let i = 0; i <= 4; i++) {
      const a = start + (i / 4) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
  };
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 14));
    for (let i = 1; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  };
  corner(w - radius, radius, -Math.PI / 2);
  edge(w, radius, w, h - radius);
  corner(w - radius, h - radius, 0);
  edge(w - radius, h, radius, h);
  corner(radius, h - radius, Math.PI / 2);
  edge(0, h - radius, 0, radius);
  corner(radius, radius, Math.PI);
  edge(radius, 0, w - radius, 0);
  return pts.map(([x, y]): Pt => [x + (rng() - 0.5) * waver, y + (rng() - 0.5) * waver]);
}

/** Evenly spaced points along a closed polyline. */
function alongClosed(points: Pt[], spacing: number): Pt[] {
  const out: Pt[] = [];
  let carried = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const length = Math.hypot(bx - ax, by - ay);
    let d = carried;
    for (; d < length; d += spacing) out.push([ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length]);
    carried = d - length;
  }
  return out;
}

const toUnits = (p: Pt): Pt => [p[0] / UNIT, p[1] / UNIT];

function tracePx(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

const cache = new Map<string, HTMLCanvasElement>();

function cached(key: string, w: number, h: number, scale: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + MARGIN * 2) * scale);
  canvas.height = Math.ceil((h + MARGIN * 2) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.translate(MARGIN, MARGIN);
  paint(ctx);
  cache.set(key, canvas);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return canvas;
}

/** The pixel scale the context currently draws at, rounded so the cache stays small. */
function drawScale(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const raw = t ? Math.hypot(t.a, t.b) : 1;
  return clamp(Math.round(raw * 2) / 2, 1, 6);
}

function blit(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement | null, x: number, y: number, w: number, h: number) {
  if (!canvas) return;
  ctx.drawImage(canvas, x - MARGIN, y - MARGIN, w + MARGIN * 2, h + MARGIN * 2);
}

export interface ChromeColours {
  fill: string;
  ink: Ink;
}

/**
 * The patch and outline of a bubble: a speech bubble is a cloth patch with a stem-stitched
 * (or inked) edge; a thought is a lighter patch edged with a ring of knots.
 */
export function drawBubbleBox(
  ctx: CanvasRenderingContext2D,
  look: PaletteName,
  kind: BubbleKind,
  box: Box,
  colours: ChromeColours,
) {
  const w = Math.round(box.w);
  const h = Math.round(box.h);
  const scale = drawScale(ctx);
  const seed = w * 31 + h * 17 + (kind === 'thought' ? 5 : 0);
  const key = `bubble|${look}|${kind}|${w}|${h}|${colours.fill}|${colours.ink}|${scale}`;
  const canvas = cached(key, w, h, scale, (c) => {
    const outline = roundedOutline(w, h, kind === 'thought' ? 11 : 6, seed, 1.4);
    tracePx(c, outline);
    c.fillStyle = colours.fill;
    c.fill();
    if (kind === 'speech') {
      draw(c, look, [{ kind: 'line', points: outline.map(toUnits), ink: colours.ink, weight: 0.55, closed: true }], [0, 0], seed);
    } else {
      const knots: Shape[] = alongClosed(outline, 6).map((p) => ({ kind: 'knot', at: toUnits(p), r: 0.55, ink: colours.ink }));
      draw(c, look, knots, [0, 0], seed);
    }
  });
  blit(ctx, canvas, box.x, box.y, w, h);
}

/**
 * The tail from a bubble to its speaker, drawn live because it follows the speaker. A
 * speech tail is a stitched wedge filled with the patch; a thought trails three knots.
 */
export function drawBubbleTail(
  ctx: CanvasRenderingContext2D,
  look: PaletteName,
  kind: BubbleKind,
  box: Box,
  anchor: Pt,
  colours: ChromeColours,
) {
  const tail = bubbleTail(box, anchor, tailReach(box, anchor, kind));
  const [b0, b1] = tail.base;
  const seed = Math.round(box.w * 13 + box.h * 7);
  ctx.save();
  if (kind === 'speech') {
    // Fill slightly inside the box edge so the wedge hides the outline where it joins.
    const inset: Pt = tail.side === 'bottom' ? [0, -2] : tail.side === 'top' ? [0, 2] : tail.side === 'left' ? [2, 0] : [-2, 0];
    ctx.beginPath();
    ctx.moveTo(b0[0] + inset[0], b0[1] + inset[1]);
    ctx.lineTo(tail.tip[0], tail.tip[1]);
    ctx.lineTo(b1[0] + inset[0], b1[1] + inset[1]);
    ctx.closePath();
    ctx.fillStyle = colours.fill;
    ctx.fill();
    draw(
      ctx,
      look,
      [
        { kind: 'line', points: [toUnits(b0), toUnits(tail.tip)], ink: colours.ink, weight: 0.55 },
        { kind: 'line', points: [toUnits(tail.tip), toUnits(b1)], ink: colours.ink, weight: 0.55 },
      ],
      [0, 0],
      seed,
    );
  } else {
    const mid: Pt = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2];
    const knots: Shape[] = [0.3, 0.65, 1].map((t, i) => ({
      kind: 'knot',
      at: toUnits([mid[0] + (tail.tip[0] - mid[0]) * t, mid[1] + (tail.tip[1] - mid[1]) * t]),
      r: 1.1 - i * 0.28,
      ink: colours.ink,
    }));
    draw(ctx, look, knots, [0, 0], seed);
  }
  ctx.restore();
}

/** Beyond this distance from the head, a tail shrinks to a nub and a thread does the joining. */
const NEAR = 24;

function tailReach(box: Box, anchor: Pt, kind: BubbleKind): number {
  const near = bubbleTail(box, anchor, 1000);
  const dist = Math.hypot(near.tip[0] - (near.base[0][0] + near.base[1][0]) / 2, near.tip[1] - (near.base[0][1] + near.base[1][1]) / 2);
  if (dist > NEAR) return 5;
  return kind === 'thought' ? 16 : 14;
}

/**
 * When the layout has pushed a bubble away from its speaker, a thin running-stitch thread
 * joins the tail to the head. Draw these before any bubble so a thread never crosses one.
 */
export function drawBubbleThread(
  ctx: CanvasRenderingContext2D,
  look: PaletteName,
  kind: BubbleKind,
  box: Box,
  anchor: Pt,
  ink: Ink,
) {
  const far = bubbleTail(box, anchor, 1000);
  const mid: Pt = [(far.base[0][0] + far.base[1][0]) / 2, (far.base[0][1] + far.base[1][1]) / 2];
  const dist = Math.hypot(anchor[0] - mid[0], anchor[1] - mid[1]);
  if (dist <= NEAR) return;
  const ux = (anchor[0] - mid[0]) / dist;
  const uy = (anchor[1] - mid[1]) / dist;
  const start: Pt = [mid[0] + ux * 4, mid[1] + uy * 4];
  const end: Pt = [anchor[0] - ux * 3, anchor[1] - uy * 3];
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = PALETTES[look].inks[ink];
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.setLineDash(kind === 'thought' ? [1, 4] : [4, 3]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.stroke();
  ctx.restore();
}

/**
 * A name or place label as a small embroidered ribbon: a faint patch behind the words, a
 * stitched rule under them (and over them for places) and a knot at each end.
 */
export function drawRibbon(
  ctx: CanvasRenderingContext2D,
  look: PaletteName,
  box: Box,
  colours: ChromeColours & { ruleAbove?: boolean; emphasis?: boolean },
) {
  const w = Math.round(box.w);
  const h = Math.round(box.h);
  const scale = drawScale(ctx);
  const key = `ribbon|${look}|${w}|${h}|${colours.fill}|${colours.ink}|${colours.ruleAbove ? 1 : 0}|${colours.emphasis ? 1 : 0}|${scale}`;
  const canvas = cached(key, w, h, scale, (c) => {
    const seed = w * 7 + h;
    tracePx(c, roundedOutline(w, h, h / 2, seed, 0.6));
    c.fillStyle = colours.fill;
    c.fill();
    const weight = colours.emphasis ? 0.6 : 0.4;
    const rules: number[] = [h - 1.5];
    if (colours.ruleAbove) rules.push(1.5);
    const shapes: Shape[] = [];
    for (const y of rules) {
      shapes.push({ kind: 'line', points: [toUnits([5, y]), toUnits([w - 5, y])], ink: colours.ink, weight });
      shapes.push({ kind: 'knot', at: toUnits([2, y]), r: 0.6, ink: colours.ink });
      shapes.push({ kind: 'knot', at: toUnits([w - 2, y]), r: 0.6, ink: colours.ink });
    }
    draw(c, look, shapes, [0, 0], seed);
  });
  blit(ctx, canvas, box.x, box.y, w, h);
}

/** A colour for a role in a look, for drawing text and small marks to match the chrome. */
export function inkHex(look: PaletteName, ink: Ink): string {
  return PALETTES[look].inks[ink];
}
