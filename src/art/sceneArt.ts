/**
 * Turns the semantic scene into shapes: the same vocabulary the motifs use, so the world
 * map is drawn by whichever look is active. Units: `UNITS_PER_TILE` per map cell.
 */
import { createSeededRng } from '../core/rng';
import { lettering, letteringWidth } from './lettering';
import { blossom, chevronLeaf, comb, treeOfLife, tulip } from './motifs';
import { FLAT_KINDS, SCENE_LAYERS, cellRng, isStitched, layerOf, type PatternMark, type SceneFeature, type SceneLayer, type SceneModel, type Terrain } from './scene';
import { bounds, circle, curl, place, type Ink, type Pt, type Shape } from './shapes';
import { motifShape } from './patternGrammar';
import { patchworkShapes, standingBuilding } from './patchworkArt';
import { STITCHES_PER_CELL, stitchedHouse } from './stitchedHouse';
import type { MotifGrid } from './patternGrammar';
import type { PatternReference } from './patternReferences';
import { seedOf, transposed, worldBand, worldMedallion, worldReferences } from './worldMotifs';

export const UNITS_PER_TILE = 8;
const U = UNITS_PER_TILE;
const UP = -Math.PI / 2;
/** Houses and trees are drawn this much larger than their footprint, to stand over people. */
const HOUSE_SCALE = 1.45;
const TREE_SCALE = 1.4;

function house(feature: SceneFeature, refs: PatternReference[], scale: number): Shape[] {
  const rng = createSeededRng(feature.seed);
  // Drawn larger than the footprint, so a house stands well above the people at its door.
  const w = feature.w * U * 0.86 * HOUSE_SCALE * scale;
  const h = feature.h * U * 0.92 * HOUSE_SCALE * scale;
  const wall = h * 0.46;
  const wallInk: Ink = (['accent2', 'secondary', 'primary'] as const)[Math.floor(rng() * 3)];
  const shapes: Shape[] = [
    { kind: 'line', points: [[-w / 2, 0], [w / 2, 0], [w / 2, -wall], [-w / 2, -wall]], ink: 'dark', weight: 0.8, closed: true },
    { kind: 'area', points: [[-w * 0.6, -wall], [w * 0.6, -wall], [0, -h]], ink: 'primary', grain: 0 },
    { kind: 'line', points: [[-w * 0.6, -wall], [0, -h], [w * 0.6, -wall]], ink: 'dark', weight: 0.6 },
    { kind: 'area', points: [[-w * 0.09, 0], [w * 0.09, 0], [w * 0.09, -wall * 0.62], [-w * 0.09, -wall * 0.62]], ink: 'dark', grain: UP },
  ];
  // Roof courses, and a carved gable sign.
  for (let i = 1; i <= 2; i++) {
    const t = i / 3;
    shapes.push({ kind: 'line', points: [[-w * 0.6 * (1 - t), -wall - (h - wall) * t], [w * 0.6 * (1 - t), -wall - (h - wall) * t]], ink: 'gold', weight: 0.4 });
  }
  // A small medallion from the world's patterns, carved in the gable.
  const gable = worldMedallion(feature.seed, refs, 3);
  const gableCell = ((h - wall) * 0.42) / Math.max(gable.w, gable.h);
  shapes.push(...place([motifShape(gable, gableCell)], { dy: -wall - (h - wall) * 0.32 }));
  for (const side of [-1, 1]) {
    const cx = side * w * 0.29;
    const cy = -wall * 0.55;
    const s = w * 0.085;
    shapes.push({ kind: 'area', points: [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]], ink: wallInk, grain: 0 });
    shapes.push({ kind: 'line', points: [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]], ink: 'dark', weight: 0.35, closed: true });
  }
  // A band of the world's pattern under the eaves, as on a real facade.
  const bandCell = 0.42;
  const band = worldBand(feature.seed + 1, refs, (w * 0.84) / bandCell, 3);
  shapes.push(...place([motifShape(band, bandCell)], { dy: -wall * 0.9 }));
  return shapes;
}

function pine(feature: SceneFeature): Shape[] {
  const h = feature.h * U * 0.95 * TREE_SCALE;
  const shapes: Shape[] = [{ kind: 'line', points: [[0, 0], [0, -h * 0.3]], ink: 'dark', weight: 0.7 }];
  for (let i = 0; i < 3; i++) {
    const base = -h * (0.18 + i * 0.24);
    const half = U * (0.5 - i * 0.11) * TREE_SCALE;
    shapes.push({ kind: 'area', points: [[-half, base], [half, base], [0, base - h * 0.36]], ink: 'accent', grain: UP });
  }
  return shapes;
}

/** Whether a well is dry: as set, or else whether it stands in dry ground. */
export function wellIsDry(feature: SceneFeature, model?: SceneModel): boolean {
  if (feature.state) return feature.state === 'dry';
  if (!model) return false;
  let dry = 0;
  let all = 0;
  for (let x = feature.x - 2; x < feature.x + feature.w + 2; x++) {
    for (let y = feature.y - 2; y < feature.y + feature.h + 2; y++) {
      const t = model.terrain[x]?.[y];
      if (!t) continue;
      all++;
      if (t === 'dry') dry++;
    }
  }
  return all > 0 && dry / all > 0.3;
}

/** Points along the front (lower) half of an ellipse, left to right. */
function frontArc(cx: number, cy: number, rx: number, ry: number, steps = 14): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = Math.PI - (i / steps) * Math.PI;
    return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry] as Pt;
  });
}

/**
 * The well, seen from the front and a little above, standing on its footprint: a drum of
 * stone courses with an embroidered rosette, two posts under a shingled roof, a windlass
 * with its rope and bucket, and the serpent wound about the drum. Flowing, water shines in
 * the mouth, the bucket hangs full at the rim and spills over into a puddle; dry, the
 * mouth is dark and cracked, the bucket hangs empty and high, and the stones are cracked.
 */
function well(feature: SceneFeature, model?: SceneModel): Shape[] {
  const dry = wellIsDry(feature, model);
  const w = Math.min(feature.w, 3) * U * 0.82;
  const half = w / 2;
  const dh = w * 0.5;
  const ry = w * 0.17;
  const top = -dh;
  const shapes: Shape[] = [];
  // The drum: its front face between the bottom curve and the front of the rim.
  const bottom = frontArc(0, 0, half, ry);
  const rimFront = frontArc(0, top, half, ry).reverse();
  shapes.push({ kind: 'area', points: [...bottom, ...rimFront], ink: 'primary', grain: 0 });
  // Stone courses, following the drum's curve, and staggered joints between the stones.
  for (const k of [1 / 3, 2 / 3]) {
    shapes.push({ kind: 'line', points: frontArc(0, top * k, half, ry), ink: 'dark', weight: 0.35 });
  }
  for (let row = 0; row < 3; row++) {
    const y0 = top * (row / 3);
    const y1 = top * ((row + 1) / 3);
    for (let j = 0; j < 4; j++) {
      const t = (j + (row % 2 ? 0.5 : 0) + 0.25) / 4;
      const x = -half + t * w;
      const sag = Math.sqrt(Math.max(0, 1 - (x / half) ** 2)) * ry;
      shapes.push({ kind: 'line', points: [[x, y0 + sag], [x, y1 + sag]], ink: 'dark', weight: 0.3 });
    }
  }
  // An embroidered rosette on the face of the drum.
  const rose: Pt = [0, top * 0.5 + ry * 0.9];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    shapes.push({ kind: 'knot', at: [rose[0] + Math.cos(a) * w * 0.07, rose[1] + Math.sin(a) * w * 0.055], r: w * 0.022, ink: i % 2 ? 'gold' : 'secondary' });
  }
  shapes.push({ kind: 'knot', at: rose, r: w * 0.03, ink: 'gold' });
  // The mouth: the far half of the rim behind, then water or a dark, cracked hollow.
  shapes.push({ kind: 'area', points: circle([0, top], half * 0.82, 22).map(([x, y]): Pt => [x, top + (y - top) * (ry / half)]), ink: dry ? 'dark' : 'secondary', grain: 0 });
  if (dry) {
    shapes.push({ kind: 'line', points: [[-half * 0.4, top - ry * 0.1], [-half * 0.1, top + ry * 0.25], [half * 0.15, top - ry * 0.15], [half * 0.45, top + ry * 0.2]], ink: 'gold', weight: 0.25 });
  } else {
    shapes.push({ kind: 'knot', at: [-half * 0.3, top - ry * 0.15], r: w * 0.025, ink: 'gold' });
    shapes.push({ kind: 'line', points: frontArc(0, top - ry * 0.05, half * 0.5, ry * 0.35, 8), ink: 'gold', weight: 0.25 });
  }
  shapes.push({ kind: 'line', points: [...frontArc(0, top, half, ry), ...frontArc(0, top, half, ry).map(([x, y]): Pt => [-x, top - (y - top)])], ink: 'gold', weight: 0.7, closed: true });
  // Posts, the roof and the windlass.
  const postH = w * 1.05;
  const roofY = top - postH;
  for (const side of [-1, 1]) {
    shapes.push({ kind: 'line', points: [[side * half * 0.86, top + ry * 0.4], [side * half * 0.86, roofY + w * 0.04]], ink: 'dark', weight: 1.1 });
  }
  const eave = half * 1.25;
  const peak = roofY - w * 0.42;
  shapes.push({ kind: 'area', points: [[-eave, roofY + w * 0.06], [0, peak], [eave, roofY + w * 0.06]], ink: 'dark', grain: Math.PI / 2 });
  for (let k = 1; k <= 3; k++) {
    const t = k / 4;
    shapes.push({ kind: 'line', points: [[-eave * (1 - t), roofY + w * 0.06 + (peak - roofY - w * 0.06) * t], [eave * (1 - t), roofY + w * 0.06 + (peak - roofY - w * 0.06) * t]], ink: 'gold', weight: 0.3 });
  }
  shapes.push({ kind: 'knot', at: [0, peak - w * 0.05], r: w * 0.045, ink: 'gold' });
  const beamY = roofY + postH * 0.32;
  shapes.push({ kind: 'line', points: [[-half * 0.86, beamY], [half * 0.86, beamY]], ink: 'gold', weight: 0.8 });
  shapes.push({ kind: 'line', points: circle([half * 1.0, beamY], w * 0.07, 10), ink: 'dark', weight: 0.5, closed: true });
  shapes.push({ kind: 'line', points: [[half * 1.0, beamY], [half * 1.13, beamY + w * 0.1]], ink: 'dark', weight: 0.5 });
  // Rope and bucket: down to the water, full; or hanging high and empty.
  const bucketY = dry ? beamY + postH * 0.3 : top - ry * 0.3;
  shapes.push({ kind: 'line', points: [[0, beamY], [0, bucketY - w * 0.12]], ink: 'gold', weight: 0.35 });
  const bw = w * 0.11;
  shapes.push({ kind: 'area', points: [[-bw, bucketY - w * 0.12], [bw, bucketY - w * 0.12], [bw * 0.8, bucketY], [-bw * 0.8, bucketY]], ink: 'gold', grain: Math.PI / 2 });
  if (!dry) shapes.push({ kind: 'line', points: [[-bw * 0.8, bucketY - w * 0.11], [bw * 0.8, bucketY - w * 0.11]], ink: 'secondary', weight: 0.5 });
  // The serpent wound about the drum: a sinuous coil with a head at one end.
  const coil: Pt[] = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    const x = -half * 1.05 + t * w * 1.05;
    return [x, top * 0.62 + Math.sin(t * Math.PI * 3) * dh * 0.16 + Math.sqrt(Math.max(0, 1 - (x / half) ** 2)) * ry];
  });
  shapes.push({ kind: 'line', points: coil, ink: 'accent', weight: 0.9 });
  shapes.push({ kind: 'knot', at: coil[coil.length - 1], r: w * 0.04, ink: 'accent' });
  shapes.push({ kind: 'line', points: curl(coil[0], w * 0.08, 1.1, -1, Math.PI), ink: 'accent', weight: 0.6 });
  if (dry) {
    // Cracks in the stones, and dry tufts at the foot.
    shapes.push({ kind: 'line', points: [[half * 0.35, top * 0.15 + ry], [half * 0.45, top * 0.35 + ry], [half * 0.3, top * 0.55 + ry]], ink: 'dark', weight: 0.3 });
    for (const x of [-half * 1.15, half * 1.2]) shapes.push({ kind: 'line', points: [[x - w * 0.04, -w * 0.06], [x, 0], [x + w * 0.04, -w * 0.07]], ink: 'gold', weight: 0.3 });
  } else {
    // Water brims over the rim and runs down into a puddle at the foot.
    const spill: Pt[] = Array.from({ length: 7 }, (_, i) => [half * 0.95 + Math.sin(i * 1.3) * w * 0.02, top + ry * 0.2 + (i / 6) * (dh - ry * 0.2)]);
    shapes.push({ kind: 'line', points: spill, ink: 'secondary', weight: 0.6 });
    shapes.push({ kind: 'area', points: circle([half * 1.15, ry * 0.4], w * 0.2, 14).map(([x, y]): Pt => [x, ry * 0.4 + (y - ry * 0.4) * 0.35]), ink: 'secondary', grain: 0 });
    shapes.push({ kind: 'knot', at: [half * 1.02, top * 0.3], r: w * 0.018, ink: 'secondary' });
  }
  return shapes;
}

function hearth(feature: SceneFeature): Shape[] {
  const r = Math.min(feature.w, feature.h) * U * 0.3;
  const shapes: Shape[] = [{ kind: 'line', points: circle([0, 0], r * 1.3, 20), ink: 'dark', weight: 0.9, closed: true }];
  shapes.push(...tulip(r * 1.1, ['primary', 'gold']).map((s) => s));
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    shapes.push({ kind: 'knot', at: [Math.cos(a) * r * 1.7, Math.sin(a) * r * 1.7], r: 0.5, ink: i % 2 ? 'primary' : 'gold' });
  }
  return place(shapes, { dy: -r * 0.2 });
}

/**
 * Which way a house faces: toward the side of its footprint with the most road beside it
 * (below if none). Like the houses of an old drawn map, a house beside a road on its right
 * lies on its side with its door to the road, one above the road stands upside down.
 */
function houseFacing(feature: SceneFeature, model?: SceneModel): number {
  if (!model) return 0;
  const road = (x: number, y: number) => {
    const t = model.terrain[x]?.[y];
    return t === 'road' || t === 'bridge' ? 1 : 0;
  };
  let below = 0;
  let above = 0;
  let left = 0;
  let right = 0;
  for (let i = feature.x; i < feature.x + feature.w; i++) {
    below += road(i, feature.y + feature.h) + road(i, feature.y + feature.h + 1) * 0.5;
    above += road(i, feature.y - 1) + road(i, feature.y - 2) * 0.5;
  }
  for (let j = feature.y; j < feature.y + feature.h; j++) {
    right += road(feature.x + feature.w, j) + road(feature.x + feature.w + 1, j) * 0.5;
    left += road(feature.x - 1, j) + road(feature.x - 2, j) * 0.5;
  }
  const best = Math.max(below, above, left, right);
  if (best === 0 || best === below) return 0;
  if (best === right) return -Math.PI / 2;
  if (best === left) return Math.PI / 2;
  return Math.PI;
}

/** How large a world draws its houses against people (2 unless the world says). */
export function houseScaleOf(model?: { houseScale?: number }): number {
  return model?.houseScale ?? 2;
}

/**
 * The drawn extent of a house, in cells, at a given size: what it covers on the cloth, not
 * its footprint. Folk houses stand on the edge facing the road (turned to face it); named
 * and stitched houses stand upright on the foot of their footprint.
 */
function houseExtent(f: SceneFeature, model: SceneModel, scale: number, facing?: number): [number, number, number, number] {
  const look = f.look ?? model.houseLook;
  const upright = look === 'stitched' || (Boolean(f.variant) && look !== 'stitched-turned');
  const cx = f.x + f.w / 2;
  if (upright) {
    const tall = f.variant === 'tall' || f.variant === 'church';
    const W = f.w * (f.variant ? 0.95 : 0.86 * HOUSE_SCALE) * scale * 1.1;
    const H = (f.variant ? (tall ? 3.6 : f.variant === 'long' || f.variant === 'barn' ? 2.6 : 3) : f.h * 0.92 * HOUSE_SCALE) * scale;
    const foot = f.y + f.h;
    return [cx - W / 2, foot - H, cx + W / 2, foot];
  }
  const rot = facing ?? houseFacing(f, model);
  const W = f.w * 0.86 * HOUSE_SCALE * scale * 1.2; // the eaves reach past the walls
  const H = f.h * 0.92 * HOUSE_SCALE * scale;
  const cy = f.y + f.h / 2;
  if (rot === 0) return [cx - W / 2, f.y + f.h - H, cx + W / 2, f.y + f.h];
  if (rot === Math.PI) return [cx - W / 2, f.y, cx + W / 2, f.y + H];
  // Lying on its side, it rises away from the road it faces.
  if (rot < 0) return [f.x + f.w - H, cy - W / 2, f.x + f.w, cy + W / 2];
  return [f.x, cy - W / 2, f.x + H, cy + W / 2];
}

const fittedCache = new WeakMap<SceneModel, Map<SceneFeature, { scale: number; facing?: number }>>();
/** Cells along each side kept clear for the cloth's frame. */
const FRAME = 1;

/**
 * How large each house of a grid world can be drawn without crowding: from the world's
 * house size down (never below the old size) until what it covers is almost free of roads,
 * water, walls, other houses' footprints and the houses already placed. Houses are fitted
 * in turn, so two never grow into the same gap.
 */
export function fittedHouses(model: SceneModel): Map<SceneFeature, { scale: number; facing?: number }> {
  const hit = fittedCache.get(model);
  if (hit) return hit;
  const out = new Map<SceneFeature, { scale: number; facing?: number }>();
  const target = houseScaleOf(model);
  const houses = model.features.filter((f) => f.kind === 'house');
  if (model.patches || target <= 1 || houses.length === 0) {
    fittedCache.set(model, out);
    return out;
  }
  const { width, height } = model;
  const taken = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    const t = model.terrain[x][y];
    if (t === 'road' || t === 'water' || t === 'bridge' || t === 'wall') taken[x * height + y] = 1;
  }
  const own = new Map<SceneFeature, Set<number>>();
  for (const f of houses) {
    const cells = new Set<number>();
    for (let x = f.x; x < f.x + f.w; x++) for (let y = f.y; y < f.y + f.h; y++) if (x >= 0 && y >= 0 && x < width && y < height) {
      cells.add(x * height + y);
      taken[x * height + y] = 2;
    }
    own.set(f, cells);
  }
  const crowding = (box: [number, number, number, number], mine: Set<number>) => {
    let all = 0;
    let busy = 0;
    for (let x = Math.floor(box[0]); x < Math.ceil(box[2]); x++) for (let y = Math.floor(box[1]); y < Math.ceil(box[3]); y++) {
      all++;
      // Past the cloth's frame (its outermost cell) there is no room at all: a house that
      // would reach out through it is drawn smaller instead.
      if (x < FRAME || y < FRAME || x >= width - FRAME || y >= height - FRAME) return 1;
      const k = x * height + y;
      if (taken[k] && !mine.has(k)) busy++;
    }
    return all ? busy / all : 0;
  };
  const ordered = [...houses].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const f of ordered) {
    const mine = own.get(f)!;
    const natural = houseFacing(f, model);
    const look = f.look ?? model.houseLook;
    const upright = look === 'stitched' || (Boolean(f.variant) && look !== 'stitched-turned');
    // A house lying on its side may stand upright instead when that crowds less.
    const facings = upright || natural === 0 ? [natural] : [natural, 0];
    let best = { scale: 0.8, facing: natural, crowd: Infinity };
    search: for (let s = target; s >= 0.8 - 1e-6; s -= 0.15) {
      for (const facing of facings) {
        const crowd = crowding(houseExtent(f, model, s, facing), mine);
        if (crowd <= 0.08) {
          best = { scale: s, facing, crowd };
          break search;
        }
        if (s - 0.15 < 0.8 - 1e-6 && crowd < best.crowd) best = { scale: s, facing, crowd };
      }
    }
    out.set(f, best.facing === natural ? { scale: best.scale } : { scale: best.scale, facing: best.facing });
    // What it now covers is taken, so the next house does not grow into it.
    const box = houseExtent(f, model, best.scale, best.facing);
    for (let x = Math.floor(box[0]); x < Math.ceil(box[2]); x++) for (let y = Math.floor(box[1]); y < Math.ceil(box[3]); y++) if (x >= 0 && y >= 0 && x < width && y < height) taken[x * height + y] = taken[x * height + y] || 3;
  }
  fittedCache.set(model, out);
  return out;
}

/** The references a feature's pattern grows from: its own, if it names one. */
function refFor(feature: SceneFeature, refs: PatternReference[]): PatternReference[] {
  if (!feature.ref) return refs;
  const own = worldReferences([feature.ref]);
  return own.length === 1 ? own : refs;
}

/** A feature's shapes, turned by its angle about the centre of its footprint. */
function turnedFeatureShapes(feature: SceneFeature, refs: PatternReference[], model?: SceneModel): Shape[] {
  const shapes = featureShapes(feature, refs, model);
  if (!feature.angle) return shapes;
  const cx = (feature.x + feature.w / 2) * U;
  const cy = (feature.y + feature.h / 2) * U;
  return place(place(shapes, { dx: -cx, dy: -cy }), { dx: cx, dy: cy, rot: feature.angle });
}

function featureShapes(feature: SceneFeature, refs: PatternReference[], model?: SceneModel): Shape[] {
  const footX = (feature.x + feature.w / 2) * U;
  const footY = (feature.y + feature.h) * U - U * 0.12;
  const centreY = (feature.y + feature.h / 2) * U;
  const rng = createSeededRng(feature.seed);
  switch (feature.kind) {
    case 'house': {
      const fit = model ? fittedHouses(model).get(feature) : undefined;
      const hs = fit?.scale ?? houseScaleOf(model);
      const look = feature.look ?? model?.houseLook;
      if (isStitched(look)) {
        // A counted house: upright on its footprint like a house on a sampler, or turned to
        // stand on the edge facing the road, like the drawn houses.
        const tall = feature.variant === 'tall' || feature.variant === 'church';
        const w = feature.w * U * (feature.variant ? 0.95 : 0.86 * HOUSE_SCALE) * hs;
        const h = (feature.variant ? U * (tall ? 3.6 : feature.variant === 'long' || feature.variant === 'barn' ? 2.6 : 3) : feature.h * U * 0.92 * HOUSE_SCALE) * hs;
        const { grid, cell } = stitchedHouse(feature.variant ?? 'folk', w, h, feature.seed, U);
        if (look === 'stitched-turned' && model) {
          const rot = fit?.facing ?? houseFacing(feature, model);
          const cx = (feature.x + feature.w / 2) * U;
          const cy = (feature.y + feature.h / 2) * U;
          const halfW = (feature.w * U) / 2;
          const halfH = (feature.h * U) / 2 - U * 0.12;
          const base: Pt = rot === 0 ? [cx, cy + halfH] : rot === Math.PI ? [cx, cy - halfH] : rot < 0 ? [cx + halfW - U * 0.12, cy] : [cx - halfW + U * 0.12, cy];
          const half = (grid.h * cell) / 2;
          return place([motifShape(grid, cell)], { dx: base[0] + Math.sin(rot) * half, dy: base[1] - Math.cos(rot) * half, rot });
        }
        return place([motifShape(grid, cell)], { dx: footX, dy: footY - (grid.h * cell) / 2 });
      }
      if (feature.variant) {
        // A building of a named kind, in the patchwork's style, standing on its footprint.
        const tall = feature.variant === 'tall' || feature.variant === 'church';
        const w = feature.w * U * 0.95 * hs;
        const h = U * (tall ? 3.6 : feature.variant === 'long' || feature.variant === 'barn' ? 2.6 : 3) * (0.9 + rng() * 0.2) * hs;
        return place(standingBuilding(feature.variant, w, h, feature.seed, U), { dx: footX, dy: footY });
      }
    {
      // Stand the house on the edge of its footprint that faces the road, turned to face it.
      const rot = fit?.facing ?? houseFacing(feature, model);
      const cx = (feature.x + feature.w / 2) * U;
      const cy = (feature.y + feature.h / 2) * U;
      const halfW = (feature.w * U) / 2;
      const halfH = (feature.h * U) / 2 - U * 0.12;
      const base: Pt = rot === 0 ? [cx, cy + halfH] : rot === Math.PI ? [cx, cy - halfH] : rot < 0 ? [cx + halfW - U * 0.12, cy] : [cx - halfW + U * 0.12, cy];
      return place(house(feature, refs, hs), { dx: base[0], dy: base[1], rot });
    }
    }
    case 'tree':
      return place(treeOfLife(rng, feature.h * U * 0.94 * TREE_SCALE), { dx: footX, dy: footY });
    case 'pine':
      return place(pine(feature), { dx: footX, dy: footY });
    case 'well':
      // Seen from the front, standing on its footprint like a house.
      return place(well(feature, model), { dx: footX, dy: footY });
    case 'hearth':
      return place(hearth(feature), { dx: footX, dy: centreY });
    case 'star': {
      // A dancing ground: a medallion grown from the world's patterns, filling the ground.
      // As many stitches as the world's count allows at this size (the grammars top out).
      const span = Math.min(feature.w, feature.h) * 0.9 * STITCHES_PER_CELL;
      const motif = worldMedallion(feature.seed, refFor(feature, refs), Math.max(5, Math.min(14, Math.round((span - 1) / 2))));
      const cell = (Math.min(feature.w, feature.h) * U * 0.9) / Math.max(motif.w, motif.h);
      return place([motifShape(motif, cell)], { dx: footX, dy: centreY });
    }
    case 'pool':
      return place(
        [
          { kind: 'area', points: circle([0, 0], feature.w * U * 0.4, 20), ink: 'secondary', grain: 0 },
          { kind: 'line', points: circle([0, 0], feature.w * U * 0.47, 20), ink: 'gold', weight: 0.5, closed: true },
        ],
        { dx: footX, dy: centreY },
      );
    case 'wheat':
      return [-1, 0, 1].flatMap((i) => place(comb(feature.h * U * 0.6, 'gold'), { dx: footX + i * U * 0.55, dy: footY }));
    case 'flowers':
      return place(
        [{ kind: 'line', points: [[0, 0], [0, -U * 0.45]], ink: 'dark', weight: 0.4 }, ...place(blossom(U * 0.26), { dy: -U * 0.6 })],
        { dx: footX, dy: footY },
      );
    case 'prop':
      return place(chevronLeaf(U * 0.55, ['dark', 'gold']), { dx: footX, dy: footY });
    case 'grove':
      return place(treeOfLife(rng, feature.h * U * 0.78 * TREE_SCALE), { dx: footX, dy: footY });
    case 'sapling':
      return place(pine({ ...feature, h: feature.h * 0.72 }), { dx: footX, dy: footY });
    case 'fence':
      return fence(feature);
    case 'haystack':
      return place(haystack(), { dx: footX, dy: footY });
    case 'woodpile':
      return place(woodpile(), { dx: footX, dy: footY });
    case 'sunflower':
      return place(sunflower(), { dx: footX, dy: footY });
    case 'hen':
      return place(bird(rng() < 0.5, 'gold', 'primary'), { dx: footX, dy: footY - U * 0.1 });
    case 'duck':
      return place(bird(rng() < 0.5, 'gold', 'accent'), { dx: footX, dy: centreY + U * 0.1 });
    case 'field':
      return strips(feature, false);
    case 'vineyard':
      return strips(feature, true);
    case 'reeds':
      return place(reeds(rng), { dx: footX, dy: footY });
    case 'rosette':
      return place(rosette(rng), { dx: footX, dy: centreY });
  }
}

/** A wattle fence round a yard: posts with two woven rails, open at the house and the gate. */
function fence(feature: SceneFeature): Shape[] {
  const x0 = feature.x * U + U * 0.2;
  const x1 = (feature.x + feature.w) * U - U * 0.2;
  const y0 = feature.y * U + U * 0.15;
  const y1 = (feature.y + feature.h) * U - U * 0.25;
  const gate = [(x0 + x1) / 2 - U * 0.45, (x0 + x1) / 2 + U * 0.45];
  const shapes: Shape[] = [];
  const run = (a: Pt, b: Pt) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const posts = Math.max(1, Math.round(len / (U * 0.75)));
    for (let i = 0; i <= posts; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / posts;
      const y = a[1] + ((b[1] - a[1]) * i) / posts;
      shapes.push({ kind: 'line', points: [[x, y], [x, y - U * 0.42]], ink: 'dark', weight: 0.45 });
    }
    for (const lift of [0.14, 0.3]) {
      shapes.push({ kind: 'line', points: [[a[0], a[1] - U * lift], [b[0], b[1] - U * lift]], ink: 'gold', weight: 0.4 });
    }
  };
  run([x0, y0], [x0, y1]);
  run([x1, y0], [x1, y1]);
  run([x0, y1], [gate[0], y1]);
  run([gate[1], y1], [x1, y1]);
  return shapes;
}

function haystack(): Shape[] {
  const w = U * 0.42;
  const h = U * 0.8;
  const dome: Pt[] = [[-w, 0], ...Array.from({ length: 9 }, (_, i): Pt => {
    const a = Math.PI + (i / 8) * Math.PI;
    return [Math.cos(a) * w, -h * 0.35 + Math.sin(a) * h * 0.65];
  }), [w, 0]];
  return [
    { kind: 'area', points: dome, ink: 'gold', grain: UP },
    { kind: 'line', points: [[0, -h], [0, -h - U * 0.18]], ink: 'dark', weight: 0.5 },
    { kind: 'line', points: [[-w * 0.7, -h * 0.35], [w * 0.7, -h * 0.35]], ink: 'dark', weight: 0.3 },
  ];
}

function woodpile(): Shape[] {
  const shapes: Shape[] = [];
  const r = U * 0.11;
  for (const [row, count] of [[0, 3], [1, 2], [2, 1]] as const) {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * r * 2.2;
      const y = -r - row * r * 1.9;
      shapes.push({ kind: 'line', points: circle([x, y], r, 8), ink: 'dark', weight: 0.4, closed: true });
      shapes.push({ kind: 'knot', at: [x, y], r: r * 0.35, ink: 'gold' });
    }
  }
  return shapes;
}

function sunflower(): Shape[] {
  const h = U * 0.95;
  const shapes: Shape[] = [
    { kind: 'line', points: [[0, 0], [U * 0.04, -h]], ink: 'accent', weight: 0.5 },
    { kind: 'area', points: [[0, -h * 0.4], [U * 0.28, -h * 0.55], [U * 0.05, -h * 0.5]], ink: 'accent', grain: 0 },
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    shapes.push({ kind: 'knot', at: [U * 0.04 + Math.cos(a) * U * 0.17, -h + Math.sin(a) * U * 0.17], r: U * 0.07, ink: 'gold' });
  }
  shapes.push({ kind: 'knot', at: [U * 0.04, -h], r: U * 0.1, ink: 'dark' });
  return shapes;
}

/** A small bird: a hen in a yard, a duck on the water. */
function bird(facingLeft: boolean, body: Ink, head: Ink): Shape[] {
  const s = U * 0.26;
  const shapes: Shape[] = [
    { kind: 'area', points: [[-s, -s * 0.2], [-s * 0.4, -s * 0.9], [s * 0.6, -s * 0.8], [s, -s * 0.3], [s * 0.5, 0], [-s * 0.6, 0]], ink: body, grain: 0 },
    { kind: 'knot', at: [s * 0.75, -s * 1.05], r: s * 0.32, ink: head },
    { kind: 'area', points: [[s * 1.0, -s * 1.1], [s * 1.35, -s * 0.98], [s * 1.0, -s * 0.9]], ink: 'primary', grain: 0 },
    { kind: 'line', points: [[-s, -s * 0.25], [-s * 1.35, -s * 0.85]], ink: 'dark', weight: 0.35 },
  ];
  return facingLeft ? place(shapes, { mirrorX: true }) : shapes;
}

/** Strip fields: parallel rows of grain, or vines on posts, inside a stitched boundary. */
function strips(feature: SceneFeature, vines: boolean): Shape[] {
  const x0 = feature.x * U + U * 0.25;
  const x1 = (feature.x + feature.w) * U - U * 0.25;
  const y0 = feature.y * U + U * 0.3;
  const y1 = (feature.y + feature.h) * U - U * 0.2;
  const shapes: Shape[] = [
    { kind: 'line', points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], ink: 'dark', weight: 0.3, closed: true },
  ];
  const rows = Math.max(2, Math.round((y1 - y0) / (U * 0.55)));
  for (let r = 0; r < rows; r++) {
    const y = y0 + ((r + 0.7) / rows) * (y1 - y0);
    if (vines) {
      shapes.push({ kind: 'line', points: [[x0 + U * 0.2, y - U * 0.3], [x1 - U * 0.2, y - U * 0.3]], ink: 'dark', weight: 0.25 });
      for (let x = x0 + U * 0.35; x < x1 - U * 0.2; x += U * 0.7) {
        shapes.push({ kind: 'line', points: [[x, y], [x, y - U * 0.38]], ink: 'dark', weight: 0.35 });
        shapes.push({ kind: 'line', points: curl([x + U * 0.08, y - U * 0.22], U * 0.12, 1, 1, 0), ink: 'accent', weight: 0.35 });
        shapes.push({ kind: 'knot', at: [x + U * 0.22, y - U * 0.12], r: U * 0.06, ink: 'accent2' });
      }
    } else {
      const ink: Ink = r % 2 ? 'gold' : 'accent';
      for (let x = x0 + U * 0.2; x < x1 - U * 0.1; x += U * 0.32) {
        shapes.push({ kind: 'line', points: [[x - U * 0.06, y], [x + U * 0.06, y - U * 0.26]], ink, weight: 0.35 });
      }
    }
  }
  return shapes;
}

function reeds(rng: () => number): Shape[] {
  const shapes: Shape[] = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * U * 0.16 + (rng() - 0.5) * U * 0.06;
    const h = U * (0.55 + rng() * 0.3);
    shapes.push({ kind: 'line', points: [[x, 0], [x + (i - 1) * U * 0.06, -h]], ink: 'accent', weight: 0.35 });
    if (i !== 1) {
      // A cattail head: a small upright oval at the top of the stem.
      const cx = x + (i - 1) * U * 0.06;
      const cy = -h - U * 0.1;
      shapes.push({ kind: 'area', points: circle([cx, cy], U * 0.05, 8).map(([px, py]): Pt => [px, cy + (py - cy) * 2.2]), ink: 'dark', grain: UP });
    }
  }
  return shapes;
}

/** A tiny four-knot rosette: one repeat of the meadow's all-over pattern. */
function rosette(rng: () => number): Shape[] {
  const r = U * 0.12;
  const ink: Ink = rng() < 0.5 ? 'accent' : 'gold';
  return [
    ...[0, 1, 2, 3].map((i): Shape => ({ kind: 'knot', at: [Math.cos((i * Math.PI) / 2) * r, Math.sin((i * Math.PI) / 2) * r], r: 0.32, ink })),
    { kind: 'knot', at: [0, 0], r: 0.3, ink: 'primary' },
  ];
}

/** Stitches across a road cell. */
const ROAD_STITCHES = 8;

function terrainShapes(model: SceneModel): Shape[] {
  const shapes: Shape[] = [];
  const roadCells: Array<[number, number, Ink]> = [];
  const wallCells: Array<[number, number, Ink]> = [];
  const is = (x: number, y: number, kind: Terrain) => model.terrain[x]?.[y] === kind;

  for (let x = 0; x < model.width; x++) {
    for (let y = 0; y < model.height; y++) {
      const kind = model.terrain[x][y];
      const x0 = x * U;
      const y0 = y * U;
      const rng = cellRng(x, y);
      if (kind === 'water') {
        // Running waves: phase follows world x so neighbouring cells join up.
        for (const row of [0.28, 0.72]) {
          const points: Pt[] = [];
          for (let i = 0; i <= 6; i++) {
            const px = x0 + (i / 6) * U;
            points.push([px, y0 + row * U + Math.sin((px / U) * Math.PI * 2 + row * 5 + y * 1.7) * U * 0.11]);
          }
          shapes.push({ kind: 'line', points, ink: 'secondary', weight: 0.75 });
        }
      } else if (kind === 'road') {
        // A light trellis of gold crosses, at the world's thread scale, open enough that the
        // linen shows through and people walking on the road stay easy to read.
        const n = ROAD_STITCHES;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((x * n + i + y * n + j) % 8 === 0 || (x * n + i - y * n - j + 4096) % 8 === 0) roadCells.push([x * n + i, y * n + j, 'gold']);
      } else if (kind === 'wall') {
        // Masonry in fine stitches, at the road's scale: courses of staggered bricks with a
        // row of bare linen for the mortar, mostly dark with the odd red brick. Charted on the
        // world's grid, so a wall joins up cell to cell.
        const n = ROAD_STITCHES;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const gx = x * n + i;
            const gy = y * n + j;
            const course = Math.floor(gy / 3);
            if (gy % 3 === 2) continue;
            const along = gx + (course % 2) * 2;
            if (along % 4 === 3) continue;
            const brick = Math.floor(along / 4) + course * 7;
            wallCells.push([gx, gy, brick % 5 === 0 ? 'primary' : 'dark']);
          }
        }
      } else if (kind === 'dry') {
        const count = 1 + Math.floor(rng() * 2);
        for (let i = 0; i < count; i++) {
          shapes.push({ kind: 'knot', at: [x0 + rng() * U, y0 + rng() * U], r: 0.32 + rng() * 0.2, ink: rng() < 0.3 ? 'primary' : 'gold' });
        }
        if (rng() < 0.2) {
          const cx = x0 + rng() * U;
          const cy = y0 + rng() * U;
          shapes.push({ kind: 'line', points: [[cx - 1.2, cy], [cx, cy + 0.7], [cx + 1.3, cy - 0.3]], ink: 'dark', weight: 0.3 });
        }
      } else if (kind === 'bridge') {
        const across = is(x - 1, y, 'water') || is(x + 1, y, 'water');
        for (let i = 0; i < 4; i++) {
          const t = (i + 0.5) / 4;
          shapes.push({
            kind: 'line',
            points: across ? [[x0, y0 + t * U], [x0 + U, y0 + t * U]] : [[x0 + t * U, y0], [x0 + t * U, y0 + U]],
            ink: 'dark',
            weight: 0.7,
          });
        }
      } else if (rng() < 0.085) {
        // Meadow: the odd tuft, so open ground reads as grass without filling the cloth.
        const cx = x0 + 1.5 + rng() * (U - 3);
        const cy = y0 + 2 + rng() * (U - 3);
        shapes.push({ kind: 'line', points: [[cx - 1, cy - 1.6], [cx, cy], [cx + 1, cy - 1.6]], ink: 'accent', weight: 0.4 });
      }
    }
  }
  shapes.push(...edgeLines(model));
  if (roadCells.length > 0) shapes.push({ kind: 'counted', origin: [U / ROAD_STITCHES / 2, U / ROAD_STITCHES / 2], cell: U / ROAD_STITCHES, cells: roadCells });
  if (wallCells.length > 0) shapes.push({ kind: 'counted', origin: [U / ROAD_STITCHES / 2, U / ROAD_STITCHES / 2], cell: U / ROAD_STITCHES, cells: wallCells });
  return shapes;
}

/**
 * Stitched edges where terrain changes: a road becomes a couched band with a dark line down
 * each side, and water gets a bank line. Neighbouring segments are joined into runs so the
 * stitches flow along an edge instead of restarting at every cell.
 */
function edgeLines(model: SceneModel): Shape[] {
  const shapes: Shape[] = [];
  const kindAt = (x: number, y: number) => model.terrain[x]?.[y];
  const roadish = (t: Terrain | undefined) => t === 'road' || t === 'bridge';
  const waterish = (t: Terrain | undefined) => t === 'water' || t === 'bridge';
  const edges: Array<{ test: (t: Terrain | undefined) => boolean; ink: Ink; weight: number; inset: number }> = [
    { test: roadish, ink: 'dark', weight: 0.45, inset: 0.06 },
    { test: waterish, ink: 'secondary', weight: 0.55, inset: -0.04 },
  ];
  for (const edge of edges) {
    // Horizontal runs (top and bottom edges of cells), then vertical runs.
    for (const side of [-1, 1] as const) {
      for (let y = 0; y < model.height; y++) {
        let start = -1;
        for (let x = 0; x <= model.width; x++) {
          const on = x < model.width && edge.test(kindAt(x, y)) && !edge.test(kindAt(x, y + side));
          if (on && start < 0) start = x;
          if (!on && start >= 0) {
            const ey = (side < 0 ? y : y + 1) * U - side * edge.inset * U;
            shapes.push({ kind: 'line', points: [[start * U, ey], [x * U, ey]], ink: edge.ink, weight: edge.weight });
            start = -1;
          }
        }
      }
      for (let x = 0; x < model.width; x++) {
        let start = -1;
        for (let y = 0; y <= model.height; y++) {
          const on = y < model.height && edge.test(kindAt(x, y)) && !edge.test(kindAt(x + side, y));
          if (on && start < 0) start = y;
          if (!on && start >= 0) {
            const ex = (side < 0 ? x : x + 1) * U - side * edge.inset * U;
            shapes.push({ kind: 'line', points: [[ex, start * U], [ex, y * U]], ink: edge.ink, weight: edge.weight });
            start = -1;
          }
        }
      }
    }
  }
  return shapes;
}

/**
 * The cloth's own border: a double rule around the whole world with a band of the world's
 * pattern between, and a medallion at each corner, like the edge of a towel. A titled
 * world's top band is deeper and carries the place name in its middle, the band running
 * either side of it to a knot, like the heading of a sampler.
 */
function clothBorder(model: SceneModel, refs: PatternReference[]): Shape[] {
  const w = model.width * U;
  const h = model.height * U;
  const outer = U * 0.3;
  const inner = U * 0.95;
  const titled = Boolean(model.title);
  const innerTop = titled ? U * 1.55 : inner;
  const mid = (outer + inner) / 2;
  const midTop = (outer + innerTop) / 2;
  const shapes: Shape[] = [
    { kind: 'line', points: [[outer, outer], [w - outer, outer], [w - outer, h - outer], [outer, h - outer]], ink: 'dark', weight: 0.6, closed: true },
    { kind: 'line', points: [[inner, innerTop], [w - inner, innerTop], [w - inner, h - inner], [inner, h - inner]], ink: 'dark', weight: 0.45, closed: true },
  ];
  const seed = seedOf(model.title ?? 'cloth');
  const bandH = 7;
  const cell = ((inner - outer) * 0.86) / bandH;
  const band = (length: number) => worldBand(seed, refs, length / cell, bandH);
  const span = w - inner * 2;
  if (titled) {
    // The name, sized to the deep top band, and the band broken round it.
    const titleCell = ((innerTop - outer) * 0.62) / 7;
    const name = lettering(model.title!, { cell: titleCell, ink: 'primary', align: 'centre' });
    const nameW = letteringWidth(model.title!, titleCell) + titleCell * 8;
    shapes.push(...place(name, { dx: w / 2, dy: midTop - 3.5 * titleCell }));
    const side = (span - nameW) / 2;
    if (side > cell * 4) {
      for (const dir of [-1, 1]) {
        const cx = w / 2 + dir * (nameW / 2 + side / 2);
        shapes.push(...place([motifShape(band(side - cell * 3), cell)], { dx: cx, dy: midTop }));
        shapes.push({ kind: 'knot', at: [w / 2 + dir * (nameW / 2 - titleCell * 1.5), midTop], r: titleCell * 0.9, ink: 'gold' });
      }
    }
  } else {
    shapes.push(...place([motifShape(band(span), cell)], { dx: w / 2, dy: mid }));
  }
  shapes.push(...place([motifShape(band(span), cell)], { dx: w / 2, dy: h - mid }));
  const down = transposed(worldBand(seed, refs, (h - inner - innerTop) / cell, bandH));
  shapes.push(...place([motifShape(down, cell)], { dx: mid, dy: (innerTop + h - inner) / 2 }));
  shapes.push(...place([motifShape(down, cell)], { dx: w - mid, dy: (innerTop + h - inner) / 2 }));
  const corner = worldMedallion(seed + 3, refs, 3);
  const cornerCell = ((inner - outer) * 1.1) / Math.max(corner.w, corner.h);
  for (const [cx, cy] of [[mid, midTop], [w - mid, midTop], [w - mid, h - mid], [mid, h - mid]] as const) {
    shapes.push(...place([motifShape(corner, cornerCell)], { dx: cx, dy: cy }));
  }
  return shapes;
}

const BAND_GRAMMARS = new Set(['chevron', 'meander']);

/**
 * Patterns laid with the brush, in the same stitch count as stitched houses. A stroke
 * stamps motifs along its path (two variants alternating, as a border does), or, for a
 * band pattern, lays pieces of the band along it, upright or across as the path turns. A
 * fill lays a half-drop lattice of motifs over its cells, alternating like a quilt.
 */
function patternMarkShapes(marks: readonly PatternMark[], refs: PatternReference[]): Shape[] {
  const cell = U / STITCHES_PER_CELL;
  const grown = new Map<string, MotifGrid>();
  const medallion = (seed: number, own: PatternReference[], radius: number) => {
    const key = `m:${seed}:${radius}:${own.map((r) => r.id).join(',')}`;
    if (!grown.has(key)) grown.set(key, worldMedallion(seed, own, radius));
    return grown.get(key)!;
  };
  const shapes: Shape[] = [];
  for (const mark of marks) {
    const own = mark.ref ? worldReferences([mark.ref]) : refs;
    const isBand = own.length === 1 && BAND_GRAMMARS.has(own[0].grammar);
    const seed = seedOf(mark.id);
    // A motif fits its size: 2r + 1 stitches across at most size × stitches-per-cell.
    const radius = Math.max(2, Math.min(14, Math.floor((mark.size * STITCHES_PER_CELL - 1) / 2)));
    const step = Math.max(0.5, mark.size * mark.spacing);
    const stamp = (x: number, y: number, k: number) => shapes.push(...place([motifShape(medallion(seed + (k % 2), own, radius), cell)], { dx: x * U, dy: y * U }));
    if (mark.mode === 'fill') {
      const sp = Math.max(1, Math.ceil(step - 0.01));
      const cells = new Set(mark.points.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of mark.points) {
        const col = Math.floor(x / sp);
        const drop = col % 2 ? Math.floor(sp / 2) : 0;
        if (x % sp !== 0 || (y - drop) % sp !== 0) continue;
        if (!cells.has(`${x},${y}`)) continue;
        stamp(x + 0.5, y + 0.5, col + Math.floor((y - drop) / sp));
      }
      continue;
    }
    // A stroke: walk the path, a motif (or a piece of band) every `step` cells.
    const pts = mark.points;
    let carry = 0;
    let k = 0;
    if (pts.length === 1) stamp(pts[0][0], pts[0][1], 0);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      for (let t = carry; t <= len; t += step) {
        const x = ax + ((bx - ax) * t) / (len || 1);
        const y = ay + ((by - ay) * t) / (len || 1);
        if (isBand) {
          const across = Math.abs(bx - ax) >= Math.abs(by - ay);
          const piece = worldBand(seed, own, Math.round(step * STITCHES_PER_CELL), Math.max(3, Math.min(9, radius)));
          shapes.push(...place([motifShape(across ? piece : transposed(piece), cell)], { dx: x * U, dy: y * U }));
        } else {
          stamp(x, y, k);
        }
        k++;
        carry = t + step - len;
      }
      if (len < carry) carry -= len;
    }
  }
  return shapes;
}

const packedCache = new WeakMap<SceneModel, Map<SceneFeature, number>>();

/**
 * Packed layout, as in counted work: nothing on a layer touches another thing on that
 * layer. Each feature's real drawn bounds are measured; features are placed in turn (what
 * a world or a hand placed before ambient detail, then front to back), each shrinking a
 * little if it would touch what is already there. Ambient detail that still does not fit
 * is left out; placed things are always kept. Returns each feature's scale (0: left out).
 */
function packedScales(features: SceneFeature[], refs: PatternReference[], model: SceneModel): Map<SceneFeature, number> {
  const hit = packedCache.get(model);
  if (hit && features.every((f) => hit.has(f))) return hit;
  const out = hit ?? new Map<SceneFeature, number>();
  const gap = U * 0.12;
  const kept = new Map<SceneLayer, Array<[number, number, number, number]>>();
  const order = [...model.features].sort((a, b) => {
    const amb = Number(Boolean(a.id?.startsWith('amb-'))) - Number(Boolean(b.id?.startsWith('amb-')));
    return amb || a.y + a.h - (b.y + b.h) || a.x - b.x;
  });
  for (const f of order) {
    const b = bounds(turnedFeatureShapes(f, refs, model));
    if (!Number.isFinite(b.minX)) {
      out.set(f, 1);
      continue;
    }
    const footX = (f.x + f.w / 2) * U;
    const footY = (f.y + f.h) * U;
    const layer = layerOf(f);
    const boxes = kept.get(layer) ?? [];
    let chosen = 0;
    let box: [number, number, number, number] = [0, 0, 0, 0];
    for (const s of [1, 0.85, 0.72]) {
      box = [footX + (b.minX - footX) * s, footY + (b.minY - footY) * s, footX + (b.maxX - footX) * s, footY + (b.maxY - footY) * s];
      const clear = boxes.every(([x0, y0, x1, y1]) => box[2] + gap <= x0 || box[0] - gap >= x1 || box[3] + gap <= y0 || box[1] - gap >= y1);
      if (clear) {
        chosen = s;
        break;
      }
    }
    if (!chosen && !f.id?.startsWith('amb-')) chosen = 0.72;
    out.set(f, chosen);
    if (chosen) {
      boxes.push(box);
      kept.set(layer, boxes);
    }
  }
  packedCache.set(model, out);
  return out;
}

function packedFeatureShapes(features: SceneFeature[], refs: PatternReference[], model: SceneModel): Shape[][] {
  const scales = packedScales(features, refs, model);
  return features.map((f) => {
    const s = scales.get(f) ?? 1;
    if (s === 0) return [];
    const shapes = turnedFeatureShapes(f, refs, model);
    if (s === 1) return shapes;
    const footX = (f.x + f.w / 2) * U;
    const footY = (f.y + f.h) * U;
    return place(place(shapes, { dx: -footX, dy: -footY }), { dx: footX, dy: footY, scale: s });
  });
}

/**
 * The order features are drawn in: flat things first, layer by layer, then everything that
 * stands up, front to back by where it stands (layer order breaks ties).
 */
export function drawOrder(features: readonly SceneFeature[]): SceneFeature[] {
  const rank = (f: SceneFeature) => SCENE_LAYERS.findIndex((l) => l.id === layerOf(f));
  const flat = features.filter((f) => FLAT_KINDS.has(f.kind)).sort((a, b) => rank(a) - rank(b) || a.y + a.h - (b.y + b.h));
  const upright = features.filter((f) => !FLAT_KINDS.has(f.kind)).sort((a, b) => a.y + a.h - (b.y + b.h) || rank(a) - rank(b));
  return [...flat, ...upright];
}

/** A textile world's ground: the counted cloth, and the place name lettered into it. */
function textileShapes(model: SceneModel): Shape[] {
  const { cells, stitchesPerCell, offset, title } = model.textile!;
  const s = U / stitchesPerCell;
  const worked: Array<[number, number, Ink]> = [];
  cells.forEach((row, y) => row.forEach((ink, x) => ink && worked.push([x + offset[0], y + offset[1], ink])));
  const shapes: Shape[] = [{ kind: 'counted', origin: [s / 2, s / 2], cell: s, cells: worked }];
  if (model.title) {
    const name = lettering(model.title.toUpperCase(), { cell: s, ink: 'primary', align: 'centre' });
    shapes.push(...place(name, { dx: (title.cx + offset[0] + 0.5) * s, dy: (title.y + offset[1] + 0.5) * s }));
  }
  return shapes;
}

/** Everything that does not move, in drawing order; `hidden` layers are left out. */
export function sceneShapes(model: SceneModel, hidden?: ReadonlySet<SceneLayer>, frame = true): Shape[] {
  const refs = worldReferences(model.motifs);
  const ground = model.patches ? patchworkShapes(model, U, hidden) : hidden?.has('ground') ? [] : model.textile ? textileShapes(model) : terrainShapes(model);
  const features = drawOrder(hidden?.size ? model.features.filter((f) => !hidden.has(layerOf(f))) : model.features);
  const marks = hidden?.has('patterns') ? [] : patternMarkShapes(model.patternMarks ?? [], refs);
  const drawn = model.packing === 'packed' ? packedFeatureShapes(features, refs, model) : features.map((f) => turnedFeatureShapes(f, refs, model));
  // A textile world carries its own frame and name in the cloth.
  const shapes = [...ground, ...marks, ...drawn.flat(), ...(frame && !model.textile ? clothBorder(model, refs) : [])];

  return shapes;
}
