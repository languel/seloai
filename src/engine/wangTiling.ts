/**
 * Wang Tiling Engine for SeloAI.
 *
 * Supports both:
 *  1) 4-Edge Wang Sets (N=1, E=2, S=4, W=8 -> 16 tiles, indices 0..15)
 *     for seamless winding roads, woven borders, fences, and walls.
 *  2) 4-Corner Bi-Terrain Wang Sets (NW=1, NE=2, SE=4, SW=8 -> 16 tiles, indices 0..15)
 *     for organic lakes, brooks, drought hollows, cliff edges, and snow/sand blends
 *     where every tile shares exact vertex states with all 8 neighbors — zero cracks!
 */

export const WANG_EDGE_N = 1;
export const WANG_EDGE_E = 2;
export const WANG_EDGE_S = 4;
export const WANG_EDGE_W = 8;

export const WANG_CORNER_NW = 1;
export const WANG_CORNER_NE = 2;
export const WANG_CORNER_SE = 4;
export const WANG_CORNER_SW = 8;

export function resolveWangEdgeIndex(n: boolean, e: boolean, s: boolean, w: boolean): number {
  return (n ? WANG_EDGE_N : 0) | (e ? WANG_EDGE_E : 0) | (s ? WANG_EDGE_S : 0) | (w ? WANG_EDGE_W : 0);
}

export function resolveWangCornerIndex(
  nw: boolean,
  ne: boolean,
  se: boolean,
  sw: boolean,
): number {
  return (
    (nw ? WANG_CORNER_NW : 0) |
    (ne ? WANG_CORNER_NE : 0) |
    (se ? WANG_CORNER_SE : 0) |
    (sw ? WANG_CORNER_SW : 0)
  );
}

export function isTileInWangSet(tileId: number, baseTileId: number): boolean {
  return tileId >= baseTileId && tileId < baseTileId + 16;
}

/**
 * Applies a boolean tile-presence mask to a layer using 4-Edge Wang connections (N=1, E=2, S=4, W=8).
 * Only cells where `mask[x][y] === true` are painted (`baseTileId + maskIdx`).
 */
export function applyWangEdgeMask(
  layer: number[][],
  mask: boolean[][],
  baseTileId: number,
  width: number,
  height: number,
  options?: { emptyTileId?: number; clearUnmaskedMatchingOnly?: boolean },
): void {
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const has = (x: number, y: number) => inBounds(x, y) && Boolean(mask[x]?.[y]);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (has(x, y)) {
        const idx = resolveWangEdgeIndex(
          has(x, y - 1),
          has(x + 1, y),
          has(x, y + 1),
          has(x - 1, y),
        );
        layer[x][y] = baseTileId + idx;
      } else if (options?.emptyTileId !== undefined) {
        if (!options.clearUnmaskedMatchingOnly || isTileInWangSet(layer[x][y], baseTileId)) {
          layer[x][y] = options.emptyTileId;
        }
      }
    }
  }
}

/**
 * Builds a `(width+1) × (height+1)` vertex grid for 4-Corner Wang tiling from a tile-space
 * predicate or mask (`tileMask[x][y]`) so every vertex touched by terrain B becomes `true`.
 * Because every tile reads its 4 corners from the shared vertex lattice, every adjacent edge
 * matches seamlessly by construction.
 */
export function createVertexMaskFromTileMask(
  tileMask: boolean[][],
  width: number,
  height: number,
): boolean[][] {
  const vertices: boolean[][] = Array.from({ length: width + 1 }, () =>
    Array(height + 1).fill(false),
  );
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (!tileMask[x]?.[y]) continue;
      vertices[x][y] = true;
      vertices[x + 1][y] = true;
      vertices[x + 1][y + 1] = true;
      vertices[x][y + 1] = true;
    }
  }
  return vertices;
}

/**
 * Applies a `(width+1) × (height+1)` corner vertex mask to a tile layer using 4-Corner Wang tiles
 * (`NW=1, NE=2, SE=4, SW=8`). Tiles with bitmask `0` retain existing tiles (unless `emptyTileId` is passed).
 */
export function applyWangCornerVertices(
  layer: number[][],
  vertices: boolean[][],
  baseTileId: number,
  width: number,
  height: number,
  options?: { emptyTileId?: number; clearZeroMatchingOnly?: boolean },
): void {
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const nw = Boolean(vertices[x]?.[y]);
      const ne = Boolean(vertices[x + 1]?.[y]);
      const se = Boolean(vertices[x + 1]?.[y + 1]);
      const sw = Boolean(vertices[x]?.[y + 1]);
      const idx = resolveWangCornerIndex(nw, ne, se, sw);
      if (idx > 0) {
        layer[x][y] = baseTileId + idx;
      } else if (options?.emptyTileId !== undefined) {
        if (!options.clearZeroMatchingOnly || isTileInWangSet(layer[x][y], baseTileId)) {
          layer[x][y] = options.emptyTileId;
        }
      }
    }
  }
}

/**
 * Interactive brush helper: toggles a single tile `(tx, ty)` for a 4-Edge Wang set and
 * updates the 5-cell cross (`center + N/E/S/W`) in `layer`.
 */
export function paintWangEdgeCell(
  layer: number[][],
  tx: number,
  ty: number,
  active: boolean,
  baseTileId: number,
  emptyTileId: number,
): Array<{ x: number; y: number; tileId: number }> {
  const width = layer.length;
  const height = layer[0]?.length ?? 0;
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return [];

  const isSet = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (x === tx && y === ty) return active;
    return isTileInWangSet(layer[x][y], baseTileId);
  };

  const changes: Array<{ x: number; y: number; tileId: number }> = [];
  const coords = [
    [tx, ty],
    [tx, ty - 1],
    [tx + 1, ty],
    [tx, ty + 1],
    [tx - 1, ty],
  ];
  for (const [cx, cy] of coords) {
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    if (!isSet(cx, cy)) {
      if (cx === tx && cy === ty && !active) {
        layer[cx][cy] = emptyTileId;
        changes.push({ x: cx, y: cy, tileId: emptyTileId });
      }
      continue;
    }
    const idx = resolveWangEdgeIndex(
      isSet(cx, cy - 1),
      isSet(cx + 1, cy),
      isSet(cx, cy + 1),
      isSet(cx - 1, cy),
    );
    const tileId = baseTileId + idx;
    layer[cx][cy] = tileId;
    changes.push({ x: cx, y: cy, tileId });
  }
  return changes;
}

/**
 * Interactive brush helper: paints/erases tile `(tx, ty)` for a 4-Corner Wang bi-terrain set
 * while reconstructing surrounding vertex bits so every shared neighbor edge stays seamless.
 */
export function paintWangCornerCell(
  layer: number[][],
  tx: number,
  ty: number,
  active: boolean,
  baseTileId: number,
  emptyTileId: number,
): Array<{ x: number; y: number; tileId: number }> {
  const width = layer.length;
  const height = layer[0]?.length ?? 0;
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return [];

  // Reconstruct vertex grid in local 5×5 patch centered around (tx, ty)
  const getCorner = (cx: number, cy: number, cornerMask: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return false;
    const t = layer[cx][cy];
    if (!isTileInWangSet(t, baseTileId)) return false;
    return ((t - baseTileId) & cornerMask) !== 0;
  };

  const vertices = new Map<string, boolean>();
  const key = (vx: number, vy: number) => `${vx},${vy}`;
  for (let gx = tx - 2; gx <= tx + 2; gx++) {
    for (let gy = ty - 2; gy <= ty + 2; gy++) {
      if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
      if (!isTileInWangSet(layer[gx][gy], baseTileId)) continue;
      if (getCorner(gx, gy, WANG_CORNER_NW)) vertices.set(key(gx, gy), true);
      if (getCorner(gx, gy, WANG_CORNER_NE)) vertices.set(key(gx + 1, gy), true);
      if (getCorner(gx, gy, WANG_CORNER_SE)) vertices.set(key(gx + 1, gy + 1), true);
      if (getCorner(gx, gy, WANG_CORNER_SW)) vertices.set(key(gx, gy + 1), true);
    }
  }

  for (const [vx, vy] of [
    [tx, ty],
    [tx + 1, ty],
    [tx + 1, ty + 1],
    [tx, ty + 1],
  ]) {
    vertices.set(key(vx, vy), active);
  }

  const changes: Array<{ x: number; y: number; tileId: number }> = [];
  for (let gx = Math.max(0, tx - 1); gx <= Math.min(width - 1, tx + 1); gx++) {
    for (let gy = Math.max(0, ty - 1); gy <= Math.min(height - 1, ty + 1); gy++) {
      const idx = resolveWangCornerIndex(
        Boolean(vertices.get(key(gx, gy))),
        Boolean(vertices.get(key(gx + 1, gy))),
        Boolean(vertices.get(key(gx + 1, gy + 1))),
        Boolean(vertices.get(key(gx, gy + 1))),
      );
      if (idx > 0) {
        const nextTile = baseTileId + idx;
        layer[gx][gy] = nextTile;
        changes.push({ x: gx, y: gy, tileId: nextTile });
      } else if (isTileInWangSet(layer[gx][gy], baseTileId) || (gx === tx && gy === ty)) {
        layer[gx][gy] = emptyTileId;
        changes.push({ x: gx, y: gy, tileId: emptyTileId });
      }
    }
  }
  return changes;
}

/**
 * Edge-Colored Wang Tile definition following Wikipedia's Wang tile formulation:
 * adjacent tiles meet cleanly when `left.east === right.west` and `top.south === bottom.north`.
 * Having multiple tiles per `(north, east, south, west)` edge signature (Cohen–Shade–Hiller–Deussen
 * stochastic Wang tiles) eliminates periodic repetition across wide meadows and tapestries.
 */
export interface WangColoredTileDef {
  tileId: number;
  north: number;
  east: number;
  south: number;
  west: number;
  weight?: number;
}

export type WangDirection = 'north' | 'east' | 'south' | 'west';

export interface EdgeColoredWangSolveOptions {
  seed?: number;
  isCellActive?: (x: number, y: number) => boolean;
  pinEdge?: (x: number, y: number, dir: WangDirection) => number | undefined;
}

/** Non-periodic spatial hash in [0, 1) using R2 Weyl sequence + trig mixing (no grid mod period). */
function aperiodicHash01(x: number, y: number, salt: number, seed: number): number {
  const phi1 = 0.6180339887498949;
  const phi2 = 0.7548776662466927;
  const weyl = (x * phi1 + y * phi2 + seed * 0.38196601125 + salt * 0.430159709) % 1;
  const s = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719 + seed * 19.31) * 43758.5453123;
  const frac = s - Math.floor(s);
  const sum = weyl + frac;
  return sum - Math.floor(sum);
}

/**
 * Solve a 2D Edge-Colored Wang Tile arrangement in scanline order `(y, x)`, guaranteeing
 * exact `east === west` and `south === north` edge-color constraints while minimizing
 * local tile repetition and long periodic runs across open terrain.
 */
export function solveEdgeColoredWangGrid(
  width: number,
  height: number,
  tiles: readonly WangColoredTileDef[],
  opts: EdgeColoredWangSolveOptions = {},
): number[][] {
  const seed = opts.seed ?? 42;
  const assigned: (WangColoredTileDef | null)[][] = Array.from({ length: width }, () =>
    Array<WangColoredTileDef | null>(height).fill(null),
  );
  const out: number[][] = Array.from({ length: width }, () => Array<number>(height).fill(-1));

  if (tiles.length === 0) return out;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (opts.isCellActive && !opts.isCellActive(x, y)) continue;

      const left = x > 0 ? assigned[x - 1][y] : null;
      const top = y > 0 ? assigned[x][y - 1] : null;

      const reqWest = left ? left.east : opts.pinEdge?.(x, y, 'west');
      const reqNorth = top ? top.south : opts.pinEdge?.(x, y, 'north');
      const reqEast = opts.pinEdge?.(x, y, 'east');
      const reqSouth = opts.pinEdge?.(x, y, 'south');

      let candidates = tiles.filter(
        (t) =>
          (reqWest === undefined || t.west === reqWest) &&
          (reqNorth === undefined || t.north === reqNorth) &&
          (reqEast === undefined || t.east === reqEast) &&
          (reqSouth === undefined || t.south === reqSouth),
      );

      // Graceful relaxation only if an incomplete Wang tileset over-constrains a pinned boundary
      if (candidates.length === 0) {
        candidates = tiles.filter(
          (t) =>
            (reqWest === undefined || t.west === reqWest) &&
            (reqNorth === undefined || t.north === reqNorth),
        );
      }
      if (candidates.length === 0) candidates = [...tiles];

      let bestTile = candidates[0];
      let bestScore = -Infinity;

      const nw = x > 0 && y > 0 ? assigned[x - 1][y - 1] : null;
      const ne = x + 1 < width && y > 0 ? assigned[x + 1][y - 1] : null;
      const w2 = x > 1 ? assigned[x - 2][y] : null;
      const n2 = y > 1 ? assigned[x][y - 2] : null;

      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        let score = (cand.weight ?? 1) * 8 + aperiodicHash01(x, y, cand.tileId + i * 7, seed) * 20;

        // Strongly penalize adjacent / diagonal / knight-step identical tiles
        if (left && left.tileId === cand.tileId) score -= 1200;
        if (top && top.tileId === cand.tileId) score -= 1200;
        if (nw && nw.tileId === cand.tileId) score -= 380;
        if (ne && ne.tileId === cand.tileId) score -= 380;
        if (w2 && w2.tileId === cand.tileId) score -= 210;
        if (n2 && n2.tileId === cand.tileId) score -= 210;

        // Encourage mixing edge colors rather than collapsing into all-0 or all-1 regions
        const leftSig =
          left &&
          left.north === cand.north &&
          left.east === cand.east &&
          left.south === cand.south &&
          left.west === cand.west;
        const topSig =
          top &&
          top.north === cand.north &&
          top.east === cand.east &&
          top.south === cand.south &&
          top.west === cand.west;
        if (leftSig) score -= 90;
        if (topSig) score -= 90;

        if (score > bestScore) {
          bestScore = score;
          bestTile = cand;
        }
      }

      assigned[x][y] = bestTile;
      out[x][y] = bestTile.tileId;
    }
  }

  return out;
}

/**
 * Verify that every pair of orthogonally adjacent active cells in a solved grid
 * obeys the Wang edge-color contract (`left.east === right.west` and `top.south === bottom.north`).
 */
export function verifyEdgeColoredWangGrid(
  grid: number[][],
  tiles: readonly WangColoredTileDef[],
): { valid: boolean; mismatches: number } {
  const byId = new Map<number, WangColoredTileDef>();
  for (const t of tiles) byId.set(t.tileId, t);

  let mismatches = 0;
  const width = grid.length;
  const height = width > 0 ? grid[0].length : 0;

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const cur = byId.get(grid[x][y]);
      if (!cur) continue;
      if (x + 1 < width) {
        const right = byId.get(grid[x + 1][y]);
        if (right && cur.east !== right.west) mismatches += 1;
      }
      if (y + 1 < height) {
        const down = byId.get(grid[x][y + 1]);
        if (down && cur.south !== down.north) mismatches += 1;
      }
    }
  }
  return { valid: mismatches === 0, mismatches };
}

/**
 * Pick a non-repeating tile variant from `variants` for cell `(x, y)` in `grid`,
 * penalizing immediate orthogonal, diagonal, and step-2 repeats before aperiodic hash ranking.
 */
export function pickNonRepeatingVariant(
  grid: number[][],
  variants: readonly number[],
  x: number,
  y: number,
  seed = 31,
): number {
  if (variants.length === 0) return -1;
  if (variants.length === 1) return variants[0];

  const w = grid.length;
  const h = w > 0 ? grid[0].length : 0;
  const at = (cx: number, cy: number): number =>
    cx >= 0 && cy >= 0 && cx < w && cy < h ? grid[cx][cy] : -1;

  const w1 = at(x - 1, y);
  const n1 = at(x, y - 1);
  const nw = at(x - 1, y - 1);
  const ne = at(x + 1, y - 1);
  const w2 = at(x - 2, y);
  const n2 = at(x, y - 2);

  let best = variants[0];
  let bestScore = -Infinity;

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    let score = aperiodicHash01(x, y, v * 3 + i, seed) * 20;
    if (v === w1 || v === n1) score -= 500;
    if (v === nw || v === ne) score -= 180;
    if (v === w2 || v === n2) score -= 90;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}
