/**
 * Composition operators for counted work: the ways a cloth is built up from motifs, taken
 * from how pattern albums and woven rugs are organised (bands between guide lines, designed
 * corners, frames, nested medallions, stacks along an axis). Everything stays on one thread
 * grid: motifs are mirrored, turned by quarters, repeated whole and never cut, so a
 * composition reads as one piece of needlework and not as pictures laid on a cloth.
 *
 * Pure functions over `MotifGrid`; only `stamp` writes into the grid it is given.
 */
import type { Ink } from './shapes';
import type { Cell, MotifGrid } from './patternGrammar';

export function blankGrid(w: number, h: number): MotifGrid {
  return { w, h, cells: Array.from({ length: h }, () => Array<Cell>(w).fill(null)) };
}

/** A motif written as rows of characters; `inks` says which character is which role. */
export function fromRows(rows: readonly string[], inks: Record<string, Ink> = { '#': 'primary', x: 'dark', o: 'secondary' }): MotifGrid {
  const w = Math.max(...rows.map((r) => r.length));
  return { w, h: rows.length, cells: rows.map((r) => Array.from({ length: w }, (_, x) => inks[r[x]] ?? null)) };
}

/** Works `src` into `dst` with its top-left stitch at (x, y). Empty cells leave the cloth as it is. */
export function stamp(dst: MotifGrid, src: MotifGrid, x: number, y: number): void {
  for (let sy = 0; sy < src.h; sy++) {
    const row = dst.cells[y + sy];
    if (!row) continue;
    for (let sx = 0; sx < src.w; sx++) {
      const c = src.cells[sy][sx];
      if (c && x + sx >= 0 && x + sx < dst.w) row[x + sx] = c;
    }
  }
}

/** Unpicks a rectangle, for a motif that needs bare cloth round it. */
export function clear(dst: MotifGrid, x: number, y: number, w: number, h: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(dst.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(dst.w, x + w); xx++) dst.cells[yy][xx] = null;
}

export function mirrorX(g: MotifGrid): MotifGrid {
  return { w: g.w, h: g.h, cells: g.cells.map((r) => [...r].reverse()) };
}

export function mirrorY(g: MotifGrid): MotifGrid {
  return { w: g.w, h: g.h, cells: [...g.cells].reverse().map((r) => [...r]) };
}

/** The motif laid on its side (rows become columns), for the upright sides of a frame. */
export function turn(g: MotifGrid): MotifGrid {
  return { w: g.h, h: g.w, cells: Array.from({ length: g.w }, (_, y) => Array.from({ length: g.h }, (_, x) => g.cells[x][y])) };
}

/** The same motif in other threads. Roles not named keep their own. */
export function recolor(g: MotifGrid, map: Partial<Record<Ink, Ink>>): MotifGrid {
  return { w: g.w, h: g.h, cells: g.cells.map((r) => r.map((c) => (c ? (map[c] ?? c) : null))) };
}

export interface RepeatOptions {
  /** Bare stitches between one motif and the next. */
  gap?: number;
  /** Every other motif is worked in these threads (the A B A B of a band). */
  alternate?: Partial<Record<Ink, Ink>>;
  /** Where shorter motifs sit in the band's height. */
  align?: 'bottom' | 'centre' | 'top';
  /** Fewer motifs than would fit: a number to hold the band to. */
  count?: number;
}

/**
 * A band: the motifs in turn, repeated whole along `length` stitches and centred, with the
 * remainder left bare at the ends. A motif is never cut to make it fit.
 */
export function repeat(units: readonly MotifGrid[], length: number, options: RepeatOptions = {}): MotifGrid {
  const { gap = 2, alternate, align = 'bottom' } = options;
  const h = Math.max(...units.map((u) => u.h));
  const out = blankGrid(length, h);
  const run: MotifGrid[] = [];
  let used = 0;
  for (let i = 0; options.count === undefined || i < options.count; i++) {
    const unit = units[i % units.length];
    const next = used + (i ? gap : 0) + unit.w;
    if (next > length) break;
    run.push(alternate && i % 2 ? recolor(unit, alternate) : unit);
    used = next;
  }
  // A band reads best when it ends as it began: drop the last motif if that restores the mirror.
  if (options.count === undefined && units.length > 1 && run.length > 1 && run.length % units.length !== 1) {
    while (run.length > 1 && run.length % units.length !== 1) used -= run.pop()!.w + gap;
  }
  let x = Math.floor((length - used) / 2);
  for (const unit of run) {
    const y = align === 'top' ? 0 : align === 'centre' ? Math.floor((h - unit.h) / 2) : h - unit.h;
    stamp(out, unit, x, y);
    x += unit.w + gap;
  }
  return out;
}

/** Motifs side by side on a common ground line, `gap` bare stitches apart. */
export function beside(parts: readonly MotifGrid[], gap = 2, align: 'bottom' | 'centre' = 'bottom'): MotifGrid {
  const w = parts.reduce((n, p) => n + p.w, 0) + gap * (parts.length - 1);
  const h = Math.max(...parts.map((p) => p.h));
  const out = blankGrid(w, h);
  let x = 0;
  for (const p of parts) {
    stamp(out, p, x, align === 'centre' ? Math.floor((h - p.h) / 2) : h - p.h);
    x += p.w + gap;
  }
  return out;
}

/** Motifs one above another on a shared axis, top first. */
export function stack(parts: readonly MotifGrid[], gap = 0): MotifGrid {
  const w = Math.max(...parts.map((p) => p.w));
  const h = parts.reduce((n, p) => n + p.h, 0) + gap * (parts.length - 1);
  const out = blankGrid(w, h);
  let y = 0;
  for (const p of parts) {
    stamp(out, p, Math.floor((w - p.w) / 2), y);
    y += p.h + gap;
  }
  return out;
}

/**
 * One motif held in the heart of another. Stitches of the outer motif that would touch the
 * inner one are unpicked, so the two never run together.
 */
export function nest(outer: MotifGrid, inner: MotifGrid): MotifGrid {
  const out = { w: outer.w, h: outer.h, cells: outer.cells.map((r) => [...r]) };
  const x = Math.floor((outer.w - inner.w) / 2);
  const y = Math.floor((outer.h - inner.h) / 2);
  for (let sy = 0; sy < inner.h; sy++) for (let sx = 0; sx < inner.w; sx++) if (inner.cells[sy][sx]) clear(out, x + sx - 1, y + sy - 1, 3, 3);
  stamp(out, inner, x, y);
  return out;
}

/** A guide line: a row of running stitches (`every` 1 is a solid line), spaced from both ends so it mirrors. */
export function rule(dst: MotifGrid, y: number, x0: number, x1: number, ink: Ink = 'dark', every = 2): void {
  if (y < 0 || y >= dst.h) return;
  for (let x = Math.max(0, x0); x <= Math.min(dst.w - 1, x1); x++) if (Math.min(x - x0, x1 - x) % every === 0) dst.cells[y][x] = ink;
}

/** An upright guide line. */
export function post(dst: MotifGrid, x: number, y0: number, y1: number, ink: Ink = 'dark', every = 2): void {
  if (x < 0 || x >= dst.w) return;
  for (let y = Math.max(0, y0); y <= Math.min(dst.h - 1, y1); y++) if (Math.min(y - y0, y1 - y) % every === 0) dst.cells[y][x] = ink;
}

export interface FrameOptions extends RepeatOptions {
  /** A square motif that turns the corner; its side is the frame's thickness. */
  corner: MotifGrid;
}

/**
 * A frame round a cloth of w by h stitches: the band runs along the top, is mirrored along
 * the bottom and laid on its side for the uprights, and a designed motif turns each corner.
 */
export function frame(w: number, h: number, units: readonly MotifGrid[], options: FrameOptions): MotifGrid {
  const t = options.corner.w;
  const out = blankGrid(w, h);
  const pad = (band: MotifGrid) => {
    const g = blankGrid(band.w, t);
    stamp(g, band, 0, Math.floor((t - band.h) / 2));
    return g;
  };
  const top = pad(repeat(units, w - 2 * t - 2, { ...options, align: 'centre' }));
  const side = turn(pad(repeat(units, h - 2 * t - 2, { ...options, align: 'centre' })));
  stamp(out, top, t + 1, 0);
  stamp(out, mirrorY(top), t + 1, h - t);
  stamp(out, side, 0, t + 1);
  stamp(out, mirrorX(side), w - t, t + 1);
  stamp(out, options.corner, 0, 0);
  stamp(out, mirrorX(options.corner), w - t, 0);
  stamp(out, mirrorY(options.corner), 0, h - t);
  stamp(out, mirrorY(mirrorX(options.corner)), w - t, h - t);
  return out;
}

/** The share of the cloth that is worked, 0 to 1: the stitch budget a layout keeps to. */
export function coverage(g: MotifGrid): number {
  let n = 0;
  for (const row of g.cells) for (const c of row) if (c) n++;
  return n / (g.w * g.h);
}
