/**
 * Wang chunks of scene: a world assembled from small patches of meaning whose shared edges
 * always agree. Each chunk is CHUNK×CHUNK cells with a label on each edge (meadow, road,
 * water or forest). The engine's edge-coloured Wang solver picks a signature for every
 * chunk so neighbours match; then a small generator fills each chunk from its four labels
 * and a seed: roads run from each road edge to the middle, water does the same and becomes
 * a pond when only one edge carries it, a road crossing water becomes a bridge, groves lean
 * toward forest edges, and houses gather where roads meet.
 *
 * The result is an ordinary SceneModel, drawn by `sceneShapes` like any world.
 */
import { createSeededRng, hashString, type Rng } from '../core/rng';
import { solveEdgeColoredWangGrid, type WangColoredTileDef } from '../engine/wangTiling';
import type { SceneFeature, SceneModel, Terrain } from './scene';

export const CHUNK = 6;

export const EDGE_LABELS = ['meadow', 'road', 'water', 'forest'] as const;
export type EdgeLabel = (typeof EDGE_LABELS)[number];

export interface ChunkSignature {
  north: EdgeLabel;
  east: EdgeLabel;
  south: EdgeLabel;
  west: EdgeLabel;
}

const VARIANTS = 3;

/** Every signature, in several variants, so the solver can avoid visible repeats. */
function chunkSet(): WangColoredTileDef[] {
  const tiles: WangColoredTileDef[] = [];
  let id = 0;
  for (let n = 0; n < 4; n++) {
    for (let e = 0; e < 4; e++) {
      for (let s = 0; s < 4; s++) {
        for (let w = 0; w < 4; w++) {
          for (let v = 0; v < VARIANTS; v++) tiles.push({ tileId: id++, north: n, east: e, south: s, west: w });
        }
      }
    }
  }
  return tiles;
}

export interface WangWorldOptions {
  /** Size in chunks. */
  cols: number;
  rows: number;
  seed: number;
  /** A river entering at the top and leaving at the bottom, in these chunk columns. */
  riverIn?: number;
  riverOut?: number;
  /** How many hamlets the roads link. */
  hamlets?: number;
  title?: string;
}

export interface ChunkPlan {
  signatures: ChunkSignature[][];
  /** Which solved variant each chunk got, so equal signatures still differ. */
  variants: number[][];
  hamlet: boolean[][];
  forest: boolean[][];
}

const LABEL_INDEX: Record<EdgeLabel, number> = { meadow: 0, road: 1, water: 2, forest: 3 };

/**
 * Plans the large shapes first (a river that meanders from its entry to its exit, roads
 * linking a few hamlets, patches of forest), turns them into edge labels between chunks,
 * then lets the Wang solver pick a variant per chunk with exactly those edges pinned.
 */
export function planChunks(options: WangWorldOptions): ChunkPlan {
  const { cols, rows, seed } = options;
  const rng = createSeededRng(seed * 31 + 7);
  // Edge labels: h[x][y] between (x,y) and (x+1,y); v[x][y] between (x,y) and (x,y+1).
  const h: EdgeLabel[][] = Array.from({ length: cols }, () => Array<EdgeLabel>(rows).fill('meadow'));
  const v: EdgeLabel[][] = Array.from({ length: cols }, () => Array<EdgeLabel>(rows).fill('meadow'));
  const onRiver = new Set<number>();
  const id = (x: number, y: number) => x * 1000 + y;

  // The river: down when it can, sideways toward its exit when it must, meandering a little.
  const riverIn = options.riverIn;
  const riverOut = options.riverOut ?? riverIn;
  if (riverIn !== undefined && riverOut !== undefined) {
    let x = Math.max(0, Math.min(cols - 1, riverIn));
    let y = 0;
    onRiver.add(id(x, y));
    while (y < rows - 1 || x !== riverOut) {
      const towardExit = Math.sign(riverOut - x);
      const roomToTurn = rows - 1 - y > Math.abs(riverOut - x);
      const sideways = towardExit !== 0 && (!roomToTurn || rng() < 0.3) ? towardExit : roomToTurn && y < rows - 1 && rng() < 0.18 ? (rng() < 0.5 ? -1 : 1) : 0;
      if (sideways !== 0 && x + sideways >= 0 && x + sideways < cols && !onRiver.has(id(x + sideways, y))) {
        h[Math.min(x, x + sideways)][y] = 'water';
        x += sideways;
      } else if (y < rows - 1) {
        v[x][y] = 'water';
        y += 1;
      } else {
        h[Math.min(x, x + towardExit)][y] = 'water';
        x += towardExit;
      }
      onRiver.add(id(x, y));
    }
  }

  // Hamlets away from the river, linked by roads that bend once and cross water by a bridge.
  const hamlet: boolean[][] = Array.from({ length: cols }, () => Array<boolean>(rows).fill(false));
  const spots: Array<[number, number]> = [];
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) if (!onRiver.has(id(x, y))) spots.push([x, y]);
  const wanted = Math.min(spots.length, options.hamlets ?? Math.max(2, Math.round((cols * rows) / 7)));
  const chosen: Array<[number, number]> = [];
  for (let tries = 0; chosen.length < wanted && tries < 200; tries++) {
    const [x, y] = spots[Math.floor(rng() * spots.length)];
    if (chosen.some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) < 2)) continue;
    chosen.push([x, y]);
    hamlet[x][y] = true;
  }
  const road = (a: [number, number], b: [number, number]) => {
    let [x, y] = a;
    const xFirst = rng() < 0.5;
    const stepX = () => {
      const d = Math.sign(b[0] - x);
      if (h[Math.min(x, x + d)][y] !== 'water') h[Math.min(x, x + d)][y] = 'road';
      x += d;
    };
    const stepY = () => {
      const d = Math.sign(b[1] - y);
      if (v[x][Math.min(y, y + d)] !== 'water') v[x][Math.min(y, y + d)] = 'road';
      y += d;
    };
    if (xFirst) {
      while (x !== b[0]) stepX();
      while (y !== b[1]) stepY();
    } else {
      while (y !== b[1]) stepY();
      while (x !== b[0]) stepX();
    }
  };
  const ordered = [...chosen].sort((p, q) => p[0] + p[1] * 0.5 - (q[0] + q[1] * 0.5));
  for (let i = 1; i < ordered.length; i++) road(ordered[i - 1], ordered[i]);

  // Forest: soft blobs of chunks, never on a hamlet; an edge is forest only inside a blob.
  const forest: boolean[][] = Array.from({ length: cols }, () => Array<boolean>(rows).fill(false));
  const blobs = Array.from({ length: Math.max(1, Math.round((cols * rows) / 10)) }, () => [rng() * cols, rng() * rows, 1 + rng() * 1.4]);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      if (hamlet[x][y]) continue;
      forest[x][y] = blobs.some(([bx, by, r]) => Math.hypot(x + 0.5 - bx, y + 0.5 - by) < r);
    }
  }
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      if (x < cols - 1 && h[x][y] === 'meadow' && forest[x][y] && forest[x + 1][y]) h[x][y] = 'forest';
      if (y < rows - 1 && v[x][y] === 'meadow' && forest[x][y] && forest[x][y + 1]) v[x][y] = 'forest';
    }
  }

  const label = (x: number, y: number, dir: 'north' | 'east' | 'south' | 'west'): EdgeLabel => {
    if (dir === 'north') return y === 0 ? (onRiver.has(id(x, 0)) && x === riverIn ? 'water' : 'meadow') : v[x][y - 1];
    if (dir === 'south') return y === rows - 1 ? (onRiver.has(id(x, y)) && x === riverOut ? 'water' : 'meadow') : v[x][y];
    if (dir === 'west') return x === 0 ? 'meadow' : h[x - 1][y];
    return x === cols - 1 ? 'meadow' : h[x][y];
  };
  const tiles = chunkSet();
  const grid = solveEdgeColoredWangGrid(cols, rows, tiles, { seed, pinEdge: (x, y, dir) => LABEL_INDEX[label(x, y, dir)] });
  return {
    signatures: grid.map((column) =>
      column.map((tileId) => {
        const t = tiles[Math.max(0, tileId)];
        return { north: EDGE_LABELS[t.north], east: EDGE_LABELS[t.east], south: EDGE_LABELS[t.south], west: EDGE_LABELS[t.west] };
      }),
    ),
    variants: grid.map((column) => column.map((tileId) => Math.max(0, tileId) % VARIANTS)),
    hamlet,
    forest,
  };
}

/** The solved edge labels of every chunk, indexed [x][y]. */
export function solveChunkSignatures(options: WangWorldOptions): ChunkSignature[][] {
  return planChunks(options).signatures;
}

type Dir = keyof ChunkSignature;
const DIRS: readonly Dir[] = ['north', 'east', 'south', 'west'];

/** Cells from the middle of an edge to the chunk's centre, in chunk-local coordinates. */
function spoke(dir: Dir, lane: number): Array<[number, number]> {
  const c = Math.floor(CHUNK / 2) - 1 + lane;
  const cells: Array<[number, number]> = [];
  if (dir === 'north') for (let y = 0; y <= c; y++) cells.push([c, y]);
  if (dir === 'south') for (let y = c; y < CHUNK; y++) cells.push([c, y]);
  if (dir === 'west') for (let x = 0; x <= c; x++) cells.push([x, c]);
  if (dir === 'east') for (let x = c; x < CHUNK; x++) cells.push([x, c]);
  return cells;
}

function fillChunk(
  sig: ChunkSignature,
  flags: { hamlet: boolean; forest: boolean; worldW: number; worldH: number },
  ox: number,
  oy: number,
  rng: Rng,
  terrain: Terrain[][],
  features: SceneFeature[],
  occupied: Set<number>,
) {
  const at = (x: number, y: number) => terrain[ox + x]?.[oy + y];
  const set = (x: number, y: number, t: Terrain) => {
    const cur = at(x, y);
    if (cur === undefined) return;
    // A road meeting water becomes a bridge; nothing overwrites a bridge.
    if (cur === 'bridge') return;
    if ((cur === 'water' && t === 'road') || (cur === 'road' && t === 'water')) terrain[ox + x][oy + y] = 'bridge';
    else terrain[ox + x][oy + y] = t;
  };
  const k = (x: number, y: number) => (ox + x) * 100003 + (oy + y);
  const place = (kind: SceneFeature['kind'], x: number, y: number, w = 1, h = 1) => {
    for (let i = x; i < x + w; i++) {
      for (let j = y; j < y + h; j++) {
        if (i < 0 || j < 0 || i >= CHUNK || j >= CHUNK || at(i, j) !== 'ground' || occupied.has(k(i, j))) return false;
        // Keep clear of the cloth border and the title.
        if (ox + i < 1 || oy + j < 2 || ox + i >= flags.worldW - 1 || oy + j >= flags.worldH - 1) return false;
      }
    }
    for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) occupied.add(k(i, j));
    features.push({ kind, x: ox + x, y: oy + y, w, h, seed: hashString(`${kind}:${ox + x}:${oy + y}`) });
    return true;
  };

  const water = DIRS.filter((d) => sig[d] === 'water');
  const road = DIRS.filter((d) => sig[d] === 'road');
  const forest = DIRS.filter((d) => sig[d] === 'forest');

  // Water two cells wide, roads one; both meet at the centre.
  for (const d of water) for (const lane of [0, 1]) for (const [x, y] of spoke(d, lane)) set(x, y, 'water');
  if (water.length === 1) {
    for (let x = 1; x <= 4; x++) for (let y = 1; y <= 4; y++) if (Math.hypot(x - 2.5, y - 2.5) < 1.9) set(x, y, 'water');
  }
  for (const d of road) for (const [x, y] of spoke(d, 1)) set(x, y, 'road');
  if (road.length === 1 && water.length === 0 && !flags.hamlet) {
    // A lane ending at a homestead or a landmark.
    if (!place(rng() < 0.6 ? 'house' : rng() < 0.5 ? 'well' : 'hearth', 1, 1, 2, 2)) place('house', 3, 3, 2, 2);
  }
  if (road.length >= 2 || flags.hamlet) {
    // A hamlet: houses tucked into the corners the roads leave free.
    const corners: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [0, 4],
      [4, 4],
    ];
    let built = 0;
    for (const [x, y] of corners) {
      if (built >= (flags.hamlet ? 3 : 2)) break;
      if (rng() < (flags.hamlet ? 0.9 : 0.75) && place('house', x, y, 2, 2)) built++;
    }
    // Every hamlet gathers round something: a well, a hearth or a dancing ground.
    if (flags.hamlet) {
      const kind = (['well', 'hearth', 'star'] as const)[Math.floor(rng() * 3)];
      if (!place(kind, 1, 1, 2, 2)) place(kind, 3, 1, 2, 2);
    }
  }
  // Groves lean toward forest edges; meadow chunks get the odd tree or patch of flowers.
  for (const d of forest) {
    const region = {
      north: [0, CHUNK, 0, 3],
      south: [0, CHUNK, 3, CHUNK],
      west: [0, 3, 0, CHUNK],
      east: [3, CHUNK, 0, CHUNK],
    }[d];
    for (let x = region[0]; x < region[1]; x++) {
      for (let y = region[2]; y < region[3] - 1; y++) {
        if (rng() < 0.42) place(rng() < 0.55 ? 'tree' : 'pine', x, y, 1, 2);
      }
    }
  }
  if (flags.forest && forest.length === 0) {
    // The edge of a wood: a few trees scattered through the chunk.
    for (let i = 0; i < 4; i++) place(rng() < 0.5 ? 'tree' : 'pine', Math.floor(rng() * CHUNK), Math.floor(rng() * (CHUNK - 1)), 1, 2);
  }
  if (!flags.forest && forest.length === 0 && road.length === 0 && water.length === 0) {
    const r = rng();
    if (r < 0.25) place('tree', 1 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 3), 1, 2);
    else if (r < 0.45) place('wheat', 1 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 4));
    else if (r < 0.6) place('flowers', 1 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 4));
  }
}

/** A whole world from Wang chunks: the solved signatures turned into terrain and features. */
export function generateWangScene(options: WangWorldOptions): SceneModel {
  const { cols, rows, seed } = options;
  const plan = planChunks(options);
  const width = cols * CHUNK;
  const height = rows * CHUNK;
  const terrain: Terrain[][] = Array.from({ length: width }, () => Array<Terrain>(height).fill('ground'));
  const features: SceneFeature[] = [];
  const occupied = new Set<number>();
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      const rng = createSeededRng(seed * 7919 + cx * 131 + cy * 17 + plan.variants[cx][cy] * 1013);
      const flags = { hamlet: plan.hamlet[cx][cy], forest: plan.forest[cx][cy], worldW: width, worldH: height };
      fillChunk(plan.signatures[cx][cy], flags, cx * CHUNK, cy * CHUNK, rng, terrain, features, occupied);
    }
  }
  features.sort((a, b) => a.y + a.h - (b.y + b.h));
  return { width, height, terrain, features, landmarks: [], title: options.title };
}
