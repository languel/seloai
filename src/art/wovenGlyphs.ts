/**
 * Embroidered letters for woven text, drawn once per letter, colour and size and cached.
 *
 * Two hands:
 * - "satin": the letter is taken from a serif face and worked as satin stitch, filled with
 *   fine slanting threads that catch the light, with a couched outline and a shadow so it
 *   sits on the cloth. Upper and lower case, easy to read.
 * - "counted": the letter is cross-stitched on the 5 by 7 sampler grid of `lettering`.
 */
import { glyphGrid } from './lettering';

export type WovenHand = 'satin' | 'counted';

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
export function stitchedGlyph(ch: string, colour: string, px: number, hand: WovenHand, italic: boolean, lineLook: boolean): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const size = Math.max(6, Math.round(px));
  const key = `${ch}|${colour}|${size}|${hand}|${italic}|${lineLook}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const side = Math.ceil(size * 1.3);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  const c = side / 2;

  if (hand === 'counted') {
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
