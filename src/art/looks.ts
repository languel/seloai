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
    inks: { primary: '#141312', secondary: '#141312', accent: '#141312', accent2: '#141312', gold: '#141312', dark: '#141312', skin: '#f6f3ec', light: '#141312' },
    skinTones: ['#f6f3ec'],
  },
  /** White line on black, the same drawing as a night plate. */
  night: {
    ground: '#121110',
    inks: { primary: '#f2eee4', secondary: '#f2eee4', accent: '#f2eee4', accent2: '#f2eee4', gold: '#f2eee4', dark: '#f2eee4', skin: '#121110', light: '#f2eee4' },
    skinTones: ['#121110'],
  },
  /** Black thread on undyed linen. */
  blackwork: {
    ground: '#e4dac6',
    inks: { primary: '#1c1a18', secondary: '#2b2826', accent: '#1c1a18', accent2: '#34302c', gold: '#3a352f', dark: '#141210', skin: '#cfc4ae', light: '#eeebe3' },
    skinTones: ['#d8cdb8', '#bfb39c', '#a2957e', '#7d7160'],
  },
  /** The traditional register: red and black with one quiet accent. */
  redBlack: {
    ground: '#e6dcc8',
    inks: { primary: '#a8201a', secondary: '#1d1a18', accent: '#7c1712', accent2: '#c0392b', gold: '#b08a3c', dark: '#1d1a18', skin: '#d2a679', light: '#efece4' },
    skinTones: ['#e8c9a4', '#d2a679', '#b07f52', '#7f5536', '#553623'],
  },
  /** The full festive palette of the museum pieces. */
  festive: {
    ground: '#e3d8c2',
    inks: { primary: '#b0241c', secondary: '#27407f', accent: '#2f6a3c', accent2: '#a82e63', gold: '#b8923a', dark: '#231f1c', skin: '#d2a679', light: '#efece5' },
    skinTones: ['#e8c9a4', '#d2a679', '#b07f52', '#7f5536', '#553623'],
  },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

const SKIN = ['#e8c9a4', '#d2a679', '#b07f52', '#7f5536', '#553623'];
const threads = (ground: string, primary: string, secondary: string, accent: string, accent2: string, gold: string, dark: string, light?: string): Palette => ({
  ground,
  // The light thread: white stone, a cool pale grey a little brighter than the linen, so it shows on it.
  inks: { primary, secondary, accent, accent2, gold, dark, skin: '#d2a679', light: light ?? towardGround(ground, '#f1f0ec', 0.72) },
  skinTones: SKIN,
});

/**
 * A world's own threads: what the full-colour look is worked in for that world. The same
 * ink roles, dyed differently, so a village can be quiet and faded or bright and festive.
 */
export const WORLD_PALETTES: Record<string, { name: string; palette: Palette }> = {
  festive: { name: 'Festive (museum pieces)', palette: PALETTES.festive },
  madder: { name: 'Natural dyes', palette: threads('#e6dccb', '#9a3b2c', '#3f5470', '#6b7046', '#a8676a', '#b58f4a', '#2e2620') },
  faded: { name: 'Faded heirloom', palette: threads('#e8e0d0', '#b0675a', '#6f8093', '#7f9277', '#b48a92', '#c4a76a', '#4a423a') },
  indigo: { name: 'Indigo and rust', palette: threads('#e5ddcd', '#a4502f', '#2c3e66', '#4f6c8a', '#7d93ad', '#c9a865', '#1f2433') },
  rhodope: { name: 'Rhodope wool', palette: threads('#e4d9c5', '#8e2b3a', '#4b3f63', '#5d6b3a', '#c2577a', '#c98f3c', '#2a1f24') },
  harvest: { name: 'Harvest', palette: threads('#e7dcc6', '#a34a28', '#5c5a3a', '#77753d', '#b9753f', '#cfa24d', '#3a2a1d') },
  winter: { name: 'Winter linen', palette: threads('#e9e4da', '#8c5a55', '#5d6f80', '#6f7d6f', '#9b8790', '#a99a76', '#3b3a38') },
};

/**
 * The threads of the world now on show. The village view sets it from the map, so the
 * figures, their threads, woven words and overlays on the cloth are worked in the same
 * palette as the world under them. Interface chrome keeps the look's own colours.
 */
let activeWorldThreads: string | undefined;
let activeThreadColours: ThreadColours | undefined;

/** Threads re-dyed by hand: an ink role and its new colour (hex). */
export type ThreadColours = Partial<Record<Ink, string>>;

export function setActiveWorldThreads(id: string | undefined, colours?: ThreadColours) {
  activeWorldThreads = id && WORLD_PALETTES[id] ? id : undefined;
  activeThreadColours = colours && Object.keys(colours).length ? colours : undefined;
}

/** Names the threads now on show, re-dyed ones included, for caches of drawn things. */
export function activeWorldThreadsId(): string {
  const base = activeWorldThreads ?? 'festive';
  return activeThreadColours ? `${base}+${Object.entries(activeThreadColours).map(([k, v]) => `${k}${v}`).join(',')}` : base;
}

/** The palette for things drawn on the world's cloth (figures, threads, woven words). */
export function clothPalette(look: PaletteName): Palette {
  return worldPalette(look, activeWorldThreads, activeThreadColours);
}

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * A character's own colour, re-dyed for the world's threads: the festive thread role it is
 * nearest to (red, blue, green, rose, gold), in the world's palette. Unchanged under the
 * festive threads, and for anything that is not a #rrggbb colour.
 */
export function clothAccent(hex: string | undefined, look: PaletteName | undefined): string | undefined {
  if (!hex || !look || !/^#[0-9a-f]{3,8}$/i.test(hex)) return hex;
  const palette = clothPalette(look);
  if (palette === PALETTES.festive) return hex;
  const [r, g, b] = rgb(hex);
  const roles = ['primary', 'secondary', 'accent', 'accent2', 'gold'] as const;
  let best: (typeof roles)[number] = 'primary';
  let score = Infinity;
  for (const role of roles) {
    const [fr, fg, fb] = rgb(PALETTES.festive.inks[role]);
    const d = (fr - r) ** 2 + (fg - g) ** 2 + (fb - b) ** 2;
    if (d < score) {
      score = d;
      best = role;
    }
  }
  return palette.inks[best];
}

/** The palette a world is drawn in: its own threads under the full-colour look, else the look's. */
export function worldPalette(look: PaletteName, own?: string, colours?: ThreadColours): Palette {
  if (look !== 'festive') return PALETTES[look];
  const base = own && WORLD_PALETTES[own] ? WORLD_PALETTES[own].palette : PALETTES.festive;
  if (!colours || !Object.keys(colours).length) return base;
  const inks = { ...base.inks };
  for (const [ink, colour] of Object.entries(colours) as Array<[Ink, string]>) if (/^#[0-9a-f]{6}$/i.test(colour)) inks[ink] = colour;
  return { ...base, inks };
}

export interface LookOptions {
  /** Pixels per unit. */
  unit: number;
  /** Pixel position of the drawing's origin. */
  origin: Pt;
  palette: Palette;
  seed?: number;
  /**
   * Quieter work for the background, so the people stand out by texture rather than by
   * fading: `thread` thins every thread (1 is the usual), `sparse` opens filled areas into
   * spaced threads over the linen (0 is solid, 1 the most open).
   */
  quiet?: { thread: number; sparse: number };
  /** The cloth's thread weight: one width for every stitch of the drawing (1 is the usual). */
  threadScale?: number;
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

/** `colour` blended toward `ground` by `t` (0 to 1), as hex. */
function towardGround(colour: string, ground: string, t: number): string {
  const a = parseInt(colour.slice(1), 16);
  const b = parseInt(ground.slice(1), 16);
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** A shape's ink colour, faded toward the ground if the shape asks. */
function shapeColour(o: LookOptions, shape: Shape, ink: Ink, tone?: number): string {
  const colour = inkColour(o.palette, ink, tone);
  return shape.fade && /^#[0-9a-f]{6}$/i.test(colour) && /^#[0-9a-f]{6}$/i.test(o.palette.ground) ? towardGround(colour, o.palette.ground, Math.min(1, shape.fade)) : colour;
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
  light: 'open',
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
  const line = Math.max(0.8, o.unit * 0.3 * (o.quiet?.thread ?? 1) * (o.threadScale ?? 1));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const shape of shapes) {
    const colour =
      shape.kind === 'counted'
        ? shapeColour(o, shape, 'dark')
        : shapeColour(o, shape, shape.ink, shape.kind === 'area' ? shape.tone : undefined);
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    if (shape.kind === 'area') {
      const points = wobble(shape.points, rng, 0.12);
      const tone = shape.open ? 'sparse' : LINE_TONE[shape.ink];
      if (tone === 'sparse') {
        // An open fill: a few spaced lines, so the ground shows through.
        ctx.save();
        tracePath(ctx, points, o, true);
        ctx.clip();
        ctx.lineWidth = line * 0.45;
        ctx.globalAlpha = 0.55;
        sweep(pixelBox(points, o), shape.grain, o.unit * (0.85 + (shape.open ?? 0) * 3), (x0, y0, x1, y1) => {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        });
        ctx.restore();
      } else if (tone === 'solid') {
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
      // A turned grid is drawn in its own frame.
      const turned = Boolean(shape.rot);
      if (turned) {
        ctx.save();
        ctx.translate(...toPx(shape.origin, o));
        ctx.rotate(shape.rot!);
      }
      for (const [cx, cy, ink] of shape.cells) {
        const [x, y] = turned ? [cx * size, cy * size] : toPx([shape.origin[0] + cx * shape.cell, shape.origin[1] + cy * shape.cell], o);
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
      if (turned) ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------------------
// Look 2: simulated embroidery. Every mark is a thread: satin stitches laid across areas,
// stem stitch along lines, knots for dots, crosses for counted work, on a woven ground.
// ---------------------------------------------------------------------------------------

/** Fills the canvas with a woven linen ground. */
/** A small deterministic hash to 0..1, so a thread's look depends only on where it is. */
function unitHash(a: number, b: number, seed: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The linen weave over part of a cloth (x0, y0, w, h, in the cloth's own pixels). Every
 * thread's shade comes from its own position, not from a running sequence, so any region
 * can be drawn on its own and still meet its neighbours exactly: the world is drawn in
 * tiles at the sharpness of the zoom.
 */
export function paintLinenRegion(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, o: LookOptions) {
  const seed = (o.seed ?? 1) + 77;
  ctx.fillStyle = o.palette.ground;
  ctx.fillRect(x0, y0, w, h);
  const pitch = Math.max(2, o.unit * 0.5);
  ctx.lineWidth = Math.max(1, pitch * 0.45);
  for (let k = Math.floor(y0 / pitch); k * pitch <= y0 + h; k++) {
    const y = k * pitch;
    ctx.strokeStyle = `rgba(70, 52, 30, ${0.05 + unitHash(k, 1, seed) * 0.09})`;
    ctx.beginPath();
    ctx.moveTo(x0, y + (unitHash(k, 2, seed) - 0.5));
    ctx.lineTo(x0 + w, y + (unitHash(k, 2, seed) - 0.5));
    ctx.stroke();
  }
  for (let k = Math.floor(x0 / pitch); k * pitch <= x0 + w; k++) {
    const x = k * pitch;
    ctx.strokeStyle = `rgba(255, 250, 235, ${0.06 + unitHash(k, 3, seed) * 0.1})`;
    ctx.beginPath();
    ctx.moveTo(x + (unitHash(k, 4, seed) - 0.5), y0);
    ctx.lineTo(x + (unitHash(k, 4, seed) - 0.5), y0 + h);
    ctx.stroke();
  }
  // Slubs, one in about every 160-pixel square, placed by that square's own hash; the
  // squares just outside the region are included, since a slub can reach into it.
  const cell = 160;
  for (let cx = Math.floor(x0 / cell) - 1; cx * cell <= x0 + w; cx++) {
    for (let cy = Math.floor(y0 / cell) - 1; cy * cell <= y0 + h; cy++) {
      const x = (cx + unitHash(cx, cy, seed + 5)) * cell;
      const y = (cy + unitHash(cx, cy, seed + 6)) * cell;
      ctx.strokeStyle = `rgba(90, 68, 40, ${0.08 + unitHash(cx, cy, seed + 7) * 0.1})`;
      ctx.lineWidth = pitch * (0.6 + unitHash(cx, cy, seed + 8) * 0.6);
      const along = 12 + unitHash(cx, cy, seed + 9) * 40;
      ctx.beginPath();
      ctx.moveTo(x, y);
      if (unitHash(cx, cy, seed + 10) < 0.5) ctx.lineTo(x + along, y);
      else ctx.lineTo(x, y + along);
      ctx.stroke();
    }
  }
}

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

/** Where the light comes from: the upper left, as on a cloth by a window. */
const LIGHT: Pt = [-0.6, -0.8];

/**
 * One thread, lit as a rounded strand: its body, a shadow along the side away from the
 * light and a highlight along the side toward it. Both grow as the thread turns square to
 * the light, so a fill swept one way takes a satin sheen and an outline's stitches catch
 * the light differently as it turns.
 */
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
  const length = Math.hypot(x1 - x0, y1 - y0);
  if (length < 0.01) return;
  // The thread's side that faces the light, and how squarely it faces it.
  let nx = -(y1 - y0) / length;
  let ny = (x1 - x0) / length;
  const dot = nx * LIGHT[0] + ny * LIGHT[1];
  if (dot < 0) {
    nx = -nx;
    ny = -ny;
  }
  const facing = Math.abs(dot);
  const alpha = ctx.globalAlpha;
  const a = 0.14;
  const b = 0.86;
  // Shadow: a darker strand along the far side.
  const off = width * 0.24;
  ctx.strokeStyle = shade(colour, 0.58);
  ctx.globalAlpha = alpha * (0.22 + 0.33 * facing);
  ctx.lineWidth = width * 0.4;
  ctx.beginPath();
  ctx.moveTo(x0 - nx * off, y0 - ny * off);
  ctx.lineTo(x1 - nx * off, y1 - ny * off);
  ctx.stroke();
  // Highlight: a light strand along the near side, inset from the ends.
  ctx.strokeStyle = 'rgb(255, 247, 230)';
  ctx.globalAlpha = alpha * (0.14 + 0.36 * facing);
  ctx.lineWidth = Math.max(0.5, width * 0.28);
  ctx.beginPath();
  ctx.moveTo(x0 + (x1 - x0) * a + nx * off, y0 + (y1 - y0) * a + ny * off);
  ctx.lineTo(x0 + (x1 - x0) * b + nx * off, y0 + (y1 - y0) * b + ny * off);
  ctx.stroke();
  ctx.globalAlpha = alpha;
}

export function renderEmbroidery(ctx: CanvasRenderingContext2D, shapes: Shape[], o: LookOptions) {
  const rng = createSeededRng(o.seed ?? 1);
  const thin = o.quiet?.thread ?? 1;
  const sparse = o.quiet?.sparse ?? 0;
  const thread = Math.max(1.1, o.unit * 0.5 * thin * (o.threadScale ?? 1));
  const lift = Math.max(1, o.unit * 0.16);

  for (const shape of shapes) {
    const colour =
      shape.kind === 'counted'
        ? o.palette.inks.dark
        : inkColour(o.palette, shape.ink, shape.kind === 'area' ? shape.tone : undefined);
    if (shape.kind === 'area') {
      // A hand never follows the drawn edge exactly.
      const points = shape.points.map(([x, y]): Pt => [x + (rng() - 0.5) * 0.22, y + (rng() - 0.5) * 0.22]);
      if (shape.open || sparse > 0) {
        // An open fill: spaced threads over a faint wash, so the linen shows through.
        const open = Math.min(1, Math.max(shape.open ?? 0, sparse));
        ctx.save();
        tracePath(ctx, points, o, true);
        ctx.clip();
        ctx.globalAlpha = 0.16 * (1 - open * 0.5);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.globalAlpha = 0.75;
        sweep(pixelBox(points, o), shape.grain, thread * (1.6 + open * 4), (x0, y0, x1, y1) => {
          threadStroke(ctx, x0, y0, x1, y1, colour, thread * 0.75, rng);
        });
        ctx.restore();
        continue;
      }
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
      const box = pixelBox(points, o);
      sweep(box, shape.grain, thread * 0.92, (x0, y0, x1, y1) => {
        threadStroke(ctx, x0, y0, x1, y1, colour, thread * 1.05, rng);
      });
      // Padded work: the whole fill a little lighter toward the light, darker away from it.
      const { minX: bx0, minY: by0, maxX: bx1, maxY: by1 } = box;
      const cx = (bx0 + bx1) / 2;
      const cy = (by0 + by1) / 2;
      const reach = Math.hypot(bx1 - bx0, by1 - by0) / 2;
      const form = ctx.createLinearGradient(cx + LIGHT[0] * reach, cy + LIGHT[1] * reach, cx - LIGHT[0] * reach, cy - LIGHT[1] * reach);
      form.addColorStop(0, 'rgba(255, 247, 230, 0.16)');
      form.addColorStop(0.5, 'rgba(255, 247, 230, 0)');
      form.addColorStop(0.5, 'rgba(40, 26, 12, 0)');
      form.addColorStop(1, 'rgba(40, 26, 12, 0.2)');
      ctx.fillStyle = form;
      ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      ctx.restore();
    } else if (shape.kind === 'line') {
      // Stem stitch: short slanted stitches that overlap along the path.
      const pts = shape.points.map((p) => toPx(p, o));
      if (shape.closed) pts.push(pts[0]);
      // Fine lines (a mouth, a brow) take short, thin stitches; stems take long bold ones.
      const width = Math.max(0.9, thread * (0.4 + shape.weight * 0.75));
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
          // A stitch never runs past the end of its segment, so corners stay clean.
          const reach = Math.min(stitch, Math.max(stitch * 0.35, length - d));
          const ex = sx + (ux * Math.cos(slant) - uy * Math.sin(slant)) * reach;
          const ey = sy + (ux * Math.sin(slant) + uy * Math.cos(slant)) * reach;
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
      const r = Math.max(1.4, shape.r * o.unit * (0.55 + 0.45 * thin));
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
      // A cross is worked in the cloth's one thread, never fattened to fill a big cell.
      const width = Math.max(0.9, Math.min(size * 0.45, thread * 0.9));
      const turned = Boolean(shape.rot);
      if (turned) {
        ctx.save();
        ctx.translate(...toPx(shape.origin, o));
        ctx.rotate(shape.rot!);
      }
      for (const [cx, cy, ink] of shape.cells) {
        const [x, y] = turned ? [cx * size, cy * size] : toPx([shape.origin[0] + cx * shape.cell, shape.origin[1] + cy * shape.cell], o);
        const cellColour = shapeColour(o, shape, ink);
        ctx.strokeStyle = 'rgba(40, 26, 12, 0.2)';
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x - reach + lift, y - reach + lift);
        ctx.lineTo(x + reach + lift, y + reach + lift);
        ctx.stroke();
        threadStroke(ctx, x - reach, y + reach, x + reach, y - reach, cellColour, width, rng);
        threadStroke(ctx, x - reach, y - reach, x + reach, y + reach, cellColour, width, rng);
      }
      if (turned) ctx.restore();
    }
  }
}
