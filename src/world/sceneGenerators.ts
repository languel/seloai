/**
 * World generators: each turns typed parameters and a seed into a place. The parameter
 * schema is plain data, so the world editor builds its controls from it and agents read the
 * same schema through the tool API.
 */
import { buildSceneModel, semanticsFromTable, type SceneFeature, type SceneModel, type Terrain } from '../art/scene';
import { generateWangScene, CHUNK } from '../art/wangWorld';
import { createSeededRng, type Rng } from '../core/rng';
import { createBalkanMythMap } from '../data/balkanMythMap';
import { createBulgarianShevitsaMap } from '../data/shevitsaMap';
import type { PointOfInterest, SpawnPoint, VillageMap } from '../engine/types';
import { generatePatchworkVillage } from './patchworkVillage';
import { generateTextileVillage } from './textileVillage';

export type SceneParamValue = number | boolean | string;
export type SceneParams = Record<string, SceneParamValue>;

export type SceneParamSpec =
  | { key: string; label: string; hint?: string; type: 'int' | 'float'; min: number; max: number; step?: number; default: number }
  | { key: string; label: string; hint?: string; type: 'bool'; default: boolean }
  | { key: string; label: string; hint?: string; type: 'enum'; options: readonly string[]; default: string };

/** What a generator makes: the place, where people start, and (optionally) its own walkability. */
export interface GeneratedWorld {
  model: SceneModel;
  spawns: SpawnPoint[];
  /** Authored walkability, for worlds that came from a tile map with its own collision. */
  blocked?: boolean[][];
}

export interface SceneGenerator {
  id: string;
  name: string;
  description: string;
  params: readonly SceneParamSpec[];
  /** Fills in defaults and clamps every value into its range. */
  resolveParams(params: SceneParams | undefined): SceneParams;
  generate(params: SceneParams, seed: number): GeneratedWorld;
}

function resolver(specs: readonly SceneParamSpec[]) {
  return (params: SceneParams | undefined): SceneParams => {
    const out: SceneParams = {};
    for (const spec of specs) {
      const raw = params?.[spec.key];
      if (spec.type === 'bool') out[spec.key] = typeof raw === 'boolean' ? raw : spec.default;
      else if (spec.type === 'enum') out[spec.key] = typeof raw === 'string' && spec.options.includes(raw) ? raw : spec.default;
      else {
        const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.default;
        const clamped = Math.max(spec.min, Math.min(spec.max, n));
        out[spec.key] = spec.type === 'int' ? Math.round(clamped) : clamped;
      }
    }
    return out;
  };
}

/** Names every feature by kind and position, so hand edits can refer to it. */
function named(features: SceneFeature[]): SceneFeature[] {
  return features.map((f) => ({ ...f, id: f.id ?? `${f.kind}-${f.x}-${f.y}` }));
}

// Village names after trees and stones, the way many Balkan villages are named.
const VILLAGE_NAMES = ['Brezovo', 'Lipnitsa', 'Dabovo', 'Kamenitsa', 'Yasenovo', 'Topolka', 'Glogovo', 'Vrabevo', 'Orehovo', 'Trnovo', 'Javorets', 'Borovo'];
const WOOD_NAMES = ['the Beech Wood', 'the Black Pines', 'the Oak Hollow', 'the Hazel Thicket', 'the Old Forest'];
const BRIDGE_NAMES = ['the Oak Bridge', 'the Mill Bridge', 'the Stone Bridge', 'the Willow Crossing'];

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function tagOf(label: string) {
  return label
    .replace(/^the /i, '')
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

/**
 * Joins every sizeable piece of land to the largest one with the shortest bridge across the
 * water, so a river never cuts the valley in two (the planned road can run along a river
 * edge and miss its crossing).
 */
function bridgeRegions(model: SceneModel) {
  const { width: w, height: h, terrain } = model;
  const open = (x: number, y: number) => terrain[x][y] !== 'water' && terrain[x][y] !== 'wall';
  for (let round = 0; round < 12; round++) {
    const region = new Int32Array(w * h).fill(-1);
    const sizes: number[] = [];
    for (let sx = 0; sx < w; sx++) {
      for (let sy = 0; sy < h; sy++) {
        if (!open(sx, sy) || region[sx * h + sy] >= 0) continue;
        const id = sizes.length;
        const stack = [[sx, sy]];
        region[sx * h + sy] = id;
        let size = 0;
        while (stack.length) {
          const [x, y] = stack.pop()!;
          size++;
          for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !open(nx, ny) || region[nx * h + ny] >= 0) continue;
            region[nx * h + ny] = id;
            stack.push([nx, ny]);
          }
        }
        sizes.push(size);
      }
    }
    const main = sizes.indexOf(Math.max(...sizes));
    if (!sizes.some((size, id) => id !== main && size >= 12)) return;
    // Breadth-first from the main region across water only, to the nearest other big region.
    const prev = new Int32Array(w * h).fill(-2);
    const queue: number[] = [];
    for (let i = 0; i < w * h; i++) if (region[i] === main) { prev[i] = -1; queue.push(i); }
    let found = -1;
    for (let q = 0; q < queue.length && found < 0; q++) {
      const i = queue[q];
      const x = Math.floor(i / h);
      const y = i % h;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        const j = nx * h + ny;
        if (prev[j] !== -2) continue;
        if (region[j] >= 0 && region[j] !== main && sizes[region[j]] >= 12) { prev[j] = i; found = j; break; }
        if (terrain[nx][ny] === 'water') { prev[j] = i; queue.push(j); }
      }
    }
    if (found < 0) return;
    for (let i = prev[found]; i >= 0 && region[i] !== main; i = prev[i]) terrain[Math.floor(i / h)][i % h] = 'bridge';
  }
}

/** Names the places a Wang valley grew: its hamlets' gathering places, its bridges, its wood. */
function valleyLandmarks(model: SceneModel, seed: number): PointOfInterest[] {
  const rng = createSeededRng(seed * 977 + 13);
  const villages = shuffled(VILLAGE_NAMES, rng);
  const landmarks: PointOfInterest[] = [];
  const add = (label: string, x: number, y: number, description: string) => {
    const tag = tagOf(label);
    if (landmarks.some((l) => l.tag === tag)) return;
    landmarks.push({ id: `poi-${tag.toLowerCase()}`, tag, label, x, y, description });
  };
  const centres = model.features.filter((f) => f.kind === 'well' || f.kind === 'hearth' || f.kind === 'star');
  // Hamlets: chunks with two or more houses. Each gets a name; its gathering place, if it
  // has one, is named after it, and otherwise its lane is the place people meet.
  // Neighbouring chunks of houses are one hamlet, centred on its middle chunk.
  const housed = new Map<string, SceneFeature[]>();
  for (let cx = 0; cx < model.width; cx += CHUNK) {
    for (let cy = 0; cy < model.height; cy += CHUNK) {
      const houses = model.features.filter((f) => f.kind === 'house' && f.x >= cx && f.x < cx + CHUNK && f.y >= cy && f.y < cy + CHUNK);
      if (houses.length >= 2) housed.set(`${cx},${cy}`, houses);
    }
  }
  const hamlets: Array<{ cx: number; cy: number; houses: SceneFeature[] }> = [];
  const visited = new Set<string>();
  for (const start of housed.keys()) {
    if (visited.has(start)) continue;
    const group = [start];
    visited.add(start);
    for (let i = 0; i < group.length; i++) {
      const [x, y] = group[i].split(',').map(Number);
      for (const k of [`${x + CHUNK},${y}`, `${x - CHUNK},${y}`, `${x},${y + CHUNK}`, `${x},${y - CHUNK}`]) {
        if (housed.has(k) && !visited.has(k)) {
          visited.add(k);
          group.push(k);
        }
      }
    }
    const [cx, cy] = group[Math.floor(group.length / 2)].split(',').map(Number);
    hamlets.push({ cx, cy, houses: group.flatMap((k) => housed.get(k)!) });
  }
  const villageAt = (x: number, y: number) => {
    let best = -1;
    let dist = Infinity;
    hamlets.forEach((hm, i) => {
      const d = Math.hypot(hm.cx + CHUNK / 2 - x, hm.cy + CHUNK / 2 - y);
      if (d < dist) { dist = d; best = i; }
    });
    return best >= 0 && dist < CHUNK * 1.5 ? best : -1;
  };
  const named = new Set<number>();
  centres.forEach((f, i) => {
    const near = villageAt(f.x, f.y);
    if (near >= 0) named.add(near);
    const village = villages[(near >= 0 ? near : hamlets.length + i) % villages.length];
    const where = { well: 'well', hearth: 'hearth', star: 'dancing ground' }[f.kind as 'well' | 'hearth' | 'star'];
    const what = {
      well: 'Where the hamlet draws its water and trades its news.',
      hearth: 'A shared fire where the hamlet gathers at dusk.',
      star: 'Beaten earth where the khoro is danced on feast days.',
    }[f.kind as 'well' | 'hearth' | 'star'];
    add(`${village} ${where}`, f.x + Math.floor(f.w / 2), f.y + f.h, what);
  });
  hamlets.forEach((hm, i) => {
    if (named.has(i)) return;
    // The road cell nearest the middle of the hamlet, or its middle.
    let spot: [number, number] = [hm.cx + CHUNK / 2, hm.cy + CHUNK / 2];
    let dist = Infinity;
    for (let x = hm.cx; x < hm.cx + CHUNK; x++) {
      for (let y = hm.cy; y < hm.cy + CHUNK; y++) {
        const d = Math.hypot(x - spot[0], y - spot[1]);
        if (model.terrain[x]?.[y] === 'road' && d < dist) { dist = d; spot = [x, y]; }
      }
    }
    add(villages[i % villages.length], Math.round(spot[0]), Math.round(spot[1]), `A hamlet of ${hm.houses.length} houses along the lane.`);
  });
  // One landmark per run of bridge cells.
  const seen = new Set<number>();
  const bridgeNames = shuffled(BRIDGE_NAMES, rng).slice(0, 2);
  let bridges = 0;
  for (let x = 0; x < model.width && bridges < bridgeNames.length; x++) {
    for (let y = 0; y < model.height && bridges < bridgeNames.length; y++) {
      if (model.terrain[x][y] !== 'bridge' || seen.has(x * 1000 + y)) continue;
      const run = [[x, y]];
      seen.add(x * 1000 + y);
      for (let i = 0; i < run.length; i++) {
        const [cx, cy] = run[i];
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (model.terrain[nx]?.[ny] === 'bridge' && !seen.has(nx * 1000 + ny)) {
            seen.add(nx * 1000 + ny);
            run.push([nx, ny]);
          }
        }
      }
      const [mx, my] = run[Math.floor(run.length / 2)];
      add(bridgeNames[bridges++], mx, my, 'Where the road crosses the river.');
    }
  }
  // The densest stand of trees, if there is a real wood.
  let best = { count: 0, x: 0, y: 0 };
  for (let cx = 0; cx < model.width; cx += CHUNK) {
    for (let cy = 0; cy < model.height; cy += CHUNK) {
      const trees = model.features.filter((f) => (f.kind === 'tree' || f.kind === 'pine') && f.x >= cx && f.x < cx + CHUNK && f.y >= cy && f.y < cy + CHUNK);
      if (trees.length > best.count) best = { count: trees.length, x: cx + CHUNK / 2, y: cy + CHUNK / 2 };
    }
  }
  if (best.count >= 4) add(WOOD_NAMES[Math.floor(rng() * WOOD_NAMES.length)], best.x, best.y, 'Deep shade, old paths, and things that watch from the trees.');
  return landmarks;
}

const VALLEY_PARAMS: readonly SceneParamSpec[] = [
  { key: 'width', label: 'Width', hint: 'Across, in chunks of six cells', type: 'int', min: 3, max: 14, default: 8 },
  { key: 'height', label: 'Height', hint: 'Down, in chunks of six cells', type: 'int', min: 3, max: 10, default: 6 },
  { key: 'hamlets', label: 'Hamlets', hint: 'How many hamlets the roads link', type: 'int', min: 1, max: 6, default: 3 },
  { key: 'river', label: 'River', hint: 'A river crossing the valley from top to bottom', type: 'bool', default: true },
];

export const wangValley: SceneGenerator = {
  id: 'wang-valley',
  name: 'Valley',
  description: 'A valley of hamlets joined by roads, with a winding river and woods, built from edge-matched chunks.',
  params: VALLEY_PARAMS,
  resolveParams: resolver(VALLEY_PARAMS),
  generate(params, seed) {
    const cols = params.width as number;
    const rows = params.height as number;
    const rng = createSeededRng(seed * 131 + 5);
    const river = params.river as boolean;
    const riverIn = river ? Math.floor(rng() * cols) : undefined;
    const riverOut = river ? Math.floor(rng() * cols) : undefined;
    const raw = generateWangScene({ cols, rows, seed, riverIn, riverOut, hamlets: params.hamlets as number });
    const model = { ...raw, terrain: raw.terrain.map((col) => [...col]), features: named(raw.features) };
    bridgeRegions(model);
    const landmarks = valleyLandmarks(model, seed);
    // The valley takes the name of its first hamlet.
    const village = landmarks.map((l) => l.label.split(' ')[0]).find((w) => VILLAGE_NAMES.includes(w)) ?? 'Selo';
    return {
      model: { ...model, landmarks, title: `${village} valley` },
      spawns: landmarks.map((l) => ({ id: `spawn-${l.id}`, label: l.label, x: l.x, y: l.y })),
    };
  },
};

const PATCHWORK_PARAMS: readonly SceneParamSpec[] = [
  { key: 'rings', label: 'Size', hint: 'How far the village spreads from its square', type: 'int', min: 2, max: 6, default: 3 },
  { key: 'side', label: 'Plot size', hint: 'Larger plots, fewer of them', type: 'int', min: 6, max: 22, default: 14 },
  { key: 'houses', label: 'Houses', hint: 'How built-up the village is', type: 'float', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'stream', label: 'Stream', hint: 'A stream across the village', type: 'bool', default: true },
];

export const patchworkVillage: SceneGenerator = {
  id: 'patchwork',
  name: 'Patchwork village',
  description: 'A village cut from an irregular quad grid and filled like a Klee patchwork: houses along roads round a square, gardens, fields, orchards and a stream.',
  params: PATCHWORK_PARAMS,
  resolveParams: resolver(PATCHWORK_PARAMS),
  generate(params, seed) {
    return generatePatchworkVillage({
      rings: params.rings as number,
      side: params.side as number,
      houses: params.houses as number,
      stream: params.stream as boolean,
      seed,
    });
  },
};

/** A bundled tile map read through its meanings, keeping its own walkability and places. */
function fromTileMap(map: VillageMap): GeneratedWorld {
  const model = buildSceneModel(map, map.tileMeanings ? semanticsFromTable(map.tileMeanings) : undefined);
  return {
    model: { ...model, features: named(model.features) },
    spawns: map.spawnPoints.map((s) => ({ ...s })),
    blocked: map.collisionGrid.map((col) => [...col]),
  };
}

const TEXTILE_PARAMS: readonly SceneParamSpec[] = [
  { key: 'layout', label: 'Layout', hint: 'A carpet (a frame round a central medallion) or a sampler (registers from sky to hem)', type: 'enum', options: ['carpet', 'sampler'], default: 'carpet' },
  { key: 'households', label: 'Households', hint: 'How many houses the cloth holds', type: 'int', min: 2, max: 6, default: 4 },
  { key: 'orchard', label: 'Orchard', hint: 'Trees on the far bank', type: 'int', min: 1, max: 6, default: 3 },
  { key: 'fields', label: 'Fields', hint: 'Ears of wheat', type: 'int', min: 2, max: 8, default: 4 },
  { key: 'river', label: 'River', hint: 'A water band with a plank bridge', type: 'bool', default: true },
  { key: 'stitches', label: 'Pattern scale', hint: 'Stitches to one step of a person: fewer makes every ornament larger against the people, more makes the work finer', type: 'int', min: 2, max: 8, default: 4 },
];

export const textileVillage: SceneGenerator = {
  id: 'textile',
  name: 'Textile village',
  description: 'A village laid out as a piece of counted needlework, written in signs: houses, the square, water, trees and wheat on one thread grid, with most of the cloth left bare.',
  params: TEXTILE_PARAMS,
  resolveParams: resolver(TEXTILE_PARAMS),
  generate(params, seed) {
    const rng = createSeededRng(seed * 977 + 3);
    return generateTextileVillage({
      layout: params.layout as 'carpet' | 'sampler',
      name: VILLAGE_NAMES[Math.floor(rng() * VILLAGE_NAMES.length)],
      households: params.households as number,
      orchard: params.orchard as number,
      fields: params.fields as number,
      river: params.river as boolean,
      stitchesPerCell: params.stitches as number,
      seed,
    });
  },
};

export const zmeyovoWorld: SceneGenerator = {
  id: 'zmeyovo',
  name: 'Zmeyovo',
  description: 'The village of the Lamia’s well, as authored.',
  params: [],
  resolveParams: resolver([]),
  generate: () => fromTileMap(createBalkanMythMap()),
};

export const shevitsaWorld: SceneGenerator = {
  id: 'shevitsa',
  name: 'Shevitsa',
  description: 'Bulgaria as a regional embroidery chart, as authored.',
  params: [],
  resolveParams: resolver([]),
  generate: () => fromTileMap(createBulgarianShevitsaMap()),
};

const BLANK_PARAMS: readonly SceneParamSpec[] = [
  { key: 'width', label: 'Width', hint: 'Cells across', type: 'int', min: 16, max: 160, default: 48 },
  { key: 'height', label: 'Height', hint: 'Cells down', type: 'int', min: 12, max: 140, default: 36 },
];

/** An empty cloth to build on by hand: open ground, one start point in the middle, nothing else. */
export const blankCloth: SceneGenerator = {
  id: 'blank',
  name: 'Blank cloth',
  description: 'An empty cloth of the size you choose, to build a world on by hand.',
  params: BLANK_PARAMS,
  resolveParams: resolver(BLANK_PARAMS),
  generate(params) {
    const width = params.width as number;
    const height = params.height as number;
    const terrain: Terrain[][] = Array.from({ length: width }, () => Array<Terrain>(height).fill('ground'));
    const model: SceneModel = { width, height, terrain, features: [], landmarks: [], title: 'A blank cloth' };
    return { model, spawns: [{ id: 'spawn-start', label: 'Start', x: Math.floor(width / 2), y: Math.floor(height / 2) }] };
  },
};

export const SCENE_GENERATORS: readonly SceneGenerator[] = [blankCloth, wangValley, patchworkVillage, textileVillage, zmeyovoWorld, shevitsaWorld];

export function findGenerator(id: string): SceneGenerator | undefined {
  return SCENE_GENERATORS.find((g) => g.id === id);
}

/** Freezes any tile map as a scene base, for worlds no generator can rebuild. */
export function generatedFromTileMap(map: VillageMap): GeneratedWorld {
  return fromTileMap(map);
}
