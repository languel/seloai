/**
 * An irregular quad grid, of the kind Oskar Stålberg used for Townscaper: a hexagon cut into
 * triangles, triangles paired at random into quads, every face split into small quads, and
 * the mesh relaxed until its quads are nearly square. The result is a field of hand-cut,
 * slightly wonky patches that still fit together like a quilt.
 *
 * Pure and seeded. Positions are in whatever unit `side` is given in.
 */
import { createSeededRng, type Rng } from '../core/rng';

export type V = [number, number];

export interface QuadMesh {
  vertices: V[];
  /** Each face is four vertex indices, in order round the face. */
  faces: number[][];
  /** Vertices on the outer edge, which stay put while relaxing. */
  boundary: Set<number>;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Builds the grid: a hexagon `rings` triangles from centre to edge, triangles `side` long,
 * centred on the origin. `relax` passes smooth it toward squares.
 */
export function irregularQuadGrid(rings: number, side: number, seed: number, relax = 24): QuadMesh {
  const rng = createSeededRng(seed * 7 + 1);
  // Lattice vertices of a hexagon of triangles, in axial coordinates.
  const index = new Map<string, number>();
  const verts: V[] = [];
  const key = (i: number, j: number) => `${i},${j}`;
  for (let j = -rings; j <= rings; j++) {
    for (let i = -rings; i <= rings; i++) {
      if (Math.abs(i + j) > rings) continue;
      index.set(key(i, j), verts.length);
      verts.push([(i + j / 2) * side, ((j * Math.sqrt(3)) / 2) * side]);
    }
  }
  const at = (i: number, j: number) => index.get(key(i, j));
  // Triangles: one pointing each way from each lattice point, where all corners exist.
  const tris: number[][] = [];
  for (let j = -rings; j <= rings; j++) {
    for (let i = -rings; i <= rings; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j - 1);
      if (a !== undefined && b !== undefined && c !== undefined) tris.push([a, b, c]);
      if (a !== undefined && b !== undefined && d !== undefined) tris.push([a, d, b]);
    }
  }
  // Pair neighbouring triangles into quads, at random; some triangles stay single.
  const edgeKey = (p: number, q: number) => (p < q ? `${p}-${q}` : `${q}-${p}`);
  const byEdge = new Map<string, number[]>();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const e = edgeKey(t[k], t[(k + 1) % 3]);
      const list = byEdge.get(e) ?? [];
      list.push(ti);
      byEdge.set(e, list);
    }
  });
  const used = new Set<number>();
  const coarse: number[][] = [];
  for (const ti of shuffle(tris.map((_, i) => i), rng)) {
    if (used.has(ti)) continue;
    const t = tris[ti];
    const options: Array<{ other: number; k: number }> = [];
    for (let k = 0; k < 3; k++) {
      const other = byEdge.get(edgeKey(t[k], t[(k + 1) % 3]))!.find((o) => o !== ti && !used.has(o));
      if (other !== undefined) options.push({ other, k });
    }
    used.add(ti);
    if (options.length === 0) {
      coarse.push(t);
      continue;
    }
    const { other, k } = options[Math.floor(rng() * options.length)];
    used.add(other);
    const a = t[k];
    const b = t[(k + 1) % 3];
    const c = t[(k + 2) % 3];
    const d = tris[other].find((v) => v !== a && v !== b)!;
    // The quad runs round a, d, b, c (the shared edge a-b becomes its diagonal).
    coarse.push([a, d, b, c]);
  }
  // Split every face into quads through its centre and the middles of its edges.
  const vertices: V[] = [...verts];
  const mids = new Map<string, number>();
  const mid = (p: number, q: number) => {
    const e = edgeKey(p, q);
    let m = mids.get(e);
    if (m === undefined) {
      m = vertices.length;
      vertices.push([(vertices[p][0] + vertices[q][0]) / 2, (vertices[p][1] + vertices[q][1]) / 2]);
      mids.set(e, m);
    }
    return m;
  };
  const faces: number[][] = [];
  for (const f of coarse) {
    const cx = f.reduce((s, v) => s + vertices[v][0], 0) / f.length;
    const cy = f.reduce((s, v) => s + vertices[v][1], 0) / f.length;
    const c = vertices.length;
    vertices.push([cx, cy]);
    for (let k = 0; k < f.length; k++) {
      const prev = f[(k + f.length - 1) % f.length];
      const cur = f[k];
      const next = f[(k + 1) % f.length];
      faces.push([cur, mid(cur, next), c, mid(prev, cur)]);
    }
  }
  // The boundary: vertices on edges used by only one face.
  const edgeUse = new Map<string, number>();
  for (const f of faces) for (let k = 0; k < 4; k++) edgeUse.set(edgeKey(f[k], f[(k + 1) % 4]), (edgeUse.get(edgeKey(f[k], f[(k + 1) % 4])) ?? 0) + 1);
  const boundary = new Set<number>();
  for (const [e, n] of edgeUse) {
    if (n !== 1) continue;
    const [p, q] = e.split('-').map(Number);
    boundary.add(p);
    boundary.add(q);
  }
  const mesh = { vertices, faces, boundary };
  relaxMesh(mesh, relax);
  return mesh;
}

/**
 * Nudges every inner vertex so each quad becomes more square: for each quad, the corners
 * are pulled toward the square that best fits them (rotated about the quad's centre).
 */
export function relaxMesh(mesh: QuadMesh, passes: number, strength = 0.35) {
  const { vertices, faces, boundary } = mesh;
  for (let pass = 0; pass < passes; pass++) {
    const force = vertices.map((): V => [0, 0]);
    const count = vertices.map(() => 0);
    for (const f of faces) {
      const cx = f.reduce((s, v) => s + vertices[v][0], 0) / 4;
      const cy = f.reduce((s, v) => s + vertices[v][1], 0) / 4;
      // The average corner vector, each corner turned back by its quarter.
      let ax = 0;
      let ay = 0;
      for (let k = 0; k < 4; k++) {
        const dx = vertices[f[k]][0] - cx;
        const dy = vertices[f[k]][1] - cy;
        // Rotate by -90° k times.
        const [rx, ry] = [[dx, dy], [dy, -dx], [-dx, -dy], [-dy, dx]][k];
        ax += rx / 4;
        ay += ry / 4;
      }
      for (let k = 0; k < 4; k++) {
        const [tx, ty] = [[ax, ay], [-ay, ax], [-ax, -ay], [ay, -ax]][k];
        const v = f[k];
        force[v][0] += cx + tx - vertices[v][0];
        force[v][1] += cy + ty - vertices[v][1];
        count[v]++;
      }
    }
    vertices.forEach((v, i) => {
      if (boundary.has(i) || count[i] === 0) return;
      v[0] += (force[i][0] / count[i]) * strength;
      v[1] += (force[i][1] / count[i]) * strength;
    });
  }
}

/** Faces that share an edge, for each face. */
export function faceNeighbours(mesh: QuadMesh): number[][] {
  const byEdge = new Map<string, number[]>();
  mesh.faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const p = f[k];
      const q = f[(k + 1) % f.length];
      const e = p < q ? `${p}-${q}` : `${q}-${p}`;
      const list = byEdge.get(e) ?? [];
      list.push(fi);
      byEdge.set(e, list);
    }
  });
  const out = mesh.faces.map(() => new Set<number>());
  for (const list of byEdge.values()) if (list.length === 2) {
    out[list[0]].add(list[1]);
    out[list[1]].add(list[0]);
  }
  return out.map((s) => [...s]);
}

export function faceCentre(mesh: QuadMesh, face: number[]): V {
  return [face.reduce((s, v) => s + mesh.vertices[v][0], 0) / face.length, face.reduce((s, v) => s + mesh.vertices[v][1], 0) / face.length];
}
