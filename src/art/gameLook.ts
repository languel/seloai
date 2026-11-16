/**
 * Draws the running game through the art system: the world as one cached layer and each
 * character as a cached figure, in whichever look is selected.
 */
import { createSeededRng, hashString } from '../core/rng';
import type { VillageMap } from '../engine/types';
import { PALETTES, paintLinen, renderEmbroidery, renderLineArt, type LookOptions, type PaletteName } from './looks';
import { figureParts, type Expression, type FigureParts } from './motifs';
import { buildSceneModel, type TileSemantics } from './scene';
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
export function renderWorldLayer(map: VillageMap, look: PaletteName, semantics?: TileSemantics): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, map.width * map.tileDim);
  canvas.height = Math.max(1, map.height * map.tileDim);
  const ctx = canvas.getContext('2d')!;
  const options: LookOptions = {
    unit: map.tileDim / UNITS_PER_TILE,
    origin: [0, 0],
    palette: PALETTES[look],
    seed: hashString(map.name),
  };
  const shapes = sceneShapes(buildSceneModel(map, semantics));
  if (isThread(look)) {
    paintLinen(ctx, canvas.width, canvas.height, options);
    renderEmbroidery(ctx, shapes, options);
  } else {
    ctx.fillStyle = options.palette.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderLineArt(ctx, shapes, options);
  }
  return canvas;
}

type PartName = 'legs' | 'skirt' | 'torso' | 'head' | 'armLeft' | 'armRight';
const PART_ORDER: readonly PartName[] = ['legs', 'skirt', 'torso', 'head', 'armLeft', 'armRight'];

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
  const options: LookOptions = { unit, origin, palette: PALETTES[look], seed };
  if (isThread(look)) renderEmbroidery(ctx, shapes, options);
  else renderLineArt(ctx, shapes, options);
  return { canvas, ox: origin[0], oy: origin[1] };
}

/**
 * A character's rig in a look, generated from their id. The body is cached once per look
 * and size; only the head is redrawn for each expression.
 */
export function getFigureRig(id: string, look: PaletteName, heightPx: number, expression?: Expression): FigureRig {
  const size = Math.max(16, Math.round(heightPx));
  const seed = hashString(id);
  const resting = figureParts(createSeededRng(seed), { height: FIGURE_UNITS });
  const mood = expression ?? resting.restingExpression;
  const key = `${id}|${look}|${size}|${mood}`;
  const cached = rigCache.get(key);
  if (cached) return cached;

  const unit = (size / FIGURE_UNITS) * DENSITY;
  const bodyKey = `${id}|${look}|${size}|body`;
  let body = rigCache.get(bodyKey);
  if (!body) {
    const parts = {} as Record<PartName, PartSprite>;
    for (const name of PART_ORDER) parts[name] = renderPart(resting[name], look, unit, seed);
    const toPx = (p: Pt): Pt => [(p[0] * size) / FIGURE_UNITS, (p[1] * size) / FIGURE_UNITS];
    body = {
      parts,
      pivots: {
        waist: toPx(resting.pivots.waist),
        neck: toPx(resting.pivots.neck),
        shoulderLeft: toPx(resting.pivots.shoulderLeft),
        shoulderRight: toPx(resting.pivots.shoulderRight),
      },
      lean: resting.lean,
      height: size,
      density: DENSITY,
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
            head: renderPart(figureParts(createSeededRng(seed), { height: FIGURE_UNITS, expression: mood }).head, look, unit, seed),
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
  /** Seconds, any clock that runs steadily. */
  time: number;
}

interface MotionMemory {
  move: number;
  flip: number;
  talk: number;
  think: number;
  time: number;
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
  const memory = motionMemory.get(motion.id) ?? { move: 0, flip: 1, talk: 0, think: 0, time: motion.time };
  const dt = Math.max(0, Math.min(0.1, motion.time - memory.time));
  memory.time = motion.time;
  memory.move = approach(memory.move, motion.moving ? 1 : 0, 5, dt);
  const flipTarget = motion.facing === 'left' ? -1 : motion.facing === 'right' ? 1 : memory.flip >= 0 ? 1 : -1;
  memory.flip = approach(memory.flip, flipTarget, 9, dt);
  memory.talk = approach(memory.talk, motion.state === 'speaking' ? 1 : 0, 4, dt);
  memory.think = approach(memory.think, motion.state === 'thinking' ? 1 : 0, 3, dt);
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

  const lift = move * Math.abs(step) * h * 0.05;
  const squashY = 1 - move * 0.06 * contact + still * 0.01 * breath;
  const squashX = 1 + move * 0.05 * contact - still * 0.006 * breath;
  const facingSign = memory.flip >= 0 ? 1 : -1;
  const turnScale = Math.sign(memory.flip || 1) * Math.max(0.12, Math.abs(memory.flip));
  const bodyRotate = rig.lean + move * 0.07 * facingSign + still * Math.sin(t * 0.6 + phase) * 0.012;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(tileX + tileDim / 2, tileY + tileDim - 3 - lift);
  ctx.rotate(bodyRotate);
  ctx.scale(turnScale * squashX, squashY);

  const { waist, neck, shoulderLeft, shoulderRight } = rig.pivots;
  const density = rig.density;

  ctx.save();
  ctx.translate(move * step * h * 0.018, 0);
  drawPart(ctx, rig.parts.legs, density);
  ctx.restore();

  ctx.save();
  const skirtSwing = move * Math.sin(stride - 0.9) * 0.07 + still * Math.sin(t * 0.8 + phase) * 0.018;
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

  const swing = move * step * 0.38;
  const drift = still * Math.sin(t * 1.1 + phase) * 0.045;
  ctx.save();
  ctx.translate(0, neckRise);
  aboutPivot(ctx, shoulderLeft, -swing + drift);
  drawPart(ctx, rig.parts.armLeft, density);
  ctx.restore();

  ctx.save();
  ctx.translate(0, neckRise);
  const gesture = talk * (-0.3 - 0.18 * Math.sin(t * 4.6 + phase));
  aboutPivot(ctx, shoulderRight, swing - drift + gesture);
  drawPart(ctx, rig.parts.armRight, density);
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
  const palette = PALETTES[look];
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
