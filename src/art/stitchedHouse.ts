/**
 * Houses in counted cross-stitch, as on a sampler: an outlined wall worked in the linen's
 * own colour, a stepped roof, a dark door, small square windows, a band under the eaves,
 * and for the named buildings their own sign (a tower and cross, a wheel, a curl of smoke).
 * Lighter on the cloth than the solid fold-out houses, and in the same stitch as the motifs.
 *
 * Pure and seeded; ink roles only.
 */
import { createSeededRng } from '../core/rng';
import type { Cell, MotifGrid } from './patternGrammar';
import type { BuildingVariant } from './scene';
import type { Ink } from './shapes';

/** Stitches per map cell for stitched houses and pattern marks, so they share one count. */
export const STITCHES_PER_CELL = 6;

export type StitchedKind = BuildingVariant | 'folk';

/**
 * A house `cols` stitches wide (the wall) and `rows` tall (wall and roof). A church's tower
 * and a mill's wheel add a few stitches to one side.
 */
export function stitchedHouseGrid(kind: StitchedKind, cols: number, rows: number, seed: number): MotifGrid {
  const rng = createSeededRng(seed);
  const tower = kind === 'church' ? Math.max(3, Math.round(cols * 0.3)) : 0;
  const wheel = kind === 'mill' ? 5 : 0;
  const wallW = Math.max(5, cols - tower);
  const w = wallW + tower + wheel + (tower ? 1 : 0);
  const spire = kind === 'church' ? 4 : 0;
  const h = rows + spire;
  const cells: Cell[][] = Array.from({ length: h }, () => Array<Cell>(w).fill(null));
  const set = (x: number, y: number, ink: Ink) => {
    if (x >= 0 && y >= 0 && x < w && y < h) cells[y][x] = ink;
  };
  const roofInk: Ink = kind === 'church' ? 'secondary' : (['primary', 'primary', 'accent', 'secondary', 'dark'] as const)[Math.floor(rng() * 5)];
  const trimInk: Ink = (['gold', 'accent2', 'accent'] as const).filter((i) => i !== roofInk)[Math.floor(rng() * 2)];
  const bodyRows = Math.max(4, Math.round(rows * (kind === 'tall' ? 0.62 : kind === 'long' || kind === 'barn' ? 0.5 : 0.55)));
  const roofRows = rows - bodyRows;
  const base = h - 1;
  const top = base - bodyRows + 1; // the top row of the wall

  // The wall: an outline in the dark thread, the inside left as linen. A barn is filled.
  for (let x = 0; x < wallW; x++) {
    set(x, base, 'dark');
    set(x, top, 'dark');
  }
  for (let y = top; y <= base; y++) {
    set(0, y, 'dark');
    set(wallW - 1, y, 'dark');
  }
  if (kind === 'barn') for (let y = top + 1; y < base; y++) for (let x = 1; x < wallW - 1; x++) if ((x + y) % 2 === 0) set(x, y, 'primary');
  // A band of the trim thread under the eaves: a small zigzag.
  if (bodyRows >= 6 && kind !== 'barn') for (let x = 1; x < wallW - 1; x++) set(x, top + 1 + (x % 2), trimInk);

  // The roof, from the eaves up: stepped in, a stripe of the trim every few rows.
  const roof = kind === 'church' || kind === 'tall' || kind === 'folk' ? 'gable' : kind === 'barn' ? 'hip' : (['gable', 'gable', 'hip'] as const)[Math.floor(rng() * 3)];
  for (let r = 0; r < roofRows; r++) {
    const y = top - 1 - r;
    const t = (r + 1) / roofRows;
    const half = (wallW + 2) / 2;
    const reach = roof === 'gable' ? half * (1 - t) + 0.5 : half * (1 - t * 0.6);
    const x0 = Math.round(wallW / 2 - reach);
    const x1 = Math.round(wallW / 2 + reach) - 1;
    for (let x = x0; x <= x1; x++) set(x, y, x === x0 || x === x1 ? 'dark' : r % 3 === 1 ? trimInk : roofInk);
  }
  // A chimney, and smoke over a smithy or bakery.
  if (kind !== 'barn' && kind !== 'church' && (rng() < 0.6 || kind === 'smithy' || kind === 'bakery')) {
    const cx = Math.round(wallW * (rng() < 0.5 ? 0.28 : 0.72));
    const cy = top - Math.round(roofRows * 0.55);
    for (let y = cy - 2; y <= cy; y++) set(cx, y, 'dark');
    if (kind === 'smithy' || kind === 'bakery') [[1, -4], [0, -5], [1, -6], [2, -7]].forEach(([dx, dy]) => set(cx + dx, cy + dy, 'dark'));
  }

  // The door, at a person's height; a barn's is wide.
  const doorW = kind === 'barn' ? Math.max(3, Math.round(wallW * 0.35)) : 2;
  const doorH = Math.min(bodyRows - 2, kind === 'barn' ? bodyRows - 2 : Math.max(3, Math.round(bodyRows * 0.6)));
  const doorX = kind === 'long' ? Math.round(wallW * 0.22) : Math.round((wallW - doorW) / 2);
  for (let y = base - doorH; y < base; y++) for (let x = doorX; x < doorX + doorW; x++) set(x, y, 'dark');
  // Windows: two-by-two squares, in one row (two in a tall house).
  if (kind !== 'barn') {
    const winInk: Ink = trimInk === 'gold' ? 'secondary' : 'gold';
    const rowsY = kind === 'tall' ? [top + 3, base - 4] : [Math.round((top + base) / 2)];
    const xs: number[] = [];
    for (let x = 2; x + 1 < wallW - 1; x += 4) if (x + 1 < doorX - 0 || x > doorX + doorW) xs.push(x);
    for (const y of rowsY) for (const x of xs) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + dx, y + dy, winInk);
  }
  if (kind === 'inn') for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(doorX + doorW + 1 + dx, base - doorH + dy, 'primary');

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
  if (kind === 'mill') {
    // A water wheel at the end of the house: a ring with spokes.
    const cx = wallW + 2;
    const cy = base - 2;
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) set(cx + dx, cy + dy, dx === 0 && dy === 0 ? 'gold' : 'dark');
  }
  return { w, h, cells };
}
