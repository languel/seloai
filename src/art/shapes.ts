/**
 * The look-independent description of a drawing. Generators produce these shapes; a look
 * (ink line art, simulated embroidery, later a 3D extrusion) decides how they appear.
 * Units are abstract: 1 is roughly one thread width. "Up" is negative y.
 */
export type Pt = [number, number];

/** A role, not a colour: each look's palette decides what a role looks like. */
export type Ink = 'primary' | 'secondary' | 'accent' | 'accent2' | 'gold' | 'dark' | 'skin';

export type Shape =
  /**
   * A filled region. `grain` is the direction (radians) threads or hatching run. `tone`
   * picks a variant of the role where a look offers several (skin tones, for example).
   */
  | {
      kind: 'area';
      points: Pt[];
      ink: Ink;
      grain: number;
      tone?: number;
      /**
       * 0 (default) is a solid fill; up to 1 is an open, sparse fill of spaced threads that
       * lets the ground show through, for backgrounds that should not overwhelm what is on them.
       */
      open?: number;
    }
  /** A stroke: a stem, an outline, a tendril. */
  | { kind: 'line'; points: Pt[]; ink: Ink; weight: number; closed?: boolean }
  /** A dot: a knot, a sequin, a berry. */
  | { kind: 'knot'; at: Pt; r: number; ink: Ink }
  /** Counted-thread work: cells on a square grid, each one stitch. */
  | { kind: 'counted'; origin: Pt; cell: number; cells: Array<[number, number, Ink]> };

export interface Transform {
  dx?: number;
  dy?: number;
  /** Rotation in radians, clockwise on screen. */
  rot?: number;
  scale?: number;
  mirrorX?: boolean;
}

function applyPt(p: Pt, t: Required<Transform>): Pt {
  const x = (t.mirrorX ? -p[0] : p[0]) * t.scale;
  const y = p[1] * t.scale;
  const cos = Math.cos(t.rot);
  const sin = Math.sin(t.rot);
  return [x * cos - y * sin + t.dx, x * sin + y * cos + t.dy];
}

/** Returns transformed copies: mirror first, then scale, rotate, translate. */
export function place(shapes: Shape[], transform: Transform): Shape[] {
  const t: Required<Transform> = { dx: 0, dy: 0, rot: 0, scale: 1, mirrorX: false, ...transform };
  const grain = (g: number) => (t.mirrorX ? Math.PI - g : g) + t.rot;
  return shapes.map((shape): Shape => {
    switch (shape.kind) {
      case 'area':
        return { ...shape, points: shape.points.map((p) => applyPt(p, t)), grain: grain(shape.grain) };
      case 'line':
        return { ...shape, points: shape.points.map((p) => applyPt(p, t)), weight: shape.weight * t.scale };
      case 'knot':
        return { ...shape, at: applyPt(shape.at, t), r: shape.r * t.scale };
      case 'counted':
        // Counted work stays axis-aligned: only move and scale it.
        return { ...shape, origin: [shape.origin[0] * t.scale + t.dx, shape.origin[1] * t.scale + t.dy], cell: shape.cell * t.scale };
    }
  });
}

/** The same shapes plus their mirror image across the vertical axis. */
export function mirrored(shapes: Shape[]): Shape[] {
  return [...shapes, ...place(shapes, { mirrorX: true })];
}

export function quadCurve(p0: Pt, control: Pt, p1: Pt, steps = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * p0[0] + b * control[0] + c * p1[0], a * p0[1] + b * control[1] + c * p1[1]]);
  }
  return out;
}

export function circle(center: Pt, r: number, steps = 18): Pt[] {
  return Array.from({ length: steps }, (_, i): Pt => {
    const a = (i / steps) * Math.PI * 2;
    return [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
  });
}

/** A rounded square (superellipse), the cartouche at the heart of a medallion. */
export function cartouche(r: number, squareness = 4, steps = 40): Pt[] {
  return Array.from({ length: steps }, (_, i): Pt => {
    const a = (i / steps) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = 2 / squareness;
    return [Math.sign(c) * Math.abs(c) ** k * r, Math.sign(s) * Math.abs(s) ** k * r];
  });
}

/** A pointed petal growing from the origin in direction `angle` (0 = up). */
export function petal(angle: number, length: number, width: number): Pt[] {
  const local: Pt[] = [
    [0, 0],
    [width * 0.5, -length * 0.42],
    [width * 0.28, -length * 0.8],
    [0, -length],
    [-width * 0.28, -length * 0.8],
    [-width * 0.5, -length * 0.42],
  ];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return local.map(([x, y]): Pt => [x * cos - y * sin, x * sin + y * cos]);
}

/** An inward spiral curl, used for tendrils and roots. */
export function curl(start: Pt, radius: number, turns: number, direction: 1 | -1, startAngle: number): Pt[] {
  const steps = Math.max(10, Math.round(turns * 22));
  const centre: Pt = [start[0] - Math.cos(startAngle) * radius, start[1] - Math.sin(startAngle) * radius];
  return Array.from({ length: steps + 1 }, (_, i): Pt => {
    const t = i / steps;
    const a = startAngle + direction * t * turns * Math.PI * 2;
    const r = radius * (1 - t * 0.82);
    return [centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r];
  });
}

export function bounds(shapes: Shape[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number, pad = 0) => {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  };
  for (const shape of shapes) {
    if (shape.kind === 'knot') take(shape.at[0], shape.at[1], shape.r);
    else if (shape.kind === 'counted') {
      for (const [cx, cy] of shape.cells) {
        take(shape.origin[0] + cx * shape.cell, shape.origin[1] + cy * shape.cell, shape.cell);
      }
    } else for (const [x, y] of shape.points) take(x, y);
  }
  return { minX, minY, maxX, maxY };
}
