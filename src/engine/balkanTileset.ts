import {
  BALKAN_PAL,
  createPixelBuffer,
  drawCrossStitch,
  drawEllipse,
  drawLine,
  fillLinenWeave,
  fillRect,
  hash2d,
  setPx,
} from './balkanPixelCore.ts';
import type { PixelBuffer, Rgba } from './balkanPixelCore.ts';

export const BALKAN_TILESET_COLS = 16;
export const BALKAN_TILESET_ROWS = 16;
export const BALKAN_TILE_DIM = 32;
export const BALKAN_TILESET_WIDTH = BALKAN_TILESET_COLS * BALKAN_TILE_DIM;
export const BALKAN_TILESET_HEIGHT = BALKAN_TILESET_ROWS * BALKAN_TILE_DIM;

export const tileIdx = (col: number, row: number): number => row * BALKAN_TILESET_COLS + col;

/** Named symbolic tile indices into `/assets/balkan-myth-tileset.png` (16x16 @ 32px). */
export const BALKAN_TILES = {
  // Row 0: Solid Ground Terrains & Embroidered Paths
  GRASS_MEADOW: tileIdx(0, 0),
  GRASS_WILDFLOWER: tileIdx(1, 0),
  GRASS_CLOVER: tileIdx(2, 0),
  DROUGHT_CLAY: tileIdx(3, 0),
  SCORCHED_COBBLE: tileIdx(4, 0),
  ROAD_KHORO_H: tileIdx(5, 0),
  ROAD_KHORO_V: tileIdx(6, 0),
  ROAD_KHORO_CROSS: tileIdx(7, 0),
  WATER_BROOK: tileIdx(8, 0),
  WATER_SHIMMER: tileIdx(9, 0),
  WATER_SILT: tileIdx(10, 0),
  BRIDGE_OAK_H: tileIdx(11, 0),
  BRIDGE_OAK_V: tileIdx(12, 0),
  PLAZA_LINEN_STONE: tileIdx(13, 0),
  BORDER_KILIM_H: tileIdx(14, 0),
  BORDER_KILIM_V: tileIdx(15, 0),

  // Row 1: Brook Banks, Fences & Village Props
  BANK_TOP: tileIdx(0, 1),
  BANK_BOTTOM: tileIdx(1, 1),
  BANK_LEFT: tileIdx(2, 1),
  BANK_RIGHT: tileIdx(3, 1),
  BANK_TL: tileIdx(4, 1),
  BANK_TR: tileIdx(5, 1),
  BANK_BL: tileIdx(6, 1),
  BANK_BR: tileIdx(7, 1),
  FENCE_WATTLE_H: tileIdx(8, 1),
  FENCE_WATTLE_V: tileIdx(9, 1),
  CARDAK_RAIL: tileIdx(10, 1),
  GERANIUM_BOX: tileIdx(11, 1),
  PEPPER_STRINGS: tileIdx(12, 1),
  BRAZIER_POST: tileIdx(13, 1),
  DRY_PITCHERS_SMALL: tileIdx(14, 1),
  OBROK_CROSS: tileIdx(15, 1),

  // Multi-tile region anchors (use with helper fillStampBlock)
  ELBETITSA_ORIGIN: { col: 0, row: 2, w: 4, h: 4 },
  TREE_OF_LIFE_ORIGIN: { col: 4, row: 2, w: 3, h: 3 },
  SAMODIVA_GLADE_ORIGIN: { col: 7, row: 2, w: 3, h: 3 },
  KUKERI_HEARTH_ORIGIN: { col: 10, row: 2, w: 3, h: 3 },
  LAMIA_WELL_ORIGIN: { col: 13, row: 2, w: 3, h: 3 },

  REVIVAL_HOUSE_ORIGIN: { col: 4, row: 5, w: 3, h: 3 },
  HERB_HOUSE_ORIGIN: { col: 7, row: 5, w: 3, h: 3 },
  FORGE_CARDAK_ORIGIN: { col: 10, row: 5, w: 3, h: 3 },
  MARTENITSA_OAK_ORIGIN: { col: 13, row: 5, w: 2, h: 2 },
  SAMODIVA_BIRCH_ORIGIN: { col: 15, row: 5, w: 1, h: 2 },

  // Row 7 cols 13..15: Key Folklore Story Props
  UPRIGHT_LOOM: tileIdx(13, 7),
  SACRIFICE_OFFERING: tileIdx(14, 7),
  BROKEN_AMPHORAE: tileIdx(15, 7),

  // Rows 8..9 col 0: Tall Pine (1x2)
  BALKAN_PINE_ORIGIN: { col: 0, row: 8, w: 1, h: 2 },

  // Row 8 cols 1..7: Garden & Town Props
  SUNFLOWERS: tileIdx(1, 8),
  POPPY_BUSH: tileIdx(2, 8),
  WINE_BARREL: tileIdx(3, 8),
  BLACKSMITH_ANVIL: tileIdx(4, 8),
  VILLAGE_EDICT_BOARD: tileIdx(5, 8),
  OAK_BENCH: tileIdx(6, 8),
  CHIPROVTSI_RUG: tileIdx(7, 8),

  // Rows 10..11 Multi-tile accents
  SPRING_POOL_ORIGIN: { col: 1, row: 10, w: 2, h: 2 },
  RHODOPE_ROSETTE_ORIGIN: { col: 4, row: 10, w: 2, h: 2 },
  GOLDEN_WHEAT_ORIGIN: { col: 6, row: 10, w: 2, h: 2 },

  // Rows 12..15: Complete 16-tile Wang Sets (indices base + 0..15)
  WANG_ROAD_BASE: tileIdx(0, 12), // 192..207 (4-edge N=1,E=2,S=4,W=8)
  WANG_DROUGHT_BASE: tileIdx(0, 13), // 208..223 (4-corner NW=1,NE=2,SE=4,SW=8)
  WANG_BROOK_BASE: tileIdx(0, 14), // 224..239 (4-corner NW=1,NE=2,SE=4,SW=8 in 3/4 oblique)
  WANG_WALL_BASE: tileIdx(0, 15), // 240..255 (4-edge N=1,E=2,S=4,W=8 3/4 stone & tile wall)
} as const;

function tileOrigin(col: number, row: number): { x: number; y: number } {
  return { x: col * BALKAN_TILE_DIM, y: row * BALKAN_TILE_DIM };
}

function paintMeadowTile(buf: PixelBuffer, col: number, row: number, variant: 'plain' | 'flower' | 'clover'): void {
  const { x: ox, y: oy } = tileOrigin(col, row);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const h = hash2d(x, y, variant === 'plain' ? 11 : variant === 'flower' ? 23 : 37);
      const weave = ((x + y) & 1) === 0;
      let c = weave ? BALKAN_PAL.meadow : BALKAN_PAL.meadowDark;
      if (h > 0.78) c = BALKAN_PAL.meadowHi;
      if ((x % 8 === 2 || x % 8 === 5) && (y % 8 === 3) && h > 0.45) {
        c = BALKAN_PAL.meadowHi;
      }
      setPx(buf, ox + x, oy + y, c);
    }
  }
  if (variant === 'plain') {
    drawCrossStitch(buf, ox + 6, oy + 7, BALKAN_PAL.meadowHi, BALKAN_PAL.meadowDark, 2);
    drawCrossStitch(buf, ox + 21, oy + 20, BALKAN_PAL.meadowHi, BALKAN_PAL.meadowDark, 2);
  } else if (variant === 'flower') {
    // Stitched poppies, marigolds & bluebells
    drawCrossStitch(buf, ox + 6, oy + 6, BALKAN_PAL.crimsonHi, BALKAN_PAL.crimsonDark, 3);
    drawCrossStitch(buf, ox + 20, oy + 11, BALKAN_PAL.gold, BALKAN_PAL.ochre, 3);
    drawCrossStitch(buf, ox + 11, oy + 22, BALKAN_PAL.periwinkle, BALKAN_PAL.indigo, 3);
    setPx(buf, ox + 25, oy + 25, BALKAN_PAL.linenHi);
  } else {
    drawCrossStitch(buf, ox + 5, oy + 14, BALKAN_PAL.emerald, BALKAN_PAL.meadowDark, 3);
    drawCrossStitch(buf, ox + 18, oy + 6, BALKAN_PAL.jade, BALKAN_PAL.emerald, 3);
    drawCrossStitch(buf, ox + 22, oy + 22, BALKAN_PAL.meadowHi, BALKAN_PAL.emerald, 2);
  }
}

function paintDroughtTile(buf: PixelBuffer, col: number, row: number, scorched: boolean): void {
  const { x: ox, y: oy } = tileOrigin(col, row);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const h = hash2d(x, y, scorched ? 61 : 49);
      let c = scorched
        ? h > 0.65
          ? BALKAN_PAL.slateHi
          : h < 0.25
            ? BALKAN_PAL.slateDark
            : BALKAN_PAL.slate
        : h > 0.7
          ? BALKAN_PAL.dryEarthHi
          : h < 0.28
            ? BALKAN_PAL.dryEarthDark
            : BALKAN_PAL.dryEarth;
      setPx(buf, ox + x, oy + y, c);
    }
  }
  // Geometric drought cracks + dry stone joints
  const crackColor = scorched ? BALKAN_PAL.inkSoft : BALKAN_PAL.dryEarthDark;
  drawLine(buf, ox + 3, oy + 9, ox + 13, oy + 14, crackColor);
  drawLine(buf, ox + 13, oy + 14, ox + 21, oy + 10, crackColor);
  drawLine(buf, ox + 14, oy + 15, ox + 17, oy + 27, crackColor);
  drawLine(buf, ox + 22, oy + 21, ox + 29, oy + 26, crackColor);
  if (scorched) {
    setPx(buf, ox + 8, oy + 22, BALKAN_PAL.mintGlow);
    setPx(buf, ox + 24, oy + 7, BALKAN_PAL.jade);
  }
}

function paintKhoroRoadTile(buf: PixelBuffer, col: number, row: number, dir: 'h' | 'v' | 'cross' | 'stone'): void {
  const { x: ox, y: oy } = tileOrigin(col, row);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const h = hash2d(x, y, 73);
      const isStone = dir === 'stone';
      const base = isStone
        ? h > 0.72
          ? BALKAN_PAL.linenHi
          : h < 0.2
            ? BALKAN_PAL.cobbleHi
            : BALKAN_PAL.linenMid
        : h > 0.7
          ? BALKAN_PAL.cobbleHi
          : h < 0.25
            ? BALKAN_PAL.cobbleDark
            : BALKAN_PAL.cobble;
      setPx(buf, ox + x, oy + y, base);
    }
  }
  // Cobble tile seams (softer limestone grouts on plaza flagstones)
  const seamColor = dir === 'stone' ? BALKAN_PAL.linenShade : BALKAN_PAL.cobbleDark;
  for (let i = 0; i < 32; i += 8) {
    drawLine(buf, ox + i, oy, ox + i, oy + 31, seamColor);
    drawLine(buf, ox, oy + i, ox + 31, oy + i, seamColor);
  }
  if (dir === 'stone') {
    drawCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.crimson, BALKAN_PAL.ochre, 2);
    return;
  }
  const drawChevronH = (ry: number) => {
    fillRect(buf, ox, oy + ry, 32, 3, BALKAN_PAL.crimsonDark);
    for (let x = 0; x < 32; x += 4) {
      setPx(buf, ox + x, oy + ry + 1, BALKAN_PAL.gold);
      setPx(buf, ox + x + 1, oy + ry, BALKAN_PAL.crimsonHi);
      setPx(buf, ox + x + 2, oy + ry + 1, BALKAN_PAL.linenHi);
      setPx(buf, ox + x + 3, oy + ry + 2, BALKAN_PAL.crimsonHi);
    }
  };
  const drawChevronV = (rx: number) => {
    fillRect(buf, ox + rx, oy, 3, 32, BALKAN_PAL.crimsonDark);
    for (let y = 0; y < 32; y += 4) {
      setPx(buf, ox + rx + 1, oy + y, BALKAN_PAL.gold);
      setPx(buf, ox + rx, oy + y + 1, BALKAN_PAL.crimsonHi);
      setPx(buf, ox + rx + 1, oy + y + 2, BALKAN_PAL.linenHi);
      setPx(buf, ox + rx + 2, oy + y + 3, BALKAN_PAL.crimsonHi);
    }
  };
  if (dir === 'h') {
    drawChevronH(1);
    drawChevronH(28);
  } else if (dir === 'v') {
    drawChevronV(1);
    drawChevronV(28);
  } else {
    // Embroidered crossroads star
    drawChevronH(1);
    drawChevronH(28);
    drawChevronV(1);
    drawChevronV(28);
    drawEllipse(buf, ox + 16, oy + 16, 6, 6, BALKAN_PAL.crimsonDark);
    drawCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.gold, BALKAN_PAL.crimsonHi, 3);
  }
}

function paintWaterTile(buf: PixelBuffer, col: number, row: number, mode: 'brook' | 'shimmer' | 'silt'): void {
  const { x: ox, y: oy } = tileOrigin(col, row);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const wave = ((x + y * 2) % 8 === 0) || ((x * 2 + y) % 11 === 0);
      if (mode === 'silt') {
        setPx(buf, ox + x, oy + y, wave ? BALKAN_PAL.murkRim : BALKAN_PAL.murkWater);
      } else {
        setPx(buf, ox + x, oy + y, wave ? BALKAN_PAL.skyWater : BALKAN_PAL.waterDeep);
      }
    }
  }
  if (mode === 'shimmer') {
    drawLine(buf, ox + 6, oy + 8, ox + 12, oy + 8, BALKAN_PAL.waterFoam);
    drawLine(buf, ox + 18, oy + 20, ox + 25, oy + 20, BALKAN_PAL.waterFoam);
    setPx(buf, ox + 9, oy + 7, BALKAN_PAL.linenHi);
  } else if (mode === 'silt') {
    setPx(buf, ox + 10, oy + 14, BALKAN_PAL.mintGlow);
    setPx(buf, ox + 21, oy + 22, BALKAN_PAL.jade);
  }
}

function paintBridgeTile(buf: PixelBuffer, col: number, row: number, vertical: boolean): void {
  const { x: ox, y: oy } = tileOrigin(col, row);
  paintWaterTile(buf, col, row, 'brook');
  if (!vertical) {
    fillRect(buf, ox, oy + 4, 32, 24, BALKAN_PAL.wood);
    for (let x = 2; x < 32; x += 5) {
      drawLine(buf, ox + x, oy + 5, ox + x, oy + 27, BALKAN_PAL.woodDark);
      setPx(buf, ox + x + 1, oy + 15, BALKAN_PAL.crimson);
    }
    fillRect(buf, ox, oy + 2, 32, 3, BALKAN_PAL.woodHi);
    fillRect(buf, ox, oy + 27, 32, 3, BALKAN_PAL.woodDark);
    drawCrossStitch(buf, ox + 14, oy + 2, BALKAN_PAL.gold, BALKAN_PAL.crimson, 2);
  } else {
    fillRect(buf, ox + 4, oy, 24, 32, BALKAN_PAL.wood);
    for (let y = 2; y < 32; y += 5) {
      drawLine(buf, ox + 5, oy + y, ox + 27, oy + y, BALKAN_PAL.woodDark);
      setPx(buf, ox + 15, oy + y + 1, BALKAN_PAL.crimson);
    }
    fillRect(buf, ox + 2, oy, 3, 32, BALKAN_PAL.woodHi);
    fillRect(buf, ox + 27, oy, 3, 32, BALKAN_PAL.woodDark);
  }
}

function paintKilimBorderTile(buf: PixelBuffer, col: number, row: number, vertical: boolean): void {
  const { x: ox, y: oy } = tileOrigin(col, row);
  fillLinenWeave(buf, ox, oy, 32, 32);
  if (!vertical) {
    fillRect(buf, ox, oy + 6, 32, 20, BALKAN_PAL.crimson);
    fillRect(buf, ox, oy + 10, 32, 12, BALKAN_PAL.indigoDark);
    for (let x = 2; x < 30; x += 6) {
      drawCrossStitch(buf, ox + x, oy + 14, BALKAN_PAL.gold, BALKAN_PAL.crimsonHi, 3);
    }
  } else {
    fillRect(buf, ox + 6, oy, 20, 32, BALKAN_PAL.crimson);
    fillRect(buf, ox + 10, oy, 12, 32, BALKAN_PAL.indigoDark);
    for (let y = 2; y < 30; y += 6) {
      drawCrossStitch(buf, ox + 14, oy + y, BALKAN_PAL.gold, BALKAN_PAL.crimsonHi, 3);
    }
  }
}

function paintBrookBanksRow1(buf: PixelBuffer): void {
  const bankSpecs: Array<[number, 't' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br']> = [
    [0, 't'],
    [1, 'b'],
    [2, 'l'],
    [3, 'r'],
    [4, 'tl'],
    [5, 'tr'],
    [6, 'bl'],
    [7, 'br'],
  ];
  for (const [col, side] of bankSpecs) {
    paintMeadowTile(buf, col, 1, 'clover');
    const { x: ox, y: oy } = tileOrigin(col, 1);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        let inWater = false;
        if (side === 't') inWater = y >= 10;
        if (side === 'b') inWater = y <= 21;
        if (side === 'l') inWater = x >= 10;
        if (side === 'r') inWater = x <= 21;
        if (side === 'tl') inWater = x >= 10 && y >= 10;
        if (side === 'tr') inWater = x <= 21 && y >= 10;
        if (side === 'bl') inWater = x >= 10 && y <= 21;
        if (side === 'br') inWater = x <= 21 && y <= 21;
        if (inWater) {
          const isRim =
            (side.includes('t') && y <= 12) ||
            (side.includes('b') && y >= 19) ||
            (side.includes('l') && x <= 12) ||
            (side.includes('r') && x >= 19);
          setPx(
            buf,
            ox + x,
            oy + y,
            isRim
              ? BALKAN_PAL.cobbleDark
              : ((x + y * 2) % 9 === 0 ? BALKAN_PAL.skyWater : BALKAN_PAL.waterDeep),
          );
        }
      }
    }
  }

  // Row 1 cols 8..15: Fences & Small Folk Details (transparent bg)
  // 8: Horizontal wattle fence
  {
    const { x: ox, y: oy } = tileOrigin(8, 1);
    fillRect(buf, ox + 2, oy + 10, 4, 16, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 14, oy + 10, 4, 16, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 26, oy + 10, 4, 16, BALKAN_PAL.woodDark);
    for (let ry of [13, 18, 23]) {
      fillRect(buf, ox, oy + ry, 32, 2, ry === 18 ? BALKAN_PAL.woodHi : BALKAN_PAL.wood);
    }
  }
  // 9: Vertical wattle fence
  {
    const { x: ox, y: oy } = tileOrigin(9, 1);
    fillRect(buf, ox + 12, oy, 3, 32, BALKAN_PAL.wood);
    fillRect(buf, ox + 17, oy, 3, 32, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 11, oy + 4, 10, 4, BALKAN_PAL.woodHi);
    fillRect(buf, ox + 11, oy + 20, 10, 4, BALKAN_PAL.woodHi);
  }
  // 10: Carved Revival balustrade railing
  {
    const { x: ox, y: oy } = tileOrigin(10, 1);
    fillRect(buf, ox, oy + 14, 32, 3, BALKAN_PAL.woodHi);
    fillRect(buf, ox, oy + 25, 32, 3, BALKAN_PAL.woodDark);
    for (let x = 3; x < 30; x += 6) {
      fillRect(buf, ox + x, oy + 17, 2, 8, BALKAN_PAL.wood);
    }
    setPx(buf, ox + 15, oy + 15, BALKAN_PAL.crimsonHi);
  }
  // 11: Red geranium planter box
  {
    const { x: ox, y: oy } = tileOrigin(11, 1);
    fillRect(buf, ox + 5, oy + 18, 22, 10, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 6, oy + 19, 20, 4, BALKAN_PAL.wood);
    drawEllipse(buf, ox + 16, oy + 14, 10, 5, BALKAN_PAL.meadowDark);
    drawCrossStitch(buf, ox + 8, oy + 11, BALKAN_PAL.crimsonHi, BALKAN_PAL.crimsonDark, 3);
    drawCrossStitch(buf, ox + 15, oy + 9, BALKAN_PAL.crimsonHi, BALKAN_PAL.gold, 3);
    drawCrossStitch(buf, ox + 21, oy + 12, BALKAN_PAL.crimsonHi, BALKAN_PAL.crimsonDark, 3);
  }
  // 12: Hanging Red Pepper Strings (dry chushki)
  {
    const { x: ox, y: oy } = tileOrigin(12, 1);
    fillRect(buf, ox + 4, oy + 4, 24, 3, BALKAN_PAL.woodDark);
    for (const px of [7, 13, 19, 24]) {
      drawLine(buf, ox + px, oy + 7, ox + px, oy + 22, BALKAN_PAL.linenShade);
      for (let py = 9; py <= 20; py += 4) {
        fillRect(buf, ox + px - 1, oy + py, 3, 3, BALKAN_PAL.crimsonHi);
        setPx(buf, ox + px, oy + py + 2, BALKAN_PAL.crimsonDark);
      }
    }
  }
  // 13: Stone brazier lantern post
  {
    const { x: ox, y: oy } = tileOrigin(13, 1);
    fillRect(buf, ox + 12, oy + 14, 8, 15, BALKAN_PAL.slateDark);
    fillRect(buf, ox + 10, oy + 12, 12, 4, BALKAN_PAL.slateHi);
    drawEllipse(buf, ox + 16, oy + 8, 5, 5, BALKAN_PAL.ochre);
    drawEllipse(buf, ox + 16, oy + 7, 3, 3, BALKAN_PAL.gold);
    setPx(buf, ox + 16, oy + 5, BALKAN_PAL.linenHi);
  }
  // 14: Empty Clay Water Pitchers (small)
  {
    const { x: ox, y: oy } = tileOrigin(14, 1);
    drawEllipse(buf, ox + 10, oy + 21, 5, 6, BALKAN_PAL.terracotta);
    fillRect(buf, ox + 8, oy + 13, 4, 3, BALKAN_PAL.terracottaHi);
    drawEllipse(buf, ox + 22, oy + 23, 4, 5, BALKAN_PAL.terracottaDark);
    fillRect(buf, ox + 20, oy + 17, 4, 2, BALKAN_PAL.terracotta);
  }
  // 15: Carved Votive Stone Cross / Obrok
  {
    const { x: ox, y: oy } = tileOrigin(15, 1);
    fillRect(buf, ox + 9, oy + 24, 14, 6, BALKAN_PAL.cobbleDark);
    fillRect(buf, ox + 13, oy + 6, 6, 19, BALKAN_PAL.cobbleHi);
    fillRect(buf, ox + 7, oy + 11, 18, 5, BALKAN_PAL.cobbleHi);
    drawCrossStitch(buf, ox + 14, oy + 12, BALKAN_PAL.crimson, BALKAN_PAL.ochre, 3);
    setPx(buf, ox + 11, oy + 23, BALKAN_PAL.crimsonHi);
    setPx(buf, ox + 20, oy + 23, BALKAN_PAL.gold);
  }
}

/** 4x4 Elbetitsa (8-Fold Protective Star) Woven Plaza Plinth in 3/4 oblique view at cols 0..3, rows 2..5. */
function paintElbetitsaPlaza(buf: PixelBuffer): void {
  const ox = 0;
  const oy = 2 * BALKAN_TILE_DIM; // 128x128 block
  const size = 128;
  const cx = 64;
  const cy = 62;
  const ySquash = 1.38; // ~0.72 vertical foreshortening for 3/4 oblique floor plane

  const plinthMetric = (dx: number, dy: number): number => {
    const sy = dy * ySquash;
    const cheb = Math.max(Math.abs(dx), Math.abs(sy));
    const oct = (Math.abs(dx) + Math.abs(sy)) * 0.72;
    return Math.max(cheb, oct);
  };

  // Visible 5px front carved limestone riser along the south plinth edge
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dSide = plinthMetric(dx, y - (cy + 5) + 0.5);
      if (dSide <= 61 && y > cy) {
        setPx(buf, ox + x, oy + y, dSide > 58 ? BALKAN_PAL.cobbleDark : BALKAN_PAL.slateDark);
      }
    }
  }

  // Oblique octagonal/fringed limestone medallion top surface
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const d = plinthMetric(dx, dy);
      if (d > 61) continue;
      if (d > 58) {
        if (((x + y) & 1) === 0) setPx(buf, ox + x, oy + y, BALKAN_PAL.gold);
        continue;
      }
      if (d > 54) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.crimsonDark);
        continue;
      }
      if (d > 50) {
        setPx(buf, ox + x, oy + y, ((x + y) & 3) === 0 ? BALKAN_PAL.gold : BALKAN_PAL.crimson);
        continue;
      }
      const weave = ((x + y) & 1) === 0 ? BALKAN_PAL.linenHi : BALKAN_PAL.linenMid;
      setPx(buf, ox + x, oy + y, weave);
    }
  }

  // Foreshortened 8-Fold Elbetitsa protective star lying flat in all 4 quadrants of the 3/4 plaza plane
  for (let y = 0; y < 38; y++) {
    for (let x = 0; x < 50; x++) {
      const fy = Math.round(y * ySquash);
      const u = Math.max(x, fy);
      const v = Math.min(x, fy);
      let thread: Rgba | null = null;
      if (u + v >= 42 && u + v <= 46) thread = BALKAN_PAL.indigoDark;
      else if (u + v === 41 || u + v === 47) thread = BALKAN_PAL.crimson;
      else if (v <= 5 && u >= 10 && u <= 38) {
        thread = v <= 2 ? BALKAN_PAL.crimsonHi : BALKAN_PAL.inkSoft;
      } else if (Math.abs(x - fy) <= 4 && u >= 12 && u <= 34) {
        thread = Math.abs(x - fy) <= 1 ? BALKAN_PAL.ochre : BALKAN_PAL.crimson;
      } else if (u >= 18 && u <= 23 && v >= 10 && v <= 16) {
        thread = BALKAN_PAL.emerald;
      } else if (u <= 9 && v <= 9) {
        thread = u + v <= 6 ? BALKAN_PAL.gold : BALKAN_PAL.crimson;
      }
      if (thread) {
        setPx(buf, ox + cx + x, oy + cy + y, thread);
        setPx(buf, ox + cx - x, oy + cy + y, thread);
        setPx(buf, ox + cx + x, oy + cy - y, thread);
        setPx(buf, ox + cx - x, oy + cy - y, thread);
      }
    }
  }
  drawCrossStitch(buf, ox + cx - 2, oy + cy - 2, BALKAN_PAL.linenHi, BALKAN_PAL.gold, 3);
}

/** 3x3 Tree of Life & Paired Roosters Courtyard Loom Deck (3/4 oblique plinth) at cols 4..6, rows 2..4. */
function paintTreeOfLifeCarpet(buf: PixelBuffer): void {
  const ox = 4 * BALKAN_TILE_DIM;
  const oy = 2 * BALKAN_TILE_DIM;
  // Visible oak platform front bevel in 3/4 view (y = 82..88)
  fillRect(buf, ox + 3, oy + 78, 90, 9, BALKAN_PAL.woodDark);
  fillRect(buf, ox + 4, oy + 78, 88, 5, BALKAN_PAL.wood);
  // Foreshortened carpet surface (width 90, oblique height 68 -> y = 11..79)
  fillLinenWeave(buf, ox + 3, oy + 11, 90, 68);
  // Decorative red-indigo perimeter loom frame & front/back tassels
  for (let i = 3; i < 93; i += 2) {
    setPx(buf, ox + i, oy + 12, i % 4 === 0 ? BALKAN_PAL.crimson : BALKAN_PAL.indigo);
    setPx(buf, ox + i, oy + 77, i % 4 === 0 ? BALKAN_PAL.crimson : BALKAN_PAL.indigo);
    if (i % 4 === 0) {
      setPx(buf, ox + i, oy + 9, BALKAN_PAL.gold);
      setPx(buf, ox + i, oy + 80, BALKAN_PAL.gold);
    }
  }
  for (let y = 12; y < 78; y += 2) {
    setPx(buf, ox + 4, oy + y, y % 4 === 0 ? BALKAN_PAL.crimson : BALKAN_PAL.indigo);
    setPx(buf, ox + 91, oy + y, y % 4 === 0 ? BALKAN_PAL.crimson : BALKAN_PAL.indigo);
  }
  const cx = ox + 48;
  // Foreshortened woven Tree of Life motif
  fillRect(buf, cx - 2, oy + 24, 4, 42, BALKAN_PAL.woodDark);
  fillRect(buf, cx - 10, oy + 65, 20, 5, BALKAN_PAL.crimson);
  fillRect(buf, cx - 6, oy + 61, 12, 4, BALKAN_PAL.ochre);
  for (const [by, spread] of [
    [53, 18],
    [41, 24],
    [29, 16],
  ]) {
    drawLine(buf, cx, oy + by, cx - spread, oy + by - 6, BALKAN_PAL.emerald);
    drawLine(buf, cx, oy + by, cx + spread, oy + by - 6, BALKAN_PAL.emerald);
    drawCrossStitch(buf, cx - spread - 2, oy + by - 8, BALKAN_PAL.crimsonHi, BALKAN_PAL.gold, 2);
    drawCrossStitch(buf, cx + spread - 1, oy + by - 8, BALKAN_PAL.crimsonHi, BALKAN_PAL.gold, 2);
  }
  drawCrossStitch(buf, cx - 2, oy + 17, BALKAN_PAL.gold, BALKAN_PAL.crimsonHi, 3);
  for (const dir of [-1, 1]) {
    const bx = cx + dir * 20;
    const by = oy + 52;
    drawEllipse(buf, bx, by, 7, 4, BALKAN_PAL.indigoDark);
    drawEllipse(buf, bx - dir * 3, by - 4, 3, 2, BALKAN_PAL.crimsonHi);
    setPx(buf, bx - dir * 6, by - 4, BALKAN_PAL.gold);
    drawLine(buf, bx + dir * 5, by - 1, bx + dir * 10, by - 6, BALKAN_PAL.crimson);
    drawLine(buf, bx + dir * 4, by, bx + dir * 9, by - 3, BALKAN_PAL.emerald);
    drawLine(buf, bx, by + 4, bx, by + 8, BALKAN_PAL.ochre);
  }
}

/** 3x3 Pirin Rose & Periwinkle Samodiva Dancing Ring (3/4 oblique oval + standing lantern stakes) at cols 7..9, rows 2..4. */
function paintSamodivaGlade(buf: PixelBuffer): void {
  const ox = 7 * BALKAN_TILE_DIM;
  const oy = 2 * BALKAN_TILE_DIM;
  const cx = 48;
  const cy = 50;
  const ySquash = 1.42;

  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const dx = x - cx + 0.5;
      const dy = (y - cy + 0.5) * ySquash;
      const dist = Math.hypot(dx, dy);
      if (dist > 45 || dist < 12) continue;
      if (dist > 37 && dist <= 45) {
        const angleTick = Math.floor((Math.atan2(dy, dx) + Math.PI) * 6);
        setPx(
          buf,
          ox + x,
          oy + y,
          (angleTick & 1) === 0 ? BALKAN_PAL.rose : BALKAN_PAL.periwinkle,
        );
      } else if (dist >= 22 && dist <= 32) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.linenHi);
      }
    }
  }
  // Four upright wooden flower lantern totems tucked in 3/4 corners around the oval glade
  for (const [mx, my] of [
    [ox + 18, oy + 24],
    [ox + 76, oy + 24],
    [ox + 18, oy + 74],
    [ox + 76, oy + 74],
  ]) {
    fillRect(buf, mx - 1, my, 3, 7, BALKAN_PAL.woodDark);
    drawCrossStitch(buf, mx - 1, my - 4, BALKAN_PAL.rosePale, BALKAN_PAL.periwinkle, 2);
  }
  drawCrossStitch(buf, ox + 46, oy + 48, BALKAN_PAL.gold, BALKAN_PAL.rose, 3);
}

/** 3x3 Kukeri Fire Hearth & Standing Chanove Bell Posts (3/4 oblique) at cols 10..12, rows 2..4. */
function paintKukeriHearth(buf: PixelBuffer): void {
  const ox = 10 * BALKAN_TILE_DIM;
  const oy = 2 * BALKAN_TILE_DIM;
  const cx = ox + 48;
  const cy = oy + 52;

  // Foreshortened ash & crimson hearth stone/rug pad with south bevel
  drawEllipse(buf, cx, cy + 4, 42, 29, BALKAN_PAL.cobbleDark);
  drawEllipse(buf, cx, cy, 42, 28, BALKAN_PAL.cobbleDark);
  drawEllipse(buf, cx, cy, 36, 24, BALKAN_PAL.crimsonDark);
  drawEllipse(buf, cx, cy, 29, 19, BALKAN_PAL.inkSoft);

  // 12 3/4 Fieldstones sorted Y-back-to-front so southern stones overlap nicely
  const stones: Array<{ sx: number; sy: number }> = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    stones.push({
      sx: Math.round(cx + Math.cos(a) * 19),
      sy: Math.round(cy + Math.sin(a) * 12),
    });
  }
  stones.sort((a, b) => a.sy - b.sy);
  for (const st of stones) {
    fillRect(buf, st.sx - 4, st.sy, 8, 5, BALKAN_PAL.slateDark); // 3/4 stone riser front
    drawEllipse(buf, st.sx, st.sy, 5, 3, BALKAN_PAL.slateHi); // sunlit stone cap
    drawEllipse(buf, st.sx, st.sy + 1, 3, 2, BALKAN_PAL.slate);
  }

  // Tall standing embers & bonfire tongues leaping upward out of the hearth
  drawEllipse(buf, cx, cy - 1, 12, 8, BALKAN_PAL.crimsonHi);
  drawEllipse(buf, cx, cy - 5, 9, 9, BALKAN_PAL.ochre);
  drawEllipse(buf, cx, cy - 9, 5, 7, BALKAN_PAL.gold);
  setPx(buf, cx - 1, cy - 17, BALKAN_PAL.gold);
  setPx(buf, cx + 2, cy - 15, BALKAN_PAL.crimsonHi);

  // Upright oak posts hanging Kukeri bronze chanove bells at outer corners
  for (const [bx, by] of [
    [ox + 15, oy + 20],
    [ox + 79, oy + 20],
    [ox + 15, oy + 76],
    [ox + 79, oy + 76],
  ]) {
    fillRect(buf, bx - 1, by - 4, 2, 12, BALKAN_PAL.woodDark);
    fillRect(buf, bx - 3, by - 2, 6, 7, BALKAN_PAL.ochre);
    fillRect(buf, bx - 2, by - 1, 4, 4, BALKAN_PAL.gold);
    setPx(buf, bx, by + 5, BALKAN_PAL.crimsonHi);
  }
}

/**
 * 3x3 CENTERPIECE: THE CURSED WELL OF THE LAMIA in true 3/4 oblique cylindrical projection
 * (cols 13..15, rows 2..4 = 96x96).
 */
function paintLamiaWell(buf: PixelBuffer): void {
  const ox = 13 * BALKAN_TILE_DIM;
  const oy = 2 * BALKAN_TILE_DIM;
  const cx = ox + 48;

  // Ground drought hollow depression & masonry shadow
  drawEllipse(buf, cx, oy + 59, 44, 25, BALKAN_PAL.dryEarthDark);
  drawEllipse(buf, cx, oy + 56, 38, 21, BALKAN_PAL.slateDark);

  // Rear coiling Lamia serpent flank emerging behind stone masonry
  drawEllipse(buf, cx - 25, oy + 49, 13, 12, BALKAN_PAL.emeraldDark);
  drawEllipse(buf, cx - 25, oy + 49, 9, 9, BALKAN_PAL.emerald);
  drawEllipse(buf, cx + 25, oy + 51, 13, 12, BALKAN_PAL.emeraldDark);
  drawEllipse(buf, cx + 25, oy + 51, 9, 9, BALKAN_PAL.jade);

  // Cylindrical well drum: shaded smoothly across X (bright left/front -> dark right/bottom)
  const wellTopY = oy + 34;
  const wellBotY = oy + 62;
  for (let y = wellTopY; y <= wellBotY; y++) {
    const t = (y - wellTopY) / (wellBotY - wellTopY);
    for (let dx = -22; dx <= 22; dx++) {
      // Bottom rounded cylindrical skirt
      const maxSkirtDrop = Math.sqrt(Math.max(0, 1 - (dx / 22) * (dx / 22))) * 7;
      if (y > wellBotY - 7 + maxSkirtDrop) continue;
      const isMortar = y % 6 === 0 || (dx + (Math.floor(y / 6) % 2) * 5) % 10 === 0;
      let col: Rgba = BALKAN_PAL.slate;
      if (dx < -10) col = BALKAN_PAL.slateHi;
      else if (dx > 12 || t > 0.78) col = BALKAN_PAL.slateDark;
      if (isMortar && y > wellTopY + 3) col = BALKAN_PAL.cobbleDark;
      setPx(buf, cx + dx, y, col);
    }
  }

  // Oblique oval stone well coping rim & recessed inner wall + glowing abyss water
  drawEllipse(buf, cx, wellTopY, 23, 9, BALKAN_PAL.slateHi);
  drawEllipse(buf, cx, wellTopY + 1, 20, 7, BALKAN_PAL.slate);
  drawEllipse(buf, cx, wellTopY + 1, 16, 6, BALKAN_PAL.cobbleDark); // visible interior north stone wall
  drawEllipse(buf, cx, wellTopY + 3, 14, 4, BALKAN_PAL.ink);
  drawEllipse(buf, cx, wellTopY + 4, 10, 3, BALKAN_PAL.emeraldDark);
  setPx(buf, cx - 4, wellTopY + 4, BALKAN_PAL.mintGlow);
  setPx(buf, cx + 5, wellTopY + 3, BALKAN_PAL.mintGlow);

  // Carved oak windlass posts & shingled canopy roof overhead in true 3/4 height
  fillRect(buf, cx - 20, oy + 12, 4, 24, BALKAN_PAL.woodDark);
  fillRect(buf, cx + 16, oy + 12, 4, 24, BALKAN_PAL.woodDark);
  fillRect(buf, cx - 18, oy + 17, 36, 3, BALKAN_PAL.woodHi);
  drawLine(buf, cx, oy + 18, cx, wellTopY + 3, BALKAN_PAL.linenShade);
  for (let r = 0; r < 11; r++) {
    fillRect(
      buf,
      cx - 12 - r,
      oy + 3 + r,
      24 + r * 2,
      2,
      r < 4 ? BALKAN_PAL.terracottaHi : r < 8 ? BALKAN_PAL.terracotta : BALKAN_PAL.terracottaDark,
    );
  }
  drawCrossStitch(buf, cx - 1, oy + 6, BALKAN_PAL.crimsonHi, BALKAN_PAL.gold, 3);
  fillRect(buf, cx - 21, oy + 20, 2, 7, BALKAN_PAL.crimsonHi);
  fillRect(buf, cx + 19, oy + 20, 2, 7, BALKAN_PAL.crimsonHi);

  // Foreground Lamia coils curving around the cylindrical drum bottom
  for (let i = -30; i <= 30; i++) {
    const curveY = Math.sqrt(Math.max(0, 1 - (i / 34) * (i / 34))) * 6;
    const sy = Math.round(oy + 54 + curveY + Math.sin(i * 0.16) * 3);
    drawEllipse(buf, cx + i, sy, 4, 3, Math.abs(i) % 8 < 4 ? BALKAN_PAL.emerald : BALKAN_PAL.jade);
    if (i % 6 === 0) {
      setPx(buf, cx + i, sy - 1, BALKAN_PAL.gold);
      setPx(buf, cx + i, sy + 1, BALKAN_PAL.crimson);
    }
  }
  // Raised horned Lamia head peering over right stone rim
  drawEllipse(buf, cx + 22, oy + 38, 6, 5, BALKAN_PAL.emeraldDark);
  drawEllipse(buf, cx + 22, oy + 38, 4, 4, BALKAN_PAL.jade);
  drawLine(buf, cx + 20, oy + 33, cx + 18, oy + 29, BALKAN_PAL.gold);
  drawLine(buf, cx + 24, oy + 33, cx + 26, oy + 29, BALKAN_PAL.gold);
  setPx(buf, cx + 21, oy + 37, BALKAN_PAL.gold);
  setPx(buf, cx + 23, oy + 37, BALKAN_PAL.gold);
  setPx(buf, cx + 26, oy + 40, BALKAN_PAL.crimsonHi);
  setPx(buf, cx + 27, oy + 39, BALKAN_PAL.crimsonHi);

  drawLine(buf, cx + 28, oy + 61, cx + 39, oy + 55, BALKAN_PAL.jade);
  setPx(buf, cx + 40, oy + 54, BALKAN_PAL.mintGlow);

  // 3/4 Oblique South Sacrifice Altar Slab (lit stone top + 4px dark southern stone riser!)
  fillRect(buf, cx - 24, oy + 76, 48, 12, BALKAN_PAL.slateDark);
  fillRect(buf, cx - 23, oy + 73, 46, 10, BALKAN_PAL.cobbleHi);
  fillRect(buf, cx - 10, oy + 73, 20, 10, BALKAN_PAL.crimson);
  fillRect(buf, cx - 10, oy + 83, 20, 4, BALKAN_PAL.crimsonDark);
  drawCrossStitch(buf, cx - 1, oy + 76, BALKAN_PAL.gold, BALKAN_PAL.crimsonDark, 3);
  fillRect(buf, cx - 16, oy + 71, 2, 6, BALKAN_PAL.linenHi);
  setPx(buf, cx - 16, oy + 70, BALKAN_PAL.gold);
  fillRect(buf, cx + 14, oy + 71, 2, 6, BALKAN_PAL.linenHi);
  setPx(buf, cx + 14, oy + 70, BALKAN_PAL.gold);
  setPx(buf, cx - 13, oy + 80, BALKAN_PAL.silverHi);
  setPx(buf, cx + 12, oy + 79, BALKAN_PAL.gold);
}

/** Generic 3x3 Balkan Revival Timber Cottage builder parameterized by palette & craft detail. */
function paintRevivalCottage(
  buf: PixelBuffer,
  col0: number,
  row0: number,
  style: {
    roofMain: Rgba;
    roofHi: Rgba;
    wallMain: Rgba;
    wallLower: Rgba;
    accent: Rgba;
    detail: 'peppers' | 'herbs' | 'forge';
  },
): void {
  const ox = col0 * BALKAN_TILE_DIM;
  const oy = row0 * BALKAN_TILE_DIM;
  const cx = ox + 48;

  // Ground drop shadow & stone foundation
  fillRect(buf, ox + 6, oy + 78, 84, 14, BALKAN_PAL.cobbleDark);
  fillRect(buf, ox + 10, oy + 52, 76, 36, style.wallLower);
  fillRect(buf, ox + 12, oy + 54, 72, 32, BALKAN_PAL.cobble);

  // Projecting upper wooden erker (overhang) storey!
  fillRect(buf, ox + 6, oy + 32, 84, 26, style.wallMain);
  // Heavy carved oak half-timber frame beams
  fillRect(buf, ox + 6, oy + 32, 84, 3, BALKAN_PAL.woodDark);
  fillRect(buf, ox + 6, oy + 55, 84, 3, BALKAN_PAL.woodDark);
  for (const bx of [ox + 6, ox + 26, ox + 46, ox + 68, ox + 87]) {
    fillRect(buf, bx, oy + 32, 3, 25, BALKAN_PAL.woodDark);
  }
  // Stepped Balkan hip terracotta/slate tiled roof
  for (let r = 0; r < 26; r++) {
    const inset = Math.max(2, 26 - r);
    const col = (r % 4 === 0) ? BALKAN_PAL.inkSoft : (r % 2 === 0 ? style.roofHi : style.roofMain);
    fillRect(buf, ox + inset, oy + 8 + r, 96 - inset * 2, 2, col);
  }
  // Chimney with curl of woodsmoke / forge sparks
  fillRect(buf, ox + 68, oy + 4, 8, 16, BALKAN_PAL.cobbleDark);
  drawEllipse(buf, ox + 72, oy + 2, 4, 2, BALKAN_PAL.silverHi);

  // Upper bay embroidered wooden lattice windows
  for (const wx of [ox + 15, ox + 34, ox + 54, ox + 74]) {
    fillRect(buf, wx, oy + 39, 9, 10, BALKAN_PAL.indigoDark);
    fillRect(buf, wx + 1, oy + 40, 7, 8, BALKAN_PAL.gold);
    drawLine(buf, wx + 4, oy + 39, wx + 4, oy + 49, BALKAN_PAL.woodDark);
    drawLine(buf, wx, oy + 44, wx + 9, oy + 44, BALKAN_PAL.woodDark);
  }

  // Lower arched oak door
  fillRect(buf, cx - 7, oy + 64, 14, 24, BALKAN_PAL.woodDark);
  fillRect(buf, cx - 5, oy + 66, 10, 22, BALKAN_PAL.woodHi);
  setPx(buf, cx + 3, oy + 76, BALKAN_PAL.gold);

  // Signature exterior detail
  if (style.detail === 'peppers') {
    // Geranium flowerboxes & dried red pepper strings
    fillRect(buf, ox + 13, oy + 50, 13, 4, BALKAN_PAL.woodDark);
    drawCrossStitch(buf, ox + 16, oy + 48, BALKAN_PAL.crimsonHi, BALKAN_PAL.emerald, 2);
    for (const px of [ox + 60, ox + 66, ox + 72]) {
      drawLine(buf, px, oy + 58, px, oy + 72, BALKAN_PAL.crimsonHi);
    }
  } else if (style.detail === 'herbs') {
    // Drying lavender/basil herb bundles & turquoise evil-eye charm
    for (const hx of [ox + 16, ox + 22, ox + 66, ox + 74]) {
      fillRect(buf, hx, oy + 58, 3, 10, BALKAN_PAL.emerald);
      setPx(buf, hx + 1, oy + 62, BALKAN_PAL.rose);
    }
    drawCrossStitch(buf, cx - 2, oy + 58, BALKAN_PAL.periwinkle, BALKAN_PAL.indigo, 3);
  } else {
    // Chiprovtsi red kilim rug draped over Čardak balcony + blacksmith glow
    fillRect(buf, ox + 14, oy + 54, 24, 10, BALKAN_PAL.crimson);
    drawCrossStitch(buf, ox + 18, oy + 57, BALKAN_PAL.gold, BALKAN_PAL.indigoDark, 3);
    drawCrossStitch(buf, ox + 28, oy + 57, BALKAN_PAL.gold, BALKAN_PAL.indigoDark, 3);
    drawEllipse(buf, ox + 74, oy + 76, 8, 6, BALKAN_PAL.crimsonDark);
    drawEllipse(buf, ox + 74, oy + 76, 4, 3, BALKAN_PAL.gold);
  }
}

function paintTreesAndFolkloreProps(buf: PixelBuffer): void {
  // Ancient Martenitsa Oak (2x2 at col 13..14, row 5..6 = 64x64)
  {
    const ox = 13 * BALKAN_TILE_DIM;
    const oy = 5 * BALKAN_TILE_DIM;
    const cx = ox + 32;
    fillRect(buf, cx - 6, oy + 34, 12, 26, BALKAN_PAL.woodDark);
    fillRect(buf, cx - 4, oy + 36, 8, 22, BALKAN_PAL.wood);
    drawEllipse(buf, cx, oy + 24, 26, 20, BALKAN_PAL.emeraldDark);
    drawEllipse(buf, cx - 8, oy + 20, 16, 14, BALKAN_PAL.emerald);
    drawEllipse(buf, cx + 10, oy + 22, 14, 12, BALKAN_PAL.meadowHi);
    drawEllipse(buf, cx, oy + 14, 14, 10, BALKAN_PAL.meadowHi);
    // Red-and-white Martenitsa threads tied onto bark & branches!
    drawCrossStitch(buf, cx - 10, oy + 26, BALKAN_PAL.crimsonHi, BALKAN_PAL.linenHi, 3);
    drawCrossStitch(buf, cx + 8, oy + 24, BALKAN_PAL.crimsonHi, BALKAN_PAL.linenHi, 3);
    fillRect(buf, cx - 5, oy + 44, 10, 2, BALKAN_PAL.crimsonHi);
    setPx(buf, cx - 2, oy + 45, BALKAN_PAL.linenHi);
    setPx(buf, cx + 2, oy + 45, BALKAN_PAL.linenHi);
  }

  // Samodiva Silver Birch (1x2 at col 15, row 5..6 = 32x64)
  {
    const ox = 15 * BALKAN_TILE_DIM;
    const oy = 5 * BALKAN_TILE_DIM;
    fillRect(buf, ox + 13, oy + 28, 6, 32, BALKAN_PAL.linenHi);
    fillRect(buf, ox + 14, oy + 34, 3, 2, BALKAN_PAL.inkSoft);
    fillRect(buf, ox + 15, oy + 44, 4, 2, BALKAN_PAL.inkSoft);
    drawEllipse(buf, ox + 16, oy + 20, 13, 16, BALKAN_PAL.jade);
    drawEllipse(buf, ox + 15, oy + 16, 10, 11, BALKAN_PAL.mintGlow);
    setPx(buf, ox + 11, oy + 24, BALKAN_PAL.periwinkle);
    setPx(buf, ox + 20, oy + 26, BALKAN_PAL.rosePale);
  }

  // Row 7 cols 13..15:
  // 13,7: Upright Loom strung with shevitsa tapestry
  {
    const { x: ox, y: oy } = tileOrigin(13, 7);
    fillRect(buf, ox + 5, oy + 4, 3, 26, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 24, oy + 4, 3, 26, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 4, oy + 4, 24, 3, BALKAN_PAL.woodHi);
    fillRect(buf, ox + 4, oy + 26, 24, 3, BALKAN_PAL.woodHi);
    fillLinenWeave(buf, ox + 8, oy + 7, 16, 19);
    fillRect(buf, ox + 8, oy + 15, 16, 11, BALKAN_PAL.crimson);
    drawCrossStitch(buf, ox + 12, oy + 18, BALKAN_PAL.gold, BALKAN_PAL.linenHi, 3);
    drawCrossStitch(buf, ox + 17, oy + 18, BALKAN_PAL.gold, BALKAN_PAL.linenHi, 3);
  }
  // 14,7: Sacrificial Tribute Offering (wool fleece, wheat sheaf, honey pot & wine flask)
  {
    const { x: ox, y: oy } = tileOrigin(14, 7);
    fillRect(buf, ox + 3, oy + 14, 26, 14, BALKAN_PAL.linenMid);
    fillRect(buf, ox + 5, oy + 15, 22, 4, BALKAN_PAL.crimson);
    drawEllipse(buf, ox + 10, oy + 15, 5, 4, BALKAN_PAL.fleece); // white wool offering
    fillRect(buf, ox + 18, oy + 10, 6, 8, BALKAN_PAL.ochre); // honey jar
    setPx(buf, ox + 21, oy + 10, BALKAN_PAL.gold);
    drawLine(buf, ox + 6, oy + 22, ox + 15, oy + 22, BALKAN_PAL.gold); // wheat bundle
  }
  // 15,7: Stacked Broken/Dry Amphorae & Warning Skull-Stake
  {
    const { x: ox, y: oy } = tileOrigin(15, 7);
    drawEllipse(buf, ox + 9, oy + 22, 5, 6, BALKAN_PAL.terracotta);
    drawEllipse(buf, ox + 20, oy + 23, 5, 5, BALKAN_PAL.terracottaDark);
    fillRect(buf, ox + 14, oy + 6, 3, 22, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 10, oy + 10, 11, 2, BALKAN_PAL.crimsonHi); // warning cloth
  }

  // Row 8..9 col 0: Tall Balkan Mountain Pine (1x2)
  {
    const ox = 0;
    const oy = 8 * BALKAN_TILE_DIM;
    fillRect(buf, ox + 13, oy + 42, 6, 18, BALKAN_PAL.woodDark);
    for (const [ty, rx] of [
      [14, 7],
      [25, 11],
      [37, 14],
    ]) {
      for (let r = 0; r < 14; r++) {
        const w = Math.max(2, Math.round((r / 14) * rx * 2));
        fillRect(
          buf,
          ox + 16 - Math.floor(w / 2),
          oy + ty + r - 6,
          w,
          1,
          r < 4 ? BALKAN_PAL.emerald : BALKAN_PAL.emeraldDark,
        );
      }
    }
  }

  // Row 8 cols 1..7: Sunflowers, Poppies, Barrel, Anvil, Noticeboard, Bench, Rug
  {
    // 1,8 Sunflowers
    const { x: ox, y: oy } = tileOrigin(1, 8);
    for (const [sx, sy] of [
      [8, 12],
      [19, 10],
      [14, 21],
    ]) {
      drawLine(buf, ox + sx, oy + sy, ox + sx, oy + 28, BALKAN_PAL.meadowDark);
      drawEllipse(buf, ox + sx, oy + sy, 4, 4, BALKAN_PAL.gold);
      drawEllipse(buf, ox + sx, oy + sy, 2, 2, BALKAN_PAL.woodDark);
    }
  }
  {
    // 2,8 Crimson Poppy & Sage bush (crisp dark leaf shadow so it contrasts against meadow grass)
    const { x: ox, y: oy } = tileOrigin(2, 8);
    drawEllipse(buf, ox + 16, oy + 18, 12, 10, BALKAN_PAL.inkSoft);
    drawEllipse(buf, ox + 16, oy + 17, 11, 9, BALKAN_PAL.emeraldDark);
    drawEllipse(buf, ox + 15, oy + 15, 8, 6, BALKAN_PAL.emerald);
    drawCrossStitch(buf, ox + 9, oy + 12, BALKAN_PAL.crimsonHi, BALKAN_PAL.gold, 3);
    drawCrossStitch(buf, ox + 19, oy + 13, BALKAN_PAL.crimsonHi, BALKAN_PAL.gold, 3);
    drawCrossStitch(buf, ox + 14, oy + 18, BALKAN_PAL.crimsonHi, BALKAN_PAL.crimsonDark, 3);
  }
  {
    // 3,8 Wine Barrel
    const { x: ox, y: oy } = tileOrigin(3, 8);
    drawEllipse(buf, ox + 16, oy + 17, 9, 11, BALKAN_PAL.wood);
    fillRect(buf, ox + 7, oy + 12, 18, 2, BALKAN_PAL.slateDark);
    fillRect(buf, ox + 7, oy + 21, 18, 2, BALKAN_PAL.slateDark);
  }
  {
    // 4,8 Blacksmith Anvil
    const { x: ox, y: oy } = tileOrigin(4, 8);
    fillRect(buf, ox + 8, oy + 22, 16, 6, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 6, oy + 12, 20, 6, BALKAN_PAL.slateDark);
    fillRect(buf, ox + 10, oy + 18, 10, 4, BALKAN_PAL.slate);
    fillRect(buf, ox + 5, oy + 12, 5, 3, BALKAN_PAL.slateHi);
  }
  {
    // 5,8 Edict Noticeboard
    const { x: ox, y: oy } = tileOrigin(5, 8);
    fillRect(buf, ox + 8, oy + 18, 3, 12, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 21, oy + 18, 3, 12, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 4, oy + 6, 24, 15, BALKAN_PAL.wood);
    fillRect(buf, ox + 7, oy + 8, 8, 10, BALKAN_PAL.linenHi);
    setPx(buf, ox + 11, oy + 9, BALKAN_PAL.crimsonHi);
    fillRect(buf, ox + 17, oy + 9, 8, 8, BALKAN_PAL.linenMid);
  }
  {
    // 6,8 Oak Bench
    const { x: ox, y: oy } = tileOrigin(6, 8);
    fillRect(buf, ox + 4, oy + 15, 24, 5, BALKAN_PAL.woodHi);
    fillRect(buf, ox + 6, oy + 20, 3, 8, BALKAN_PAL.woodDark);
    fillRect(buf, ox + 23, oy + 20, 3, 8, BALKAN_PAL.woodDark);
  }
  {
    // 7,8 Chiprovtsi Porch Rug (3/4 oblique floor rug + tassels)
    const { x: ox, y: oy } = tileOrigin(7, 8);
    fillRect(buf, ox + 3, oy + 9, 26, 15, BALKAN_PAL.crimsonDark);
    fillRect(buf, ox + 3, oy + 8, 26, 14, BALKAN_PAL.crimson);
    fillRect(buf, ox + 6, oy + 10, 20, 10, BALKAN_PAL.indigoDark);
    drawCrossStitch(buf, ox + 14, oy + 13, BALKAN_PAL.gold, BALKAN_PAL.linenHi, 2);
    for (let y = 9; y <= 21; y += 3) {
      setPx(buf, ox + 2, oy + y, BALKAN_PAL.linenHi);
      setPx(buf, ox + 29, oy + y, BALKAN_PAL.linenHi);
    }
  }
}

function paintRow10Extras(buf: PixelBuffer): void {
  // Enchanted Samodiva Spring Pool (2x2 at col 1..2, row 10..11) in 3/4 oblique grotto depth
  {
    const ox = 1 * BALKAN_TILE_DIM;
    const oy = 10 * BALKAN_TILE_DIM;
    drawEllipse(buf, ox + 32, oy + 35, 29, 21, BALKAN_PAL.cobbleDark);
    drawEllipse(buf, ox + 32, oy + 32, 27, 19, BALKAN_PAL.slateHi);
    // Recessed northern undercut cliff wall dropping into spring water
    drawEllipse(buf, ox + 32, oy + 33, 24, 16, BALKAN_PAL.slateDark);
    drawEllipse(buf, ox + 32, oy + 35, 23, 14, BALKAN_PAL.waterDeep);
    drawEllipse(buf, ox + 32, oy + 36, 19, 11, BALKAN_PAL.skyWater);
    drawEllipse(buf, ox + 28, oy + 33, 9, 4, BALKAN_PAL.waterFoam);
    drawCrossStitch(buf, ox + 11, oy + 20, BALKAN_PAL.rosePale, BALKAN_PAL.periwinkle, 2);
    drawCrossStitch(buf, ox + 50, oy + 44, BALKAN_PAL.mintGlow, BALKAN_PAL.jade, 2);
  }
  // 2x2 Rhodope Rosette Plinth (col 4..5, row 10..11) in 3/4 oblique view
  {
    const ox = 4 * BALKAN_TILE_DIM;
    const oy = 10 * BALKAN_TILE_DIM;
    drawEllipse(buf, ox + 32, oy + 36, 28, 20, BALKAN_PAL.cobbleDark);
    drawEllipse(buf, ox + 32, oy + 32, 28, 20, BALKAN_PAL.linenMid);
    drawEllipse(buf, ox + 32, oy + 32, 22, 16, BALKAN_PAL.ochre);
    drawEllipse(buf, ox + 32, oy + 32, 15, 11, BALKAN_PAL.crimson);
    drawEllipse(buf, ox + 32, oy + 32, 8, 6, BALKAN_PAL.emerald);
    drawCrossStitch(buf, ox + 30, oy + 30, BALKAN_PAL.gold, BALKAN_PAL.linenHi, 2);
  }
  // 2x2 Dobrudzha Golden Wheat Patch (col 6..7, row 10..11) with 3/4 upright arched stalks
  {
    const ox = 6 * BALKAN_TILE_DIM;
    const oy = 10 * BALKAN_TILE_DIM;
    for (let y = 10; y < 58; y += 7) {
      for (let x = 5 + ((y % 14) === 0 ? 3 : 0); x < 59; x += 6) {
        setPx(buf, ox + x, oy + y + 3, BALKAN_PAL.woodDark);
        drawLine(buf, ox + x, oy + y + 2, ox + x + 1, oy + y - 4, BALKAN_PAL.ochreDark);
        fillRect(buf, ox + x, oy + y - 6, 3, 4, BALKAN_PAL.gold);
        setPx(buf, ox + x + 2, oy + y - 7, BALKAN_PAL.linenHi);
      }
    }
  }
}

function sampleMeadowPixel(x: number, y: number): Rgba {
  const h = hash2d(x, y, 11);
  const weave = ((x + y) & 1) === 0;
  let c = weave ? BALKAN_PAL.meadow : BALKAN_PAL.meadowDark;
  if (h > 0.78) c = BALKAN_PAL.meadowHi;
  if ((x % 8 === 2 || x % 8 === 5) && y % 8 === 3 && h > 0.45) {
    c = BALKAN_PAL.meadowHi;
  }
  return c;
}

function sampleCobblePixel(x: number, y: number): Rgba {
  const h = hash2d(x, y, 73);
  if (x % 8 === 0 || y % 8 === 0) return BALKAN_PAL.cobbleDark;
  if (h > 0.72) return BALKAN_PAL.cobbleHi;
  if (h < 0.24) return BALKAN_PAL.cobbleDark;
  return BALKAN_PAL.cobble;
}

function sampleDroughtPixel(x: number, y: number): Rgba {
  const h = hash2d(x, y, 49);
  if (h > 0.7) return BALKAN_PAL.dryEarthHi;
  if (h < 0.28) return BALKAN_PAL.dryEarthDark;
  return BALKAN_PAL.dryEarth;
}

function sampleWaterPixel(x: number, y: number): Rgba {
  const wave = (x + y * 2) % 8 === 0 || (x * 2 + y) % 11 === 0;
  return wave ? BALKAN_PAL.skyWater : BALKAN_PAL.waterDeep;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 0.0001) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

/**
 * Evaluates a smooth continuous bilinear scalar field across [0..1]x[0..1] whose boundary values
 * depend ONLY on the two vertices on that shared tile edge, ensuring zero seams between Wang tiles.
 */
function evalWangCornerScalar(
  u: number,
  v: number,
  nw: number,
  ne: number,
  se: number,
  sw: number,
): number {
  return (
    (1 - u) * (1 - v) * nw +
    u * (1 - v) * ne +
    u * v * se +
    (1 - u) * v * sw
  );
}

function paintWangSetsRows12To15(buf: PixelBuffer): void {
  // Row 12 (192..207): 4-Edge Wang Embroidered Khoro Cobble Road (N=1, E=2, S=4, W=8)
  for (let idx = 0; idx < 16; idx++) {
    const { x: ox, y: oy } = tileOrigin(idx, 12);
    const hasN = (idx & 1) !== 0;
    const hasE = (idx & 2) !== 0;
    const hasS = (idx & 4) !== 0;
    const hasW = (idx & 8) !== 0;

    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let d = Math.hypot(px - 16, py - 16);
        if (hasN) d = Math.min(d, distToSegment(px, py, 16, 16, 16, 0));
        if (hasE) d = Math.min(d, distToSegment(px, py, 16, 16, 32, 16));
        if (hasS) d = Math.min(d, distToSegment(px, py, 16, 16, 16, 32));
        if (hasW) d = Math.min(d, distToSegment(px, py, 16, 16, 0, 16));

        if (d <= 8.5) {
          setPx(buf, ox + x, oy + y, sampleCobblePixel(x, y));
        } else if (d <= 11.4) {
          if (d <= 9.4 || d >= 10.6) {
            setPx(buf, ox + x, oy + y, BALKAN_PAL.crimsonDark);
          } else {
            const stitchTick = Math.floor(px + py) & 3;
            setPx(
              buf,
              ox + x,
              oy + y,
              stitchTick === 0
                ? BALKAN_PAL.gold
                : stitchTick === 2
                  ? BALKAN_PAL.linenHi
                  : BALKAN_PAL.crimsonHi,
            );
          }
        } else {
          setPx(buf, ox + x, oy + y, sampleMeadowPixel(x, y));
        }
      }
    }
    if (idx === 15) {
      drawEllipse(buf, ox + 16, oy + 16, 6, 4, BALKAN_PAL.crimsonDark);
      drawCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.gold, BALKAN_PAL.crimsonHi, 2);
    }
  }

  // Row 13 (208..223): 4-Corner Wang Meadow <-> Drought Hollow (NW=1, NE=2, SE=4, SW=8)
  for (let idx = 0; idx < 16; idx++) {
    const { x: ox, y: oy } = tileOrigin(idx, 13);
    const nw = (idx & 1) !== 0 ? 1 : 0;
    const ne = (idx & 2) !== 0 ? 1 : 0;
    const se = (idx & 4) !== 0 ? 1 : 0;
    const sw = (idx & 8) !== 0 ? 1 : 0;

    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const u = (x + 0.5) / 32;
        const v = (y + 0.5) / 32;
        const f = evalWangCornerScalar(u, v, nw, ne, se, sw);
        if (f >= 0.54) {
          setPx(buf, ox + x, oy + y, sampleDroughtPixel(x, y));
        } else if (f >= 0.43) {
          const edgeH = hash2d(x, y, 59);
          setPx(
            buf,
            ox + x,
            oy + y,
            edgeH > 0.55 ? BALKAN_PAL.ochreDark : BALKAN_PAL.dryEarthDark,
          );
        } else {
          setPx(buf, ox + x, oy + y, sampleMeadowPixel(x, y));
        }
      }
    }
    if (idx === 15) {
      drawLine(buf, ox + 6, oy + 10, ox + 14, oy + 15, BALKAN_PAL.dryEarthDark);
      drawLine(buf, ox + 14, oy + 15, ox + 19, oy + 24, BALKAN_PAL.dryEarthDark);
    }
  }

  // Row 14 (224..239): 4-Corner Wang Meadow <-> 3/4 Oblique Samodiva Brook (NW=1, NE=2, SE=4, SW=8)
  for (let idx = 0; idx < 16; idx++) {
    const { x: ox, y: oy } = tileOrigin(idx, 14);
    const nw = (idx & 1) !== 0 ? 1 : 0;
    const ne = (idx & 2) !== 0 ? 1 : 0;
    const se = (idx & 4) !== 0 ? 1 : 0;
    const sw = (idx & 8) !== 0 ? 1 : 0;

    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const u = (x + 0.5) / 32;
        const v = (y + 0.5) / 32;
        const f = evalWangCornerScalar(u, v, nw, ne, se, sw);
        const fNorth = evalWangCornerScalar(u, v - 0.14, nw, ne, se, sw);
        if (f >= 0.50) {
          // Visible 3/4 oblique southern-facing sunken mossy/stone bank cliff along northern shorelines
          if ((nw === 0 || ne === 0) && fNorth < 0.48) {
            setPx(buf, ox + x, oy + y, fNorth < 0.40 ? BALKAN_PAL.slateDark : BALKAN_PAL.woodDark);
          } else {
            const c = sampleWaterPixel(x, y);
            setPx(
              buf,
              ox + x,
              oy + y,
              f < 0.56 && (x + y) % 5 === 0 ? BALKAN_PAL.waterFoam : c,
            );
          }
        } else if (f >= 0.41) {
          setPx(buf, ox + x, oy + y, ((x + y) & 2) === 0 ? BALKAN_PAL.cobbleHi : BALKAN_PAL.meadowDark);
        } else {
          setPx(buf, ox + x, oy + y, sampleMeadowPixel(x, y));
        }
      }
    }
  }

  // Row 15 (240..255): 4-Edge Wang 3/4 Carved Stone & Terracotta Village Wall (N=1, E=2, S=4, W=8)
  for (let idx = 0; idx < 16; idx++) {
    const { x: ox, y: oy } = tileOrigin(idx, 15);
    const hasN = (idx & 1) !== 0;
    const hasE = (idx & 2) !== 0;
    const hasS = (idx & 4) !== 0;
    const hasW = (idx & 8) !== 0;

    // 1. Ground shadow underneath horizontal spans & hub
    fillRect(buf, ox + (hasW ? 0 : 9), oy + 24, (hasW ? 16 : 7) + (hasE ? 16 : 7), 4, BALKAN_PAL.slateDark);
    if (hasS) {
      fillRect(buf, ox + 10, oy + 20, 12, 12, BALKAN_PAL.cobbleDark);
    }

    // 2. Vertical 3/4 stone masonry wall front on hub + W/E spans (y = 14..25)
    const wallLeft = hasW ? 0 : 10;
    const wallRight = hasE ? 32 : 22;
    fillRect(buf, ox + wallLeft, oy + 14, wallRight - wallLeft, 11, BALKAN_PAL.cobble);
    for (let sx = wallLeft; sx < wallRight; sx += 6) {
      drawLine(buf, ox + sx, oy + 14, ox + sx, oy + 24, BALKAN_PAL.cobbleDark);
    }
    drawLine(buf, ox + wallLeft, oy + 19, ox + wallRight - 1, oy + 19, BALKAN_PAL.cobbleDark);

    // 3. North / South wall spine masonry side cheeks + top terracotta ridge
    if (hasN) {
      fillRect(buf, ox + 10, oy, 12, 16, BALKAN_PAL.cobbleDark);
      fillRect(buf, ox + 11, oy, 10, 15, BALKAN_PAL.terracotta);
      fillRect(buf, ox + 13, oy, 6, 15, BALKAN_PAL.terracottaHi);
    }
    if (hasS) {
      fillRect(buf, ox + 10, oy + 15, 12, 17, BALKAN_PAL.cobbleDark);
      fillRect(buf, ox + 11, oy + 15, 10, 17, BALKAN_PAL.terracotta);
      fillRect(buf, ox + 13, oy + 15, 6, 17, BALKAN_PAL.terracottaHi);
    }

    // 4. Top-lit 3/4 terracotta shingled cap along horizontal spans + stone post finial
    fillRect(buf, ox + wallLeft, oy + 7, wallRight - wallLeft, 8, BALKAN_PAL.terracottaDark);
    fillRect(buf, ox + wallLeft, oy + 8, wallRight - wallLeft, 5, BALKAN_PAL.terracotta);
    fillRect(buf, ox + wallLeft, oy + 8, wallRight - wallLeft, 2, BALKAN_PAL.terracottaHi);
    for (let tx = wallLeft + 2; tx < wallRight - 1; tx += 4) {
      setPx(buf, ox + tx, oy + 11, BALKAN_PAL.terracottaDark);
    }

    // Embroidered crimson key-tile center ornament at posts/corners
    if (idx === 0 || (!hasE && !hasW) || (!hasN && !hasS)) {
      fillRect(buf, ox + 13, oy + 9, 6, 4, BALKAN_PAL.crimson);
      setPx(buf, ox + 15, oy + 10, BALKAN_PAL.gold);
      setPx(buf, ox + 16, oy + 10, BALKAN_PAL.gold);
    }
  }
}

export function renderBalkanTilesetPixels(): PixelBuffer {
  const buf = createPixelBuffer(BALKAN_TILESET_WIDTH, BALKAN_TILESET_HEIGHT);

  // Row 0: Ground Terrains & Paths
  paintMeadowTile(buf, 0, 0, 'plain');
  paintMeadowTile(buf, 1, 0, 'flower');
  paintMeadowTile(buf, 2, 0, 'clover');
  paintDroughtTile(buf, 3, 0, false);
  paintDroughtTile(buf, 4, 0, true);
  paintKhoroRoadTile(buf, 5, 0, 'h');
  paintKhoroRoadTile(buf, 6, 0, 'v');
  paintKhoroRoadTile(buf, 7, 0, 'cross');
  paintWaterTile(buf, 8, 0, 'brook');
  paintWaterTile(buf, 9, 0, 'shimmer');
  paintWaterTile(buf, 10, 0, 'silt');
  paintBridgeTile(buf, 11, 0, false);
  paintBridgeTile(buf, 12, 0, true);
  paintKhoroRoadTile(buf, 13, 0, 'stone');
  paintKilimBorderTile(buf, 14, 0, false);
  paintKilimBorderTile(buf, 15, 0, true);

  // Row 1: Brook Banks & Small Props
  paintBrookBanksRow1(buf);

  // Rows 2..4: Folklore Motifs & Centerpiece Cursed Well
  paintElbetitsaPlaza(buf);
  paintTreeOfLifeCarpet(buf);
  paintSamodivaGlade(buf);
  paintKukeriHearth(buf);
  paintLamiaWell(buf);

  // Rows 5..7: Revival Architecture & Sacred Trees/Offerings
  paintRevivalCottage(buf, 4, 5, {
    roofMain: BALKAN_PAL.terracotta,
    roofHi: BALKAN_PAL.terracottaHi,
    wallMain: BALKAN_PAL.linenHi,
    wallLower: BALKAN_PAL.cobbleDark,
    accent: BALKAN_PAL.crimson,
    detail: 'peppers',
  });
  paintRevivalCottage(buf, 7, 5, {
    roofMain: BALKAN_PAL.slate,
    roofHi: BALKAN_PAL.slateHi,
    wallMain: BALKAN_PAL.linenMid,
    wallLower: BALKAN_PAL.woodDark,
    accent: BALKAN_PAL.emerald,
    detail: 'herbs',
  });
  paintRevivalCottage(buf, 10, 5, {
    roofMain: BALKAN_PAL.woodDark,
    roofHi: BALKAN_PAL.terracotta,
    wallMain: BALKAN_PAL.linenHi,
    wallLower: BALKAN_PAL.slateDark,
    accent: BALKAN_PAL.crimsonHi,
    detail: 'forge',
  });

  paintTreesAndFolkloreProps(buf);
  paintRow10Extras(buf);
  paintWangSetsRows12To15(buf);

  return buf;
}
