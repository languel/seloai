/**
 * Embroidered letters for woven text, drawn once per letter, colour, size and style and
 * cached. Satin letters come from a serif face filled with slanting satin threads, a couched
 * outline and a shadow so they sit on the cloth; the other hands are described below.
 */
import { ductusStrokes, drawDuctus, type DuctusStitch } from './ductus';
import { glyphGrid } from './lettering';
import type { WovenLetter } from './wovenText';

/**
 * - "satin": serif letters filled with satin stitch.
 * - "script": the system's handwriting face, thin, with a faint thread sheen.
 * - "ductus": this project's single-stroke hand, sewn in a chosen stitch and stitched on
 *   stroke by stroke as it is written.
 * - "counted": sampler capitals in cross stitch.
 */
export type WovenHand = 'satin' | 'script' | 'ductus' | 'counted';

export interface WovenStyle {
  hand: WovenHand;
  /** Thread thickness as a share of the letter height (ductus). */
  weight: number;
  /** Forward lean (ductus). */
  slant: number;
  /** How hand-written each letter wobbles, 0 to 1 (ductus). */
  wobble: number;
  stitch: DuctusStitch;
}

export const DEFAULT_WOVEN_STYLE: WovenStyle = { hand: 'satin', weight: 0.075, slant: 0.15, wobble: 0.5, stitch: 'back' };

const SCRIPT_FACE = '"Bradley Hand", "Segoe Print", "Noteworthy", "Chalkboard SE", "Comic Neue", cursive';
/** The x-height of a ductus letter, as a share of the woven letter size. */
export const DUCTUS_X_HEIGHT = 0.52;
const WRITE_SEC = 0.32;

const cache = new Map<string, HTMLCanvasElement>();

function shade(colour: string, amount: number): string {
  // amount > 0 lightens, < 0 darkens; colour is #rrggbb.
  const m = /^#?([0-9a-f]{6})$/i.exec(colour);
  if (!m) return colour;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

/**
 * A letter `px` pixels tall, centred in its canvas (which is 1.3 × px square). `lineLook`
 * leaves out the satin sheen, for the one-ink looks.
 */
export function stitchedGlyph(
  ch: string,
  colour: string,
  px: number,
  hand: WovenHand,
  italic: boolean,
  lineLook: boolean,
  style: WovenStyle = DEFAULT_WOVEN_STYLE,
  variant = 0,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const size = Math.max(6, Math.round(px));
  const key = `${ch}|${colour}|${size}|${hand}|${italic}|${lineLook}|${hand === 'ductus' ? `${style.weight}|${style.slant}|${style.wobble}|${style.stitch}|${variant}` : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const side = Math.ceil(size * 1.3);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  const c = side / 2;

  if (hand === 'ductus') {
    ctx.translate(c, c);
    const strokes = ductusStrokes(ch, { slant: style.slant + (italic ? 0.12 : 0), wobble: style.wobble, seed: variant * 7919 + ch.charCodeAt(0) });
    drawDuctus(ctx, strokes, size * DUCTUS_X_HEIGHT, colour, style.weight / DUCTUS_X_HEIGHT, style.stitch, 1, !lineLook);
  } else if (hand === 'script') {
    ctx.font = `${italic ? 'italic ' : ''}400 ${size}px ${SCRIPT_FACE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!lineLook) {
      ctx.fillStyle = 'rgba(40, 26, 12, 0.22)';
      ctx.fillText(ch, c + size * 0.04, c + size * 0.05);
    }
    ctx.fillStyle = colour;
    ctx.fillText(ch, c, c);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = lineLook ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(0.5, size * 0.03);
    for (let i = -side; i < side * 2; i += Math.max(1.2, size * 0.1)) {
      ctx.beginPath();
      ctx.moveTo(i, side);
      ctx.lineTo(i + side * 0.55, 0);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  } else if (hand === 'counted') {
    const grid = glyphGrid(ch);
    const cell = size / 7.6;
    const ox = c - (5 * cell) / 2;
    const oy = c - (7 * cell) / 2;
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? 'rgba(40, 26, 12, 0.25)' : colour;
      ctx.lineWidth = Math.max(0.8, cell * 0.32);
      const off = pass === 0 ? cell * 0.18 : 0;
      grid.forEach((row, y) =>
        [...row].forEach((v, x) => {
          if (v !== '#') return;
          const x0 = ox + x * cell + cell * 0.15 + off;
          const y0 = oy + y * cell + cell * 0.15 + off;
          const s = cell * 0.7;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + s, y0 + s);
          ctx.moveTo(x0 + s, y0);
          ctx.lineTo(x0, y0 + s);
          ctx.stroke();
        }),
      );
    }
  } else {
    ctx.font = `${italic ? 'italic ' : ''}600 ${size}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Shadow, so the stitches stand on the cloth.
    if (!lineLook) {
      ctx.fillStyle = 'rgba(40, 26, 12, 0.28)';
      ctx.fillText(ch, c + size * 0.05, c + size * 0.07);
    }
    ctx.fillStyle = colour;
    ctx.fillText(ch, c, c);
    // Satin: slanting threads laid across the letter, alternately catching and losing light.
    ctx.globalCompositeOperation = 'source-atop';
    const pitch = Math.max(1.1, size * 0.085);
    ctx.lineWidth = pitch * 0.5;
    for (let i = -side; i < side * 2; i += pitch) {
      ctx.strokeStyle = (Math.round(i / pitch) % 2 === 0)
        ? lineLook ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.26)'
        : lineLook ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.moveTo(i, side);
      ctx.lineTo(i + side * 0.55, 0);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // A couched outline in a darker thread, in short stitches.
    ctx.strokeStyle = lineLook ? colour : shade(colour, -0.35);
    ctx.lineWidth = Math.max(0.6, size * 0.035);
    ctx.setLineDash([Math.max(1.2, size * 0.11), Math.max(0.8, size * 0.06)]);
    ctx.strokeText(ch, c, c);
    ctx.setLineDash([]);
  }
  if (cache.size > 3000) cache.clear();
  cache.set(key, canvas);
  return canvas;
}

/**
 * Draws one woven letter at its place on the cloth. `scale` is screen pixels per world pixel
 * (for crisp glyphs). A ductus letter younger than a third of a second is drawn stroke by
 * stroke as it is being written; every other letter comes from the glyph cache.
 */
export function drawWovenLetter(
  ctx: CanvasRenderingContext2D,
  l: WovenLetter,
  t: number,
  alpha: number,
  style: WovenStyle,
  scale: number,
  lineLook: boolean,
) {
  ctx.save();
  ctx.globalAlpha = alpha * (l.kind === 'thought' ? 0.72 : 1);
  ctx.translate(l.x, l.y);
  ctx.rotate(l.angle);
  const variant = l.seq % 4;
  const age = t - l.born;
  if (style.hand === 'ductus' && age < WRITE_SEC) {
    const strokes = ductusStrokes(l.ch, { slant: style.slant + (l.kind === 'thought' ? 0.12 : 0), wobble: style.wobble, seed: variant * 7919 + l.ch.charCodeAt(0) });
    drawDuctus(ctx, strokes, l.size * DUCTUS_X_HEIGHT, l.colour, style.weight / DUCTUS_X_HEIGHT, style.stitch, age / WRITE_SEC, !lineLook);
  } else {
    const glyph = stitchedGlyph(l.ch, l.colour, l.size * scale, style.hand, l.kind === 'thought', lineLook, style, variant);
    if (glyph) {
      const w = glyph.width / scale;
      ctx.drawImage(glyph, -w / 2, -w / 2, w, w);
    }
  }
  ctx.restore();
}
