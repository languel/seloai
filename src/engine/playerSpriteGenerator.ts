import {
  applyContourOutline,
  BALKAN_PAL,
  createPixelBuffer,
  drawCrossStitch,
  drawEllipse,
  drawLine,
  fillRect,
  setPx,
  type PixelBuffer,
  type Rgba,
} from './balkanPixelCore';
import { encodeRgbaUncompressedPng } from './spriteGenerator';
import type { CustomSpriteSheet, Direction } from './types';
import type {
  PlayerAppearanceConfig,
  PlayerAttirePreset,
  PlayerHairPreset,
  PlayerHeadgearPreset,
  PlayerPropPreset,
  PlayerSkinPreset,
  WorldThemeKind,
} from '../utils/aestheticThemes';

const DIRECTIONS: Direction[] = ['down', 'left', 'right', 'up'];
const PLAYER_SPRITE_CACHE = new Map<string, CustomSpriteSheet>();

export interface ResolvedPlayerTraits {
  worldTheme: WorldThemeKind;
  attire: Exclude<PlayerAttirePreset, 'auto'>;
  accentHex: string;
  headgear: Exclude<PlayerHeadgearPreset, 'auto'>;
  hairColor: Exclude<PlayerHairPreset, 'auto'>;
  skinTone: Exclude<PlayerSkinPreset, 'auto'>;
  propItem: Exclude<PlayerPropPreset, 'auto'>;
  seed: number;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return [184, 31, 40];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function makeAccentRamp(hex: string): { hi: Rgba; base: Rgba; shade: Rgba } {
  const [r, g, b] = hexToRgbTuple(hex);
  return {
    hi: [clampByte(r + 34), clampByte(g + 30), clampByte(b + 28), 255],
    base: [r, g, b, 255],
    shade: [clampByte(r - 42), clampByte(g - 42), clampByte(b - 38), 255],
  };
}

function resolveSkinPalette(skin: Exclude<PlayerSkinPreset, 'auto'>): { base: Rgba; shade: Rgba } {
  switch (skin) {
    case 'pale':
      return { base: BALKAN_PAL.skinPale, shade: [204, 174, 158, 255] };
    case 'olive':
      return { base: [212, 167, 125, 255], shade: [172, 126, 86, 255] };
    case 'deep':
      return { base: [132, 82, 49, 255], shade: [94, 56, 32, 255] };
    case 'warm':
    default:
      return { base: BALKAN_PAL.skinWarm, shade: BALKAN_PAL.skinShade };
  }
}

function resolveHairPalette(hair: Exclude<PlayerHairPreset, 'auto'>): { base: Rgba; hi: Rgba } {
  switch (hair) {
    case 'chestnut':
      return { base: [112, 66, 40, 255], hi: [148, 92, 58, 255] };
    case 'auburn':
      return { base: BALKAN_PAL.auburn, hi: BALKAN_PAL.auburnHi };
    case 'gold':
      return { base: BALKAN_PAL.ochre, hi: BALKAN_PAL.gold };
    case 'silver':
      return { base: BALKAN_PAL.silver, hi: BALKAN_PAL.silverHi };
    case 'dark':
    default:
      return { base: BALKAN_PAL.inkSoft, hi: [86, 62, 56, 255] };
  }
}

/** Resolve 'auto' player style options so the avatar blends natively into the active world. */
export function resolvePlayerAppearance(
  cfg: PlayerAppearanceConfig,
  worldTheme: WorldThemeKind,
): ResolvedPlayerTraits {
  const defaultByWorld: Record<WorldThemeKind, Omit<ResolvedPlayerTraits, 'seed' | 'worldTheme'>> = {
    'balkan-myth': {
      attire: 'balkan-yunak',
      accentHex: '#206b44',
      headgear: 'kalpak',
      hairColor: 'dark',
      skinTone: 'warm',
      propItem: 'lantern',
    },
    shevitsa: {
      attire: 'shevitsa-embroiderer',
      accentHex: '#b81f28',
      headgear: 'kerchief',
      hairColor: 'chestnut',
      skinTone: 'warm',
      propItem: 'shuttle',
    },
    classic: {
      attire: 'classic-traveler',
      accentHex: '#243e6d',
      headgear: 'traveler-hood',
      hairColor: 'chestnut',
      skinTone: 'olive',
      propItem: 'staff',
    },
  };

  const base = defaultByWorld[worldTheme];
  return {
    worldTheme,
    attire: cfg.attire === 'auto' ? base.attire : cfg.attire,
    accentHex:
      !cfg.accentColor || cfg.accentColor === 'auto' ? base.accentHex : cfg.accentColor,
    headgear: cfg.headgear === 'auto' ? base.headgear : cfg.headgear,
    hairColor: cfg.hairColor === 'auto' ? base.hairColor : cfg.hairColor,
    skinTone: cfg.skinTone === 'auto' ? base.skinTone : cfg.skinTone,
    propItem: cfg.propItem === 'auto' ? base.propItem : cfg.propItem,
    seed: Math.max(0, Math.floor(cfg.seed || 1)),
  };
}

function drawGroundShadow(buf: PixelBuffer, cx = 16, rx = 6): void {
  const shadow: Rgba = [20, 16, 14, 72];
  for (let dx = -rx + 1; dx <= rx - 1; dx++) {
    setPx(buf, cx + dx, 29, shadow);
    if (Math.abs(dx) <= rx - 2) {
      setPx(buf, cx + dx, 30, shadow);
    }
  }
}

function blitFrame(sheet: PixelBuffer, frame: PixelBuffer, col: number, row: number): void {
  const ox = col * 32;
  const oy = row * 32;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const si = (y * 32 + x) * 4;
      const a = frame.data[si + 3];
      if (a === 0) continue;
      const di = ((oy + y) * sheet.width + (ox + x)) * 4;
      sheet.data[di] = frame.data[si];
      sheet.data[di + 1] = frame.data[si + 1];
      sheet.data[di + 2] = frame.data[si + 2];
      sheet.data[di + 3] = a;
    }
  }
}

/**
 * Render one 32x32 frame using exact Balkan villager proportions (cx=16, head hy=5..13,
 * torso ty=13..21, boots at y=27..28) so the player always matches village character scale.
 */
export function renderProceduralPlayerFrame(
  traits: ResolvedPlayerTraits,
  dir: Direction,
  stepIdx: number,
): PixelBuffer {
  const f = createPixelBuffer(32, 32);
  const legOffset = stepIdx === 1 ? -1 : stepIdx === 3 ? 1 : 0;
  const bob = stepIdx === 1 || stepIdx === 3 ? -1 : 0;
  const sideFlip = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const cx = 16;

  const accent = makeAccentRamp(traits.accentHex);
  const skin = resolveSkinPalette(traits.skinTone);
  const hair = resolveHairPalette(traits.hairColor);
  const isSkirted =
    traits.attire === 'balkan-weaver' ||
    traits.attire === 'forest-samodiva' ||
    (traits.attire === 'shevitsa-embroiderer' && traits.seed % 2 === 0);

  // Samodiva shimmering wing mist behind shoulders when chosen
  if (traits.attire === 'forest-samodiva') {
    const flap = stepIdx === 1 ? -1 : stepIdx === 3 ? 1 : 0;
    drawEllipse(f, cx - 6, 16 + bob + flap, 3, 5, BALKAN_PAL.periwinkle);
    drawEllipse(f, cx + 6, 16 + bob - flap, 3, 5, BALKAN_PAL.periwinkle);
    setPx(f, cx - 7, 13 + bob + flap, BALKAN_PAL.waterFoam);
    setPx(f, cx + 6, 13 + bob - flap, BALKAN_PAL.waterFoam);
  }

  // Flowing cloak back layer for traveler attire on up / side turns
  const ty = 13 + bob;
  if (traits.attire === 'classic-traveler' || traits.attire === 'balkan-yunak') {
    if (dir === 'up') {
      fillRect(f, cx - 5, ty, 10, 11, accent.shade);
      fillRect(f, cx - 4, ty + 1, 8, 9, accent.base);
      setPx(f, cx, ty + 3, BALKAN_PAL.gold);
    }
  }

  // Legs / Skirt / Footwear
  if (isSkirted) {
    fillRect(f, cx - 5, 20 + bob, 10, 7, accent.shade);
    for (let x = cx - 4; x <= cx + 4; x += 2) {
      setPx(f, x, 25 + bob, BALKAN_PAL.gold);
      setPx(f, x + 1, 26 + bob, accent.hi);
    }
    fillRect(f, cx - 3 + legOffset, 27, 2, 2, BALKAN_PAL.woodDark);
    fillRect(f, cx + 1 - legOffset, 27, 2, 2, BALKAN_PAL.woodDark);
  } else {
    const pantColor =
      traits.attire === 'classic-traveler' ? BALKAN_PAL.slateDark : BALKAN_PAL.indigoDark;
    fillRect(f, cx - 4, 21 + bob, 8, 4, pantColor);
    fillRect(f, cx - 4 + legOffset, 24, 3, 4, pantColor);
    fillRect(f, cx + 1 - legOffset, 24, 3, 4, pantColor);
    fillRect(f, cx - 4 + legOffset, 27, 3, 2, BALKAN_PAL.woodDark);
    fillRect(f, cx + 1 - legOffset, 27, 3, 2, BALKAN_PAL.woodDark);
  }

  // Torso tunic / fleece / cloak
  const tunicBase =
    traits.attire === 'kuker-wanderer'
      ? BALKAN_PAL.fleece
      : traits.attire === 'classic-traveler'
        ? accent.base
        : BALKAN_PAL.linenHi;
  fillRect(f, cx - 5, ty, 10, 9, tunicBase);

  if (traits.attire === 'kuker-wanderer') {
    for (let y = ty; y < ty + 8; y += 2) {
      for (let x = cx - 4; x <= cx + 3; x += 2) {
        setPx(f, x + ((y >> 1) & 1), y, BALKAN_PAL.fleeceDark);
      }
    }
    // Bronze waist bells
    for (const bx of [cx - 3, cx, cx + 3]) {
      fillRect(f, bx + legOffset - 1, ty + 7, 2, 3, BALKAN_PAL.ochre);
      setPx(f, bx + legOffset, ty + 7, BALKAN_PAL.gold);
    }
  } else if (traits.attire === 'balkan-yunak') {
    // Open braided vest flaps over linen sleeves & diamond stitch plastron
    fillRect(f, cx - 3, ty, 2, 7, accent.shade);
    fillRect(f, cx + 1, ty, 2, 7, accent.shade);
    setPx(f, cx - 1, ty + 2, accent.hi);
    setPx(f, cx, ty + 2, accent.hi);
    setPx(f, cx - 1, ty + 4, BALKAN_PAL.gold);
    setPx(f, cx, ty + 4, accent.hi);
  } else if (traits.attire === 'balkan-weaver' || traits.attire === 'shevitsa-embroiderer') {
    drawCrossStitch(f, cx - 5, ty + 1, accent.base, BALKAN_PAL.gold, 2);
    drawCrossStitch(f, cx + 3, ty + 1, accent.base, BALKAN_PAL.gold, 2);
    // Decorative breastplate diamond
    setPx(f, cx, ty + 2, accent.hi);
    setPx(f, cx - 1, ty + 3, accent.base);
    setPx(f, cx + 1, ty + 3, accent.base);
    setPx(f, cx, ty + 4, BALKAN_PAL.gold);
  } else if (traits.attire === 'classic-traveler') {
    // Shoulder mantle highlight & diagonal leather satchel strap
    fillRect(f, cx - 5, ty, 10, 3, accent.hi);
    drawLine(f, cx - 3, ty + 1, cx + 3, ty + 7, BALKAN_PAL.woodHi);
    setPx(f, cx, ty + 4, BALKAN_PAL.gold);
  } else if (traits.attire === 'forest-samodiva') {
    drawCrossStitch(f, cx - 2, ty + 2, accent.base, BALKAN_PAL.mintGlow, 3);
  }

  // Waist sash & clasp
  fillRect(f, cx - 4, ty + 6, 8, 2, accent.base);
  setPx(f, cx - 1, ty + 6, BALKAN_PAL.gold);
  setPx(f, cx, ty + 6, BALKAN_PAL.silverHi);
  if (traits.seed % 3 === 1) {
    setPx(f, cx + 1, ty + 6, BALKAN_PAL.gold);
  }

  // Arms
  const armY = ty + 2 + legOffset;
  const sleeveColor =
    traits.attire === 'classic-traveler' ? accent.shade : tunicBase;
  fillRect(f, cx - 6, armY, 2, 5, sleeveColor);
  fillRect(f, cx + 4, ty + 2 - legOffset, 2, 5, sleeveColor);
  setPx(f, cx - 6, armY + 4, skin.base);
  setPx(f, cx + 5, ty + 6 - legOffset, skin.base);

  // Handheld token
  if (traits.propItem === 'lantern') {
    // Brass traveler lantern with warm amber flame
    fillRect(f, cx + 5, ty + 6 - legOffset, 2, 1, BALKAN_PAL.silver);
    fillRect(f, cx + 5, ty + 7 - legOffset, 3, 4, BALKAN_PAL.ochreDark);
    setPx(f, cx + 6, ty + 8 - legOffset, BALKAN_PAL.gold);
    setPx(f, cx + 6, ty + 9 - legOffset, BALKAN_PAL.linenHi);
  } else if (traits.propItem === 'staff') {
    drawLine(f, cx + 6, 10 + bob, cx + 6, 28, BALKAN_PAL.woodDark);
    setPx(f, cx + 6, 9 + bob, accent.hi);
    setPx(f, cx + 7, 10 + bob, BALKAN_PAL.gold);
  } else if (traits.propItem === 'shuttle') {
    setPx(f, cx - 7, armY + 3, BALKAN_PAL.crimsonHi);
    setPx(f, cx - 7, armY + 4, BALKAN_PAL.gold);
    setPx(f, cx - 8, armY + 4, accent.hi);
  } else if (traits.propItem === 'rose') {
    drawLine(f, cx - 7, armY + 2, cx - 7, armY + 5, BALKAN_PAL.emerald);
    setPx(f, cx - 7, armY + 1, BALKAN_PAL.crimsonHi);
    setPx(f, cx - 8, armY + 2, BALKAN_PAL.rose);
  }

  // Head & facial expression (exact 32x32 Balkan scale)
  const hx = cx + sideFlip;
  const hy = 5 + bob;
  drawEllipse(f, hx, hy + 4, 4, 4, skin.base);

  if (dir === 'up') {
    fillRect(f, hx - 4, hy + 1, 8, 7, hair.base);
    setPx(f, hx - 2, hy + 2, hair.hi);
    setPx(f, hx + 1, hy + 3, hair.hi);
  } else {
    // Crisp top hair crown
    fillRect(f, hx - 4, hy, 8, 3, hair.base);
    setPx(f, hx - 2, hy + 1, hair.hi);
    if (sideFlip !== 0) {
      // Sidebang
      fillRect(f, hx - sideFlip * 3, hy + 2, 2, 4, hair.base);
      setPx(f, hx + sideFlip * 2, hy + 4, BALKAN_PAL.ink);
    } else {
      setPx(f, hx - 2, hy + 4, BALKAN_PAL.ink);
      setPx(f, hx + 1, hy + 4, BALKAN_PAL.ink);
    }
  }

  // Headgear
  if (traits.headgear === 'kalpak') {
    fillRect(f, hx - 4, hy - 1, 8, 4, BALKAN_PAL.inkSoft);
    fillRect(f, hx - 3, hy - 2, 6, 2, BALKAN_PAL.ink);
    setPx(f, hx - 2, hy + 1, accent.hi);
    setPx(f, hx + 2, hy, BALKAN_PAL.gold);
  } else if (traits.headgear === 'kerchief') {
    fillRect(f, hx - 4, hy, 8, 3, BALKAN_PAL.linenHi);
    drawLine(f, hx - 4, hy + 2, hx - 3, hy + 7, BALKAN_PAL.linenMid);
    drawLine(f, hx + 3, hy + 2, hx + 2, hy + 7, BALKAN_PAL.linenMid);
    setPx(f, hx, hy + 1, accent.hi);
  } else if (traits.headgear === 'flower-venets') {
    fillRect(f, hx - 4, hy, 8, 2, hair.base);
    setPx(f, hx - 3, hy, BALKAN_PAL.crimsonHi);
    setPx(f, hx - 1, hy - 1, BALKAN_PAL.gold);
    setPx(f, hx + 1, hy - 1, BALKAN_PAL.periwinkle);
    setPx(f, hx + 3, hy, BALKAN_PAL.rose);
  } else if (traits.headgear === 'traveler-hood') {
    fillRect(f, hx - 5, hy - 1, 10, 3, accent.shade);
    fillRect(f, hx - 4, hy - 2, 8, 2, accent.base);
    if (dir === 'up') {
      fillRect(f, hx - 4, hy + 1, 8, 7, accent.shade);
      setPx(f, hx, hy + 2, accent.hi);
    } else {
      setPx(f, hx - 4, hy + 2, accent.base);
      setPx(f, hx + 3, hy + 2, accent.base);
    }
  }

  applyContourOutline(f, BALKAN_PAL.ink);
  drawGroundShadow(f, cx, 6);
  return f;
}

export function renderProceduralPlayerSheetPixels(traits: ResolvedPlayerTraits): PixelBuffer {
  const sheet = createPixelBuffer(128, 128);
  for (let row = 0; row < DIRECTIONS.length; row++) {
    const dir = DIRECTIONS[row];
    for (let col = 0; col < 4; col++) {
      const frame = renderProceduralPlayerFrame(traits, dir, col);
      blitFrame(sheet, frame, col, row);
    }
  }
  return sheet;
}

function traitsCacheKey(t: ResolvedPlayerTraits): string {
  return [t.worldTheme, t.attire, t.accentHex, t.headgear, t.hairColor, t.skinTone, t.propItem, t.seed].join('|');
}

/** Generate (and cache) a 128x128 4x4 procedural CustomSpriteSheet matched to world theme & user edits. */
export function generateProceduralPlayerCustomSprite(
  cfg: PlayerAppearanceConfig,
  worldTheme: WorldThemeKind,
): CustomSpriteSheet {
  const resolved = resolvePlayerAppearance(cfg, worldTheme);
  const key = traitsCacheKey(resolved);
  const cached = PLAYER_SPRITE_CACHE.get(key);
  if (cached) return cached;

  const pixels = renderProceduralPlayerSheetPixels(resolved);
  let textureUrl = '';
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
        ctx.putImageData(imgData, 0, 0);
        textureUrl = canvas.toDataURL('image/png');
      }
    } catch {
      // fall back to pure TypeScript PNG encoder below (e.g. jsdom without canvas)
    }
  }
  if (!textureUrl) {
    textureUrl = encodeRgbaUncompressedPng(pixels.width, pixels.height, pixels.data);
  }

  const sheet: CustomSpriteSheet = {
    textureUrl,
    frameWidth: 32,
    frameHeight: 32,
    cols: 4,
    rows: 4,
    framesPerDirection: 4,
    rowMap: { down: 0, left: 1, right: 2, up: 3 },
  };
  PLAYER_SPRITE_CACHE.set(key, sheet);
  return sheet;
}
