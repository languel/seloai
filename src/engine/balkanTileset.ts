import {
  BALKAN_PAL,
  createPixelBuffer,
  drawBackstitchLine,
  drawCellCrossStitch,
  drawCrossStitch,
  getStitchDelta,
  hash2d,
  mixRgba,
  setPx,
  setStitchPixel,
  shiftRgba,
} from './balkanPixelCore.ts';
import type { PixelBuffer, Rgba, StitchMode } from './balkanPixelCore.ts';
import type { WangColoredTileDef } from './wangTiling.ts';

export const BALKAN_TILESET_COLS = 16;
export const BALKAN_TILESET_ROWS = 16;
export const BALKAN_TILE_DIM = 32;
export const BALKAN_TILESET_WIDTH = BALKAN_TILESET_COLS * BALKAN_TILE_DIM;
export const BALKAN_TILESET_HEIGHT = BALKAN_TILESET_ROWS * BALKAN_TILE_DIM;

export const tileIdx = (col: number, row: number): number => row * BALKAN_TILESET_COLS + col;

/**
 * Named symbolic tile indices into `/assets/balkan-myth-tileset.png` (16x16 @ 32px).
 * Original ground/stamp/Wang coordinates are preserved while unused slots hold the
 * 32-tile Edge-Colored Wang Meadow ensemble and non-repeating interior runner variants.
 */
export const BALKAN_TILES = {
  // Row 0: Solid Embroidered Terrains & Kilim Paths
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

  // Row 1: Brook Banks, Wattle Fences & Village Props
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

  // Multi-tile region anchors (use with stamp helpers)
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

  // Free block Rows 6..7 cols 0..3: Interior non-repeating stitch variants
  BROOK_INT_ALT2: tileIdx(0, 6),
  BROOK_INT_ALT3: tileIdx(1, 6),
  DROUGHT_INT_ALT1: tileIdx(2, 6),
  DROUGHT_INT_ALT2: tileIdx(3, 6),
  DROUGHT_INT_ALT3: tileIdx(0, 7),
  PLAZA_STONE_ALT1: tileIdx(1, 7),
  PLAZA_STONE_ALT2: tileIdx(2, 7),
  PLAZA_STONE_ALT3: tileIdx(3, 7),

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

  // Row 9 cols 1..7: Non-repeating Kilim Road & Bargello Water variants
  ROAD_H_ALT1: tileIdx(1, 9),
  ROAD_H_ALT2: tileIdx(2, 9),
  ROAD_H_ALT3: tileIdx(3, 9),
  ROAD_V_ALT1: tileIdx(4, 9),
  ROAD_V_ALT2: tileIdx(5, 9),
  ROAD_V_ALT3: tileIdx(6, 9),
  BROOK_INT_ALT1: tileIdx(7, 9),

  // Rows 8..9 cols 8..15: Edge-Colored Wang Meadow Set A (16 tiles, masks 0..15)
  WANG_MEADOW_A_BASE: tileIdx(8, 8),

  // Rows 10..11 col 0 & col 3: Additional non-repeating quilt/runner variants
  ROAD_H_ALT4: tileIdx(0, 10),
  ROAD_V_ALT4: tileIdx(3, 10),
  PLAZA_STONE_ALT4: tileIdx(0, 11),
  DROUGHT_INT_ALT4: tileIdx(3, 11),

  // Rows 10..11 Multi-tile accents
  SPRING_POOL_ORIGIN: { col: 1, row: 10, w: 2, h: 2 },
  RHODOPE_ROSETTE_ORIGIN: { col: 4, row: 10, w: 2, h: 2 },
  GOLDEN_WHEAT_ORIGIN: { col: 6, row: 10, w: 2, h: 2 },

  // Rows 10..11 cols 8..15: Edge-Colored Wang Meadow Set B (16 tiles, masks 0..15)
  WANG_MEADOW_B_BASE: tileIdx(8, 10),

  // Rows 12..15: Complete 16-tile Wang Sets (indices base + 0..15)
  WANG_ROAD_BASE: tileIdx(0, 12), // 192..207 (4-edge N=1,E=2,S=4,W=8)
  WANG_DROUGHT_BASE: tileIdx(0, 13), // 208..223 (4-corner NW=1,NE=2,SE=4,SW=8)
  WANG_BROOK_BASE: tileIdx(0, 14), // 224..239 (4-corner NW=1,NE=2,SE=4,SW=8)
  WANG_WALL_BASE: tileIdx(0, 15), // 240..255 (4-edge N=1,E=2,S=4,W=8)
} as const;

export const BALKAN_ROAD_H_VARIANTS = [
  BALKAN_TILES.ROAD_KHORO_H,
  BALKAN_TILES.ROAD_H_ALT1,
  BALKAN_TILES.ROAD_H_ALT2,
  BALKAN_TILES.ROAD_H_ALT3,
  BALKAN_TILES.ROAD_H_ALT4,
] as const;

export const BALKAN_ROAD_V_VARIANTS = [
  BALKAN_TILES.ROAD_KHORO_V,
  BALKAN_TILES.ROAD_V_ALT1,
  BALKAN_TILES.ROAD_V_ALT2,
  BALKAN_TILES.ROAD_V_ALT3,
  BALKAN_TILES.ROAD_V_ALT4,
] as const;

export const BALKAN_BROOK_VARIANTS = [
  BALKAN_TILES.WATER_BROOK,
  BALKAN_TILES.WATER_SHIMMER,
  BALKAN_TILES.WATER_SILT,
  BALKAN_TILES.BROOK_INT_ALT1,
  BALKAN_TILES.BROOK_INT_ALT2,
  BALKAN_TILES.BROOK_INT_ALT3,
] as const;

export const BALKAN_DROUGHT_VARIANTS = [
  BALKAN_TILES.DROUGHT_CLAY,
  BALKAN_TILES.SCORCHED_COBBLE,
  BALKAN_TILES.DROUGHT_INT_ALT1,
  BALKAN_TILES.DROUGHT_INT_ALT2,
  BALKAN_TILES.DROUGHT_INT_ALT3,
  BALKAN_TILES.DROUGHT_INT_ALT4,
] as const;

export const BALKAN_PLAZA_VARIANTS = [
  BALKAN_TILES.PLAZA_LINEN_STONE,
  BALKAN_TILES.PLAZA_STONE_ALT1,
  BALKAN_TILES.PLAZA_STONE_ALT2,
  BALKAN_TILES.PLAZA_STONE_ALT3,
  BALKAN_TILES.PLAZA_STONE_ALT4,
] as const;

function wangMeadowTileId(set: 'A' | 'B', mask: number): number {
  const rowBase = set === 'A' ? 8 : 10;
  return tileIdx(8 + (mask & 7), rowBase + (mask >> 3));
}

/**
 * 32 Edge-Colored Wang Tiles (`Set A` + `Set B`, 2 distinct tiles for every `(N,E,S,W) in {0,1}^4`)
 * encoding seamless meadow cross-stitch seams:
 * - Edge color `0`: Continuous sage wool cross-stitch border
 * - Edge color `1`: Embroidered botanical vine & blossom trail crossing midpoint `[8..23]`
 */
export const BALKAN_WANG_MEADOW_TILES: readonly WangColoredTileDef[] = (['A', 'B'] as const).flatMap(
  (set) =>
    Array.from({ length: 16 }, (_, mask) => ({
      tileId: wangMeadowTileId(set, mask),
      north: mask & 1 ? 1 : 0,
      east: mask & 2 ? 1 : 0,
      south: mask & 4 ? 1 : 0,
      west: mask & 8 ? 1 : 0,
      weight: mask === 0 ? 1.15 : 1,
    })),
);

function tileOrigin(col: number, row: number): { ox: number; oy: number } {
  return { ox: col * BALKAN_TILE_DIM, oy: row * BALKAN_TILE_DIM };
}

function tileOriginFromIdx(idx: number): { ox: number; oy: number } {
  return tileOrigin(idx % BALKAN_TILESET_COLS, Math.floor(idx / BALKAN_TILESET_COLS));
}

// =============================================================================
// Shared Textile Palettes (warm spun-wool tones for cohesive needlework feel)
// =============================================================================

const TEX = {
  sageBase: mixRgba(BALKAN_PAL.meadow, BALKAN_PAL.linenShade, 0.16),
  sageDeep: mixRgba(BALKAN_PAL.meadowDark, BALKAN_PAL.emeraldDark, 0.22),
  sageSoft: mixRgba(BALKAN_PAL.meadowHi, BALKAN_PAL.linenMid, 0.22),
  sageClover: mixRgba(BALKAN_PAL.meadowHi, BALKAN_PAL.emerald, 0.34),
  linenPath: mixRgba(BALKAN_PAL.linenMid, BALKAN_PAL.dryEarthHi, 0.22),
  linenPathHi: mixRgba(BALKAN_PAL.linenHi, BALKAN_PAL.linenMid, 0.28),
  linenPathDark: mixRgba(BALKAN_PAL.linenShade, BALKAN_PAL.cobbleDark, 0.2),
  droughtWool: mixRgba(BALKAN_PAL.dryEarth, BALKAN_PAL.terracotta, 0.14),
  droughtSoft: mixRgba(BALKAN_PAL.dryEarthHi, BALKAN_PAL.linenShade, 0.24),
  droughtSeam: mixRgba(BALKAN_PAL.dryEarthDark, BALKAN_PAL.woodDark, 0.42),
  brookDeep: BALKAN_PAL.waterDeep,
  brookMid: BALKAN_PAL.skyWater,
  brookHi: mixRgba(BALKAN_PAL.periwinkle, BALKAN_PAL.waterFoam, 0.35),
  plazaLinen: mixRgba(BALKAN_PAL.cobbleHi, BALKAN_PAL.linenMid, 0.55),
  plazaEdge: mixRgba(BALKAN_PAL.cobbleDark, BALKAN_PAL.indigoDark, 0.22),
} as const;

// =============================================================================
// Needlework Terrain Samplers (phase-locked woven texture across every seam)
// =============================================================================

/** Soft tactile wool weave for meadows: subtle Gobelin + linen grain without harsh dot grids. */
function getMeadowYarnDelta(x: number, y: number): number {
  const sx = x & 3;
  const sy = y & 3;
  const diag = (x + y) & 3;
  // Blend diagonal wool yarn twist with gentle cross-stitch relief
  if (sx === sy) return sx === 1 || sx === 2 ? 8 : 5;
  if (diag === 2) return -8;
  return sx === 0 && sy === 0 ? -9 : -2;
}

/**
 * Pure phase-locked sage wool substrate shared across all Wang edges (`Edge Color 0`)
 * and roadside/waterside grass aprons. Global seam coordinates ensure seamless joins.
 */
function sampleBaseMeadowStitch(px: number, py: number): Rgba {
  const cx = (px >> 2) & 7;
  const cy = (py >> 2) & 7;
  const onCollar = cx === 0 || cx === 7 || cy === 0 || cy === 7;
  let wool = TEX.sageBase;
  if (!onCollar) {
    const h = hash2d(cx * 3 + cy, cy * 5 - cx, 101);
    if (h < 0.24) wool = shiftRgba(TEX.sageBase, -5);
    else if (h > 0.78) wool = TEX.sageSoft;
  } else {
    const edgeRipple = ((cx + cy) & 1) === 0 ? 0 : -3;
    wool = shiftRgba(TEX.sageBase, edgeRipple);
  }
  return shiftRgba(wool, getMeadowYarnDelta(px, py));
}

/** Smooth Bargello flame-stitch silk wave water (period 16 tiles seamlessly across 32px edges). */
function sampleBargelloWater(px: number, py: number): Rgba {
  const wave = Math.round(Math.sin(((px & 15) / 16) * Math.PI * 2) * 2.2);
  const band = (py + wave) & 15;
  let base: Rgba = TEX.brookMid;
  if (band < 4) base = TEX.brookDeep;
  else if (band < 7) base = BALKAN_PAL.skyWater;
  else if (band < 9) base = TEX.brookHi;
  else if (band < 11) base = BALKAN_PAL.waterFoam;
  else if (band < 14) base = BALKAN_PAL.skyWater;
  else base = TEX.brookDeep;
  return shiftRgba(base, getStitchDelta(px, py, band >= 8 && band <= 10 ? 'satin' : 'tent'));
}

/** Calm parched hemp & terracotta linen weave for the Drought region (zero grid framing). */
function sampleDroughtWool(px: number, py: number): Rgba {
  const delta = Math.round(getStitchDelta(px, py, 'twill-h') * 0.6);
  const grain = (px & 3) === 0 && (py & 3) === 0 ? -4 : 0;
  return shiftRgba(TEX.droughtWool, delta + grain);
}

/**
 * Embroidered Khoro Kilim runner pixel sampler:
 * warm unbleached Aida center flanked by madder-crimson & Danube-indigo stitched selvedge.
 */
function sampleKilimRoadPixel(
  px: number,
  py: number,
  distFromCenter: number,
  orientation: 'h' | 'v' | 'hub',
): Rgba {
  if (distFromCenter > 9.5) return sampleBaseMeadowStitch(px, py);
  const stitchPos = orientation === 'v' ? py : px;
  const mode: StitchMode = orientation === 'v' ? 'twill-v' : 'twill-h';

  // Soft chestnut wool blanket-stitch against meadow
  if (distFromCenter > 8.6) {
    return shiftRgba(BALKAN_PAL.woodDark, (stitchPos & 3) === 0 ? -10 : 5);
  }
  // Embroidered crimson & gold sawtooth selvedge
  if (distFromCenter > 6.6) {
    const saw = (stitchPos >> 1) & 1;
    const thread =
      distFromCenter > 7.7
        ? saw === 0
          ? BALKAN_PAL.crimson
          : BALKAN_PAL.indigo
        : saw === 0
          ? BALKAN_PAL.ochre
          : BALKAN_PAL.crimsonDark;
    return shiftRgba(thread, getStitchDelta(px, py, 'cross-fine'));
  }
  // Thin inner indigo/ochre runner pinstripe
  if (distFromCenter > 5.7) {
    return shiftRgba(BALKAN_PAL.indigo, getStitchDelta(px, py, mode));
  }
  // Warm woven linen center
  return shiftRgba(TEX.linenPath, Math.round(getStitchDelta(px, py, mode) * 0.75));
}

function fillMeadowTileBase(buf: PixelBuffer, col: number, row: number): { ox: number; oy: number } {
  const { ox, oy } = tileOrigin(col, row);
  for (let y = 0; y < BALKAN_TILE_DIM; y++) {
    for (let x = 0; x < BALKAN_TILE_DIM; x++) {
      setPx(buf, ox + x, oy + y, sampleBaseMeadowStitch(x, y));
    }
  }
  return { ox, oy };
}

/** Paint a 4x4 floral or leaf cross-stitch cluster strictly inside the inner cells [1..6]. */
function stitchBlossomAtCell(
  buf: PixelBuffer,
  ox: number,
  oy: number,
  cellX: number,
  cellY: number,
  petalColor: Rgba,
  leafColor: Rgba = BALKAN_PAL.emerald,
): void {
  const px = ox + cellX * 4;
  const py = oy + cellY * 4;
  drawCellCrossStitch(buf, px, py, petalColor);
  if (cellX + 1 <= 6) {
    drawCellCrossStitch(buf, px + 4, py, leafColor);
  }
}

/**
 * Evaluate smooth organic clover-drift weight `[0..1]` inside a 32x32 Wang meadow tile
 * so active edges (`edge === 1`) swell cleanly through seam midpoints `[7..24]` without
 * ever reaching corners (`[0..5]` / `[26..31]`) and join across curved interior paths.
 */
function sampleCloverDriftWeight(
  x: number,
  y: number,
  n: boolean,
  e: boolean,
  s: boolean,
  w: boolean,
  set: 'A' | 'B',
): number {
  const edgeSpan = (u: number, d: number): number => {
    const du = Math.abs(u - 15.5) / 9.5;
    if (du >= 1 || d >= 14) return 0;
    const t = Math.cos(du * Math.PI * 0.5);
    const falloff = Math.cos((d / 14) * Math.PI * 0.5);
    return t * t * falloff;
  };

  let weight = 0;
  if (n) weight = Math.max(weight, edgeSpan(x, y));
  if (e) weight = Math.max(weight, edgeSpan(y, 31 - x));
  if (s) weight = Math.max(weight, edgeSpan(x, 31 - y));
  if (w) weight = Math.max(weight, edgeSpan(y, x));

  // Connect active edges gently along curved diagonal tapestry swaths inside [4..27]
  const activePts: Array<[number, number]> = [];
  if (n) activePts.push([15.5, 2]);
  if (e) activePts.push([29, 15.5]);
  if (s) activePts.push([15.5, 29]);
  if (w) activePts.push([2, 15.5]);

  if (activePts.length > 0) {
    const cx = set === 'A' ? 18.5 : 12.5;
    const cy = set === 'A' ? 13.0 : 18.0;
    // Soft sinusoidal interior wobble fading to zero on all outer tile edges
    const fade =
      Math.sin((x / 31) * Math.PI) * Math.sin((y / 31) * Math.PI);
    const wave =
      fade * (0.14 * Math.sin(x * 0.28 + y * 0.22 + (set === 'A' ? 0.5 : 2.1)));

    for (const [ax, ay] of activePts) {
      const vx = cx - ax;
      const vy = cy - ay;
      const lenSq = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / lenSq));
      // Quadratic bow perpendicular to segment so stripes never look straight or orthogonal!
      const px = ax + vx * t + (set === 'A' ? vy : -vy) * Math.sin(t * Math.PI) * 0.24;
      const py = ay + vy * t + (set === 'A' ? -vx : vx) * Math.sin(t * Math.PI) * 0.24;
      const dist = Math.hypot(x - px, y - py);
      const ribbon = Math.max(0, 1 - dist / 8.5) + wave;
      if (ribbon > weight) weight = ribbon;
    }
  }

  return Math.max(0, Math.min(1, weight));
}

// =============================================================================
// 1. Edge-Colored Wang Meadow Set A (cols 8..15, rows 8..9) & Set B (rows 10..11)
// =============================================================================

function paintWangMeadowSets(buf: PixelBuffer): void {
  const blossomPalA: readonly Rgba[] = [
    BALKAN_PAL.periwinkle,
    BALKAN_PAL.gold,
    BALKAN_PAL.rosePale,
    BALKAN_PAL.linenHi,
  ];
  const blossomPalB: readonly Rgba[] = [
    BALKAN_PAL.rose,
    BALKAN_PAL.ochre,
    BALKAN_PAL.crimson,
    BALKAN_PAL.mintGlow,
  ];

  for (const set of ['A', 'B'] as const) {
    const pal = set === 'A' ? blossomPalA : blossomPalB;
    for (let mask = 0; mask < 16; mask++) {
      const id = wangMeadowTileId(set, mask);
      const { ox, oy } = tileOriginFromIdx(id);

      const n = (mask & 1) !== 0;
      const e = (mask & 2) !== 0;
      const s = (mask & 4) !== 0;
      const w = (mask & 8) !== 0;

      for (let y = 0; y < BALKAN_TILE_DIM; y++) {
        for (let x = 0; x < BALKAN_TILE_DIM; x++) {
          let base = sampleBaseMeadowStitch(x, y);
          const drift = sampleCloverDriftWeight(x, y, n, e, s, w, set);

          // Organic clover-moss Gobelin wool patch sweeping across Edge-1 boundaries
          if (drift > 0.36) {
            const wool = drift > 0.68 ? TEX.sageClover : mixRgba(TEX.sageBase, TEX.sageClover, 0.55);
            base = shiftRgba(wool, getStitchDelta(x, y, 'tent') >> 1);
          } else {
            // Smooth radial wool modulation inside center so zero square seam boxes appear
            const radialFade = Math.max(0, 1 - Math.hypot(x - 15.5, y - 15.5) / 14);
            if (radialFade > 0.15) {
              const patchHash = hash2d(x >> 2, y >> 2, (set === 'A' ? 31 : 97) + mask * 13);
              if (set === 'B' && patchHash > 0.72) {
                const warmDry = mixRgba(TEX.sageBase, BALKAN_PAL.dryEarthHi, 0.16 * radialFade);
                base = shiftRgba(warmDry, getMeadowYarnDelta(x, y));
              } else if (set === 'A' && patchHash < 0.25) {
                const deepMoss = mixRgba(TEX.sageBase, BALKAN_PAL.emerald, 0.18 * radialFade);
                base = shiftRgba(deepMoss, getMeadowYarnDelta(x, y));
              }
            }
          }
          setPx(buf, ox + x, oy + y, base);
        }
      }

      // Delicate seam-aligned edge blossom stitch centered strictly on bit===1 edge midpoints
      if (n) drawCrossStitch(buf, ox + 15, oy + 2, BALKAN_PAL.jade, BALKAN_PAL.emeraldDark, 3);
      if (e) drawCrossStitch(buf, ox + 27, oy + 15, BALKAN_PAL.jade, BALKAN_PAL.emeraldDark, 3);
      if (s) drawCrossStitch(buf, ox + 15, oy + 27, BALKAN_PAL.jade, BALKAN_PAL.emeraldDark, 3);
      if (w) drawCrossStitch(buf, ox + 2, oy + 15, BALKAN_PAL.jade, BALKAN_PAL.emeraldDark, 3);

      // Gentle asymmetrical hand-stitched wildflowers & clover clusters in interior cells
      const fl1 = pal[mask % pal.length];
      const fl2 = pal[(mask + 2) % pal.length];
      const ax = ox + (set === 'A' ? 9 + (mask & 3) * 3 : 20 - (mask & 3) * 3);
      const ay = oy + (set === 'A' ? 18 - ((mask >> 2) & 3) * 2 : 9 + ((mask >> 2) & 3) * 3);
      drawCrossStitch(buf, ax, ay, fl1, shiftRgba(fl1, -30), 3);
      drawCrossStitch(buf, ax + 3, ay + 2, BALKAN_PAL.emerald, BALKAN_PAL.emeraldDark, 2);

      if (mask % 3 !== 0 || set === 'B') {
        const bx = ox + (set === 'A' ? 21 : 9);
        const by = oy + (set === 'A' ? 9 : 21);
        drawCrossStitch(buf, bx, by, fl2, shiftRgba(fl2, -26), 2);
      }
      if (mask === 0) {
        drawCrossStitch(
          buf,
          ox + (set === 'A' ? 14 : 18),
          oy + (set === 'A' ? 12 : 17),
          BALKAN_PAL.jade,
          BALKAN_PAL.emeraldDark,
          3,
        );
      }
    }
  }
}

// =============================================================================
// 2. Row 0 Core Terrains + Non-Repeating Runner/Brook/Drought/Plaza Variants
// =============================================================================

function paintKhoroMotifOnTile(
  buf: PixelBuffer,
  col: number,
  row: number,
  dir: 'h' | 'v' | 'hub',
  variant: number,
): void {
  const { ox, oy } = tileOrigin(col, row);
  for (let y = 0; y < BALKAN_TILE_DIM; y++) {
    for (let x = 0; x < BALKAN_TILE_DIM; x++) {
      let dist = Math.abs(y - 15.5);
      if (dir === 'v') dist = Math.abs(x - 15.5);
      else if (dir === 'hub') dist = Math.min(Math.abs(x - 15.5), Math.abs(y - 15.5));
      setPx(buf, ox + x, oy + y, sampleKilimRoadPixel(x, y, dist, dir === 'v' ? 'v' : 'h'));
    }
  }

  // Hand-stitched folk carpet runner motifs down the linen center (inset from 0/31 seams!)
  if (dir === 'hub') {
    // Festive 4-way Khoro star diamond in the road crossroads
    drawCellCrossStitch(buf, ox + 12, oy + 12, BALKAN_PAL.crimson);
    drawCellCrossStitch(buf, ox + 16, oy + 12, BALKAN_PAL.gold);
    drawCellCrossStitch(buf, ox + 12, oy + 16, BALKAN_PAL.gold);
    drawCellCrossStitch(buf, ox + 16, oy + 16, BALKAN_PAL.crimson);
    drawCrossStitch(buf, ox + 15, oy + 15, BALKAN_PAL.indigo, BALKAN_PAL.indigoDark, 2);
    return;
  }

  if (variant === 0) {
    // Soft twin madder & indigo diamond runner eyelets
    drawCrossStitch(buf, ox + 10, oy + 14, BALKAN_PAL.crimson, BALKAN_PAL.crimsonDark, 3);
    drawCrossStitch(buf, ox + 19, oy + 14, BALKAN_PAL.crimson, BALKAN_PAL.crimsonDark, 3);
    drawCrossStitch(buf, ox + 15, oy + 15, BALKAN_PAL.indigo, BALKAN_PAL.indigoDark, 2);
  } else if (variant === 1) {
    // Delicate Saffron & Indigo runner wave
    const p = (d: number) => (dir === 'h' ? [ox + 15 + d, oy + 15] : [ox + 15, oy + 15 + d]);
    for (const [d, col] of [
      [-6, BALKAN_PAL.indigo],
      [0, BALKAN_PAL.ochreDark],
      [6, BALKAN_PAL.indigo],
    ] as const) {
      const [px, py] = p(d);
      drawCrossStitch(buf, px, py, col, shiftRgba(col, -28), 2);
    }
  } else if (variant === 2) {
    // Kanatitsa small folk sprig rotated by runner axis
    const ax = dir === 'h' ? 10 : 15;
    const ay = dir === 'h' ? 15 : 10;
    const bx = dir === 'h' ? 20 : 15;
    const by = dir === 'h' ? 15 : 20;
    drawCrossStitch(buf, ox + ax, oy + ay, BALKAN_PAL.ochreDark, BALKAN_PAL.crimsonDark, 2);
    drawCrossStitch(buf, ox + bx, oy + by, BALKAN_PAL.ochreDark, BALKAN_PAL.crimsonDark, 2);
    drawCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.emerald, BALKAN_PAL.emeraldDark, 3);
  } else if (variant === 3) {
    // Warm herringbone wool tread (quiet spacing)
    for (const off of [-8, 0, 8]) {
      const px = dir === 'h' ? ox + 15 + off : ox + 15;
      const py = dir === 'h' ? oy + 15 : oy + 15 + off;
      setStitchPixel(buf, px, py, TEX.linenPathDark, 'satin');
      drawCrossStitch(buf, px - 1, py - 1, BALKAN_PAL.ochre, BALKAN_PAL.ochreDark, 2);
    }
  } else {
    // Plum rosebud & olive dot micro-motif
    drawCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.plum, BALKAN_PAL.crimsonDark, 3);
    if (dir === 'h') {
      drawCrossStitch(buf, ox + 9, oy + 15, BALKAN_PAL.emerald, BALKAN_PAL.emeraldDark, 2);
      drawCrossStitch(buf, ox + 21, oy + 15, BALKAN_PAL.emerald, BALKAN_PAL.emeraldDark, 2);
    } else {
      drawCrossStitch(buf, ox + 15, oy + 9, BALKAN_PAL.emerald, BALKAN_PAL.emeraldDark, 2);
      drawCrossStitch(buf, ox + 15, oy + 21, BALKAN_PAL.emerald, BALKAN_PAL.emeraldDark, 2);
    }
  }
}

function paintBrookInteriorTile(
  buf: PixelBuffer,
  col: number,
  row: number,
  variant: number,
): void {
  const { ox, oy } = tileOrigin(col, row);
  for (let y = 0; y < BALKAN_TILE_DIM; y++) {
    for (let x = 0; x < BALKAN_TILE_DIM; x++) {
      let c = sampleBargelloWater(x, y);
      if (variant === 2) {
        const r = Math.hypot(x - 15.5, y - 15.5);
        if (r < 13) {
          c = mixRgba(c, BALKAN_PAL.murkWater, 0.34 * (1 - r / 13));
        }
      }
      setPx(buf, ox + x, oy + y, c);
    }
  }

  // Interior embroidered river ornaments (kept inside [6..25] so Bargello water seams stay exact)
  if (variant === 1) {
    drawBackstitchLine(buf, ox + 8, oy + 12, ox + 16, oy + 10, BALKAN_PAL.waterFoam);
    drawBackstitchLine(buf, ox + 14, oy + 22, ox + 23, oy + 20, BALKAN_PAL.waterFoam);
  } else if (variant === 2) {
    drawCrossStitch(buf, ox + 11, oy + 14, BALKAN_PAL.emerald, BALKAN_PAL.emeraldDark, 3);
    drawCrossStitch(buf, ox + 18, oy + 17, BALKAN_PAL.jade, BALKAN_PAL.emerald, 2);
  } else if (variant === 3) {
    // Silver Bargello double sparkle crest
    drawCrossStitch(buf, ox + 10, oy + 10, BALKAN_PAL.silverHi, BALKAN_PAL.waterFoam, 3);
    drawCrossStitch(buf, ox + 20, oy + 20, BALKAN_PAL.silverHi, BALKAN_PAL.waterFoam, 3);
  } else if (variant === 4) {
    // Stitched lotus / lily-pad blossom
    drawCellCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.emerald);
    drawCrossStitch(buf, ox + 15, oy + 15, BALKAN_PAL.rosePale, BALKAN_PAL.rose, 2);
  } else if (variant === 5) {
    // Indigo swirl eye stitch
    drawBackstitchLine(buf, ox + 11, oy + 15, ox + 16, oy + 12, BALKAN_PAL.indigo);
    drawBackstitchLine(buf, ox + 16, oy + 12, ox + 20, oy + 16, BALKAN_PAL.waterFoam);
    drawCrossStitch(buf, ox + 14, oy + 16, BALKAN_PAL.periwinkle, BALKAN_PAL.indigoDark, 3);
  }
}

function paintDroughtInteriorTile(
  buf: PixelBuffer,
  col: number,
  row: number,
  variant: number,
): void {
  const { ox, oy } = tileOrigin(col, row);
  const softCrack = mixRgba(TEX.droughtWool, TEX.droughtSeam, 0.45);
  const warmHemp = mixRgba(TEX.droughtWool, BALKAN_PAL.terracotta, 0.12);

  for (let y = 0; y < BALKAN_TILE_DIM; y++) {
    for (let x = 0; x < BALKAN_TILE_DIM; x++) {
      let c = sampleDroughtWool(x, y);
      const centerWeight = Math.max(0, 1 - Math.hypot(x - 15.5, y - 15.5) / 14);
      if (centerWeight > 0.08) {
        const wave = 0.5 + 0.5 * Math.sin(x * 0.25 + variant * 1.9 + Math.cos(y * 0.22));
        const tint = wave > 0.5 ? warmHemp : TEX.droughtSoft;
        c = mixRgba(c, shiftRgba(tint, Math.round(getStitchDelta(x, y, 'tent') * 0.5)), 0.38 * centerWeight);
      }
      setPx(buf, ox + x, oy + y, c);
    }
  }

  // Soft understated embroidery crackle stitches & dry grass X-tufts (no heavy dark glyphs)
  if (variant === 0) {
    drawBackstitchLine(buf, ox + 7, oy + 12, ox + 17, oy + 15, softCrack);
    drawBackstitchLine(buf, ox + 17, oy + 15, ox + 24, oy + 13, softCrack);
  } else if (variant === 1) {
    drawCrossStitch(buf, ox + 11, oy + 10, BALKAN_PAL.ochreDark, softCrack, 2);
    drawCrossStitch(buf, ox + 20, oy + 20, BALKAN_PAL.ochre, softCrack, 3);
  } else if (variant === 2) {
    drawBackstitchLine(buf, ox + 9, oy + 18, ox + 21, oy + 14, BALKAN_PAL.terracotta);
    drawCrossStitch(buf, ox + 14, oy + 15, BALKAN_PAL.ochreDark, BALKAN_PAL.crimsonDark, 2);
  } else if (variant === 3) {
    drawCrossStitch(buf, ox + 15, oy + 10, BALKAN_PAL.ochre, BALKAN_PAL.ochreDark, 3);
    drawBackstitchLine(buf, ox + 10, oy + 22, ox + 21, oy + 21, softCrack);
  } else if (variant === 4) {
    drawCrossStitch(buf, ox + 10, oy + 19, BALKAN_PAL.dryEarthHi, BALKAN_PAL.ochreDark, 3);
    drawCrossStitch(buf, ox + 20, oy + 11, BALKAN_PAL.dryEarthDark, softCrack, 2);
  } else {
    drawCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.ochreDark, softCrack, 3);
    drawBackstitchLine(buf, ox + 13, oy + 22, ox + 22, oy + 24, softCrack);
  }
}

function paintPlazaQuiltTile(
  buf: PixelBuffer,
  col: number,
  row: number,
  variant: number,
): void {
  const { ox, oy } = tileOrigin(col, row);
  for (let y = 0; y < BALKAN_TILE_DIM; y++) {
    for (let x = 0; x < BALKAN_TILE_DIM; x++) {
      // Quilted 16x16 linen flagstone grid stitched with indigo-slate running thread
      const onGroovedEdge = x === 0 || y === 0 || x === 16 || y === 16;
      if (onGroovedEdge) {
        const dash = ((x + y) & 3) === 0 ? -12 : 4;
        setPx(buf, ox + x, oy + y, shiftRgba(TEX.plazaEdge, dash));
      } else {
        const blockAlt = ((x >> 4) ^ (y >> 4)) === 1 ? 5 : 0;
        const base = shiftRgba(TEX.plazaLinen, blockAlt);
        setPx(buf, ox + x, oy + y, shiftRgba(base, getStitchDelta(x, y, 'linen')));
      }
    }
  }

  // Distinct delicate embroidered corner knots for each Plaza flagstone variant
  if (variant === 1) {
    drawCrossStitch(buf, ox + 7, oy + 7, BALKAN_PAL.ochre, BALKAN_PAL.ochreDark, 3);
    drawCrossStitch(buf, ox + 22, oy + 22, BALKAN_PAL.ochre, BALKAN_PAL.ochreDark, 3);
  } else if (variant === 2) {
    drawCellCrossStitch(buf, ox + 20, oy + 8, BALKAN_PAL.crimson);
  } else if (variant === 3) {
    drawCellCrossStitch(buf, ox + 8, oy + 20, BALKAN_PAL.emerald);
    drawCrossStitch(buf, ox + 22, oy + 8, BALKAN_PAL.indigo, BALKAN_PAL.indigoDark, 2);
  } else if (variant === 4) {
    drawCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.indigo, BALKAN_PAL.indigoDark, 3);
  }
}

function paintBridgeTile(buf: PixelBuffer, col: number, row: number, horizontal: boolean): void {
  const { ox, oy } = tileOrigin(col, row);
  for (let y = 0; y < BALKAN_TILE_DIM; y++) {
    for (let x = 0; x < BALKAN_TILE_DIM; x++) {
      const across = horizontal ? y : x;
      const along = horizontal ? x : y;
      // Bargello water peeks beneath bridge edges (<3 or >28)
      if (across < 3 || across > 28) {
        setPx(buf, ox + x, oy + y, sampleBargelloWater(x, y));
        continue;
      }
      // Martenitsa crimson/ivory hand-tied rail cord along sides (across 3..5 and 26..28)
      if (across <= 5 || across >= 26) {
        if (across === 3 || across === 28) {
          setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
        } else {
          const cord = ((along >> 2) & 1) === 0 ? BALKAN_PAL.crimsonHi : BALKAN_PAL.linenHi;
          setPx(buf, ox + x, oy + y, shiftRgba(cord, getStitchDelta(x, y, 'cross-fine')));
        }
        continue;
      }
      // Stitched oak deck planks with backstitched plank seams
      const seam = along % 6 === 0;
      const woodColor = seam ? BALKAN_PAL.woodDark : (along % 12 < 6 ? BALKAN_PAL.wood : BALKAN_PAL.woodHi);
      const mode: StitchMode = horizontal ? 'twill-v' : 'twill-h';
      setPx(buf, ox + x, oy + y, shiftRgba(woodColor, getStitchDelta(x, y, mode)));
    }
  }
}

function paintKilimBorderTile(buf: PixelBuffer, col: number, row: number, horizontal: boolean): void {
  const { ox, oy } = tileOrigin(col, row);
  for (let y = 0; y < BALKAN_TILE_DIM; y++) {
    for (let x = 0; x < BALKAN_TILE_DIM; x++) {
      const a = horizontal ? y : x;
      const b = horizontal ? x : y;
      const mode: StitchMode = horizontal ? 'twill-h' : 'twill-v';
      if (a <= 2 || a >= 29) {
        setPx(buf, ox + x, oy + y, shiftRgba(BALKAN_PAL.inkSoft, getStitchDelta(x, y, mode)));
      } else if (a <= 7 || a >= 24) {
        const band = ((b >> 2) & 1) === 0 ? BALKAN_PAL.crimson : BALKAN_PAL.indigo;
        setPx(buf, ox + x, oy + y, shiftRgba(band, getStitchDelta(x, y, 'cross')));
      } else {
        // Woven diamond kilim spine
        const d = Math.abs((b % 12) - 6) + Math.abs(a - 15.5);
        const yarn =
          d < 4
            ? BALKAN_PAL.gold
            : d < 7
              ? BALKAN_PAL.linenHi
              : d < 9
                ? BALKAN_PAL.crimsonHi
                : BALKAN_PAL.indigoDark;
        setPx(buf, ox + x, oy + y, shiftRgba(yarn, getStitchDelta(x, y, 'cross')));
      }
    }
  }
}

function paintRow0Terrains(buf: PixelBuffer): void {
  // 0..2: Meadow base, Wildflower stitched cluster, Clover stitched cluster
  fillMeadowTileBase(buf, 0, 0);

  fillMeadowTileBase(buf, 1, 0);
  stitchBlossomAtCell(buf, 1 * 32, 0, 2, 2, BALKAN_PAL.periwinkle);
  stitchBlossomAtCell(buf, 1 * 32, 0, 4, 5, BALKAN_PAL.gold, BALKAN_PAL.jade);

  fillMeadowTileBase(buf, 2, 0);
  drawCellCrossStitch(buf, 2 * 32 + 12, 12, BALKAN_PAL.emerald);
  drawCellCrossStitch(buf, 2 * 32 + 16, 16, BALKAN_PAL.jade);
  drawCellCrossStitch(buf, 2 * 32 + 8, 20, BALKAN_PAL.emeraldDark);

  // 3..4: Drought clay & scorched cobble
  paintDroughtInteriorTile(buf, 3, 0, 0);
  paintDroughtInteriorTile(buf, 4, 0, 1);

  // 5..7: Khoro linen runner paths H, V, Cross
  paintKhoroMotifOnTile(buf, 5, 0, 'h', 0);
  paintKhoroMotifOnTile(buf, 6, 0, 'v', 0);
  paintKhoroMotifOnTile(buf, 7, 0, 'hub', 0);

  // 8..10: Bargello brook interiors
  paintBrookInteriorTile(buf, 8, 0, 0);
  paintBrookInteriorTile(buf, 9, 0, 1);
  paintBrookInteriorTile(buf, 10, 0, 2);

  // 11..12: Martenitsa oak bridges
  paintBridgeTile(buf, 11, 0, true);
  paintBridgeTile(buf, 12, 0, false);

  // 13: Plaza linen stone base
  paintPlazaQuiltTile(buf, 13, 0, 0);

  // 14..15: Kilim H & V tapestry frame borders
  paintKilimBorderTile(buf, 14, 0, true);
  paintKilimBorderTile(buf, 15, 0, false);
}

function paintVariantSlots(buf: PixelBuffer): void {
  // Khoro H runner variants (cols 1..3 row 9 + (0,10))
  paintKhoroMotifOnTile(buf, 1, 9, 'h', 1);
  paintKhoroMotifOnTile(buf, 2, 9, 'h', 2);
  paintKhoroMotifOnTile(buf, 3, 9, 'h', 3);
  paintKhoroMotifOnTile(buf, 0, 10, 'h', 4);

  // Khoro V runner variants (cols 4..6 row 9 + (3,10))
  paintKhoroMotifOnTile(buf, 4, 9, 'v', 1);
  paintKhoroMotifOnTile(buf, 5, 9, 'v', 2);
  paintKhoroMotifOnTile(buf, 6, 9, 'v', 3);
  paintKhoroMotifOnTile(buf, 3, 10, 'v', 4);

  // Brook interior Bargello variants ((7,9), (0,6), (1,6))
  paintBrookInteriorTile(buf, 7, 9, 3);
  paintBrookInteriorTile(buf, 0, 6, 4);
  paintBrookInteriorTile(buf, 1, 6, 5);

  // Drought interior embroidered earth variants ((2,6), (3,6), (0,7), (3,11))
  paintDroughtInteriorTile(buf, 2, 6, 2);
  paintDroughtInteriorTile(buf, 3, 6, 3);
  paintDroughtInteriorTile(buf, 0, 7, 4);
  paintDroughtInteriorTile(buf, 3, 11, 5);

  // Plaza quilt flagstone variants ((1,7), (2,7), (3,7), (0,11))
  paintPlazaQuiltTile(buf, 1, 7, 1);
  paintPlazaQuiltTile(buf, 2, 7, 2);
  paintPlazaQuiltTile(buf, 3, 7, 3);
  paintPlazaQuiltTile(buf, 0, 11, 4);
}

// =============================================================================
// 3. Row 1: Brook Banks, Stitched Fences & Folklore Props
// =============================================================================

function paintShoreBankTile(
  buf: PixelBuffer,
  col: number,
  row: number,
  landTop: boolean,
  landBottom: boolean,
  landLeft: boolean,
  landRight: boolean,
): void {
  const { ox, oy } = tileOrigin(col, row);
  for (let y = 0; y < BALKAN_TILE_DIM; y++) {
    for (let x = 0; x < BALKAN_TILE_DIM; x++) {
      let dLand = 99;
      if (landTop) dLand = Math.min(dLand, y);
      if (landBottom) dLand = Math.min(dLand, 31 - y);
      if (landLeft) dLand = Math.min(dLand, x);
      if (landRight) dLand = Math.min(dLand, 31 - x);
      const undulate = Math.round(Math.sin((x + y) * 0.35) * 1.1);
      const thr = dLand + undulate;
      if (thr < 6) {
        setPx(buf, ox + x, oy + y, sampleBaseMeadowStitch(x, y));
      } else if (thr < 8) {
        setPx(buf, ox + x, oy + y, shiftRgba(BALKAN_PAL.woodDark, getStitchDelta(x, y, 'cross-fine')));
      } else if (thr < 10) {
        setPx(buf, ox + x, oy + y, shiftRgba(BALKAN_PAL.waterFoam, getStitchDelta(x, y, 'satin')));
      } else {
        setPx(buf, ox + x, oy + y, sampleBargelloWater(x, y));
      }
    }
  }
}

function paintRow1BanksAndProps(buf: PixelBuffer): void {
  // 0..7: Blanket-stitched brook banks
  paintShoreBankTile(buf, 0, 1, true, false, false, false);
  paintShoreBankTile(buf, 1, 1, false, true, false, false);
  paintShoreBankTile(buf, 2, 1, false, false, true, false);
  paintShoreBankTile(buf, 3, 1, false, false, false, true);
  paintShoreBankTile(buf, 4, 1, true, false, true, false);
  paintShoreBankTile(buf, 5, 1, true, false, false, true);
  paintShoreBankTile(buf, 6, 1, false, true, true, false);
  paintShoreBankTile(buf, 7, 1, false, true, false, true);

  // 8: FENCE_WATTLE_H (transparent exterior + stitched hazel-rod hurdle)
  {
    const { ox, oy } = tileOrigin(8, 1);
    for (const postX of [4, 15, 26]) {
      for (let py = 6; py < 26; py++) {
        for (let px = postX - 1; px <= postX + 1; px++) {
          setStitchPixel(buf, ox + px, oy + py, BALKAN_PAL.woodDark, 'twill-v');
        }
      }
    }
    for (const railY of [11, 16, 21]) {
      for (let px = 0; px < 32; px++) {
        const alt = ((px >> 2) & 1) === 0 ? BALKAN_PAL.wood : BALKAN_PAL.woodHi;
        setStitchPixel(buf, ox + px, oy + railY, alt, 'twill-h');
        setPx(buf, ox + px, oy + railY - 1, BALKAN_PAL.inkSoft);
      }
    }
  }

  // 9: FENCE_WATTLE_V
  {
    const { ox, oy } = tileOrigin(9, 1);
    for (let py = 0; py < 32; py++) {
      for (let px = 12; px <= 19; px++) {
        const edge = px === 12 || px === 19;
        if (edge) {
          setPx(buf, ox + px, oy + py, BALKAN_PAL.inkSoft);
        } else {
          const wood = (py & 4) === 0 ? BALKAN_PAL.woodDark : BALKAN_PAL.wood;
          setStitchPixel(buf, ox + px, oy + py, wood, 'twill-v');
        }
      }
    }
    for (const knotY of [4, 15, 26]) {
      drawCrossStitch(buf, ox + 14, oy + knotY, BALKAN_PAL.crimson, BALKAN_PAL.crimsonDark, 3);
    }
  }

  // 10: CARDAK_RAIL (transparent exterior + carved oak veranda balustrade)
  {
    const { ox, oy } = tileOrigin(10, 1);
    drawBackstitchLine(buf, ox + 1, oy + 9, ox + 30, oy + 9, BALKAN_PAL.inkSoft);
    for (let px = 0; px < 32; px++) {
      setStitchPixel(buf, ox + px, oy + 10, BALKAN_PAL.woodHi, 'twill-h');
      setStitchPixel(buf, ox + px, oy + 11, BALKAN_PAL.wood, 'twill-h');
      setStitchPixel(buf, ox + px, oy + 23, BALKAN_PAL.woodDark, 'twill-h');
    }
    for (let bx = 3; bx < 30; bx += 5) {
      drawBackstitchLine(buf, ox + bx, oy + 12, ox + bx, oy + 22, BALKAN_PAL.wood);
      drawCrossStitch(buf, ox + bx - 1, oy + 16, BALKAN_PAL.crimson, BALKAN_PAL.gold, 2);
    }
  }

  // 11: GERANIUM_BOX (stitched terracotta planter with scarlet blossom X-stitches)
  {
    const { ox, oy } = tileOrigin(11, 1);
    for (let py = 17; py < 27; py++) {
      for (let px = 6; px < 26; px++) {
        const border = py === 17 || py === 26 || px === 6 || px === 25;
        setPx(buf, ox + px, oy + py, border ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.terracotta, getStitchDelta(px, py, 'twill-h')));
      }
    }
    for (let gx = 7; gx <= 21; gx += 4) {
      drawCellCrossStitch(buf, ox + gx, oy + 11, BALKAN_PAL.emerald);
      drawCrossStitch(buf, ox + gx + 1, oy + 8, BALKAN_PAL.crimsonHi, BALKAN_PAL.crimsonDark, 3);
    }
  }

  // 12: PEPPER_STRINGS (dried red paprika rista stitched on linen cord)
  {
    const { ox, oy } = tileOrigin(12, 1);
    drawBackstitchLine(buf, ox + 3, oy + 6, ox + 28, oy + 6, BALKAN_PAL.linenHi);
    for (const px of [7, 13, 19, 24]) {
      drawBackstitchLine(buf, ox + px, oy + 7, ox + px, oy + 10, BALKAN_PAL.emerald);
      drawCellCrossStitch(buf, ox + px - 2, oy + 10, BALKAN_PAL.crimson);
      drawCellCrossStitch(buf, ox + px - 2, oy + 14, BALKAN_PAL.crimsonHi);
      drawCrossStitch(buf, ox + px - 1, oy + 18, BALKAN_PAL.crimsonDark, BALKAN_PAL.inkSoft, 2);
    }
  }

  // 13: BRAZIER_POST (Embroidered wrought iron fire-basket with satin flame)
  {
    const { ox, oy } = tileOrigin(13, 1);
    for (let py = 15; py < 28; py++) {
      setPx(buf, ox + 15, oy + py, BALKAN_PAL.inkSoft);
      setPx(buf, ox + 16, oy + py, BALKAN_PAL.slateDark);
    }
    drawBackstitchLine(buf, ox + 11, oy + 27, ox + 20, oy + 27, BALKAN_PAL.inkSoft);
    for (let py = 10; py <= 15; py++) {
      for (let px = 11; px <= 20; px++) {
        setStitchPixel(buf, ox + px, oy + py, py === 15 ? BALKAN_PAL.inkSoft : BALKAN_PAL.slate, 'cross-fine');
      }
    }
    drawCellCrossStitch(buf, ox + 14, oy + 5, BALKAN_PAL.gold);
    drawCrossStitch(buf, ox + 15, oy + 7, BALKAN_PAL.crimsonHi, BALKAN_PAL.ochre, 3);
  }

  // 14: DRY_PITCHERS_SMALL (Embroidered twin clay amphorae on dry linen mat)
  {
    const { ox, oy } = tileOrigin(14, 1);
    for (const [cx, cy, w, h, colClay] of [
      [11, 18, 4, 6, BALKAN_PAL.terracotta],
      [21, 16, 5, 7, BALKAN_PAL.ochreDark],
    ] as const) {
      for (let dy = -h; dy <= h; dy++) {
        for (let dx = -w; dx <= w; dx++) {
          const rx = dx / w;
          const ry = dy / h;
          if (rx * rx + ry * ry <= 1) {
            setStitchPixel(buf, ox + cx + dx, oy + cy + dy, colClay, 'cross-fine');
          }
        }
      }
      drawBackstitchLine(buf, ox + cx - 2, oy + cy - h, ox + cx + 2, oy + cy - h, BALKAN_PAL.inkSoft);
      drawCrossStitch(buf, ox + cx - 1, oy + cy - 1, BALKAN_PAL.linenHi, BALKAN_PAL.crimson, 2);
    }
  }

  // 15: OBROK_CROSS (Votive stone cross embroidered in linen slate & draped red belt)
  {
    const { ox, oy } = tileOrigin(15, 1);
    for (let py = 6; py < 28; py++) {
      for (let px = 13; px <= 18; px++) {
        const edge = px === 13 || px === 18 || py === 6 || py === 27;
        setPx(buf, ox + px, oy + py, edge ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.cobble, getStitchDelta(px, py, 'cross')));
      }
    }
    for (let py = 10; py <= 15; py++) {
      for (let px = 8; px <= 23; px++) {
        const edge = px === 8 || px === 23 || py === 10 || py === 15;
        setPx(buf, ox + px, oy + py, edge ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.cobbleHi, getStitchDelta(px, py, 'cross')));
      }
    }
    // Red silk votive sash tied around cross waist
    drawBackstitchLine(buf, ox + 12, oy + 17, ox + 19, oy + 17, BALKAN_PAL.crimson);
    drawBackstitchLine(buf, ox + 12, oy + 18, ox + 19, oy + 18, BALKAN_PAL.crimsonHi);
    drawCrossStitch(buf, ox + 14, oy + 11, BALKAN_PAL.gold, BALKAN_PAL.ochreDark, 3);
  }
}

// =============================================================================
// 4. Landmark Folklore Medallions & Tapestry Stamps (Rows 2..5)
// =============================================================================

function paintElbetitsaPlaza(buf: PixelBuffer): void {
  const { ox, oy } = tileOrigin(0, 2); // 128x128 (4x4)
  const dim = 128;
  const center = 63.5;

  // Background quilted linen floor matching PLAZA_LINEN_STONE seams
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const lx = x % 32;
      const ly = y % 32;
      const onGrout = lx === 0 || ly === 0 || lx === 16 || ly === 16;
      const dx = Math.abs(x - center);
      const dy = Math.abs(y - center);
      const cheb = Math.max(dx, dy);
      const manh = dx + dy;

      if (manh <= 62 && cheb <= 50) {
        // Woven octagonal Kilim medallion inset cleanly into the stone plaza
        if (manh >= 58 || cheb >= 47) {
          setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
        } else if (manh >= 50 || cheb >= 41) {
          const saw = (((x + y) >> 2) & 1) === 0 ? BALKAN_PAL.crimson : BALKAN_PAL.indigo;
          setStitchPixel(buf, ox + x, oy + y, saw, 'cross');
        } else if (cheb <= 11 || manh <= 16) {
          const ring = manh <= 7 ? BALKAN_PAL.gold : BALKAN_PAL.crimsonHi;
          setStitchPixel(buf, ox + x, oy + y, ring, 'cross');
        } else if (Math.abs(dx - dy) < 4 || dx < 3 || dy < 3) {
          const armCol = (x >> 2) === (y >> 2) || Math.abs(dx - dy) < 4 ? BALKAN_PAL.crimson : BALKAN_PAL.indigo;
          setStitchPixel(buf, ox + x, oy + y, armCol, 'cross');
        } else {
          // Warm ivory Aida rug field inside the octagon with tiny geometric X stars
          setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.linenHi, 'linen');
        }
      } else if (onGrout) {
        setPx(buf, ox + x, oy + y, shiftRgba(TEX.plazaEdge, ((x + y) & 3) === 0 ? -12 : 4));
      } else {
        setPx(buf, ox + x, oy + y, shiftRgba(TEX.plazaLinen, getStitchDelta(x, y, 'linen')));
      }
    }
  }

  // Four symmetrical Bulgarian Shevitsa Elbetitsa corners stitched onto ivory quadrants
  for (const [cx, cy] of [
    [ox + 42, oy + 42],
    [ox + 82, oy + 42],
    [ox + 42, oy + 82],
    [ox + 82, oy + 82],
  ] as const) {
    drawCellCrossStitch(buf, cx, cy, BALKAN_PAL.emerald);
    drawCellCrossStitch(buf, cx + 4, cy, BALKAN_PAL.crimson);
    drawCellCrossStitch(buf, cx, cy + 4, BALKAN_PAL.crimson);
    drawCellCrossStitch(buf, cx - 4, cy, BALKAN_PAL.gold);
  }
}

function paintTreeOfLifeCarpet(buf: PixelBuffer): void {
  const { ox, oy } = tileOrigin(4, 2); // 96x96 (3x3)
  const W = 96;
  const H = 96;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Top & bottom wool warp fringe rows (3..7 and 88..92) over transparent corners
      if (y < 3 || y > 92 || x < 4 || x > 91) continue;
      if (y < 8 || y > 87) {
        if ((x & 3) < 2) {
          setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.linenHi, 'twill-v');
        }
        continue;
      }
      // Deep madder-red & indigo kilim tapestry frame
      const bx = Math.min(x - 4, 91 - x);
      const by = Math.min(y - 8, 87 - y);
      const d = Math.min(bx, by);
      if (d <= 1) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
      } else if (d <= 6) {
        const zig = (((x + y) >> 2) & 1) === 0 ? BALKAN_PAL.gold : BALKAN_PAL.indigo;
        setStitchPixel(buf, ox + x, oy + y, zig, 'cross');
      } else if (d <= 10) {
        setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.linenHi, 'cross');
      } else {
        setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.crimson, 'twill-h');
      }
    }
  }

  // Embroidered Golden Tree of Life centered on the crimson kilim
  const trunkX = ox + 46;
  for (let py = oy + 24; py <= oy + 76; py += 4) {
    drawCellCrossStitch(buf, trunkX, py, BALKAN_PAL.linenHi);
  }
  for (const [stepY, span] of [
    [28, 8],
    [40, 16],
    [54, 20],
  ] as const) {
    drawBackstitchLine(buf, ox + 48 - span, oy + stepY, ox + 48, oy + stepY + 6, BALKAN_PAL.gold);
    drawBackstitchLine(buf, ox + 48 + span, oy + stepY, ox + 48, oy + stepY + 6, BALKAN_PAL.gold);
    drawCellCrossStitch(buf, ox + 46 - span, oy + stepY - 2, BALKAN_PAL.jade);
    drawCellCrossStitch(buf, ox + 46 + span, oy + stepY - 2, BALKAN_PAL.jade);
    drawCrossStitch(buf, ox + 47 - span, oy + stepY + 2, BALKAN_PAL.gold, BALKAN_PAL.ochre, 3);
    drawCrossStitch(buf, ox + 47 + span, oy + stepY + 2, BALKAN_PAL.gold, BALKAN_PAL.ochre, 3);
  }
  // Crown diamond star
  drawCellCrossStitch(buf, trunkX, oy + 18, BALKAN_PAL.gold);
}

function paintSamodivaGlade(buf: PixelBuffer): void {
  const { ox, oy } = tileOrigin(7, 2); // 96x96 (3x3), transparent outside fairy wreath
  const cx = 47.5;
  const cy = 47.5;
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r <= 41 && r >= 27) {
        // Moonlit fern & silver-moss cross-stitch ring
        if (r > 39.5 || r < 28.5) {
          if (((x + y) & 1) === 0) setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
        } else {
          const band = r < 34 ? BALKAN_PAL.jade : BALKAN_PAL.emerald;
          setStitchPixel(buf, ox + x, oy + y, band, 'cross');
        }
      } else if (r <= 11) {
        // Inner luminous periwinkle silk dewdrop spring rune
        setStitchPixel(buf, ox + x, oy + y, r < 6 ? BALKAN_PAL.mintGlow : BALKAN_PAL.periwinkle, 'satin');
      }
    }
  }
  // Ring of 8 enchanted mushrooms & periwinkle X blossoms around the glade
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const mx = Math.round(ox + cx + Math.cos(ang) * 34);
    const my = Math.round(oy + cy + Math.sin(ang) * 34);
    drawCellCrossStitch(buf, mx - 2, my - 2, k % 2 === 0 ? BALKAN_PAL.rosePale : BALKAN_PAL.periwinkle);
    drawCrossStitch(buf, mx - 1, my - 1, BALKAN_PAL.linenHi, BALKAN_PAL.mintGlow, 2);
  }
}

function paintKukeriHearth(buf: PixelBuffer): void {
  const { ox, oy } = tileOrigin(10, 2); // 96x96 (3x3), transparent outside hearth circle
  const cx = 47.5;
  const cy = 47.5;
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r > 43) continue;
      if (r > 41.5) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
      } else if (r > 29) {
        // Ring of stitched hearth stones
        const ang = Math.atan2(y - cy, x - cx);
        const spoke = Math.abs(Math.sin(ang * 8)) < 0.08;
        const c = spoke ? BALKAN_PAL.inkSoft : BALKAN_PAL.cobble;
        setStitchPixel(buf, ox + x, oy + y, c, 'cross');
      } else if (r > 18) {
        // Dark ash embroidered bed
        setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.slateDark, 'tent');
      } else {
        // Satin-stitched glowing Kukeri ember flames
        const flameCol =
          r < 7 ? BALKAN_PAL.gold : r < 12 ? BALKAN_PAL.crimsonHi : BALKAN_PAL.terracotta;
        setStitchPixel(buf, ox + x, oy + y, flameCol, 'satin');
      }
    }
  }
  // Copper ritual bells stitched around north stone rim
  for (const bx of [32, 46, 60]) {
    drawCellCrossStitch(buf, ox + bx, oy + 12, BALKAN_PAL.gold);
  }
}

function paintLamiaWell(buf: PixelBuffer): void {
  const { ox, oy } = tileOrigin(13, 2); // 96x96 (3x3), transparent exterior
  const cx = 47.5;
  const cy = 47.5;
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r > 42) continue;
      if (r > 40.5) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
      } else if (r > 32) {
        // Choked crimson altar cloth border with saffron X trim
        const rim = r < 34 ? BALKAN_PAL.gold : BALKAN_PAL.crimsonDark;
        setStitchPixel(buf, ox + x, oy + y, rim, 'cross');
      } else if (r > 20) {
        // Serpent coil ring in emerald & jade scale cross-stitching!
        const scale = (((x >> 2) + (y >> 2)) & 1) === 0 ? BALKAN_PAL.emerald : BALKAN_PAL.jade;
        setStitchPixel(buf, ox + x, oy + y, scale, 'cross');
      } else if (r > 17) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
      } else {
        // Luminescent trapped jade water inside the well
        setStitchPixel(buf, ox + x, oy + y, r < 8 ? BALKAN_PAL.mintGlow : BALKAN_PAL.emeraldDark, 'satin');
      }
    }
  }
  // Serpent head crown facing south-west on the coil rim
  drawCellCrossStitch(buf, ox + 28, oy + 62, BALKAN_PAL.emeraldDark);
  drawCrossStitch(buf, ox + 29, oy + 63, BALKAN_PAL.gold, BALKAN_PAL.crimsonHi, 2);
}

// =============================================================================
// 5. Revival Cottages (3x3 each, Rows 5..7 cols 4..12)
// =============================================================================

function paintRevivalCottage(
  buf: PixelBuffer,
  colOrigin: number,
  rowOrigin: number,
  variant: 'main' | 'herb' | 'forge',
): void {
  const { ox, oy } = tileOrigin(colOrigin, rowOrigin); // 96x96

  // 1. Overhanging scalloped terracotta roof (top rows 6..44, cols 6..89)
  for (let y = 6; y <= 44; y++) {
    const roofInset = y < 22 ? Math.round((22 - y) * 0.75) : 0;
    const xStart = 6 + roofInset;
    const xEnd = 89 - roofInset;
    for (let x = xStart; x <= xEnd; x++) {
      const onOutline =
        x === xStart ||
        x === xEnd ||
        y === 6 ||
        y === 44 ||
        (y >= 42 && ((x >> 1) & 1) === 1 && y === 44);
      if (onOutline) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
        continue;
      }
      // Scalloped embroidery shingle bands every 6px
      const band = (y - 6) % 6;
      const shingle =
        band === 5
          ? BALKAN_PAL.terracottaDark
          : band === 0
            ? BALKAN_PAL.terracottaHi
            : variant === 'forge'
              ? mixRgba(BALKAN_PAL.terracotta, BALKAN_PAL.slateDark, 0.25)
              : BALKAN_PAL.terracotta;
      setStitchPixel(buf, ox + x, oy + y, shingle, 'cross-fine');
    }
  }

  // Timber gable chimney on top right
  for (let y = 3; y <= 18; y++) {
    for (let x = 67; x <= 76; x++) {
      const border = x === 67 || x === 76 || y === 3;
      setPx(buf, ox + x, oy + y, border ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.cobble, getStitchDelta(x, y, 'cross-fine')));
    }
  }

  // 2. Upper timber čardak story (rows 45..64, cols 12..83)
  for (let y = 45; y <= 64; y++) {
    for (let x = 12; x <= 83; x++) {
      const border = x === 12 || x === 83 || y === 64;
      const beamX = x === 14 || x === 48 || x === 81;
      const railY = y === 55 || y === 56;
      if (border) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
      } else if (beamX || railY) {
        setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.woodDark, 'twill-h');
      } else if (y > 56 && x % 5 < 2) {
        setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.woodHi, 'twill-v');
      } else {
        setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.linenMid, 'linen');
      }
    }
  }

  // 3. Lower whitewashed Aida linen facade (rows 65..89, cols 14..81)
  for (let y = 65; y <= 89; y++) {
    for (let x = 14; x <= 81; x++) {
      const border = x === 14 || x === 81 || y === 89;
      const plinth = y >= 82;
      if (border) {
        setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
      } else if (plinth) {
        const stone = ((x >> 3) + (y >> 2)) & 1 ? BALKAN_PAL.cobble : BALKAN_PAL.cobbleDark;
        setStitchPixel(buf, ox + x, oy + y, stone, 'cross');
      } else {
        setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.linenHi, 'linen');
      }
    }
  }

  // Arched embroidered oak door centered at cols 40..54, rows 68..88
  for (let y = 68; y <= 88; y++) {
    for (let x = 41; x <= 53; x++) {
      const border = x === 41 || x === 53 || y === 68;
      setPx(buf, ox + x, oy + y, border ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.wood, getStitchDelta(x, y, 'twill-v')));
    }
  }
  drawBackstitchLine(buf, ox + 47, oy + 69, ox + 47, oy + 88, BALKAN_PAL.inkSoft);

  // Twin glow-stitched Mullion Windows on upper & lower stories
  for (const [wx, wy] of [
    [22, 48],
    [62, 48],
    [22, 68],
    [62, 68],
  ] as const) {
    for (let y = wy; y < wy + 9; y++) {
      for (let x = wx; x < wx + 10; x++) {
        const frame = x === wx || x === wx + 9 || y === wy || y === wy + 8 || x === wx + 5;
        setPx(
          buf,
          ox + x,
          oy + y,
          frame ? BALKAN_PAL.woodDark : shiftRgba(BALKAN_PAL.gold, getStitchDelta(x, y, 'satin')),
        );
      }
    }
  }

  // Craftsman variant embroidery touches
  if (variant === 'main') {
    // Festive crimson & white Martenitsa & geranium under cardak
    drawCellCrossStitch(buf, ox + 20, oy + 58, BALKAN_PAL.crimsonHi);
    drawCellCrossStitch(buf, ox + 64, oy + 58, BALKAN_PAL.crimsonHi);
    drawCrossStitch(buf, ox + 46, oy + 51, BALKAN_PAL.crimson, BALKAN_PAL.linenHi, 3);
  } else if (variant === 'herb') {
    // Hanging plum & jade dried botanical bundles
    for (const bx of [21, 31, 61, 71]) {
      drawCellCrossStitch(buf, ox + bx, oy + 58, BALKAN_PAL.plum);
      drawCellCrossStitch(buf, ox + bx, oy + 62, BALKAN_PAL.jade);
    }
  } else {
    // Forge ironwork brackets & glowing ember hearth window
    for (let y = 76; y <= 84; y++) {
      for (let x = 60; x <= 74; x++) {
        setStitchPixel(buf, ox + x, oy + y, y < 80 ? BALKAN_PAL.crimsonHi : BALKAN_PAL.gold, 'satin');
      }
    }
    drawCellCrossStitch(buf, ox + 24, oy + 78, BALKAN_PAL.slateDark);
  }
}

// =============================================================================
// 6. Stitched Trees, Props, Row 10 Extras & Row 12..15 Wang Sets
// =============================================================================

function paintStitchedCanopyBlob(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  coreCol: Rgba,
  hiCol: Rgba,
  seed: number,
): void {
  for (let dy = -ry - 1; dy <= ry + 1; dy++) {
    for (let dx = -rx - 1; dx <= rx + 1; dx++) {
      const nr = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (nr > 1.15) continue;
      if (nr > 0.92) {
        setPx(buf, cx + dx, cy + dy, BALKAN_PAL.inkSoft);
      } else {
        const px = cx + dx;
        const py = cy + dy;
        const lit = dy < -ry * 0.25 || hash2d(px >> 2, py >> 2, seed) > 0.68;
        setStitchPixel(buf, px, py, lit ? hiCol : coreCol, 'tent');
      }
    }
  }
}

function paintTreesAndFolkloreProps(buf: PixelBuffer): void {
  // MARTENITSA_OAK (cols 13..14, rows 5..6 -> 64x64)
  {
    const { ox, oy } = tileOrigin(13, 5);
    for (let y = 36; y <= 60; y++) {
      const flare = y > 54 ? (y - 54) >> 1 : 0;
      for (let x = 27 - flare; x <= 36 + flare; x++) {
        const border = x === 27 - flare || x === 36 + flare;
        setPx(buf, ox + x, oy + y, border ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.woodDark, getStitchDelta(x, y, 'twill-v')));
      }
    }
    paintStitchedCanopyBlob(buf, ox + 22, oy + 26, 15, 13, BALKAN_PAL.emeraldDark, BALKAN_PAL.emerald, 11);
    paintStitchedCanopyBlob(buf, ox + 42, oy + 26, 15, 13, BALKAN_PAL.emeraldDark, BALKAN_PAL.emerald, 17);
    paintStitchedCanopyBlob(buf, ox + 32, oy + 19, 19, 15, BALKAN_PAL.emerald, BALKAN_PAL.jade, 23);
    // Hung Martenitsa red/white silk tassels
    for (const [tx, ty] of [
      [20, 22],
      [34, 15],
      [44, 24],
    ] as const) {
      drawCrossStitch(buf, ox + tx, oy + ty, BALKAN_PAL.crimsonHi, BALKAN_PAL.linenHi, 3);
      setPx(buf, ox + tx + 1, oy + ty + 3, BALKAN_PAL.linenHi);
      setPx(buf, ox + tx + 1, oy + ty + 4, BALKAN_PAL.crimsonHi);
    }
  }

  // SAMODIVA_BIRCH (col 15, rows 5..6 -> 32x64)
  {
    const { ox, oy } = tileOrigin(15, 5);
    for (let y = 32; y <= 60; y++) {
      for (let x = 13; x <= 18; x++) {
        const edge = x === 13 || x === 18;
        const bar = !edge && y % 5 === 0 && x >= 14 && x <= 16;
        setPx(
          buf,
          ox + x,
          oy + y,
          edge || bar ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.linenHi, getStitchDelta(x, y, 'twill-v')),
        );
      }
    }
    paintStitchedCanopyBlob(buf, ox + 16, oy + 20, 12, 16, BALKAN_PAL.jade, BALKAN_PAL.mintGlow, 29);
    drawCrossStitch(buf, ox + 12, oy + 18, BALKAN_PAL.periwinkle, BALKAN_PAL.rosePale, 3);
  }

  // UPRIGHT_LOOM (13, 7)
  {
    const { ox, oy } = tileOrigin(13, 7);
    drawBackstitchLine(buf, ox + 7, oy + 5, ox + 24, oy + 5, BALKAN_PAL.woodDark);
    drawBackstitchLine(buf, ox + 7, oy + 27, ox + 24, oy + 27, BALKAN_PAL.woodDark);
    drawBackstitchLine(buf, ox + 7, oy + 5, ox + 7, oy + 27, BALKAN_PAL.wood);
    drawBackstitchLine(buf, ox + 24, oy + 5, ox + 24, oy + 27, BALKAN_PAL.wood);
    for (let y = 9; y <= 24; y++) {
      for (let x = 10; x <= 21; x++) {
        if (y < 14) {
          // Exposed linen warp threads
          setPx(buf, ox + x, oy + y, x & 1 ? BALKAN_PAL.linenHi : BALKAN_PAL.clear);
        } else {
          // Half-woven crimson/gold rug on the loom
          const c = (y & 2) === 0 ? BALKAN_PAL.crimson : (x & 2) === 0 ? BALKAN_PAL.gold : BALKAN_PAL.indigo;
          setStitchPixel(buf, ox + x, oy + y, c, 'cross-fine');
        }
      }
    }
  }

  // SACRIFICE_OFFERING (14, 7) — ceremonial bread loaf & wine vessel on stitched cloth
  {
    const { ox, oy } = tileOrigin(14, 7);
    for (let y = 11; y <= 24; y++) {
      for (let x = 7; x <= 24; x++) {
        const edge = x === 7 || x === 24 || y === 11 || y === 24;
        setPx(buf, ox + x, oy + y, edge ? BALKAN_PAL.crimson : shiftRgba(BALKAN_PAL.linenHi, getStitchDelta(x, y, 'cross')));
      }
    }
    paintStitchedCanopyBlob(buf, ox + 15, oy + 17, 5, 4, BALKAN_PAL.ochre, BALKAN_PAL.gold, 41);
    drawCrossStitch(buf, ox + 19, oy + 14, BALKAN_PAL.crimsonHi, BALKAN_PAL.crimsonDark, 3);
  }

  // BROKEN_AMPHORAE (15, 7)
  {
    const { ox, oy } = tileOrigin(15, 7);
    paintStitchedCanopyBlob(buf, ox + 11, oy + 20, 5, 4, BALKAN_PAL.terracotta, BALKAN_PAL.terracottaHi, 53);
    paintStitchedCanopyBlob(buf, ox + 21, oy + 18, 4, 5, BALKAN_PAL.ochreDark, BALKAN_PAL.ochre, 59);
    drawBackstitchLine(buf, ox + 13, oy + 24, ox + 23, oy + 24, BALKAN_PAL.inkSoft);
  }

  // BALKAN_PINE (col 0, rows 8..9 -> 32x64)
  {
    const { ox, oy } = tileOrigin(0, 8);
    for (let y = 44; y <= 60; y++) {
      for (let x = 13; x <= 18; x++) {
        setPx(buf, ox + x, oy + y, x === 13 || x === 18 ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.woodDark, getStitchDelta(x, y, 'twill-v')));
      }
    }
    for (const [topY, h, maxHalfW] of [
      [6, 16, 8],
      [18, 16, 11],
      [30, 17, 13],
    ] as const) {
      for (let dy = 0; dy < h; dy++) {
        const hw = Math.max(1, Math.round(((dy + 1) / h) * maxHalfW));
        for (let dx = -hw; dx <= hw; dx++) {
          const edge = dx === -hw || dx === hw || dy === h - 1;
          const needleHi = !edge && dy >= 5 && dy < h - 2 && ((Math.abs(dx) + dy) % 5 === 0);
          const colNeedle = needleHi
            ? BALKAN_PAL.jade
            : dy < 4
              ? BALKAN_PAL.emerald
              : BALKAN_PAL.emeraldDark;
          setPx(
            buf,
            ox + 16 + dx,
            oy + topY + dy,
            edge ? BALKAN_PAL.inkSoft : shiftRgba(colNeedle, getStitchDelta(16 + dx, topY + dy, 'tent')),
          );
        }
      }
    }
  }

  // SUNFLOWERS (1, 8)
  {
    const { ox, oy } = tileOrigin(1, 8);
    drawBackstitchLine(buf, ox + 11, oy + 16, ox + 11, oy + 28, BALKAN_PAL.emerald);
    drawBackstitchLine(buf, ox + 21, oy + 14, ox + 21, oy + 28, BALKAN_PAL.emerald);
    paintStitchedCanopyBlob(buf, ox + 11, oy + 13, 5, 5, BALKAN_PAL.gold, BALKAN_PAL.ochre, 61);
    paintStitchedCanopyBlob(buf, ox + 21, oy + 11, 5, 5, BALKAN_PAL.gold, BALKAN_PAL.ochre, 67);
    drawCrossStitch(buf, ox + 10, oy + 12, BALKAN_PAL.woodDark, BALKAN_PAL.inkSoft, 2);
    drawCrossStitch(buf, ox + 20, oy + 10, BALKAN_PAL.woodDark, BALKAN_PAL.inkSoft, 2);
  }

  // POPPY_BUSH (2, 8)
  {
    const { ox, oy } = tileOrigin(2, 8);
    paintStitchedCanopyBlob(buf, ox + 16, oy + 19, 10, 8, BALKAN_PAL.emerald, BALKAN_PAL.jade, 71);
    drawCrossStitch(buf, ox + 11, oy + 15, BALKAN_PAL.crimsonHi, BALKAN_PAL.crimsonDark, 3);
    drawCrossStitch(buf, ox + 19, oy + 14, BALKAN_PAL.crimsonHi, BALKAN_PAL.crimsonDark, 3);
    drawCrossStitch(buf, ox + 15, oy + 20, BALKAN_PAL.crimson, BALKAN_PAL.inkSoft, 3);
  }

  // WINE_BARREL (3, 8)
  {
    const { ox, oy } = tileOrigin(3, 8);
    for (let y = 9; y <= 26; y++) {
      const bul = y > 13 && y < 22 ? 1 : 0;
      for (let x = 10 - bul; x <= 21 + bul; x++) {
        const hoop = y === 12 || y === 23;
        const edge = x === 10 - bul || x === 21 + bul || y === 9 || y === 26;
        setPx(
          buf,
          ox + x,
          oy + y,
          edge ? BALKAN_PAL.inkSoft : hoop ? BALKAN_PAL.slate : shiftRgba(BALKAN_PAL.wood, getStitchDelta(x, y, 'twill-v')),
        );
      }
    }
  }

  // BLACKSMITH_ANVIL (4, 8)
  {
    const { ox, oy } = tileOrigin(4, 8);
    paintStitchedCanopyBlob(buf, ox + 16, oy + 22, 6, 4, BALKAN_PAL.woodDark, BALKAN_PAL.wood, 73);
    for (let y = 12; y <= 17; y++) {
      for (let x = 8; x <= 23; x++) {
        const edge = y === 12 || y === 17 || x === 8 || x === 23;
        setPx(buf, ox + x, oy + y, edge ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.slate, getStitchDelta(x, y, 'cross-fine')));
      }
    }
  }

  // VILLAGE_EDICT_BOARD (5, 8)
  {
    const { ox, oy } = tileOrigin(5, 8);
    drawBackstitchLine(buf, ox + 15, oy + 19, ox + 15, oy + 28, BALKAN_PAL.woodDark);
    for (let y = 7; y <= 19; y++) {
      for (let x = 6; x <= 25; x++) {
        const frame = x === 6 || x === 25 || y === 7 || y === 19;
        setPx(buf, ox + x, oy + y, frame ? BALKAN_PAL.woodDark : shiftRgba(BALKAN_PAL.linenHi, getStitchDelta(x, y, 'linen')));
      }
    }
    drawBackstitchLine(buf, ox + 9, oy + 11, ox + 22, oy + 11, BALKAN_PAL.crimson);
    drawBackstitchLine(buf, ox + 9, oy + 14, ox + 19, oy + 14, BALKAN_PAL.indigo);
  }

  // OAK_BENCH (6, 8)
  {
    const { ox, oy } = tileOrigin(6, 8);
    for (let y = 13; y <= 21; y++) {
      for (let x = 5; x <= 26; x++) {
        const edge = x === 5 || x === 26 || y === 13 || y === 21;
        setPx(buf, ox + x, oy + y, edge ? BALKAN_PAL.inkSoft : shiftRgba(BALKAN_PAL.woodHi, getStitchDelta(x, y, 'twill-h')));
      }
    }
    drawBackstitchLine(buf, ox + 7, oy + 22, ox + 7, oy + 26, BALKAN_PAL.woodDark);
    drawBackstitchLine(buf, ox + 24, oy + 22, ox + 24, oy + 26, BALKAN_PAL.woodDark);
  }

  // CHIPROVTSI_RUG (7, 8)
  {
    const { ox, oy } = tileOrigin(7, 8);
    for (let y = 6; y <= 25; y++) {
      for (let x = 5; x <= 26; x++) {
        const edge = x === 5 || x === 26 || y === 6 || y === 25;
        const inner = x === 8 || x === 23 || y === 9 || y === 22;
        setPx(
          buf,
          ox + x,
          oy + y,
          edge ? BALKAN_PAL.inkSoft : inner ? BALKAN_PAL.gold : shiftRgba(BALKAN_PAL.crimson, getStitchDelta(x, y, 'cross')),
        );
      }
    }
    drawCellCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.linenHi);
  }
}

function paintRow10Extras(buf: PixelBuffer): void {
  // SPRING_POOL (cols 1..2, rows 10..11 -> 64x64)
  {
    const { ox, oy } = tileOrigin(1, 10);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const r = Math.hypot(x - 31.5, y - 31.5);
        if (r > 29) continue;
        if (r > 27.5) {
          setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
        } else if (r > 23) {
          setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.cobble, 'cross');
        } else {
          setPx(buf, ox + x, oy + y, sampleBargelloWater(x, y));
        }
      }
    }
    drawCellCrossStitch(buf, ox + 26, oy + 26, BALKAN_PAL.mintGlow);
    drawCrossStitch(buf, ox + 35, oy + 32, BALKAN_PAL.waterFoam, BALKAN_PAL.periwinkle, 3);
  }

  // RHODOPE_ROSETTE (cols 4..5, rows 10..11 -> 64x64)
  {
    const { ox, oy } = tileOrigin(4, 10);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const dx = Math.abs(x - 31.5);
        const dy = Math.abs(y - 31.5);
        const r = Math.hypot(dx, dy);
        if (r > 28) continue;
        if (r > 26.5) {
          setPx(buf, ox + x, oy + y, BALKAN_PAL.inkSoft);
        } else if (dx + dy < 12) {
          setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.gold, 'cross');
        } else if (Math.abs(dx - dy) < 4 || dx < 3 || dy < 3) {
          setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.crimson, 'cross');
        } else {
          setStitchPixel(buf, ox + x, oy + y, BALKAN_PAL.indigo, 'cross');
        }
      }
    }
  }

  // GOLDEN_WHEAT (cols 6..7, rows 10..11 -> 64x64)
  {
    const { ox, oy } = tileOrigin(6, 10);
    for (let sx = 10; sx <= 52; sx += 10) {
      for (let sy = 14; sy <= 50; sy += 12) {
        drawBackstitchLine(buf, ox + sx, oy + sy, ox + sx - 2, oy + sy + 8, BALKAN_PAL.ochreDark);
        drawCellCrossStitch(buf, ox + sx - 2, oy + sy - 4, BALKAN_PAL.gold);
        drawCrossStitch(buf, ox + sx + 1, oy + sy - 2, BALKAN_PAL.ochre, BALKAN_PAL.linenHi, 2);
      }
    }
  }
}

function paintWangSetsRows12To15(buf: PixelBuffer): void {
  // Row 12: 16-tile 4-edge Khoro Kilim Runner Road (N=1, E=2, S=4, W=8)
  for (let mask = 0; mask < 16; mask++) {
    const { ox, oy } = tileOrigin(mask, 12);
    const hasN = (mask & 1) !== 0;
    const hasE = (mask & 2) !== 0;
    const hasS = (mask & 4) !== 0;
    const hasW = (mask & 8) !== 0;

    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        let d = Math.hypot(x - 15.5, y - 15.5);
        if (hasN && y <= 16) d = Math.min(d, Math.abs(x - 15.5));
        if (hasS && y >= 15) d = Math.min(d, Math.abs(x - 15.5));
        if (hasW && x <= 16) d = Math.min(d, Math.abs(y - 15.5));
        if (hasE && x >= 15) d = Math.min(d, Math.abs(y - 15.5));
        const orient: 'h' | 'v' =
          (hasN || hasS) && !(hasE || hasW) ? 'v' : 'h';
        setPx(buf, ox + x, oy + y, sampleKilimRoadPixel(x, y, d, orient));
      }
    }
    if (mask === 10 || mask === 5 || mask === 15) {
      drawCrossStitch(buf, ox + 14, oy + 14, BALKAN_PAL.crimson, BALKAN_PAL.gold, 3);
    }
  }

  // Row 13: 16-tile 4-corner Scorched Drought Wool (NW=1, NE=2, SE=4, SW=8)
  for (let mask = 0; mask < 16; mask++) {
    const { ox, oy } = tileOrigin(mask, 13);
    const nw = mask & 1 ? 1 : 0;
    const ne = mask & 2 ? 1 : 0;
    const se = mask & 4 ? 1 : 0;
    const sw = mask & 8 ? 1 : 0;

    for (let y = 0; y < 32; y++) {
      const fy = y / 31;
      for (let x = 0; x < 32; x++) {
        const fx = x / 31;
        const innerRipple =
          Math.sin(fx * Math.PI) * Math.sin(fy * Math.PI) * Math.sin((x + y) * 0.4) * 0.06;
        const w =
          nw * (1 - fx) * (1 - fy) +
          ne * fx * (1 - fy) +
          se * fx * fy +
          sw * (1 - fx) * fy +
          innerRipple;
        if (w < 0.36) {
          setPx(buf, ox + x, oy + y, sampleBaseMeadowStitch(x, y));
        } else if (w < 0.47) {
          const rim = mixRgba(TEX.sageSoft, BALKAN_PAL.ochre, 0.5);
          setPx(buf, ox + x, oy + y, shiftRgba(rim, getMeadowYarnDelta(x, y)));
        } else {
          setPx(buf, ox + x, oy + y, sampleDroughtWool(x, y));
        }
      }
    }
  }

  // Row 14: 16-tile 4-corner Bargello Brook Water (NW=1, NE=2, SE=4, SW=8)
  for (let mask = 0; mask < 16; mask++) {
    const { ox, oy } = tileOrigin(mask, 14);
    const nw = mask & 1 ? 1 : 0;
    const ne = mask & 2 ? 1 : 0;
    const se = mask & 4 ? 1 : 0;
    const sw = mask & 8 ? 1 : 0;

    for (let y = 0; y < 32; y++) {
      const fy = y / 31;
      for (let x = 0; x < 32; x++) {
        const fx = x / 31;
        const innerRipple =
          Math.sin(fx * Math.PI) * Math.sin(fy * Math.PI) * Math.sin((x - y) * 0.4) * 0.05;
        const w =
          nw * (1 - fx) * (1 - fy) +
          ne * fx * (1 - fy) +
          se * fx * fy +
          sw * (1 - fx) * fy +
          innerRipple;
        if (w < 0.35) {
          setPx(buf, ox + x, oy + y, sampleBaseMeadowStitch(x, y));
        } else if (w < 0.43) {
          setPx(
            buf,
            ox + x,
            oy + y,
            shiftRgba(BALKAN_PAL.woodDark, getStitchDelta(x, y, 'cross-fine')),
          );
        } else if (w < 0.51) {
          setPx(buf, ox + x, oy + y, shiftRgba(BALKAN_PAL.waterFoam, getStitchDelta(x, y, 'satin')));
        } else {
          setPx(buf, ox + x, oy + y, sampleBargelloWater(x, y));
        }
      }
    }
  }

  // Row 15: 16-tile 4-edge Stitched Stone & Terracotta Courtyard Wall (N=1, E=2, S=4, W=8)
  for (let mask = 0; mask < 16; mask++) {
    const { ox, oy } = tileOrigin(mask, 15);
    const hasN = (mask & 1) !== 0;
    const hasE = (mask & 2) !== 0;
    const hasS = (mask & 4) !== 0;
    const hasW = (mask & 8) !== 0;

    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        let onWall = Math.hypot(x - 15.5, y - 15.5) <= 9.5;
        if (hasN && y <= 16 && Math.abs(x - 15.5) <= 7.5) onWall = true;
        if (hasS && y >= 15 && Math.abs(x - 15.5) <= 7.5) onWall = true;
        if (hasW && x <= 16 && Math.abs(y - 15.5) <= 7.5) onWall = true;
        if (hasE && x >= 15 && Math.abs(y - 15.5) <= 7.5) onWall = true;
        if (!onWall) continue;

        const isEdge =
          Math.abs(x - 15.5) > 6.5 && !((hasW && x < 16) || (hasE && x > 15)) ||
          Math.abs(y - 15.5) > 6.5 && !((hasN && y < 16) || (hasS && y > 15));
        if (isEdge) {
          setPx(
            buf,
            ox + x,
            oy + y,
            ((x + y) & 1) === 0 ? BALKAN_PAL.woodDark : BALKAN_PAL.inkSoft,
          );
        } else if (y < 14 || (hasN && y < 18)) {
          const rib = (x & 3) === 0 ? BALKAN_PAL.terracottaDark : BALKAN_PAL.terracotta;
          setStitchPixel(buf, ox + x, oy + y, rib, 'cross-fine');
        } else {
          const sx = (x + ((y >> 2) & 1) * 4) % 8;
          const sy = y % 5;
          const mortar = sx === 0 || sy === 0;
          const stone = mortar
            ? BALKAN_PAL.cobbleDark
            : ((x >> 3) + (y >> 2)) & 1
              ? BALKAN_PAL.cobble
              : BALKAN_PAL.cobbleHi;
          setStitchPixel(buf, ox + x, oy + y, stone, mortar ? 'linen' : 'cross');
        }
      }
    }
  }
}

export function renderBalkanTilesetPixels(): PixelBuffer {
  const buf = createPixelBuffer(BALKAN_TILESET_WIDTH, BALKAN_TILESET_HEIGHT);

  paintRow0Terrains(buf);
  paintRow1BanksAndProps(buf);

  paintElbetitsaPlaza(buf);
  paintTreeOfLifeCarpet(buf);
  paintSamodivaGlade(buf);
  paintKukeriHearth(buf);
  paintLamiaWell(buf);

  paintRevivalCottage(buf, 4, 5, 'main');
  paintRevivalCottage(buf, 7, 5, 'herb');
  paintRevivalCottage(buf, 10, 5, 'forge');

  paintTreesAndFolkloreProps(buf);
  paintWangMeadowSets(buf);
  paintVariantSlots(buf);
  paintRow10Extras(buf);
  paintWangSetsRows12To15(buf);

  return buf;
}
