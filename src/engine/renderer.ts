import { ANIMATION_CATALOG } from '../data/defaultData';
import { PALETTES } from '../art/looks';
import { drawBubbleBox, drawBubbleTail, drawBubbleThread, drawRibbon } from '../art/overlayChrome';
import {
  DEFAULT_AESTHETIC_SETTINGS,
  resolveAestheticTokens,
  type CanvasThemeConfig,
} from '../utils/aestheticThemes';
import { resolvePublicUrl } from '../utils/assetUrl';
import { tokenizeRichText } from '../utils/formatNames';
import type {
  CustomSpriteSheet,
  Direction,
  PointOfInterest,
  TileGrid,
  VillageMap,
  VillagerConfig,
  VillagerRuntime,
} from './types';
import type { PlayerAvatar } from './simulation';

const DEFAULT_CANVAS_THEME: CanvasThemeConfig = resolveAestheticTokens(
  DEFAULT_AESTHETIC_SETTINGS,
  'classic',
).canvasTheme;

const MAX_IMAGE_CACHE_SIZE = 72;
const imageCache = new Map<string, HTMLImageElement>();

function evictOldestDynamicImageIfFull() {
  if (imageCache.size <= MAX_IMAGE_CACHE_SIZE) return;
  // Prefer evicting generated `data:` URLs first before static `/assets/...` sprite sheets
  let candidateKey: string | null = null;
  for (const key of imageCache.keys()) {
    if (key.startsWith('data:')) {
      candidateKey = key;
      break;
    }
  }
  if (!candidateKey) {
    candidateKey = imageCache.keys().next().value ?? null;
  }
  if (!candidateKey) return;
  const old = imageCache.get(candidateKey);
  imageCache.delete(candidateKey);
  if (old) {
    old.onload = null;
    old.onerror = null;
    if (candidateKey.startsWith('data:')) {
      old.src = '';
    }
  }
}

export function getImageCacheStats(): {
  totalEntries: number;
  dataUrlEntries: number;
  loadedEntries: number;
} {
  let dataUrlEntries = 0;
  let loadedEntries = 0;
  for (const [key, img] of imageCache.entries()) {
    if (key.startsWith('data:')) dataUrlEntries += 1;
    if (img.complete && img.naturalWidth > 0) loadedEntries += 1;
  }
  return {
    totalEntries: imageCache.size,
    dataUrlEntries,
    loadedEntries,
  };
}

export function pruneImageCache(keepUrls?: Set<string>): number {
  let removed = 0;
  for (const [key, img] of [...imageCache.entries()]) {
    if (keepUrls?.has(key)) continue;
    // Keep lightweight built-in asset sheets unless cache exceeds cap; always prune stale data URLs
    if (!key.startsWith('data:') && imageCache.size - removed <= 32) continue;
    imageCache.delete(key);
    img.onload = null;
    img.onerror = null;
    if (key.startsWith('data:')) {
      img.src = '';
    }
    removed += 1;
  }
  return removed;
}

export function getCachedImage(url: string): HTMLImageElement | null {
  if (!url) return null;
  const existing = imageCache.get(url);
  if (existing) {
    // Refresh LRU position
    imageCache.delete(url);
    imageCache.set(url, existing);
    return existing.complete && existing.naturalWidth > 0 ? imgOrNull(existing) : null;
  }

  const img = new Image();
  const resolvedUrl = resolvePublicUrl(url);
  if (!resolvedUrl.startsWith('data:')) {
    img.crossOrigin = 'anonymous';
  }
  img.src = resolvedUrl;
  imageCache.set(url, img);
  evictOldestDynamicImageIfFull();
  return imgOrNull(img);
}

function imgOrNull(img: HTMLImageElement): HTMLImageElement | null {
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function drawTileGrid(
  ctx: CanvasRenderingContext2D,
  tilesetImg: HTMLImageElement,
  grid: TileGrid,
  tileDim: number,
  tilesetCols: number,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let x = 0; x < grid.length; x++) {
    const col = grid[x];
    if (!col) continue;
    for (let y = 0; y < col.length; y++) {
      const idx = col[y];
      if (idx === -1 || idx === undefined) continue;
      const sx = (idx % tilesetCols) * tileDim;
      const sy = Math.floor(idx / tilesetCols) * tileDim;
      ctx.drawImage(tilesetImg, sx, sy, tileDim, tileDim, x * tileDim, y * tileDim, tileDim, tileDim);
    }
  }
  ctx.restore();
}

export function drawAnimatedSprites(
  ctx: CanvasRenderingContext2D,
  map: VillageMap,
  timeSec: number,
  layerFilter?: number,
) {
  for (const placement of map.animatedSprites) {
    if (layerFilter !== undefined && placement.layer !== layerFilter) continue;
    const entry = ANIMATION_CATALOG[placement.sheet];
    if (!entry) continue;
    const img = getCachedImage(entry.url);
    if (!img) continue;

    const animFrames: string[] = entry.spritesheet?.animations?.[placement.animation] ?? [];
    if (animFrames.length === 0) continue;
    const frameIndex = Math.floor(timeSec * 6) % animFrames.length;
    const frameKey = animFrames[frameIndex];
    const frameRect = entry.spritesheet?.frames?.[frameKey]?.frame;
    if (!frameRect) continue;

    ctx.drawImage(
      img,
      frameRect.x,
      frameRect.y,
      frameRect.w,
      frameRect.h,
      placement.x,
      placement.y,
      placement.w,
      placement.h,
    );
  }
}

export function getCustomSpriteFrame(
  custom: CustomSpriteSheet,
  facing: Direction,
  animFrame: number,
  isMoving: boolean,
): { url: string; sx: number; sy: number; sw: number; sh: number } {
  const row = custom.rowMap[facing] ?? 0;
  const col = isMoving ? Math.floor(animFrame) % Math.max(1, custom.framesPerDirection) : 0;
  return {
    url: custom.textureUrl,
    sx: col * custom.frameWidth,
    sy: row * custom.frameHeight,
    sw: custom.frameWidth,
    sh: custom.frameHeight,
  };
}

export interface OverlayRectInput {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
  priority: number;
  preferAbove?: boolean;
  /** Placed exactly where given, never moved: space claimed by a character's body. */
  fixed?: boolean;
}

export interface ResolvedOverlayRect extends OverlayRectInput {
  idealX: number;
  idealY: number;
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  pad: number,
): boolean {
  return (
    ax < bx + bw + pad &&
    ax + aw + pad > bx &&
    ay < by + bh + pad &&
    ay + ah + pad > by
  );
}

/**
 * Deterministic 2D box de-overlapper so neighboring villagers' name pills, POI markers,
 * and floating dialogue/thought bubbles stay separated and readable around crowds.
 */
export interface OverlayBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function resolveOverlappingRects(
  inputs: OverlayRectInput[],
  pad = 4,
  bounds?: OverlayBounds,
): Map<string, ResolvedOverlayRect> {
  // A rect may leave the bounds only if it cannot fit inside them at all.
  const anchorVisible = (r: OverlayRectInput) =>
    !!bounds &&
    r.anchorX >= bounds.x &&
    r.anchorX <= bounds.x + bounds.w &&
    r.anchorY >= bounds.y &&
    r.anchorY <= bounds.y + bounds.h;
  const inside = (r: OverlayRectInput, x: number, y: number) =>
    !bounds ||
    r.fixed ||
    !anchorVisible(r) ||
    r.w > bounds.w - pad * 2 ||
    r.h > bounds.h - pad * 2 ||
    (x >= bounds.x + pad && y >= bounds.y + pad && x + r.w <= bounds.x + bounds.w - pad && y + r.h <= bounds.y + bounds.h - pad);
  const clampInto = (r: OverlayRectInput, x: number, y: number) =>
    bounds
      ? {
          x: Math.max(bounds.x + pad, Math.min(bounds.x + bounds.w - pad - r.w, x)),
          y: Math.max(bounds.y + pad, Math.min(bounds.y + bounds.h - pad - r.h, y)),
        }
      : { x, y };
  const sorted = [...inputs].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.y !== b.y) return a.y - b.y;
    return a.id.localeCompare(b.id);
  });

  const placed: ResolvedOverlayRect[] = [];
  const result = new Map<string, ResolvedOverlayRect>();

  for (const item of sorted) {
    const idealX = item.x;
    const idealY = item.y;
    const cand: ResolvedOverlayRect = { ...item, idealX, idealY };

    const collidesAny = (cx: number, cy: number): ResolvedOverlayRect | null => {
      for (const other of placed) {
        if (rectsOverlap(cx, cy, item.w, item.h, other.x, other.y, other.w, other.h, pad)) {
          return other;
        }
      }
      return null;
    };

    if (item.fixed) {
      placed.push(cand);
      result.set(cand.id, cand);
      continue;
    }

    const firstBlocker = collidesAny(cand.x, cand.y);
    const outOfBounds = !inside(item, cand.x, cand.y);
    if (firstBlocker || outOfBounds) {
      const candidateCoords: Array<{ x: number; y: number }> = [];
      // Pulled back into view, and beside the speaker's anchor on either side.
      const clamped = clampInto(item, idealX, idealY);
      candidateCoords.push(clamped);
      if (item.preferAbove) {
        candidateCoords.push(clampInto(item, item.anchorX + 14, item.anchorY - item.h * 0.5));
        candidateCoords.push(clampInto(item, item.anchorX - 14 - item.w, item.anchorY - item.h * 0.5));
        candidateCoords.push(clampInto(item, item.anchorX + 14, item.anchorY));
        candidateCoords.push(clampInto(item, item.anchorX - 14 - item.w, item.anchorY));
      }
      const addAround = (b: ResolvedOverlayRect) => {
        // Above & below blocker
        candidateCoords.push({ x: idealX, y: b.y - pad - item.h });
        candidateCoords.push({ x: idealX, y: b.y + b.h + pad });
        // Left & right of blocker
        candidateCoords.push({ x: b.x - pad - item.w, y: idealY });
        candidateCoords.push({ x: b.x + b.w + pad, y: idealY });
        // Compact diagonals
        candidateCoords.push({ x: b.x - pad - item.w, y: b.y - pad - item.h });
        candidateCoords.push({ x: b.x + b.w + pad, y: b.y - pad - item.h });
        candidateCoords.push({ x: b.x - pad - item.w, y: b.y + b.h + pad });
        candidateCoords.push({ x: b.x + b.w + pad, y: b.y + b.h + pad });
      };

      if (firstBlocker) addAround(firstBlocker);
      // Include secondary rings above/below/aside existing nearby rects
      for (const other of placed) {
        if (
          Math.abs(other.x - idealX) < item.w + other.w + 48 &&
          Math.abs(other.y - idealY) < item.h + other.h + 48
        ) {
          addAround(other);
        }
      }
      // Radial spiral fallback
      for (const step of [18, 34, 52, 72]) {
        candidateCoords.push({ x: idealX, y: idealY - step });
        candidateCoords.push({ x: idealX, y: idealY + step });
        candidateCoords.push({ x: idealX - step, y: idealY - step * 0.5 });
        candidateCoords.push({ x: idealX + step, y: idealY - step * 0.5 });
        candidateCoords.push({ x: idealX - step * 1.3, y: idealY });
        candidateCoords.push({ x: idealX + step * 1.3, y: idealY });
      }

      let best: { x: number; y: number; score: number } | null = null;
      for (const c of candidateCoords) {
        if (collidesAny(c.x, c.y) || !inside(item, c.x, c.y)) continue;
        const dx = c.x - idealX;
        const dy = c.y - idealY;
        const downwardPenalty = item.preferAbove && dy > 0 ? dy * 1.45 : 0;
        const score = dx * dx + dy * dy + downwardPenalty * downwardPenalty;
        if (!best || score < best.score) {
          best = { x: c.x, y: c.y, score };
        }
      }

      if (best) {
        cand.x = best.x;
        cand.y = best.y;
      } else if (outOfBounds) {
        cand.x = clamped.x;
        cand.y = clamped.y;
      }
    }

    placed.push(cand);
    result.set(cand.id, cand);
  }

  return result;
}

export const SPEECH_BUBBLE_FONT_PX = 10.5;
export const SPEECH_BUBBLE_LINE_H_PX = 13.5;

export type OverlayLayerGroup = 'locations' | 'pills' | 'bubbles';

export interface DeferredCanvasDraw {
  y: number;
  draw: () => void;
}

export interface QueuedOverlayItem {
  rect: OverlayRectInput;
  layerOrder: number; // 0 = poi/name pills, 1 = thoughts, 2 = speech
  layerGroup?: OverlayLayerGroup;
  render: (rx: number, ry: number) => void;
  /** Drawn for every item of the group before any item's `render`, such as a leader thread. */
  renderUnder?: (rx: number, ry: number) => void;
}

export interface CanvasOverlayCollector {
  items: QueuedOverlayItem[];
}

export interface ResolvedOverlayBatch {
  sorted: QueuedOverlayItem[];
  resolved: Map<string, OverlayRectInput> | null;
}

/**
 * Claims the space a character's body occupies so that labels and bubbles are laid out
 * around it. Nothing is drawn; the layout simply treats the body as already placed.
 */
function reserveBodySpace(
  collector: CanvasOverlayCollector | undefined,
  id: string,
  centerX: number,
  topY: number,
  height: number,
) {
  if (!collector) return;
  const width = height * 0.5;
  collector.items.push({
    rect: { id, x: centerX - width / 2, y: topY, w: width, h: height * 0.82, anchorX: centerX, anchorY: topY, priority: 1000, fixed: true },
    layerOrder: 0,
    layerGroup: 'pills',
    render: () => {},
  });
}

export function createOverlayCollector(): CanvasOverlayCollector {
  return { items: [] };
}

export function resolveOverlayBatch(
  collector: CanvasOverlayCollector,
  deoverlap = true,
  /** The visible world area; bubbles and labels of visible speakers are kept inside it. */
  bounds?: OverlayBounds,
): ResolvedOverlayBatch {
  const sorted = [...collector.items].sort((a, b) => a.layerOrder - b.layerOrder);
  if (!deoverlap) {
    return { sorted, resolved: null };
  }
  // Keep location labels stationary as characters walk or talk near them: resolve static
  // landmarks only against other landmarks, and resolve dynamic pills/bubbles separately.
  const locationRects: OverlayRectInput[] = [];
  const dynamicRects: OverlayRectInput[] = [];
  for (const item of sorted) {
    const group: OverlayLayerGroup =
      item.layerGroup ?? (item.layerOrder === 0 ? 'pills' : 'bubbles');
    if (group === 'locations') {
      locationRects.push(item.rect);
    } else {
      dynamicRects.push(item.rect);
    }
  }
  const resolved = new Map<string, OverlayRectInput>();
  if (locationRects.length > 0) {
    for (const [k, v] of resolveOverlappingRects(locationRects, 4)) {
      resolved.set(k, v);
    }
  }
  if (dynamicRects.length > 0) {
    for (const [k, v] of resolveOverlappingRects(dynamicRects, 4, bounds)) {
      resolved.set(k, v);
    }
  }
  return { sorted, resolved };
}

export function renderOverlayBatch(
  ctx: CanvasRenderingContext2D,
  batch: ResolvedOverlayBatch,
  filter: OverlayLayerGroup | 'all' = 'all',
) {
  ctx.save();
  const items = batch.sorted.filter((item) => {
    const group: OverlayLayerGroup =
      item.layerGroup ?? (item.layerOrder === 0 ? 'pills' : 'bubbles');
    return filter === 'all' || group === filter;
  });
  const at = (item: QueuedOverlayItem) => {
    const pos = batch.resolved?.get(item.rect.id);
    return [pos?.x ?? item.rect.x, pos?.y ?? item.rect.y] as const;
  };
  for (const item of items) item.renderUnder?.(...at(item));
  for (const item of items) item.render(...at(item));
  ctx.restore();
}

export function drawResolvedOverlays(
  ctx: CanvasRenderingContext2D,
  collector: CanvasOverlayCollector,
  deoverlap = true,
  filter: OverlayLayerGroup | 'all' = 'all',
) {
  const batch = resolveOverlayBatch(collector, deoverlap);
  renderOverlayBatch(ctx, batch, filter);
}

function drawFootAnchoredSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  px: number,
  py: number,
  tileDim: number,
  characterScale: number,
  flipHorizontal = false,
) {
  const drawW = tileDim * characterScale;
  const drawH = tileDim * characterScale;
  const anchorBottomY = py + tileDim - 4;
  const drawX = px + (tileDim - drawW) / 2;
  const drawY = anchorBottomY - drawH;

  if (flipHorizontal) {
    ctx.save();
    ctx.translate(drawX + drawW, drawY);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, drawW, drawH);
    ctx.restore();
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
  }
}

export function drawPoiMarkers(
  ctx: CanvasRenderingContext2D,
  pois: PointOfInterest[],
  tileDim: number,
  theme: CanvasThemeConfig = DEFAULT_CANVAS_THEME,
  collector?: CanvasOverlayCollector,
) {
  if (pois.length === 0) return;
  const pxFontSize = Math.round(10 * theme.fontScale);
  ctx.save();
  ctx.font = `700 ${pxFontSize}px ${theme.fontFamily}`;
  for (const poi of pois) {
    const cx = (poi.x + 0.5) * tileDim;
    const cy = (poi.y + 0.5) * tileDim;

    // Diamond beacon on map floor
    ctx.fillStyle = theme.poiGemFill;
    ctx.strokeStyle = theme.artLook ? PALETTES[theme.artLook].ground : '#fffbeb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 6, cy);
    ctx.lineTo(cx, cy + 6);
    ctx.lineTo(cx - 6, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const labelText = poi.label || poi.tag;
    const tw = ctx.measureText(labelText).width + 12;
    // A ribbon needs room for a stitched rule above and below the words.
    const pillH = Math.max(14, pxFontSize + 5) + (theme.artLook ? 4 : 0);
    const idealX = cx - tw / 2;
    const idealY = cy - pillH - 9;

    const paintPill = (rx: number, ry: number) => {
      ctx.save();
      ctx.font = `700 ${pxFontSize}px ${theme.fontFamily}`;
      const dist = Math.hypot(rx + tw / 2 - cx, ry + pillH / 2 - (idealY + pillH / 2));
      if (dist > 6) {
        ctx.strokeStyle = theme.poiBorder;
        ctx.lineWidth = 1;
        if (theme.artLook) {
          ctx.setLineDash([3, 3]);
          ctx.globalAlpha = 0.6;
        }
        ctx.beginPath();
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(rx + tw / 2, ry + pillH / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (theme.artLook) {
        drawRibbon(ctx, theme.artLook, { x: rx, y: ry, w: tw, h: pillH }, { fill: theme.poiFill, ink: 'gold', ruleAbove: true });
      } else {
        ctx.fillStyle = theme.poiFill;
        ctx.strokeStyle = theme.poiBorder;
        ctx.lineWidth = 1;
        if (theme.stitched) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(rx, ry, tw, pillH, 5);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = theme.poiText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, rx + tw / 2, ry + pillH / 2 + 0.5);
      ctx.restore();
    };

    if (collector) {
      collector.items.push({
        rect: {
          id: `poi:${poi.tag}`,
          x: idealX,
          y: idealY,
          w: tw,
          h: pillH,
          anchorX: cx,
          anchorY: cy - 6,
          priority: 15,
        },
        layerOrder: 0,
        layerGroup: 'locations',
        render: paintPill,
      });
    } else {
      paintPill(idealX, idealY);
    }
  }
  ctx.restore();
}

export interface VillagerRenderOptions {
  showSpeechBubbles?: boolean;
  showThoughtBubbles?: boolean;
  pois?: PointOfInterest[];
  theme?: CanvasThemeConfig;
  collector?: CanvasOverlayCollector;
  deferredBodies?: DeferredCanvasDraw[];
  /** When set, draws the character's body in place of its sprite sheet (used by art looks). */
  bodyPainter?: BodyPainter;
  /** How tall the drawn body is relative to a sprite-sheet character (art figures are taller). */
  bodyHeightScale?: number;
}

export type BodyPainter = (
  ctx: CanvasRenderingContext2D,
  body: {
    id: string;
    tileX: number;
    tileY: number;
    tileDim: number;
    scale: number;
    facing: Direction;
    moving: boolean;
    animFrame: number;
    state?: string;
    /** What the character is saying now, if anything. */
    line?: string;
  },
) => void;

export function drawVillager(
  ctx: CanvasRenderingContext2D,
  cfg: VillagerConfig,
  rt: VillagerRuntime,
  tileDim: number,
  selected: boolean,
  showLabels = true,
  options: VillagerRenderOptions = {},
) {
  const theme = options.theme ?? DEFAULT_CANVAS_THEME;
  const charScale = theme.characterScale;
  const isMoving = rt.state === 'walking' || rt.path.length > 0;
  const frame = cfg.customSprite
    ? getCustomSpriteFrame(cfg.customSprite, rt.facing, rt.animFrame, isMoving)
    : null;

  const px = rt.x * tileDim;
  const py = rt.y * tileDim;
  const bodyHeight = tileDim * charScale * (options.bodyHeightScale ?? 1);
  const headTopY = py + tileDim - 4 - bodyHeight;
  const centerX = px + tileDim / 2;
  reserveBodySpace(options.collector, `body-${cfg.id}`, centerX, headTopY, bodyHeight);

  const paintBody = () => {
    ctx.save();
    // Ground shadow scaled gently with character size
    ctx.fillStyle = 'rgba(20, 18, 16, 0.28)';
    ctx.beginPath();
    ctx.ellipse(
      px + tileDim / 2,
      py + tileDim - 2,
      tileDim * 0.32 * Math.min(1.2, Math.max(0.85, charScale)),
      tileDim * 0.13 * Math.min(1.15, Math.max(0.85, charScale)),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Embroidered diamond selection ring
    if (selected) {
      ctx.strokeStyle = cfg.accentColor || '#b42828';
      ctx.lineWidth = 2;
      const cx = px + tileDim / 2;
      const cy = py + tileDim - 3;
      const rScale = Math.max(0.9, Math.min(1.2, charScale));
      ctx.beginPath();
      ctx.moveTo(cx, cy - 10 * rScale);
      ctx.lineTo(cx + 16 * rScale, cy);
      ctx.lineTo(cx, cy + 10 * rScale);
      ctx.lineTo(cx - 16 * rScale, cy);
      ctx.closePath();
      ctx.stroke();
    }

    if (options.bodyPainter) {
      options.bodyPainter(ctx, {
        id: cfg.id,
        tileX: px,
        tileY: py,
        tileDim,
        scale: charScale,
        facing: rt.facing,
        moving: isMoving,
        animFrame: rt.animFrame,
        state: rt.state,
        line: rt.currentBubble?.text,
      });
    } else if (frame) {
      const img = getCachedImage(frame.url);
      if (img) {
        drawFootAnchoredSprite(ctx, img, frame.sx, frame.sy, frame.sw, frame.sh, px, py, tileDim, charScale);
      } else {
        ctx.fillStyle = cfg.accentColor;
        ctx.fillRect(px + 6, py + 4, tileDim - 12, tileDim - 8);
      }
    }

    // Activity status indicator dot
    if (rt.state === 'thinking' || rt.state === 'speaking' || rt.state === 'listening') {
      const art = theme.artLook ? PALETTES[theme.artLook] : null;
      const badgeColor = art
        ? rt.state === 'speaking'
          ? art.inks.primary
          : rt.state === 'listening'
            ? art.inks.secondary
            : art.inks.gold
        : rt.state === 'speaking'
          ? '#e05a5a'
          : rt.state === 'listening'
            ? '#1fb5c9'
            : '#e6a945';
      ctx.fillStyle = badgeColor;
      ctx.beginPath();
      ctx.arc(centerX + (tileDim * charScale) * 0.36, headTopY + 5, art ? 3.2 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = art ? art.ground : '#181614';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  };

  if (options.deferredBodies) {
    options.deferredBodies.push({ y: rt.y, draw: paintBody });
  } else {
    paintBody();
  }

  ctx.save();

  // Name pill
  if (showLabels) {
    const labelSize = Math.round(10 * theme.fontScale);
    ctx.font = `600 ${labelSize}px ${theme.fontFamily}`;
    const label = cfg.name;
    const pillW = ctx.measureText(label).width + 12;
    const pillH = Math.max(14, labelSize + 5) + (theme.artLook ? 2 : 0);
    const idealX = centerX - pillW / 2;
    const idealY = py + tileDim + 1;

    const paintNamePill = (rx: number, ry: number) => {
      ctx.save();
      ctx.font = `600 ${labelSize}px ${theme.fontFamily}`;
      const dist = Math.hypot(rx + pillW / 2 - centerX, ry - idealY);
      if (dist > 6) {
        ctx.strokeStyle = selected ? cfg.accentColor : theme.namePillBorder;
        ctx.lineWidth = 1;
        if (theme.artLook) {
          ctx.setLineDash([3, 3]);
          ctx.globalAlpha = 0.6;
        }
        ctx.beginPath();
        ctx.moveTo(centerX, py + tileDim - 1);
        ctx.lineTo(rx + pillW / 2, ry + pillH / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (theme.artLook) {
        drawRibbon(
          ctx,
          theme.artLook,
          { x: rx, y: ry, w: pillW, h: pillH },
          { fill: theme.namePillFill, ink: selected ? 'primary' : 'dark', emphasis: selected },
        );
      } else {
        ctx.fillStyle = theme.namePillFill;
        ctx.strokeStyle = selected ? cfg.accentColor : theme.namePillBorder;
        ctx.lineWidth = selected ? 1.4 : 1;
        if (theme.stitched) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(rx, ry, pillW, pillH, 5);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = theme.namePillText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rx + pillW / 2, ry + pillH / 2 - (theme.artLook ? 0.5 : -0.5));
      ctx.restore();
    };

    if (options.collector) {
      options.collector.items.push({
        rect: {
          id: `name:${rt.id}`,
          x: idealX,
          y: idealY,
          w: pillW,
          h: pillH,
          anchorX: centerX,
          anchorY: py + tileDim - 1,
          priority: selected ? 32 : 20,
        },
        layerOrder: 0,
        layerGroup: 'pills',
        render: paintNamePill,
      });
    } else {
      paintNamePill(idealX, idealY);
    }
  }

  const showSpeech = options.showSpeechBubbles ?? true;
  const showThought = options.showThoughtBubbles ?? true;
  let bubbleBottomY = headTopY - 4;

  // Speech bubble (bottom-most above sprite head)
  if (showSpeech && rt.currentBubble?.text) {
    const layout = measureBubbleLayout(
      ctx,
      centerX,
      bubbleBottomY,
      rt.currentBubble.text,
      'speech',
      options.pois ?? [],
      theme,
    );
    const paintSpeech = (rx: number, ry: number) => {
      drawBubbleCardAt(
        ctx,
        rx,
        ry,
        layout,
        centerX,
        headTopY,
        rt.currentBubble!.startedAt,
        rt.currentBubble!.expiresAt,
        cfg.accentColor,
        'speech',
        theme,
      );
    };
    if (options.collector) {
      options.collector.items.push({
        rect: {
          id: `speech:${rt.id}`,
          x: layout.idealX,
          y: layout.idealY,
          w: layout.boxW,
          h: layout.boxH,
          anchorX: centerX,
          anchorY: headTopY,
          priority: selected ? 45 : 40,
          preferAbove: true,
        },
        layerOrder: 2,
        layerGroup: 'bubbles',
        render: paintSpeech,
        renderUnder: theme.artLook
          ? (rx, ry) =>
              drawBubbleThread(ctx, theme.artLook!, 'speech', { x: rx, y: ry, w: layout.boxW, h: layout.boxH }, [centerX, headTopY], 'dark')
          : undefined,
      });
    } else {
      paintSpeech(layout.idealX, layout.idealY);
    }
    bubbleBottomY = layout.idealY - 6;
  }

  // Thought bubble
  if (showThought && rt.currentThoughtBubble?.text) {
    const layout = measureBubbleLayout(
      ctx,
      centerX,
      bubbleBottomY,
      rt.currentThoughtBubble.text,
      'thought',
      options.pois ?? [],
      theme,
    );
    const paintThought = (rx: number, ry: number) => {
      drawBubbleCardAt(
        ctx,
        rx,
        ry,
        layout,
        centerX,
        headTopY,
        rt.currentThoughtBubble!.startedAt,
        rt.currentThoughtBubble!.expiresAt,
        cfg.accentColor,
        'thought',
        theme,
      );
    };
    if (options.collector) {
      options.collector.items.push({
        rect: {
          id: `thought:${rt.id}`,
          x: layout.idealX,
          y: layout.idealY,
          w: layout.boxW,
          h: layout.boxH,
          anchorX: centerX,
          anchorY: headTopY,
          priority: selected ? 38 : 34,
          preferAbove: true,
        },
        layerOrder: 1,
        layerGroup: 'bubbles',
        render: paintThought,
        renderUnder: theme.artLook
          ? (rx, ry) =>
              drawBubbleThread(ctx, theme.artLook!, 'thought', { x: rx, y: ry, w: layout.boxW, h: layout.boxH }, [centerX, headTopY], 'secondary')
          : undefined,
      });
    } else {
      paintThought(layout.idealX, layout.idealY);
    }
  }

  ctx.restore();
}

export interface PlayerRenderOptions {
  showLabels?: boolean;
  playerSprite?: CustomSpriteSheet | null;
  bodyPainter?: BodyPainter;
  bodyHeightScale?: number;
  theme?: CanvasThemeConfig;
  collector?: CanvasOverlayCollector;
  deferredBodies?: DeferredCanvasDraw[];
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: PlayerAvatar,
  tileDim: number,
  showLabelsOrOpts: boolean | PlayerRenderOptions = true,
) {
  const opts: PlayerRenderOptions =
    typeof showLabelsOrOpts === 'boolean' ? { showLabels: showLabelsOrOpts } : showLabelsOrOpts;
  const showLabels = opts.showLabels ?? true;
  const theme = opts.theme ?? DEFAULT_CANVAS_THEME;
  const charScale = theme.characterScale;
  const isMoving = player.isMoving || player.path.length > 0;
  const px = player.x * tileDim;
  const py = player.y * tileDim;
  const centerX = px + tileDim / 2;
  const playerBodyHeight = tileDim * charScale * (opts.bodyHeightScale ?? 1);
  reserveBodySpace(opts.collector, `body-${player.id}`, centerX, py + tileDim - 4 - playerBodyHeight, playerBodyHeight);

  const paintPlayerBody = () => {
    ctx.save();
    ctx.fillStyle = 'rgba(35, 67, 107, 0.34)';
    ctx.beginPath();
    ctx.ellipse(
      centerX,
      py + tileDim - 2,
      tileDim * 0.32 * Math.min(1.2, Math.max(0.85, charScale)),
      tileDim * 0.13 * Math.min(1.15, Math.max(0.85, charScale)),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    const customSprite = opts.playerSprite;
    if (opts.bodyPainter) {
      opts.bodyPainter(ctx, {
        id: player.id,
        tileX: px,
        tileY: py,
        tileDim,
        scale: charScale,
        facing: player.facing,
        moving: isMoving,
        animFrame: player.animFrame,
      });
    } else if (customSprite) {
      const frame = getCustomSpriteFrame(customSprite, player.facing, player.animFrame, isMoving);
      const img = getCachedImage(frame.url);
      if (img) {
        drawFootAnchoredSprite(ctx, img, frame.sx, frame.sy, frame.sw, frame.sh, px, py, tileDim, charScale);
      }
    }
    ctx.restore();
  };

  if (opts.deferredBodies) {
    opts.deferredBodies.push({ y: player.y, draw: paintPlayerBody });
  } else {
    paintPlayerBody();
  }

  ctx.save();

  if (showLabels) {
    const labelSize = Math.round(10 * theme.fontScale);
    ctx.font = `600 ${labelSize}px ${theme.fontFamily}`;
    const label = 'You';
    const tw = ctx.measureText(label).width + 12;
    const pillH = Math.max(14, labelSize + 5) + (theme.artLook ? 2 : 0);
    const idealX = centerX - tw / 2;
    const idealY = py + tileDim + 1;

    const paintPlayerPill = (rx: number, ry: number) => {
      ctx.save();
      ctx.font = `600 ${labelSize}px ${theme.fontFamily}`;
      const dist = Math.hypot(rx + tw / 2 - centerX, ry - idealY);
      if (dist > 6) {
        ctx.strokeStyle = theme.playerPillBorder;
        ctx.lineWidth = 1;
        if (theme.artLook) {
          ctx.setLineDash([3, 3]);
          ctx.globalAlpha = 0.6;
        }
        ctx.beginPath();
        ctx.moveTo(centerX, py + tileDim - 1);
        ctx.lineTo(rx + tw / 2, ry + pillH / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (theme.artLook) {
        drawRibbon(ctx, theme.artLook, { x: rx, y: ry, w: tw, h: pillH }, { fill: theme.playerPillFill, ink: 'primary', emphasis: true });
        ctx.fillStyle = theme.namePillText;
      } else {
        ctx.fillStyle = theme.playerPillFill;
        ctx.strokeStyle = theme.playerPillBorder;
        ctx.lineWidth = 1;
        if (theme.stitched) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(rx, ry, tw, pillH, 5);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fbf7ef';
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rx + tw / 2, ry + pillH / 2 - (theme.artLook ? 0.5 : -0.5));
      ctx.restore();
    };

    if (opts.collector) {
      opts.collector.items.push({
        rect: {
          id: 'name:player-you',
          x: idealX,
          y: idealY,
          w: tw,
          h: pillH,
          anchorX: centerX,
          anchorY: py + tileDim - 1,
          priority: 28,
        },
        layerOrder: 0,
        layerGroup: 'pills',
        render: paintPlayerPill,
      });
    } else {
      paintPlayerPill(idealX, idealY);
    }
  }
  ctx.restore();
}

interface StyledBubbleRun {
  text: string;
  bold: boolean;
}

interface MeasuredBubbleLayout {
  lines: StyledBubbleRun[][];
  visibleRows: number;
  lineH: number;
  padX: number;
  padY: number;
  hasOverflow: boolean;
  scrollGutter: number;
  boxW: number;
  boxH: number;
  tailSize: number;
  idealX: number;
  idealY: number;
}

function setBubbleFont(
  ctx: CanvasRenderingContext2D,
  isThought: boolean,
  bold: boolean,
  theme: CanvasThemeConfig,
) {
  const basePx = (isThought ? 10 : SPEECH_BUBBLE_FONT_PX) * theme.fontScale;
  ctx.font = isThought
    ? `italic ${bold ? 700 : 500} ${basePx.toFixed(1)}px ${theme.fontFamily}`
    : `${bold ? 700 : 500} ${basePx.toFixed(1)}px ${theme.fontFamily}`;
}

function measureBubbleLine(
  ctx: CanvasRenderingContext2D,
  runs: StyledBubbleRun[],
  isThought: boolean,
  theme: CanvasThemeConfig,
): number {
  let w = 0;
  for (const r of runs) {
    setBubbleFont(ctx, isThought, r.bold, theme);
    w += ctx.measureText(r.text).width;
  }
  return w;
}

function wrapBubbleLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxLineWidth: number,
  isThought: boolean,
  pois: PointOfInterest[],
  theme: CanvasThemeConfig,
): StyledBubbleRun[][] {
  const segments = tokenizeRichText(text, pois);
  const tokens: StyledBubbleRun[] = [];
  for (const seg of segments) {
    const bold = seg.kind === 'poi' || seg.kind === 'actor';
    const pieces = seg.text.split(/(\s+)/);
    for (const p of pieces) {
      if (p) tokens.push({ text: p, bold });
    }
  }

  const lines: StyledBubbleRun[][] = [];
  let current: StyledBubbleRun[] = [];
  let curW = 0;

  for (const tok of tokens) {
    if (/^\s+$/.test(tok.text) && current.length === 0) continue;
    setBubbleFont(ctx, isThought, tok.bold, theme);
    const tokW = ctx.measureText(tok.text).width;
    if (current.length > 0 && !/^\s+$/.test(tok.text) && curW + tokW > maxLineWidth) {
      while (current.length > 0 && /^\s+$/.test(current[current.length - 1].text)) {
        current.pop();
      }
      if (current.length > 0) lines.push(current);
      current = [tok];
      curW = tokW;
    } else {
      const prev = current[current.length - 1];
      if (prev && prev.bold === tok.bold) {
        prev.text += tok.text;
      } else {
        current.push({ ...tok });
      }
      curW += tokW;
    }
  }

  while (current.length > 0 && /^\s+$/.test(current[current.length - 1].text)) {
    current.pop();
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [[{ text: '', bold: false }]];
}

function measureBubbleLayout(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  bottomY: number,
  rawText: string,
  kind: 'speech' | 'thought',
  pois: PointOfInterest[],
  theme: CanvasThemeConfig,
): MeasuredBubbleLayout {
  const isThought = kind === 'thought';
  const maxChars = 480;
  const truncatedRaw = rawText.length > maxChars ? `${rawText.slice(0, maxChars - 1)}…` : rawText;

  const isMinimal = theme.bubbleStyle === 'minimal-pill';
  const scaleFactor = Math.max(0.9, Math.min(1.3, theme.fontScale));
  const maxLineWidth = (isThought ? (isMinimal ? 142 : 158) : isMinimal ? 150 : 168) * scaleFactor;
  const lines = wrapBubbleLines(ctx, truncatedRaw, maxLineWidth, isThought, pois, theme);
  const visibleRows = Math.min(3, lines.length);
  const lineH = (isThought ? 12.5 : SPEECH_BUBBLE_LINE_H_PX) * theme.fontScale;
  const padX = isMinimal ? 10 : isThought ? 10 : 9;
  const padY = isMinimal ? 5 : 6;
  const hasOverflow = lines.length > 3;
  const scrollGutter = hasOverflow ? 6 : 0;

  const boxW = Math.min(
    236 * scaleFactor,
    Math.max(
      56,
      ...lines.map((l) => Math.min(maxLineWidth, measureBubbleLine(ctx, l, isThought, theme)) + padX * 2 + scrollGutter),
    ),
  );
  const viewportH = visibleRows * lineH;
  const boxH = viewportH + padY * 2;
  const tailSize = isThought ? 8 : 6;
  const idealX = centerX - boxW / 2;
  const idealY = bottomY - boxH - tailSize;

  return {
    lines,
    visibleRows,
    lineH,
    padX,
    padY,
    hasOverflow,
    scrollGutter,
    boxW,
    boxH,
    tailSize,
    idealX,
    idealY,
  };
}

function drawBubbleCardAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: MeasuredBubbleLayout,
  anchorX: number,
  anchorY: number,
  startedAt: number | undefined,
  expiresAt: number,
  accentColor: string,
  kind: 'speech' | 'thought',
  theme: CanvasThemeConfig,
): void {
  const isThought = kind === 'thought';
  const { lines, lineH, padX, padY, hasOverflow, scrollGutter, boxW, boxH } = layout;
  const visibleRows = layout.visibleRows;
  const viewportH = visibleRows * lineH;

  ctx.save();
  if (theme.artLook) {
    const box = { x, y, w: boxW, h: boxH };
    const colours = isThought
      ? { fill: theme.thoughtFill, ink: 'secondary' as const }
      : { fill: theme.speechFill, ink: 'dark' as const };
    drawBubbleBox(ctx, theme.artLook, kind, box, colours);
    drawBubbleTail(ctx, theme.artLook, kind, box, [anchorX, anchorY], colours);
  } else {
    drawFlatBubbleShape(ctx, x, y, boxW, boxH, anchorX, anchorY, accentColor, isThought, theme);
  }

  // Smooth vertical auto-scroll for multi-line bubbles (> 3 lines)
  let scrollOffsetY = 0;
  let scrollFraction = 0;
  if (hasOverflow) {
    const maxScrollPx = (lines.length - 3) * lineH;
    const startMs = startedAt ?? expiresAt - Math.max(5500, lines.length * 1800);
    const elapsedMs = Math.max(0, Date.now() - startMs);
    const topHoldMs = 950;
    const scrollDurationMs = Math.max(1200, (maxScrollPx / 18) * 1000);
    const bottomHoldMs = 1100;
    const cycleMs = topHoldMs + scrollDurationMs + bottomHoldMs;
    const phase = elapsedMs % cycleMs;
    if (phase <= topHoldMs) {
      scrollFraction = 0;
    } else if (phase < topHoldMs + scrollDurationMs) {
      scrollFraction = (phase - topHoldMs) / scrollDurationMs;
    } else {
      scrollFraction = 1;
    }
    scrollOffsetY = scrollFraction * maxScrollPx;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + padY - 1, boxW - scrollGutter - 4, viewportH + 2);
  ctx.clip();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, idx) => {
    const drawY = y + padY + idx * lineH - scrollOffsetY;
    if (drawY + lineH >= y + padY - 2 && drawY <= y + padY + viewportH + 2) {
      let curX = x + padX;
      for (const run of line) {
        setBubbleFont(ctx, isThought, run.bold, theme);
        ctx.fillStyle = run.bold
          ? isThought
            ? theme.thoughtHighlight
            : theme.speechHighlight
          : isThought
            ? theme.thoughtText
            : theme.speechText;
        ctx.fillText(run.text, curX, drawY);
        curX += ctx.measureText(run.text).width;
      }
    }
  });
  ctx.restore();

  if (hasOverflow) {
    const trackX = x + boxW - 5;
    const trackY = y + padY;
    const trackH = Math.max(8, viewportH);
    const thumbH = Math.max(8, (3 / lines.length) * trackH);
    const thumbY = trackY + scrollFraction * (trackH - thumbH);
    ctx.fillStyle = isThought ? 'rgba(196, 181, 253, 0.22)' : 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.roundRect(trackX, trackY, 2.5, trackH, 1.25);
    ctx.fill();
    ctx.fillStyle = isThought
      ? theme.thoughtBorder
      : theme.artLook
        ? theme.speechBorder
        : accentColor || theme.speechHighlight;
    ctx.beginPath();
    ctx.roundRect(trackX, thumbY, 2.5, thumbH, 1.25);
    ctx.fill();
  }

  ctx.restore();
}

/** The classic flat card bubble, used by the tile look. */
function drawFlatBubbleShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  anchorX: number,
  anchorY: number,
  accentColor: string,
  isThought: boolean,
  theme: CanvasThemeConfig,
): void {
  const cornerRadius =
    theme.bubbleStyle === 'minimal-pill'
      ? Math.min(14, boxH / 2)
      : isThought
        ? 12
        : theme.bubbleStyle === 'embroidered-card'
          ? 5
          : 7;
  ctx.save();
  ctx.shadowColor = theme.stitched ? 'rgba(40, 26, 12, 0.22)' : 'rgba(8, 8, 12, 0.36)';
  ctx.shadowBlur = theme.stitched ? 5 : 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;

  // Compute tail anchor along nearest horizontal point on bubble bottom edge toward speaker head
  const tailBaseX = Math.max(x + 12, Math.min(x + boxW - 12, anchorX));
  const tailTipX = Math.max(x - 16, Math.min(x + boxW + 16, anchorX));
  const tailTipY = Math.max(y + boxH + 4, Math.min(anchorY + 2, y + boxH + 14));

  if (isThought) {
    ctx.fillStyle = theme.thoughtFill;
    ctx.strokeStyle = theme.thoughtBorder;
    ctx.lineWidth = 1.35;
    ctx.setLineDash([4, 2.5]);
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, cornerRadius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();
    ctx.setLineDash([]);

    // Trailing thought dots stepping smoothly from bubble edge toward speaker head
    const dot1X = tailBaseX * 0.72 + tailTipX * 0.28;
    const dot1Y = y + boxH + 3.5;
    const dot2X = tailBaseX * 0.35 + tailTipX * 0.65;
    const dot2Y = Math.min(tailTipY, y + boxH + 8);
    for (const [dx, dy, r] of [
      [dot1X, dot1Y, 2.4],
      [dot2X, dot2Y, 1.6],
    ] as const) {
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = theme.speechFill;
    ctx.strokeStyle = theme.bubbleStyle === 'parchment-scroll' ? accentColor || theme.speechBorder : theme.speechBorder;
    ctx.lineWidth = theme.stitched ? 1.6 : 1.35;
    if (theme.stitched) ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, cornerRadius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();
    ctx.setLineDash([]);

    // Inner glass specular top rim for depth matching the Scribe subtitle glass
    if (theme.bubbleStyle === 'frosted-glass' || theme.bubbleStyle === 'embroidered-card') {
      ctx.strokeStyle = theme.speechRimLight;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, Math.max(2, boxW - 2), Math.max(2, boxH - 2), Math.max(2, cornerRadius - 1));
      ctx.stroke();
    }

    // Subtle accent bar on left edge for frosted/minimal bubbles or corner stitch ticks for embroidered style
    if (theme.bubbleStyle === 'embroidered-card' || theme.showDecorations) {
      if (theme.bubbleStyle === 'embroidered-card') {
        ctx.fillStyle = theme.speechHighlight;
        ctx.fillRect(x + 3, y + 3, 2, 2);
        ctx.fillRect(x + boxW - 5, y + 3, 2, 2);
        ctx.fillRect(x + 3, y + boxH - 5, 2, 2);
        ctx.fillRect(x + boxW - 5, y + boxH - 5, 2, 2);
      } else {
        ctx.fillStyle = accentColor || theme.speechHighlight;
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 4, 2, Math.max(6, boxH - 8), 1);
        ctx.fill();
      }
    }

    // Pointer tail toward speaker head
    ctx.fillStyle = theme.speechFill;
    ctx.strokeStyle =
      theme.bubbleStyle === 'parchment-scroll' ? accentColor || theme.speechBorder : theme.speechBorder;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(tailBaseX - 4.5, y + boxH - 0.5);
    ctx.lineTo(tailTipX, tailTipY);
    ctx.lineTo(tailBaseX + 4.5, y + boxH - 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cover inner border seam cleanly
    ctx.strokeStyle = theme.speechFill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tailBaseX - 3.6, y + boxH);
    ctx.lineTo(tailBaseX + 3.6, y + boxH);
    ctx.stroke();
  }
  ctx.restore();
}
