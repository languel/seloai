/**
 * The stitch kit: small images of running stitch, knots and thread, drawn through a look,
 * that the interface uses for frames, dividers and sliders. The kit is exposed as CSS
 * custom properties (see `stitchVars`), so plain CSS classes in `index.css` can draw a
 * panel's stitched frame or a knot divider in whichever look is active.
 */
import { PALETTES, renderEmbroidery, renderLineArt, type LookOptions, type PaletteName } from './looks';
import type { Ink, Pt, Shape } from './shapes';

/** Device pixels per CSS pixel in the kit's images. */
const DPR = 2;
/** Canvas pixels per shape unit: one unit is a thread's width at interface scale. */
const UNIT = 2.4 * DPR;

/** Geometry of the frame image, in canvas pixels. Edges repeat in whole stitch periods. */
export const FRAME = {
  size: 96,
  slice: 20,
  inset: 6,
  radius: 12,
  period: 14,
  dash: 8,
} as const;

function isThread(look: PaletteName): boolean {
  return look !== 'ink' && look !== 'night';
}

function render(ctx: CanvasRenderingContext2D, look: PaletteName, shapes: Shape[], seed: number) {
  const options: LookOptions = { unit: UNIT, origin: [0, 0], palette: PALETTES[look], seed };
  if (isThread(look)) renderEmbroidery(ctx, shapes, options);
  else renderLineArt(ctx, shapes, options);
}

const u = (p: Pt): Pt => [p[0] / UNIT, p[1] / UNIT];

function canvasUrl(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  paint(ctx);
  return canvas.toDataURL('image/png');
}

/** One running stitch: a short stroke between two canvas points. */
function dash(a: Pt, b: Pt, ink: Ink): Shape {
  return { kind: 'line', points: [u(a), u(b)], ink, weight: 0.45 };
}

/**
 * The positions of running stitches on one straight edge, aligned so the repeating middle
 * of the frame starts on a stitch.
 */
export function frameDashStarts(): number[] {
  const { size, slice, radius, inset, period, dash: len } = FRAME;
  const first = inset + radius;
  const last = size - inset - radius;
  const starts: number[] = [];
  for (let x = slice - period * 4; x + len <= last; x += period) if (x >= first) starts.push(x);
  return starts;
}

/** A rounded running-stitch frame for `border-image`. */
function frameImage(look: PaletteName, ink: Ink): string {
  const { size, inset, radius, dash: len } = FRAME;
  return canvasUrl(size, size, (ctx) => {
    const shapes: Shape[] = [];
    const a = inset;
    const b = size - inset;
    for (const x of frameDashStarts()) {
      shapes.push(dash([x, a], [x + len, a], ink));
      shapes.push(dash([x, b], [x + len, b], ink));
      shapes.push(dash([a, x], [a, x + len], ink));
      shapes.push(dash([b, x], [b, x + len], ink));
    }
    // One curved stitch at each corner.
    const corners: Array<[number, number, number]> = [
      [a + radius, a + radius, Math.PI],
      [b - radius, a + radius, -Math.PI / 2],
      [b - radius, b - radius, 0],
      [a + radius, b - radius, Math.PI / 2],
    ];
    for (const [cx, cy, start] of corners) {
      const pts: Pt[] = [];
      for (let i = 0; i <= 4; i++) {
        const t = start + (Math.PI / 2) * (0.2 + (i / 4) * 0.6);
        pts.push(u([cx + Math.cos(t) * radius, cy + Math.sin(t) * radius]));
      }
      shapes.push({ kind: 'line', points: pts, ink, weight: 0.45 });
    }
    render(ctx, look, shapes, 3);
  });
}

/** A single knot in a small tile, repeated along a row or column to make a divider. */
function knotImage(look: PaletteName, ink: Ink, tile: number, radius: number): string {
  return canvasUrl(tile, tile, (ctx) => {
    render(ctx, look, [{ kind: 'knot', at: u([tile / 2, tile / 2]), r: radius / UNIT, ink }], 5);
  });
}

/** One running stitch per tile, repeated across to make a slider track. */
function trackImage(look: PaletteName, ink: Ink): string {
  const w = FRAME.period;
  const h = 16;
  return canvasUrl(w, h, (ctx) => {
    render(ctx, look, [dash([2, h / 2], [2 + FRAME.dash, h / 2], ink)], 9);
  });
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t);
  return `#${[16, 8, 0].map((shift) => ch(shift).toString(16).padStart(2, '0')).join('')}`;
}

export interface StitchKit {
  look: PaletteName;
  dark: boolean;
  /** Text and outline ink. */
  ink: string;
  /** Quieter text. */
  muted: string;
  /** The look's main thread, for active and selected things. */
  thread: string;
  /** Cloth patch behind panels: see-through so the world shows. */
  patch: string;
  /** A stronger patch for floating tips and menus. */
  patchStrong: string;
  frame: string;
  frameActive: string;
  knot: string;
  knotActive: string;
  track: string;
  thumb: string;
}

const kits = new Map<PaletteName, StitchKit>();

export function stitchKit(look: PaletteName): StitchKit {
  const hit = kits.get(look);
  if (hit) return hit;
  const palette = PALETTES[look];
  const dark = look === 'night';
  const ground = palette.ground;
  const light = mix(ground, dark ? '#000000' : '#ffffff', 0.35);
  const kit: StitchKit = {
    look,
    dark,
    ink: palette.inks.dark,
    muted: mix(palette.inks.dark, ground, 0.42),
    thread: palette.inks.primary,
    patch: withAlpha(light, 0.78),
    patchStrong: withAlpha(light, 0.95),
    frame: frameImage(look, 'dark'),
    frameActive: frameImage(look, 'primary'),
    knot: knotImage(look, 'dark', 16, 2.4),
    knotActive: knotImage(look, 'primary', 16, 2.6),
    track: trackImage(look, 'dark'),
    thumb: knotImage(look, 'primary', 28, 9),
  };
  // Only cache a kit whose images were actually drawn (not during server rendering).
  if (kit.frame) kits.set(look, kit);
  return kit;
}

/** The kit as CSS custom properties, for a wrapper element's `style`. */
export function stitchVars(kit: StitchKit): Record<string, string> {
  const url = (s: string) => (s ? `url("${s}")` : 'none');
  return {
    '--stitch-ink': kit.ink,
    '--stitch-muted': kit.muted,
    '--stitch-thread': kit.thread,
    '--stitch-patch': kit.patch,
    '--stitch-patch-strong': kit.patchStrong,
    '--stitch-frame': url(kit.frame),
    '--stitch-frame-active': url(kit.frameActive),
    '--stitch-knot': url(kit.knot),
    '--stitch-knot-active': url(kit.knotActive),
    '--stitch-track': url(kit.track),
    '--stitch-thumb': url(kit.thumb),
  };
}

/**
 * The app shell's colour tokens (the `--bg-*`, `--text-*`, `--border-folk` and `--accent-*`
 * variables Tailwind maps) taken from a look's palette, so switching World Look restyles
 * every view: linen and thread for the cloth looks, paper and ink, or the night plate.
 */
export function shellVars(look: PaletteName): Record<string, string> {
  const palette = PALETTES[look];
  const { ground } = palette;
  const { dark, primary, secondary, gold, accent } = palette.inks;
  const night = look === 'night';
  const lift = night ? '#000000' : '#ffffff';
  return {
    '--bg-linen': ground,
    '--bg-surface': mix(ground, night ? '#ffffff' : dark, night ? 0.05 : 0.045),
    '--bg-card': mix(ground, lift, night ? 0.3 : 0.4),
    '--text-ink': dark,
    '--text-muted': mix(dark, ground, 0.42),
    '--border-folk': mix(dark, ground, night ? 0.72 : 0.78),
    '--accent-crimson': primary,
    '--accent-indigo': secondary,
    '--accent-ochre': gold,
    '--accent-sage': accent,
  };
}
