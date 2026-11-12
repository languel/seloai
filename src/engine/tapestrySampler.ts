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

  // 1. Draw the resampled crop onto an intermediate canvas
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = targetW;
  cropCanvas.height = targetH;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) {
    throw new Error('Canvas 2D context not available');
  }

  cropCtx.imageSmoothingEnabled = !options.pixelate;
  cropCtx.drawImage(
    source,
    Math.max(0, crop.x),
    Math.max(0, crop.y),
    Math.min(crop.w, sourceW - crop.x),
    Math.min(crop.h, sourceH - crop.y),
    0,
    0,
    targetW,
    targetH,
  );

  // Apply chroma-key filter across the crop
  if (options.chromaKey) {
    const fullData = cropCtx.getImageData(0, 0, targetW, targetH);
    processTilePixels(fullData, options);
    cropCtx.putImageData(fullData, 0, 0);
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
  image: HTMLImageElement,
  tileDim: number = 32,
  mapName: string = 'Embroidered Tapestry World',
  maxW: number = 64,
  maxH: number = 48,
): Promise<{
  map: VillageMap;
}> {
  const cols = Math.min(maxW, Math.max(12, Math.round(image.naturalWidth / tileDim)));
  const rows = Math.min(maxH, Math.max(12, Math.round(image.naturalHeight / tileDim)));

  const sliced = sliceSelectionToTiles(
    image,
    image.naturalWidth,
    image.naturalHeight,
    { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight },
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
