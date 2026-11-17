/**
 * Draws the running game through the art system: the world as one cached layer and each
 * character as a cached figure, in whichever look is selected.
 */
import { createSeededRng, hashString } from '../core/rng';
import type { VillageMap } from '../engine/types';
import { activeWorldThreadsId, clothPalette, paintLinen, worldPalette, renderEmbroidery, renderLineArt, type LookOptions, type PaletteName } from './looks';
import { figureParts, type Expression, type FigureBuild, type FigureKind, type FigureParts, type FigureDetail, type FigureTraits, type FigureView } from './figures';
import { withAmbience } from './ambient';
import { bakeScene } from '../world/worldScene';
import { buildSceneModel, semanticsFromTable, type SceneLayer, type TileSemantics } from './scene';
import { UNITS_PER_TILE, sceneShapes } from './sceneArt';
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

/** Renders the whole static world into a canvas of map pixel size. */
export function renderWorldLayer(map: VillageMap, look: PaletteName, semantics?: TileSemantics, hidden?: ReadonlySet<SceneLayer>): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, map.width * map.tileDim);
  canvas.height = Math.max(1, map.height * map.tileDim);
  const ctx = canvas.getContext('2d')!;
  // A world authored as a scene is drawn from the scene itself (already with its ambience).
  const meanings = semantics ?? (map.tileMeanings?.length ? semanticsFromTable(map.tileMeanings) : undefined);
  const model = map.scene ? bakeScene(map.scene).model : withAmbience(buildSceneModel(map, meanings), hashString(map.name));
  // Behind the people: quieter work in thinner, sparser thread rather than a faded cloth.
  const strength = Math.max(0.3, Math.min(1, model.backdrop ?? 1));
  const options: LookOptions = {
    unit: map.tileDim / UNITS_PER_TILE,
    origin: [0, 0],
    palette: worldPalette(look, model.palette),
    seed: hashString(map.name),
    threadScale: model.threadWeight ?? 1,
    ...(strength < 1 ? { quiet: { thread: 0.35 + 0.65 * strength, sparse: Math.min(0.85, (1 - strength) * 1.4) } } : {}),
  };
  const draw = (shapes: Shape[]) => (isThread(look) ? renderEmbroidery(ctx, shapes, options) : renderLineArt(ctx, shapes, options));
  if (isThread(look)) paintLinen(ctx, canvas.width, canvas.height, options);
  else {
    ctx.fillStyle = options.palette.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (model.quietPaths) {
    // The ground first, then the paths washed quiet, then what stands on it, untouched.
    const upright: SceneLayer[] = ['plantings', 'works', 'buildings', 'life'];
    draw(sceneShapes(model, new Set([...(hidden ?? []), ...upright]), false));
    quietPaths(ctx, canvas, map, options.palette.ground);
    draw(sceneShapes(model, new Set([...(hidden ?? []), 'ground', 'patterns'])));
  } else {
    draw(sceneShapes(model, hidden));
  }
  return canvas;
}

/** Washes the places people walk back to near-plain linen, with soft edges. */
function quietPaths(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, map: VillageMap, ground: string) {
  // One pixel per cell, scaled up with smoothing: soft edges for free.
  const mask = document.createElement('canvas');
  mask.width = map.width;
  mask.height = map.height;
  const m = mask.getContext('2d')!;
  m.fillStyle = ground;
  for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) if (!map.collisionGrid[x]?.[y]) m.fillRect(x, y, 1, 1);
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  ctx.restore();
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
  /** The arms raised, as in the khoro, for when the figure dances. */
  danceArms?: { left: PartSprite; right: PartSprite };
}

export interface FigureLooks {
  build?: FigureBuild;
  view?: FigureView;
  kind?: FigureKind;
  /** `bold` for figures seen small; see `figureDetailFor`. */
  detail?: FigureDetail;
  /** The maker's quirks (`FigureOptions.quirks`). On unless turned off in the Style panel. */
  quirks?: boolean;
  /** The seed to draw from instead of the id's own. */
  seed?: number;
  /** Traits chosen by hand. */
  traits?: FigureTraits;
}

/** Below this on-screen height a figure is drawn bold so its face still reads. */
export const BOLD_BELOW_PX = 84;

/** The detail level for a figure of this height in world pixels at this camera zoom. */
export function figureDetailFor(heightPx: number, zoom: number): FigureDetail {
  return heightPx * zoom < BOLD_BELOW_PX ? 'bold' : 'full';
}

/** How tall an art figure stands, in map cells, at character scale 1. */
export const FIGURE_HEIGHT_SCALE = 1.75;

const FIGURE_UNITS = 30;
const DENSITY = 3;
const rigCache = new Map<string, FigureRig>();

function renderPart(shapes: Shape[], look: PaletteName, unit: number, seed: number): PartSprite {
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
  { build = 'skirted', view = 'front', kind = 'human', detail = 'full', quirks = true, seed: chosenSeed, traits }: FigureLooks = {},
): FigureRig {
  const size = Math.max(16, Math.round(heightPx));
  const seed = chosenSeed ?? hashString(id);
  const who = `${id}|${seed}|${traits ? JSON.stringify(traits) : ''}`;
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
    for (const name of PART_ORDER) parts[name] = renderPart(resting[name], look, unit, seed);
    const dancing = view === 'side' ? null : figureParts(createSeededRng(seed), { height: FIGURE_UNITS, build, view, kind, detail, quirks, traits, stance: 'dancing' });
    const danceArms = dancing ? { left: renderPart(dancing.armLeft, look, unit, seed), right: renderPart(dancing.armRight, look, unit, seed) } : undefined;
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
            head: renderPart(figureParts(createSeededRng(seed), { height: FIGURE_UNITS, expression: mood, build, view, kind, detail, quirks, traits, stance: 'everyday' }).head, look, unit, seed),
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
  const lift = move * Math.abs(step) * h * 0.05 + dance * Math.abs(Math.sin(beat)) * h * 0.035;
  const squashY = 1 - move * 0.06 * contact + still * 0.01 * breath;
  const squashX = 1 + move * 0.05 * contact - still * 0.006 * breath;
  const facingSign = memory.flip >= 0 ? 1 : -1;
  // Changing view squashes the figure through its edge for a moment, like turning round.
  const turnScale = Math.sign(memory.flip || 1) * Math.max(0.12, Math.abs(memory.flip)) * (0.35 + 0.65 * turnIn);
  const side = rig.view === 'side';
  // Side-on the body leans into travel. Walking toward us or away, it rolls and shifts its
  // weight over the planted foot instead, the way a person sways when seen head-on.
  const roll = side ? move * 0.07 * facingSign : move * step * 0.04;
  const weightShift = side ? 0 : -move * step * h * 0.022;
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

  ctx.save();
  // The skirt swings late; head-on it sways against the weight shift rather than rotating.
  const skirtSwing = side
    ? move * Math.sin(stride - 0.9) * 0.07 + still * Math.sin(t * 0.8 + phase) * 0.018
    : -move * Math.sin(stride - 0.7) * 0.05 + still * Math.sin(t * 0.8 + phase) * 0.018;
  aboutPivot(ctx, waist, skirtSwing, 1 + move * 0.035 * Math.abs(Math.sin(stride - 0.9)), 1);
  drawPart(ctx, rig.parts.skirt, density);
  ctx.restore();

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
