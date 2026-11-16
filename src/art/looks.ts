/**
 * Looks: interchangeable ways of drawing the same shapes. A look never changes what is
 * drawn, only how, so switching look needs no regenerated assets.
 */
import { createSeededRng, type Rng } from '../core/rng';
import type { Ink, Pt, Shape } from './shapes';

export interface Palette {
  ground: string;
  inks: Record<Ink, string>;
  /** Variants of the skin role, light to dark. */
  skinTones: string[];
}

function inkColour(palette: Palette, ink: Ink, tone?: number): string {
  if (ink === 'skin' && tone !== undefined && palette.skinTones.length > 0) {
    return palette.skinTones[Math.abs(Math.round(tone)) % palette.skinTones.length];
  }
  return palette.inks[ink];
}

export const PALETTES = {
  /** Black ink on paper. */
  ink: {
    ground: '#f6f3ec',
    inks: { primary: '#141312', secondary: '#141312', accent: '#141312', accent2: '#141312', gold: '#141312', dark: '#141312', skin: '#f6f3ec' },
    skinTones: ['#f6f3ec'],
  },
  /** White line on black, the same drawing as a night plate. */
  night: {
    ground: '#121110',
    inks: { primary: '#f2eee4', secondary: '#f2eee4', accent: '#f2eee4', accent2: '#f2eee4', gold: '#f2eee4', dark: '#f2eee4', skin: '#121110' },
    skinTones: ['#121110'],
  },
  /** Black thread on undyed linen. */
  blackwork: {
    ground: '#e4dac6',
    inks: { primary: '#1c1a18', secondary: '#2b2826', accent: '#1c1a18', accent2: '#34302c', gold: '#3a352f', dark: '#141210', skin: '#cfc4ae' },
    skinTones: ['#d8cdb8', '#bfb39c', '#a2957e', '#7d7160'],
  },
  /** The traditional register: red and black with one quiet accent. */
  redBlack: {
    ground: '#e6dcc8',
    inks: { primary: '#a8201a', secondary: '#1d1a18', accent: '#7c1712', accent2: '#c0392b', gold: '#b08a3c', dark: '#1d1a18', skin: '#d2a679' },
    skinTones: ['#e8c9a4', '#d2a679', '#b07f52', '#7f5536', '#553623'],
  },
  /** The full festive palette of the museum pieces. */
  festive: {
    ground: '#e3d8c2',
    inks: { primary: '#b0241c', secondary: '#27407f', accent: '#2f6a3c', accent2: '#a82e63', gold: '#b8923a', dark: '#231f1c', skin: '#d2a679' },
    skinTones: ['#e8c9a4', '#d2a679', '#b07f52', '#7f5536', '#553623'],
  },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

export interface LookOptions {
  /** Pixels per unit. */
  unit: number;
  /** Pixel position of the drawing's origin. */
  origin: Pt;
  palette: Palette;
  seed?: number;
}

function toPx(p: Pt, o: LookOptions): Pt {
  return [o.origin[0] + p[0] * o.unit, o.origin[1] + p[1] * o.unit];
}

function tracePath(ctx: CanvasRenderingContext2D, points: Pt[], o: LookOptions, closed: boolean) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const [x, y] = toPx(p, o);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (closed) ctx.closePath();
}

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

/** Parallel strokes across a pixel-space box, at an angle, each handed to `draw`. */
function sweep(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  angle: number,
  spacing: number,
  draw: (x0: number, y0: number, x1: number, y1: number, index: number) => void,
) {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const reach = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2 + spacing;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let index = 0;
  for (let offset = -reach; offset <= reach; offset += spacing) {
    const px = cx - dy * offset;
    const py = cy + dx * offset;
    draw(px - dx * reach, py - dy * reach, px + dx * reach, py + dy * reach, index++);
  }
}

function pixelBox(points: Pt[], o: LookOptions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const [x, y] = toPx(p, o);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------------------
// Look 1: line art. Clean contours with a slight hand; tone comes from solid, hatched and
// open shapes rather than from colour.
// ---------------------------------------------------------------------------------------

/** How each role reads in a single ink: solid, hatched or left open. */
const LINE_TONE: Record<Ink, 'solid' | 'hatch' | 'open'> = {
  skin: 'open',
  primary: 'solid',
  dark: 'solid',
  secondary: 'hatch',
  accent2: 'hatch',
  accent: 'open',
  gold: 'open',
};

function wobble(points: Pt[], rng: Rng, amount: number): Pt[] {
  return points.map(([x, y]): Pt => [x + (rng() - 0.5) * amount, y + (rng() - 0.5) * amount]);
}

export function renderLineArt(ctx: CanvasRenderingContext2D, shapes: Shape[], o: LookOptions) {
  const rng = createSeededRng(o.seed ?? 1);
  const line = Math.max(1, o.unit * 0.3);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const shape of shapes) {
    const colour =
      shape.kind === 'counted'
        ? o.palette.inks.dark
        : inkColour(o.palette, shape.ink, shape.kind === 'area' ? shape.tone : undefined);
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    if (shape.kind === 'area') {
      const points = wobble(shape.points, rng, 0.12);
      const tone = LINE_TONE[shape.ink];
      if (tone === 'solid') {
        tracePath(ctx, points, o, true);
        ctx.fill();
      } else if (tone === 'open') {
        tracePath(ctx, points, o, true);
        ctx.fillStyle = o.palette.ground;
        ctx.fill();
        ctx.fillStyle = colour;
      } else if (tone === 'hatch') {
        ctx.save();
        tracePath(ctx, points, o, true);
        ctx.clip();
        ctx.lineWidth = line * 0.6;
        sweep(pixelBox(points, o), shape.grain, o.unit * 0.85, (x0, y0, x1, y1) => {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        });
        ctx.restore();
      }
      ctx.lineWidth = line;
      ctx.strokeStyle = shape.ink === 'skin' ? o.palette.inks.dark : colour;
      tracePath(ctx, points, o, true);
      ctx.stroke();
    } else if (shape.kind === 'line') {
      ctx.lineWidth = Math.max(1, line * (0.6 + shape.weight * 0.9));
      tracePath(ctx, wobble(shape.points, rng, 0.08), o, Boolean(shape.closed));
      ctx.stroke();
    } else if (shape.kind === 'knot') {
      const [x, y] = toPx(shape.at, o);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.2, shape.r * o.unit), 0, Math.PI * 2);
      if (LINE_TONE[shape.ink] === 'open') {
        ctx.lineWidth = line * 0.8;
        ctx.stroke();
      } else ctx.fill();
    } else {
      const size = shape.cell * o.unit;
      for (const [cx, cy, ink] of shape.cells) {
        const [x, y] = toPx([shape.origin[0] + cx * shape.cell, shape.origin[1] + cy * shape.cell], o);
        const tone = LINE_TONE[ink];
        ctx.strokeStyle = o.palette.inks[ink];
        ctx.fillStyle = o.palette.inks[ink];
        if (tone === 'solid') {
          ctx.fillRect(x - size * 0.42, y - size * 0.42, size * 0.84, size * 0.84);
        } else {
          ctx.lineWidth = line * 0.7;
          ctx.beginPath();
          ctx.moveTo(x - size * 0.36, y - size * 0.36);
          ctx.lineTo(x + size * 0.36, y + size * 0.36);
          if (tone === 'hatch') {
            ctx.moveTo(x + size * 0.36, y - size * 0.36);
            ctx.lineTo(x - size * 0.36, y + size * 0.36);
          }
          ctx.stroke();
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
// Look 2: simulated embroidery. Every mark is a thread: satin stitches laid across areas,
// stem stitch along lines, knots for dots, crosses for counted work, on a woven ground.
// ---------------------------------------------------------------------------------------

/** Fills the canvas with a woven linen ground. */
export function paintLinen(ctx: CanvasRenderingContext2D, width: number, height: number, o: LookOptions) {
  const rng = createSeededRng((o.seed ?? 1) + 77);
  ctx.fillStyle = o.palette.ground;
  ctx.fillRect(0, 0, width, height);
  const pitch = Math.max(2, o.unit * 0.5);
  ctx.lineWidth = Math.max(1, pitch * 0.45);
  for (let y = 0; y < height; y += pitch) {
    ctx.strokeStyle = `rgba(70, 52, 30, ${0.05 + rng() * 0.09})`;
    ctx.beginPath();
    ctx.moveTo(0, y + (rng() - 0.5));
    ctx.lineTo(width, y + (rng() - 0.5));
    ctx.stroke();
  }
  for (let x = 0; x < width; x += pitch) {
    ctx.strokeStyle = `rgba(255, 250, 235, ${0.06 + rng() * 0.1})`;
    ctx.beginPath();
    ctx.moveTo(x + (rng() - 0.5), 0);
    ctx.lineTo(x + (rng() - 0.5), height);
    ctx.stroke();
  }
  // Slubs: the occasional thicker thread that makes hand-woven cloth look hand-woven.
  for (let i = 0; i < (width * height) / 26000; i++) {
    const x = rng() * width;
    const y = rng() * height;
    ctx.strokeStyle = `rgba(90, 68, 40, ${0.08 + rng() * 0.1})`;
    ctx.lineWidth = pitch * (0.6 + rng() * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const along = 12 + rng() * 40;
    if (rng() < 0.5) ctx.lineTo(x + along, y);
    else ctx.lineTo(x, y + along);
    ctx.stroke();
  }
}

function threadStroke(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: string,
  width: number,
  rng: Rng,
) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(colour, 0.82 + rng() * 0.3);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  // Sheen: a thin lighter line along the middle of the thread.
  ctx.strokeStyle = 'rgba(255, 244, 225, 0.22)';
  ctx.lineWidth = Math.max(0.6, width * 0.28);
  ctx.beginPath();
  ctx.moveTo(x0 + (x1 - x0) * 0.18, y0 + (y1 - y0) * 0.18);
  ctx.lineTo(x0 + (x1 - x0) * 0.82, y0 + (y1 - y0) * 0.82);
  ctx.stroke();
}

export function renderEmbroidery(ctx: CanvasRenderingContext2D, shapes: Shape[], o: LookOptions) {
  const rng = createSeededRng(o.seed ?? 1);
  const thread = Math.max(1.4, o.unit * 0.5);
  const lift = Math.max(1, o.unit * 0.16);

  for (const shape of shapes) {
    const colour =
      shape.kind === 'counted'
        ? o.palette.inks.dark
        : inkColour(o.palette, shape.ink, shape.kind === 'area' ? shape.tone : undefined);
    if (shape.kind === 'area') {
      // A hand never follows the drawn edge exactly.
      const points = shape.points.map(([x, y]): Pt => [x + (rng() - 0.5) * 0.22, y + (rng() - 0.5) * 0.22]);
      ctx.save();
      ctx.translate(lift, lift * 1.3);
      tracePath(ctx, points, o, true);
      ctx.fillStyle = 'rgba(40, 26, 12, 0.22)';
      ctx.fill();
      ctx.restore();

      ctx.save();
      tracePath(ctx, points, o, true);
      ctx.clip();
      ctx.fillStyle = shade(colour, 0.7);
      ctx.fill();
      sweep(pixelBox(points, o), shape.grain, thread * 0.92, (x0, y0, x1, y1) => {
        threadStroke(ctx, x0, y0, x1, y1, colour, thread * 1.05, rng);
      });
      ctx.restore();
    } else if (shape.kind === 'line') {
      // Stem stitch: short slanted stitches that overlap along the path.
      const pts = shape.points.map((p) => toPx(p, o));
      if (shape.closed) pts.push(pts[0]);
      // Fine lines (a mouth, a brow) take short, thin stitches; stems take long bold ones.
      const width = Math.max(1.05, thread * (0.4 + shape.weight * 0.75));
      const stitch = thread * (1.1 + shape.weight * 3);
      let carried = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const length = Math.hypot(bx - ax, by - ay);
        if (length < 0.01) continue;
        const ux = (bx - ax) / length;
        const uy = (by - ay) / length;
        for (let d = carried; d < length; d += stitch * 0.62) {
          const sx = ax + ux * d;
          const sy = ay + uy * d;
          const slant = 0.2;
          const ex = sx + (ux * Math.cos(slant) - uy * Math.sin(slant)) * stitch;
          const ey = sy + (ux * Math.sin(slant) + uy * Math.cos(slant)) * stitch;
          ctx.strokeStyle = 'rgba(40, 26, 12, 0.2)';
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(sx + lift, sy + lift);
          ctx.lineTo(ex + lift, ey + lift);
          ctx.stroke();
          threadStroke(ctx, sx, sy, ex, ey, colour, width, rng);
        }
        carried = (carried + Math.ceil((length - carried) / (stitch * 0.62)) * stitch * 0.62) - length;
      }
    } else if (shape.kind === 'knot') {
      const [x, y] = toPx(shape.at, o);
      const r = Math.max(1.6, shape.r * o.unit);
      ctx.fillStyle = 'rgba(40, 26, 12, 0.28)';
      ctx.beginPath();
      ctx.arc(x + lift, y + lift * 1.3, r, 0, Math.PI * 2);
      ctx.fill();
      const glow = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
      glow.addColorStop(0, shade(colour, 1.35));
      glow.addColorStop(1, shade(colour, 0.72));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const size = shape.cell * o.unit;
      const reach = size * 0.46;
      const width = Math.max(1.2, size * 0.34);
      for (const [cx, cy, ink] of shape.cells) {
        const [x, y] = toPx([shape.origin[0] + cx * shape.cell, shape.origin[1] + cy * shape.cell], o);
        const cellColour = o.palette.inks[ink];
        ctx.strokeStyle = 'rgba(40, 26, 12, 0.2)';
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x - reach + lift, y - reach + lift);
        ctx.lineTo(x + reach + lift, y + reach + lift);
        ctx.stroke();
        threadStroke(ctx, x - reach, y + reach, x + reach, y - reach, cellColour, width, rng);
        threadStroke(ctx, x - reach, y - reach, x + reach, y + reach, cellColour, width, rng);
      }
    }
  }
}
