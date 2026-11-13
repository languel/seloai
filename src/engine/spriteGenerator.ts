import type {
  BottomStyleId,
  CharacterAppearance,
  ClothingColorId,
  ClothingStyleId,
  CustomSpriteSheet,
  Direction,
  EyeColorId,
  FootwearColorId,
  HairColorId,
  SkinToneId,
  TrimColorId,
  VillagerConfig,
} from './types';

export const SPRITE_FRAME_SIZE = 32;
export const SPRITE_FRAMES_PER_DIR = 4;
export const SPRITE_SHEET_WIDTH = SPRITE_FRAME_SIZE * SPRITE_FRAMES_PER_DIR; // 128
export const SPRITE_SHEET_HEIGHT = SPRITE_FRAME_SIZE * 4; // 128 (down, left, right, up)

export interface ColorRamp {
  hi: readonly [number, number, number];
  base: readonly [number, number, number];
  sh: readonly [number, number, number];
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function makeRamp(baseHex: string, hiShift = 28, shShift = -34): ColorRamp {
  const [r, g, b] = hexToRgb(baseHex);
  return {
    hi: [clampByte(r + hiShift), clampByte(g + hiShift * 0.9), clampByte(b + hiShift * 0.85)],
    base: [r, g, b],
    sh: [clampByte(r + shShift), clampByte(g + shShift * 1.05), clampByte(b + shShift * 1.1)],
  };
}

export const SKIN_PALETTES: Record<SkinToneId, ColorRamp> = {
  porcelain: makeRamp('#fae3d6', 14, -26),
  ivory: makeRamp('#f4cfb8', 18, -30),
  'warm-peach': makeRamp('#e8b896', 20, -32),
  olive: makeRamp('#d4a77d', 20, -34),
  tan: makeRamp('#c28c5c', 22, -34),
  amber: makeRamp('#a86e42', 22, -32),
  chestnut: makeRamp('#824e2d', 20, -28),
  'deep-espresso': makeRamp('#563320', 18, -22),
};

export const HAIR_PALETTES: Record<HairColorId, ColorRamp> = {
  raven: makeRamp('#262833', 22, -16),
  espresso: makeRamp('#432d22', 24, -20),
  chestnut: makeRamp('#75472b', 28, -28),
  auburn: makeRamp('#9e3c28', 30, -30),
  'golden-blonde': makeRamp('#dfb24e', 30, -36),
  'platinum-silver': makeRamp('#d9dde6', 20, -38),
  'copper-rose': makeRamp('#cf5f6f', 28, -34),
  'indigo-dye': makeRamp('#3b4e8c', 28, -28),
  'forest-sage': makeRamp('#497556', 28, -28),
};

export const EYE_COLORS: Record<EyeColorId, readonly [number, number, number]> = {
  brown: hexToRgb('#4f311f'),
  blue: hexToRgb('#2d6db8'),
  green: hexToRgb('#357f4b'),
  hazel: hexToRgb('#8a6b2e'),
  amber: hexToRgb('#c27821'),
  charcoal: hexToRgb('#2d3138'),
  violet: hexToRgb('#6c45a8'),
};

export const CLOTHING_PALETTES: Record<ClothingColorId, ColorRamp> = {
  crimson: makeRamp('#b42828', 28, -36),
  cobalt: makeRamp('#29538f', 28, -34),
  forest: makeRamp('#2f6b47', 26, -30),
  ochre: makeRamp('#c98a2c', 26, -34),
  plum: makeRamp('#6e3678', 26, -32),
  charcoal: makeRamp('#3b4048', 24, -22),
  'cream-linen': makeRamp('#ebe2d0', 14, -34),
  teal: makeRamp('#237a7d', 26, -30),
  rust: makeRamp('#a84b2c', 26, -32),
  burgundy: makeRamp('#732135', 24, -26),
};

export const TRIM_PALETTES: Record<TrimColorId, ColorRamp> = {
  gold: makeRamp('#e3b448', 24, -34),
  crimson: makeRamp('#c43131', 24, -32),
  ivory: makeRamp('#f5efe2', 10, -30),
  indigo: makeRamp('#2b4c80', 24, -28),
  emerald: makeRamp('#388557', 24, -30),
  copper: makeRamp('#b86839', 24, -30),
  silver: makeRamp('#bfc7d4', 20, -34),
  obsidian: makeRamp('#2c282b', 20, -16),
};

export const FOOTWEAR_PALETTES: Record<FootwearColorId, ColorRamp> = {
  'dark-leather': makeRamp('#3d291f', 18, -18),
  'russet-brown': makeRamp('#6b4128', 20, -24),
  charcoal: makeRamp('#34373d', 18, -18),
  'straw-tan': makeRamp('#b3925c', 20, -28),
};

const OUTLINE_RGBA: readonly [number, number, number, number] = [27, 23, 21, 255];
const WHITE_RGB: readonly [number, number, number] = [250, 248, 244];
const BLUSH_RGB: readonly [number, number, number] = [232, 134, 128];
const LINEN_UNDER: ColorRamp = makeRamp('#ede4d3', 12, -32);
const TROUSER_BASE: ColorRamp = makeRamp('#444954', 18, -22);
const LEAF_GREEN: ColorRamp = makeRamp('#498a4b', 22, -26);
const STRAW_PALETTE: ColorRamp = makeRamp('#dec078', 22, -32);

class PixelFrame {
  readonly width = SPRITE_FRAME_SIZE;
  readonly height = SPRITE_FRAME_SIZE;
  readonly data = new Uint8ClampedArray(SPRITE_FRAME_SIZE * SPRITE_FRAME_SIZE * 4);

  set(x: number, y: number, rgb: readonly [number, number, number], alpha = 255): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 4;
    this.data[idx] = rgb[0];
    this.data[idx + 1] = rgb[1];
    this.data[idx + 2] = rgb[2];
    this.data[idx + 3] = alpha;
  }

  getAlpha(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return this.data[(y * this.width + x) * 4 + 3];
  }

  rect(x: number, y: number, w: number, h: number, rgb: readonly [number, number, number]): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.set(x + dx, y + dy, rgb);
      }
    }
  }

  hline(x1: number, x2: number, y: number, rgb: readonly [number, number, number]): void {
    const start = Math.min(x1, x2);
    const end = Math.max(x1, x2);
    for (let x = start; x <= end; x++) {
      this.set(x, y, rgb);
    }
  }

  vline(x: number, y1: number, y2: number, rgb: readonly [number, number, number]): void {
    const start = Math.min(y1, y2);
    const end = Math.max(y1, y2);
    for (let y = start; y <= end; y++) {
      this.set(x, y, rgb);
    }
  }

  mirrorHorizontal(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width / 2; x++) {
        const leftIdx = (y * this.width + x) * 4;
        const rightIdx = (y * this.width + (this.width - 1 - x)) * 4;
        for (let c = 0; c < 4; c++) {
          const tmp = this.data[leftIdx + c];
          this.data[leftIdx + c] = this.data[rightIdx + c];
          this.data[rightIdx + c] = tmp;
        }
      }
    }
  }

  applyContourOutline(): void {
    const srcAlpha = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        srcAlpha[y * this.width + x] = this.data[(y * this.width + x) * 4 + 3];
      }
    }
    const isOpaque = (x: number, y: number): boolean => {
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
      return srcAlpha[y * this.width + x] > 0;
    };
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (srcAlpha[y * this.width + x] > 0) continue;
        if (isOpaque(x - 1, y) || isOpaque(x + 1, y) || isOpaque(x, y - 1) || isOpaque(x, y + 1)) {
          const idx = (y * this.width + x) * 4;
          this.data[idx] = OUTLINE_RGBA[0];
          this.data[idx + 1] = OUTLINE_RGBA[1];
          this.data[idx + 2] = OUTLINE_RGBA[2];
          this.data[idx + 3] = OUTLINE_RGBA[3];
        }
      }
    }
  }
}

interface Palettes {
  skin: ColorRamp;
  hair: ColorRamp;
  eye: readonly [number, number, number];
  cloth: ColorRamp;
  trim: ColorRamp;
  boots: ColorRamp;
}

function getPalettes(appearance: CharacterAppearance): Palettes {
  return {
    skin: SKIN_PALETTES[appearance.skinTone] ?? SKIN_PALETTES['warm-peach'],
    hair: HAIR_PALETTES[appearance.hairColor] ?? HAIR_PALETTES.chestnut,
    eye: EYE_COLORS[appearance.eyeColor] ?? EYE_COLORS.brown,
    cloth: CLOTHING_PALETTES[appearance.clothingColor] ?? CLOTHING_PALETTES.crimson,
    trim: TRIM_PALETTES[appearance.trimColor] ?? TRIM_PALETTES.gold,
    boots: FOOTWEAR_PALETTES[appearance.footwearColor] ?? FOOTWEAR_PALETTES['dark-leather'],
  };
}

function getFrameMotion(frameIndex: number): { bob: number; stride: -1 | 0 | 1 } {
  const mod = frameIndex % 4;
  if (mod === 1) return { bob: -1, stride: -1 };
  if (mod === 3) return { bob: -1, stride: 1 };
  return { bob: 0, stride: 0 };
}

function isFullSkirtOutfit(style: ClothingStyleId, bottomStyle: BottomStyleId): boolean {
  return style === 'herbalist-dress' || style === 'scholar-robe' || bottomStyle === 'skirt';
}

function drawBackHairFrontOrBack(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  dir: 'down' | 'up',
  bob: number,
  stride: -1 | 0 | 1,
): void {
  const h = a.hairStyle;
  const sway = stride;
  if (h === 'long-wavy') {
    if (dir === 'down') {
      f.rect(7, 11 + bob, 2, 11, pal.hair.sh);
      f.rect(23, 11 + bob, 2, 11, pal.hair.sh);
      f.rect(8, 13 + bob, 2, 10, pal.hair.base);
      f.rect(22, 13 + bob, 2, 10, pal.hair.base);
      f.set(8 + Math.max(0, sway), 22 + bob, pal.hair.sh);
      f.set(23 + Math.min(0, sway), 22 + bob, pal.hair.sh);
    } else {
      f.rect(8, 12 + bob, 16, 11, pal.hair.base);
      f.hline(9, 22, 22 + bob, pal.hair.sh);
      f.hline(10, 21, 23 + bob, pal.hair.sh);
      f.hline(10, 21, 14 + bob, pal.hair.hi);
    }
  } else if (h === 'braids') {
    if (dir === 'down') {
      f.vline(8, 14 + bob, 23 + bob, pal.hair.base);
      f.vline(9, 15 + bob, 22 + bob, pal.hair.sh);
      f.vline(23, 14 + bob, 23 + bob, pal.hair.base);
      f.vline(22, 15 + bob, 22 + bob, pal.hair.sh);
      f.set(8, 22 + bob, pal.trim.base);
      f.set(23, 22 + bob, pal.trim.base);
    } else {
      f.rect(10, 14 + bob, 3, 9, pal.hair.base);
      f.rect(19, 14 + bob, 3, 9, pal.hair.base);
      f.hline(10, 12, 22 + bob, pal.trim.base);
      f.hline(19, 21, 22 + bob, pal.trim.base);
    }
  } else if (h === 'ponytail' && dir === 'up') {
    f.rect(14 + sway, 13 + bob, 4, 8, pal.hair.base);
    f.hline(14 + sway, 17 + sway, 13 + bob, pal.trim.base);
    f.vline(15 + sway, 15 + bob, 21 + bob, pal.hair.hi);
  } else if (h === 'parted-bob' && dir === 'down') {
    f.vline(8, 12 + bob, 17 + bob, pal.hair.sh);
    f.vline(23, 12 + bob, 17 + bob, pal.hair.sh);
  } else if (h === 'curly-afro') {
    f.rect(7, 5 + bob, 18, 12, pal.hair.sh);
    f.rect(8, 4 + bob, 16, 12, pal.hair.base);
  }
}

function drawBackHairSide(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  bob: number,
  stride: -1 | 0 | 1,
): void {
  const h = a.hairStyle;
  if (h === 'long-wavy') {
    f.rect(17, 10 + bob, 6, 13, pal.hair.base);
    f.vline(22, 12 + bob, 22 + bob, pal.hair.sh);
    f.vline(19, 11 + bob, 19 + bob, pal.hair.hi);
    if (stride !== 0) {
      f.rect(22, 19 + bob, 2, 3, pal.hair.sh);
    }
  } else if (h === 'ponytail') {
    f.rect(21, 10 + bob, 3, 2, pal.trim.base);
    f.rect(22, 11 + bob, 3, 8, pal.hair.base);
    f.vline(24, 13 + bob, 19 + bob, pal.hair.sh);
  } else if (h === 'braids') {
    f.rect(19, 13 + bob, 3, 10, pal.hair.base);
    f.hline(19, 21, 22 + bob, pal.trim.base);
  } else if (h === 'curly-afro') {
    f.rect(16, 4 + bob, 8, 12, pal.hair.base);
  }
}

function drawCloakBack(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  dir: 'down' | 'up' | 'left',
  bob: number,
  stride: -1 | 0 | 1,
): void {
  if (a.clothingStyle !== 'traveler-cloak') return;
  if (dir === 'down') {
    f.rect(9, 19 + bob, 2, 7, pal.cloth.sh);
    f.rect(21, 19 + bob, 2, 7, pal.cloth.sh);
  } else if (dir === 'up') {
    f.rect(9, 18 + bob, 14, 9, pal.cloth.base);
    f.vline(10, 19 + bob, 26 + bob, pal.cloth.sh);
    f.vline(21, 19 + bob, 26 + bob, pal.cloth.sh);
    f.vline(15 + stride, 20 + bob, 26 + bob, pal.cloth.hi);
    f.hline(10, 21, 26 + bob, pal.trim.base);
  } else {
    f.rect(17, 18 + bob, 5, 8, pal.cloth.base);
    f.vline(21, 19 + bob, 26 + bob, pal.cloth.sh);
    f.set(22, 24 + bob + (stride !== 0 ? -1 : 0), pal.cloth.sh);
  }
}

function drawLegsAndFootwearFrontBack(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  bob: number,
  stride: -1 | 0 | 1,
): void {
  const fullSkirt = isFullSkirtOutfit(a.clothingStyle, a.bottomStyle);
  const legColor = a.clothingStyle === 'overalls' ? pal.cloth : TROUSER_BASE;
  const leftLift = stride === -1 ? -1 : 0;
  const rightLift = stride === 1 ? -1 : 0;

  if (fullSkirt) {
    // Skirt/robe drape covering upper legs
    const skirtPal = a.clothingStyle === 'scholar-robe' || a.clothingStyle === 'herbalist-dress' ? pal.cloth : pal.cloth;
    f.rect(10, 23 + bob, 12, 4, skirtPal.base);
    f.hline(10, 21, 26 + bob, skirtPal.sh);
    if (a.clothingStyle === 'herbalist-dress') {
      f.hline(10, 21, 25 + bob, pal.trim.base);
    } else if (a.clothingStyle === 'scholar-robe') {
      f.vline(15, 23 + bob, 26 + bob, pal.trim.base);
      f.vline(16, 23 + bob, 26 + bob, pal.trim.sh);
    }
    // Lower calves/boots peeking below skirt
    f.rect(12, 27 + leftLift, 3, 2, pal.boots.base);
    f.hline(12, 14, 29 + leftLift, pal.boots.sh);
    f.rect(17, 27 + rightLift, 3, 2, pal.boots.base);
    f.hline(17, 19, 29 + rightLift, pal.boots.sh);
  } else {
    // Left leg (screen left)
    f.rect(11, 24 + bob + leftLift, 4, 4, legColor.base);
    f.vline(11, 24 + bob + leftLift, 27 + bob + leftLift, legColor.sh);
    f.rect(11, 28 + leftLift, 4, 2, pal.boots.base);
    f.hline(11, 14, 29 + leftLift, pal.boots.sh);

    // Right leg
    f.rect(17, 24 + bob + rightLift, 4, 4, legColor.base);
    f.vline(20, 24 + bob + rightLift, 27 + bob + rightLift, legColor.sh);
    f.rect(17, 28 + rightLift, 4, 2, pal.boots.base);
    f.hline(17, 20, 29 + rightLift, pal.boots.sh);
  }
}

function drawLegsAndFootwearSide(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  bob: number,
  stride: -1 | 0 | 1,
): void {
  const fullSkirt = isFullSkirtOutfit(a.clothingStyle, a.bottomStyle);
  const legColor = a.clothingStyle === 'overalls' ? pal.cloth : TROUSER_BASE;

  const frontLegX = 14 + stride * 2;
  const backLegX = 14 - stride * 2;

  if (fullSkirt) {
    f.rect(12, 23 + bob, 8, 4, pal.cloth.base);
    f.hline(12, 19, 26 + bob, pal.cloth.sh);
    if (a.clothingStyle === 'herbalist-dress') {
      f.hline(12, 19, 25 + bob, pal.trim.base);
    }
    f.rect(backLegX, 27, 3, 2, pal.boots.sh);
    f.rect(frontLegX, 27, 4, 2, pal.boots.base);
    f.hline(frontLegX, frontLegX + 3, 29, pal.boots.sh);
  } else {
    // Back leg darker
    f.rect(backLegX + 1, 24 + bob, 3, 4, legColor.sh);
    f.rect(backLegX, 28, 4, 2, pal.boots.sh);
    // Front leg
    f.rect(frontLegX, 24 + bob, 4, 4, legColor.base);
    f.rect(frontLegX - 1, 28, 5, 2, pal.boots.base);
    f.hline(frontLegX - 1, frontLegX + 3, 29, pal.boots.sh);
  }
}

function drawTorsoAndClothingFrontBack(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  dir: 'down' | 'up',
  bob: number,
): void {
  const isMale = a.gender === 'male';
  const isFemale = a.gender === 'female';
  const shoulderLeft = isMale ? 10 : 11;
  const shoulderRight = isMale ? 21 : 20;
  const waistLeft = isFemale ? 12 : 11;
  const waistRight = isFemale ? 19 : 20;

  // Neck
  f.rect(14, 17 + bob, 4, 2, pal.skin.sh);

  const sleeveBase =
    a.clothingStyle === 'forester-vest' || a.clothingStyle === 'overalls' ? LINEN_UNDER.base : pal.cloth.base;
  const sleeveSh =
    a.clothingStyle === 'forester-vest' || a.clothingStyle === 'overalls' ? LINEN_UNDER.sh : pal.cloth.sh;

  // Main chest & waist
  f.hline(shoulderLeft, shoulderRight, 18 + bob, sleeveBase);
  f.hline(shoulderLeft, shoulderRight, 19 + bob, pal.cloth.base);
  f.hline(shoulderLeft, shoulderRight, 20 + bob, pal.cloth.base);
  f.hline(waistLeft, waistRight, 21 + bob, pal.cloth.base);
  f.hline(waistLeft, waistRight, 22 + bob, pal.cloth.sh);
  f.hline(11, 20, 23 + bob, pal.cloth.sh);

  // Subtle side highlights/shadows
  f.vline(15, 19 + bob, 22 + bob, pal.cloth.hi);
  f.vline(16, 19 + bob, 22 + bob, pal.cloth.hi);

  if (a.clothingStyle === 'rushnyk-tunic') {
    f.hline(shoulderLeft, shoulderRight, 19 + bob, LINEN_UNDER.base);
    f.rect(12, 20 + bob, 8, 3, LINEN_UNDER.base);
    if (dir === 'down') {
      f.vline(15, 18 + bob, 22 + bob, pal.trim.base);
      f.vline(16, 18 + bob, 22 + bob, pal.trim.base);
      f.set(14, 20 + bob, pal.trim.sh);
      f.set(17, 20 + bob, pal.trim.sh);
      f.hline(11, 20, 23 + bob, pal.cloth.base);
    } else {
      f.hline(11, 20, 23 + bob, pal.trim.base);
    }
  } else if (a.clothingStyle === 'herbalist-dress') {
    if (dir === 'down') {
      f.rect(13, 18 + bob, 6, 3, LINEN_UNDER.base);
      f.set(14, 19 + bob, pal.trim.base);
      f.set(17, 19 + bob, pal.trim.base);
    }
    f.hline(waistLeft, waistRight, 22 + bob, pal.trim.base);
  } else if (a.clothingStyle === 'blacksmith-apron') {
    const apronPal = pal.trim;
    if (dir === 'down') {
      f.rect(12, 19 + bob, 8, 6, apronPal.base);
      f.vline(12, 18 + bob, 24 + bob, apronPal.sh);
      f.vline(19, 18 + bob, 24 + bob, apronPal.sh);
      f.hline(12, 19, 22 + bob, apronPal.sh);
      f.set(15, 22 + bob, WHITE_RGB);
    } else {
      f.hline(12, 19, 22 + bob, apronPal.sh);
    }
  } else if (a.clothingStyle === 'scholar-robe') {
    f.hline(13, 18, 18 + bob, pal.trim.base);
    if (dir === 'down') {
      f.set(13, 19 + bob, pal.trim.base);
      f.set(14, 20 + bob, pal.trim.base);
      f.set(15, 21 + bob, pal.trim.base);
      f.set(16, 22 + bob, pal.trim.base);
    }
    f.hline(11, 20, 22 + bob, pal.trim.sh);
  } else if (a.clothingStyle === 'forester-vest') {
    f.rect(12, 19 + bob, 8, 4, pal.cloth.base);
    if (dir === 'down') {
      f.vline(15, 19 + bob, 22 + bob, LINEN_UNDER.base);
      f.vline(16, 19 + bob, 22 + bob, LINEN_UNDER.sh);
    }
    f.hline(waistLeft, waistRight, 22 + bob, pal.trim.sh);
    f.set(15, 22 + bob, pal.trim.hi);
  } else if (a.clothingStyle === 'traveler-cloak') {
    f.hline(shoulderLeft, shoulderRight, 18 + bob, pal.cloth.hi);
    if (dir === 'down') {
      f.set(14, 18 + bob, pal.trim.base);
      f.set(17, 18 + bob, pal.trim.base);
      f.hline(13, 18, 19 + bob, pal.cloth.sh);
    }
    f.hline(waistLeft, waistRight, 22 + bob, pal.trim.sh);
  } else if (a.clothingStyle === 'overalls') {
    f.rect(11, 18 + bob, 10, 4, LINEN_UNDER.base);
    f.rect(12, 20 + bob, 8, 4, pal.cloth.base);
    f.vline(13, 18 + bob, 20 + bob, pal.cloth.base);
    f.vline(18, 18 + bob, 20 + bob, pal.cloth.base);
    if (dir === 'down') {
      f.set(13, 20 + bob, pal.trim.hi);
      f.set(18, 20 + bob, pal.trim.hi);
    }
  } else if (a.clothingStyle === 'noble-coat') {
    f.hline(12, 19, 18 + bob, pal.trim.base);
    if (dir === 'down') {
      f.vline(15, 19 + bob, 23 + bob, pal.trim.sh);
      f.set(15, 19 + bob, pal.trim.hi);
      f.set(15, 21 + bob, pal.trim.hi);
      f.set(15, 23 + bob, pal.trim.hi);
    }
    f.rect(11, 24 + bob, 3, 2, pal.cloth.sh);
    f.rect(18, 24 + bob, 3, 2, pal.cloth.sh);
  }
  void sleeveSh;
}

function drawTorsoAndClothingSide(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  bob: number,
): void {
  f.rect(14, 17 + bob, 4, 2, pal.skin.sh);
  const shirt =
    a.clothingStyle === 'forester-vest' || a.clothingStyle === 'overalls' || a.clothingStyle === 'rushnyk-tunic'
      ? LINEN_UNDER.base
      : pal.cloth.base;
  f.rect(12, 18 + bob, 8, 6, shirt);
  if (a.clothingStyle !== 'overalls' && a.clothingStyle !== 'rushnyk-tunic') {
    f.vline(19, 19 + bob, 23 + bob, pal.cloth.sh);
  } else {
    f.rect(12, 20 + bob, 8, 4, pal.cloth.base);
  }
  f.hline(12, 19, 22 + bob, pal.trim.base);
  if (a.clothingStyle === 'blacksmith-apron') {
    f.rect(12, 19 + bob, 4, 6, pal.trim.base);
  } else if (a.clothingStyle === 'noble-coat') {
    f.rect(13, 24 + bob, 6, 2, pal.cloth.sh);
  }
}

function drawArmsFrontBack(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  bob: number,
  stride: -1 | 0 | 1,
): void {
  const sleeve =
    a.clothingStyle === 'forester-vest' || a.clothingStyle === 'overalls' || a.clothingStyle === 'rushnyk-tunic'
      ? LINEN_UNDER
      : pal.cloth;
  const armLeftShift = stride === 1 ? -1 : stride === -1 ? 1 : 0;
  const armRightShift = -armLeftShift;

  const leftX = a.gender === 'male' ? 8 : 9;
  const rightX = a.gender === 'male' ? 22 : 21;

  // Left arm
  f.rect(leftX, 18 + bob + armLeftShift, 2, 4, sleeve.base);
  f.set(leftX, 22 + bob + armLeftShift, pal.trim.sh);
  f.rect(leftX, 23 + bob + armLeftShift, 2, 2, pal.skin.base);

  // Right arm
  f.rect(rightX, 18 + bob + armRightShift, 2, 4, sleeve.base);
  f.set(rightX + 1, 22 + bob + armRightShift, pal.trim.sh);
  f.rect(rightX, 23 + bob + armRightShift, 2, 2, pal.skin.base);
}

function drawArmSide(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  bob: number,
  stride: -1 | 0 | 1,
): void {
  const sleeve =
    a.clothingStyle === 'forester-vest' || a.clothingStyle === 'overalls' || a.clothingStyle === 'rushnyk-tunic'
      ? LINEN_UNDER
      : pal.cloth;
  const ax = 15 - stride * 2;
  f.rect(ax, 18 + bob, 3, 4, sleeve.base);
  f.vline(ax + 2, 19 + bob, 21 + bob, sleeve.sh);
  f.rect(ax, 22 + bob, 3, 2, pal.skin.base);
}

function drawHeadAndFaceFrontOrBack(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  dir: 'down' | 'up',
  bob: number,
): void {
  // Cranium silhouette y=4..16
  f.hline(12, 19, 4 + bob, pal.skin.base);
  f.hline(10, 21, 5 + bob, pal.skin.base);
  for (let y = 6; y <= 14; y++) {
    f.hline(9, 22, y + bob, pal.skin.base);
  }
  f.hline(10, 21, 15 + bob, pal.skin.sh);
  f.hline(11, 20, 16 + bob, pal.skin.sh);

  // Forehead highlight & jaw shadow
  f.hline(12, 19, 6 + bob, pal.skin.hi);
  if (a.gender === 'male') {
    f.hline(10, 21, 16 + bob, pal.skin.sh);
  }

  // Ears
  f.rect(8, 11 + bob, 1, 3, pal.skin.sh);
  f.rect(23, 11 + bob, 1, 3, pal.skin.sh);

  if (dir === 'down') {
    // Brows
    f.hline(11, 13, 10 + bob, pal.hair.sh);
    f.hline(18, 20, 10 + bob, pal.hair.sh);
    // Eyes
    f.set(11, 12 + bob, WHITE_RGB);
    f.set(11, 13 + bob, WHITE_RGB);
    f.set(12, 12 + bob, pal.eye);
    f.set(12, 13 + bob, OUTLINE_RGBA.slice(0, 3) as [number, number, number]);

    f.set(20, 12 + bob, WHITE_RGB);
    f.set(20, 13 + bob, WHITE_RGB);
    f.set(19, 12 + bob, pal.eye);
    f.set(19, 13 + bob, OUTLINE_RGBA.slice(0, 3) as [number, number, number]);

    if (a.gender === 'female') {
      // Soft upper lashes & warm cheek blush
      f.hline(11, 12, 11 + bob, OUTLINE_RGBA.slice(0, 3) as [number, number, number]);
      f.hline(19, 20, 11 + bob, OUTLINE_RGBA.slice(0, 3) as [number, number, number]);
      f.set(10, 14 + bob, BLUSH_RGB);
      f.set(21, 14 + bob, BLUSH_RGB);
    }

    // Subtle mouth
    f.hline(15, 16, 15 + bob, pal.skin.sh);

    // Facial hair
    if (a.facialHair === 'stubble') {
      for (const x of [11, 13, 15, 17, 19, 20]) {
        f.set(x, 15 + bob, pal.hair.sh);
      }
      f.set(12, 16 + bob, pal.hair.sh);
      f.set(19, 16 + bob, pal.hair.sh);
    } else if (a.facialHair === 'mustache') {
      f.hline(13, 18, 14 + bob, pal.hair.base);
      f.set(12, 15 + bob, pal.hair.sh);
      f.set(19, 15 + bob, pal.hair.sh);
    } else if (a.facialHair === 'goatee') {
      f.hline(13, 18, 14 + bob, pal.hair.base);
      f.rect(14, 15 + bob, 4, 3, pal.hair.base);
      f.hline(14, 17, 17 + bob, pal.hair.sh);
    } else if (a.facialHair === 'full-beard') {
      f.hline(13, 18, 14 + bob, pal.hair.base);
      f.rect(10, 14 + bob, 12, 3, pal.hair.base);
      f.hline(11, 20, 17 + bob, pal.hair.sh);
      f.hline(13, 18, 18 + bob, pal.hair.sh);
      f.hline(14, 17, 15 + bob, pal.skin.base); // mouth opening
    }
  }
}

function drawHeadAndFaceSide(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  bob: number,
): void {
  // Profile facing LEFT
  f.hline(12, 20, 4 + bob, pal.skin.base);
  f.hline(11, 21, 5 + bob, pal.skin.base);
  for (let y = 6; y <= 14; y++) {
    f.hline(10, 21, y + bob, pal.skin.base);
  }
  f.set(9, 12 + bob, pal.skin.base); // tiny nose bridge
  f.hline(10, 20, 15 + bob, pal.skin.sh);
  f.hline(11, 19, 16 + bob, pal.skin.sh);

  // Ear & side eye
  f.rect(17, 11 + bob, 2, 3, pal.skin.sh);
  f.hline(11, 13, 10 + bob, pal.hair.sh);
  f.set(11, 12 + bob, pal.eye);
  f.set(11, 13 + bob, OUTLINE_RGBA.slice(0, 3) as [number, number, number]);
  f.set(12, 12 + bob, WHITE_RGB);
  f.set(12, 13 + bob, WHITE_RGB);
  if (a.gender === 'female') {
    f.hline(11, 12, 11 + bob, OUTLINE_RGBA.slice(0, 3) as [number, number, number]);
    f.set(12, 14 + bob, BLUSH_RGB);
  }

  // Side facial hair
  if (a.facialHair === 'stubble') {
    for (const x of [10, 12, 14, 16]) {
      f.set(x, 15 + bob, pal.hair.sh);
    }
  } else if (a.facialHair === 'mustache') {
    f.hline(9, 13, 14 + bob, pal.hair.base);
  } else if (a.facialHair === 'goatee') {
    f.hline(9, 12, 14 + bob, pal.hair.base);
    f.rect(10, 15 + bob, 3, 3, pal.hair.base);
  } else if (a.facialHair === 'full-beard') {
    f.rect(10, 14 + bob, 7, 3, pal.hair.base);
    f.hline(10, 15, 17 + bob, pal.hair.sh);
    f.hline(11, 14, 18 + bob, pal.hair.sh);
    f.set(10, 14 + bob, pal.hair.hi);
  }
}

function drawFrontHairFrontOrBack(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  dir: 'down' | 'up',
  bob: number,
): void {
  const h = a.hairStyle;
  if (h === 'shaved') {
    f.hline(12, 19, 4 + bob, pal.hair.sh);
    f.hline(10, 21, 5 + bob, pal.hair.base);
    if (dir === 'up') {
      f.rect(10, 5 + bob, 12, 9, pal.hair.sh);
    }
    return;
  }

  // Standard top cap coverage
  if (h === 'scholar-crown') {
    // High forehead, hair on temples & back
    f.rect(8, 7 + bob, 2, 6, pal.hair.base);
    f.rect(22, 7 + bob, 2, 6, pal.hair.base);
    f.hline(11, 20, 4 + bob, pal.hair.hi);
    if (dir === 'up') {
      f.rect(9, 4 + bob, 14, 10, pal.hair.base);
    }
    return;
  }

  // Full crown
  f.hline(11, 20, 3 + bob, pal.hair.base);
  f.hline(9, 22, 4 + bob, pal.hair.base);
  f.hline(8, 23, 5 + bob, pal.hair.base);
  f.hline(11, 19, 5 + bob, pal.hair.hi);
  f.rect(8, 6 + bob, 2, 5, pal.hair.base);
  f.rect(22, 6 + bob, 2, 5, pal.hair.base);

  if (dir === 'up') {
    f.rect(9, 5 + bob, 14, 10, pal.hair.base);
    f.hline(11, 20, 7 + bob, pal.hair.hi);
    f.hline(10, 21, 14 + bob, pal.hair.sh);
  } else {
    // Forehead fringe shape per style
    if (h === 'short-crop') {
      f.hline(9, 22, 6 + bob, pal.hair.base);
      f.hline(10, 14, 7 + bob, pal.hair.base);
      f.hline(17, 21, 7 + bob, pal.hair.base);
      f.set(13, 8 + bob, pal.hair.sh);
      f.set(18, 8 + bob, pal.hair.sh);
    } else if (h === 'parted-bob') {
      f.hline(9, 22, 6 + bob, pal.hair.base);
      f.rect(8, 7 + bob, 3, 9, pal.hair.base);
      f.rect(21, 7 + bob, 3, 9, pal.hair.base);
      f.hline(11, 14, 7 + bob, pal.hair.hi);
      f.hline(17, 20, 7 + bob, pal.hair.hi);
    } else if (h === 'long-wavy' || h === 'braids' || h === 'ponytail' || h === 'bun') {
      f.hline(9, 22, 6 + bob, pal.hair.base);
      f.hline(10, 14, 7 + bob, pal.hair.base);
      f.hline(17, 21, 7 + bob, pal.hair.base);
      f.hline(11, 13, 8 + bob, pal.hair.sh);
      f.hline(18, 20, 8 + bob, pal.hair.sh);
    } else if (h === 'spiky') {
      f.hline(9, 22, 6 + bob, pal.hair.base);
      // Tuft spikes above crown
      f.vline(11, 1 + bob, 3 + bob, pal.hair.hi);
      f.vline(12, 2 + bob, 3 + bob, pal.hair.base);
      f.vline(15, 1 + bob, 3 + bob, pal.hair.hi);
      f.vline(16, 2 + bob, 3 + bob, pal.hair.base);
      f.vline(20, 1 + bob, 3 + bob, pal.hair.hi);
      f.vline(19, 2 + bob, 3 + bob, pal.hair.base);
      f.set(13, 8 + bob, pal.hair.base);
      f.set(16, 8 + bob, pal.hair.base);
      f.set(19, 8 + bob, pal.hair.base);
    } else if (h === 'curly-afro') {
      f.rect(8, 2 + bob, 16, 5, pal.hair.base);
      f.rect(7, 4 + bob, 3, 7, pal.hair.base);
      f.rect(22, 4 + bob, 3, 7, pal.hair.base);
      f.hline(10, 21, 7 + bob, pal.hair.sh);
      f.set(11, 3 + bob, pal.hair.hi);
      f.set(15, 3 + bob, pal.hair.hi);
      f.set(19, 3 + bob, pal.hair.hi);
    }
  }

  // Extra top bun
  if (h === 'bun') {
    f.rect(13, 1 + bob, 6, 3, pal.hair.base);
    f.hline(14, 17, 1 + bob, pal.hair.hi);
    f.hline(13, 18, 3 + bob, pal.trim.base);
  }
}

function drawFrontHairSide(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  bob: number,
): void {
  const h = a.hairStyle;
  if (h === 'shaved') {
    f.rect(12, 4 + bob, 9, 2, pal.hair.base);
    f.rect(17, 5 + bob, 5, 7, pal.hair.sh);
    return;
  }
  if (h === 'scholar-crown') {
    f.rect(16, 5 + bob, 6, 8, pal.hair.base);
    f.hline(13, 20, 4 + bob, pal.hair.hi);
    return;
  }

  f.hline(11, 20, 3 + bob, pal.hair.base);
  f.hline(10, 21, 4 + bob, pal.hair.base);
  f.hline(9, 22, 5 + bob, pal.hair.base);
  f.hline(11, 18, 5 + bob, pal.hair.hi);
  f.rect(15, 6 + bob, 7, 7, pal.hair.base);
  f.rect(14, 6 + bob, 2, 3, pal.hair.base);
  f.hline(10, 14, 6 + bob, pal.hair.base);

  if (h === 'parted-bob') {
    f.rect(15, 8 + bob, 6, 8, pal.hair.base);
  } else if (h === 'spiky') {
    f.vline(12, 1 + bob, 3 + bob, pal.hair.hi);
    f.vline(16, 1 + bob, 3 + bob, pal.hair.hi);
    f.vline(20, 2 + bob, 3 + bob, pal.hair.base);
  } else if (h === 'bun') {
    f.rect(16, 1 + bob, 5, 3, pal.hair.base);
    f.hline(17, 19, 1 + bob, pal.hair.hi);
    f.hline(16, 20, 3 + bob, pal.trim.base);
  } else if (h === 'curly-afro') {
    f.rect(10, 2 + bob, 12, 5, pal.hair.base);
    f.set(13, 3 + bob, pal.hair.hi);
    f.set(18, 3 + bob, pal.hair.hi);
  }
}

function drawAccessory(
  f: PixelFrame,
  a: CharacterAppearance,
  pal: Palettes,
  dir: 'down' | 'up' | 'left',
  bob: number,
): void {
  const acc = a.accessory;
  if (acc === 'none') return;

  if (acc === 'glasses') {
    if (dir === 'down') {
      f.rect(10, 11 + bob, 4, 3, pal.trim.sh);
      f.set(11, 12 + bob, WHITE_RGB);
      f.set(12, 12 + bob, pal.eye);
      f.rect(18, 11 + bob, 4, 3, pal.trim.sh);
      f.set(20, 12 + bob, WHITE_RGB);
      f.set(19, 12 + bob, pal.eye);
      f.hline(14, 17, 12 + bob, pal.trim.sh);
    } else if (dir === 'left') {
      f.rect(10, 11 + bob, 4, 3, pal.trim.sh);
      f.set(11, 12 + bob, pal.eye);
      f.set(12, 12 + bob, WHITE_RGB);
      f.hline(14, 17, 12 + bob, pal.trim.sh);
    }
    return;
  }

  if (acc === 'flower-crown') {
    const x1 = dir === 'left' ? 10 : 9;
    const x2 = dir === 'left' ? 21 : 22;
    f.hline(x1, x2, 5 + bob, LEAF_GREEN.base);
    f.set(x1 + 1, 5 + bob, pal.trim.hi);
    f.set(Math.floor((x1 + x2) / 2), 4 + bob, CLOTHING_PALETTES.crimson.hi);
    f.set(x2 - 2, 5 + bob, pal.trim.hi);
    if (dir === 'up') {
      f.set(13, 6 + bob, pal.trim.base);
      f.set(18, 6 + bob, CLOTHING_PALETTES.crimson.base);
    }
    return;
  }

  if (acc === 'straw-hat') {
    if (dir === 'down' || dir === 'up') {
      f.rect(10, 1 + bob, 12, 4, STRAW_PALETTE.base);
      f.hline(11, 20, 1 + bob, STRAW_PALETTE.hi);
      f.hline(10, 21, 4 + bob, pal.trim.base);
      f.hline(6, 25, 5 + bob, STRAW_PALETTE.hi);
      f.hline(6, 25, 6 + bob, STRAW_PALETTE.sh);
    } else {
      f.rect(11, 1 + bob, 10, 4, STRAW_PALETTE.base);
      f.hline(11, 20, 4 + bob, pal.trim.base);
      f.hline(7, 24, 5 + bob, STRAW_PALETTE.hi);
      f.hline(7, 24, 6 + bob, STRAW_PALETTE.sh);
    }
    return;
  }

  if (acc === 'hood') {
    if (dir === 'down' || dir === 'up') {
      f.hline(10, 21, 3 + bob, pal.cloth.base);
      f.hline(8, 23, 4 + bob, pal.cloth.base);
      f.rect(7, 5 + bob, 2, 11, pal.cloth.sh);
      f.rect(23, 5 + bob, 2, 11, pal.cloth.sh);
      if (dir === 'up') {
        f.rect(8, 4 + bob, 16, 13, pal.cloth.base);
        f.hline(9, 22, 16 + bob, pal.trim.sh);
      }
    } else {
      f.rect(12, 3 + bob, 10, 3, pal.cloth.base);
      f.rect(16, 5 + bob, 7, 11, pal.cloth.base);
      f.vline(22, 6 + bob, 15 + bob, pal.cloth.sh);
    }
    return;
  }

  if (acc === 'bandana') {
    const x1 = dir === 'left' ? 10 : 9;
    const x2 = dir === 'left' ? 21 : 22;
    f.hline(x1, x2, 6 + bob, pal.trim.base);
    f.hline(x1, x2, 7 + bob, pal.trim.sh);
    if (dir === 'up' || dir === 'left') {
      f.rect(x2, 7 + bob, 2, 3, pal.trim.base);
    }
    return;
  }

  if (acc === 'headscarf') {
    if (dir === 'down' || dir === 'up') {
      f.hline(10, 21, 3 + bob, pal.trim.base);
      f.hline(9, 22, 4 + bob, pal.trim.hi);
      f.rect(8, 5 + bob, 2, 11, pal.trim.base);
      f.rect(22, 5 + bob, 2, 11, pal.trim.base);
      if (dir === 'up') {
        f.rect(9, 4 + bob, 14, 12, pal.trim.base);
        f.hline(10, 21, 14 + bob, pal.cloth.base);
      }
    } else {
      f.rect(12, 3 + bob, 9, 3, pal.trim.base);
      f.rect(16, 5 + bob, 6, 11, pal.trim.base);
    }
    return;
  }

  if (acc === 'feather-cap') {
    if (dir === 'down' || dir === 'up') {
      f.rect(10, 2 + bob, 12, 4, pal.cloth.base);
      f.hline(9, 21, 5 + bob, pal.cloth.sh);
      // Quill feather
      f.set(22, 1 + bob, pal.trim.hi);
      f.set(21, 2 + bob, pal.trim.base);
      f.set(20, 3 + bob, pal.trim.base);
    } else {
      f.rect(10, 2 + bob, 11, 4, pal.cloth.base);
      f.hline(9, 19, 5 + bob, pal.cloth.sh);
      f.set(20, 1 + bob, pal.trim.hi);
      f.set(19, 2 + bob, pal.trim.base);
    }
  }
}

function renderSingleFrame(
  appearance: CharacterAppearance,
  dir: Direction,
  frameIndex: number,
): Uint8ClampedArray {
  const f = new PixelFrame();
  const pal = getPalettes(appearance);
  const { bob, stride } = getFrameMotion(frameIndex);

  const canonicalDir: 'down' | 'up' | 'left' = dir === 'right' ? 'left' : dir;

  if (canonicalDir === 'down' || canonicalDir === 'up') {
    drawCloakBack(f, appearance, pal, canonicalDir, bob, stride);
    drawBackHairFrontOrBack(f, appearance, pal, canonicalDir, bob, stride);
    drawLegsAndFootwearFrontBack(f, appearance, pal, bob, stride);
    drawTorsoAndClothingFrontBack(f, appearance, pal, canonicalDir, bob);
    drawArmsFrontBack(f, appearance, pal, bob, stride);
    drawHeadAndFaceFrontOrBack(f, appearance, pal, canonicalDir, bob);
    drawFrontHairFrontOrBack(f, appearance, pal, canonicalDir, bob);
    drawAccessory(f, appearance, pal, canonicalDir, bob);
  } else {
    drawCloakBack(f, appearance, pal, 'left', bob, stride);
    drawBackHairSide(f, appearance, pal, bob, stride);
    drawLegsAndFootwearSide(f, appearance, pal, bob, stride);
    drawTorsoAndClothingSide(f, appearance, pal, bob);
    drawArmSide(f, appearance, pal, bob, stride);
    drawHeadAndFaceSide(f, appearance, pal, bob);
    drawFrontHairSide(f, appearance, pal, bob);
    drawAccessory(f, appearance, pal, 'left', bob);
  }

  f.applyContourOutline();

  if (dir === 'right') {
    f.mirrorHorizontal();
  }

  return f.data;
}

/**
 * Generates the full 128x128 RGBA spritesheet pixel buffer (4 cols x 4 rows of 32x32 frames).
 * Rows correspond to: 0=down, 1=left, 2=right, 3=up.
 */
export function renderAppearanceSpritePixels(appearance: CharacterAppearance): Uint8ClampedArray {
  const sheet = new Uint8ClampedArray(SPRITE_SHEET_WIDTH * SPRITE_SHEET_HEIGHT * 4);
  const rowDirs: Direction[] = ['down', 'left', 'right', 'up'];

  for (let row = 0; row < rowDirs.length; row++) {
    const dir = rowDirs[row];
    for (let col = 0; col < SPRITE_FRAMES_PER_DIR; col++) {
      const frame = renderSingleFrame(appearance, dir, col);
      const dstBaseX = col * SPRITE_FRAME_SIZE;
      const dstBaseY = row * SPRITE_FRAME_SIZE;
      for (let py = 0; py < SPRITE_FRAME_SIZE; py++) {
        const srcOff = py * SPRITE_FRAME_SIZE * 4;
        const dstOff = ((dstBaseY + py) * SPRITE_SHEET_WIDTH + dstBaseX) * 4;
        sheet.set(frame.subarray(srcOff, srcOff + SPRITE_FRAME_SIZE * 4), dstOff);
      }
    }
  }

  return sheet;
}

// --- Pure-TS PNG fallback encoder for non-DOM / Node Vitest environments ---

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)), false);
  return chunk;
}

export function encodeRgbaUncompressedPng(width: number, height: number, rgba: Uint8ClampedArray): string {
  const rowBytes = width * 4 + 1;
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const dst = y * rowBytes;
    raw[dst] = 0; // filter type 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), dst + 1);
  }

  // Split raw scanlines into stored DEFLATE blocks <= 65535 bytes
  const MAX_BLOCK = 65535;
  const blockCount = Math.ceil(raw.length / MAX_BLOCK);
  const deflateSize = 2 + raw.length + blockCount * 5 + 4;
  const zlib = new Uint8Array(deflateSize);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  let zPos = 2;
  for (let offset = 0; offset < raw.length; offset += MAX_BLOCK) {
    const slice = raw.subarray(offset, Math.min(raw.length, offset + MAX_BLOCK));
    const isFinal = offset + slice.length >= raw.length ? 1 : 0;
    const len = slice.length;
    const nlen = len ^ 0xffff;
    zlib[zPos++] = isFinal;
    zlib[zPos++] = len & 0xff;
    zlib[zPos++] = (len >>> 8) & 0xff;
    zlib[zPos++] = nlen & 0xff;
    zlib[zPos++] = (nlen >>> 8) & 0xff;
    zlib.set(slice, zPos);
    zPos += len;
  }
  const adler = adler32(raw);
  zlib[zPos++] = (adler >>> 24) & 0xff;
  zlib[zPos++] = (adler >>> 16) & 0xff;
  zlib[zPos++] = (adler >>> 8) & 0xff;
  zlib[zPos++] = adler & 0xff;

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', zlib);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let pos = 0;
  for (const part of [sig, ihdrChunk, idatChunk, iendChunk]) {
    out.set(part, pos);
    pos += part.length;
  }

  let binary = '';
  for (let i = 0; i < out.length; i++) {
    binary += String.fromCharCode(out[i]);
  }
  const b64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(out).toString('base64');
  return `data:image/png;base64,${b64}`;
}

const MAX_SPRITE_SHEET_CACHE = 48;
const spriteSheetCache = new Map<string, string>();

export function getSpriteSheetCacheCount(): number {
  return spriteSheetCache.size;
}

export function clearSpriteSheetCache(): void {
  spriteSheetCache.clear();
}

export function appearanceCacheKey(appearance: CharacterAppearance): string {
  return [
    appearance.gender,
    appearance.skinTone,
    appearance.eyeColor,
    appearance.hairStyle,
    appearance.hairColor,
    appearance.facialHair,
    appearance.clothingStyle,
    appearance.clothingColor,
    appearance.trimColor,
    appearance.bottomStyle,
    appearance.footwearColor,
    appearance.accessory,
  ].join('|');
}

export function generateSpriteSheetDataUrl(appearance: CharacterAppearance): string {
  const key = appearanceCacheKey(appearance);
  const cached = spriteSheetCache.get(key);
  if (cached) {
    spriteSheetCache.delete(key);
    spriteSheetCache.set(key, cached);
    return cached;
  }

  const rgba = renderAppearanceSpritePixels(appearance);
  let url = '';
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_SHEET_WIDTH;
    canvas.height = SPRITE_SHEET_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const imgData = new ImageData(new Uint8ClampedArray(rgba), SPRITE_SHEET_WIDTH, SPRITE_SHEET_HEIGHT);
      ctx.putImageData(imgData, 0, 0);
      url = canvas.toDataURL('image/png');
    }
  }
  if (!url) {
    url = encodeRgbaUncompressedPng(SPRITE_SHEET_WIDTH, SPRITE_SHEET_HEIGHT, rgba);
  }
  spriteSheetCache.set(key, url);
  while (spriteSheetCache.size > MAX_SPRITE_SHEET_CACHE) {
    const oldestKey = spriteSheetCache.keys().next().value;
    if (oldestKey === undefined) break;
    spriteSheetCache.delete(oldestKey);
  }
  return url;
}

export function buildCustomSpriteFromAppearance(appearance: CharacterAppearance): CustomSpriteSheet {
  return {
    textureUrl: generateSpriteSheetDataUrl(appearance),
    frameWidth: SPRITE_FRAME_SIZE,
    frameHeight: SPRITE_FRAME_SIZE,
    cols: SPRITE_FRAMES_PER_DIR,
    rows: 4,
    framesPerDirection: SPRITE_FRAMES_PER_DIR,
    rowMap: {
      down: 0,
      left: 1,
      right: 2,
      up: 3,
    },
  };
}

export function ensureVillagerAppearanceSprite(villager: VillagerConfig): VillagerConfig {
  if (!villager.appearance) return villager;
  if (villager.customSprite?.textureUrl?.startsWith('data:image/png')) return villager;
  return {
    ...villager,
    customSprite: buildCustomSpriteFromAppearance(villager.appearance),
  };
}
