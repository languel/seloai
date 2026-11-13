import { ANIMATION_CATALOG, SPRITESHEET_PRESETS } from '../data/defaultData';
import { data as playerSpritesheet } from '../data/spritesheets/player';
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

const imageCache = new Map<string, HTMLImageElement>();

export function getCachedImage(url: string): HTMLImageElement | null {
  if (!url) return null;
  const existing = imageCache.get(url);
  if (existing) return existing.complete && existing.naturalWidth > 0 ? imgOrNull(existing) : null;

  const img = new Image();
  const resolvedUrl = resolvePublicUrl(url);
  if (!resolvedUrl.startsWith('data:')) {
    img.crossOrigin = 'anonymous';
  }
  img.src = resolvedUrl;
  imageCache.set(url, img);
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

export function getPresetSpriteFrame(
  spritesheetId: string,
  facing: Direction,
  animFrame: number,
  isMoving: boolean,
): { url: string; sx: number; sy: number; sw: number; sh: number } | null {
  const preset = SPRITESHEET_PRESETS.find((p) => p.id === spritesheetId) ?? SPRITESHEET_PRESETS[0];
  if (!preset) return null;
  const seq = preset.data.animations?.[facing] ?? [facing];
  const frameName = isMoving ? seq[Math.floor(animFrame) % seq.length] : seq[0];
  const frame = preset.data.frames[frameName]?.frame;
  if (!frame) return null;
  return {
    url: preset.textureUrl,
    sx: frame.x,
    sy: frame.y,
    sw: frame.w,
    sh: frame.h,
  };
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
export function resolveOverlappingRects(
  inputs: OverlayRectInput[],
  pad = 4,
): Map<string, ResolvedOverlayRect> {
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

    const firstBlocker = collidesAny(cand.x, cand.y);
    if (firstBlocker) {
      const candidateCoords: Array<{ x: number; y: number }> = [];
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

      addAround(firstBlocker);
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
        if (collidesAny(c.x, c.y)) continue;
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
      }
    }

    placed.push(cand);
    result.set(cand.id, cand);
  }

  return result;
}

export interface QueuedOverlayItem {
  rect: OverlayRectInput;
  layerOrder: number; // 0 = poi/name pills, 1 = thoughts, 2 = speech
  render: (rx: number, ry: number) => void;
}

export interface CanvasOverlayCollector {
  items: QueuedOverlayItem[];
}

export function createOverlayCollector(): CanvasOverlayCollector {
  return { items: [] };
}

export function drawResolvedOverlays(
  ctx: CanvasRenderingContext2D,
  collector: CanvasOverlayCollector,
  deoverlap = true,
) {
  const sorted = [...collector.items].sort((a, b) => a.layerOrder - b.layerOrder);
  const resolved = deoverlap
    ? resolveOverlappingRects(
        sorted.map((it) => it.rect),
        4,
      )
    : null;

  ctx.save();
  for (const item of sorted) {
    const pos = resolved?.get(item.rect.id);
    item.render(pos?.x ?? item.rect.x, pos?.y ?? item.rect.y);
  }
  ctx.restore();
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
    ctx.strokeStyle = '#fffbeb';
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
    const pillH = Math.max(14, pxFontSize + 5);
    const idealX = cx - tw / 2;
    const idealY = cy - pillH - 9;

    const paintPill = (rx: number, ry: number) => {
      ctx.save();
      ctx.font = `700 ${pxFontSize}px ${theme.fontFamily}`;
      const dist = Math.hypot(rx + tw / 2 - cx, ry + pillH / 2 - (idealY + pillH / 2));
      if (dist > 6) {
        ctx.strokeStyle = theme.poiBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(rx + tw / 2, ry + pillH / 2);
        ctx.stroke();
      }
      ctx.fillStyle = theme.poiFill;
      ctx.strokeStyle = theme.poiBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(rx, ry, tw, pillH, 5);
      ctx.fill();
      ctx.stroke();
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
}

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
    : getPresetSpriteFrame(cfg.spritesheetId, rt.facing, rt.animFrame, isMoving);

  const px = rt.x * tileDim;
  const py = rt.y * tileDim;

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

  if (frame) {
    const img = getCachedImage(frame.url);
    if (img) {
      drawFootAnchoredSprite(ctx, img, frame.sx, frame.sy, frame.sw, frame.sh, px, py, tileDim, charScale);
    } else {
      ctx.fillStyle = cfg.accentColor;
      ctx.fillRect(px + 6, py + 4, tileDim - 12, tileDim - 8);
    }
  }

  const headTopY = py + tileDim - 4 - tileDim * charScale;
  const centerX = px + tileDim / 2;

  // Name pill
  if (showLabels) {
    const labelSize = Math.round(10 * theme.fontScale);
    ctx.font = `600 ${labelSize}px ${theme.fontFamily}`;
    const label = cfg.name;
    const pillW = ctx.measureText(label).width + 12;
    const pillH = Math.max(14, labelSize + 5);
    const idealX = centerX - pillW / 2;
    const idealY = py + tileDim + 1;

    const paintNamePill = (rx: number, ry: number) => {
      ctx.save();
      ctx.font = `600 ${labelSize}px ${theme.fontFamily}`;
      const dist = Math.hypot(rx + pillW / 2 - centerX, ry - idealY);
      if (dist > 6) {
        ctx.strokeStyle = selected ? cfg.accentColor : theme.namePillBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, py + tileDim - 1);
        ctx.lineTo(rx + pillW / 2, ry + pillH / 2);
        ctx.stroke();
      }
      ctx.fillStyle = theme.namePillFill;
      ctx.strokeStyle = selected ? cfg.accentColor : theme.namePillBorder;
      ctx.lineWidth = selected ? 1.4 : 1;
      ctx.beginPath();
      ctx.roundRect(rx, ry, pillW, pillH, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.namePillText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rx + pillW / 2, ry + pillH / 2 + 0.5);
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
        render: paintNamePill,
      });
    } else {
      paintNamePill(idealX, idealY);
    }
  }

  // Activity status indicator dot
  if (rt.state === 'thinking' || rt.state === 'speaking' || rt.state === 'listening') {
    const badgeColor =
      rt.state === 'speaking' ? '#e05a5a' : rt.state === 'listening' ? '#1fb5c9' : '#e6a945';
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.arc(centerX + (tileDim * charScale) * 0.36, headTopY + 5, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#181614';
    ctx.lineWidth = 1.2;
    ctx.stroke();
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
        render: paintSpeech,
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
        render: paintThought,
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
  theme?: CanvasThemeConfig;
  collector?: CanvasOverlayCollector;
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
  if (customSprite) {
    const frame = getCustomSpriteFrame(customSprite, player.facing, player.animFrame, isMoving);
    const img = getCachedImage(frame.url);
    if (img) {
      drawFootAnchoredSprite(ctx, img, frame.sx, frame.sy, frame.sw, frame.sh, px, py, tileDim, charScale);
    }
  } else {
    const img = getCachedImage('/assets/player.png');
    const flipHorizontal = player.facing === 'right';
    const lookupDir: Direction = flipHorizontal ? 'left' : player.facing;
    const rawSeq = playerSpritesheet.animations?.[lookupDir] ?? ['down', 'down2', 'down3'];
    const walkCycle = rawSeq.length >= 3 ? [rawSeq[0], rawSeq[1], rawSeq[2], rawSeq[1]] : rawSeq;
    const idleFrame = rawSeq[1] ?? rawSeq[0];
    const frameName = isMoving ? walkCycle[Math.floor(player.animFrame) % walkCycle.length] : idleFrame;
    const frame = playerSpritesheet.frames[frameName]?.frame;
    if (img && frame) {
      drawFootAnchoredSprite(
        ctx,
        img,
        frame.x,
        frame.y,
        frame.w,
        frame.h,
        px,
        py,
        tileDim,
        charScale,
        flipHorizontal,
      );
    }
  }

  if (showLabels) {
    const labelSize = Math.round(10 * theme.fontScale);
    ctx.font = `600 ${labelSize}px ${theme.fontFamily}`;
    const label = 'You';
    const tw = ctx.measureText(label).width + 12;
    const pillH = Math.max(14, labelSize + 5);
    const idealX = centerX - tw / 2;
    const idealY = py + tileDim + 1;

    const paintPlayerPill = (rx: number, ry: number) => {
      ctx.save();
      ctx.font = `600 ${labelSize}px ${theme.fontFamily}`;
      const dist = Math.hypot(rx + tw / 2 - centerX, ry - idealY);
      if (dist > 6) {
        ctx.strokeStyle = theme.playerPillBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, py + tileDim - 1);
        ctx.lineTo(rx + tw / 2, ry + pillH / 2);
        ctx.stroke();
      }
      ctx.fillStyle = theme.playerPillFill;
      ctx.strokeStyle = theme.playerPillBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(rx, ry, tw, pillH, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fbf7ef';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rx + tw / 2, ry + pillH / 2 + 0.5);
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
  const basePx = (isThought ? 10 : 10.5) * theme.fontScale;
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
  const lineH = (isThought ? 12.5 : 13.5) * theme.fontScale;
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
  const cornerRadius =
    theme.bubbleStyle === 'minimal-pill'
      ? Math.min(14, boxH / 2)
      : isThought
        ? 12
        : theme.bubbleStyle === 'embroidered-card'
          ? 5
          : 7;

  ctx.save();
  ctx.shadowColor = 'rgba(8, 8, 12, 0.36)';
  ctx.shadowBlur = 10;
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
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, cornerRadius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();

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
    ctx.fillStyle = isThought ? theme.thoughtBorder : accentColor || theme.speechHighlight;
    ctx.beginPath();
    ctx.roundRect(trackX, thumbY, 2.5, thumbH, 1.25);
    ctx.fill();
  }

  ctx.restore();
}
