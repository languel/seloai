/**
 * Drawing a patchwork village from above, like an old map in thread.
 *
 * The plan underneath is only a faint backdrop: plots are a light wash of thread with no
 * outline, and the streets between them carry a scatter of gravel and cobble knots. What
 * stands on the plots carries the picture: houses of several kinds and sizes standing on
 * their street edges (the fold-out elevations of old maps, at the street's angle, sometimes
 * overlapping or turned onto a side street), named buildings near the square, the stream as
 * one body with its waves running downstream and plank bridges where streets cross it,
 * garden beds, orchards, woods, fields, and animals in the yards, pastures and woods.
 */
import { createSeededRng, type Rng } from '../core/rng';
import type { Bridge, Patch, SceneLayer, SceneModel, SpecialBuilding } from './scene';
import { circle, place as placeShapes, type Ink, type Pt, type Shape } from './shapes';
import { motifShape } from './patternGrammar';
import { STITCHES_PER_CELL, stitchedHouseGrid } from './stitchedHouse';

function pointIn([x, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** A local frame on a plot: along its front edge (u) and into the plot (n). */
interface Frame {
  a: Pt;
  u: Pt;
  n: Pt;
  len: number;
  depth: number;
  at(along: number, into: number): Pt;
}

function frameOf(pts: Pt[], edge: number): Frame {
  const a = pts[edge];
  const b = pts[(edge + 1) % pts.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const mid = pts.reduce<Pt>((acc, q) => [acc[0] + q[0] / pts.length, acc[1] + q[1] / pts.length], [0, 0]);
  let n: Pt = [-u[1], u[0]];
  if ((mid[0] - a[0]) * n[0] + (mid[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
  const depth = Math.max(...pts.map((q) => (q[0] - a[0]) * n[0] + (q[1] - a[1]) * n[1]));
  return { a, u, n, len, depth, at: (along, into) => [a[0] + u[0] * along + n[0] * into, a[1] + u[1] * along + n[1] * into] };
}

type HouseKind = 'cottage' | 'long' | 'tall' | 'barn';
type Roof = 'gable' | 'hip' | 'shed';

/**
 * One building as a fold-out elevation: base on the street at `c`, rising along `cn`, its
 * width along `cu`. Units are map units (U per cell).
 */
function building(
  shapes: Shape[],
  c: Pt,
  cu: Pt,
  cn: Pt,
  w: number,
  h: number,
  rng: Rng,
  U: number,
  kind: HouseKind | SpecialBuilding,
  avoid: Ink,
) {
  const hp = (x: number, y: number): Pt => [c[0] + cu[0] * x + cn[0] * y, c[1] + cu[1] * x + cn[1] * y];
  const along = Math.atan2(cu[1], cu[0]);
  const up = Math.atan2(cn[1], cn[0]);
  const rect = (x0: number, y0: number, x1: number, y1: number, ink: Ink, grain = up) =>
    shapes.push({ kind: 'area', points: [hp(x0, y0), hp(x1, y0), hp(x1, y1), hp(x0, y1)], ink, grain });
  const bodies: Ink[] = ['primary', 'accent2', 'secondary', 'gold', 'accent'].filter((i) => i !== avoid) as Ink[];
  const bodyInk = kind === 'church' ? 'gold' : kind === 'barn' ? (rng() < 0.5 ? 'primary' : 'dark') : bodies[Math.floor(rng() * bodies.length)];
  const roofInk: Ink = kind === 'church' ? 'secondary' : (['dark', 'primary', 'accent', 'secondary'] as const).filter((i) => i !== bodyInk)[Math.floor(rng() * 3)];
  const hw = w / 2;
  const body = kind === 'tall' ? h * 0.7 : kind === 'long' || kind === 'barn' ? h * 0.5 : h * (0.55 + rng() * 0.1);
  const roof: Roof = kind === 'church' || kind === 'tall' ? 'gable' : kind === 'barn' ? 'hip' : (['gable', 'gable', 'hip', 'shed'] as const)[Math.floor(rng() * 4)];

  if (kind === 'church') {
    // A nave with a tall bell tower at one end, and a cross on the tower.
    rect(-hw, 0, hw * 0.35, body * 0.85, bodyInk);
    shapes.push({ kind: 'area', points: [hp(-hw - U * 0.05, body * 0.85), hp(hw * 0.35 + U * 0.05, body * 0.85), hp(-hw * 0.3, h * 0.8)], ink: roofInk, grain: along });
    const tx0 = hw * 0.35;
    const tx1 = hw;
    rect(tx0, 0, tx1, h * 0.95, bodyInk);
    shapes.push({ kind: 'area', points: [hp(tx0 - U * 0.05, h * 0.95), hp(tx1 + U * 0.05, h * 0.95), hp((tx0 + tx1) / 2, h * 1.25)], ink: roofInk, grain: along });
    const cx = (tx0 + tx1) / 2;
    shapes.push({ kind: 'line', points: [hp(cx, h * 1.25), hp(cx, h * 1.4)], ink: 'dark', weight: 0.4 });
    shapes.push({ kind: 'line', points: [hp(cx - U * 0.08, h * 1.35), hp(cx + U * 0.08, h * 1.35)], ink: 'dark', weight: 0.4 });
    shapes.push({ kind: 'area', points: circle(hp(cx, h * 0.7), U * 0.12, 10), ink: 'dark', grain: 0 });
    rect(-hw * 0.4, 0, -hw * 0.1, body * 0.55, 'dark');
    return;
  }

  rect(-hw, 0, hw, body, bodyInk);
  if (roof === 'gable') {
    shapes.push({ kind: 'area', points: [hp(-hw - U * 0.06, body), hp(hw + U * 0.06, body), hp((rng() - 0.5) * w * 0.25, h)], ink: roofInk, grain: along });
  } else if (roof === 'hip') {
    shapes.push({ kind: 'area', points: [hp(-hw - U * 0.06, body), hp(hw + U * 0.06, body), hp(hw * 0.45, h), hp(-hw * 0.45, h)], ink: roofInk, grain: along });
  } else {
    shapes.push({ kind: 'area', points: [hp(-hw - U * 0.06, body), hp(hw + U * 0.06, body), hp(hw + U * 0.06, body + (h - body) * 0.45), hp(-hw - U * 0.06, h * 0.95)], ink: roofInk, grain: along });
  }
  // A chimney on some roofs, with a curl of smoke over the smithy and the bakery.
  if (kind !== 'barn' && (rng() < 0.55 || kind === 'smithy' || kind === 'bakery')) {
    const x = (rng() < 0.5 ? -1 : 1) * hw * 0.45;
    rect(x - U * 0.07, body + (h - body) * 0.35, x + U * 0.07, body + (h - body) * 0.75, 'dark');
    if (kind === 'smithy' || kind === 'bakery') {
      shapes.push({ kind: 'line', points: [hp(x, h * 0.85), hp(x + U * 0.15, h * 0.98), hp(x - U * 0.05, h * 1.1), hp(x + U * 0.2, h * 1.22)], ink: 'dark', weight: 0.3 });
    }
  }
  // Doors at a person's height; a barn has a wide one.
  const door = kind === 'barn' ? Math.min(hw * 0.7, U * 0.55) : Math.min(w * 0.17, U * 0.24);
  const doorH = Math.min(body * 0.75, U * (kind === 'barn' ? 1.2 : 0.95));
  const doorX = kind === 'long' ? -hw * 0.45 : 0;
  rect(doorX - door, 0, doorX + door, doorH, 'dark');
  // Windows: one or two rows.
  const winInk: Ink = bodyInk === 'gold' ? 'dark' : 'gold';
  const s = U * 0.15;
  const rows = kind === 'tall' ? [body * 0.32, body * 0.68] : [body * 0.5];
  const cols = kind === 'barn' ? [] : kind === 'long' ? [0, hw * 0.55] : w > U * 1.7 ? [-w * 0.32, w * 0.32] : [rng() < 0.5 ? -w * 0.3 : w * 0.3];
  for (const y of rows) for (const x of cols) rect(x - s, y, x + s, y + s * 2, winInk, 0);
  if (kind === 'inn') {
    // A hanging sign by the door.
    shapes.push({ kind: 'line', points: [hp(hw * 0.4, body * 0.75), hp(hw * 0.75, body * 0.75)], ink: 'dark', weight: 0.3 });
    rect(hw * 0.55, body * 0.45, hw * 0.75, body * 0.72, 'primary', 0);
  }
  if (kind === 'mill') {
    // A water wheel at one end.
    const wc = hp(hw + U * 0.35, body * 0.45);
    shapes.push({ kind: 'line', points: circle(wc, U * 0.5, 14), ink: 'dark', weight: 0.45, closed: true });
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 4;
      shapes.push({ kind: 'line', points: [[wc[0] - Math.cos(ang) * U * 0.5, wc[1] - Math.sin(ang) * U * 0.5], [wc[0] + Math.cos(ang) * U * 0.5, wc[1] + Math.sin(ang) * U * 0.5]], ink: 'dark', weight: 0.3 });
    }
  }
}

/**
 * One building standing on its own, for a placed house of a given kind: its base on the
 * origin, rising up the page, `w` wide and `h` tall, in the patchwork's building style.
 */
export function standingBuilding(kind: HouseKind | SpecialBuilding, w: number, h: number, seed: number, U: number): Shape[] {
  const shapes: Shape[] = [];
  building(shapes, [0, 0], [1, 0], [0, -1], w, h, createSeededRng(seed), U, kind, 'gold');
  return shapes;
}

export type AnimalKind = 'sheep' | 'cow' | 'goat' | 'pig' | 'goose' | 'hen' | 'stork' | 'deer' | 'fox';

/** A small animal in profile, about a cell long, facing along `dir` (left or right). */
export function animal(kind: AnimalKind, at: Pt, U: number, facing: 1 | -1, rng: Rng): Shape[] {
  const s = U * (kind === 'cow' ? 1.05 : kind === 'hen' || kind === 'goose' ? 0.45 : kind === 'stork' ? 0.7 : 0.75);
  const f = facing;
  const P = (x: number, y: number): Pt => [at[0] + x * s * f, at[1] + y * s];
  const shapes: Shape[] = [];
  const legs = (xs: number[], y0: number, y1: number) => xs.forEach((x) => shapes.push({ kind: 'line', points: [P(x, y0), P(x, y1)], ink: 'dark', weight: 0.35 }));
  switch (kind) {
    case 'sheep': {
      legs([-0.25, 0.2], 0.05, 0.3);
      shapes.push({ kind: 'area', points: circle(P(0, -0.08), s * 0.42, 12).map(([x, y]) => [x, at[1] + (y - at[1] + 0.08 * s) * 0.7 - 0.08 * s]), ink: 'gold', grain: 0 });
      for (let k = 0; k < 4; k++) shapes.push({ kind: 'knot', at: P(-0.25 + k * 0.17, -0.12 + (k % 2) * 0.08), r: s * 0.09, ink: 'gold' });
      shapes.push({ kind: 'area', points: circle(P(0.45, -0.15), s * 0.13, 8), ink: 'dark', grain: 0 });
      break;
    }
    case 'cow':
    case 'goat':
    case 'deer':
    case 'pig':
    case 'fox': {
      const ink: Ink = kind === 'cow' ? (rng() < 0.5 ? 'primary' : 'dark') : kind === 'goat' ? 'gold' : kind === 'deer' ? 'primary' : kind === 'pig' ? 'accent2' : 'primary';
      const tall = kind === 'deer' ? 0.5 : kind === 'pig' ? 0.12 : 0.3;
      legs([-0.3, -0.15, 0.18, 0.3], -0.02, tall);
      shapes.push({ kind: 'area', points: [P(-0.42, -0.3), P(0.35, -0.3), P(0.38, 0.0), P(-0.42, 0.0)], ink, grain: 0 });
      // Head and neck.
      shapes.push({ kind: 'area', points: [P(0.3, -0.25), P(0.55, -0.45), P(0.62, -0.32), P(0.4, -0.12)], ink, grain: 0 });
      if (kind === 'cow') for (let k = 0; k < 2; k++) shapes.push({ kind: 'area', points: circle(P(-0.2 + k * 0.25, -0.15), s * 0.08, 6), ink: 'gold', grain: 0 });
      if (kind === 'goat' || kind === 'deer') shapes.push({ kind: 'line', points: [P(0.52, -0.45), P(0.45, -0.7), ...(kind === 'deer' ? [P(0.38, -0.8), P(0.45, -0.7), P(0.58, -0.82)] : [])], ink: 'dark', weight: 0.3 });
      if (kind === 'fox') shapes.push({ kind: 'line', points: [P(-0.42, -0.15), P(-0.7, -0.05), P(-0.85, -0.2)], ink: 'primary', weight: 0.8 });
      if (kind === 'pig') shapes.push({ kind: 'line', points: [P(-0.42, -0.2), P(-0.55, -0.28), P(-0.5, -0.15)], ink: 'accent2', weight: 0.35 });
      break;
    }
    case 'goose':
    case 'hen': {
      const ink: Ink = kind === 'goose' ? 'gold' : rng() < 0.5 ? 'primary' : 'gold';
      legs([0], 0.1, 0.4);
      shapes.push({ kind: 'area', points: circle(P(0, -0.1), s * 0.38, 10), ink, grain: 0 });
      shapes.push({ kind: 'line', points: [P(0.25, -0.3), P(0.4, kind === 'goose' ? -0.85 : -0.55)], ink, weight: 0.6 });
      shapes.push({ kind: 'knot', at: P(0.5, kind === 'goose' ? -0.85 : -0.55), r: s * 0.08, ink: 'primary' });
      break;
    }
    case 'stork': {
      legs([-0.02, 0.08], 0.05, 0.85);
      shapes.push({ kind: 'area', points: [P(-0.4, -0.15), P(0.2, -0.25), P(0.25, 0.05), P(-0.35, 0.1)], ink: 'gold', grain: 0 });
      shapes.push({ kind: 'line', points: [P(-0.4, -0.05), P(-0.1, 0.05)], ink: 'dark', weight: 0.5 });
      shapes.push({ kind: 'line', points: [P(0.2, -0.2), P(0.3, -0.6), P(0.55, -0.6)], ink: 'gold', weight: 0.5 });
      shapes.push({ kind: 'line', points: [P(0.55, -0.6), P(0.85, -0.55)], ink: 'primary', weight: 0.4 });
      break;
    }
  }
  return shapes;
}

/** Points on a jittered grid inside a polygon. */
function scatter(pts: Pt[], spacing: number, rng: Rng): Pt[] {
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const out: Pt[] = [];
  for (let x = Math.min(...xs) + spacing * 0.5; x < Math.max(...xs); x += spacing) {
    for (let y = Math.min(...ys) + spacing * 0.5; y < Math.max(...ys); y += spacing) {
      const q: Pt = [x + (rng() - 0.5) * spacing * 0.6, y + (rng() - 0.5) * spacing * 0.6];
      if (pointIn(q, pts)) out.push(q);
    }
  }
  return out;
}

/**
 * The patchwork's own drawing, sorted by layer so the editor can hide houses, trees or
 * animals as it hides placed features. Everything is drawn either way (so the seeded
 * scatter never shifts); hidden layers are only dropped at the end.
 */
export function patchworkShapes(model: SceneModel, U: number, hidden?: ReadonlySet<SceneLayer>): Shape[] {
  const patches = model.patches ?? [];
  const shapes: Shape[] = [];
  const works: Shape[] = [];
  const plantings: Shape[] = [];
  const buildings: Shape[] = [];
  const life: Shape[] = [];
  const plots = patches.filter((p) => p.kind !== 'road').map((p) => ({ p, pts: p.points.map(([x, y]): Pt => [x * U, y * U]) }));

  // The streets: a scatter of gravel and cobble knots in the gaps between plots.
  const village = (model.villageOutline ?? []).map((poly) => poly.map(([x, y]): Pt => [x * U, y * U]));
  const gravel = createSeededRng(7);
  for (const face of village) {
    for (const q of scatter(face, U * 0.55, gravel)) {
      if (plots.some(({ pts }) => pointIn(q, pts))) continue;
      shapes.push({ kind: 'knot', at: q, r: U * (0.035 + gravel() * 0.03), ink: gravel() < 0.7 ? 'dark' : 'gold' });
    }
  }

  // Plot grounds: a faint wash only, no outline; water a little stronger, all one way.
  for (const { p, pts } of plots) {
    const open = p.kind === 'water' ? 0.25 : p.kind === 'house' ? 1 : p.kind === 'field' ? 0.7 : 0.95;
    const grain = p.kind === 'water' && model.streamFlow !== undefined ? model.streamFlow : p.grain;
    shapes.push({ kind: 'area', points: pts, ink: p.kind === 'orchard' || p.kind === 'wood' ? 'accent' : p.ink, grain, open });
  }

  for (const { p, pts } of plots) {
    const rng = createSeededRng(p.seed);
    const fr = frameOf(pts, p.front ?? 0);
    switch (p.kind) {
      case 'house':
        houseRow(buildings, p, pts, fr, rng, U, model.houseLook === 'stitched', model.houseScale ?? 2);
        break;
      case 'garden':
      case 'vineyard':
      case 'field': {
        // Fine rows: little plants, vines as knots, or the furrows of a field.
        const spacing = p.kind === 'field' ? U * 0.5 : U * 0.7;
        const plants: Ink[] = (['primary', 'accent2', 'gold'] as const).filter((i) => i !== p.ink);
        for (let into = spacing * 0.7; into < fr.depth - spacing * 0.3; into += spacing) {
          if (p.kind === 'field') {
            const row: Pt[] = [];
            for (let along = -U; along < fr.len + U; along += U * 0.4) {
              const q = fr.at(along, into);
              if (pointIn(q, pts)) row.push(q);
            }
            if (row.length > 1) shapes.push({ kind: 'line', points: row, ink: 'gold', weight: 0.12 });
            continue;
          }
          for (let along = spacing * 0.5; along < fr.len; along += spacing) {
            const q = fr.at(along, into);
            if (!pointIn(q, pts)) continue;
            if (p.kind === 'vineyard') shapes.push({ kind: 'knot', at: q, r: U * 0.045, ink: 'dark' });
            else {
              const s = U * 0.07;
              const ink = plants[Math.floor(into / spacing) % plants.length];
              shapes.push({ kind: 'line', points: [[q[0] - s, q[1] - s], [q[0] + s, q[1] + s]], ink, weight: 0.18 });
              shapes.push({ kind: 'line', points: [[q[0] + s, q[1] - s], [q[0] - s, q[1] + s]], ink, weight: 0.18 });
            }
          }
        }
        break;
      }
      case 'orchard':
      case 'wood': {
        const dense = p.kind === 'wood';
        for (const q of scatter(pts, U * (dense ? 0.95 : 1.4), rng)) {
          const r = U * (dense ? 0.55 + rng() * 0.25 : 0.45 + rng() * 0.15);
          plantings.push({ kind: 'area', points: circle(q, r, 12), ink: dense && rng() < 0.4 ? 'dark' : 'accent', grain: rng() * Math.PI });
          if (!dense) for (let k = 0; k < 3; k++) plantings.push({ kind: 'knot', at: [q[0] + (rng() - 0.5) * r, q[1] + (rng() - 0.5) * r], r: U * 0.05, ink: 'primary' });
        }
        // Now and then a deer or a fox at the edge of a wood.
        if (dense && rng() < 0.5) life.push(...animal(rng() < 0.6 ? 'deer' : 'fox', fr.at(fr.len * 0.5, U * 0.4), U, rng() < 0.5 ? 1 : -1, rng));
        break;
      }
      case 'yard': {
        // A farmyard: a haystack or two, a woodpile, and a few birds and beasts.
        for (let k = 0; k < 2; k++) {
          const q = fr.at(fr.len * (0.25 + 0.5 * rng()), fr.depth * (0.35 + 0.3 * rng()));
          works.push({ kind: 'area', points: circle(q, U * 0.4, 12), ink: 'gold', grain: Math.PI / 2 });
          works.push({ kind: 'line', points: circle(q, U * 0.4, 12), ink: 'dark', weight: 0.2, closed: true });
        }
        const beasts: AnimalKind[] = ['hen', 'hen', 'goose', 'pig', 'goat'];
        for (let k = 0; k < 3; k++) life.push(...animal(beasts[Math.floor(rng() * beasts.length)], fr.at(fr.len * rng(), fr.depth * (0.2 + 0.6 * rng())), U, rng() < 0.5 ? 1 : -1, rng));
        break;
      }
      case 'pasture': {
        const herd: AnimalKind = (['sheep', 'sheep', 'cow', 'goat'] as const)[Math.floor(rng() * 4)];
        const count = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < count; k++) {
          const q = fr.at(fr.len * (0.15 + 0.7 * rng()), fr.depth * (0.2 + 0.6 * rng()));
          if (pointIn(q, pts)) life.push(...animal(herd, q, U, rng() < 0.5 ? 1 : -1, rng));
        }
        break;
      }
      case 'meadow':
        for (let k = 0; k < 5; k++) {
          const q = fr.at(rng() * fr.len, rng() * fr.depth);
          if (pointIn(q, pts)) shapes.push({ kind: 'knot', at: q, r: U * 0.05, ink: rng() < 0.5 ? 'primary' : 'gold' });
        }
        break;
      case 'water': {
        // Waves running downstream, the same way in every stretch, so the stream reads as one.
        const flow = model.streamFlow ?? p.grain;
        const fu: Pt = [Math.cos(flow), Math.sin(flow)];
        const fn: Pt = [-fu[1], fu[0]];
        const mid = pts.reduce<Pt>((acc, q) => [acc[0] + q[0] / pts.length, acc[1] + q[1] / pts.length], [0, 0]);
        for (let off = -U * 3; off <= U * 3; off += U * 0.6) {
          const wave: Pt[] = [];
          for (let t = -U * 4; t <= U * 4; t += U * 0.15) {
            const along = t + Math.round((mid[0] * fu[0] + mid[1] * fu[1]) / (U * 0.6)) * 0; // stay continuous across stretches
            const q: Pt = [mid[0] + fu[0] * along + fn[0] * (off + Math.sin(((mid[0] * fu[0] + mid[1] * fu[1] + along) / U) * 2.2) * U * 0.08), mid[1] + fu[1] * along + fn[1] * (off + Math.sin(((mid[0] * fu[0] + mid[1] * fu[1] + along) / U) * 2.2) * U * 0.08)];
            if (pointIn(q, pts)) wave.push(q);
            else if (wave.length > 1) {
              shapes.push({ kind: 'line', points: [...wave], ink: 'secondary', weight: 0.22 });
              wave.length = 0;
            } else wave.length = 0;
          }
          if (wave.length > 1) shapes.push({ kind: 'line', points: wave, ink: 'secondary', weight: 0.22 });
        }
        if (rng() < 0.35) life.push(...animal('stork', fr.at(fr.len * 0.5, U * 0.2), U, rng() < 0.5 ? 1 : -1, rng));
        break;
      }
      default:
        break;
    }
  }

  // Bridges: plank decks across the stream, with a rail on each side.
  for (const br of model.bridges ?? []) bridgeShapes(works, br, U);
  const keep = (layer: SceneLayer, list: Shape[]) => (hidden?.has(layer) ? [] : list);
  return [...keep('ground', shapes), ...keep('works', works), ...keep('plantings', plantings), ...keep('buildings', buildings), ...keep('life', life)];
}

function bridgeShapes(shapes: Shape[], br: Bridge, U: number) {
  const a: Pt = [br.a[0] * U, br.a[1] * U];
  const b: Pt = [br.b[0] * U, br.b[1] * U];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: Pt = [-u[1], u[0]];
  const h = br.half * U * 1.05;
  const P = (t: number, o: number): Pt => [a[0] + u[0] * t + n[0] * o, a[1] + u[1] * t + n[1] * o];
  const ext = U * 0.4;
  shapes.push({ kind: 'area', points: [P(-ext, -h), P(len + ext, -h), P(len + ext, h), P(-ext, h)], ink: 'gold', grain: Math.atan2(n[1], n[0]) });
  for (let t = -ext; t <= len + ext; t += U * 0.35) shapes.push({ kind: 'line', points: [P(t, -h), P(t, h)], ink: 'dark', weight: 0.15 });
  for (const o of [-h, h]) shapes.push({ kind: 'line', points: [P(-ext, o), P(len + ext, o)], ink: 'dark', weight: 0.5 });
}

/** The houses of a house plot: a row along the street, sometimes overlapping, sometimes a corner house on the side street. */
function houseRow(shapes: Shape[], p: Patch, pts: Pt[], fr: Frame, rng: Rng, U: number, stitched = false, scale = 2) {
  const special = p.special;
  // Houses may stand taller than their plot is deep (they overlap what is behind, as on an
  // old map), so the room is set by the house size, not only by the plot.
  const s = scale;
  const room = Math.min(U * 4.2 * s, Math.max(fr.depth * 1.1, U * 2.2 * s));
  const mid = pts.reduce<Pt>((acc, q) => [acc[0] + q[0] / pts.length, acc[1] + q[1] / pts.length], [0, 0]);
  const place = (ra: Pt, ru: Pt, rn: Pt, along: number, w: number, h: number, kind: HouseKind | SpecialBuilding) => {
    const tilt = (rng() - 0.5) * 0.3; // a Chagall lean
    const c: Pt = [ra[0] + ru[0] * (along + w / 2) + rn[0] * U * 0.05, ra[1] + ru[1] * (along + w / 2) + rn[1] * U * 0.05];
    const cu: Pt = [ru[0] * Math.cos(tilt) - ru[1] * Math.sin(tilt), ru[0] * Math.sin(tilt) + ru[1] * Math.cos(tilt)];
    const cn: Pt = [rn[0] * Math.cos(tilt) - rn[1] * Math.sin(tilt), rn[0] * Math.sin(tilt) + rn[1] * Math.cos(tilt)];
    if (stitched) {
      // Counted houses stand upright, as on a sampler, just inside the plot from the street.
      const cell = U / STITCHES_PER_CELL;
      const grid = stitchedHouseGrid(kind, Math.round(w / cell), Math.round(h / cell), Math.floor(rng() * 1e9));
      const at: Pt = [c[0] + cn[0] * grid.h * cell * 0.5, c[1] + cn[1] * grid.h * cell * 0.5];
      shapes.push(...placeShapes([motifShape(grid, cell)], { dx: at[0], dy: at[1] }));
      return;
    }
    building(shapes, c, cu, cn, w, h, rng, U, kind, p.ink);
  };
  if (special) {
    // A named building fills the front of its plot.
    const w = Math.min(Math.max(fr.len * 0.95, U * 2.4 * s), U * (special === 'church' ? 3.4 : 3) * s);
    const h = Math.min(room * 0.95, U * (special === 'church' ? 3.6 : 3.2) * s);
    place(fr.a, fr.u, fr.n, (fr.len - w) / 2, w, h, special);
    return;
  }
  let along = U * 0.1;
  const kinds: HouseKind[] = ['cottage', 'cottage', 'tall', 'long', 'barn'];
  let built = 0;
  // At least one house on every house plot, even a narrow one.
  while (along < fr.len - U * 1.3 * s || built === 0) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const want = U * s * (kind === 'long' || kind === 'barn' ? 2.6 + rng() * 0.8 : kind === 'tall' ? 1.6 + rng() * 0.4 : 1.9 + rng() * 0.6);
    const w = built === 0 ? Math.min(want, Math.max(fr.len * 0.95, U * 1.6 * s)) : Math.min(fr.len - along - U * 0.1, want);
    if (w < U * 1.3 * s) break;
    const h = Math.min(room * 0.95, U * s * (kind === 'tall' ? 3.4 + rng() * 0.5 : kind === 'long' ? 2.4 + rng() * 0.4 : 2.7 + rng() * 0.7));
    place(fr.a, fr.u, fr.n, built === 0 && w > fr.len ? (fr.len - w) / 2 : along, w, h, kind);
    built++;
    // Neighbours sometimes overlap a little, sometimes leave a gap.
    along += w + U * (rng() < 0.25 ? -0.15 : 0.1 + rng() * 0.25);
  }
  // A corner house on the side street, turned to face it.
  if (fr.depth > U * 3.2 * s && rng() < 0.6) {
    const side = (p.front ?? 0) + 1;
    const sa = pts[side % pts.length];
    const sb = pts[(side + 1) % pts.length];
    const sl = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
    const su: Pt = [(sb[0] - sa[0]) / sl, (sb[1] - sa[1]) / sl];
    let sn: Pt = [-su[1], su[0]];
    if ((mid[0] - sa[0]) * sn[0] + (mid[1] - sa[1]) * sn[1] < 0) sn = [-sn[0], -sn[1]];
    const w = Math.min(sl * 0.5, U * 2 * s);
    if (w > U * 1.2 * s) place(sa, su, sn, sl * 0.45, w, Math.min(room * 0.8, U * 2.8 * s), 'cottage');
  }
}
