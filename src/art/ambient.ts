/**
 * Ambient density: the life a maker adds around the named places so that open cloth does
 * not read as empty. Groves thin out from a few centres, houses get yards with a fence, a
 * haystack and sunflowers, open ground near a village becomes strip fields, water gets
 * reeds and ducks, and the meadow carries a faint all-over pattern.
 *
 * Everything here is decoration added to a SceneModel after the world's own features are
 * placed: it only uses free open ground, never moves what a world placed, never touches
 * walkability, and is decided by the map's seed so it never changes between redraws.
 */
import { createSeededRng, hashString, type Rng } from '../core/rng';

/**
 * A stable random stream for one place: decisions about a spot depend only on the seed and
 * that spot, so an edit elsewhere on the map never reshuffles this one.
 */
function spotRng(seed: number, x: number, y: number, salt: number): Rng {
  return createSeededRng((seed ^ (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) >>> 0);
}
import type { SceneFeature, SceneModel } from './scene';

type Cell = [number, number];

function key(x: number, y: number) {
  return x * 100003 + y;
}

/** Cells taken by terrain other than open ground, by placed features, or near a landmark. */
function occupancy(model: SceneModel): Set<number> {
  const taken = new Set<number>();
  for (let x = 0; x < model.width; x++) {
    for (let y = 0; y < model.height; y++) {
      if (model.terrain[x][y] !== 'ground') taken.add(key(x, y));
    }
  }
  for (const f of model.features) {
    for (let x = f.x - 1; x <= f.x + f.w; x++) for (let y = f.y - 1; y <= f.y + f.h; y++) taken.add(key(x, y));
  }
  for (const poi of model.landmarks) {
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) taken.add(key(Math.round(poi.x) + dx, Math.round(poi.y) + dy));
  }
  return taken;
}

function nearTerrain(model: SceneModel, x: number, y: number, kind: string, radius = 1): boolean {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (model.terrain[x + dx]?.[y + dy] === kind) return true;
    }
  }
  return false;
}

function free(model: SceneModel, taken: Set<number>, x: number, y: number, w = 1, h = 1): boolean {
  if (x < 1 || y < 2 || x + w > model.width - 1 || y + h > model.height - 1) return false;
  for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) if (taken.has(key(i, j))) return false;
  return true;
}

function claim(taken: Set<number>, x: number, y: number, w = 1, h = 1) {
  for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) taken.add(key(i, j));
}

function feature(kind: SceneFeature['kind'], x: number, y: number, w = 1, h = 1): SceneFeature {
  return { id: `amb-${kind}-${x}-${y}`, kind, x, y, w, h, seed: hashString(`${kind}:${x}:${y}`) };
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Yards in front of each house: a fence, a haystack or woodpile, sunflowers, a hen. */
function yards(model: SceneModel, taken: Set<number>, seed: number, out: SceneFeature[]) {
  for (const house of model.features.filter((f) => f.kind === 'house')) {
    const rng = spotRng(seed, house.x, house.y, 1);
    // A yard goes in front of the house if there is room, else beside it or behind it.
    const options: Array<[number, number, number, number]> = [
      [house.x - 1, house.y + house.h, house.w + 2, 2],
      [house.x + house.w, house.y, 3, house.h],
      [house.x - 3, house.y, 3, house.h],
      [house.x - 1, house.y - 2, house.w + 2, 2],
    ];
    const isOpen = ([yx, yy, yw, yh]: [number, number, number, number]) => {
      if (yx < 1 || yy < 2 || yx + yw > model.width - 1 || yy + yh > model.height - 1) return false;
      for (let i = yx; i < yx + yw; i++) {
        for (let j = yy; j < yy + yh; j++) {
          if (model.terrain[i]?.[j] !== 'ground') return false;
          if (model.features.some((f) => f !== house && i >= f.x - 1 && i <= f.x + f.w && j >= f.y - 1 && j <= f.y + f.h)) return false;
          if (out.some((f) => i >= f.x && i < f.x + f.w && j >= f.y && j < f.y + f.h)) return false;
        }
      }
      return true;
    };
    const spot = options.find(isOpen);
    if (!spot) continue;
    const [yx, yy, yw, yh] = spot;
    out.push(feature('fence', yx, yy, yw, yh));
    const inside: Cell[] = [];
    for (let i = yx + 1; i < yx + yw - 1; i++) for (let j = yy; j < yy + yh; j++) inside.push([i, j]);
    const spots = shuffle(inside, rng);
    if (spots[0]) out.push(feature(rng() < 0.6 ? 'haystack' : 'woodpile', spots[0][0], spots[0][1]));
    if (spots[1]) out.push(feature('sunflower', spots[1][0], spots[1][1]));
    if (spots[2] && rng() < 0.7) out.push(feature('hen', spots[2][0], spots[2][1]));
    claim(taken, yx - 1, yy - 1, yw + 2, yh + 2);
  }
}

/** Groves: trees around a few centres, thinning with distance, never crowding a path. */
function groves(model: SceneModel, taken: Set<number>, seed: number, out: SceneFeature[]) {
  // Grove centres sit on a coarse lattice, each lattice cell deciding for itself whether it
  // holds one, so the groves stay put when the map is edited elsewhere.
  const LATTICE = 9;
  const centres: Cell[] = [];
  for (let gx = 0; gx < model.width; gx += LATTICE) {
    for (let gy = 0; gy < model.height; gy += LATTICE) {
      const r = spotRng(seed, gx, gy, 2);
      if (r() > 0.55) continue;
      const cx = gx + Math.floor(r() * LATTICE);
      const cy = gy + Math.floor(r() * LATTICE);
      if (cx < 2 || cy < 3 || cx >= model.width - 2 || cy >= model.height - 2) continue;
      if (free(model, taken, cx, cy, 1, 2) && !nearTerrain(model, cx, cy, 'road', 2)) centres.push([cx, cy]);
    }
  }
  for (const [cx, cy] of centres) {
    const rng = spotRng(seed, cx, cy, 3);
    const radius = 2.2 + rng() * 2.3;
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        if (d > 1 || rng() > 0.85 * (1 - d * d * 0.8)) continue;
        if (!free(model, taken, x, y, 1, 2) || nearTerrain(model, x, y, 'road', 1)) continue;
        out.push(feature(rng() < 0.4 ? 'sapling' : 'grove', x, y, 1, 2));
        claim(taken, x, y, 1, 2);
      }
    }
  }
}

/** Strip fields: a block of open ground near the houses, worked in parallel rows. */
function fields(model: SceneModel, taken: Set<number>, seed: number, out: SceneFeature[]) {
  const houses = model.features.filter((f) => f.kind === 'house');
  const anchors = houses.length > 0 ? houses : model.landmarks.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), w: 1, h: 1 }));
  let made = 0;
  // The anchors in an order fixed by their own positions, not by how many there are.
  const ordered = [...anchors].sort((a, b) => spotRng(seed, a.x, a.y, 4)() - spotRng(seed, b.x, b.y, 4)());
  for (const anchor of ordered) {
    if (made >= 2) break;
    const rng = spotRng(seed, anchor.x, anchor.y, 5);
    for (let attempt = 0; attempt < 24 && made < 2; attempt++) {
      const w = 3 + Math.floor(rng() * 3);
      const h = 2 + Math.floor(rng() * 2);
      const x = anchor.x + Math.round((rng() - 0.5) * 14);
      const y = anchor.y + Math.round((rng() - 0.5) * 10);
      if (!free(model, taken, x, y, w, h)) continue;
      out.push(feature(rng() < 0.65 ? 'field' : 'vineyard', x, y, w, h));
      claim(taken, x - 1, y - 1, w + 2, h + 2);
      made++;
      break;
    }
  }
}

/** Reeds on the banks, and the odd duck on the water. */
function waterLife(model: SceneModel, taken: Set<number>, seed: number, out: SceneFeature[]) {
  for (let x = 1; x < model.width - 1; x++) {
    for (let y = 2; y < model.height - 1; y++) {
      const rng = spotRng(seed, x, y, 6);
      const t = model.terrain[x][y];
      if (t === 'ground' && !taken.has(key(x, y)) && nearTerrain(model, x, y, 'water') && rng() < 0.28) {
        out.push(feature('reeds', x, y));
        claim(taken, x, y);
      } else if (t === 'water' && rng() < 0.025 && model.terrain[x + 1]?.[y] === 'water') {
        out.push(feature('duck', x, y));
      }
    }
  }
}

/** A sparse lattice of small rosettes over open meadow: the filling of an embroidered ground. */
function groundCover(model: SceneModel, taken: Set<number>, seed: number, out: SceneFeature[]) {
  for (let x = 1; x < model.width - 1; x++) {
    for (let y = 2; y < model.height - 1; y++) {
      // Every third cell on a diagonal lattice, so it reads as a pattern rather than noise.
      if ((x + y * 2) % 3 !== 0 || (x + y) % 2 !== 0) continue;
      if (taken.has(key(x, y)) || model.terrain[x][y] !== 'ground') continue;
      if (spotRng(seed, x, y, 7)() < 0.55) out.push(feature('rosette', x, y));
    }
  }
}

/**
 * Returns the model with ambient features added. Ambient features are drawn beneath the
 * world's own features so a house or a well always sits on top of its yard and meadow.
 */
export function withAmbience(model: SceneModel, seed: number): SceneModel {
  const s = (seed ^ 0x5eed) >>> 0;
  const taken = occupancy(model);
  const added: SceneFeature[] = [];
  yards(model, taken, s, added);
  fields(model, taken, s, added);
  groves(model, taken, s, added);
  waterLife(model, taken, s, added);
  groundCover(model, taken, s, added);
  const under = added.filter((f) => f.kind === 'rosette' || f.kind === 'field' || f.kind === 'vineyard' || f.kind === 'fence' || f.kind === 'reeds' || f.kind === 'duck');
  const among = added.filter((f) => !under.includes(f));
  const sorted = [...model.features, ...among].sort((a, b) => a.y + a.h - (b.y + b.h));
  return { ...model, features: [...under, ...sorted] };
}
