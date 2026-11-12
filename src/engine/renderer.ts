import { ANIMATION_CATALOG, SPRITESHEET_PRESETS } from '../data/defaultData';
import { data as playerSpritesheet } from '../data/spritesheets/player';
import type {
  CustomSpriteSheet,
  Direction,
  TileGrid,
  VillageMap,
  VillagerConfig,
  VillagerRuntime,
} from './types';
import type { PlayerAvatar } from './simulation';

const imageCache = new Map<string, HTMLImageElement>();

export function getCachedImage(url: string): HTMLImageElement | null {
  if (!url) return null;
  const existing = imageCache.get(url);
  if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null;

  const img = new Image();
  if (!url.startsWith('data:')) {
    img.crossOrigin = 'anonymous';
  }
  img.src = url;
  imageCache.set(url, img);
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

export function drawVillager(
  ctx: CanvasRenderingContext2D,
  cfg: VillagerConfig,
  rt: VillagerRuntime,
  tileDim: number,
  selected: boolean,
  showLabels = true,
) {
  const isMoving = rt.state === 'walking' || rt.path.length > 0;
  const frame = cfg.customSprite
    ? getCustomSpriteFrame(cfg.customSprite, rt.facing, rt.animFrame, isMoving)
    : getPresetSpriteFrame(cfg.spritesheetId, rt.facing, rt.animFrame, isMoving);

  const px = rt.x * tileDim;
  const py = rt.y * tileDim;

  // Ground shadow
  ctx.save();
  ctx.fillStyle = 'rgba(20, 18, 16, 0.28)';
  ctx.beginPath();
  ctx.ellipse(px + tileDim / 2, py + tileDim - 2, tileDim * 0.34, tileDim * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Embroidered diamond selection ring
  if (selected) {
    ctx.strokeStyle = cfg.accentColor || '#b42828';
    ctx.lineWidth = 2;
    const cx = px + tileDim / 2;
    const cy = py + tileDim - 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx + 16, cy);
    ctx.lineTo(cx, cy + 10);
    ctx.lineTo(cx - 16, cy);
    ctx.closePath();
    ctx.stroke();
  }

  if (frame) {
    const img = getCachedImage(frame.url);
    if (img) {
      ctx.drawImage(img, frame.sx, frame.sy, frame.sw, frame.sh, px, py - 4, tileDim, tileDim);
    } else {
      ctx.fillStyle = cfg.accentColor;
      ctx.fillRect(px + 6, py + 4, tileDim - 12, tileDim - 8);
    }
  }

  // Name pill
  if (showLabels) {
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    const label = cfg.name;
    const textW = ctx.measureText(label).width;
    const pillW = textW + 10;
    const pillX = px + tileDim / 2 - pillW / 2;
    const pillY = py + tileDim + 1;
    ctx.fillStyle = 'rgba(24, 22, 20, 0.78)';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#fbf7ef';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + tileDim / 2, pillY + 7.5);
  }

  // Activity status indicator dot
  if (rt.state === 'thinking' || rt.state === 'speaking' || rt.state === 'listening') {
    const badgeColor =
      rt.state === 'speaking' ? '#e05a5a' : rt.state === 'listening' ? '#1fb5c9' : '#e6a945';
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.arc(px + tileDim - 3, py - 2, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#181614';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Speech bubble
  if (rt.currentBubble?.text) {
    drawSpeechBubble(ctx, px + tileDim / 2, py - 10, rt.currentBubble.text, cfg.accentColor);
  }

  ctx.restore();
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: PlayerAvatar,
  tileDim: number,
  showLabels = true,
) {
  const img = getCachedImage('/assets/player.png');
  const isMoving = player.isMoving || player.path.length > 0;
  const flipHorizontal = player.facing === 'right';
  const lookupDir: Direction = flipHorizontal ? 'left' : player.facing;
  const rawSeq = playerSpritesheet.animations?.[lookupDir] ?? ['down', 'down2', 'down3'];
  // 4-beat stride cycle using middle frame as neutral standing pose
  const walkCycle = rawSeq.length >= 3 ? [rawSeq[0], rawSeq[1], rawSeq[2], rawSeq[1]] : rawSeq;
  const idleFrame = rawSeq[1] ?? rawSeq[0];
  const frameName = isMoving ? walkCycle[Math.floor(player.animFrame) % walkCycle.length] : idleFrame;
  const frame = playerSpritesheet.frames[frameName]?.frame;
  const px = player.x * tileDim;
  const py = player.y * tileDim;

  ctx.save();
  ctx.fillStyle = 'rgba(35, 67, 107, 0.35)';
  ctx.beginPath();
  ctx.ellipse(px + tileDim / 2, py + tileDim - 2, tileDim * 0.34, tileDim * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  if (img && frame) {
    if (flipHorizontal) {
      ctx.save();
      ctx.translate(px + tileDim, py - 4);
      ctx.scale(-1, 1);
      ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, tileDim, tileDim);
      ctx.restore();
    } else {
      ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, px, py - 4, tileDim, tileDim);
    }
  }

  if (showLabels) {
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    const tw = ctx.measureText('You').width + 10;
    ctx.fillStyle = '#23436b';
    ctx.beginPath();
    ctx.roundRect(px + tileDim / 2 - tw / 2, py + tileDim + 1, tw, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#fbf7ef';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('You', px + tileDim / 2, py + tileDim + 8.5);
  }
  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  bottomY: number,
  rawText: string,
  accentColor: string,
) {
  const maxChars = 72;
  const text = rawText.length > maxChars ? `${rawText.slice(0, maxChars - 1)}…` : rawText;
  ctx.font = '500 10.5px Inter, system-ui, sans-serif';

  // Wrap up to 2 lines
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (ctx.measureText(next).width > 145 && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  const clippedLines = lines.slice(0, 3);

  const lineH = 13;
  const padX = 8;
  const padY = 5;
  const boxW = Math.max(
    46,
    ...clippedLines.map((l) => ctx.measureText(l).width + padX * 2),
  );
  const boxH = clippedLines.length * lineH + padY * 2;
  const x = centerX - boxW / 2;
  const y = bottomY - boxH - 6;

  ctx.fillStyle = '#fbf7ef';
  ctx.strokeStyle = accentColor || '#a82424';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  // Pointer triangle
  ctx.beginPath();
  ctx.moveTo(centerX - 4, y + boxH);
  ctx.lineTo(centerX, y + boxH + 5);
  ctx.lineTo(centerX + 4, y + boxH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1e1a17';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  clippedLines.forEach((line, idx) => {
    ctx.fillText(line, x + padX, y + padY + idx * lineH);
  });
}
