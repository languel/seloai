/**
 * Stitch styles: one family of stitch for a whole cloth, so elements drawn by different
 * generators do not clash (a satin tree beside a cross-stitched house).
 *
 * - `mixed`: as drawn (satin fills, stem lines, counted crosses where a generator chose them).
 * - `cross`: everything charted on one grid: solid areas, lines and knots become counted
 *   cells; open washes (the ground of a plot) stay open, so the cloth does not fill up.
 * - `satin`: counted work becomes satin bars (each run of one colour in a row worked as one
 *   long stitch block), so cross-stitch charts take on the texture of satin and stem work.
 *
 * Pure: shapes in, shapes out; order is kept, so layering is unchanged.
 */
import type { Ink, Pt, Shape } from './shapes';

export type StitchStyle = 'mixed' | 'cross' | 'satin';

export const STITCH_STYLES: ReadonlyArray<{ id: StitchStyle; name: string }> = [
  { id: 'mixed', name: 'Mixed' },
  { id: 'cross', name: 'Cross-stitch' },
  { id: 'satin', name: 'Satin & stem' },
];

function inside([x, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** One shape charted on the world grid of `cell` units (origin at the cloth's corner). */
function chart(shape: Shape, cell: number): Shape | null {
  const cells = new Map<string, [number, number, Ink]>();
  const mark = (x: number, y: number, ink: Ink) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    cells.set(`${cx},${cy}`, [cx, cy, ink]);
  };
  if (shape.kind === 'area') {
    if (shape.open) return null;
    const xs = shape.points.map((p) => p[0]);
    const ys = shape.points.map((p) => p[1]);
    for (let cx = Math.floor(Math.min(...xs) / cell); cx <= Math.floor(Math.max(...xs) / cell); cx++) {
      for (let cy = Math.floor(Math.min(...ys) / cell); cy <= Math.floor(Math.max(...ys) / cell); cy++) {
        if (inside([(cx + 0.5) * cell, (cy + 0.5) * cell], shape.points)) cells.set(`${cx},${cy}`, [cx, cy, shape.ink]);
      }
    }
    // A sliver thinner than a stitch still shows: take its middle.
    if (cells.size === 0 && shape.points.length) {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      mark(mx, my, shape.ink);
    }
  } else if (shape.kind === 'line') {
    const pts = shape.closed ? [...shape.points, shape.points[0]] : shape.points;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell * 0.5)));
      for (let k = 0; k <= steps; k++) mark(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, shape.ink);
    }
    if (pts.length === 1) mark(pts[0][0], pts[0][1], shape.ink);
  } else if (shape.kind === 'knot') {
    const r = Math.max(shape.r, cell * 0.5);
    for (let cx = Math.floor((shape.at[0] - r) / cell); cx <= Math.floor((shape.at[0] + r) / cell); cx++) {
      for (let cy = Math.floor((shape.at[1] - r) / cell); cy <= Math.floor((shape.at[1] + r) / cell); cy++) {
        if (Math.hypot((cx + 0.5) * cell - shape.at[0], (cy + 0.5) * cell - shape.at[1]) <= r + cell * 0.25) cells.set(`${cx},${cy}`, [cx, cy, shape.ink]);
      }
    }
  } else {
    return shape;
  }
  if (cells.size === 0) return null;
  return { kind: 'counted', origin: [cell / 2, cell / 2], cell, cells: [...cells.values()] };
}

/** Counted work as satin bars: each run of one colour along a row becomes one block. */
function satinBars(shape: Extract<Shape, { kind: 'counted' }>): Shape[] {
  const rows = new Map<number, Array<[number, Ink]>>();
  for (const [cx, cy, ink] of shape.cells) {
    const row = rows.get(cy) ?? [];
    row.push([cx, ink]);
    rows.set(cy, row);
  }
  const cos = Math.cos(shape.rot ?? 0);
  const sin = Math.sin(shape.rot ?? 0);
  const at = (lx: number, ly: number): Pt => [shape.origin[0] + lx * cos - ly * sin, shape.origin[1] + lx * sin + ly * cos];
  const c = shape.cell;
  const out: Shape[] = [];
  for (const [cy, row] of rows) {
    row.sort((a, b) => a[0] - b[0]);
    let start = 0;
    for (let i = 1; i <= row.length; i++) {
      if (i < row.length && row[i][0] === row[i - 1][0] + 1 && row[i][1] === row[start][1]) continue;
      const x0 = row[start][0] * c - c * 0.5;
      const x1 = row[i - 1][0] * c + c * 0.5;
      const y0 = cy * c - c * 0.42;
      const y1 = cy * c + c * 0.42;
      // Short satin stitches across the bar, as a satin band is worked.
      out.push({ kind: 'area', points: [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)], ink: row[start][1], grain: Math.PI / 2 + (shape.rot ?? 0), ...(shape.fade ? { fade: shape.fade } : {}) });
      start = i;
    }
  }
  return out;
}

/** The shapes re-worked in one stitch family; `cell` is the chart's stitch size in units. */
export function restitch(shapes: Shape[], style: StitchStyle | undefined, cell: number): Shape[] {
  if (!style || style === 'mixed') return shapes;
  if (style === 'satin') return shapes.flatMap((s) => (s.kind === 'counted' ? satinBars(s) : [s]));
  return shapes.flatMap((s) => {
    if (s.kind === 'counted') return [s];
    const charted = chart(s, cell);
    return charted ? [charted] : s.kind === 'area' && s.open ? [s] : [];
  });
}
