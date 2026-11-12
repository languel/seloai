import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Grid,
  Hand,
  Maximize2,
  Palette,
  Pipette,
  Plus,
  Sparkles,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  appendTilesToTileset,
  convertTapestryToMap,
  createMacroStampFromIndices,
  sliceSelectionToTiles,
  type ChromaKeyFilter,
  type CropSelection,
} from '../engine/tapestrySampler';
import type { TileMacroStamp, VillageMap } from '../engine/types';
import { resolvePublicUrl } from '../utils/assetUrl';

interface TapestryStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  tileDim: number;
  currentTilesetUrl: string;
  currentTilesetDimX: number;
  currentTilesetDimY: number;
  onAddTilesAndStamp: (payload: {
    tilesetUrl: string;
    tilesetDimX: number;
    tilesetDimY: number;
    stamp: TileMacroStamp;
    tileIndices: number[];
    widthInTiles: number;
    heightInTiles: number;
    directPlace?: boolean;
    targetLayer?: 'bg0' | 'bg1' | 'obj0' | 'obj1';
  }) => void;
  onApplyWholeMap?: (newMap: VillageMap) => void;
}

export const TapestryStudioModal: React.FC<TapestryStudioModalProps> = ({
  isOpen,
  onClose,
  tileDim,
  currentTilesetUrl,
  currentTilesetDimX,
  currentTilesetDimY,
  onAddTilesAndStamp,
  onApplyWholeMap,
}) => {
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);
  const [imgSrcUrl, setImgSrcUrl] = useState<string>('');
  const [imgWidth, setImgWidth] = useState(0);
  const [imgHeight, setImgHeight] = useState(0);

  // Viewport zoom & pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [snapGrid, setSnapGrid] = useState<number>(tileDim);

  // Crop selection on source image
  const [crop, setCrop] = useState<CropSelection>({ x: 0, y: 0, w: tileDim * 2, h: tileDim * 2 });

  // Pixel Art Processing
  const [pixelate, setPixelate] = useState(true);
  const [enableChroma, setEnableChroma] = useState(false);
  const [chromaHex, setChromaHex] = useState('#ffffff');
  const [chromaTolerance, setChromaTolerance] = useState(20);
  const [pickingColor, setPickingColor] = useState(false);

  // Target Stamp Config
  const [stampName, setStampName] = useState('Tapestry Motif');
  const [targetLayer, setTargetLayer] = useState<'bg0' | 'bg1' | 'obj0' | 'obj1'>('bg1');
  const [blocksMovement, setBlocksMovement] = useState(false);

  // Live preview
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });

  // Load sample on mount if none loaded
  useEffect(() => {
    if (isOpen && !sourceImg && !imgSrcUrl) {
      loadSampleTapestry();
    }
  }, [isOpen]);

  const loadImageUrl = (url: string) => {
    setIsProcessing(true);
    setStatusMsg('Loading image…');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setSourceImg(img);
      setImgSrcUrl(url);
      setImgWidth(img.naturalWidth);
      setImgHeight(img.naturalHeight);
      setPan({ x: 0, y: 0 });
      // Center a default 2x2 or 4x4 crop
      const initialW = Math.min(img.naturalWidth, tileDim * 4);
      const initialH = Math.min(img.naturalHeight, tileDim * 4);
      const startX = Math.floor((img.naturalWidth - initialW) / (2 * tileDim)) * tileDim;
      const startY = Math.floor((img.naturalHeight - initialH) / (2 * tileDim)) * tileDim;
      setCrop({ x: Math.max(0, startX), y: Math.max(0, startY), w: initialW, h: initialH });
      setIsProcessing(false);
      setStatusMsg(null);
    };
    img.onerror = () => {
      setIsProcessing(false);
      setStatusMsg('Failed to load image.');
    };
    img.src = resolvePublicUrl(url);
  };

  const loadSampleTapestry = () => {
    loadImageUrl('/assets/shevitsa-sample.jpg');
    setStampName('Bulgarian Shevitsa');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      loadImageUrl(String(reader.result));
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setStampName(cleanName || 'Custom Motif');
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            loadImageUrl(String(reader.result));
            setStampName('Pasted Tapestry');
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    }
  };

  // Convert hex color to RGB
  const getChromaFilter = (): ChromaKeyFilter | null => {
    if (!enableChroma) return null;
    const hex = chromaHex.replace('#', '');
    const num = parseInt(hex, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      tolerance: chromaTolerance,
    };
  };

  // Update selection preview whenever crop or filters change
  useEffect(() => {
    if (!sourceImg || crop.w <= 0 || crop.h <= 0) return;
    try {
      const sliced = sliceSelectionToTiles(
        sourceImg,
        imgWidth,
        imgHeight,
        crop,
        tileDim,
        {
          pixelate,
          chromaKey: getChromaFilter(),
        },
      );
      setPreviewUrl(sliced.previewDataUrl);
    } catch {
      // ignore
    }
  }, [sourceImg, crop, pixelate, enableChroma, chromaHex, chromaTolerance, tileDim, imgWidth, imgHeight]);

  // Render the image viewport canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImg || imgWidth <= 0 || imgHeight <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    ctx.save();
    ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-imgWidth / 2, -imgHeight / 2);

    // Draw source image
    ctx.drawImage(sourceImg, 0, 0, imgWidth, imgHeight);

    // Draw grid overlay
    if (showGrid && snapGrid > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      for (let x = 0; x <= imgWidth; x += snapGrid) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, imgHeight);
      }
      for (let y = 0; y <= imgHeight; y += snapGrid) {
        ctx.moveTo(0, y);
        ctx.lineTo(imgWidth, y);
      }
      ctx.stroke();
    }

    // Draw active crop rectangle
    if (crop.w > 0 && crop.h > 0) {
      // Dim outside selection
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      // Top
      ctx.fillRect(0, 0, imgWidth, crop.y);
      // Bottom
      ctx.fillRect(0, crop.y + crop.h, imgWidth, imgHeight - (crop.y + crop.h));
      // Left
      ctx.fillRect(0, crop.y, crop.x, crop.h);
      // Right
      ctx.fillRect(crop.x + crop.w, crop.y, imgWidth - (crop.x + crop.w), crop.h);

      // Selection border (animated marching / high contrast)
      ctx.strokeStyle = '#be1e2d';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.setLineDash([]);

      // Tile slice subdivisions within the crop
      const cols = Math.max(1, Math.round(crop.w / tileDim));
      const rows = Math.max(1, Math.round(crop.h / tileDim));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      for (let c = 1; c < cols; c++) {
        const sx = crop.x + c * (crop.w / cols);
        ctx.moveTo(sx, crop.y);
        ctx.lineTo(sx, crop.y + crop.h);
      }
      for (let r = 1; r < rows; r++) {
        const sy = crop.y + r * (crop.h / rows);
        ctx.moveTo(crop.x, sy);
        ctx.lineTo(crop.x + crop.w, sy);
      }
      ctx.stroke();
    }

    ctx.restore();
  }, [sourceImg, imgWidth, imgHeight, zoom, pan, showGrid, snapGrid, crop, tileDim]);

  // Convert canvas pointer coordinates to image pixel coordinates
  const canvasToImageCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || imgWidth <= 0 || imgHeight <= 0) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const ox = (cx - (canvas.width / 2 + pan.x)) / zoom + imgWidth / 2;
    const oy = (cy - (canvas.height / 2 + pan.y)) / zoom + imgHeight / 2;

    return {
      x: Math.max(0, Math.min(imgWidth, Math.round(ox))),
      y: Math.max(0, Math.min(imgHeight, Math.round(oy))),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || panMode || e.altKey) {
      // Pan viewport
      isDraggingRef.current = true;
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const { x, y } = canvasToImageCoords(e);

    if (pickingColor && sourceImg) {
      // Eyedropper color picking
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(sourceImg, x, y, 1, 1, 0, 0, 1, 1);
        const p = ctx.getImageData(0, 0, 1, 1).data;
        const hex = `#${((1 << 24) + (p[0] << 16) + (p[1] << 8) + p[2]).toString(16).slice(1)}`;
        setChromaHex(hex);
        setEnableChroma(true);
      }
      setPickingColor(false);
      return;
    }

    // Start box selection
    isDraggingRef.current = true;
    const snap = snapGrid > 0 ? snapGrid : 1;
    const startX = Math.floor(x / snap) * snap;
    const startY = Math.floor(y / snap) * snap;
    dragStartRef.current = { x: startX, y: startY };
    setCrop({ x: startX, y: startY, w: snap, h: snap });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;

    if (panMode || e.buttons === 4 || e.altKey) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    const { x, y } = canvasToImageCoords(e);
    const snap = snapGrid > 0 ? snapGrid : 1;

    const curX = Math.round(x / snap) * snap;
    const curY = Math.round(y / snap) * snap;

    const minX = Math.max(0, Math.min(dragStartRef.current.x, curX));
    const minY = Math.max(0, Math.min(dragStartRef.current.y, curY));
    const maxX = Math.min(imgWidth, Math.max(dragStartRef.current.x, curX));
    const maxY = Math.min(imgHeight, Math.max(dragStartRef.current.y, curY));

    const w = Math.max(snap, maxX - minX);
    const h = Math.max(snap, maxY - minY);

    setCrop({ x: minX, y: minY, w, h });
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const colsInCrop = Math.max(1, Math.round(crop.w / tileDim));
  const rowsInCrop = Math.max(1, Math.round(crop.h / tileDim));
  const totalTilesInCrop = colsInCrop * rowsInCrop;

  const setCropTileSize = (cols: number, rows: number) => {
    const w = cols * tileDim;
    const h = rows * tileDim;
    setCrop((prev) => ({
      x: Math.min(prev.x, Math.max(0, imgWidth - w)),
      y: Math.min(prev.y, Math.max(0, imgHeight - h)),
      w,
      h,
    }));
  };

  // Perform tile slicing and append to active tileset
  const handleAddSelection = async (directPlace: boolean = false) => {
    if (!sourceImg || crop.w <= 0 || crop.h <= 0) return;
    setIsProcessing(true);
    setStatusMsg('Slicing and adding tiles to tileset…');

    try {
      const sliced = sliceSelectionToTiles(
        sourceImg,
        imgWidth,
        imgHeight,
        crop,
        tileDim,
        {
          pixelate,
          chromaKey: getChromaFilter(),
        },
      );

      // Load existing tileset image if available
      let existingImg: HTMLImageElement | null = null;
      if (currentTilesetUrl) {
        existingImg = await new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = resolvePublicUrl(currentTilesetUrl);
        });
      }

      const targetDimX = currentTilesetDimX > 0 ? currentTilesetDimX : 512;
      const targetDimY = currentTilesetDimY > 0 ? currentTilesetDimY : 512;

      const appended = await appendTilesToTileset(
        existingImg,
        targetDimX,
        targetDimY,
        tileDim,
        sliced.canvases,
      );

      const stamp = createMacroStampFromIndices(
        stampName,
        sliced.cols,
        sliced.rows,
        appended.tileIndices,
        targetLayer,
        blocksMovement,
      );

      onAddTilesAndStamp({
        tilesetUrl: appended.newTilesetUrl,
        tilesetDimX: appended.newDimX,
        tilesetDimY: appended.newDimY,
        stamp,
        tileIndices: appended.tileIndices,
        widthInTiles: sliced.cols,
        heightInTiles: sliced.rows,
        directPlace,
        targetLayer,
      });

      setStatusMsg(`Added ${sliced.cols}×${sliced.rows} motif "${stamp.name}" to stamps!`);
      setTimeout(() => {
        setIsProcessing(false);
        onClose();
      }, 700);
    } catch (err: any) {
      setIsProcessing(false);
      setStatusMsg(`Error: ${err?.message || String(err)}`);
    }
  };

  const handleConvertWholeTapestry = async () => {
    if (!sourceImg || !onApplyWholeMap) return;
    setIsProcessing(true);
    setStatusMsg('Converting entire tapestry into a world map…');

    try {
      const res = await convertTapestryToMap(
        sourceImg,
        tileDim,
        `${stampName || 'Embroidered'} Realm`,
        64,
        48,
      );
      onApplyWholeMap(res.map);
      setStatusMsg('Converted tapestry to world map!');
      setTimeout(() => {
        setIsProcessing(false);
        onClose();
      }, 700);
    } catch (err: any) {
      setIsProcessing(false);
      setStatusMsg(`Error: ${err?.message || String(err)}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tapestry & Pixel Art Image Sampler"
      onPaste={handlePaste}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"
    >
      <div className="flex h-[92vh] w-[95vw] max-w-7xl flex-col rounded-sm border border-borderFolk bg-card text-ink shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <header className="flex items-center justify-between border-b border-borderFolk bg-surface px-3 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-crimson" />
            <h2 className="text-sm font-bold">Tapestry &amp; Pixel Art Image Sampler</h2>
            <span className="hidden sm:inline rounded bg-crimson/10 px-1.5 py-0.5 text-[10px] font-semibold text-crimson">
              Turn Paintings &amp; Tapestries into Tilemaps
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Sampler"
              className="rounded p-1 text-muted hover:bg-card hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Studio Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Main Image Viewport Area */}
          <div className="relative flex flex-1 flex-col bg-stone-950 overflow-hidden">
            {/* Viewport Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white shrink-0">
              {/* Import Actions */}
              <div className="flex items-center gap-1.5">
                <label className="inline-flex cursor-pointer items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20">
                  <Upload className="h-3 w-3" />
                  <span>Choose Image</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sr-only"
                    onChange={handleFileUpload}
                  />
                </label>

                <button
                  type="button"
                  onClick={loadSampleTapestry}
                  className="inline-flex items-center gap-1 rounded bg-crimson/80 px-2 py-1 text-[11px] font-medium hover:bg-crimson"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Sample Tapestry</span>
                </button>
              </div>

              {/* Viewport Tools: Pan, Zoom, Grid */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPanMode((p) => !p)}
                  aria-pressed={panMode}
                  title="Hand Tool / Pan Viewport (or hold Alt / Middle Click)"
                  className={`rounded p-1 ${panMode ? 'bg-indigo-600 text-white' : 'hover:bg-white/10 text-white/70'}`}
                >
                  <Hand className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowGrid((g) => !g)}
                  aria-pressed={showGrid}
                  title="Toggle Grid Overlay"
                  className={`rounded p-1 ${showGrid ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-white/50'}`}
                >
                  <Grid className="h-3.5 w-3.5" />
                </button>

                <div className="flex items-center gap-1 border-l border-white/10 pl-1.5">
                  <label htmlFor="snap-grid-select" className="text-[10px] text-white/60">
                    Snap:
                  </label>
                  <select
                    id="snap-grid-select"
                    value={snapGrid}
                    onChange={(e) => setSnapGrid(Number(e.target.value))}
                    className="rounded bg-stone-800 px-1 py-0.5 text-[10px] text-white border border-white/20"
                  >
                    <option value={tileDim}>{tileDim}px (Tile)</option>
                    <option value={16}>16px</option>
                    <option value={64}>64px</option>
                    <option value={1}>1px (Freeform)</option>
                  </select>
                </div>

                <div className="flex items-center gap-0.5 border-l border-white/10 pl-1.5">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
                    className="rounded p-1 hover:bg-white/10"
                    title="Zoom Out"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="px-1 font-mono text-[10px] text-white/80"
                    title="Reset Zoom & Pan"
                  >
                    {zoom}×
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(8, Number((z + 0.5).toFixed(2))))}
                    className="rounded p-1 hover:bg-white/10"
                    title="Zoom In"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Interactive Image Canvas */}
            <div
              className={`relative flex-1 overflow-hidden select-none ${
                panMode ? 'cursor-grab active:cursor-grabbing' : pickingColor ? 'cursor-crosshair' : 'cursor-crosshair'
              }`}
            >
              <canvas
                ref={canvasRef}
                width={800}
                height={600}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="w-full h-full block"
              />

              {/* Status overlay */}
              {statusMsg && (
                <div className="absolute bottom-2 left-2 rounded bg-black/80 px-2 py-1 text-[11px] font-mono text-white/90 backdrop-blur-sm">
                  {statusMsg}
                </div>
              )}

              {/* Helper badge */}
              <div className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur-sm pointer-events-none">
                {imgWidth > 0
                  ? `${imgWidth}×${imgHeight} px · Drag to select motif`
                  : 'Import an image to start'}
              </div>
            </div>
          </div>

          {/* Right Inspector & Stamp Creator Sidebar */}
          <aside className="w-80 border-l border-borderFolk bg-surface flex flex-col overflow-y-auto thin-scroll p-3 space-y-3 shrink-0">
            {/* Selection Metrics */}
            <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Crop Selection
                </span>
                <span className="font-mono text-xs font-bold text-crimson">
                  {colsInCrop}×{rowsInCrop} tiles
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-muted">
                <div>Pos: ({crop.x}, {crop.y})</div>
                <div>Size: {crop.w}×{crop.h} px</div>
              </div>

              {/* Quick Tile Dimensions */}
              <div>
                <span className="block text-[10px] text-muted mb-1">Preset Sizes:</span>
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  {[
                    [1, 1],
                    [2, 2],
                    [3, 3],
                    [4, 4],
                  ].map(([c, r]) => (
                    <button
                      key={`${c}x${r}`}
                      type="button"
                      onClick={() => setCropTileSize(c, r)}
                      className={`rounded border px-1 py-0.5 text-center font-mono ${
                        colsInCrop === c && rowsInCrop === r
                          ? 'border-crimson bg-crimson/10 font-bold text-crimson'
                          : 'border-borderFolk bg-surface hover:bg-card'
                      }`}
                    >
                      {c}×{r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Crop & Pixel Art Preview */}
            <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Processed Preview
                </span>
                <span className="text-[10px] text-muted font-mono">{totalTilesInCrop} tiles</span>
              </div>

              <div className="flex items-center justify-center rounded border border-borderFolk bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:8px_8px] p-2 min-h-[110px] overflow-hidden">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Motif preview"
                    className="max-h-36 max-w-full object-contain pixel-canvas border border-borderFolk shadow-sm"
                  />
                ) : (
                  <span className="text-[11px] text-muted">Select a region to preview</span>
                )}
              </div>

              {/* Pixel Art Filters */}
              <div className="space-y-1.5 pt-1 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pixelate}
                    onChange={(e) => setPixelate(e.target.checked)}
                  />
                  <span>Pixelate to {tileDim}px Grid (Retro Pixel Art)</span>
                </label>

                {/* Chroma-key transparency */}
                <div className="space-y-1 rounded border border-borderFolk bg-surface p-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium text-[11px]">
                      <input
                        type="checkbox"
                        checked={enableChroma}
                        onChange={(e) => setEnableChroma(e.target.checked)}
                      />
                      <span>Remove Background</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setPickingColor((p) => !p)}
                      title="Pick color with eyedropper from image"
                      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] border ${
                        pickingColor
                          ? 'border-indigoFolk bg-indigoFolk text-white'
                          : 'border-borderFolk hover:bg-card'
                      }`}
                    >
                      <Pipette className="h-3 w-3" />
                      <span>{pickingColor ? 'Click Image' : 'Pick'}</span>
                    </button>
                  </div>

                  {enableChroma && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={chromaHex}
                          onChange={(e) => setChromaHex(e.target.value)}
                          className="h-6 w-8 cursor-pointer rounded border border-borderFolk p-0"
                        />
                        <span className="font-mono text-[10px]">{chromaHex}</span>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-muted">
                          <span>Tolerance</span>
                          <span className="font-mono">{chromaTolerance}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={50}
                          value={chromaTolerance}
                          onChange={(e) => setChromaTolerance(Number(e.target.value))}
                          className="w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Target Stamp Settings */}
            <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block">
                Stamp &amp; Layer Config
              </span>

              <div>
                <label htmlFor="stamp-name-input" className="block text-[11px] font-medium text-muted mb-0.5">
                  Motif Stamp Name
                </label>
                <input
                  id="stamp-name-input"
                  type="text"
                  value={stampName}
                  onChange={(e) => setStampName(e.target.value)}
                  className="w-full rounded border border-borderFolk bg-surface px-2 py-1 text-xs"
                />
              </div>

              <div>
                <span className="block text-[11px] font-medium text-muted mb-0.5">Target Layer</span>
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  {[
                    ['bg0', 'Ground (BG 0)'],
                    ['bg1', 'Detail (BG 1)'],
                    ['obj0', 'Object (OBJ 0)'],
                    ['obj1', 'Overlay (OBJ 1)'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTargetLayer(id as any)}
                      className={`rounded border px-1.5 py-1 text-left ${
                        targetLayer === id
                          ? 'border-indigoFolk bg-indigoFolk text-white font-medium'
                          : 'border-borderFolk bg-surface hover:bg-card'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  checked={blocksMovement}
                  onChange={(e) => setBlocksMovement(e.target.checked)}
                />
                <span>Blocks Movement (Collision)</span>
              </label>
            </div>

            {/* Primary Action Buttons */}
            <div className="space-y-1.5 pt-1">
              <button
                type="button"
                onClick={() => handleAddSelection(false)}
                disabled={isProcessing || totalTilesInCrop <= 0}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded bg-crimson px-3 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                <span>Save as Macro Stamp ({colsInCrop}×{rowsInCrop})</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddSelection(true)}
                disabled={isProcessing || totalTilesInCrop <= 0}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-indigoFolk bg-indigoFolk/10 px-3 py-1.5 text-xs font-semibold text-indigoFolk hover:bg-indigoFolk/20 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Stamp Directly on Map Center</span>
              </button>

              {onApplyWholeMap && (
                <button
                  type="button"
                  onClick={handleConvertWholeTapestry}
                  disabled={isProcessing || !sourceImg}
                  title="Converts the full imported painting into a custom world map"
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-ochre/60 bg-surface px-3 py-1.5 text-[11px] font-medium text-ochre hover:bg-card disabled:opacity-50"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>Slice Entire Tapestry as World Map</span>
                </button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
