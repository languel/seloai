import { describe, expect, it } from 'vitest';
import { createDefaultMap } from '../../data/defaultData';
import { SEGMENTATION_MODEL_PRESETS } from '../../ai/segmentationClient';
import {
  appendTilesToTileset,
  applyChromaKeyToPixelGrid,
  applyMacroStampToMap,
  computeAspectPreservingFootprint,
  computeSalientSeedPoints,
  createBlankTilesetDataUrl,
  createMacroStampFromIndices,
  detectMotifRegions,
  detectSalientMotifRegions,
  extractRegionsFromMatte,
  filterMaskCandidatesNMS,
  findNearestPaletteIndex,
  findOpenSlotForOutputBox,
  floodFillTransparent,
  getOpaqueBounds,
  hitTestBoxAction,
  parseAsciiPatternToGrid,
  parseHexColor,
  placeTilesInTilesetAt,
  processTilePixels,
  quantizeAndRebuildPixelGrid,
  remapTileIndicesInMap,
  removeEdgeBackground,
  repositionTilesInTileset,
  resizeBoxWithHandle,
  sampleNearestPaletteIndexFromImageData,
  sliceSelectionToTiles,
} from '../tapestrySampler';
import { createBlankWorldMap } from '../../storage/villageStore';

describe('Tapestry sampler', () => {
  it('slices imported tapestry/painting crops into tiles, removes background color, and creates macro stamps', async () => {
    // 1. Test sliceSelectionToTiles calculation
    const sliced = sliceSelectionToTiles(
      {} as any,
      400,
      300,
      { x: 32, y: 64, w: 96, h: 64 },
      32,
    );
    expect(sliced.cols).toBe(3);
    expect(sliced.rows).toBe(2);
    expect(sliced.tileDim).toBe(32);

    // 2. Test chroma-key background transparency filtering
    const mockData = {
      data: new Uint8ClampedArray([
        255, 255, 255, 255, // Exact white -> transparent
        250, 250, 250, 255, // Near white -> transparent within tolerance
        190, 30, 45, 255,   // Crimson thread -> kept opaque
        34, 119, 60, 255,   // Green thread -> kept opaque
      ]),
    } as ImageData;

    processTilePixels(mockData, {
      chromaKey: { r: 255, g: 255, b: 255, tolerance: 20 },
    });

    expect(mockData.data[3]).toBe(0); // White made transparent
    expect(mockData.data[7]).toBe(0); // Near white made transparent
    expect(mockData.data[11]).toBe(255); // Crimson preserved
    expect(mockData.data[15]).toBe(255); // Green preserved

    // 3. Test appending new tiles to an existing tileset
    const appended = await appendTilesToTileset(
      null,
      512,
      512,
      32,
      Array.from({ length: 6 }, () => ({} as any)),
    );
    expect(appended.startTileIndex).toBe(256);
    expect(appended.tileIndices).toEqual([256, 257, 258, 259, 260, 261]);
    expect(appended.newDimX).toBe(512);
    expect(appended.newDimY).toBeGreaterThanOrEqual(512 + 32);

    // 4. Test Macro Stamp generation
    const stamp = createMacroStampFromIndices(
      'Custom Shevitsa Bird',
      3,
      2,
      appended.tileIndices,
      'obj0',
      true,
    );
    expect(stamp.name).toBe('Custom Shevitsa Bird');
    expect(stamp.width).toBe(3);
    expect(stamp.height).toBe(2);
    expect(stamp.tiles.length).toBe(6);
    expect(stamp.layer).toBe('obj0');
    expect(stamp.blocksMovement).toBe(true);
  });

  it('removes edge background while preserving enclosed interior details and computes tight opaque bounds', () => {
    // 5x5 image: white border, 3x3 crimson ring at [1..3, 1..3], white center pixel at (2,2)
    const w = 5;
    const h = 5;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const isRing =
          x >= 1 && x <= 3 && y >= 1 && y <= 3 && !(x === 2 && y === 2);
        if (isRing) {
          buf[i] = 190;
          buf[i + 1] = 30;
          buf[i + 2] = 45;
          buf[i + 3] = 255;
        } else {
          buf[i] = 255;
          buf[i + 1] = 255;
          buf[i + 2] = 255;
          buf[i + 3] = 255;
        }
      }
    }
    const imgData = { width: w, height: h, data: buf } as ImageData;

    removeEdgeBackground(imgData, 15);

    // Outer border (0,0) should be transparent
    expect(imgData.data[3]).toBe(0);
    // Ring pixel (1,1) should stay opaque
    expect(imgData.data[(1 * w + 1) * 4 + 3]).toBe(255);
    // Enclosed white center (2,2) should stay opaque
    expect(imgData.data[(2 * w + 2) * 4 + 3]).toBe(255);

    // Tight opaque bounds should be { x: 1, y: 1, w: 3, h: 3 }
    expect(getOpaqueBounds(imgData)).toEqual({ x: 1, y: 1, w: 3, h: 3 });

    // Magic wand click on center (2,2) removes just the enclosed center
    floodFillTransparent(imgData, [{ x: 2, y: 2 }], 15);
    expect(imgData.data[(2 * w + 2) * 4 + 3]).toBe(0);
    expect(imgData.data[(1 * w + 1) * 4 + 3]).toBe(255);
  });

  it('auto-slices disconnected motifs and rebuilds crisp quantized pixel art with procedural Canvas2D code', () => {
    // Build a 32x16 transparent canvas with two 8x8 motifs:
    // Motif 1 (crimson) at x=2..9, y=2..9; Motif 2 (emerald) at x=20..27, y=4..11
    const w = 32;
    const h = 16;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (x >= 2 && x <= 9 && y >= 2 && y <= 9) {
          buf[i] = 190;
          buf[i + 1] = 30;
          buf[i + 2] = 45;
          buf[i + 3] = 255;
        } else if (x >= 20 && x <= 27 && y >= 4 && y <= 11) {
          buf[i] = 34;
          buf[i + 1] = 139;
          buf[i + 2] = 74;
          buf[i + 3] = 255;
        }
      }
    }
    const imgData = { width: w, height: h, data: buf } as ImageData;

    const regions = detectMotifRegions(imgData, { minSize: 6, mergeGap: 2 });
    expect(regions).toEqual([
      { x: 2, y: 2, w: 8, h: 8 },
      { x: 20, y: 4, w: 8, h: 8 },
    ]);

    const rebuilt = quantizeAndRebuildPixelGrid(imgData, 16, 8, 4, 'ShevitsaPair');
    expect(rebuilt.gridWidth).toBe(16);
    expect(rebuilt.gridHeight).toBe(8);
    expect(rebuilt.palette.length).toBe(2);
    expect(rebuilt.proceduralCode).toContain('export function drawShevitsaPair(');
    expect(rebuilt.proceduralCode).toContain('ctx.fillRect(');

    // Apply chroma-key transparency directly to indexed pattern layer & palette
    const bgRgb = parseHexColor('#fafdf4')!;
    expect(bgRgb).toEqual({ r: 250, g: 253, b: 244 });
    const keyed = applyChromaKeyToPixelGrid(
      [0, 1, 2, 0, -1, 1],
      ['#fafdf4', '#be1e2d', '#f5f8ee'],
      { ...bgRgb, tolerance: 10 },
    );
    expect(keyed.palette).toEqual(['#be1e2d']);
    expect(keyed.grid).toEqual([-1, 0, -1, -1, -1, 0]);
    expect(keyed.removedCells).toBe(3);
    expect(keyed.removedSwatches).toBe(2);
  });

  it('places, repositions, and remaps tiles in output tilesets and sample-brushes palette swatches', async () => {
    const blank = createBlankTilesetDataUrl(8, 4, 32);
    expect(blank.dimX).toBe(256);
    expect(blank.dimY).toBe(128);

    const dummyTiles = Array.from({ length: 4 }, () => ({}) as HTMLCanvasElement);
    const placed = await placeTilesInTilesetAt(null, 256, 128, 32, dummyTiles, 3, 1, 2, 2);
    // 8 cols: row 1 cols 3..4 -> 11,12 ; row 2 cols 3..4 -> 19,20
    expect(placed.tileIndices).toEqual([11, 12, 19, 20]);
    expect(placed.newDimY).toBe(128);

    // Expanding past bottom row (startRow 3 with 2 rows tall -> 5 rows = 160px)
    const expanded = await placeTilesInTilesetAt(null, 256, 128, 32, dummyTiles, 0, 3, 2, 2);
    expect(expanded.tileIndices).toEqual([24, 25, 32, 33]);
    expect(expanded.newDimY).toBe(160);

    // Reposition swap mode between two 2x1 blocks: (1, 0) <-> (4, 1) in 8-col tileset
    const swapped = await repositionTilesInTileset(null, 256, 128, 32, 1, 0, 4, 1, 2, 1, 'swap');
    expect(swapped.srcIndices).toEqual([1, 2]);
    expect(swapped.dstIndices).toEqual([12, 13]);
    expect(swapped.indexRemap).toEqual({ 1: 12, 2: 13, 12: 1, 13: 2 });

    // Move mode only maps source -> dst
    const moved = await repositionTilesInTileset(null, 256, 128, 32, 0, 0, 2, 0, 1, 1, 'move');
    expect(moved.indexRemap).toEqual({ 0: 2 });

    const baseMap = createDefaultMap();
    baseMap.bgTiles[0][1][1] = 1;
    baseMap.bgTiles[0][2][1] = 12;
    baseMap.bgTiles[0][3][1] = 5;
    baseMap.objectTiles[0][1][1] = 2;
    baseMap.stamps = [
      createMacroStampFromIndices('Test', 2, 1, [1, 2], 'bg1', false),
    ];
    const remappedMap = remapTileIndicesInMap(baseMap, swapped.indexRemap);
    expect(remappedMap.bgTiles[0][1][1]).toBe(12);
    expect(remappedMap.bgTiles[0][2][1]).toBe(1);
    expect(remappedMap.bgTiles[0][3][1]).toBe(5);
    expect(remappedMap.objectTiles[0][1][1]).toBe(13);
    expect(remappedMap.stamps?.[0].tiles).toEqual([12, 13]);

    // Palette nearest match + Sample Brush cell approximation
    const palette = ['#be1e2d', '#228b4a', '#1f2937'];
    expect(findNearestPaletteIndex(195, 28, 44, palette)).toBe(0);
    expect(findNearestPaletteIndex(36, 140, 72, palette)).toBe(1);

    // 2x2 cell: 1 transparent pixel + 3 green-ish pixels
    const fgCell = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        0, 0, 0, 0,
        32, 138, 70, 255,
        36, 142, 76, 255,
        34, 136, 74, 255,
      ]),
    } as ImageData;
    expect(sampleNearestPaletteIndexFromImageData(fgCell, palette)).toBe(1);

    // Cell matching chroma-keyed background resolves to transparent (-1)
    const bgCell = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        250, 253, 244, 255,
        251, 252, 245, 255,
        249, 253, 243, 255,
        250, 251, 244, 255,
      ]),
    } as ImageData;
    expect(
      sampleNearestPaletteIndexFromImageData(bgCell, palette, { r: 250, g: 253, b: 244, tolerance: 8 }),
    ).toBe(-1);
  });

  it('hit-tests, resizes with snap/aspect lock, and finds non-overlapping slots for multi-pattern output composition', () => {
    const box = { x: 32, y: 32, w: 64, h: 32 };
    expect(hitTestBoxAction(box, 32, 32, 2)).toBe('nw');
    expect(hitTestBoxAction(box, 96, 64, 2)).toBe('se');
    expect(hitTestBoxAction(box, 64, 32, 2)).toBe('n');
    expect(hitTestBoxAction(box, 96, 48, 2)).toBe('e');
    expect(hitTestBoxAction(box, 64, 48, 2)).toBe('move');
    expect(hitTestBoxAction(box, 140, 140, 2)).toBeNull();

    // Resizing southeast handle with 16px snap
    const resizedSnap = resizeBoxWithHandle(box, 'se', 110, 88, 256, 128, 16, 8, false);
    expect(resizedSnap).toEqual({ x: 32, y: 32, w: 80, h: 64 });

    // Resizing southeast handle with aspect ratio lock (2:1 original ratio)
    const resizedAspect = resizeBoxWithHandle(box, 'se', 160, 60, 256, 128, 1, 8, true);
    expect(resizedAspect.w).toBe(128);
    expect(resizedAspect.h).toBe(64);

    // Non-overlapping placement across occupied layer boxes + occupied base tiles
    const existingLayers = [
      { x: 0, y: 0, w: 32, h: 96 }, // occupies col 0, rows 0..2
      { x: 32, y: 0, w: 32, h: 32 }, // occupies col 1, row 0
    ];
    // Mark col 2, row 0 base tile as occupied too
    const nextSlot = findOpenSlotForOutputBox(
      existingLayers,
      4,
      3,
      32,
      32,
      32,
      (c, r) => c === 2 && r === 0,
    );
    expect(nextSlot).toEqual({ x: 96, y: 0, requiredRows: 3 });

    // Full sheet forces row expansion below existing bottom row
    const fullRowOccupied = [{ x: 0, y: 0, w: 128, h: 64 }];
    const expandedSlot = findOpenSlotForOutputBox(fullRowOccupied, 4, 2, 32, 64, 32);
    expect(expandedSlot).toEqual({ x: 0, y: 64, requiredRows: 3 });
  });

  it('parses ASCII pixel art grids and applies macro stamps cleanly to world maps', () => {
    const parsed = parseAsciiPatternToGrid(
      ['.R.', 'RGR', '.R.'],
      { R: '#c2272d', G: '#3c6e47' },
    );
    expect(parsed.gridWidth).toBe(3);
    expect(parsed.gridHeight).toBe(3);
    expect(parsed.palette).toEqual(['#c2272d', '#3c6e47']);
    expect(parsed.grid).toEqual([-1, 0, -1, 0, 1, 0, -1, 0, -1]);

    const blankMap = createBlankWorldMap('Stamp Test', 12, 10);
    const stamp = createMacroStampFromIndices('Diamond', 2, 2, [10, 11, 12, 13], 'obj0', true);
    const stamped = applyMacroStampToMap(blankMap, stamp, 4, 5);
    expect(stamped.objectTiles[0][4][5]).toBe(10);
    expect(stamped.objectTiles[0][5][5]).toBe(11);
    expect(stamped.objectTiles[0][4][6]).toBe(12);
    expect(stamped.objectTiles[0][5][6]).toBe(13);
    expect(stamped.collisionGrid[4][5]).toBe(true);
    expect(stamped.collisionGrid[5][6]).toBe(true);
  });

  it('auto-slices colorful motifs inside closed outline maps without merging into full-page boxes', () => {
    const w = 240;
    const h = 180;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      buf[o] = 250;
      buf[o + 1] = 248;
      buf[o + 2] = 242;
      buf[o + 3] = 255;
    }

    // Draw closed 2px grey border around entire interior (simulates map border that blocked removeEdgeBackground)
    for (let x = 10; x <= 230; x++) {
      for (const y of [10, 11, 168, 169]) {
        const o = (y * w + x) * 4;
        buf[o] = 192;
        buf[o + 1] = 192;
        buf[o + 2] = 190;
      }
    }
    for (let y = 10; y < 170; y++) {
      for (const x of [10, 11, 229, 230]) {
        const o = (y * w + x) * 4;
        buf[o] = 192;
        buf[o + 1] = 192;
        buf[o + 2] = 190;
      }
    }

    const paintBlock = (bx: number, by: number, bw: number, bh: number, r: number, g: number, b: number) => {
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const o = (y * w + x) * 4;
          buf[o] = r;
          buf[o + 1] = g;
          buf[o + 2] = b;
        }
      }
    };

    // 3 distinct motifs inside the closed outline with varied aspect ratios
    paintBlock(28, 28, 28, 28, 190, 30, 45); // Square crimson
    paintBlock(110, 26, 72, 22, 34, 139, 74); // Wide emerald border banner
    paintBlock(130, 88, 26, 60, 30, 64, 175); // Tall sapphire emblem

    const imgData = { width: w, height: h, data: buf } as ImageData;
    const regions = detectSalientMotifRegions(imgData, {
      minSize: 12,
      mergeGap: 4,
      bgTolerance: 28,
    });

    // Must isolate individual motifs inside the closed map outline (not one 220x160 full-page box)
    expect(regions.length).toBeGreaterThanOrEqual(3);
    expect(regions.every((r) => r.w < 140 && r.h < 120)).toBe(true);
    expect(regions.some((r) => r.w > r.h * 2)).toBe(true); // Wide banner preserved
    expect(regions.some((r) => r.h > r.w * 1.6)).toBe(true); // Tall emblem preserved

    const seeds = computeSalientSeedPoints(imgData, 12);
    expect(seeds.length).toBeGreaterThan(0);
    // Seeds must avoid outer cream paper corner (0,0)
    expect(seeds.every((s) => s.x >= 8 && s.y >= 8)).toBe(true);
  });

  it('preserves crop aspect ratios, deduplicates overlapping masks with NMS, and exposes AI segmentation presets', () => {
    const square = computeAspectPreservingFootprint(64, 64, 4, 4, 32, 16);
    expect(square.outCols).toBe(square.outRows);
    expect(square.gridWidth).toBe(square.gridHeight);

    const wide = computeAspectPreservingFootprint(160, 40, 4, 4, 32, 16);
    expect(wide.outCols).toBe(4);
    expect(wide.outRows).toBe(1);
    expect(wide.gridWidth / wide.gridHeight).toBe(4);

    const tall = computeAspectPreservingFootprint(36, 120, 4, 4, 32, 16);
    expect(tall.outRows).toBeGreaterThan(tall.outCols);
    expect(tall.gridHeight).toBeGreaterThan(tall.gridWidth);

    const mw = 40;
    const mh = 40;
    const maskA = new Uint8Array(mw * mh);
    const maskB = new Uint8Array(mw * mh);
    const maskC = new Uint8Array(mw * mh);
    for (let y = 4; y < 16; y++) {
      for (let x = 4; x < 16; x++) {
        maskA[y * mw + x] = 255;
        maskB[y * mw + x] = 255; // exact duplicate overlap
      }
    }
    for (let y = 22; y < 34; y++) {
      for (let x = 22; x < 34; x++) {
        maskC[y * mw + x] = 255;
      }
    }

    const deduped = filterMaskCandidatesNMS(
      [
        { crop: { x: 4, y: 4, w: 12, h: 12 }, mask: maskA, score: 0.92, label: 'Motif A' },
        { crop: { x: 4, y: 4, w: 12, h: 12 }, mask: maskB, score: 0.71, label: 'Dup A' },
        { crop: { x: 22, y: 22, w: 12, h: 12 }, mask: maskC, score: 0.85, label: 'Motif C' },
      ],
      mw,
      mh,
      0.55,
      6,
    );
    expect(deduped).toHaveLength(2);
    expect(deduped.map((d) => d.label)).toEqual(['Motif A', 'Motif C']);

    const mergedMatte = new Uint8Array(mw * mh);
    for (let i = 0; i < mw * mh; i++) {
      mergedMatte[i] = Math.max(maskA[i], maskC[i]);
    }
    const extracted = extractRegionsFromMatte(mergedMatte, mw, mh, {
      minSize: 6,
      mergeGap: 2,
      matteThreshold: 112,
    });
    expect(extracted).toHaveLength(2);
    expect(extracted[0].crop).toEqual({ x: 4, y: 4, w: 12, h: 12 });
    expect(extracted[1].crop).toEqual({ x: 22, y: 22, w: 12, h: 12 });

    expect(SEGMENTATION_MODEL_PRESETS.map((p) => p.id)).toEqual([
      'contrast-fast',
      'edgetam',
      'sam2-tiny',
      'sam3-tracker',
      'grounding-dino',
      'yolos-tiny',
      'ormbg',
    ]);
    expect(SEGMENTATION_MODEL_PRESETS.find((p) => p.id === 'edgetam')?.supportsClickPrompt).toBe(true);
    expect(SEGMENTATION_MODEL_PRESETS.find((p) => p.id === 'sam3-tracker')?.repoId).toBe(
      'onnx-community/sam3-tracker-ONNX',
    );
  });
});
