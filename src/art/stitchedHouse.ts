/**
 * Houses in counted cross-stitch, as on a sampler: an outlined wall worked in the linen's
 * own colour, a stepped roof, a dark door, square windows, a band under the eaves, and for
 * the named buildings their own sign (a tower and cross, a wheel, a curl of smoke). Lighter
 * on the cloth than the solid fold-out houses, and in the same stitch as the motifs.
 *
 * Charted straight at the world's stitch count: outlines are one stitch wide, and doors,
 * windows and chimneys are sized in proportion to the house, so a big house is a finer
 * chart, not a coarser one.
 *
 * Pure and seeded; ink roles only.
 */
import { createSeededRng } from '../core/rng';
import type { Cell, MotifGrid } from './patternGrammar';
import type { BuildingVariant } from './scene';
import type { Ink } from './shapes';

/**
 * Stitches per map cell for all counted work in the world (houses, roads, pattern marks,
 * medallions): about two threads' width per stitch, as in real cross-stitch.
 */
export const STITCHES_PER_CELL = 8;

/** A stitched house at the world's count, charted to its size. */
export function stitchedHouse(kind: StitchedKind, widthUnits: number, heightUnits: number, seed: number, U: number): { grid: MotifGrid; cell: number } {
  const cell = U / STITCHES_PER_CELL;
  return { grid: stitchedHouseGrid(kind, Math.round(widthUnits / cell), Math.round(heightUnits / cell), seed), cell };
}

export type StitchedKind = BuildingVariant | 'folk';

/**
 * A house `cols` stitches wide (the wall) and `rows` tall (wall and roof). A church's tower
 * and a mill's wheel add stitches to one side.
 */
export function stitchedHouseGrid(kind: StitchedKind, cols: number, rows: number, seed: number): MotifGrid {
  const rng = createSeededRng(seed);
  // Details in proportion to the house.
  const unit = Math.max(1, Math.round(Math.min(cols, rows) / 9));
  const tower = kind === 'church' ? Math.max(3, Math.round(cols * 0.3)) : 0;
  const wheelR = kind === 'mill' ? Math.max(2, unit * 2) : 0;
  const wallW = Math.max(7, cols - tower);
  const w = wallW + tower + (wheelR ? wheelR * 2 + 2 : 0) + (tower ? 1 : 0);
  const spire = kind === 'church' ? Math.max(4, unit * 4) : 0;
  const h = rows + spire;
  const cells: Cell[][] = Array.from({ length: h }, () => Array<Cell>(w).fill(null));
  const set = (x: number, y: number, ink: Ink) => {
    if (x >= 0 && y >= 0 && x < w && y < h) cells[y][x] = ink;
  };
  const block = (x0: number, y0: number, bw: number, bh: number, ink: Ink) => {
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) set(x, y, ink);
  };
  const roofInk: Ink = kind === 'church' ? 'secondary' : (['primary', 'primary', 'accent', 'secondary', 'dark'] as const)[Math.floor(rng() * 5)];
  const trimInk: Ink = (['gold', 'accent2', 'accent'] as const).filter((i) => i !== roofInk)[Math.floor(rng() * 2)];
  const bodyRows = Math.max(5, Math.round(rows * (kind === 'tall' ? 0.62 : kind === 'long' || kind === 'barn' ? 0.5 : 0.55)));
  const roofRows = rows - bodyRows;
  const base = h - 1;
  const top = base - bodyRows + 1; // the top row of the wall

  // The wall: a one-stitch outline in the dark thread, the inside left as linen. A barn is
  // filled with a sparse check.
  for (let x = 0; x < wallW; x++) {
    set(x, base, 'dark');
    set(x, top, 'dark');
  }
  for (let y = top; y <= base; y++) {
    set(0, y, 'dark');
    set(wallW - 1, y, 'dark');
  }
  if (kind === 'barn') for (let y = top + 1; y < base; y++) for (let x = 1; x < wallW - 1; x++) if ((x + y) % 3 === 0) set(x, y, 'primary');
  // A band of the trim thread under the eaves: a small zigzag.
  if (bodyRows >= 7 && kind !== 'barn') for (let x = 1; x < wallW - 1; x++) set(x, top + 1 + unit + Math.round(Math.sin((x / unit) * 1.6) * unit * 0.6), trimInk);

  // The roof, from the eaves up: stepped in, outlined, a stripe of the trim every few rows.
  const roof = kind === 'church' || kind === 'tall' || kind === 'folk' ? 'gable' : kind === 'barn' ? 'hip' : (['gable', 'gable', 'hip'] as const)[Math.floor(rng() * 3)];
  const stripe = Math.max(2, Math.round(roofRows / 4));
  for (let r = 0; r < roofRows; r++) {
    const y = top - 1 - r;
    const t = (r + 1) / roofRows;
    const half = (wallW + 2) / 2;
    const reach = roof === 'gable' ? half * (1 - t) + 0.5 : half * (1 - t * 0.6);
    const x0 = Math.round(wallW / 2 - reach);
    const x1 = Math.round(wallW / 2 + reach) - 1;
    const edge = r === roofRows - 1 || r === 0;
    for (let x = x0; x <= x1; x++) set(x, y, x === x0 || x === x1 || (roof === 'hip' && edge) ? 'dark' : r % stripe === stripe - 1 ? trimInk : roofInk);
  }
  // A chimney, and smoke over a smithy or bakery.
  if (kind !== 'barn' && kind !== 'church' && (rng() < 0.6 || kind === 'smithy' || kind === 'bakery')) {
    const cx = Math.round(wallW * (rng() < 0.5 ? 0.28 : 0.72));
    const cy = top - Math.round(roofRows * 0.55);
    block(cx, cy - unit * 3, unit, unit * 3 + 1, 'dark');
    if (kind === 'smithy' || kind === 'bakery') {
      for (let k = 0; k < 4; k++) set(cx + Math.round(Math.sin(k * 1.4) * unit), cy - unit * 3 - 2 - k * unit, 'dark');
    }
  }

  // The door, at a person's height; a barn's is wide.
  const doorW = kind === 'barn' ? Math.max(3, Math.round(wallW * 0.35)) : Math.max(2, unit * 2);
  const doorH = Math.min(bodyRows - 2, kind === 'barn' ? bodyRows - 2 : Math.max(3, Math.round(bodyRows * 0.6)));
  const doorX = kind === 'long' ? Math.round(wallW * 0.22) : Math.round((wallW - doorW) / 2);
  block(doorX, base - doorH, doorW, doorH, 'dark');
  // Windows: squares in one row (two in a tall house), clear of the door.
  if (kind !== 'barn') {
    const winInk: Ink = trimInk === 'gold' ? 'secondary' : 'gold';
    const s = Math.max(2, unit * 2);
    const rowsY = kind === 'tall' ? [top + 2 + unit * 2, base - doorH] : [Math.round((top + base) / 2) - Math.floor(s / 2) + unit];
    const gap = s * 2;
    for (const y of rowsY) {
      for (let x = 2 + unit; x + s < wallW - 1; x += gap) {
        if (x + s > doorX - 1 && x < doorX + doorW + 1) continue;
        block(x, y, s, s, winInk);
      }
    }
  }
  if (kind === 'inn') block(doorX + doorW + unit, base - doorH, Math.max(2, unit * 2), Math.max(2, unit * 2), 'primary');

  if (kind === 'church') {
    // A bell tower beside the nave, a pointed roof and a cross.
    const tx0 = wallW + 1;
    const tx1 = tx0 + tower - 1;
    const tTop = spire + 2;
    for (let y = tTop; y <= base; y++) {
      set(tx0, y, 'dark');
      set(tx1, y, 'dark');
    }
    for (let x = tx0; x <= tx1; x++) {
      set(x, tTop, 'dark');
      set(x, base, 'dark');
    }
    for (let x = tx0 + 1; x < tx1; x++) set(x, tTop + 3, 'gold');
    const mid = Math.round((tx0 + tx1) / 2);
    for (let r = 1; r <= Math.ceil(tower / 2); r++) for (let x = tx0 + r - 1; x <= tx1 - r + 1; x++) set(x, tTop - r, roofInk);
    for (let y = 0; y <= tTop - Math.ceil(tower / 2) - 1; y++) set(mid, y, 'dark');
    set(mid - 1, 1, 'dark');
    set(mid + 1, 1, 'dark');
  }
  if (wheelR) {
    // A water wheel at the end of the house: a ring with spokes.
    const cx = wallW + 1 + wheelR;
    const cy = base - wheelR;
    for (let a = 0; a < 32; a++) set(Math.round(cx + Math.cos((a / 32) * Math.PI * 2) * wheelR), Math.round(cy + Math.sin((a / 32) * Math.PI * 2) * wheelR), 'dark');
    for (let k = -wheelR + 1; k < wheelR; k++) {
      set(cx + k, cy, 'dark');
      set(cx, cy + k, 'dark');
    }
    set(cx, cy, 'gold');
  }
  return { w, h, cells };
}
