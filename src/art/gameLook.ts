/**
 * Draws the running game through the art system: the world as one cached layer and each
 * character as a cached figure, in whichever look is selected.
 */
import { createSeededRng, hashString } from '../core/rng';
import type { VillageMap } from '../engine/types';
import { PALETTES, paintLinen, renderEmbroidery, renderLineArt, type LookOptions, type PaletteName } from './looks';
import { figure } from './motifs';
import { buildSceneModel, type TileSemantics } from './scene';
import { UNITS_PER_TILE, sceneShapes } from './sceneArt';
import { bounds } from './shapes';

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

export interface FigureSprite {
  canvas: HTMLCanvasElement;
  /** Where the figure's feet (bottom centre) sit inside the canvas, in canvas pixels. */
  footX: number;
  footY: number;
  /** Canvas pixels per on-screen pixel at the size the sprite was made for. */
  density: number;
}

const FIGURE_UNITS = 30;
const figureCache = new Map<string, FigureSprite>();

/** A character's figure in a look, generated once from their id and cached. */
export function getFigureSprite(id: string, look: PaletteName, heightPx: number): FigureSprite {
  const size = Math.max(16, Math.round(heightPx));
  const key = `${id}|${look}|${size}`;
  const cached = figureCache.get(key);
  if (cached) return cached;

  const density = 3;
  const unit = (size / FIGURE_UNITS) * density;
  const shapes = figure(createSeededRng(hashString(id)), { height: FIGURE_UNITS });
  const box = bounds(shapes);
  const pad = 2.5;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((box.maxX - box.minX + pad * 2) * unit);
  canvas.height = Math.ceil((box.maxY - box.minY + pad * 2) * unit);
  const origin: [number, number] = [(-box.minX + pad) * unit, (-box.minY + pad) * unit];
  const ctx = canvas.getContext('2d')!;
  const options: LookOptions = { unit, origin, palette: PALETTES[look], seed: hashString(id) };
  if (isThread(look)) renderEmbroidery(ctx, shapes, options);
  else renderLineArt(ctx, shapes, options);

  const sprite: FigureSprite = { canvas, footX: origin[0], footY: origin[1], density };
  if (figureCache.size > 160) figureCache.clear();
  figureCache.set(key, sprite);
  return sprite;
}

/**
 * Paints a figure standing on a tile. Walking is a sway and a bob about the feet, so no
 * extra frames need generating.
 */
export function paintFigure(
  ctx: CanvasRenderingContext2D,
  sprite: FigureSprite,
  tileX: number,
  tileY: number,
  tileDim: number,
  facingLeft: boolean,
  moving: boolean,
  animPhase: number,
) {
  const footX = tileX + tileDim / 2;
  const footY = tileY + tileDim - 3;
  const sway = moving ? Math.sin(animPhase * 1.6) * 0.07 : 0;
  const bob = moving ? Math.abs(Math.sin(animPhase * 1.6)) * tileDim * 0.05 : 0;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(footX, footY - bob);
  ctx.rotate(sway);
  ctx.scale((facingLeft ? -1 : 1) / sprite.density, 1 / sprite.density);
  ctx.drawImage(sprite.canvas, -sprite.footX, -sprite.footY);
  ctx.restore();
}
