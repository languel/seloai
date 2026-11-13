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

export interface WangCornerSet {
  id: string;
  label: string;
  baseTileId: number;
  /** Optional tile ID written when bitmask === 0 (e.g. grass or transparent -1) */
  emptyTileId?: number;
  /** Whether fully-filled tiles (bitmask === 15 or >0) block movement */
  blocksMovement?: boolean;
}

export interface WangEdgeSet {
  id: string;
  label: string;
  baseTileId: number;
  emptyTileId?: number;
  blocksMovement?: boolean;
}

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
 * Deterministic Wang knotwork / courtyard garden mask generator for procedural woven lanes or walls.
 */
export function buildWangShevitsaCourtyardMask(
  width: number,
  height: number,
  seed = 19,
): boolean[][] {
  const mask: boolean[][] = Array.from({ length: width }, () => Array(height).fill(false));
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const rx = (x + seed) % 6;
      const ry = (y + seed * 3) % 6;
      if ((rx === 0 || rx === 5) && (ry === 0 || ry === 5)) continue;
      if (rx === 0 || ry === 0) mask[x][y] = true;
    }
  }
  return mask;
}
