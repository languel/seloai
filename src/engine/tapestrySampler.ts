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
