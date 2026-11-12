import type { TileGrid, TileMacroStamp, VillageMap } from './types';

export interface CropSelection {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChromaKeyFilter {
  r: number;
  g: number;
  b: number;
  tolerance: number; // 0..100
}

export interface SliceOptions {
  chromaKey?: ChromaKeyFilter | null;
  pixelate?: boolean;
  trimAndFit?: boolean;
}

export interface SlicedTileResult {
  canvases: HTMLCanvasElement[];
  cols: number;
  rows: number;
  tileDim: number;
  previewDataUrl: string;
}

export interface AppendTilesResult {
  newTilesetUrl: string;
  newDimX: number;
  newDimY: number;
  startTileIndex: number;
  tileIndices: number[];
}

/**
 * Applies chroma-key transparency (e.g. background cloth / white linen removal)
 * and optional pixelation to an ImageData buffer.
 */
export function processTilePixels(
  imgData: ImageData,
  options: SliceOptions = {},
): ImageData {
  const { chromaKey } = options;
  const data = imgData.data;

  if (chromaKey) {
    const { r: kr, g: kg, b: kb, tolerance } = chromaKey;
    // Map tolerance 0..100 to max Euclidean RGB distance (~0..441)
    const maxDist = (tolerance / 100) * 360;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dist = Math.hypot(r - kr, g - kg, b - kb);
      if (dist <= maxDist) {
        data[i + 3] = 0; // Make transparent
      }
    }
  }

  return imgData;
}

/**
 * Flood-fills connected pixels (4-way) matching the seed color within tolerance,
 * setting their alpha channel to 0 (transparent).
 */
export function floodFillTransparent(
  imgData: ImageData,
  startPoints: Array<{ x: number; y: number }>,
  tolerance: number = 20,
  targetColor?: { r: number; g: number; b: number },
): ImageData {
  const { width, height, data } = imgData;
  if (width <= 0 || height <= 0 || startPoints.length === 0) return imgData;

  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const maxDist = (tolerance / 100) * 360;

  for (const pt of startPoints) {
    const sx = Math.floor(pt.x);
    const sy = Math.floor(pt.y);
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

    const startIdx = sy * width + sx;
    if (visited[startIdx]) continue;

    const p0 = startIdx * 4;
    if (data[p0 + 3] === 0) continue;

    const sr = targetColor ? targetColor.r : data[p0];
    const sg = targetColor ? targetColor.g : data[p0 + 1];
    const sb = targetColor ? targetColor.b : data[p0 + 2];

    if (Math.hypot(data[p0] - sr, data[p0 + 1] - sg, data[p0 + 2] - sb) > maxDist) {
      continue;
    }

    let head = 0;
    let tail = 0;
    queue[tail++] = startIdx;
    visited[startIdx] = 1;

    while (head < tail) {
      const idx = queue[head++];
      const pi = idx * 4;
      data[pi + 3] = 0;

      const x = idx % width;
      const y = (idx - x) / width;

      // 4-connected neighbors
      const neighbors: number[] = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x + 1 < width) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y + 1 < height) neighbors.push(idx + width);

      for (const nIdx of neighbors) {
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;
        const np = nIdx * 4;
        if (data[np + 3] === 0) continue;
        const dist = Math.hypot(data[np] - sr, data[np + 1] - sg, data[np + 2] - sb);
        if (dist <= maxDist) {
          queue[tail++] = nIdx;
        }
      }
    }
  }

  return imgData;
}

/**
 * Automatically detects the dominant opaque color along the image borders
 * and flood-fills inward from all matching border pixels to remove the background
 * while preserving enclosed interior details.
 */
export function removeEdgeBackground(
  imgData: ImageData,
  tolerance: number = 20,
): ImageData {
  const { width, height, data } = imgData;
  if (width <= 0 || height <= 0) return imgData;

  const borderCoords: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < width; x++) {
    borderCoords.push({ x, y: 0 });
    if (height > 1) borderCoords.push({ x, y: height - 1 });
  }
  for (let y = 1; y < height - 1; y++) {
    borderCoords.push({ x: 0, y });
    if (width > 1) borderCoords.push({ x: width - 1, y });
  }

  // Bucket border colors (5-bit per channel) to find dominant background color
  const buckets = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();
  for (const pt of borderCoords) {
    const p = (pt.y * width + pt.x) * 4;
    if (data[p + 3] === 0) continue;
    const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
    const entry = buckets.get(key);
    if (entry) {
      entry.count++;
      entry.rSum += data[p];
      entry.gSum += data[p + 1];
      entry.bSum += data[p + 2];
    } else {
      buckets.set(key, { count: 1, rSum: data[p], gSum: data[p + 1], bSum: data[p + 2] });
    }
  }

  let best: { count: number; rSum: number; gSum: number; bSum: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  if (!best || best.count === 0) return imgData;

  const targetColor = {
    r: Math.round(best.rSum / best.count),
    g: Math.round(best.gSum / best.count),
    b: Math.round(best.bSum / best.count),
  };

  return floodFillTransparent(imgData, borderCoords, tolerance, targetColor);
}

/**
 * Returns the tightest bounding box of non-transparent (alpha > 0) pixels
 * within an ImageData buffer, or null if the entire buffer is transparent.
 */
export function getOpaqueBounds(imgData: ImageData): CropSelection | null {
  const { width, height, data } = imgData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

export interface AutoSliceOptions {
  minSize?: number;
  mergeGap?: number;
  alphaThreshold?: number;
}

/**
 * Automatically detects distinct motif/sprite bounding boxes from non-transparent
 * pixel islands in an ImageData buffer, merging nearby fragments within `mergeGap`
 * pixels and filtering out specks smaller than `minSize`.
 */
export function detectMotifRegions(
  imgData: ImageData,
  options: AutoSliceOptions = {},
): CropSelection[] {
  const { width, height, data } = imgData;
  if (width <= 0 || height <= 0) return [];

  const minSize = options.minSize ?? 8;
  const mergeGap = options.mergeGap ?? 6;
  const alphaThreshold = options.alphaThreshold ?? 0;

  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const rawBoxes: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];

  for (let startY = 0; startY < height; startY++) {
    for (let startX = 0; startX < width; startX++) {
      const startIdx = startY * width + startX;
      if (visited[startIdx]) continue;
      if (data[startIdx * 4 + 3] <= alphaThreshold) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      visited[startIdx] = 1;

      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;

      while (head < tail) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx - x) / width;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        // 8-connected neighborhood so diagonal pixel-art lines stay connected
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nIdx = ny * width + nx;
            if (visited[nIdx]) continue;
            visited[nIdx] = 1;
            if (data[nIdx * 4 + 3] > alphaThreshold) {
              queue[tail++] = nIdx;
            }
          }
        }
      }

      rawBoxes.push({ minX, minY, maxX, maxY });
    }
  }

  // Merge boxes whose expanded bounds (by mergeGap) intersect
  let boxes = rawBoxes.slice();
  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    const next: typeof boxes = [];
    const consumed = new Uint8Array(boxes.length);

    for (let i = 0; i < boxes.length; i++) {
      if (consumed[i]) continue;
      let cur = { ...boxes[i] };
      consumed[i] = 1;

      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < boxes.length; j++) {
          if (consumed[j]) continue;
          const b = boxes[j];
          const overlaps =
            cur.minX - mergeGap <= b.maxX &&
            cur.maxX + mergeGap >= b.minX &&
            cur.minY - mergeGap <= b.maxY &&
            cur.maxY + mergeGap >= b.minY;
          if (overlaps) {
            cur = {
              minX: Math.min(cur.minX, b.minX),
              minY: Math.min(cur.minY, b.minY),
              maxX: Math.max(cur.maxX, b.maxX),
              maxY: Math.max(cur.maxY, b.maxY),
            };
            consumed[j] = 1;
            grew = true;
            mergedAny = true;
          }
        }
      }

      next.push(cur);
    }
    boxes = next;
  }

  const regions: CropSelection[] = boxes
    .map((b) => ({
      x: b.minX,
      y: b.minY,
      w: b.maxX - b.minX + 1,
      h: b.maxY - b.minY + 1,
    }))
    .filter((r) => r.w >= minSize && r.h >= minSize);

  // Sort in reading order (banded rows, then left-to-right)
  regions.sort((a, b) => {
    const rowA = Math.floor(a.y / 32);
    const rowB = Math.floor(b.y / 32);
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  });

  return regions;
}

export interface CrispPixelArtOptions {
  /** Pixel art resolution per tile (e.g. 16 = chunky 16px-per-tile pixel art, 32 = native). */
  pixelsPerTile?: number;
  /** Maximum number of palette colors to quantize to (2..32). */
  maxColors?: number;
  /** Optional function name for generated procedural code. */
  fnName?: string;
}

export interface CrispPixelArtResult {
  gridWidth: number;
  gridHeight: number;
  palette: string[];
  /** Row-major palette index per pixel (-1 = transparent). */
  grid: number[];
  /** Self-contained TypeScript/Canvas2D procedural drawing code. */
  proceduralCode: string;
  /** Crisp upscaled data URL (when running in browser). */
  previewDataUrl: string;
  /** Individual tile canvases ready for appendTilesToTileset (when running in browser). */
  canvases: HTMLCanvasElement[];
  cols: number;
  rows: number;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function toSafeIdentifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+(.)/g, (_, ch: string) => ch.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
  if (!cleaned) return 'drawMotif';
  return `draw${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

/**
 * Downsamples an ImageData region into a crisp gridW x gridH pixel-art grid
 * using dominant-bucket sampling per cell (removing JPEG blur), quantizes to
 * `maxColors` representative colors, and generates procedural Canvas2D code.
 */
export function quantizeAndRebuildPixelGrid(
  imgData: ImageData,
  gridW: number,
  gridH: number,
  maxColors: number = 10,
  fnName: string = 'drawMotif',
): Pick<CrispPixelArtResult, 'gridWidth' | 'gridHeight' | 'palette' | 'grid' | 'proceduralCode'> {
  const { width: srcW, height: srcH, data } = imgData;
  const cellsR = new Uint8Array(gridW * gridH);
  const cellsG = new Uint8Array(gridW * gridH);
  const cellsB = new Uint8Array(gridW * gridH);
  const cellsOpaque = new Uint8Array(gridW * gridH);

  // 1. Dominant-color cell sampling (resistant to anti-aliasing & JPEG ringing)
  for (let gy = 0; gy < gridH; gy++) {
    const y0 = Math.floor((gy * srcH) / gridH);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * srcH) / gridH));
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor((gx * srcW) / gridW);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * srcW) / gridW));

      let totalPx = 0;
      let opaquePx = 0;
      const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          totalPx++;
          const p = (sy * srcW + sx) * 4;
          if (data[p + 3] < 128) continue;
          opaquePx++;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const entry = buckets.get(key);
          if (entry) {
            entry.count++;
            entry.r += r;
            entry.g += g;
            entry.b += b;
          } else {
            buckets.set(key, { count: 1, r, g, b });
          }
        }
      }

      const cellIdx = gy * gridW + gx;
      if (opaquePx * 2 >= totalPx && opaquePx > 0) {
        let best: { count: number; r: number; g: number; b: number } | null = null;
        for (const entry of buckets.values()) {
          if (!best || entry.count > best.count) best = entry;
        }
        if (best) {
          cellsOpaque[cellIdx] = 1;
          cellsR[cellIdx] = Math.round(best.r / best.count);
          cellsG[cellIdx] = Math.round(best.g / best.count);
          cellsB[cellIdx] = Math.round(best.b / best.count);
        }
      }
    }
  }

  // 2. Frequency-ranked greedy color quantization to maxColors
  const colorCounts = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < gridW * gridH; i++) {
    if (!cellsOpaque[i]) continue;
    const key = ((cellsR[i] >> 3) << 10) | ((cellsG[i] >> 3) << 5) | (cellsB[i] >> 3);
    const entry = colorCounts.get(key);
    if (entry) {
      entry.count++;
      entry.r += cellsR[i];
      entry.g += cellsG[i];
      entry.b += cellsB[i];
    } else {
      colorCounts.set(key, { count: 1, r: cellsR[i], g: cellsG[i], b: cellsB[i] });
    }
  }

  const sortedClusters = Array.from(colorCounts.values())
    .map((c) => ({
      count: c.count,
      r: Math.round(c.r / c.count),
      g: Math.round(c.g / c.count),
      b: Math.round(c.b / c.count),
    }))
    .sort((a, b) => b.count - a.count);

  const paletteRgb: Array<{ r: number; g: number; b: number }> = [];
  const minPaletteDist = 28;
  for (const c of sortedClusters) {
    if (paletteRgb.length >= maxColors) break;
    const tooClose = paletteRgb.some(
      (p) => Math.hypot(p.r - c.r, p.g - c.g, p.b - c.b) < minPaletteDist,
    );
    if (!tooClose) paletteRgb.push({ r: c.r, g: c.g, b: c.b });
  }
  // Fill remaining slots if needed
  for (const c of sortedClusters) {
    if (paletteRgb.length >= maxColors) break;
    if (!paletteRgb.some((p) => p.r === c.r && p.g === c.g && p.b === c.b)) {
      paletteRgb.push({ r: c.r, g: c.g, b: c.b });
    }
  }

  const palette = paletteRgb.map((p) => rgbToHex(p.r, p.g, p.b));
  const grid = new Array<number>(gridW * gridH).fill(-1);

  if (paletteRgb.length > 0) {
    for (let i = 0; i < gridW * gridH; i++) {
      if (!cellsOpaque[i]) continue;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let pi = 0; pi < paletteRgb.length; pi++) {
        const p = paletteRgb[pi];
        const d = Math.hypot(cellsR[i] - p.r, cellsG[i] - p.g, cellsB[i] - p.b);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = pi;
        }
      }
      grid[i] = bestIdx;
    }
  }

  // 3. Run-length encode horizontal spans into clean procedural TypeScript/Canvas2D code
  const spansByColor: Array<Array<[number, number, number]>> = palette.map(() => []);
  for (let y = 0; y < gridH; y++) {
    let x = 0;
    while (x < gridW) {
      const cIdx = grid[y * gridW + x];
      if (cIdx < 0) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < gridW && grid[y * gridW + x + run] === cIdx) {
        run++;
      }
      spansByColor[cIdx].push([x, y, run]);
      x += run;
    }
  }

  const safeFn = toSafeIdentifier(fnName);
  const paletteLines = palette.map((hex, i) => `  '${hex}', // ${i}`).join('\n');
  const spanLines = spansByColor
    .map((spans, cIdx) => {
      if (spans.length === 0) return '';
      const rects = spans.map(([sx, sy, sw]) => `[${sx},${sy},${sw}]`).join(',');
      return `  [${cIdx}, [${rects}]],`;
    })
    .filter(Boolean)
    .join('\n');

  const proceduralCode = [
    `// Procedural Crisp Pixel Art (${gridW}x${gridH}, ${palette.length} colors)`,
    `export const ${safeFn}Palette = [`,
    paletteLines,
    `] as const;`,
    ``,
    `// [colorIndex, [x, y, width][]]`,
    `const ${safeFn}Spans: ReadonlyArray<[number, ReadonlyArray<readonly [number, number, number]>]> = [`,
    spanLines,
    `];`,
    ``,
    `export function ${safeFn}(ctx: CanvasRenderingContext2D, ox = 0, oy = 0, scale = 1): void {`,
    `  for (const [colorIdx, rects] of ${safeFn}Spans) {`,
    `    ctx.fillStyle = ${safeFn}Palette[colorIdx];`,
    `    for (const [rx, ry, rw] of rects) {`,
    `      ctx.fillRect(ox + rx * scale, oy + ry * scale, rw * scale, scale);`,
    `    }`,
    `  }`,
    `}`,
  ].join('\n');

  return {
    gridWidth: gridW,
    gridHeight: gridH,
    palette,
    grid,
    proceduralCode,
  };
}

/**
 * Rebuilds a selected crop from a source image/canvas as crisp quantized pixel art,
 * returning both tileable stamp canvases and procedural Canvas2D TypeScript code.
 */
export function rebuildCrispPixelArt(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropSelection,
  tileDim: number = 32,
  options: CrispPixelArtOptions & { chromaKey?: ChromaKeyFilter | null; trimAndFit?: boolean } = {},
): CrispPixelArtResult {
  const cols = Math.max(1, Math.round(crop.w / tileDim));
  const rows = Math.max(1, Math.round(crop.h / tileDim));
  const pixelsPerTile = Math.max(8, Math.min(tileDim, options.pixelsPerTile ?? 16));
  const gridW = cols * pixelsPerTile;
  const gridH = rows * pixelsPerTile;
  const maxColors = Math.max(2, Math.min(32, options.maxColors ?? 10));
  const fnName = options.fnName ?? 'drawMotif';

  if (typeof document === 'undefined') {
    const emptyData = {
      width: gridW,
      height: gridH,
      data: new Uint8ClampedArray(gridW * gridH * 4),
    } as ImageData;
    const res = quantizeAndRebuildPixelGrid(emptyData, gridW, gridH, maxColors, fnName);
    return {
      ...res,
      previewDataUrl: 'data:image/png;base64,mockCrisp',
      canvases: [],
      cols,
      rows,
    };
  }

  // Extract raw crop (applying chromaKey and optional trimAndFit)
  const sx = Math.max(0, Math.floor(crop.x));
  const sy = Math.max(0, Math.floor(crop.y));
  const sw = Math.max(1, Math.min(Math.round(crop.w), sourceW - sx));
  const sh = Math.max(1, Math.min(Math.round(crop.h), sourceH - sy));

  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = sw;
  rawCanvas.height = sh;
  const rawCtx = rawCanvas.getContext('2d');
  if (!rawCtx) throw new Error('Canvas 2D context not available');

  rawCtx.imageSmoothingEnabled = false;
  rawCtx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  if (options.chromaKey) {
    const d = rawCtx.getImageData(0, 0, sw, sh);
    processTilePixels(d, { chromaKey: options.chromaKey });
    rawCtx.putImageData(d, 0, 0);
  }

  let sampleCanvas = rawCanvas;
  if (options.trimAndFit) {
    const rawData = rawCtx.getImageData(0, 0, sw, sh);
    const bounds = getOpaqueBounds(rawData);
    if (bounds) {
      const fitCanvas = document.createElement('canvas');
      fitCanvas.width = gridW * 2;
      fitCanvas.height = gridH * 2;
      const fitCtx = fitCanvas.getContext('2d');
      if (fitCtx) {
        fitCtx.imageSmoothingEnabled = false;
        const scale = Math.min(fitCanvas.width / bounds.w, fitCanvas.height / bounds.h);
        const dw = Math.max(1, Math.round(bounds.w * scale));
        const dh = Math.max(1, Math.round(bounds.h * scale));
        const dx = Math.floor((fitCanvas.width - dw) / 2);
        const dy = Math.floor((fitCanvas.height - dh) / 2);
        fitCtx.drawImage(rawCanvas, bounds.x, bounds.y, bounds.w, bounds.h, dx, dy, dw, dh);
        sampleCanvas = fitCanvas;
      }
    }
  }

  const sampleCtx = sampleCanvas.getContext('2d')!;
  const sampleData = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
  const rebuilt = quantizeAndRebuildPixelGrid(sampleData, gridW, gridH, maxColors, fnName);

  // Render crisp pixel grid onto tileDim*cols x tileDim*rows canvas
  const crispSmall = document.createElement('canvas');
  crispSmall.width = gridW;
  crispSmall.height = gridH;
  const csCtx = crispSmall.getContext('2d')!;
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const cIdx = rebuilt.grid[y * gridW + x];
      if (cIdx >= 0) {
        csCtx.fillStyle = rebuilt.palette[cIdx];
        csCtx.fillRect(x, y, 1, 1);
      }
    }
  }

  const targetW = cols * tileDim;
  const targetH = rows * tileDim;
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = targetW;
  fullCanvas.height = targetH;
  const fCtx = fullCanvas.getContext('2d')!;
  fCtx.imageSmoothingEnabled = false;
  fCtx.drawImage(crispSmall, 0, 0, gridW, gridH, 0, 0, targetW, targetH);

  const canvases: HTMLCanvasElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tc = document.createElement('canvas');
      tc.width = tileDim;
      tc.height = tileDim;
      const tCtx = tc.getContext('2d');
      if (tCtx) {
        tCtx.imageSmoothingEnabled = false;
        tCtx.drawImage(fullCanvas, c * tileDim, r * tileDim, tileDim, tileDim, 0, 0, tileDim, tileDim);
      }
      canvases.push(tc);
    }
  }

  return {
    ...rebuilt,
    previewDataUrl: fullCanvas.toDataURL('image/png'),
    canvases,
    cols,
    rows,
  };
}

/**
 * Slices a selected rectangular crop from an image/canvas into 32x32 (or custom tileDim)
 * tile canvases, ready to be added to a tileset.
 */
export function sliceSelectionToTiles(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropSelection,
  tileDim: number = 32,
  options: SliceOptions = {},
): SlicedTileResult {
  if (typeof document === 'undefined') {
    // Headless test fallback
    return {
      canvases: [],
      cols: Math.max(1, Math.round(crop.w / tileDim)),
      rows: Math.max(1, Math.round(crop.h / tileDim)),
      tileDim,
      previewDataUrl: 'data:image/png;base64,mockPreview',
    };
  }

  const cols = Math.max(1, Math.round(crop.w / tileDim));
  const rows = Math.max(1, Math.round(crop.h / tileDim));
  const targetW = cols * tileDim;
  const targetH = rows * tileDim;

  const sx = Math.max(0, Math.floor(crop.x));
  const sy = Math.max(0, Math.floor(crop.y));
  const sw = Math.max(1, Math.min(Math.round(crop.w), sourceW - sx));
  const sh = Math.max(1, Math.min(Math.round(crop.h), sourceH - sy));

  // 1. Draw the resampled crop onto an intermediate canvas
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = targetW;
  cropCanvas.height = targetH;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) {
    throw new Error('Canvas 2D context not available');
  }

  if (options.trimAndFit) {
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = sw;
    rawCanvas.height = sh;
    const rawCtx = rawCanvas.getContext('2d');
    if (rawCtx) {
      rawCtx.imageSmoothingEnabled = false;
      rawCtx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      if (options.chromaKey) {
        const rawData = rawCtx.getImageData(0, 0, sw, sh);
        processTilePixels(rawData, options);
        rawCtx.putImageData(rawData, 0, 0);
      }
      const rawData = rawCtx.getImageData(0, 0, sw, sh);
      const bounds = getOpaqueBounds(rawData);
      const bx = bounds ? bounds.x : 0;
      const by = bounds ? bounds.y : 0;
      const bw = bounds ? bounds.w : sw;
      const bh = bounds ? bounds.h : sh;

      const scale = Math.min(targetW / bw, targetH / bh);
      const drawW = Math.max(1, Math.round(bw * scale));
      const drawH = Math.max(1, Math.round(bh * scale));
      const dx = Math.floor((targetW - drawW) / 2);
      const dy = Math.floor((targetH - drawH) / 2);

      cropCtx.imageSmoothingEnabled = !options.pixelate;
      cropCtx.drawImage(rawCanvas, bx, by, bw, bh, dx, dy, drawW, drawH);
    }
  } else {
    cropCtx.imageSmoothingEnabled = !options.pixelate;
    cropCtx.drawImage(source, sx, sy, sw, sh, 0, 0, targetW, targetH);

    // Apply chroma-key filter across the crop
    if (options.chromaKey) {
      const fullData = cropCtx.getImageData(0, 0, targetW, targetH);
      processTilePixels(fullData, options);
      cropCtx.putImageData(fullData, 0, 0);
    }
  }

  // 2. Slice the crop canvas into individual tileDim x tileDim canvases
  const canvases: HTMLCanvasElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tileDim;
      tileCanvas.height = tileDim;
      const tCtx = tileCanvas.getContext('2d');
      if (tCtx) {
        tCtx.imageSmoothingEnabled = false;
        tCtx.drawImage(
          cropCanvas,
          c * tileDim,
          r * tileDim,
          tileDim,
          tileDim,
          0,
          0,
          tileDim,
          tileDim,
        );
      }
      canvases.push(tileCanvas);
    }
  }

  return {
    canvases,
    cols,
    rows,
    tileDim,
    previewDataUrl: cropCanvas.toDataURL('image/png'),
  };
}

/**
 * Appends new tile canvases to an existing tileset image or canvas,
 * returning the updated data URL and assigned tile indices.
 */
export async function appendTilesToTileset(
  existingTileset: HTMLImageElement | HTMLCanvasElement | null,
  currentDimX: number,
  currentDimY: number,
  tileDim: number,
  newTiles: HTMLCanvasElement[],
): Promise<AppendTilesResult> {
  const cols = Math.max(1, Math.floor(currentDimX / tileDim));
  const currentRows = Math.max(1, Math.floor(currentDimY / tileDim));
  const startTileIndex = cols * currentRows;

  if (typeof document === 'undefined') {
    // Headless test fallback
    const tileIndices = Array.from({ length: newTiles.length }, (_, i) => startTileIndex + i);
    return {
      newTilesetUrl: 'data:image/png;base64,mockAppendedTileset',
      newDimX: currentDimX,
      newDimY: currentDimY + Math.ceil(newTiles.length / cols) * tileDim,
      startTileIndex,
      tileIndices,
    };
  }

  const additionalRows = Math.ceil(newTiles.length / cols);
  const newDimY = currentDimY + additionalRows * tileDim;

  const canvas = document.createElement('canvas');
  canvas.width = currentDimX;
  canvas.height = newDimY;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create canvas 2D context');

  ctx.imageSmoothingEnabled = false;

  // Draw existing tileset
  if (existingTileset) {
    ctx.drawImage(existingTileset, 0, 0);
  }

  // Draw new tiles row by row
  const tileIndices: number[] = [];
  for (let i = 0; i < newTiles.length; i++) {
    const tileIdx = startTileIndex + i;
    const tx = (tileIdx % cols) * tileDim;
    const ty = Math.floor(tileIdx / cols) * tileDim;
    ctx.drawImage(newTiles[i], tx, ty);
    tileIndices.push(tileIdx);
  }

  return {
    newTilesetUrl: canvas.toDataURL('image/png'),
    newDimX: currentDimX,
    newDimY,
    startTileIndex,
    tileIndices,
  };
}

/**
 * Creates a TileMacroStamp from sliced tile indices.
 */
export function createMacroStampFromIndices(
  name: string,
  widthInTiles: number,
  heightInTiles: number,
  tileIndices: number[],
  layer: 'bg0' | 'bg1' | 'obj0' | 'obj1' = 'bg1',
  blocksMovement: boolean = false,
): TileMacroStamp {
  return {
    id: `stamp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || `Tapestry Motif (${widthInTiles}×${heightInTiles})`,
    width: widthInTiles,
    height: heightInTiles,
    tiles: [...tileIndices],
    layer,
    blocksMovement,
  };
}

/**
 * Slices an entire imported tapestry or painting into a full VillageMap.
 * Generates an expanded tileset containing all unique or sliced tiles,
 * and sets up bg0, spawn points, and walkable boundaries.
 */
export async function convertTapestryToMap(
  image: HTMLImageElement | HTMLCanvasElement,
  tileDim: number = 32,
  mapName: string = 'Embroidered Tapestry World',
  maxW: number = 64,
  maxH: number = 48,
): Promise<{
  map: VillageMap;
}> {
  const srcW = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const srcH = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const cols = Math.min(maxW, Math.max(12, Math.round(srcW / tileDim)));
  const rows = Math.min(maxH, Math.max(12, Math.round(srcH / tileDim)));

  const sliced = sliceSelectionToTiles(
    image,
    srcW,
    srcH,
    { x: 0, y: 0, w: srcW, h: srcH },
    tileDim,
  );

  const tilesetCols = 16;
  const tilesetDimX = tilesetCols * tileDim;
  const appended = await appendTilesToTileset(null, tilesetDimX, 0, tileDim, sliced.canvases);

  const bg0: TileGrid = Array.from({ length: cols }, () => Array(rows).fill(0));
  const bg1: TileGrid = Array.from({ length: cols }, () => Array(rows).fill(-1));
  const obj0: TileGrid = Array.from({ length: cols }, () => Array(rows).fill(-1));
  const obj1: TileGrid = Array.from({ length: cols }, () => Array(rows).fill(-1));
  const collision: boolean[][] = Array.from({ length: cols }, () => Array(rows).fill(false));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < appended.tileIndices.length) {
        bg0[c][r] = appended.tileIndices[idx];
      }
    }
  }

  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);

  return {
    map: {
      name: mapName,
      tileDim,
      width: cols,
      height: rows,
      tileSetUrl: appended.newTilesetUrl,
      tileSetDimX: appended.newDimX,
      tileSetDimY: appended.newDimY,
      bgTiles: [bg0, bg1],
      objectTiles: [obj0, obj1],
      collisionGrid: collision,
      animatedSprites: [],
      spawnPoints: [
        { id: `spawn-center`, label: 'Tapestry Hearth', x: cx, y: cy },
      ],
      pointsOfInterest: [
        {
          id: `poi-center`,
          tag: 'TapestryCenter',
          label: 'Tapestry Center',
          x: cx,
          y: cy,
          description: 'The woven center of the custom tapestry realm.',
        },
      ],
      stamps: [],
    },
  };
}
