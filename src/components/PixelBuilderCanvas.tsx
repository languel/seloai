import React, { useEffect, useRef, useState } from 'react';
import {
  Eraser,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Grid,
  PaintBucket,
  Pencil,
  Pipette,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getOpaqueBounds, type CropSelection } from '../engine/tapestrySampler';

export type PixelTool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

interface PixelBuilderCanvasProps {
  gridWidth: number;
  gridHeight: number;
  pixelsPerTile: number;
  grid: number[];
  palette: string[];
  onChangeGridAndPalette: (nextGrid: number[], nextPalette: string[]) => void;
  onRetraceFromSample: () => void;
  sourceCanvas: HTMLCanvasElement | null;
  crop: CropSelection;
  trimAndFit: boolean;
}

export const PixelBuilderCanvas: React.FC<PixelBuilderCanvasProps> = ({
  gridWidth,
  gridHeight,
  pixelsPerTile,
  grid,
  palette,
  onChangeGridAndPalette,
  onRetraceFromSample,
  sourceCanvas,
  crop,
  trimAndFit,
}) => {
  const [tool, setTool] = useState<PixelTool>('pencil');
  const [activeColorIdx, setActiveColorIdx] = useState(0);
  const [underlayVisible, setUnderlayVisible] = useState(true);
  const [underlayOpacity, setUnderlayOpacity] = useState(35);
  const [showPixelGrid, setShowPixelGrid] = useState(true);
  const [guideStep, setGuideStep] = useState<number>(0); // 0 = tile boundaries, -1 = off, >0 = stitch guide interval
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [cellScale, setCellScale] = useState<number>(0); // 0 = auto-fit

  const undoRef = useRef<Array<{ grid: number[]; palette: string[] }>>([]);
  const [undoCount, setUndoCount] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const underlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: 720, h: 560 });
  const isPaintingRef = useRef(false);
  const strokeSavedRef = useRef(false);

  // Sync container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setViewportSize({
        w: Math.max(120, Math.floor(el.clientWidth)),
        h: Math.max(120, Math.floor(el.clientHeight)),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build aligned underlay canvas matching the exact cropped/trimmed geometry
  useEffect(() => {
    const uCanvas = document.createElement('canvas');
    uCanvas.width = Math.max(1, gridWidth * 4);
    uCanvas.height = Math.max(1, gridHeight * 4);
    const uCtx = uCanvas.getContext('2d');
    if (uCtx && sourceCanvas && crop.w > 0 && crop.h > 0) {
      const sx = Math.max(0, Math.floor(crop.x));
      const sy = Math.max(0, Math.floor(crop.y));
      const sw = Math.max(1, Math.min(Math.round(crop.w), sourceCanvas.width - sx));
      const sh = Math.max(1, Math.min(Math.round(crop.h), sourceCanvas.height - sy));

      if (trimAndFit) {
        const raw = document.createElement('canvas');
        raw.width = sw;
        raw.height = sh;
        const rCtx = raw.getContext('2d');
        if (rCtx) {
          rCtx.imageSmoothingEnabled = false;
          rCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
          const bounds = getOpaqueBounds(rCtx.getImageData(0, 0, sw, sh));
          const bx = bounds ? bounds.x : 0;
          const by = bounds ? bounds.y : 0;
          const bw = bounds ? bounds.w : sw;
          const bh = bounds ? bounds.h : sh;
          const scale = Math.min(uCanvas.width / bw, uCanvas.height / bh);
          const dw = Math.max(1, Math.round(bw * scale));
          const dh = Math.max(1, Math.round(bh * scale));
          const dx = Math.floor((uCanvas.width - dw) / 2);
          const dy = Math.floor((uCanvas.height - dh) / 2);
          uCtx.imageSmoothingEnabled = false;
          uCtx.drawImage(raw, bx, by, bw, bh, dx, dy, dw, dh);
        }
      } else {
        uCtx.imageSmoothingEnabled = false;
        uCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, uCanvas.width, uCanvas.height);
      }
    }
    underlayCanvasRef.current = uCanvas;
  }, [sourceCanvas, crop, trimAndFit, gridWidth, gridHeight]);

  // Compute effective pixel cell size in screen px
  const autoScale = Math.max(
    4,
    Math.floor(
      Math.min(
        (viewportSize.w - 48) / Math.max(1, gridWidth),
        (viewportSize.h - 48) / Math.max(1, gridHeight),
      ),
    ),
  );
  const effectiveScale = cellScale > 0 ? cellScale : autoScale;
  const drawW = gridWidth * effectiveScale;
  const drawH = gridHeight * effectiveScale;
  const originX = Math.floor((viewportSize.w - drawW) / 2);
  const originY = Math.floor((viewportSize.h - drawH) / 2);

  // Render pixel editor canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Checkerboard inside sprite area
    const checkPx = Math.max(6, Math.min(16, effectiveScale));
    ctx.fillStyle = '#242428';
    ctx.fillRect(originX, originY, drawW, drawH);
    ctx.fillStyle = '#313136';
    for (let cy = 0; cy < drawH; cy += checkPx) {
      for (let cx = 0; cx < drawW; cx += checkPx) {
        if (((Math.floor(cx / checkPx) + Math.floor(cy / checkPx)) & 1) === 0) {
          ctx.fillRect(
            originX + cx,
            originY + cy,
            Math.min(checkPx, drawW - cx),
            Math.min(checkPx, drawH - cy),
          );
        }
      }
    }

    // Sample reference underlay
    if (underlayVisible && underlayOpacity > 0 && underlayCanvasRef.current) {
      ctx.save();
      ctx.globalAlpha = underlayOpacity / 100;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(underlayCanvasRef.current, originX, originY, drawW, drawH);
      ctx.restore();
    }

    // Painted pixel grid
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const cIdx = grid[gy * gridWidth + gx];
        if (cIdx !== undefined && cIdx >= 0 && cIdx < palette.length) {
          ctx.fillStyle = palette[cIdx];
          ctx.fillRect(
            originX + gx * effectiveScale,
            originY + gy * effectiveScale,
            effectiveScale,
            effectiveScale,
          );
        }
      }
    }

    // Fine pixel grid lines
    if (showPixelGrid && effectiveScale >= 6) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx <= gridWidth; gx++) {
        const px = originX + gx * effectiveScale + 0.5;
        ctx.moveTo(px, originY);
        ctx.lineTo(px, originY + drawH);
      }
      for (let gy = 0; gy <= gridHeight; gy++) {
        const py = originY + gy * effectiveScale + 0.5;
        ctx.moveTo(originX, py);
        ctx.lineTo(originX + drawW, py);
      }
      ctx.stroke();
    }

    // Major stitch / tile guide lines
    const effectiveGuide = guideStep === 0 ? pixelsPerTile : guideStep;
    if (effectiveGuide > 0) {
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx <= gridWidth; gx += effectiveGuide) {
        const px = originX + gx * effectiveScale + 0.5;
        ctx.moveTo(px, originY);
        ctx.lineTo(px, originY + drawH);
      }
      for (let gy = 0; gy <= gridHeight; gy += effectiveGuide) {
        const py = originY + gy * effectiveScale + 0.5;
        ctx.moveTo(originX, py);
        ctx.lineTo(originX + drawW, py);
      }
      ctx.stroke();
    }

    // Mirror symmetry guides
    if (mirrorX) {
      const mx = originX + (gridWidth / 2) * effectiveScale;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.75)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, originY);
      ctx.lineTo(mx, originY + drawH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (mirrorY) {
      const my = originY + (gridHeight / 2) * effectiveScale;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.75)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(originX, my);
      ctx.lineTo(originX + drawW, my);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Outer frame border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(originX, originY, drawW, drawH);
  }, [
    viewportSize,
    gridWidth,
    gridHeight,
    pixelsPerTile,
    grid,
    palette,
    effectiveScale,
    originX,
    originY,
    drawW,
    drawH,
    underlayVisible,
    underlayOpacity,
    showPixelGrid,
    guideStep,
    mirrorX,
    mirrorY,
  ]);

  const pushUndo = () => {
    undoRef.current = [
      ...undoRef.current.slice(-29),
      { grid: [...grid], palette: [...palette] },
    ];
    setUndoCount(undoRef.current.length);
  };

  const handleUndo = () => {
    const prev = undoRef.current.pop();
    setUndoCount(undoRef.current.length);
    if (prev) {
      onChangeGridAndPalette(prev.grid, prev.palette);
    }
  };

  // Keyboard shortcuts (B/E/G/I + Cmd/Ctrl+Z)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (e.key.toLowerCase() === 'b') setTool('pencil');
      if (e.key.toLowerCase() === 'e') setTool('eraser');
      if (e.key.toLowerCase() === 'g') setTool('fill');
      if (e.key.toLowerCase() === 'i') setTool('eyedropper');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [grid, palette]);

  const pointerToCell = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) * canvas.width) / Math.max(1, rect.width);
    const cy = ((e.clientY - rect.top) * canvas.height) / Math.max(1, rect.height);
    const gx = Math.floor((cx - originX) / effectiveScale);
    const gy = Math.floor((cy - originY) / effectiveScale);
    if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight) return null;
    return { gx, gy };
  };

  const paintCell = (gx: number, gy: number, value: number) => {
    const next = [...grid];
    const points: Array<[number, number]> = [[gx, gy]];
    if (mirrorX) points.push([gridWidth - 1 - gx, gy]);
    if (mirrorY) points.push([gx, gridHeight - 1 - gy]);
    if (mirrorX && mirrorY) points.push([gridWidth - 1 - gx, gridHeight - 1 - gy]);

    let changed = false;
    for (const [px, py] of points) {
      const idx = py * gridWidth + px;
      if (next[idx] !== value) {
        next[idx] = value;
        changed = true;
      }
    }
    if (changed) {
      if (!strokeSavedRef.current) {
        pushUndo();
        strokeSavedRef.current = true;
      }
      onChangeGridAndPalette(next, palette);
    }
  };

  const floodFillCell = (startX: number, startY: number, fillVal: number) => {
    const startIdx = startY * gridWidth + startX;
    const targetVal = grid[startIdx];
    if (targetVal === fillVal) return;

    pushUndo();
    const next = [...grid];
    const visited = new Uint8Array(gridWidth * gridHeight);
    const queue = [startIdx];
    visited[startIdx] = 1;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      next[idx] = fillVal;
      const x = idx % gridWidth;
      const y = (idx - x) / gridWidth;
      const neighbors: number[] = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x + 1 < gridWidth) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - gridWidth);
      if (y + 1 < gridHeight) neighbors.push(idx + gridWidth);
      for (const n of neighbors) {
        if (!visited[n] && next[n] === targetVal) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }

    onChangeGridAndPalette(next, palette);
  };

  const pickColorAtCell = (gx: number, gy: number) => {
    const existingIdx = grid[gy * gridWidth + gx];
    if (existingIdx !== undefined && existingIdx >= 0 && existingIdx < palette.length) {
      setActiveColorIdx(existingIdx);
      setTool('pencil');
      return;
    }
    // Sample directly from the underlay reference if painted cell is transparent
    const uCanvas = underlayCanvasRef.current;
    if (!uCanvas) return;
    const uCtx = uCanvas.getContext('2d');
    if (!uCtx) return;
    const ux = Math.min(uCanvas.width - 1, Math.floor(((gx + 0.5) / gridWidth) * uCanvas.width));
    const uy = Math.min(uCanvas.height - 1, Math.floor(((gy + 0.5) / gridHeight) * uCanvas.height));
    const p = uCtx.getImageData(ux, uy, 1, 1).data;
    if (p[3] < 32) return;
    const hex = `#${((1 << 24) + (p[0] << 16) + (p[1] << 8) + p[2]).toString(16).slice(1)}`;
    const matchIdx = palette.indexOf(hex);
    if (matchIdx >= 0) {
      setActiveColorIdx(matchIdx);
    } else {
      const nextPalette = [...palette, hex];
      onChangeGridAndPalette(grid, nextPalette);
      setActiveColorIdx(nextPalette.length - 1);
    }
    setTool('pencil');
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = pointerToCell(e);
    if (!cell) return;

    // Right-click or Alt+click acts as quick eraser or eyedropper
    if (e.button === 2) {
      e.preventDefault();
      isPaintingRef.current = true;
      strokeSavedRef.current = false;
      paintCell(cell.gx, cell.gy, -1);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === 'eyedropper' || e.altKey) {
      pickColorAtCell(cell.gx, cell.gy);
      return;
    }

    if (tool === 'fill') {
      floodFillCell(cell.gx, cell.gy, activeColorIdx);
      return;
    }

    isPaintingRef.current = true;
    strokeSavedRef.current = false;
    paintCell(cell.gx, cell.gy, tool === 'eraser' ? -1 : activeColorIdx);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPaintingRef.current) return;
    const cell = pointerToCell(e);
    if (!cell) return;
    const val = e.buttons === 2 || tool === 'eraser' ? -1 : activeColorIdx;
    paintCell(cell.gx, cell.gy, val);
  };

  const handlePointerUp = () => {
    isPaintingRef.current = false;
    strokeSavedRef.current = false;
  };

  const handleAddColor = () => {
    const nextPalette = [...palette, '#be1e2d'];
    onChangeGridAndPalette(grid, nextPalette);
    setActiveColorIdx(nextPalette.length - 1);
  };

  const handleUpdateSwatch = (idx: number, newHex: string) => {
    const nextPalette = palette.map((c, i) => (i === idx ? newHex : c));
    onChangeGridAndPalette(grid, nextPalette);
  };

  const handleClearGrid = () => {
    pushUndo();
    onChangeGridAndPalette(new Array<number>(gridWidth * gridHeight).fill(-1), palette);
  };

  return (
    <div className="flex flex-1 flex-col bg-stone-950 overflow-hidden">
      {/* Pixel Builder Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white shrink-0">
        {/* Drawing Tools */}
        <div className="flex items-center gap-1">
          {[
            ['pencil', 'Pencil (B)', Pencil],
            ['eraser', 'Eraser (E)', Eraser],
            ['fill', 'Flood Fill (G)', PaintBucket],
            ['eyedropper', 'Eyedropper (I / Alt+Click)', Pipette],
          ].map(([id, title, Icon]) => {
            const IconComp = Icon as React.ComponentType<{ className?: string }>;
            return (
              <button
                key={id as string}
                type="button"
                onClick={() => setTool(id as PixelTool)}
                title={title as string}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                  tool === id ? 'bg-crimson text-white font-semibold' : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
              >
                <IconComp className="h-3.5 w-3.5" />
              </button>
            );
          })}

          <div className="mx-1 h-4 w-px bg-white/15" />

          <button
            type="button"
            onClick={() => setMirrorX((m) => !m)}
            title="Mirror Horizontal Symmetry"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
              mirrorX ? 'bg-indigo-600 text-white' : 'bg-white/10 text-white/75 hover:bg-white/20'
            }`}
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
            <span>Sym X</span>
          </button>

          <button
            type="button"
            onClick={() => setMirrorY((m) => !m)}
            title="Mirror Vertical Symmetry"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
              mirrorY ? 'bg-indigo-600 text-white' : 'bg-white/10 text-white/75 hover:bg-white/20'
            }`}
          >
            <FlipVertical2 className="h-3.5 w-3.5" />
            <span>Sym Y</span>
          </button>

          <div className="mx-1 h-4 w-px bg-white/15" />

          <button
            type="button"
            onClick={handleUndo}
            disabled={undoCount === 0}
            title="Undo (Cmd/Ctrl+Z)"
            className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20 disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onRetraceFromSample}
            title="Re-trace first approximation from the selected sample"
            className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Re-Trace Sample</span>
          </button>

          <button
            type="button"
            onClick={handleClearGrid}
            title="Clear painted pixels (keep underlay)"
            className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] text-white/80 hover:bg-white/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Underlay & Grid Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUnderlayVisible((v) => !v)}
            title="Toggle Sample Reference Underlay"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
              underlayVisible ? 'bg-cyan-700 text-white' : 'bg-white/10 text-white/70'
            }`}
          >
            {underlayVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            <span>Underlay</span>
          </button>

          {underlayVisible && (
            <div className="flex items-center gap-1 text-[10px] text-white/75">
              <span>{underlayOpacity}%</span>
              <input
                type="range"
                min={5}
                max={90}
                value={underlayOpacity}
                onChange={(e) => setUnderlayOpacity(Number(e.target.value))}
                className="w-16"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowPixelGrid((g) => !g)}
            title="Toggle Pixel Grid"
            className={`rounded p-1 ${showPixelGrid ? 'bg-white/20 text-white' : 'text-white/50 hover:bg-white/10'}`}
          >
            <Grid className="h-3.5 w-3.5" />
          </button>

          <select
            value={guideStep}
            onChange={(e) => setGuideStep(Number(e.target.value))}
            title="Major Stitch / Tile Guide Grid"
            className="rounded bg-stone-800 px-1 py-0.5 text-[10px] text-white border border-white/20"
          >
            <option value={0}>Tile Guide</option>
            <option value={4}>4px Guide</option>
            <option value={8}>8px Guide</option>
            <option value={10}>10px Stitch</option>
            <option value={16}>16px Guide</option>
            <option value={-1}>No Guide</option>
          </select>

          <div className="flex items-center gap-0.5 border-l border-white/10 pl-1.5">
            <button
              type="button"
              onClick={() => setCellScale(Math.max(4, effectiveScale - 2))}
              className="rounded p-1 hover:bg-white/10"
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCellScale(0)}
              className="px-1 font-mono text-[10px] text-white/80"
              title="Auto-Fit Zoom"
            >
              {effectiveScale}×
            </button>
            <button
              type="button"
              onClick={() => setCellScale(Math.min(32, effectiveScale + 2))}
              className="rounded p-1 hover:bg-white/10"
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Pixel Painting Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none cursor-crosshair"
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          width={viewportSize.w}
          height={viewportSize.h}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="w-full h-full block"
        />

        <div className="absolute top-2 left-2 rounded bg-black/65 px-2 py-0.5 text-[10px] font-mono text-white/80 backdrop-blur-sm pointer-events-none">
          {gridWidth}×{gridHeight} px · Left-click paint · Right-click erase · Alt+click sample underlay
        </div>
      </div>

      {/* Bottom Palette Bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 bg-black/60 px-3 py-2 text-xs text-white shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60 mr-1">
          Palette:
        </span>
        {palette.map((hex, idx) => {
          const active = idx === activeColorIdx && tool !== 'eraser';
          return (
            <div key={`${idx}-${hex}`} className="relative flex items-center">
              <button
                type="button"
                onClick={() => {
                  setActiveColorIdx(idx);
                  if (tool === 'eraser' || tool === 'eyedropper') setTool('pencil');
                }}
                title={`Color #${idx}: ${hex} (double-click swatch to edit)`}
                className={`h-6 w-6 rounded-sm border-2 transition ${
                  active ? 'border-white scale-110 shadow-md' : 'border-white/25 hover:border-white/60'
                }`}
                style={{ backgroundColor: hex }}
              />
              {active && (
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => handleUpdateSwatch(idx, e.target.value)}
                  title="Edit active swatch color across sprite"
                  className="ml-0.5 h-5 w-5 cursor-pointer rounded border border-white/30 bg-transparent p-0"
                />
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={handleAddColor}
          title="Add new color to palette"
          className="inline-flex h-6 items-center gap-0.5 rounded border border-white/25 bg-white/10 px-1.5 text-[10px] hover:bg-white/20"
        >
          <Plus className="h-3 w-3" />
          <span>Color</span>
        </button>
      </div>
    </div>
  );
};
