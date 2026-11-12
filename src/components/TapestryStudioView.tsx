import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Code2,
  Copy,
  Eraser,
  Grid,
  Hand,
  Layers,
  Maximize2,
  Palette,
  Pipette,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  appendTilesToTileset,
  convertTapestryToMap,
  createMacroStampFromIndices,
  detectMotifRegions,
  floodFillTransparent,
  processTilePixels,
  rebuildCrispPixelArt,
  removeEdgeBackground,
  sliceSelectionToTiles,
  type ChromaKeyFilter,
  type CrispPixelArtResult,
  type CropSelection,
} from '../engine/tapestrySampler';
import type { TileMacroStamp, VillageMap } from '../engine/types';
import { resolvePublicUrl } from '../utils/assetUrl';

interface AutoSliceItem {
  id: number;
  crop: CropSelection;
  selected: boolean;
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type CropHoverAction = ResizeHandle | 'move' | null;

interface TapestryStudioViewProps {
  map: VillageMap;
  onApplyMap: (nextMap: VillageMap) => void;
  onOpenLevelEditor?: () => void;
}

export const TapestryStudioView: React.FC<TapestryStudioViewProps> = ({
  map,
  onApplyMap,
  onOpenLevelEditor,
}) => {
  const tileDim = map.tileDim;

  const [sourceImg, setSourceImg] = useState<HTMLCanvasElement | null>(null);
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

  // Pixel Art & Background Remover Processing
  const [pixelate, setPixelate] = useState(true);
  const [trimAndFit, setTrimAndFit] = useState(true);
  const [enableChroma, setEnableChroma] = useState(false);
  const [chromaHex, setChromaHex] = useState('#ffffff');
  const [chromaTolerance, setChromaTolerance] = useState(20);
  const [pickingColor, setPickingColor] = useState(false);
  const [wandMode, setWandMode] = useState(false);
  const [bgVersion, setBgVersion] = useState(0);
  const [hoverAction, setHoverAction] = useState<CropHoverAction>(null);

  // Auto-Slicer state
  const [autoSlices, setAutoSlices] = useState<AutoSliceItem[]>([]);
  const [sliceMergeGap, setSliceMergeGap] = useState(6);
  const [sliceMinSize, setSliceMinSize] = useState(10);

  // Crisp Pixel Art Rebuilder state
  const [crispPixelsPerTile, setCrispPixelsPerTile] = useState<number>(16);
  const [crispMaxColors, setCrispMaxColors] = useState<number>(10);
  const [crispResult, setCrispResult] = useState<CrispPixelArtResult | null>(null);
  const [showProceduralCode, setShowProceduralCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Target Stamp Config
  const [stampName, setStampName] = useState('Tapestry Motif');
  const [targetLayer, setTargetLayer] = useState<'bg0' | 'bg1' | 'obj0' | 'obj1'>('bg1');
  const [blocksMovement, setBlocksMovement] = useState(false);

  // Live preview
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<'none' | 'pan' | 'select' | 'move' | 'resize'>('none');
  const dragStartRef = useRef({ x: 0, y: 0 });
  const moveOffsetRef = useRef({ dx: 0, dy: 0, w: 0, h: 0 });
  const resizeStartRef = useRef<{ handle: ResizeHandle; orig: CropSelection }>({
    handle: 'se',
    orig: { x: 0, y: 0, w: 32, h: 32 },
  });
  const panStartRef = useRef({ x: 0, y: 0 });

  // Keep canvas backing buffer dimensions synced 1:1 with its rendered CSS viewport
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateSize = () => {
      const w = Math.max(1, Math.floor(el.clientWidth));
      const h = Math.max(1, Math.floor(el.clientHeight));
      setCanvasSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load sample on mount if none loaded
  useEffect(() => {
    if (!sourceImg && !imgSrcUrl) {
      loadSampleTapestry();
    }
  }, []);

  const loadImageUrl = (url: string) => {
    setIsProcessing(true);
    setStatusMsg('Loading image…');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const workCanvas = document.createElement('canvas');
      workCanvas.width = img.naturalWidth;
      workCanvas.height = img.naturalHeight;
      const wCtx = workCanvas.getContext('2d');
      if (wCtx) {
        wCtx.drawImage(img, 0, 0);
      }
      originalImgRef.current = img;
      undoStackRef.current = [];
      setAutoSlices([]);
      setSourceImg(workCanvas);
      setBgVersion((v) => v + 1);
      setImgSrcUrl(url);
      setImgWidth(img.naturalWidth);
      setImgHeight(img.naturalHeight);
      setPan({ x: 0, y: 0 });
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

  const pushUndoSnapshot = () => {
    if (!sourceImg) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    undoStackRef.current = [...undoStackRef.current.slice(-11), snap];
  };

  const handleAutoRemoveBg = () => {
    if (!sourceImg) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    pushUndoSnapshot();
    const imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    removeEdgeBackground(imgData, chromaTolerance);
    ctx.putImageData(imgData, 0, 0);
    setBgVersion((v) => v + 1);
    setStatusMsg('Auto-removed edge background');
  };

  const handleApplyColorKeyToImage = () => {
    if (!sourceImg) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    pushUndoSnapshot();
    const hex = chromaHex.replace('#', '');
    const num = parseInt(hex, 16);
    const imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    processTilePixels(imgData, {
      chromaKey: {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
        tolerance: chromaTolerance,
      },
    });
    ctx.putImageData(imgData, 0, 0);
    setBgVersion((v) => v + 1);
    setStatusMsg(`Removed ${chromaHex} across image`);
  };

  const handleUndoBg = () => {
    if (!sourceImg || undoStackRef.current.length === 0) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    const last = undoStackRef.current.pop();
    if (last) {
      ctx.putImageData(last, 0, 0);
      setBgVersion((v) => v + 1);
      setStatusMsg('Undid background edit');
    }
  };

  const handleResetImage = () => {
    if (!sourceImg || !originalImgRef.current) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    pushUndoSnapshot();
    ctx.clearRect(0, 0, sourceImg.width, sourceImg.height);
    ctx.drawImage(originalImgRef.current, 0, 0);
    setAutoSlices([]);
    setBgVersion((v) => v + 1);
    setStatusMsg('Reset image to original');
  };

  const handleAutoSlice = () => {
    if (!sourceImg) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;

    let imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    // Check if image has any transparent pixels yet; if not, auto-remove edge background first!
    let hasTransparency = false;
    for (let i = 3; i < imgData.data.length; i += 4) {
      if (imgData.data[i] === 0) {
        hasTransparency = true;
        break;
      }
    }
    if (!hasTransparency) {
      pushUndoSnapshot();
      removeEdgeBackground(imgData, chromaTolerance);
      ctx.putImageData(imgData, 0, 0);
      setBgVersion((v) => v + 1);
      imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    }

    const regions = detectMotifRegions(imgData, {
      minSize: sliceMinSize,
      mergeGap: sliceMergeGap,
    });
    const items: AutoSliceItem[] = regions.map((r, idx) => ({
      id: idx + 1,
      crop: r,
      selected: true,
    }));
    setAutoSlices(items);
    if (items.length > 0) {
      setCrop(items[0].crop);
      setStatusMsg(`Auto-sliced ${items.length} motifs`);
    } else {
      setStatusMsg('No distinct motifs found (try adjusting tolerance or min size)');
    }
  };

  const nudgeCrop = (dx: number, dy: number) => {
    setCrop((prev) => ({
      ...prev,
      x: Math.max(0, Math.min(Math.max(0, imgWidth - prev.w), prev.x + dx)),
      y: Math.max(0, Math.min(Math.max(0, imgHeight - prev.h), prev.y + dy)),
    }));
  };

  // Arrow keys nudge selection off-grid (Shift+Arrow nudges 8px)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const step = e.shiftKey ? 8 : 1;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nudgeCrop(-step, 0);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nudgeCrop(step, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nudgeCrop(0, -step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        nudgeCrop(0, step);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imgWidth, imgHeight]);

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

  // Update selection preview + crisp pixel art rebuild whenever crop or filters change
  useEffect(() => {
    if (!sourceImg || crop.w <= 0 || crop.h <= 0) return;
    try {
      const chromaKey = getChromaFilter();
      const sliced = sliceSelectionToTiles(sourceImg, imgWidth, imgHeight, crop, tileDim, {
        pixelate,
        trimAndFit,
        chromaKey,
      });
      setPreviewUrl(sliced.previewDataUrl);

      const crisp = rebuildCrispPixelArt(sourceImg, imgWidth, imgHeight, crop, tileDim, {
        pixelsPerTile: crispPixelsPerTile,
        maxColors: crispMaxColors,
        fnName: stampName || 'Motif',
        chromaKey,
        trimAndFit,
      });
      setCrispResult(crisp);
    } catch {
      // ignore
    }
  }, [
    sourceImg,
    bgVersion,
    crop,
    pixelate,
    trimAndFit,
    enableChroma,
    chromaHex,
    chromaTolerance,
    tileDim,
    imgWidth,
    imgHeight,
    crispPixelsPerTile,
    crispMaxColors,
    stampName,
  ]);

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

    // Draw subtle transparency checkerboard behind the image
    const checkSize = Math.max(8, Math.round(16 / Math.max(1, zoom)));
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(0, 0, imgWidth, imgHeight);
    ctx.fillStyle = '#3a3a40';
    for (let cy = 0; cy < imgHeight; cy += checkSize) {
      for (let cx = 0; cx < imgWidth; cx += checkSize) {
        if (((Math.floor(cx / checkSize) + Math.floor(cy / checkSize)) & 1) === 0) {
          ctx.fillRect(cx, cy, Math.min(checkSize, imgWidth - cx), Math.min(checkSize, imgHeight - cy));
        }
      }
    }

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

    // Draw Auto-Slicer bounding boxes
    for (const item of autoSlices) {
      const r = item.crop;
      ctx.strokeStyle = item.selected ? '#22d3ee' : 'rgba(148, 163, 184, 0.65)';
      ctx.lineWidth = (item.selected ? 1.5 : 1) / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);

      // Number badge
      const badgeSize = Math.max(12, 14 / zoom);
      ctx.fillStyle = item.selected ? 'rgba(8, 145, 178, 0.9)' : 'rgba(51, 65, 85, 0.85)';
      ctx.fillRect(r.x, Math.max(0, r.y - badgeSize), badgeSize * 1.4, badgeSize);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(10 / zoom)}px monospace`;
      ctx.fillText(String(item.id), r.x + 3 / zoom, Math.max(badgeSize * 0.75, r.y - 3 / zoom));
    }

    // Draw active crop rectangle
    if (crop.w > 0 && crop.h > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, 0, imgWidth, crop.y);
      ctx.fillRect(0, crop.y + crop.h, imgWidth, imgHeight - (crop.y + crop.h));
      ctx.fillRect(0, crop.y, crop.x, crop.h);
      ctx.fillRect(crop.x + crop.w, crop.y, imgWidth - (crop.x + crop.w), crop.h);

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

      // 8 resize handles (4 corners + 4 edge midpoints)
      const hs = Math.max(4, 7 / zoom);
      const half = hs / 2;
      const handles: Array<[number, number]> = [
        [crop.x, crop.y],
        [crop.x + crop.w / 2, crop.y],
        [crop.x + crop.w, crop.y],
        [crop.x + crop.w, crop.y + crop.h / 2],
        [crop.x + crop.w, crop.y + crop.h],
        [crop.x + crop.w / 2, crop.y + crop.h],
        [crop.x, crop.y + crop.h],
        [crop.x, crop.y + crop.h / 2],
      ];
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#be1e2d';
      ctx.lineWidth = 1.5 / zoom;
      for (const [hx, hy] of handles) {
        ctx.fillRect(hx - half, hy - half, hs, hs);
        ctx.strokeRect(hx - half, hy - half, hs, hs);
      }
    }

    ctx.restore();
  }, [sourceImg, bgVersion, imgWidth, imgHeight, zoom, pan, showGrid, snapGrid, crop, tileDim, canvasSize, autoSlices]);

  // Convert canvas pointer coordinates to image pixel coordinates
  const canvasToImageCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || imgWidth <= 0 || imgHeight <= 0) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    const ox = (cx - (canvas.width / 2 + pan.x)) / zoom + imgWidth / 2;
    const oy = (cy - (canvas.height / 2 + pan.y)) / zoom + imgHeight / 2;

    return {
      x: Math.max(0, Math.min(imgWidth - 1, Math.floor(ox))),
      y: Math.max(0, Math.min(imgHeight - 1, Math.floor(oy))),
    };
  };

  const hitTestCropAction = (x: number, y: number): CropHoverAction => {
    if (crop.w <= 0 || crop.h <= 0) return null;
    const tol = Math.max(5, Math.round(7 / zoom));
    const left = crop.x;
    const right = crop.x + crop.w;
    const top = crop.y;
    const bottom = crop.y + crop.h;

    if (x < left - tol || x > right + tol || y < top - tol || y > bottom + tol) {
      return null;
    }

    const nearLeft = Math.abs(x - left) <= tol;
    const nearRight = Math.abs(x - right) <= tol;
    const nearTop = Math.abs(y - top) <= tol;
    const nearBottom = Math.abs(y - bottom) <= tol;

    if (nearTop && nearLeft) return 'nw';
    if (nearTop && nearRight) return 'ne';
    if (nearBottom && nearLeft) return 'sw';
    if (nearBottom && nearRight) return 'se';
    if (nearTop) return 'n';
    if (nearBottom) return 's';
    if (nearLeft) return 'w';
    if (nearRight) return 'e';
    if (x >= left && x < right && y >= top && y < bottom) return 'move';
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || panMode || e.altKey) {
      isDraggingRef.current = true;
      dragModeRef.current = 'pan';
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const { x, y } = canvasToImageCoords(e);

    if (pickingColor && sourceImg) {
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

    if (wandMode && sourceImg) {
      const ctx = sourceImg.getContext('2d');
      if (ctx) {
        pushUndoSnapshot();
        const imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
        floodFillTransparent(imgData, [{ x, y }], chromaTolerance);
        ctx.putImageData(imgData, 0, 0);
        setBgVersion((v) => v + 1);
        setStatusMsg(`Removed background region at (${x}, ${y})`);
      }
      return;
    }

    // Check resize handles or move inside existing crop box (unless Ctrl/Cmd forces a new selection)
    const hitAction = !e.metaKey && !e.ctrlKey ? hitTestCropAction(x, y) : null;
    if (hitAction && hitAction !== 'move') {
      isDraggingRef.current = true;
      dragModeRef.current = 'resize';
      resizeStartRef.current = { handle: hitAction, orig: { ...crop } };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (hitAction === 'move') {
      isDraggingRef.current = true;
      dragModeRef.current = 'move';
      moveOffsetRef.current = {
        dx: x - crop.x,
        dy: y - crop.y,
        w: crop.w,
        h: crop.h,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Start new box selection anchored by grid cell
    isDraggingRef.current = true;
    dragModeRef.current = 'select';
    const snap = snapGrid > 0 ? snapGrid : 1;
    const maxCellX = Math.max(0, Math.floor((imgWidth - 1) / snap));
    const maxCellY = Math.max(0, Math.floor((imgHeight - 1) / snap));
    const cellX = Math.min(maxCellX, Math.max(0, Math.floor(x / snap)));
    const cellY = Math.min(maxCellY, Math.max(0, Math.floor(y / snap)));
    dragStartRef.current = { x: cellX, y: cellY };
    const startPx = cellX * snap;
    const startPy = cellY * snap;
    setCrop({
      x: startPx,
      y: startPy,
      w: Math.max(1, Math.min(snap, imgWidth - startPx)),
      h: Math.max(1, Math.min(snap, imgHeight - startPy)),
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasToImageCoords(e);

    if (!isDraggingRef.current) {
      const nextHover = hitTestCropAction(x, y);
      if (nextHover !== hoverAction) {
        setHoverAction(nextHover);
      }
      return;
    }

    if (dragModeRef.current === 'pan' || panMode || e.buttons === 4 || e.altKey) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    if (dragModeRef.current === 'resize') {
      const { handle, orig } = resizeStartRef.current;
      const minSize = 8;
      let left = orig.x;
      let top = orig.y;
      let right = orig.x + orig.w;
      let bottom = orig.y + orig.h;

      const snapVal = (v: number) =>
        e.shiftKey && snapGrid > 0 ? Math.round(v / snapGrid) * snapGrid : v;

      if (handle.includes('w')) {
        left = Math.max(0, Math.min(right - minSize, snapVal(x)));
      }
      if (handle.includes('e')) {
        right = Math.min(imgWidth, Math.max(left + minSize, snapVal(x + 1)));
      }
      if (handle.includes('n')) {
        top = Math.max(0, Math.min(bottom - minSize, snapVal(y)));
      }
      if (handle.includes('s')) {
        bottom = Math.min(imgHeight, Math.max(top + minSize, snapVal(y + 1)));
      }

      setCrop({
        x: left,
        y: top,
        w: Math.max(minSize, right - left),
        h: Math.max(minSize, bottom - top),
      });
      return;
    }

    if (dragModeRef.current === 'move') {
      let nextX = x - moveOffsetRef.current.dx;
      let nextY = y - moveOffsetRef.current.dy;
      if (e.shiftKey && snapGrid > 0) {
        nextX = Math.round(nextX / snapGrid) * snapGrid;
        nextY = Math.round(nextY / snapGrid) * snapGrid;
      }
      const clampedX = Math.max(0, Math.min(Math.max(0, imgWidth - moveOffsetRef.current.w), nextX));
      const clampedY = Math.max(0, Math.min(Math.max(0, imgHeight - moveOffsetRef.current.h), nextY));
      setCrop((prev) => ({ ...prev, x: clampedX, y: clampedY }));
      return;
    }

    const snap = snapGrid > 0 ? snapGrid : 1;
    const maxCellX = Math.max(0, Math.floor((imgWidth - 1) / snap));
    const maxCellY = Math.max(0, Math.floor((imgHeight - 1) / snap));
    const curCellX = Math.min(maxCellX, Math.max(0, Math.floor(x / snap)));
    const curCellY = Math.min(maxCellY, Math.max(0, Math.floor(y / snap)));

    const minCellX = Math.min(dragStartRef.current.x, curCellX);
    const minCellY = Math.min(dragStartRef.current.y, curCellY);
    const maxSelCellX = Math.max(dragStartRef.current.x, curCellX);
    const maxSelCellY = Math.max(dragStartRef.current.y, curCellY);

    const minX = minCellX * snap;
    const minY = minCellY * snap;
    const maxX = Math.min(imgWidth, (maxSelCellX + 1) * snap);
    const maxY = Math.min(imgHeight, (maxSelCellY + 1) * snap);

    setCrop({
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY),
    });
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
    dragModeRef.current = 'none';
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

  const loadExistingTileset = async (): Promise<HTMLImageElement | null> => {
    if (!map.tileSetUrl) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = resolvePublicUrl(map.tileSetUrl);
    });
  };

  const commitStampToMap = (payload: {
    tilesetUrl: string;
    tilesetDimX: number;
    tilesetDimY: number;
    stamps: TileMacroStamp[];
    directPlaceStamp?: TileMacroStamp;
  }) => {
    let nextMap: VillageMap = {
      ...map,
      tileSetUrl: payload.tilesetUrl,
      tileSetDimX: payload.tilesetDimX,
      tileSetDimY: payload.tilesetDimY,
      stamps: [...(map.stamps ?? []), ...payload.stamps],
    };

    if (payload.directPlaceStamp) {
      const s = payload.directPlaceStamp;
      const startX = Math.max(0, Math.floor((map.width - s.width) / 2));
      const startY = Math.max(0, Math.floor((map.height - s.height) / 2));
      const nextBg = map.bgTiles.map((l) => l.map((c) => [...c]));
      const nextObj = map.objectTiles.map((l) => l.map((c) => [...c]));
      const nextCol = map.collisionGrid.map((c) => [...c]);

      const tgtLayer = s.layer ?? targetLayer;
      const layerGrid =
        tgtLayer === 'bg0'
          ? nextBg[0]
          : tgtLayer === 'bg1'
            ? nextBg[1]
            : tgtLayer === 'obj0'
              ? nextObj[0]
              : nextObj[1];

      for (let r = 0; r < s.height; r++) {
        for (let c = 0; c < s.width; c++) {
          const mapX = startX + c;
          const mapY = startY + r;
          const idx = s.tiles[r * s.width + c];
          if (mapX < map.width && mapY < map.height && idx !== undefined) {
            layerGrid[mapX][mapY] = idx;
            if (s.blocksMovement) {
              nextCol[mapX][mapY] = true;
            }
          }
        }
      }

      nextMap = {
        ...nextMap,
        bgTiles: nextBg,
        objectTiles: nextObj,
        collisionGrid: nextCol,
      };
    }

    onApplyMap(nextMap);
  };

  // Slice current selection (or crisp rebuilt pixel art) and append to tileset
  const handleAddSelection = async (options: { directPlace?: boolean; useCrisp?: boolean } = {}) => {
    if (!sourceImg || crop.w <= 0 || crop.h <= 0) return;
    setIsProcessing(true);
    setStatusMsg(options.useCrisp ? 'Building crisp pixel art stamp…' : 'Slicing and adding tiles to tileset…');

    try {
      let canvases: HTMLCanvasElement[];
      let cols: number;
      let rows: number;

      if (options.useCrisp && crispResult && crispResult.canvases.length > 0) {
        canvases = crispResult.canvases;
        cols = crispResult.cols;
        rows = crispResult.rows;
      } else {
        const sliced = sliceSelectionToTiles(sourceImg, imgWidth, imgHeight, crop, tileDim, {
          pixelate,
          trimAndFit,
          chromaKey: getChromaFilter(),
        });
        canvases = sliced.canvases;
        cols = sliced.cols;
        rows = sliced.rows;
      }

      const existingImg = await loadExistingTileset();
      const appended = await appendTilesToTileset(
        existingImg,
        map.tileSetDimX,
        map.tileSetDimY,
        tileDim,
        canvases,
      );

      const finalName = options.useCrisp
        ? `${stampName || 'Motif'} (Crisp)`
        : stampName || `Motif (${cols}x${rows})`;

      const stamp = createMacroStampFromIndices(
        finalName,
        cols,
        rows,
        appended.tileIndices,
        targetLayer,
        blocksMovement,
      );

      commitStampToMap({
        tilesetUrl: appended.newTilesetUrl,
        tilesetDimX: appended.newDimX,
        tilesetDimY: appended.newDimY,
        stamps: [stamp],
        directPlaceStamp: options.directPlace ? stamp : undefined,
      });

      setStatusMsg(`Added "${stamp.name}" (${cols}×${rows} tiles) to Level Editor`);
    } catch (err) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Batch slice & add all checked Auto-Slicer motifs
  const handleBatchAddAutoSlices = async () => {
    if (!sourceImg) return;
    const selectedItems = autoSlices.filter((s) => s.selected);
    if (selectedItems.length === 0) return;

    setIsProcessing(true);
    setStatusMsg(`Batch slicing ${selectedItems.length} motifs…`);

    try {
      const chromaKey = getChromaFilter();
      const allCanvases: HTMLCanvasElement[] = [];
      const perItemMeta: Array<{ id: number; cols: number; rows: number; count: number }> = [];

      for (const item of selectedItems) {
        const sliced = sliceSelectionToTiles(sourceImg, imgWidth, imgHeight, item.crop, tileDim, {
          pixelate,
          trimAndFit,
          chromaKey,
        });
        allCanvases.push(...sliced.canvases);
        perItemMeta.push({
          id: item.id,
          cols: sliced.cols,
          rows: sliced.rows,
          count: sliced.canvases.length,
        });
      }

      const existingImg = await loadExistingTileset();
      const appended = await appendTilesToTileset(
        existingImg,
        map.tileSetDimX,
        map.tileSetDimY,
        tileDim,
        allCanvases,
      );

      let offset = 0;
      const newStamps: TileMacroStamp[] = [];
      for (const meta of perItemMeta) {
        const indices = appended.tileIndices.slice(offset, offset + meta.count);
        offset += meta.count;
        newStamps.push(
          createMacroStampFromIndices(
            `${stampName || 'Motif'} #${meta.id}`,
            meta.cols,
            meta.rows,
            indices,
            targetLayer,
            blocksMovement,
          ),
        );
      }

      commitStampToMap({
        tilesetUrl: appended.newTilesetUrl,
        tilesetDimX: appended.newDimX,
        tilesetDimY: appended.newDimY,
        stamps: newStamps,
      });

      setStatusMsg(`Batch-added ${newStamps.length} motif stamps (${allCanvases.length} tiles) to Level Editor!`);
    } catch (err) {
      setStatusMsg(`Batch error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Convert entire tapestry into a standalone map
  const handleConvertWholeMap = async () => {
    if (!sourceImg) return;
    setIsProcessing(true);
    setStatusMsg('Converting full image into playable map…');
    try {
      const { map: generatedMap } = await convertTapestryToMap(
        sourceImg,
        tileDim,
        stampName || 'Tapestry World',
      );
      onApplyMap(generatedMap);
      setStatusMsg('Applied whole image as playable world map!');
    } catch (err) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyProceduralCode = async () => {
    if (!crispResult?.proceduralCode) return;
    try {
      await navigator.clipboard.writeText(crispResult.proceduralCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      setStatusMsg('Clipboard copy unavailable; select code below.');
    }
  };

  const selectedSliceCount = autoSlices.filter((s) => s.selected).length;

  return (
    <div
      className="flex h-full w-full flex-col bg-linen text-ink overflow-hidden"
      onPaste={handlePaste}
      tabIndex={-1}
    >
      {/* Top Studio Header */}
      <header className="flex items-center justify-between border-b border-borderFolk bg-card px-4 py-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-crimson/15 text-crimson">
            <Palette className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-sm font-bold leading-tight">
              Tapestry &amp; Pixel Art Studio
            </h2>
            <p className="text-[11px] text-muted">
              Remove backgrounds, auto-slice motifs, shift off-grid, rebuild crisp pixel art &amp; procedural code.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenLevelEditor && (
            <button
              type="button"
              onClick={onOpenLevelEditor}
              className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs font-medium hover:bg-card"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Open Level Editor</span>
            </button>
          )}
        </div>
      </header>

      {/* Studio Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main Image Viewport Area */}
        <div className="relative flex flex-1 flex-col bg-stone-950 overflow-hidden">
          {/* Viewport Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white shrink-0">
            {/* Import & Auto-Slice Actions */}
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
                className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20"
              >
                <Sparkles className="h-3 w-3" />
                <span>Sample Tapestry</span>
              </button>

              <button
                type="button"
                onClick={handleAutoSlice}
                disabled={!sourceImg}
                title="Automatically remove edge background (if needed) and detect all motifs"
                className="inline-flex items-center gap-1 rounded bg-cyan-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                <Scissors className="h-3 w-3" />
                <span>Auto-Slice Motifs</span>
              </button>
            </div>

            {/* Viewport Tools: Pan, Magic Wand, Zoom, Grid */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setPanMode((p) => !p);
                  setWandMode(false);
                  setPickingColor(false);
                }}
                aria-pressed={panMode}
                title="Hand Tool / Pan Viewport (or hold Alt / Middle Click)"
                className={`rounded p-1 ${panMode ? 'bg-indigo-600 text-white' : 'hover:bg-white/10 text-white/70'}`}
              >
                <Hand className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setWandMode((w) => !w);
                  setPanMode(false);
                  setPickingColor(false);
                }}
                aria-pressed={wandMode}
                title="Magic Wand: Click a background region to make it transparent"
                className={`rounded p-1 ${wandMode ? 'bg-crimson text-white' : 'hover:bg-white/10 text-white/70'}`}
              >
                <Wand2 className="h-3.5 w-3.5" />
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
            ref={viewportRef}
            className={`relative flex-1 overflow-hidden select-none ${
              panMode
                ? 'cursor-grab active:cursor-grabbing'
                : pickingColor || wandMode
                  ? 'cursor-crosshair'
                  : hoverAction === 'nw' || hoverAction === 'se'
                    ? 'cursor-nwse-resize'
                    : hoverAction === 'ne' || hoverAction === 'sw'
                      ? 'cursor-nesw-resize'
                      : hoverAction === 'n' || hoverAction === 's'
                        ? 'cursor-ns-resize'
                        : hoverAction === 'e' || hoverAction === 'w'
                          ? 'cursor-ew-resize'
                          : hoverAction === 'move'
                            ? 'cursor-move'
                            : 'cursor-crosshair'
            }`}
          >
            <canvas
              ref={canvasRef}
              width={canvasSize.w}
              height={canvasSize.h}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="w-full h-full block"
            />

            {statusMsg && (
              <div className="absolute bottom-2 left-2 rounded bg-black/80 px-2 py-1 text-[11px] font-mono text-white/90 backdrop-blur-sm">
                {statusMsg}
              </div>
            )}

            <div className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur-sm pointer-events-none">
              {imgWidth > 0
                ? wandMode
                  ? 'Magic Wand: Click any background area to erase'
                  : pickingColor
                    ? 'Eyedropper: Click a color to key out'
                    : `${imgWidth}×${imgHeight} px · Drag inside box to shift off-grid · Arrows nudge`
                : 'Import an image to start'}
            </div>
          </div>
        </div>

        {/* Right Inspector & Stamp Creator Sidebar */}
        <aside className="w-84 border-l border-borderFolk bg-surface flex flex-col overflow-y-auto thin-scroll p-3 space-y-3 shrink-0">
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

            {/* Off-grid Fine Nudge Controls */}
            <div className="flex items-center justify-between gap-1 rounded border border-borderFolk bg-surface px-2 py-1">
              <span className="text-[10px] text-muted">Shift Off-Grid:</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => nudgeCrop(-1, 0)}
                  title="Nudge Left 1px (ArrowLeft)"
                  className="rounded border border-borderFolk bg-card p-0.5 hover:bg-surface"
                >
                  <ArrowLeft className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => nudgeCrop(0, -1)}
                  title="Nudge Up 1px (ArrowUp)"
                  className="rounded border border-borderFolk bg-card p-0.5 hover:bg-surface"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => nudgeCrop(0, 1)}
                  title="Nudge Down 1px (ArrowDown)"
                  className="rounded border border-borderFolk bg-card p-0.5 hover:bg-surface"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => nudgeCrop(1, 0)}
                  title="Nudge Right 1px (ArrowRight)"
                  className="rounded border border-borderFolk bg-card p-0.5 hover:bg-surface"
                >
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
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

          {/* Background Remover */}
          <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Background Remover
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleUndoBg}
                  disabled={undoStackRef.current.length === 0}
                  title="Undo last background removal"
                  className="inline-flex items-center gap-0.5 rounded border border-borderFolk px-1.5 py-0.5 text-[10px] hover:bg-surface disabled:opacity-40"
                >
                  <Undo2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={handleResetImage}
                  title="Reset image to original"
                  className="inline-flex items-center gap-0.5 rounded border border-borderFolk px-1.5 py-0.5 text-[10px] hover:bg-surface"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={handleAutoRemoveBg}
                title="Flood-fill remove background from image borders while keeping interior details"
                className="inline-flex items-center justify-center gap-1 rounded bg-crimson/90 px-2 py-1 text-[10px] font-medium text-white hover:bg-crimson"
              >
                <Eraser className="h-3 w-3" />
                <span>Auto Remove BG</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setWandMode((w) => !w);
                  setPickingColor(false);
                  setPanMode(false);
                }}
                title="Click any background pocket on the image to erase it"
                className={`inline-flex items-center justify-center gap-1 rounded border px-2 py-1 text-[10px] font-medium ${
                  wandMode
                    ? 'border-indigoFolk bg-indigoFolk text-white'
                    : 'border-borderFolk bg-surface hover:bg-card'
                }`}
              >
                <Wand2 className="h-3 w-3" />
                <span>{wandMode ? 'Wand Active' : 'Magic Wand'}</span>
              </button>
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

            <div className="border-t border-borderFolk/60 pt-1.5 space-y-1">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                  <input
                    type="checkbox"
                    checked={enableChroma}
                    onChange={(e) => setEnableChroma(e.target.checked)}
                  />
                  <span>Global Color Key</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setPickingColor((p) => !p);
                    setWandMode(false);
                    setPanMode(false);
                  }}
                  title="Pick color with eyedropper from image"
                  className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] border ${
                    pickingColor
                      ? 'border-indigoFolk bg-indigoFolk text-white'
                      : 'border-borderFolk hover:bg-surface'
                  }`}
                >
                  <Pipette className="h-3 w-3" />
                  <span>{pickingColor ? 'Click Image' : 'Pick'}</span>
                </button>
              </div>

              {enableChroma && (
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={chromaHex}
                      onChange={(e) => setChromaHex(e.target.value)}
                      className="h-5 w-7 cursor-pointer rounded border border-borderFolk p-0"
                    />
                    <span className="font-mono text-[10px]">{chromaHex}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyColorKeyToImage}
                    className="rounded border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] hover:bg-card"
                    title="Bake this color removal directly onto the source image"
                  >
                    Apply to Image
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Auto-Slicer Results */}
          <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Auto-Slicer
              </span>
              <span className="font-mono text-[10px] text-muted">
                {autoSlices.length > 0 ? `${selectedSliceCount}/${autoSlices.length} selected` : 'Ready'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] text-muted">
              <label className="space-y-0.5">
                <span>Merge Gap: {sliceMergeGap}px</span>
                <input
                  type="range"
                  min={0}
                  max={24}
                  value={sliceMergeGap}
                  onChange={(e) => setSliceMergeGap(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <label className="space-y-0.5">
                <span>Min Size: {sliceMinSize}px</span>
                <input
                  type="range"
                  min={4}
                  max={32}
                  value={sliceMinSize}
                  onChange={(e) => setSliceMinSize(Number(e.target.value))}
                  className="w-full"
                />
              </label>
            </div>

            {autoSlices.length > 0 && (
              <div className="space-y-1.5">
                <div className="max-h-28 overflow-y-auto thin-scroll space-y-1 rounded border border-borderFolk bg-surface p-1.5">
                  {autoSlices.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-1 text-[10px] font-mono"
                    >
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={(e) =>
                            setAutoSlices((prev) =>
                              prev.map((p) =>
                                p.id === item.id ? { ...p, selected: e.target.checked } : p,
                              ),
                            )
                          }
                        />
                        <span>#{item.id}</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setCrop(item.crop)}
                        className="text-left text-indigoFolk hover:underline"
                      >
                        {item.crop.w}×{item.crop.h}px
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={isProcessing || selectedSliceCount === 0}
                  onClick={handleBatchAddAutoSlices}
                  className="w-full rounded bg-cyan-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
                >
                  Batch Add {selectedSliceCount} Motifs to Tileset
                </button>
              </div>
            )}
          </div>

          {/* Live Crop & Pixel Art Preview */}
          <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Processed Preview
              </span>
              <span className="text-[10px] text-muted font-mono">{totalTilesInCrop} tiles</span>
            </div>

            <div className="flex items-center justify-center rounded border border-borderFolk bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:8px_8px] p-2 min-h-[100px] overflow-hidden">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Motif preview"
                  className="max-h-32 max-w-full object-contain pixel-canvas border border-borderFolk shadow-sm"
                />
              ) : (
                <span className="text-[11px] text-muted">Select a region to preview</span>
              )}
            </div>

            <div className="space-y-1 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pixelate}
                  onChange={(e) => setPixelate(e.target.checked)}
                />
                <span>Pixelate to {tileDim}px Grid</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trimAndFit}
                  onChange={(e) => setTrimAndFit(e.target.checked)}
                />
                <span>Trim Transparent Edges &amp; Fit to Tiles</span>
              </label>
            </div>
          </div>

          {/* Crisp Pixel Art Rebuilder + Procedural Code */}
          <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Crisp Pixel Art Rebuilder
              </span>
              {crispResult && (
                <span className="font-mono text-[10px] text-muted">
                  {crispResult.gridWidth}×{crispResult.gridHeight} · {crispResult.palette.length}c
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] text-muted">
              <label className="space-y-0.5">
                <span>Grid/Tile: {crispPixelsPerTile}px</span>
                <select
                  value={crispPixelsPerTile}
                  onChange={(e) => setCrispPixelsPerTile(Number(e.target.value))}
                  className="w-full rounded border border-borderFolk bg-surface px-1 py-0.5 text-[10px] text-ink"
                >
                  <option value={8}>8px (Chunky)</option>
                  <option value={16}>16px (Retro 16-bit)</option>
                  <option value={32}>32px (Native Tile)</option>
                </select>
              </label>
              <label className="space-y-0.5">
                <span>Max Colors: {crispMaxColors}</span>
                <input
                  type="range"
                  min={3}
                  max={24}
                  value={crispMaxColors}
                  onChange={(e) => setCrispMaxColors(Number(e.target.value))}
                  className="w-full"
                />
              </label>
            </div>

            {crispResult && (
              <>
                <div className="flex items-center justify-center rounded border border-borderFolk bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:8px_8px] p-2 min-h-[88px] overflow-hidden">
                  <img
                    src={crispResult.previewDataUrl}
                    alt="Crisp pixel art preview"
                    className="max-h-28 max-w-full object-contain pixel-canvas border border-borderFolk shadow-sm"
                  />
                </div>

                {/* Palette Swatches */}
                <div className="flex flex-wrap gap-1">
                  {crispResult.palette.map((hex) => (
                    <span
                      key={hex}
                      title={hex}
                      className="h-3.5 w-3.5 rounded-sm border border-borderFolk"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={isProcessing || !sourceImg}
                    onClick={() => handleAddSelection({ useCrisp: true })}
                    className="inline-flex items-center justify-center gap-1 rounded bg-emerald-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>Add Crisp Stamp</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyProceduralCode}
                    className="inline-flex items-center justify-center gap-1 rounded border border-borderFolk bg-surface px-2 py-1 text-[10px] font-medium hover:bg-card"
                  >
                    <Copy className="h-3 w-3" />
                    <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowProceduralCode((s) => !s)}
                  className="inline-flex items-center gap-1 text-[10px] text-indigoFolk hover:underline"
                >
                  <Code2 className="h-3 w-3" />
                  <span>{showProceduralCode ? 'Hide Procedural Code' : 'View Procedural Canvas2D Code'}</span>
                </button>

                {showProceduralCode && (
                  <pre className="max-h-40 overflow-auto thin-scroll rounded border border-borderFolk bg-stone-950 p-2 text-[9px] font-mono text-emerald-300">
                    {crispResult.proceduralCode}
                  </pre>
                )}
              </>
            )}
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
                    onClick={() => setTargetLayer(id as 'bg0' | 'bg1' | 'obj0' | 'obj1')}
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
              disabled={isProcessing || !sourceImg}
              onClick={() => handleAddSelection({ directPlace: false })}
              className="flex w-full items-center justify-center gap-1.5 rounded bg-crimson px-3 py-2 text-xs font-semibold text-white hover:bg-crimson/90 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Selection to Tileset &amp; Stamps</span>
            </button>

            <button
              type="button"
              disabled={isProcessing || !sourceImg}
              onClick={() => handleAddSelection({ directPlace: true })}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-indigoFolk bg-indigoFolk/10 px-3 py-1.5 text-xs font-medium text-indigoFolk hover:bg-indigoFolk/20 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Add &amp; Place at Map Center</span>
            </button>

            <button
              type="button"
              disabled={isProcessing || !sourceImg}
              onClick={handleConvertWholeMap}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-borderFolk bg-surface px-3 py-1.5 text-[11px] font-medium text-muted hover:bg-card hover:text-ink disabled:opacity-50"
            >
              <Maximize2 className="h-3 w-3" />
              <span>Convert Whole Image to Map</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
