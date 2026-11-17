/**
 * A patchwork village, seen from above like an old drawn map. An irregular quad grid (the
 * Townscaper way of cutting a hexagon into wonky, nearly square patches) is the plan: its
 * seams are the streets and its patches are plots: house plots, gardens, fields, orchards,
 * vineyards, meadows, the square, the stream.
 *
 * The large shapes come first: the square at the heart, main streets run along the seams
 * from the square to the edge (and round it, in some villages), a stream across. Then every
 * other plot is decided, the plot with the most decided neighbours first (the least
 * uncertain, as in wave function collapse), each choice weighted by its distance from the
 * square and by its neighbours: houses gather near the centre and along main streets,
 * fields keep to the outside and share a crop with their neighbours, gardens sit between.
 *
 * Each plot is drawn in from its edges by half the width of the street beside it, so the
 * streets are the bare linen between the plots. People walk the streets, the square and the
 * meadows; houses, gardens, fields, orchards, vineyards and the stream are not walked
 * through. Every choice is seeded.
 */
import type { Bridge, Patch, PatchKind, SceneFeature, SceneModel, SpecialBuilding, Terrain } from '../art/scene';
import type { Ink } from '../art/shapes';
import { faceCentre, faceNeighbours, irregularQuadGrid, type V } from '../art/irregularGrid';
import { createSeededRng, hashString, type Rng } from '../core/rng';
import type { PointOfInterest, SpawnPoint } from '../engine/types';

export interface PatchworkOptions {
  /** Size of the village: triangles from the centre to the edge of the hexagon. */
  rings: number;
  /** Map cells per triangle side (plots are about half this across). */
  side: number;
  /** How built-up the village is, 0 to 1. */
  houses: number;
  stream: boolean;
  seed: number;
}

const NAMES = ['Gorno Selo', 'Dolno Pole', 'Kruševo', 'Malko Brdo', 'Slivovo', 'Bukovets', 'Cherešnitsa', 'Lozen', 'Vishnevo', 'Kamenartsi'];

/** Half the width of a street, in cells: main streets and lanes. */
// Streets are at least as wide as a person (a character is about one cell across).
const MAIN_HALF = 0.75;
const LANE_HALF = 0.45;

/** The kinds a hand edit may give a plot. */
export const PLOT_KINDS: readonly PatchKind[] = ['house', 'yard', 'garden', 'field', 'orchard', 'vineyard', 'pasture', 'wood', 'meadow', 'square', 'water'];

/** Plot kinds people may walk across, besides the streets. */
const WALKABLE: ReadonlySet<PatchKind> = new Set(['square', 'meadow', 'road']);

function pickWeighted<T extends string>(weights: Array<[T, number]>, rng: Rng): T {
  const total = weights.reduce((s, [, w]) => s + Math.max(0, w), 0);
  let r = rng() * total;
  for (const [k, w] of weights) {
    r -= Math.max(0, w);
    if (r <= 0) return k;
  }
  return weights[weights.length - 1][0];
}

export function pointInPolygon(pt: V, poly: V[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Draws a polygon in from each edge by its own distance (positive is inward). */
function inset(poly: V[], distances: number[]): V[] {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
  const s = area >= 0 ? 1 : -1;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dx = (b[0] - a[0]) / len;
    const dy = (b[1] - a[1]) / len;
    const nx = -dy * s;
    const ny = dx * s;
    return { px: a[0] + nx * distances[i], py: a[1] + ny * distances[i], dx, dy };
  });
  return poly.map((_, i) => {
    const l1 = lines[(i + n - 1) % n];
    const l2 = lines[i];
    const det = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(det) < 1e-6) return [l2.px, l2.py];
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / det;
    return [l1.px + l1.dx * t, l1.py + l1.dy * t];
  });
}

function bfs<T extends number>(next: (v: T) => T[], from: T, to: T, blocked: (v: T) => boolean): T[] {
  const prev = new Map<T, T | -1>([[from, -1]]);
  const queue: T[] = [from];
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    if (v === to) break;
    for (const n of next(v)) {
      if (prev.has(n) || (n !== to && blocked(n))) continue;
      prev.set(n, v);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return [];
  const out: T[] = [];
  for (let v: T | -1 = to; v !== -1; v = prev.get(v as T)!) out.push(v as T);
  return out.reverse();
}

/** The thread a plot of this kind is worked in, chosen from a seed. */
export function plotInk(kind: PatchKind, seed: number): Ink {
  const r = createSeededRng(seed)();
  switch (kind) {
    case 'house':
      return r < 0.5 ? 'gold' : 'accent';
    case 'garden':
      return r < 0.6 ? 'accent' : 'gold';
    case 'field':
      return (['gold', 'gold', 'primary', 'accent2', 'accent'] as const)[Math.floor(r * 5)];
    case 'orchard':
      return 'accent';
    case 'vineyard':
      return r < 0.5 ? 'accent2' : 'accent';
    case 'meadow':
      return r < 0.6 ? 'accent' : 'gold';
    case 'water':
      return 'secondary';
    case 'yard':
      return 'gold';
    case 'pasture':
      return 'accent';
    case 'wood':
      return 'accent';
    default:
      return 'gold';
  }
}

/**
 * Walkability for a patchwork: the streets (the gaps between plots inside the village), the
 * square and meadows are open; houses, gardens, fields, orchards, vineyards and water are
 * not walked through. Outside the village is open meadow.
 */
export function rasterizePatches(patches: Patch[], width: number, height: number, inVillage: (x: number, y: number) => boolean): Terrain[][] {
  const terrain: Terrain[][] = Array.from({ length: width }, () => Array<Terrain>(height).fill('ground'));
  const boxes = patches.map((p) => {
    const xs = p.points.map((q) => q[0]);
    const ys = p.points.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const pt: V = [x + 0.5, y + 0.5];
      const i = patches.findIndex((p, k) => pt[0] >= boxes[k][0] && pt[0] <= boxes[k][2] && pt[1] >= boxes[k][1] && pt[1] <= boxes[k][3] && pointInPolygon(pt, p.points));
      if (i < 0) {
        if (inVillage(pt[0], pt[1])) terrain[x][y] = 'road';
        continue;
      }
      const kind = patches[i].kind;
      terrain[x][y] = kind === 'water' ? 'water' : kind === 'square' || kind === 'road' ? 'road' : WALKABLE.has(kind) ? 'ground' : 'wall';
    }
  }
  return terrain;
}

/**
 * Draws a plot in from its face by the street along each edge, and works out its front (the
 * longest edge, favouring main streets) and the direction it is stitched in.
 */
export function drawPlot(plot: Patch, face: V[], halves: number[]): Patch {
  const outline = inset(face, halves);
  let front = 0;
  let bestLen = -1;
  outline.forEach((a, k) => {
    const b = outline[(k + 1) % outline.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * (halves[k] >= MAIN_HALF ? 1.6 : halves[k] === 0 ? 0.3 : 1);
    if (len > bestLen) {
      bestLen = len;
      front = k;
    }
  });
  const [ax, ay] = outline[front];
  const [bx, by] = outline[(front + 1) % outline.length];
  return { ...plot, points: outline, face: face.map((q) => [q[0], q[1]]), halves: [...halves], front, grain: Math.atan2(by - ay, bx - ax) };
}

const samePoint = (a: V, b: V) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/**
 * Two neighbouring plots made one: their faces joined along the edge they share, with the
 * street between them taken away. The first plot's kind and thread are kept. Returns null
 * when they do not share a whole edge.
 */
export function mergePlots(a: Patch, b: Patch): Patch | null {
  if (!a.face || !b.face || !a.halves || !b.halves) return null;
  const fa = a.face;
  const fb = b.face;
  for (let i = 0; i < fa.length; i++) {
    const p = fa[i];
    const q = fa[(i + 1) % fa.length];
    for (let j = 0; j < fb.length; j++) {
      // Shared edge: p→q in a runs q→p in b.
      if (!samePoint(fb[j], q) || !samePoint(fb[(j + 1) % fb.length], p)) continue;
      const face: V[] = [];
      const halves: number[] = [];
      // Round a from q back to p, then round b from p back to q, skipping the shared edge.
      for (let k = 1; k < fa.length; k++) {
        face.push(fa[(i + k) % fa.length]);
        halves.push(a.halves[(i + k) % fa.length]);
      }
      for (let k = 1; k < fb.length; k++) {
        face.push(fb[(j + k) % fb.length]);
        halves.push(b.halves[(j + k) % fb.length]);
      }
      // Corners left in a straight line (where three plots met) are dropped.
      const n = face.length;
      const keep = face.map((v, k) => {
        const u = face[(k + n - 1) % n];
        const w = face[(k + 1) % n];
        const cross = (v[0] - u[0]) * (w[1] - v[1]) - (v[1] - u[1]) * (w[0] - v[0]);
        return Math.abs(cross) > 1e-6 || halves[(k + n - 1) % n] !== halves[k];
      });
      const outFace = face.filter((_, k) => keep[k]);
      const outHalves = halves.filter((_, k) => keep[k]);
      return drawPlot({ ...a, special: a.special ?? b.special }, outFace, outHalves);
    }
  }
  return null;
}

/**
 * A plot cut in two by a new lane through `at`, running across its front, so both halves
 * keep a share of the street. Returns null where the cut does not cross the plot cleanly.
 */
export function splitPlot(plot: Patch, at: V, ids: [number, number]): [Patch, Patch] | null {
  if (!plot.face || !plot.halves) return null;
  const face = plot.face;
  const n = face.length;
  // Cut across the front edge of the drawn plot.
  const a = plot.points[plot.front ?? 0];
  const b = plot.points[((plot.front ?? 0) + 1) % plot.points.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: V = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const side = (q: V) => (q[0] - at[0]) * u[0] + (q[1] - at[1]) * u[1];
  const cuts: Array<{ k: number; q: V }> = [];
  for (let k = 0; k < n; k++) {
    const p = face[k];
    const q = face[(k + 1) % n];
    const sp = side(p);
    const sq = side(q);
    if ((sp < 0) !== (sq < 0)) {
      const t = sp / (sp - sq);
      cuts.push({ k, q: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] });
    }
  }
  if (cuts.length !== 2) return null;
  const [c1, c2] = cuts;
  const half = (from: { k: number; q: V }, to: { k: number; q: V }): [V[], number[]] => {
    const pts: V[] = [from.q];
    const hs: number[] = [plot.halves![from.k]];
    for (let k = (from.k + 1) % n; ; k = (k + 1) % n) {
      pts.push(face[k]);
      hs.push(plot.halves![k]);
      if (k === to.k) break;
    }
    pts.push(to.q);
    hs.push(LANE_HALF); // the new lane
    return [pts, hs];
  };
  const [fa, ha] = half(c1, c2);
  const [fb, hb] = half(c2, c1);
  const tooSmall = (pts: V[]) => {
    let area = 0;
    for (let k = 0; k < pts.length; k++) area += pts[k][0] * pts[(k + 1) % pts.length][1] - pts[(k + 1) % pts.length][0] * pts[k][1];
    return Math.abs(area) / 2 < 6;
  };
  if (tooSmall(fa) || tooSmall(fb)) return null;
  const seeds = ids.map((id) => hashString(`plot:${plot.seed}:${id}`));
  return [
    drawPlot({ ...plot, id: ids[0], seed: seeds[0] }, fa, ha),
    drawPlot({ ...plot, id: ids[1], seed: seeds[1], special: undefined }, fb, hb),
  ];
}

export function generatePatchworkVillage(o: PatchworkOptions): { model: SceneModel; spawns: SpawnPoint[] } {
  const rng = createSeededRng(o.seed * 4099 + 17);
  const mesh = irregularQuadGrid(o.rings, o.side, o.seed, 18);
  // More hand than compass: nudge every inner vertex a little after relaxing.
  {
    const jr = createSeededRng(o.seed * 31 + 9);
    mesh.vertices.forEach((v, i) => {
      if (mesh.boundary.has(i)) return;
      v[0] += (jr() - 0.5) * o.side * 0.22;
      v[1] += (jr() - 0.5) * o.side * 0.22;
    });
  }
  const R = o.rings * o.side;
  const width = Math.ceil(R * 2) + 6;
  const height = Math.ceil(R * Math.sqrt(3)) + 8;
  const ox = width / 2;
  const oy = height / 2 + 1;
  const neighbours = faceNeighbours(mesh);
  const centres = mesh.faces.map((f) => faceCentre(mesh, f));
  const dist = centres.map(([x, y]) => Math.hypot(x, y) / R);
  const onEdge = mesh.faces.map((f) => f.some((v) => mesh.boundary.has(v)));
  const kinds = new Map<number, PatchKind>();
  const edgeKey = (p: number, q: number) => (p < q ? `${p}-${q}` : `${q}-${p}`);

  // The vertex graph, for streets along the seams.
  const adj = new Map<number, number[]>();
  for (const f of mesh.faces) {
    for (let k = 0; k < 4; k++) {
      const a = f[k];
      const b = f[(k + 1) % 4];
      if (!adj.get(a)?.includes(b)) adj.set(a, [...(adj.get(a) ?? []), b]);
      if (!adj.get(b)?.includes(a)) adj.set(b, [...(adj.get(b) ?? []), a]);
    }
  }
  const nearestVertex = (x: number, y: number, pool: (v: number) => boolean) => {
    let best = -1;
    let score = Infinity;
    mesh.vertices.forEach(([vx, vy], v) => {
      if (!pool(v)) return;
      const s = Math.hypot(vx - x, vy - y);
      if (s < score) {
        score = s;
        best = v;
      }
    });
    return best;
  };
  const nearestFace = (a: number, d: number, pool: (f: number) => boolean) => {
    let best = -1;
    let score = Infinity;
    centres.forEach(([x, y], f) => {
      if (!pool(f)) return;
      const s = Math.hypot(x - Math.cos(a) * d * R, y - Math.sin(a) * d * R);
      if (s < score) {
        score = s;
        best = f;
      }
    });
    return best;
  };

  // The square: the few plots nearest the middle.
  const byCentre = centres.map((_, f) => f).sort((a, b) => dist[a] - dist[b]);
  const squareFaces = byCentre.slice(0, 4);
  for (const f of squareFaces) kinds.set(f, 'square');
  const heart = squareFaces[0];

  // A stream across the village, edge to edge, kept clear of the square.
  let streamFlow: number | undefined;
  if (o.stream) {
    const a = rng() * Math.PI * 2;
    const from = nearestFace(a, 1, (f) => onEdge[f]);
    const to = nearestFace(a + Math.PI + (rng() - 0.5) * 1.2, 1, (f) => onEdge[f]);
    streamFlow = Math.atan2(centres[to][1] - centres[from][1], centres[to][0] - centres[from][0]);
    for (const f of bfs<number>((g) => neighbours[g], from, to, (f) => dist[f] < 0.22)) kinds.set(f, 'water');
  }

  // Main streets along the seams: from the square out to the edge, and round in some villages.
  const main = new Set<string>();
  const squareVerts = new Set(squareFaces.flatMap((f) => mesh.faces[f]));
  const spokeCount = 3 + Math.floor(rng() * 2);
  const base = rng() * Math.PI * 2;
  const markPath = (vs: number[]) => {
    for (let k = 1; k < vs.length; k++) main.add(edgeKey(vs[k - 1], vs[k]));
  };
  for (let k = 0; k < spokeCount; k++) {
    const a = base + (k / spokeCount) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const end = nearestVertex(Math.cos(a) * R, Math.sin(a) * R, (v) => mesh.boundary.has(v));
    const start = nearestVertex(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15, (v) => squareVerts.has(v));
    markPath(bfs<number>((v) => adj.get(v) ?? [], start, end, () => false));
  }
  if (rng() < 0.6) {
    const ringR = (0.5 + rng() * 0.08) * R;
    const ring = Array.from({ length: 9 }, (_, k) => nearestVertex(Math.cos(base + (k / 8) * Math.PI * 2) * ringR, Math.sin(base + (k / 8) * Math.PI * 2) * ringR, () => true));
    for (let k = 0; k < 8; k++) markPath(bfs<number>((v) => adj.get(v) ?? [], ring[k], ring[k + 1], (v) => squareVerts.has(v)));
  }
  // The square is ringed by a wide street.
  for (const f of squareFaces) for (let k = 0; k < 4; k++) main.add(edgeKey(mesh.faces[f][k], mesh.faces[f][(k + 1) % 4]));
  const onMain = (f: number) => mesh.faces[f].some((v, k) => main.has(edgeKey(v, mesh.faces[f][(k + 1) % 4])));

  // The collapse fill: the least uncertain plot (most decided neighbours) first.
  const weightsFor = (f: number): Array<[PatchKind, number]> => {
    const d = dist[f];
    const near = neighbours[f].map((n) => kinds.get(n)).filter(Boolean) as PatchKind[];
    const count = (k: PatchKind) => near.filter((x) => x === k).length;
    return [
      ['house', (d < 0.72 ? 2.6 * (1 - d / 0.72) + 0.25 : 0.05) * (0.4 + o.houses * 1.6) * (onMain(f) ? 2.4 : 1) * (1 + count('house') * 0.5) * (count('water') ? 0.5 : 1)],
      ['garden', (0.5 + Math.exp(-(((d - 0.5) / 0.2) ** 2))) * (1 + count('house') * 0.4)],
      ['field', Math.max(0, d - 0.42) * 5 * (1 + count('field') * 1.2) * (count('square') ? 0.05 : 1)],
      ['orchard', (d > 0.45 ? 0.8 : 0.15) * (1 + count('orchard') * 1.6)],
      ['vineyard', (d > 0.6 ? 0.5 : 0.05) * (1 + count('vineyard') * 1.5)],
      ['meadow', 0.3 + (count('water') ? 1 : 0) + (onEdge[f] ? 0.4 : 0)],
      ['yard', (d < 0.75 ? 0.5 : 0.15) * (1 + count('house') * 0.8)],
      ['pasture', (d > 0.55 ? 0.7 : 0.05) * (1 + count('pasture') * 1.2)],
      ['wood', (d > 0.7 ? 0.9 : 0) * (1 + count('wood') * 2) * (onEdge[f] ? 1.6 : 1)],
    ];
  };
  const left = new Set(mesh.faces.map((_, f) => f).filter((f) => !kinds.has(f)));
  const jitter = mesh.faces.map(() => rng());
  while (left.size) {
    let best = -1;
    let bestScore = -1;
    for (const f of left) {
      const score = neighbours[f].filter((n) => kinds.has(n)).length + jitter[f] * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    kinds.set(best, pickWeighted(weightsFor(best), rng));
    left.delete(best);
  }

  // A ragged edge: some outer plots are left as bare linen, so the village frays into the
  // cloth instead of ending in a hard hexagon; none is left stranded.
  const bare = new Set<number>();
  mesh.faces.forEach((_, f) => {
    const kind = kinds.get(f);
    if (kind === 'water' || kind === 'square') return;
    // The edge frays a lot; inside, the odd plot is left open too, more toward the outside.
    if ((onEdge[f] && rng() < 0.7) || (kind !== 'house' && rng() < dist[f] * 0.35)) bare.add(f);
  });
  for (const f of [...bare]) for (const n of neighbours[f]) if (!bare.has(n) && onEdge[n] === false && dist[n] > 0.7 && kinds.get(n) !== 'water' && rng() < 0.35) bare.add(n);
  for (let pass = 0; pass < 2; pass++) {
    for (const f of mesh.faces.keys()) if (!bare.has(f) && neighbours[f].every((n) => bare.has(n))) bare.add(f);
  }

  // Plots: each face drawn in by half the width of the street along each of its edges.
  const toMap = ([x, y]: V): V => [x + ox, y + oy];
  // Which faces meet along each edge, so the stream and the square run on without a street.
  const facesOfEdge = new Map<string, number[]>();
  mesh.faces.forEach((face, f) => face.forEach((v, k) => {
    const e = edgeKey(v, face[(k + 1) % 4]);
    facesOfEdge.set(e, [...(facesOfEdge.get(e) ?? []), f]);
  }));
  const joined = (f: number, e: string) => {
    const other = facesOfEdge.get(e)?.find((g) => g !== f);
    if (other === undefined || bare.has(other)) return false;
    const a = kinds.get(f);
    // A main street crossing the stream keeps its gap: that is the bridge.
    if (a === 'water' && main.has(e)) return false;
    return a === kinds.get(other) && (a === 'water' || a === 'square');
  };
  const patches: Patch[] = [];
  mesh.faces.forEach((face, f) => {
    if (bare.has(f)) return;
    const pts = face.map((v) => toMap(mesh.vertices[v]));
    const halves = face.map((v, k) => {
      const e = edgeKey(v, face[(k + 1) % 4]);
      return joined(f, e) ? 0 : main.has(e) ? MAIN_HALF : LANE_HALF;
    });
    const kind = kinds.get(f)!;
    const seed = hashString(`plot:${o.seed}:${f}`);
    patches.push(drawPlot({ id: f, kind, points: [], ink: plotInk(kind, seed), grain: 0, seed }, pts, halves));
  });

  // Bridges: where a main street runs along a seam between two stretches of the stream.
  const bridges: Bridge[] = [];
  for (const [e, faces] of facesOfEdge) {
    if (faces.length !== 2 || !main.has(e) || faces.some((g) => kinds.get(g) !== 'water' || bare.has(g))) continue;
    const [p, q] = e.split('-').map(Number);
    bridges.push({ a: toMap(mesh.vertices[p]), b: toMap(mesh.vertices[q]), half: MAIN_HALF });
  }

  // Named buildings: a church, an inn, a smithy and a bakery on the house plots nearest the
  // square, and a mill on a house plot by the stream.
  const housePlots = patches.filter((p) => p.kind === 'house').sort((a, b) => dist[a.id!] - dist[b.id!]);
  const SPECIALS: SpecialBuilding[] = ['church', 'inn', 'smithy', 'bakery'];
  housePlots.slice(0, SPECIALS.length).forEach((p, i) => (p.special = SPECIALS[i]));
  const mill = housePlots.find((p) => !p.special && neighbours[p.id!].some((n) => kinds.get(n) === 'water'));
  if (mill) mill.special = 'mill';

  // The village's own outline: inside it, the gaps between plots are streets.
  const village = mesh.faces.filter((_, f) => !bare.has(f)).map((face) => face.map((v) => toMap(mesh.vertices[v])));
  const inVillage = (x: number, y: number) => village.some((poly) => pointInPolygon([x, y], poly));
  const terrain = rasterizePatches(patches, width, height, inVillage);

  // A dancing ground and a well on the square.
  const features: SceneFeature[] = [];
  const [hx, hy] = toMap(centres[heart]);
  features.push({ id: 'square-ground', kind: 'star', x: Math.round(hx - 1), y: Math.round(hy - 1), w: 2, h: 2, seed: hashString(`star:${o.seed}`) });
  const wellFace = squareFaces[1] ?? heart;
  const [wx, wy] = toMap(centres[wellFace]);
  features.push({ id: 'square-well', kind: 'well', x: Math.round(wx - 1), y: Math.round(wy - 1), w: 2, h: 2, seed: hashString(`well:${o.seed}`) });

  // Named places in the heart of the village: the square and its well, the named buildings
  // (at their doors, on the street), and the bridges. People gather where these are.
  const name = NAMES[Math.floor(rng() * NAMES.length)];
  const landmarks: PointOfInterest[] = [];
  const add = (id: string, label: string, [x, y]: V, description: string) =>
    landmarks.push({ id: `poi-${id}`, tag: label.replace(/[^A-Za-z]+/g, ''), label, x: Math.round(x), y: Math.round(y), description });
  add('square', `${name} square`, [hx, hy + 1.5], 'The heart of the village, where the khoro is danced.');
  add('well', `${name} well`, [wx, wy + 1.5], 'Where water is drawn and news is traded.');
  const NAMED: Record<SpecialBuilding, [string, string]> = {
    church: ['The church', 'A whitewashed church with a bell tower over the square.'],
    inn: ['The inn', 'Benches outside, rakia within, and every rumour in the village.'],
    smithy: ['The smithy', 'The forge, hot and loud, where tools and horseshoes are made.'],
    bakery: ['The bakery', 'Bread before dawn; the oven warms the whole lane.'],
    mill: ['The mill', 'A water mill on the stream, its wheel turning slowly.'],
  };
  for (const p of patches) {
    if (!p.special) continue;
    // The door: the middle of the plot's street edge, stepped out into the street.
    const a = p.points[p.front ?? 0];
    const b = p.points[((p.front ?? 0) + 1) % p.points.length];
    const m = p.points.reduce<V>((acc, q) => [acc[0] + q[0] / p.points.length, acc[1] + q[1] / p.points.length], [0, 0]);
    const door: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out = Math.hypot(door[0] - m[0], door[1] - m[1]) || 1;
    add(p.special, NAMED[p.special][0], [door[0] + ((door[0] - m[0]) / out) * 0.8, door[1] + ((door[1] - m[1]) / out) * 0.8], NAMED[p.special][1]);
  }
  bridges.slice(0, 2).forEach((br, i) => add(`bridge-${i}`, i ? 'The lower bridge' : 'The bridge', [(br.a[0] + br.b[0]) / 2, (br.a[1] + br.b[1]) / 2], 'A plank bridge where the street crosses the stream.'));

  return {
    model: { width, height, terrain, features, landmarks, title: name, patches, villageOutline: village, bridges, streamFlow },
    spawns: landmarks.map((l) => ({ id: `spawn-${l.id}`, label: l.label, x: l.x, y: l.y })),
  };
}
