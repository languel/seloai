/**
 * Draws the running game through the art system: the world as one cached layer and each
 * character as a cached figure, in whichever look is selected.
 */
import { createSeededRng, hashString } from '../core/rng';
import type { VillageMap } from '../engine/types';
import { activeWorldThreadsId, clothPalette, paintLinenRegion, worldPalette, renderEmbroidery, renderLineArt, type LookOptions, type PaletteName } from './looks';
import { figureParts, type Expression, type FigureBuild, type FigureKind, type FigureParts, type FigureDetail, type FigureTraits, type FigureView } from './figures';
import { withAmbience } from './ambient';
import { bakeScene } from '../world/worldScene';
import { buildSceneModel, layerOf, semanticsFromTable, type SceneFeature, type SceneLayer, type TileSemantics } from './scene';
import { UNITS_PER_TILE, featureFoot, featureShapesOf, sceneShapes } from './sceneArt';
import { restitch } from './stitchStyles';
import { STITCHES_PER_CELL } from './stitchedHouse';
import { bounds, type Pt, type Shape } from './shapes';

/** 'tiles' is the original tileset renderer; every other value is a look of the art system. */
export type WorldLook = 'tiles' | PaletteName;

export const WORLD_LOOK_OPTIONS: ReadonlyArray<{ id: WorldLook; label: string; hint: string }> = [
  { id: 'ink', label: 'Line art', hint: 'Black ink on paper' },
  { id: 'night', label: 'Night plate', hint: 'White line on black' },
  { id: 'blackwork', label: 'Blackwork', hint: 'Black thread on linen' },
  { id: 'redBlack', label: 'Red and black', hint: 'The traditional two-thread register' },
  { id: 'festive', label: 'Festive', hint: 'Full embroidery palette' },
  { id: 'tiles', label: 'Classic tiles', hint: 'The original tileset renderer' },
];

export function isWorldLook(value: unknown): value is WorldLook {
  return WORLD_LOOK_OPTIONS.some((option) => option.id === value);
}

function isThread(look: PaletteName): boolean {
  return look !== 'ink' && look !== 'night';
}

/**
 * The static world, ready to be drawn at any sharpness: `drawRegion` draws part of it (in
 * the world's own pixels, `tileDim` to a cell) into a context that may be scaled up, so the
 * village can draw the cells in view at the zoom's own resolution instead of stretching one
 * image. Every shape keeps its own seed and the linen is drawn from positions, so a region
 * drawn alone matches its neighbours and the whole.
 */
export interface WorldArt {
  width: number;
  height: number;
  drawRegion(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void;
  /**
   * The living things, when asked for apart (reeds, flowers, sunflowers, wheat, hens, ducks):
   * each drawn once into its own sprite, to be swayed or moved each frame. Empty otherwise.
   */
  live: LiveSprite[];
  /** Water cells, for the river's drifting glints, and whether the water runs mostly down. */
  water: Array<[number, number]>;
  waterRunsDown: boolean;
  /** The light thread's colour, for glints on the water. */
  glint: string;
}

/** A living thing drawn apart from the still cloth. Positions in world pixels. */
export interface LiveSprite {
  kind: 'sway' | 'hen' | 'duck';
  /** How far it bends in a gust (radians at full gust). */
  bend: number;
  canvas: HTMLCanvasElement;
  /** Its foot, where it is pinned to the ground. */
  footX: number;
  footY: number;
  /** Where the foot sits in the sprite, and the sprite's size, in world pixels. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  seed: number;
}

/** Feature kinds drawn alive, and how far a gust bends each. */
const LIVE_KINDS: Partial<Record<SceneFeature['kind'], { kind: LiveSprite['kind']; bend: number }>> = {
  reeds: { kind: 'sway', bend: 0.2 },
  flowers: { kind: 'sway', bend: 0.13 },
  wheat: { kind: 'sway', bend: 0.08 },
  sunflower: { kind: 'sway', bend: 0.06 },
  hen: { kind: 'hen', bend: 0 },
  duck: { kind: 'duck', bend: 0 },
};
/** Live sprites are drawn this many times sharper than the world, so they hold up when zoomed. */
const LIVE_SCALE = 3;

interface PreparedShape {
  shape: Shape;
  seed: number;
  box: [number, number, number, number];
}

export function createWorldArt(
  map: VillageMap,
  look: PaletteName,
  semantics?: TileSemantics,
  hidden?: ReadonlySet<SceneLayer>,
  /** The well's water as the story has made it, over what the world says. */
  wellState?: 'dry' | 'flowing' | null,
  /** Draw the living things apart, as `live` sprites, instead of into the still cloth. */
  splitLive = false,
): WorldArt {
  const width = Math.max(1, map.width * map.tileDim);
  const height = Math.max(1, map.height * map.tileDim);
  // A world authored as a scene is drawn from the scene itself (already with its ambience).
  const meanings = semantics ?? (map.tileMeanings?.length ? semanticsFromTable(map.tileMeanings) : undefined);
  const baked = map.scene ? bakeScene(map.scene).model : withAmbience(buildSceneModel(map, meanings), hashString(map.name));
  const withWell = wellState ? { ...baked, features: baked.features.map((f) => (f.kind === 'well' ? { ...f, state: wellState } : f)) } : baked;
  const liveFeatures = splitLive ? withWell.features.filter((f) => LIVE_KINDS[f.kind] && !hidden?.has(layerOf(f))) : [];
  const model = liveFeatures.length ? { ...withWell, features: withWell.features.filter((f) => !liveFeatures.includes(f)) } : withWell;
  // Behind the people: quieter work in thinner, sparser thread rather than a faded cloth.
  const strength = Math.max(0.3, Math.min(1, model.backdrop ?? 1));
  const options: LookOptions = {
    unit: map.tileDim / UNITS_PER_TILE,
    origin: [0, 0],
    palette: worldPalette(look, model.palette, model.threadColours),
    seed: hashString(map.name),
    threadScale: model.threadWeight ?? 1,
    ...(strength < 1 ? { quiet: { thread: 0.35 + 0.65 * strength, sparse: Math.min(0.85, (1 - strength) * 1.4) } } : {}),
  };
  // Every element in one family of stitch, charted on the world's stitch grid.
  const stitchCell = UNITS_PER_TILE / STITCHES_PER_CELL;
  const pad = options.unit * 2;
  const prepare = (raw: Shape[], offset: number): PreparedShape[] =>
    restitch(raw, model.stitch, stitchCell).map((shape, i) => {
      const b = bounds([shape]);
      return {
        shape,
        seed: (options.seed ?? 1) + offset + i * 7919,
        box: [b.minX * options.unit - pad, b.minY * options.unit - pad, b.maxX * options.unit + pad, b.maxY * options.unit + pad],
      };
    });
  const upright: SceneLayer[] = ['plantings', 'works', 'buildings', 'life'];
  const below = model.quietPaths
    ? prepare(sceneShapes(model, new Set([...(hidden ?? []), ...upright]), false), 0)
    : prepare(sceneShapes(model, hidden), 0);
  const above = model.quietPaths ? prepare(sceneShapes(model, new Set([...(hidden ?? []), 'ground', 'patterns'])), 1_000_003) : [];
  const thread = isThread(look);
  const mask = model.quietPaths ? quietMask(map, options.palette.ground) : null;

  const drawShapes = (ctx: CanvasRenderingContext2D, list: PreparedShape[], x0: number, y0: number, x1: number, y1: number) => {
    for (const p of list) {
      if (p.box[2] < x0 || p.box[0] > x1 || p.box[3] < y0 || p.box[1] > y1) continue;
      const o = { ...options, seed: p.seed };
      if (thread) renderEmbroidery(ctx, [p.shape], o);
      else renderLineArt(ctx, [p.shape], o);
    }
  };

  const live: LiveSprite[] = liveFeatures.map((f) => {
    const spec = LIVE_KINDS[f.kind]!;
    const shapes = restitch(featureShapesOf(f, withWell), model.stitch, stitchCell);
    const b = bounds(shapes);
    const u = options.unit;
    const padU = 1.5;
    const minX = (b.minX - padU) * u;
    const minY = (b.minY - padU) * u;
    const w = (b.maxX - b.minX + padU * 2) * u;
    const h = (b.maxY - b.minY + padU * 2) * u;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * LIVE_SCALE));
    canvas.height = Math.max(1, Math.ceil(h * LIVE_SCALE));
    const cctx = canvas.getContext('2d')!;
    cctx.scale(LIVE_SCALE, LIVE_SCALE);
    cctx.translate(-minX, -minY);
    const seed = hashString(`${f.id ?? f.kind}:${f.x}:${f.y}`);
    shapes.forEach((shape, i) => {
      const o = { ...options, seed: seed + i * 7919 };
      if (thread) renderEmbroidery(cctx, [shape], o);
      else renderLineArt(cctx, [shape], o);
    });
    const [fx, fy] = featureFoot(f);
    return { kind: spec.kind, bend: spec.bend, canvas, footX: fx * u, footY: fy * u, ox: fx * u - minX, oy: fy * u - minY, w, h, seed };
  });
  const water: Array<[number, number]> = [];
  for (let x = 0; x < model.width; x++) for (let y = 0; y < model.height; y++) if (model.terrain[x]?.[y] === 'water') water.push([x, y]);
  const xs = water.map((c) => c[0]);
  const ys = water.map((c) => c[1]);
  const waterRunsDown = water.length > 0 && Math.max(...ys) - Math.min(...ys) >= Math.max(...xs) - Math.min(...xs);

  return {
    width,
    height,
    live,
    water: splitLive ? water : [],
    waterRunsDown,
    glint: options.palette.inks.light ?? '#ffffff',
    drawRegion(ctx, x0, y0, w, h) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, w, h);
      ctx.clip();
      if (thread) paintLinenRegion(ctx, x0, y0, w, h, options);
      else {
        ctx.fillStyle = options.palette.ground;
        ctx.fillRect(x0, y0, w, h);
      }
      drawShapes(ctx, below, x0, y0, x0 + w, y0 + h);
      if (mask) {
        // The places people walk, washed back toward plain linen with soft edges.
        ctx.save();
        ctx.globalAlpha = 0.72;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(mask, 0, 0, width, height);
        ctx.restore();
        drawShapes(ctx, above, x0, y0, x0 + w, y0 + h);
      }
      ctx.restore();
    },
  };
}

/** 0..1 hash of two integers and a seed, for steady per-thing variety. */
function hash01(a: number, b: number, seed = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The wind at a point, 0 (still) to about 1 (a full gust): broad waves rolling across the
 * village in a slowly turning direction, gathered into gusts by a slower pattern, so some
 * places bend while others are still and the gust can be seen travelling.
 */
function windAt(x: number, y: number, t: number): number {
  const dir = 0.6 + Math.sin(t * 0.031) * 0.5;
  const along = x * Math.cos(dir) + y * Math.sin(dir);
  const wave = 0.5 + 0.5 * Math.sin(along * 0.012 - t * 1.1);
  const gusts = 0.5 + 0.5 * Math.sin(x * 0.0041 + y * 0.0027 - t * 0.23) * Math.sin(x * 0.0023 - y * 0.0035 + t * 0.17 + 1.3);
  return wave * wave * gusts;
}

/**
 * Draws the world's living things for this moment, over the still cloth: reeds, flowers,
 * sunflowers and wheat swaying in the gusts; hens pecking, shuffling and turning; ducks
 * bobbing and drifting; and light glints drifting down the river. `view` is the part of
 * the world in sight, in world pixels; `cell` is the size of a map cell.
 */
export function paintLiveWorld(
  ctx: CanvasRenderingContext2D,
  art: WorldArt,
  t: number,
  view: { x0: number; y0: number; x1: number; y1: number },
  cell: number,
) {
  // River glints: short light strokes drifting with the current, each cell its own pace.
  if (art.water.length) {
    ctx.save();
    ctx.strokeStyle = art.glint;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, cell * 0.05);
    for (const [cx, cy] of art.water) {
      const px = cx * cell;
      const py = cy * cell;
      if (px + cell < view.x0 || px > view.x1 || py + cell < view.y0 || py > view.y1) continue;
      for (let k = 0; k < 2; k++) {
        const r = hash01(cx, cy, k + 11);
        const phase = (t * (0.22 + r * 0.1) + r) % 1;
        const fade = Math.sin(phase * Math.PI);
        ctx.globalAlpha = 0.32 * fade * fade;
        const across = (0.2 + 0.6 * hash01(cx, cy, k + 23)) * cell;
        const len = cell * (0.16 + 0.12 * r);
        ctx.beginPath();
        if (art.waterRunsDown) {
          const y = py + phase * cell;
          ctx.moveTo(px + across - len / 2, y);
          ctx.lineTo(px + across + len / 2, y + len * 0.15);
        } else {
          const x = px + phase * cell;
          ctx.moveTo(x, py + across - len / 2);
          ctx.lineTo(x + len * 0.15, py + across + len / 2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  const margin = cell * 3;
  for (const s of art.live) {
    if (s.footX + margin < view.x0 || s.footX - margin > view.x1 || s.footY + margin < view.y0 || s.footY - margin > view.y1) continue;
    const r = (s.seed % 1000) / 1000;
    ctx.save();
    ctx.translate(s.footX, s.footY);
    if (s.kind === 'sway') {
      // Bend about the foot: a little in any breeze, a lot in a gust, each at its own phase.
      const g = windAt(s.footX, s.footY, t);
      const flutter = Math.sin(t * (2.1 + r) + r * 20) * 0.18 + Math.sin(t * (3.7 + r * 2) + r * 7) * 0.08;
      ctx.rotate(s.bend * (g * 1.1 + 0.12) * (1 + flutter));
    } else if (s.kind === 'hen') {
      // Pecks now and then, shuffles a step, turns round once in a while.
      const cycle = (t / (7 + r * 5) + r) % 1;
      const peck = cycle > 0.55 && cycle < 0.75 ? Math.sin(((cycle - 0.55) / 0.2) * Math.PI * 3) : 0;
      const step = Math.sin(t / (11 + r * 6) + r * 9) * cell * 0.22;
      const facing = Math.sin(t / (13 + r * 8) + r * 4) >= 0 ? 1 : -1;
      ctx.translate(step, Math.max(0, peck) * cell * 0.05);
      ctx.rotate(Math.max(0, peck) * 0.25 * facing);
      ctx.scale(facing, 1);
    } else {
      // A duck rides the water: bobbing, drifting a little, turning with the drift.
      const drift = Math.sin(t / (9 + r * 6) + r * 5);
      ctx.translate(drift * cell * 0.3, Math.sin(t * (1.4 + r * 0.4) + r * 8) * cell * 0.035);
      ctx.scale(Math.cos(t / (9 + r * 6) + r * 5) >= 0 ? 1 : -1, 1);
    }
    ctx.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h);
    ctx.restore();
  }
}

/** Renders the whole static world into a canvas of map pixel size. */
export function renderWorldLayer(map: VillageMap, look: PaletteName, semantics?: TileSemantics, hidden?: ReadonlySet<SceneLayer>): HTMLCanvasElement {
  const art = createWorldArt(map, look, semantics, hidden);
  const canvas = document.createElement('canvas');
  canvas.width = art.width;
  canvas.height = art.height;
  art.drawRegion(canvas.getContext('2d')!, 0, 0, art.width, art.height);
  return canvas;
}

/** One pixel per cell where people walk, scaled up with smoothing for soft-edged quiet paths. */
function quietMask(map: VillageMap, ground: string): HTMLCanvasElement {
  const mask = document.createElement('canvas');
  mask.width = map.width;
  mask.height = map.height;
  const m = mask.getContext('2d')!;
  m.fillStyle = ground;
  for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) if (!map.collisionGrid[x]?.[y]) m.fillRect(x, y, 1, 1);
  return mask;
}

type PartName = 'legLeft' | 'legRight' | 'skirt' | 'torso' | 'head' | 'armLeft' | 'armRight';
const PART_ORDER: readonly PartName[] = ['legLeft', 'legRight', 'skirt', 'torso', 'head', 'armLeft', 'armRight'];

interface PartSprite {
  canvas: HTMLCanvasElement;
  /** Where the figure's feet sit inside this canvas, in canvas pixels. */
  ox: number;
  oy: number;
}

/** A character drawn in parts, ready to be posed each frame. Lengths are screen pixels. */
export interface FigureRig {
  parts: Record<PartName, PartSprite>;
  pivots: FigureParts['pivots'];
  lean: number;
  height: number;
  /** Canvas pixels per screen pixel. */
  density: number;
  build: FigureBuild;
  view: FigureView;
  /** What sort of being: a serpent glides and its tail ripples instead of stepping. */
  kind?: FigureKind;
  /** The arms raised, as in the khoro, for when the figure dances. */
  danceArms?: { left: PartSprite; right: PartSprite };
}

export interface FigureLooks {
  build?: FigureBuild;
  view?: FigureView;
  kind?: FigureKind;
  /** `bold` draws the figure with heavier lines; the village always uses `full`. */
  detail?: FigureDetail;
  /** The maker's quirks (`FigureOptions.quirks`). On unless turned off in the Style panel. */
  quirks?: boolean;
  /** The seed to draw from instead of the id's own. */
  seed?: number;
  /** Traits chosen by hand. */
  traits?: FigureTraits;
  /** Hide the cloth behind the figure (the default) instead of letting it show between threads. */
  solid?: boolean;
}

/** How tall an art figure stands, in map cells, at character scale 1. */
export const FIGURE_HEIGHT_SCALE = 1.75;

const FIGURE_UNITS = 30;
const DENSITY = 3;
const rigCache = new Map<string, FigureRig>();

/**
 * Cloth-coloured backing under a drawing, so what lies beneath does not show between its
 * threads: the figure reads as worked on its own piece of linen, laid over the world.
 */
function paintBacking(ctx: CanvasRenderingContext2D, shapes: Shape[], unit: number, origin: [number, number], colour: string) {
  const px = (p: Pt): Pt => [p[0] * unit + origin[0], p[1] * unit + origin[1]];
  const trace = (points: Pt[], closed: boolean) => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
    if (closed) ctx.closePath();
  };
  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const shape of shapes) {
    if (shape.kind === 'area') {
      trace(shape.points, true);
      ctx.lineWidth = unit * 0.5;
      ctx.fill();
      ctx.stroke();
    } else if (shape.kind === 'line') {
      trace(shape.points, Boolean(shape.closed));
      ctx.lineWidth = unit * (shape.weight * 0.9 + 0.45);
      // A closed outline is a garment worked in white (a chemise sleeve, an outlined skirt): cloth, not air.
      if (shape.closed) ctx.fill();
      ctx.stroke();
    } else if (shape.kind === 'knot') {
      ctx.beginPath();
      ctx.arc(...px(shape.at), shape.r * unit * 1.15, 0, Math.PI * 2);
      ctx.fill();
    } else if (!shape.rot) {
      const c = shape.cell * unit;
      const [x0, y0] = px(shape.origin);
      for (const [x, y] of shape.cells) ctx.fillRect(x0 + (x - 0.5) * c - 0.5, y0 + (y - 0.5) * c - 0.5, c + 1, c + 1);
    }
  }
  ctx.restore();
}

function renderPart(shapes: Shape[], look: PaletteName, unit: number, seed: number, solid = false): PartSprite {
  const box = bounds(shapes);
  const pad = 2.5;
  const canvas = document.createElement('canvas');
  if (!Number.isFinite(box.minX)) {
    canvas.width = 1;
    canvas.height = 1;
    return { canvas, ox: 0, oy: 0 };
  }
  canvas.width = Math.max(1, Math.ceil((box.maxX - box.minX + pad * 2) * unit));
  canvas.height = Math.max(1, Math.ceil((box.maxY - box.minY + pad * 2) * unit));
  const origin: [number, number] = [(-box.minX + pad) * unit, (-box.minY + pad) * unit];
  const ctx = canvas.getContext('2d')!;
  const options: LookOptions = { unit, origin, palette: clothPalette(look), seed };
  if (solid) paintBacking(ctx, shapes, unit, origin, options.palette.ground);
  if (isThread(look)) renderEmbroidery(ctx, shapes, options);
  else renderLineArt(ctx, shapes, options);
  return { canvas, ox: origin[0], oy: origin[1] };
}

/**
 * A character's rig in a look, generated from their id. The body is cached once per look
 * and size; only the head is redrawn for each expression.
 */
export function getFigureRig(
  id: string,
  look: PaletteName,
  heightPx: number,
  expression?: Expression,
  { build = 'skirted', view = 'front', kind = 'human', detail = 'full', quirks = true, seed: chosenSeed, traits, solid = true }: FigureLooks = {},
): FigureRig {
  const size = Math.max(16, Math.round(heightPx));
  const seed = chosenSeed ?? hashString(id);
  const who = `${id}|${seed}|${solid ? 'solid' : 'open'}|${traits ? JSON.stringify(traits) : ''}`;
  // Everyday arms are down; the raised arms are kept apart for dancing.
  const resting = figureParts(createSeededRng(seed), { height: FIGURE_UNITS, build, view, kind, detail, quirks, traits, stance: 'everyday' });
  const mood = expression ?? resting.restingExpression;
  const key = `${who}|${look}:${activeWorldThreadsId()}|${size}|${kind}|${build}|${view}|${detail}|${quirks}|${mood}`;
  const cached = rigCache.get(key);
  if (cached) return cached;

  const unit = (size / FIGURE_UNITS) * DENSITY;
  const bodyKey = `${who}|${look}:${activeWorldThreadsId()}|${size}|${kind}|${build}|${view}|${detail}|${quirks}|body`;
  let body = rigCache.get(bodyKey);
  if (!body) {
    const parts = {} as Record<PartName, PartSprite>;
    for (const name of PART_ORDER) parts[name] = renderPart(resting[name], look, unit, seed, solid);
    const dancing = view === 'side' ? null : figureParts(createSeededRng(seed), { height: FIGURE_UNITS, build, view, kind, detail, quirks, traits, stance: 'dancing' });
    const danceArms = dancing ? { left: renderPart(dancing.armLeft, look, unit, seed, solid), right: renderPart(dancing.armRight, look, unit, seed, solid) } : undefined;
    const toPx = (p: Pt): Pt => [(p[0] * size) / FIGURE_UNITS, (p[1] * size) / FIGURE_UNITS];
    body = {
      parts,
      pivots: {
        waist: toPx(resting.pivots.waist),
        neck: toPx(resting.pivots.neck),
        shoulderLeft: toPx(resting.pivots.shoulderLeft),
        shoulderRight: toPx(resting.pivots.shoulderRight),
        hipLeft: toPx(resting.pivots.hipLeft),
        hipRight: toPx(resting.pivots.hipRight),
      },
      lean: resting.lean,
      height: size,
      density: DENSITY,
      build,
      view,
      kind,
      danceArms,
    };
    rigCache.set(bodyKey, body);
  }
  const rig: FigureRig =
    mood === resting.restingExpression
      ? body
      : {
          ...body,
          parts: {
            ...body.parts,
            head: renderPart(figureParts(createSeededRng(seed), { height: FIGURE_UNITS, expression: mood, build, view, kind, detail, quirks, traits, stance: 'everyday' }).head, look, unit, seed, solid),
          },
        };
  if (rigCache.size > 400) rigCache.clear();
  rigCache.set(key, rig);
  return rig;
}

const SAD_WORDS = /\b(no|never|not|drought|curse|cursed|blood|fear|afraid|dark|lie|lied|liar|beware|sacrifice|demand|dead|death|thirst|steal|stole|angry|hush|warn)\b/i;
const GLAD_WORDS = /\b(yes|laugh|good|rain|gift|love|festival|dance|honey|welcome|thank|friend|sweet|bless|joy|wedding|feast)\b/i;

/** The face a character pulls for what they are doing and saying. */
export function expressionFor(state: string | undefined, line: string | undefined): Expression | undefined {
  if (state === 'thinking') return 'sly';
  if (state === 'listening' || state === 'conversing') return 'calm';
  if (state === 'speaking' && line) {
    if (SAD_WORDS.test(line)) return 'grim';
    if (/\?\s*$/.test(line.trim())) return 'awed';
    if (GLAD_WORDS.test(line)) return 'glad';
    return 'glad';
  }
  return undefined;
}

export interface FigureMotion {
  id: string;
  facing: 'down' | 'left' | 'right' | 'up';
  moving: boolean;
  /** Advances while walking; one stride is about two units. */
  animFrame: number;
  state?: string;
  /** Dancing (in the khoro, at a celebration): arms up, a bounce in the step. */
  dancing?: boolean;
  /** Seconds, any clock that runs steadily. */
  time: number;
}

interface MotionMemory {
  move: number;
  flip: number;
  talk: number;
  think: number;
  dance: number;
  time: number;
  view: FigureView;
  /** When the view last changed, for the quick squash that sells the turn. */
  viewChangedAt: number;
  /** When the figure last moved, so it turns back to face us a moment after stopping. */
  lastMovedAt: number;
}

/** How long a figure keeps its walking view after stopping before turning to face us. */
const FACE_FRONT_AFTER = 0.6;

/**
 * Which way a figure is drawn this frame. With turning on, walking left or right shows the
 * profile and walking up shows the back; standing, talking or listening faces us, which is
 * the charming front view the cast was designed in.
 */
/**
 * Facing and view only change once the new one has held for a moment. The simulation can
 * flip a character's facing several times a second (sidestepping a neighbour, a path that
 * zigzags, two talkers re-facing each other), and every flip starts a turn; without a hold
 * a figure gets stuck turning, squashed through its edge, as if spinning.
 */
const HOLD_FACING = 0.3;
const HOLD_VIEW = 0.35;
interface Steady<T> {
  shown: T;
  pending: T;
  since: number;
}
const steadyFacing = new Map<string, Steady<FigureMotion['facing']>>();
const steadyView = new Map<string, Steady<FigureView>>();

function steady<T>(store: Map<string, Steady<T>>, id: string, wanted: T, time: number, hold: number): T {
  const s = store.get(id);
  if (!s || time < s.since - 5) {
    store.set(id, { shown: wanted, pending: wanted, since: time });
    if (store.size > 400) store.clear();
    return wanted;
  }
  if (wanted === s.shown) {
    s.pending = wanted;
    s.since = time;
    return s.shown;
  }
  if (wanted !== s.pending) {
    s.pending = wanted;
    s.since = time;
  }
  if (time - s.since >= hold) s.shown = wanted;
  return s.shown;
}

/** The facing to draw: the simulation's facing once it has held for a moment. */
export function steadyFacingFor(id: string, facing: FigureMotion['facing'], time: number): FigureMotion['facing'] {
  return steady(steadyFacing, id, facing, time, HOLD_FACING);
}

export function chooseFigureView(motion: Pick<FigureMotion, 'id' | 'facing' | 'moving' | 'time'>, turning: boolean): FigureView {
  if (!turning) return 'front';
  const memory = motionMemory.get(motion.id);
  const facing = steadyFacingFor(motion.id, motion.facing, motion.time);
  const wanted: FigureView = motion.moving
    ? facing === 'left' || facing === 'right'
      ? 'side'
      : facing === 'up'
        ? 'back'
        : 'front'
    : memory && motion.time - memory.lastMovedAt < FACE_FRONT_AFTER
      ? memory.view
      : 'front';
  return steady(steadyView, motion.id, wanted, motion.time, HOLD_VIEW);
}

const motionMemory = new Map<string, MotionMemory>();

/** Moves `value` toward `target` at `rate` per second, never overshooting. */
function approach(value: number, target: number, rate: number, dt: number): number {
  const step = rate * dt;
  return Math.abs(target - value) <= step ? target : value + Math.sign(target - value) * step;
}

function drawPart(ctx: CanvasRenderingContext2D, part: PartSprite, density: number) {
  ctx.drawImage(part.canvas, -part.ox / density, -part.oy / density, part.canvas.width / density, part.canvas.height / density);
}

/**
 * A serpent's tail drawn in thin strips, each shifted along a wave that travels away from the
 * waist: seen side-on the coils rise and fall along their length; seen head-on they sway from
 * side to side, more toward the tip. The waist stays put, so the woman sits still on the coils.
 */
function drawSlithering(ctx: CanvasRenderingContext2D, part: PartSprite, density: number, waist: Pt, side: boolean, phase: number, amplitude: number) {
  const c = part.canvas;
  const strips = 18;
  const w = c.width / density;
  const h = c.height / density;
  const x0 = -part.ox / density;
  const y0 = -part.oy / density;
  for (let i = 0; i < strips; i++) {
    if (side) {
      // Vertical strips along the tail; distance from the waist sets how much each one moves.
      const sx = (c.width * i) / strips;
      const sw = Math.ceil(c.width / strips) + 1;
      const xMid = x0 + (w * (i + 0.5)) / strips;
      const reach = Math.min(1, Math.abs(xMid - waist[0]) / (w * 0.5));
      const dy = Math.sin(phase - reach * 5) * amplitude * reach;
      ctx.drawImage(c, sx, 0, sw, c.height, x0 + (w * i) / strips, y0 + dy, sw / density, h);
    } else {
      // Horizontal strips down the coils; the lower (and nearer the tip), the more they sway.
      const sy = (c.height * i) / strips;
      const sh = Math.ceil(c.height / strips) + 1;
      const yMid = y0 + (h * (i + 0.5)) / strips;
      const reach = Math.max(0, Math.min(1, (yMid - waist[1]) / Math.max(1, -waist[1])));
      const dx = Math.sin(phase - reach * 4) * amplitude * reach;
      ctx.drawImage(c, 0, sy, c.width, sh, x0 + dx, y0 + (h * i) / strips, w, sh / density);
    }
  }
}

function aboutPivot(ctx: CanvasRenderingContext2D, pivot: Pt, rotate: number, scaleX = 1, scaleY = 1) {
  ctx.translate(pivot[0], pivot[1]);
  ctx.rotate(rotate);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-pivot[0], -pivot[1]);
}

/**
 * Poses and paints a rig standing on a tile. Every movement is eased: walking blends in and
 * out rather than snapping, turning round squashes the figure through its edge, and the
 * skirt, arms and head each follow the body a moment late.
 */
export function paintRig(
  ctx: CanvasRenderingContext2D,
  rig: FigureRig,
  tileX: number,
  tileY: number,
  tileDim: number,
  motion: FigureMotion,
) {
  const memory =
    motionMemory.get(motion.id) ??
    { move: 0, flip: 1, talk: 0, think: 0, dance: 0, time: motion.time, view: rig.view, viewChangedAt: -10, lastMovedAt: -10 };
  const dt = Math.max(0, Math.min(0.1, motion.time - memory.time));
  memory.time = motion.time;
  if (motion.moving) memory.lastMovedAt = motion.time;
  if (memory.view !== rig.view) {
    memory.view = rig.view;
    memory.viewChangedAt = motion.time;
  }
  const turnIn = Math.min(1, (motion.time - memory.viewChangedAt) * 7);
  memory.move = approach(memory.move, motion.moving ? 1 : 0, 5, dt);
  const facing = steadyFacingFor(motion.id, motion.facing, motion.time);
  const flipTarget = facing === 'left' ? -1 : facing === 'right' ? 1 : memory.flip >= 0 ? 1 : -1;
  memory.flip = approach(memory.flip, flipTarget, 9, dt);
  memory.talk = approach(memory.talk, motion.state === 'speaking' ? 1 : 0, 4, dt);
  memory.think = approach(memory.think, motion.state === 'thinking' ? 1 : 0, 3, dt);
  memory.dance = approach(memory.dance ?? 0, motion.dancing ? 1 : 0, 3, dt);
  motionMemory.set(motion.id, memory);
  if (motionMemory.size > 300) motionMemory.clear();

  const h = rig.height;
  const phase = (hashString(motion.id) % 1000) / 159;
  const t = motion.time;
  const move = memory.move * memory.move * (3 - 2 * memory.move);
  const talk = memory.talk * memory.talk * (3 - 2 * memory.talk);
  const still = 1 - move;
  const stride = motion.animFrame * 1.7;
  const step = Math.sin(stride);
  const contact = 1 - Math.abs(step);
  const breath = Math.sin(t * 1.9 + phase);

  // Dancing: a springy bounce on the beat (about two steps a second).
  const dance = memory.dance * memory.dance * (3 - 2 * memory.dance);
  const beat = t * 4.2 + phase;
  const serpent = rig.kind === 'serpent';
  // A serpent glides: no step to bob on, only a slow sway of the body over the moving coils.
  const lift = serpent ? 0 : move * Math.abs(step) * h * 0.05 + dance * Math.abs(Math.sin(beat)) * h * 0.035;
  const squashY = 1 - move * 0.06 * contact + still * 0.01 * breath;
  const squashX = 1 + move * 0.05 * contact - still * 0.006 * breath;
  const facingSign = memory.flip >= 0 ? 1 : -1;
  // Changing view squashes the figure through its edge for a moment, like turning round.
  const turnScale = Math.sign(memory.flip || 1) * Math.max(0.12, Math.abs(memory.flip)) * (0.35 + 0.65 * turnIn);
  const side = rig.view === 'side';
  // Side-on the body leans into travel. Walking toward us or away, it rolls and shifts its
  // weight over the planted foot instead, the way a person sways when seen head-on.
  const roll = serpent ? move * Math.sin(t * 2.4 + phase) * 0.035 : side ? move * 0.07 * facingSign : move * step * 0.04;
  const weightShift = serpent ? move * Math.sin(t * 2.4 + phase) * h * 0.02 : side ? 0 : -move * step * h * 0.022;
  const bodyRotate = rig.lean + roll + still * Math.sin(t * 0.6 + phase) * 0.012;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(tileX + tileDim / 2 + weightShift, tileY + tileDim - 3 - lift);
  ctx.rotate(bodyRotate);
  ctx.scale(turnScale * squashX, squashY);

  const { waist, neck, shoulderLeft, shoulderRight, hipLeft, hipRight } = rig.pivots;
  const density = rig.density;

  if (side) {
    // Side-on, the legs swing from the hip in opposite phase: a real stride.
    const legSwing = move * step * 0.5;
    ctx.save();
    aboutPivot(ctx, hipLeft, legSwing);
    drawPart(ctx, rig.parts.legLeft, density);
    ctx.restore();
    ctx.save();
    aboutPivot(ctx, hipRight, -legSwing);
    drawPart(ctx, rig.parts.legRight, density);
    ctx.restore();
  } else {
    // Head-on, a stepping leg lifts and foreshortens (a touch bigger coming toward us,
    // smaller going away) while the other stays planted under the weight.
    const toward = rig.view === 'front' ? 1 : -1;
    const legs: Array<[PartSprite, Pt, number]> = [
      [rig.parts.legLeft, hipLeft, Math.max(0, step)],
      [rig.parts.legRight, hipRight, Math.max(0, -step)],
    ];
    for (const [part, hip, raised] of legs) {
      const up = move * raised;
      ctx.save();
      ctx.translate(0, -up * h * (rig.build === 'trousered' ? 0.045 : 0.03));
      aboutPivot(ctx, hip, 0, 1 + up * 0.05 * toward, 1 - up * 0.1);
      drawPart(ctx, part, density);
      ctx.restore();
    }
  }

  if (serpent) {
    // The coils: a wave travels down the tail, faster when she moves, a slow ripple at rest.
    drawSlithering(ctx, rig.parts.skirt, density, waist, side, t * (2.2 + move * 4) + phase, h * (0.012 + move * 0.03));
  } else {
  ctx.save();
  // The skirt swings late; head-on it sways against the weight shift rather than rotating.
  const skirtSwing = side
    ? move * Math.sin(stride - 0.9) * 0.07 + still * Math.sin(t * 0.8 + phase) * 0.018
    : -move * Math.sin(stride - 0.7) * 0.05 + still * Math.sin(t * 0.8 + phase) * 0.018;
  aboutPivot(ctx, waist, skirtSwing, 1 + move * 0.035 * Math.abs(Math.sin(stride - 0.9)), 1);
  drawPart(ctx, rig.parts.skirt, density);
  ctx.restore();
  }

  // Breathing lifts the chest; the head and arms ride on it.
  const chest = 1 + still * 0.022 * breath + talk * 0.01 * Math.sin(t * 6.5);
  const neckRise = (chest - 1) * (neck[1] - waist[1]);
  ctx.save();
  aboutPivot(ctx, waist, 0, 1, chest);
  drawPart(ctx, rig.parts.torso, density);
  ctx.restore();

  ctx.save();
  ctx.translate(0, neckRise + move * Math.sin(stride * 2 + 0.6) * h * 0.008 - talk * Math.abs(Math.sin(t * 7)) * h * 0.012);
  const headTilt =
    still * Math.sin(t * 0.7 + phase * 1.3) * 0.05 +
    move * Math.sin(stride + 0.5) * 0.04 +
    memory.think * 0.16 +
    talk * Math.sin(t * 3.1 + phase) * 0.05;
  aboutPivot(ctx, neck, headTilt);
  drawPart(ctx, rig.parts.head, density);
  ctx.restore();

  // Side-on, the near arm swings against the near (right) leg. Head-on an arm swinging
  // forward foreshortens, so it shortens a little and turns in rather than flapping out.
  // Walking, the arms swing with the stride; standing, they hang and drift a little.
  const swing = move * step * (side ? 0.55 : 0.22);
  const reachL = side ? 1 : 1 - move * Math.max(0, -step) * 0.14;
  const reachR = side ? 1 : 1 - move * Math.max(0, step) * 0.14;
  const drift = still * Math.sin(t * 1.1 + phase) * 0.035;
  // Dancing, the raised arms take over and sway with the beat.
  const raised = rig.danceArms && dance > 0.5 ? rig.danceArms : null;
  const sway = raised ? Math.sin(beat) * 0.12 : 0;
  // Talking, the speaking hand comes up and moves with the words, now and then both.
  const gesture = raised ? 0 : talk * (-0.55 - 0.3 * Math.sin(t * 4.6 + phase));
  const otherHand = raised ? 0 : talk * Math.max(0, Math.sin(t * 1.3 + phase * 2)) * (0.35 + 0.2 * Math.sin(t * 5.1));
  ctx.save();
  ctx.translate(0, neckRise);
  aboutPivot(ctx, shoulderLeft, raised ? sway : -swing + drift + otherHand, 1, raised ? 1 : reachL);
  drawPart(ctx, raised ? raised.left : rig.parts.armLeft, density);
  ctx.restore();

  ctx.save();
  ctx.translate(0, neckRise);
  aboutPivot(ctx, shoulderRight, raised ? sway : swing - drift + gesture, 1, raised ? 1 : reachR);
  drawPart(ctx, raised ? raised.right : rig.parts.armRight, density);
  ctx.restore();

  ctx.restore();
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t);
  return `#${[16, 8, 0].map((shift) => ch(shift).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Colours for labels and bubbles that sit on the cloth: patches of the ground colour with
 * stitched borders and ink text, taken from the active look instead of a fixed dark theme.
 */
export function clothOverlayColours(look: PaletteName) {
  const palette = clothPalette(look);
  const { ground } = palette;
  const { dark, primary, gold, secondary } = palette.inks;
  const lineLook = look === 'ink' || look === 'night';
  // Patches are see-through enough that the cloth shows: no solid slabs over the world.
  const lighter = mix(ground, look === 'night' ? '#000000' : '#ffffff', 0.35);
  const patch = withAlpha(lighter, 0.84);
  return {
    stitched: true,
    artLook: look,
    bubbleStyle: 'parchment-scroll' as const,
    speechFill: patch,
    speechRimLight: 'transparent',
    speechBorder: dark,
    speechText: dark,
    speechHighlight: primary,
    thoughtFill: withAlpha(lighter, 0.7),
    thoughtBorder: mix(dark, ground, 0.35),
    thoughtText: mix(dark, ground, 0.15),
    thoughtHighlight: secondary,
    namePillFill: withAlpha(lighter, 0.6),
    namePillBorder: mix(dark, ground, 0.25),
    namePillText: dark,
    playerPillFill: withAlpha(lighter, 0.6),
    playerPillBorder: primary,
    poiFill: withAlpha(lighter, 0.62),
    poiBorder: lineLook ? dark : gold,
    poiText: lineLook ? dark : mix(primary, dark, 0.35),
    poiGemFill: primary,
  };
}

/**
 * Whether a character is drawn skirted or trousered, from what the cast data says: an
 * explicit figure build first, then a bottom style, then the character's gender, then their voice. With nothing
 * to go on, the original skirted figure.
 */
export function figureBuildFor(cfg?: {
  figure?: { build?: FigureBuild; kind?: FigureKind };
  appearance?: { gender?: string; bottomStyle?: string };
  voice?: { gender?: string };
}): FigureBuild {
  if (cfg?.figure?.build) return cfg.figure.build;
  const bottom = cfg?.appearance?.bottomStyle;
  if (bottom === 'skirt') return 'skirted';
  if (bottom === 'trousers' || bottom === 'breeches') return 'trousered';
  const gender = cfg?.appearance?.gender ?? cfg?.voice?.gender;
  return gender === 'male' ? 'trousered' : 'skirted';
}

/** The player's build from their chosen attire: the hero and the kuker wear trousers. */
export function playerFigureBuild(attire: string): FigureBuild {
  return attire === 'balkan-yunak' || attire === 'kuker-wanderer' || attire === 'classic-traveler' ? 'trousered' : 'skirted';
}

const portraitCache = new Map<string, HTMLCanvasElement>();

/**
 * A character's portrait in a look, drawn from the same figure as in the world: head and
 * shoulders (`bust`) for lists, or the whole figure. Transparent ground; `sizePx` square.
 */
export function figurePortrait(
  id: string,
  look: PaletteName,
  sizePx: number,
  build: FigureBuild,
  framing: 'bust' | 'full' = 'bust',
  pixelRatio = 2,
  kind: FigureKind = 'human',
  person: { seed?: number; traits?: FigureTraits; expression?: Expression } = {},
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const px = Math.max(8, Math.round(sizePx * pixelRatio));
  const seed = person.seed ?? hashString(id);
  const key = `${id}|${seed}|${person.traits ? JSON.stringify(person.traits) : ''}|${person.expression ?? ''}|${look}:${activeWorldThreadsId()}|${px}|${kind}|${build}|${framing}`;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const parts = figureParts(createSeededRng(seed), { height: FIGURE_UNITS, build, kind, quirks: true, traits: person.traits, expression: person.expression });
  const shapes = [...parts.legLeft, ...parts.legRight, ...parts.skirt, ...parts.torso, ...parts.head, ...parts.armLeft, ...parts.armRight];
  const box = bounds(shapes);
  const top = box.minY - 0.6;
  const bottom = framing === 'bust' ? parts.pivots.waist[1] + FIGURE_UNITS * 0.06 : box.maxY + 0.6;
  const span = bottom - top;
  const unit = px / span;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const options: LookOptions = { unit, origin: [px / 2, -top * unit], palette: clothPalette(look), seed };
  if (isThread(look)) renderEmbroidery(ctx, shapes, options);
  else renderLineArt(ctx, shapes, options);
  if (portraitCache.size > 120) portraitCache.clear();
  portraitCache.set(key, canvas);
  return canvas;
}

/** The figure kind the cast data asks for, or an ordinary villager. */
export function figureKindFor(cfg?: { figure?: { kind?: FigureKind } }): FigureKind {
  return cfg?.figure?.kind ?? 'human';
}

/** Build and kind for a character, ready to pass to `getFigureRig`. */
export function figureLooksFor(
  cfg: Parameters<typeof figureBuildFor>[0] & { figure?: { kind?: FigureKind; seed?: number; traits?: FigureTraits } },
): Required<Pick<FigureLooks, 'build' | 'kind'>> & Pick<FigureLooks, 'seed' | 'traits'> {
  return { build: figureBuildFor(cfg), kind: figureKindFor(cfg), seed: cfg.figure?.seed, traits: cfg.figure?.traits };
}
