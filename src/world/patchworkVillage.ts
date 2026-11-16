/**
 * A patchwork village: an irregular quad grid (Townscaper's way of cutting a hexagon into
 * wonky, nearly square patches) filled like a Klee village, a quilt of houses, gardens,
 * fields, orchards and meadows around a square, crossed by roads and perhaps a stream.
 *
 * The large shapes are planned first: the square at the heart, roads running out from it and
 * round it, a stream across. Then the remaining patches are decided one at a time, the patch
 * with the most decided neighbours first (the least uncertain, as in wave function
 * collapse), each choice weighted by its distance from the square and by its neighbours:
 * houses gather along roads and beside each other, fields keep to the outside and share a
 * crop with the fields next to them, gardens sit in between. Every choice is seeded.
 */
import type { Patch, PatchKind, SceneFeature, SceneModel, Terrain } from '../art/scene';
import type { Ink } from '../art/shapes';
import { faceCentre, faceNeighbours, irregularQuadGrid, type V } from '../art/irregularGrid';
import { createSeededRng, hashString, type Rng } from '../core/rng';
import type { PointOfInterest, SpawnPoint } from '../engine/types';

export interface PatchworkOptions {
  /** Size of the village: triangles from the centre to the edge of the hexagon. */
  rings: number;
  /** Map cells per triangle side (patches are about half this across). */
  side: number;
  /** How built-up the village is, 0 to 1. */
  houses: number;
  stream: boolean;
  seed: number;
}

const NAMES = ['Gorno Selo', 'Dolno Pole', 'Kruševo', 'Malko Brdo', 'Slivovo', 'Bukovets', 'Cherešnitsa', 'Lozen', 'Vishnevo', 'Kamenartsi'];

interface Decision {
  kind: PatchKind;
}

function pickWeighted<T extends string>(weights: Array<[T, number]>, rng: Rng): T {
  const total = weights.reduce((s, [, w]) => s + Math.max(0, w), 0);
  let r = rng() * total;
  for (const [k, w] of weights) {
    r -= Math.max(0, w);
    if (r <= 0) return k;
  }
  return weights[weights.length - 1][0];
}

function inside(pt: V, poly: V[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Two faces that share one edge, as one outline (or null if they do not share exactly one). */
function mergeLoops(a: number[], b: number[]): number[] | null {
  const shared = a.filter((v) => b.includes(v));
  if (shared.length !== 2) return null;
  const [p, q] = shared;
  // Find the edge in a's order (from -> to), then walk a from `to` round to `from`,
  // and b from `from` round to `to`, leaving out the shared edge.
  const ia = a.indexOf(p);
  const from = a[(ia + 1) % a.length] === q ? p : q;
  const to = from === p ? q : p;
  const startA = a.indexOf(to);
  const walkA: number[] = [];
  for (let k = 0; k < a.length; k++) walkA.push(a[(startA + k) % a.length]);
  const startB = b.indexOf(from);
  const walkB: number[] = [];
  for (let k = 0; k < b.length; k++) walkB.push(b[(startB + k) % b.length]);
  if (walkA[walkA.length - 1] !== from || walkB[walkB.length - 1] !== to) return null;
  return [...walkA, ...walkB.slice(1, -1)];
}

/** Shortest path between faces over the face graph, avoiding faces `blocked` rejects. */
function path(neighbours: number[][], from: number, to: number, blocked: (f: number) => boolean): number[] {
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const f = queue[q];
    if (f === to) break;
    for (const n of neighbours[f]) {
      if (prev.has(n) || (n !== to && blocked(n))) continue;
      prev.set(n, f);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return [];
  const out: number[] = [];
  for (let f = to; f !== -1; f = prev.get(f)!) out.push(f);
  return out.reverse();
}

export function generatePatchworkVillage(o: PatchworkOptions): { model: SceneModel; spawns: SpawnPoint[] } {
  const rng = createSeededRng(o.seed * 4099 + 17);
  const mesh = irregularQuadGrid(o.rings, o.side, o.seed, 60);
  const R = o.rings * o.side;
  const width = Math.ceil(R * 2) + 6;
  const height = Math.ceil(R * Math.sqrt(3)) + 8;
  const ox = width / 2;
  const oy = height / 2 + 1;
  const neighbours = faceNeighbours(mesh);
  const centres = mesh.faces.map((f) => faceCentre(mesh, f));
  const dist = centres.map(([x, y]) => Math.hypot(x, y) / R);
  const onEdge = mesh.faces.map((f) => f.some((v) => mesh.boundary.has(v)));
  const decided = new Map<number, Decision>();

  const nearestTo = (a: number, d: number, pool: (f: number) => boolean) => {
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

  // The square: the few patches nearest the middle.
  const bySquare = centres.map((_, f) => f).sort((a, b) => dist[a] - dist[b]);
  const squareFaces = bySquare.slice(0, 4);
  for (const f of squareFaces) decided.set(f, { kind: 'square' });
  const heart = squareFaces[0];

  // A stream across the village, edge to edge, kept clear of the square.
  const water = new Set<number>();
  if (o.stream) {
    const a = rng() * Math.PI * 2;
    const from = nearestTo(a, 1, (f) => onEdge[f]);
    const to = nearestTo(a + Math.PI + (rng() - 0.5) * 1.2, 1, (f) => onEdge[f]);
    for (const f of path(neighbours, from, to, (f) => dist[f] < 0.22)) water.add(f);
  }

  // Roads: spokes from the square to the edge, and a ring between them.
  const roads = new Set<number>();
  const spokeCount = 3 + Math.floor(rng() * 2);
  const base = rng() * Math.PI * 2;
  // Roads keep off the stream, crossing it only where they must (those patches are bridges).
  const roadPath = (from: number, to: number) => {
    const isSquare = (f: number) => decided.get(f)?.kind === 'square' && f !== heart && f !== from;
    const dry = path(neighbours, from, to, (f) => isSquare(f) || water.has(f));
    return dry.length ? dry : path(neighbours, from, to, isSquare);
  };
  for (let k = 0; k < spokeCount; k++) {
    const a = base + (k / spokeCount) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const end = nearestTo(a, 1, (f) => onEdge[f]);
    for (const f of roadPath(heart, end)) if (!decided.has(f)) roads.add(f);
  }
  // A ring road in some villages, joining the spokes part-way out.
  if (rng() < 0.55) {
    const ringR = 0.5 + rng() * 0.08;
    const ringPoints = Array.from({ length: 7 }, (_, k) => nearestTo(base + (k / 6) * Math.PI * 2, ringR, (f) => !decided.has(f)));
    for (let k = 0; k < 6; k++) for (const f of roadPath(ringPoints[k], ringPoints[k + 1])) if (!decided.has(f)) roads.add(f);
  }
  for (const f of water) if (!roads.has(f)) decided.set(f, { kind: 'water' });
  for (const f of roads) decided.set(f, { kind: 'road' });

  // The collapse fill: the least uncertain patch (most decided neighbours) first.
  const weightsFor = (f: number): Array<[PatchKind, number]> => {
    const d = dist[f];
    const near = neighbours[f].map((n) => decided.get(n)?.kind).filter(Boolean) as PatchKind[];
    const count = (k: PatchKind) => near.filter((x) => x === k).length;
    const touchesWay = count('road') + count('square') > 0;
    const w: Array<[PatchKind, number]> = [
      ['house', (d < 0.7 ? 2.6 * (1 - d / 0.7) + 0.2 : 0.05) * (0.4 + o.houses * 1.6) * (touchesWay ? 3 : 0.5) * (1 + count('house') * 0.6) * (count('water') ? 0.4 : 1)],
      ['garden', (0.5 + Math.exp(-(((d - 0.5) / 0.2) ** 2))) * (1 + count('house') * 0.4)],
      ['field', Math.max(0, d - 0.4) * 5 * (1 + count('field') * 1.2) * (count('square') ? 0.05 : 1)],
      ['orchard', (d > 0.45 ? 0.7 : 0.15) * (1 + count('orchard') * 1.5)],
      ['vineyard', (d > 0.6 ? 0.5 : 0.05) * (1 + count('vineyard') * 1.5)],
      ['meadow', 0.35 + (count('water') ? 1.2 : 0) + (onEdge[f] ? 0.6 : 0)],
    ];
    return w;
  };
  const left = new Set(mesh.faces.map((_, f) => f).filter((f) => !decided.has(f)));
  const jitter = mesh.faces.map(() => rng());
  while (left.size) {
    let best = -1;
    let bestScore = -1;
    for (const f of left) {
      const score = neighbours[f].filter((n) => decided.has(n)).length + jitter[f] * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    decided.set(best, { kind: pickWeighted(weightsFor(best), rng) });
    left.delete(best);
  }
  // Houses must front a road or the square, or stand beside a house that does.
  const fronts = (f: number) => neighbours[f].some((n) => ['road', 'square'].includes(decided.get(n)!.kind));
  for (const [f, dcs] of decided) {
    if (dcs.kind !== 'house' || fronts(f)) continue;
    if (!neighbours[f].some((n) => decided.get(n)!.kind === 'house' && fronts(n))) dcs.kind = 'garden';
  }

  // Colours: fields and orchards share a crop with their neighbours (one thread per field
  // block); houses take warm threads that differ from the house next door.
  const ink = new Map<number, Ink>();
  // The stream keeps the blue thread to itself, so it never reads as a field.
  // Warm, autumnal crops in the main, a little green.
  const CROPS: Ink[] = ['gold', 'gold', 'primary', 'primary', 'accent2', 'accent'];
  const HOUSE_INKS: Ink[] = ['primary', 'accent2', 'gold', 'accent'];
  const block = new Map<number, number>();
  let blocks = 0;
  for (const f of mesh.faces.keys()) {
    const kind = decided.get(f)!.kind;
    if (!['field', 'orchard', 'vineyard'].includes(kind) || block.has(f)) continue;
    const stack = [f];
    block.set(f, blocks);
    while (stack.length) {
      const g = stack.pop()!;
      for (const n of neighbours[g]) {
        if (!block.has(n) && decided.get(n)!.kind === kind && rng() < 0.82) {
          block.set(n, blocks);
          stack.push(n);
        }
      }
    }
    blocks++;
  }
  const blockInk = Array.from({ length: blocks }, () => CROPS[Math.floor(rng() * CROPS.length)]);
  for (const f of mesh.faces.keys()) {
    const kind = decided.get(f)!.kind;
    if (kind === 'house') {
      const taken = new Set(neighbours[f].map((n) => ink.get(n)));
      const options = HOUSE_INKS.filter((i) => !taken.has(i));
      ink.set(f, (options.length ? options : HOUSE_INKS)[Math.floor(rng() * (options.length || HOUSE_INKS.length))]);
    } else if (kind === 'field' || kind === 'vineyard') ink.set(f, blockInk[block.get(f)!]);
    else if (kind === 'orchard') ink.set(f, 'accent');
    else if (kind === 'garden') ink.set(f, rng() < 0.6 ? 'accent' : 'accent2');
    else if (kind === 'meadow') ink.set(f, rng() < 0.6 ? 'gold' : 'accent');
    else if (kind === 'water') ink.set(f, 'secondary');
    else if (kind === 'square') ink.set(f, 'gold');
    else ink.set(f, 'gold');
  }

  // A ragged edge: some outer patches are left as bare linen, so the village frays into the
  // cloth instead of ending in a hard hexagon.
  const bare = new Set<number>();
  mesh.faces.forEach((_, f) => {
    const kind = decided.get(f)!.kind;
    if (onEdge[f] && kind !== 'road' && kind !== 'water' && rng() < 0.55) bare.add(f);
  });
  for (const f of [...bare]) {
    for (const n of neighbours[f]) {
      const kind = decided.get(n)!.kind;
      if (!bare.has(n) && kind !== 'road' && kind !== 'water' && kind !== 'house' && dist[n] > 0.75 && rng() < 0.3) bare.add(n);
    }
  }

  // No stranded patches: one with no drawn neighbour goes bare too.
  for (let pass = 0; pass < 2; pass++) {
    for (const f of mesh.faces.keys()) {
      if (bare.has(f) || decided.get(f)!.kind === 'road') continue;
      if (neighbours[f].every((n) => bare.has(n))) bare.add(f);
    }
  }

  const toMap = ([x, y]: V): [number, number] => [x + ox, y + oy];
  const allPatches: Patch[] = mesh.faces.map((face, f) => {
    const pts = face.map((v) => toMap(mesh.vertices[v]));
    // Fields are stitched along their longest side; other patches every which way.
    let grain = rng() * Math.PI;
    if (decided.get(f)!.kind === 'field' || decided.get(f)!.kind === 'vineyard') {
      let longest = 0;
      for (let k = 0; k < pts.length; k++) {
        const [ax, ay] = pts[k];
        const [bx, by] = pts[(k + 1) % pts.length];
        const len = Math.hypot(bx - ax, by - ay);
        if (len > longest) {
          longest = len;
          grain = Math.atan2(by - ay, bx - ax);
        }
      }
    }
    return { kind: decided.get(f)!.kind, points: pts, ink: ink.get(f)!, grain, seed: hashString(`patch:${o.seed}:${f}`) };
  });
  // Bare patches are not drawn; their ground is open meadow for walking.
  const patches = allPatches.map((p, f) => (bare.has(f) ? null : p));
  // Neighbouring houses sometimes join into one larger building of an odd shape.
  const drawn: Patch[] = [];
  const joined = new Set<number>();
  patches.forEach((p, f) => {
    if (!p || joined.has(f)) return;
    if (p.kind === 'house' && rng() < 0.55) {
      const mate = neighbours[f].find((n) => !joined.has(n) && patches[n]?.kind === 'house');
      if (mate !== undefined) {
        const merged = mergeLoops(mesh.faces[f], mesh.faces[mate]);
        if (merged) {
          joined.add(f);
          joined.add(mate);
          drawn.push({ ...p, points: merged.map((v) => toMap(mesh.vertices[v])) });
          return;
        }
      }
    }
    joined.add(f);
    drawn.push(p);
  });

  // Terrain, for walking: houses block, water blocks, roads and the square are roads.
  const terrain: Terrain[][] = Array.from({ length: width }, () => Array<Terrain>(height).fill('ground'));
  const boxes = allPatches.map((p) => {
    const xs = p.points.map((q) => q[0]);
    const ys = p.points.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const pt: V = [x + 0.5, y + 0.5];
      const i = patches.findIndex((p, k) => p !== null && pt[0] >= boxes[k][0] && pt[0] <= boxes[k][2] && pt[1] >= boxes[k][1] && pt[1] <= boxes[k][3] && inside(pt, p.points));
      if (i < 0) continue;
      const kind = patches[i]!.kind;
      terrain[x][y] = kind === 'house' ? 'wall' : kind === 'water' ? 'water' : kind === 'road' && water.has(i) ? 'bridge' : kind === 'road' || kind === 'square' ? 'road' : 'ground';
    }
  }

  // Features: a dancing ground and a well on the square, trees in the orchards.
  const features: SceneFeature[] = [];
  const [hx, hy] = toMap(centres[heart]);
  features.push({ id: 'square-ground', kind: 'star', x: Math.round(hx - 1), y: Math.round(hy - 1), w: 2, h: 2, seed: hashString(`star:${o.seed}`) });
  const wellFace = squareFaces[1] ?? heart;
  const [wx, wy] = toMap(centres[wellFace]);
  features.push({ id: 'square-well', kind: 'well', x: Math.round(wx - 1), y: Math.round(wy - 1), w: 2, h: 2, seed: hashString(`well:${o.seed}`) });
  patches.forEach((p, f) => {
    if (!p || p.kind !== 'orchard') return;
    const [cx, cy] = toMap(centres[f]);
    features.push({ id: `orchard-tree-${f}`, kind: 'tree', x: Math.round(cx - 0.5), y: Math.round(cy - 1.5), w: 1, h: 2, seed: p.seed });
  });

  // Named places: the square, the well, a bridge, the orchard, the fields.
  const name = NAMES[Math.floor(rng() * NAMES.length)];
  const landmarks: PointOfInterest[] = [];
  const add = (id: string, label: string, x: number, y: number, description: string) =>
    landmarks.push({ id: `poi-${id}`, tag: label.replace(/[^A-Za-z]+/g, ''), label, x: Math.round(x), y: Math.round(y), description });
  add('square', `${name} square`, hx, hy + 1.5, 'The heart of the village, where the khoro is danced.');
  add('well', `${name} well`, wx, wy + 1.5, 'Where water is drawn and news is traded.');
  const bridge = [...roads].find((f) => water.has(f));
  if (bridge !== undefined) {
    const [bx, by] = toMap(centres[bridge]);
    add('bridge', 'The stream crossing', bx, by, 'Where the road crosses the stream.');
  }
  const orchard = patches.findIndex((p) => p?.kind === 'orchard');
  if (orchard >= 0) {
    const [cx, cy] = toMap(centres[orchard]);
    add('orchard', 'The orchard', cx, cy, 'Old fruit trees, and the shade beneath them.');
  }
  const field = patches.findIndex((p, f) => p?.kind === 'field' && dist[f] > 0.7);
  if (field >= 0) {
    const [cx, cy] = toMap(centres[field]);
    add('fields', 'The far fields', cx, cy, 'Strips of crop at the edge of the village.');
  }

  return {
    model: { width, height, terrain, features, landmarks, title: name, patches: drawn },
    spawns: landmarks.map((l) => ({ id: `spawn-${l.id}`, label: l.label, x: l.x, y: l.y })),
  };
}
