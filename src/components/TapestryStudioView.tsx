import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookmarkPlus,
  Check,
  Code2,
  Copy,
  Crop,
  Eraser,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  Grid,
  Hand,
  Layers,
  Maximize2,
  PaintBucket,
  Palette,
  Pencil,
  Pipette,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
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
  generateProceduralCodeFromGrid,
  getOpaqueBounds,
  processTilePixels,
  rebuildCrispPixelArt,
  removeEdgeBackground,
  renderPixelGridToCanvases,
  sliceSelectionToTiles,
  type ChromaKeyFilter,
  type CropSelection,
} from '../engine/tapestrySampler';
import type { TileMacroStamp, VillageMap } from '../engine/types';
import { resolvePublicUrl } from '../utils/assetUrl';

type CanvasTool = 'frame' | 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'wand' | 'pan';
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type CropHoverAction = ResizeHandle | 'move' | null;
type InspectorTab = 'trace' | 'slicer' | 'library';
type TraceOverlayMode = 'lines' | 'dots' | 'both' | 'off';

const SUBTLE_CHECKER_STYLE: React.CSSProperties = {
  backgroundColor: '#1d1f24',
  backgroundImage:
    'linear-gradient(45deg, #272a32 25%, transparent 25%), linear-gradient(-45deg, #272a32 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #272a32 75%), linear-gradient(-45deg, transparent 75%, #272a32 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
};

interface AutoSliceItem {
  id: number;
  crop: CropSelection;
  selected: boolean;
}

export interface SavedPatternEntry {
  id: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  outCols: number;
  outRows: number;
  palette: string[];
  grid: number[];
  previewDataUrl: string;
  proceduralCode: string;
  createdAt: number;
}

const PATTERN_LIBRARY_STORAGE_KEY = 'seloai_pattern_library_v1';

function loadPatternLibrary(): SavedPatternEntry[] {
  try {
    const raw = window.localStorage.getItem(PATTERN_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePatternLibrary(items: SavedPatternEntry[]) {
  try {
    window.localStorage.setItem(PATTERN_LIBRARY_STORAGE_KEY, JSON.stringify(items.slice(0, 60)));
  } catch {
    // ignore storage quota errors
  }
}

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

  // Unified main canvas tool & navigation
  const [activeTool, setActiveTool] = useState<CanvasTool>('frame');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('trace');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [snapGrid, setSnapGrid] = useState<number>(tileDim);
  const [hoverAction, setHoverAction] = useState<CropHoverAction>(null);
  const [hoveredCell, setHoveredCell] = useState<{ gx: number; gy: number } | null>(null);

  // Layer visibility & opacity (Photoshop-style tracing over reference)
  const [refOpacity, setRefOpacity] = useState(100);
  const [traceLayerVisible, setTraceLayerVisible] = useState(true);
  const [traceLayerOpacity, setTraceLayerOpacity] = useState(85);
  const [traceOverlayMode, setTraceOverlayMode] = useState<TraceOverlayMode>('lines');
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);

  // Crop selection on source image
  const [crop, setCrop] = useState<CropSelection>({ x: 0, y: 0, w: tileDim * 3, h: tileDim * 3 });

  // Background Remover & Slicing Filters
  const [pixelate, setPixelate] = useState(true);
  const [trimAndFit, setTrimAndFit] = useState(true);
  const [enableChroma, setEnableChroma] = useState(false);
  const [chromaHex, setChromaHex] = useState('#ffffff');
  const [chromaTolerance, setChromaTolerance] = useState(20);
  const [pickingChromaKey, setPickingChromaKey] = useState(false);
  const [bgVersion, setBgVersion] = useState(0);

  // Auto-Slicer state
  const [autoSlices, setAutoSlices] = useState<AutoSliceItem[]>([]);
  const [sliceMergeGap, setSliceMergeGap] = useState(6);
  const [sliceMinSize, setSliceMinSize] = useState(10);

  // Pixel Trace Layer state (lives directly on top of the active crop on the main canvas)
  const [builderW, setBuilderW] = useState<number>(16);
  const [builderH, setBuilderH] = useState<number>(16);
  const [builderOutCols, setBuilderOutCols] = useState<number>(1);
  const [builderOutRows, setBuilderOutRows] = useState<number>(1);
  const [maxTraceColors, setMaxTraceColors] = useState<number>(6);
  const [builderGrid, setBuilderGrid] = useState<number[]>(() => new Array<number>(16 * 16).fill(-1));
  const [builderPalette, setBuilderPalette] = useState<string[]>([
    '#be1e2d',
    '#eab308',
    '#228b4a',
    '#2563eb',
    '#1f2937',
    '#f5f0e1',
  ]);
  const [activeColorIdx, setActiveColorIdx] = useState(0);
  const [rawCropPreviewUrl, setRawCropPreviewUrl] = useState<string>('');
  const [builderPreviewUrl, setBuilderPreviewUrl] = useState<string>('');
  const [builderCode, setBuilderCode] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState(false);

  // Saved Pattern Library
  const [patternLibrary, setPatternLibrary] = useState<SavedPatternEntry[]>(() =>
    typeof window !== 'undefined' ? loadPatternLibrary() : [],
  );

  // Target Stamp Config
  const [stampName, setStampName] = useState('Shevitsa Motif');
  const [targetLayer, setTargetLayer] = useState<'bg0' | 'bg1' | 'obj0' | 'obj1'>('bg1');
  const [blocksMovement, setBlocksMovement] = useState(false);

  // Status
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const bgUndoStackRef = useRef<ImageData[]>([]);
  const traceUndoStackRef = useRef<Array<{ grid: number[]; palette: string[] }>>([]);
  const [traceUndoCount, setTraceUndoCount] = useState(0);
  const strokeSavedRef = useRef(false);

  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<'none' | 'pan' | 'select' | 'move' | 'resize' | 'paint'>('none');
  const dragStartRef = useRef({ x: 0, y: 0 });
  const moveOffsetRef = useRef({ dx: 0, dy: 0, w: 0, h: 0 });
  const resizeStartRef = useRef<{ handle: ResizeHandle; orig: CropSelection }>({
    handle: 'se',
    orig: { x: 0, y: 0, w: 32, h: 32 },
  });
  const panStartRef = useRef({ x: 0, y: 0 });

  // Sync canvas backing buffer with CSS viewport
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

  const traceCropIntoLayer = (
    src: HTMLCanvasElement,
    srcW: number,
    srcH: number,
    targetCrop: CropSelection,
    targetW: number,
    targetH: number,
    maxColors: number,
    pushUndo: boolean = false,
  ) => {
    if (targetCrop.w <= 0 || targetCrop.h <= 0) return;
    if (pushUndo) {
      pushTraceUndo();
    }
    const res = rebuildCrispPixelArt(src, srcW, srcH, targetCrop, tileDim, {
      gridWidth: targetW,
      gridHeight: targetH,
      outCols: builderOutCols,
      outRows: builderOutRows,
      maxColors,
      fnName: stampName || 'Motif',
      chromaKey: getChromaFilter(),
      trimAndFit: false, // keep 1:1 geometric alignment directly over the reference crop!
    });
    setBuilderW(res.gridWidth);
    setBuilderH(res.gridHeight);
    setBuilderGrid(res.grid);
    setBuilderPalette(
      res.palette.length > 0
        ? res.palette
        : ['#be1e2d', '#eab308', '#228b4a', '#1f2937', '#f5f0e1'],
    );
    setActiveColorIdx(0);
  };

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
      bgUndoStackRef.current = [];
      traceUndoStackRef.current = [];
      setTraceUndoCount(0);
      setAutoSlices([]);
      setSourceImg(workCanvas);
      setBgVersion((v) => v + 1);
      setImgSrcUrl(url);
      setImgWidth(img.naturalWidth);
      setImgHeight(img.naturalHeight);
      setPan({ x: 0, y: 0 });
      setZoom(1);

      const initialW = Math.min(img.naturalWidth, tileDim * 3);
      const initialH = Math.min(img.naturalHeight, tileDim * 3);
      const startX = Math.floor((img.naturalWidth - initialW) / (2 * tileDim)) * tileDim;
      const startY = Math.floor((img.naturalHeight - initialH) / (2 * tileDim)) * tileDim;
      const initCrop = { x: Math.max(0, startX), y: Math.max(0, startY), w: initialW, h: initialH };
      setCrop(initCrop);
      traceCropIntoLayer(workCanvas, img.naturalWidth, img.naturalHeight, initCrop, builderW, builderH, maxTraceColors, false);

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
    setStampName('Shevitsa Motif');
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
            setStampName('Pasted Reference');
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    }
  };

  const pushBgUndoSnapshot = () => {
    if (!sourceImg) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    bgUndoStackRef.current = [...bgUndoStackRef.current.slice(-11), snap];
  };

  const pushTraceUndo = () => {
    traceUndoStackRef.current = [
      ...traceUndoStackRef.current.slice(-29),
      { grid: [...builderGrid], palette: [...builderPalette] },
    ];
    setTraceUndoCount(traceUndoStackRef.current.length);
  };

  const handleTraceUndo = () => {
    const prev = traceUndoStackRef.current.pop();
    setTraceUndoCount(traceUndoStackRef.current.length);
    if (prev) {
      setBuilderGrid(prev.grid);
      setBuilderPalette(prev.palette);
    }
  };

  const handleAutoRemoveBg = () => {
    if (!sourceImg) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    pushBgUndoSnapshot();
    const imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    removeEdgeBackground(imgData, chromaTolerance);
    ctx.putImageData(imgData, 0, 0);
    setBgVersion((v) => v + 1);
    setStatusMsg('Removed edge background');
  };

  const handleApplyColorKeyToImage = () => {
    if (!sourceImg) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    pushBgUndoSnapshot();
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
    setStatusMsg(`Removed ${chromaHex} across reference image`);
  };

  const handleUndoBg = () => {
    if (!sourceImg || bgUndoStackRef.current.length === 0) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    const last = bgUndoStackRef.current.pop();
    if (last) {
      ctx.putImageData(last, 0, 0);
      setBgVersion((v) => v + 1);
      setStatusMsg('Undid reference background edit');
    }
  };

  const handleResetImage = () => {
    if (!sourceImg || !originalImgRef.current) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    pushBgUndoSnapshot();
    ctx.clearRect(0, 0, sourceImg.width, sourceImg.height);
    ctx.drawImage(originalImgRef.current, 0, 0);
    setAutoSlices([]);
    setBgVersion((v) => v + 1);
    setStatusMsg('Reset reference image');
  };

  const handleAutoSlice = () => {
    if (!sourceImg) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;

    let imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    let hasTransparency = false;
    for (let i = 3; i < imgData.data.length; i += 4) {
      if (imgData.data[i] === 0) {
        hasTransparency = true;
        break;
      }
    }
    if (!hasTransparency) {
      pushBgUndoSnapshot();
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
      traceCropIntoLayer(sourceImg, imgWidth, imgHeight, items[0].crop, builderW, builderH, maxTraceColors, true);
      setStatusMsg(`Auto-sliced ${items.length} motifs`);
    } else {
      setStatusMsg('No distinct motifs found (adjust tolerance or min size)');
    }
  };

  // Tighten crop frame onto opaque bounds inside the current selection
  const handleTightenCropToMotif = () => {
    if (!sourceImg || crop.w <= 0 || crop.h <= 0) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    const sx = Math.max(0, Math.floor(crop.x));
    const sy = Math.max(0, Math.floor(crop.y));
    const sw = Math.max(1, Math.min(Math.round(crop.w), imgWidth - sx));
    const sh = Math.max(1, Math.min(Math.round(crop.h), imgHeight - sy));
    const data = ctx.getImageData(sx, sy, sw, sh);
    const bounds = getOpaqueBounds(data);
    if (!bounds) return;
    const nextCrop = {
      x: sx + bounds.x,
      y: sy + bounds.y,
      w: bounds.w,
      h: bounds.h,
    };
    setCrop(nextCrop);
    traceCropIntoLayer(sourceImg, imgWidth, imgHeight, nextCrop, builderW, builderH, maxTraceColors, true);
    setStatusMsg(`Tightened crop to ${nextCrop.w}×${nextCrop.h} px`);
  };

  // Zoom & center viewport cleanly onto the active crop frame for detailed tracing
  const handleZoomToCrop = () => {
    if (crop.w <= 0 || crop.h <= 0 || imgWidth <= 0 || imgHeight <= 0) return;
    const fitZoom = Math.min(
      12,
      Math.max(
        1,
        Math.min((canvasSize.w * 0.72) / crop.w, (canvasSize.h * 0.72) / crop.h),
      ),
    );
    const cropCx = crop.x + crop.w / 2 - imgWidth / 2;
    const cropCy = crop.y + crop.h / 2 - imgHeight / 2;
    setZoom(Number(fitZoom.toFixed(2)));
    setPan({
      x: -cropCx * fitZoom,
      y: -cropCy * fitZoom,
    });
  };

  const nudgeCrop = (dx: number, dy: number) => {
    setCrop((prev) => ({
      ...prev,
      x: Math.max(0, Math.min(Math.max(0, imgWidth - prev.w), prev.x + dx)),
      y: Math.max(0, Math.min(Math.max(0, imgHeight - prev.h), prev.y + dy)),
    }));
  };

  // Keyboard shortcuts: Arrows nudge in frame mode, B/E/G/I switch tools, Cmd/Ctrl+Z undo trace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleTraceUndo();
        return;
      }
      if (e.key === 'v' || e.key === 'V') setActiveTool('frame');
      if (e.key === 'b' || e.key === 'B') setActiveTool('pencil');
      if (e.key === 'e' || e.key === 'E') setActiveTool('eraser');
      if (e.key === 'g' || e.key === 'G') setActiveTool('fill');
      if (e.key === 'i' || e.key === 'I') setActiveTool('eyedropper');

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
  }, [imgWidth, imgHeight, builderGrid, builderPalette]);

  // Keep raw reference crop thumbnail + rebuilt trace preview & procedural code synced
  useEffect(() => {
    if (!sourceImg || crop.w <= 0 || crop.h <= 0) return;
    try {
      const sliced = sliceSelectionToTiles(sourceImg, imgWidth, imgHeight, crop, tileDim, {
        pixelate,
        trimAndFit,
        chromaKey: getChromaFilter(),
      });
      setRawCropPreviewUrl(sliced.previewDataUrl);
    } catch {
      // ignore
    }
  }, [sourceImg, bgVersion, crop, pixelate, trimAndFit, enableChroma, chromaHex, chromaTolerance, tileDim, imgWidth, imgHeight]);

  useEffect(() => {
    try {
      const code = generateProceduralCodeFromGrid(
        builderGrid,
        builderW,
        builderH,
        builderPalette,
        stampName || 'Motif',
      );
      setBuilderCode(code);
      const rendered = renderPixelGridToCanvases(
        builderGrid,
        builderW,
        builderH,
        builderPalette,
        builderOutCols,
        builderOutRows,
        tileDim,
      );
      setBuilderPreviewUrl(rendered.previewDataUrl);
    } catch {
      // ignore
    }
  }, [builderGrid, builderPalette, builderW, builderH, builderOutCols, builderOutRows, tileDim, stampName]);

  // Main unified layered canvas renderer
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

    // 1. Transparency checkerboard backdrop
    const checkSize = Math.max(8, Math.round(16 / Math.max(1, zoom)));
    ctx.fillStyle = '#242428';
    ctx.fillRect(0, 0, imgWidth, imgHeight);
    ctx.fillStyle = '#313136';
    for (let cy = 0; cy < imgHeight; cy += checkSize) {
      for (let cx = 0; cx < imgWidth; cx += checkSize) {
        if (((Math.floor(cx / checkSize) + Math.floor(cy / checkSize)) & 1) === 0) {
          ctx.fillRect(cx, cy, Math.min(checkSize, imgWidth - cx), Math.min(checkSize, imgHeight - cy));
        }
      }
    }

    // 2. Reference Image Layer (at adjustable refOpacity)
    ctx.save();
    ctx.globalAlpha = refOpacity / 100;
    ctx.drawImage(sourceImg, 0, 0, imgWidth, imgHeight);
    ctx.restore();

    // 3. Optional source tile/snap grid overlay
    if (showGrid && snapGrid > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
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

    // 4. Auto-Slicer motif boxes
    for (const item of autoSlices) {
      const r = item.crop;
      ctx.strokeStyle = item.selected ? '#22d3ee' : 'rgba(148, 163, 184, 0.65)';
      ctx.lineWidth = (item.selected ? 1.5 : 1) / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);

      const badgeSize = Math.max(10, 13 / zoom);
      ctx.fillStyle = item.selected ? 'rgba(8, 145, 178, 0.9)' : 'rgba(51, 65, 85, 0.85)';
      ctx.fillRect(r.x, Math.max(0, r.y - badgeSize), badgeSize * 1.4, badgeSize);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(8, Math.round(10 / zoom))}px monospace`;
      ctx.fillText(String(item.id), r.x + 2 / zoom, Math.max(badgeSize * 0.75, r.y - 2 / zoom));
    }

    // 5. Active Crop Dimming + Top Pixel Trace Layer + Resize Frame
    if (crop.w > 0 && crop.h > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.fillRect(0, 0, imgWidth, crop.y);
      ctx.fillRect(0, crop.y + crop.h, imgWidth, imgHeight - (crop.y + crop.h));
      ctx.fillRect(0, crop.y, crop.x, crop.h);
      ctx.fillRect(crop.x + crop.w, crop.y, imgWidth - (crop.x + crop.w), crop.h);

      const cellW = crop.w / builderW;
      const cellH = crop.h / builderH;

      // Top Pixel Stitch Layer rendered directly over the active crop on the reference!
      if (traceLayerVisible && traceLayerOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = traceLayerOpacity / 100;
        for (let gy = 0; gy < builderH; gy++) {
          for (let gx = 0; gx < builderW; gx++) {
            const cIdx = builderGrid[gy * builderW + gx];
            if (cIdx !== undefined && cIdx >= 0 && cIdx < builderPalette.length) {
              ctx.fillStyle = builderPalette[cIdx];
              ctx.fillRect(crop.x + gx * cellW, crop.y + gy * cellH, cellW + 0.05, cellH + 0.05);
            }
          }
        }
        ctx.restore();
      }

      // Stitch / Pixel trace grid & optional center-dot overlay inside crop
      if (traceOverlayMode === 'lines' || traceOverlayMode === 'both') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 0.75 / zoom;
        ctx.beginPath();
        for (let gx = 1; gx < builderW; gx++) {
          const sx = crop.x + gx * cellW;
          ctx.moveTo(sx, crop.y);
          ctx.lineTo(sx, crop.y + crop.h);
        }
        for (let gy = 1; gy < builderH; gy++) {
          const sy = crop.y + gy * cellH;
          ctx.moveTo(crop.x, sy);
          ctx.lineTo(crop.x + crop.w, sy);
        }
        ctx.stroke();
      }

      if (traceOverlayMode === 'dots' || traceOverlayMode === 'both') {
        const dotRadius = Math.max(0.55 / zoom, Math.min(cellW, cellH) * 0.14);
        const haloRadius = dotRadius + 0.35 / zoom;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.48)';
        ctx.beginPath();
        for (let gy = 0; gy < builderH; gy++) {
          const cy = crop.y + (gy + 0.5) * cellH;
          for (let gx = 0; gx < builderW; gx++) {
            const cx = crop.x + (gx + 0.5) * cellW;
            ctx.moveTo(cx + haloRadius, cy);
            ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
          }
        }
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
        ctx.beginPath();
        for (let gy = 0; gy < builderH; gy++) {
          const cy = crop.y + (gy + 0.5) * cellH;
          for (let gx = 0; gx < builderW; gx++) {
            const cx = crop.x + (gx + 0.5) * cellW;
            ctx.moveTo(cx + dotRadius, cy);
            ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }

      // Tile output subdivisions inside trace frame
      if (traceOverlayMode !== 'off' && (builderOutCols > 1 || builderOutRows > 1)) {
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
        ctx.lineWidth = 1.2 / zoom;
        ctx.beginPath();
        for (let c = 1; c < builderOutCols; c++) {
          const sx = crop.x + (c * crop.w) / builderOutCols;
          ctx.moveTo(sx, crop.y);
          ctx.lineTo(sx, crop.y + crop.h);
        }
        for (let r = 1; r < builderOutRows; r++) {
          const sy = crop.y + (r * crop.h) / builderOutRows;
          ctx.moveTo(crop.x, sy);
          ctx.lineTo(crop.x + crop.w, sy);
        }
        ctx.stroke();
      }

      // Symmetry guides when painting
      if (activeTool === 'pencil' || activeTool === 'eraser' || activeTool === 'fill') {
        if (mirrorX) {
          const mx = crop.x + crop.w / 2;
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
          ctx.lineWidth = 1.2 / zoom;
          ctx.setLineDash([4 / zoom, 3 / zoom]);
          ctx.beginPath();
          ctx.moveTo(mx, crop.y);
          ctx.lineTo(mx, crop.y + crop.h);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (mirrorY) {
          const my = crop.y + crop.h / 2;
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
          ctx.lineWidth = 1.2 / zoom;
          ctx.setLineDash([4 / zoom, 3 / zoom]);
          ctx.beginPath();
          ctx.moveTo(crop.x, my);
          ctx.lineTo(crop.x + crop.w, my);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Hovered pixel cell highlight when using paint tools
      if (
        hoveredCell &&
        (activeTool === 'pencil' || activeTool === 'eraser' || activeTool === 'fill' || activeTool === 'eyedropper')
      ) {
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1.5 / zoom;
        ctx.strokeRect(
          crop.x + hoveredCell.gx * cellW,
          crop.y + hoveredCell.gy * cellH,
          cellW,
          cellH,
        );
      }

      // Frame border & 8 resize handles
      ctx.strokeStyle = '#be1e2d';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.setLineDash([]);

      if (activeTool === 'frame') {
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
    }

    ctx.restore();
  }, [
    sourceImg,
    bgVersion,
    imgWidth,
    imgHeight,
    zoom,
    pan,
    refOpacity,
    showGrid,
    snapGrid,
    crop,
    canvasSize,
    autoSlices,
    traceLayerVisible,
    traceLayerOpacity,
    traceOverlayMode,
    builderGrid,
    builderPalette,
    builderW,
    builderH,
    builderOutCols,
    builderOutRows,
    activeTool,
    mirrorX,
    mirrorY,
    hoveredCell,
  ]);

  // Convert pointer event to floating and clamped pixel coords in reference image space
  const canvasToImageCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || imgWidth <= 0 || imgHeight <= 0) return { x: 0, y: 0, ox: 0, oy: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    const ox = (cx - (canvas.width / 2 + pan.x)) / zoom + imgWidth / 2;
    const oy = (cy - (canvas.height / 2 + pan.y)) / zoom + imgHeight / 2;

    return {
      ox,
      oy,
      x: Math.max(0, Math.min(imgWidth - 1, Math.floor(ox))),
      y: Math.max(0, Math.min(imgHeight - 1, Math.floor(oy))),
    };
  };

  const imageToTraceCell = (ox: number, oy: number) => {
    if (crop.w <= 0 || crop.h <= 0) return null;
    if (ox < crop.x || ox >= crop.x + crop.w || oy < crop.y || oy >= crop.y + crop.h) return null;
    const gx = Math.min(builderW - 1, Math.max(0, Math.floor(((ox - crop.x) / crop.w) * builderW)));
    const gy = Math.min(builderH - 1, Math.max(0, Math.floor(((oy - crop.y) / crop.h) * builderH)));
    return { gx, gy };
  };

  const hitTestCropAction = (ox: number, oy: number): CropHoverAction => {
    if (crop.w <= 0 || crop.h <= 0) return null;
    const tol = Math.max(5, Math.round(7 / zoom));
    const left = crop.x;
    const right = crop.x + crop.w;
    const top = crop.y;
    const bottom = crop.y + crop.h;

    if (ox < left - tol || ox > right + tol || oy < top - tol || oy > bottom + tol) {
      return null;
    }

    const nearLeft = Math.abs(ox - left) <= tol;
    const nearRight = Math.abs(ox - right) <= tol;
    const nearTop = Math.abs(oy - top) <= tol;
    const nearBottom = Math.abs(oy - bottom) <= tol;

    if (nearTop && nearLeft) return 'nw';
    if (nearTop && nearRight) return 'ne';
    if (nearBottom && nearLeft) return 'sw';
    if (nearBottom && nearRight) return 'se';
    if (nearTop) return 'n';
    if (nearBottom) return 's';
    if (nearLeft) return 'w';
    if (nearRight) return 'e';
    if (ox >= left && ox < right && oy >= top && oy < bottom) return 'move';
    return null;
  };

  const paintTraceCell = (gx: number, gy: number, value: number) => {
    setBuilderGrid((prev) => {
      const next = [...prev];
      const points: Array<[number, number]> = [[gx, gy]];
      if (mirrorX) points.push([builderW - 1 - gx, gy]);
      if (mirrorY) points.push([gx, builderH - 1 - gy]);
      if (mirrorX && mirrorY) points.push([builderW - 1 - gx, builderH - 1 - gy]);

      let changed = false;
      for (const [px, py] of points) {
        const idx = py * builderW + px;
        if (idx >= 0 && idx < next.length && next[idx] !== value) {
          next[idx] = value;
          changed = true;
        }
      }
      if (!changed) return prev;
      if (!strokeSavedRef.current) {
        traceUndoStackRef.current = [
          ...traceUndoStackRef.current.slice(-29),
          { grid: [...prev], palette: [...builderPalette] },
        ];
        setTraceUndoCount(traceUndoStackRef.current.length);
        strokeSavedRef.current = true;
      }
      return next;
    });
  };

  const floodFillTraceCell = (startX: number, startY: number, fillVal: number) => {
    const startIdx = startY * builderW + startX;
    const targetVal = builderGrid[startIdx];
    if (targetVal === fillVal) return;

    pushTraceUndo();
    const next = [...builderGrid];
    const visited = new Uint8Array(builderW * builderH);
    const queue = [startIdx];
    visited[startIdx] = 1;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      next[idx] = fillVal;
      const x = idx % builderW;
      const y = (idx - x) / builderW;
      const neighbors: number[] = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x + 1 < builderW) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - builderW);
      if (y + 1 < builderH) neighbors.push(idx + builderW);
      for (const n of neighbors) {
        if (!visited[n] && next[n] === targetVal) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }

    setBuilderGrid(next);
  };

  const sampleColorFromRefAt = (x: number, y: number): string | null => {
    if (!sourceImg) return null;
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(sourceImg, x, y, 1, 1, 0, 0, 1, 1);
    const p = ctx.getImageData(0, 0, 1, 1).data;
    if (p[3] === 0) return null;
    return `#${((1 << 24) + (p[0] << 16) + (p[1] << 8) + p[2]).toString(16).slice(1)}`;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || activeTool === 'pan' || (activeTool === 'frame' && e.altKey)) {
      isDraggingRef.current = true;
      dragModeRef.current = 'pan';
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const { x, y, ox, oy } = canvasToImageCoords(e);

    if (pickingChromaKey && sourceImg) {
      const hex = sampleColorFromRefAt(x, y);
      if (hex) {
        setChromaHex(hex);
        setEnableChroma(true);
      }
      setPickingChromaKey(false);
      return;
    }

    if (activeTool === 'eyedropper' || (e.altKey && (activeTool === 'pencil' || activeTool === 'fill'))) {
      // Shift+Click picks from existing painted layer if opaque; regular click samples true reference color!
      const cell = imageToTraceCell(ox, oy);
      if (e.shiftKey && cell) {
        const idx = builderGrid[cell.gy * builderW + cell.gx];
        if (idx !== undefined && idx >= 0 && idx < builderPalette.length) {
          setActiveColorIdx(idx);
          setActiveTool('pencil');
          setStatusMsg(`Picked swatch #${idx + 1} (${builderPalette[idx]})`);
          return;
        }
      }
      const hex = sampleColorFromRefAt(x, y);
      if (hex) {
        const existingIdx = builderPalette.indexOf(hex);
        if (existingIdx >= 0) {
          setActiveColorIdx(existingIdx);
        } else {
          setBuilderPalette((prev) => {
            const next = [...prev, hex];
            setActiveColorIdx(next.length - 1);
            return next;
          });
        }
        setActiveTool('pencil');
        setStatusMsg(`Sampled ${hex} from reference`);
      }
      return;
    }

    if (activeTool === 'wand' && sourceImg) {
      const ctx = sourceImg.getContext('2d');
      if (ctx) {
        pushBgUndoSnapshot();
        const imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
        floodFillTransparent(imgData, [{ x, y }], chromaTolerance);
        ctx.putImageData(imgData, 0, 0);
        setBgVersion((v) => v + 1);
        setStatusMsg(`Removed background region at (${x}, ${y})`);
      }
      return;
    }

    // Interactive Painting / Tracing directly on top of the active crop on the main canvas
    if (activeTool === 'pencil' || activeTool === 'eraser' || activeTool === 'fill') {
      const cell = imageToTraceCell(ox, oy);
      if (!cell) {
        setStatusMsg('Click inside the red crop frame to paint over the reference');
        return;
      }

      if (activeTool === 'fill') {
        floodFillTraceCell(cell.gx, cell.gy, activeColorIdx);
        return;
      }

      isDraggingRef.current = true;
      dragModeRef.current = 'paint';
      strokeSavedRef.current = false;
      const val = e.button === 2 || activeTool === 'eraser' ? -1 : activeColorIdx;
      paintTraceCell(cell.gx, cell.gy, val);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Frame tool: resize handles / move / new box selection
    const hitAction = !e.metaKey && !e.ctrlKey ? hitTestCropAction(ox, oy) : null;
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
    const { x, y, ox, oy } = canvasToImageCoords(e);

    if (!isDraggingRef.current) {
      if (activeTool === 'frame') {
        const nextHover = hitTestCropAction(ox, oy);
        if (nextHover !== hoverAction) setHoverAction(nextHover);
        if (hoveredCell !== null) setHoveredCell(null);
      } else {
        if (hoverAction !== null) setHoverAction(null);
        const cell = imageToTraceCell(ox, oy);
        if (cell?.gx !== hoveredCell?.gx || cell?.gy !== hoveredCell?.gy) {
          setHoveredCell(cell);
        }
      }
      return;
    }

    if (dragModeRef.current === 'pan' || activeTool === 'pan' || e.buttons === 4) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    if (dragModeRef.current === 'paint') {
      const cell = imageToTraceCell(ox, oy);
      if (cell) {
        setHoveredCell(cell);
        const val = e.buttons === 2 || activeTool === 'eraser' ? -1 : activeColorIdx;
        paintTraceCell(cell.gx, cell.gy, val);
      }
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

      if (handle.includes('w')) left = Math.max(0, Math.min(right - minSize, snapVal(x)));
      if (handle.includes('e')) right = Math.min(imgWidth, Math.max(left + minSize, snapVal(x + 1)));
      if (handle.includes('n')) top = Math.max(0, Math.min(bottom - minSize, snapVal(y)));
      if (handle.includes('s')) bottom = Math.min(imgHeight, Math.max(top + minSize, snapVal(y + 1)));

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
    strokeSavedRef.current = false;
  };

  const setBuilderResolution = (nextW: number, nextH: number) => {
    const w = Math.max(4, Math.min(128, nextW));
    const h = Math.max(4, Math.min(128, nextH));
    setBuilderW(w);
    setBuilderH(h);
    if (sourceImg) {
      traceCropIntoLayer(sourceImg, imgWidth, imgHeight, crop, w, h, maxTraceColors, true);
    } else {
      setBuilderGrid(new Array<number>(w * h).fill(-1));
    }
  };

  const handleMatchCropGrid = () => {
    if (crop.w <= 0 || crop.h <= 0) return;
    const minSide = Math.max(8, Math.min(24, Math.min(builderW, builderH)));
    const aspect = crop.w / Math.max(1, crop.h);
    const nextW = Math.max(6, Math.min(64, aspect >= 1 ? Math.round(minSide * aspect) : minSide));
    const nextH = Math.max(6, Math.min(64, aspect >= 1 ? minSide : Math.round(minSide / aspect)));
    const nextOutCols = Math.max(1, Math.min(6, aspect >= 1 ? Math.round(crop.w / Math.max(1, crop.h)) : 1));
    const nextOutRows = Math.max(1, Math.min(6, aspect >= 1 ? 1 : Math.round(crop.h / Math.max(1, crop.w))));
    setBuilderOutCols(nextOutCols);
    setBuilderOutRows(nextOutRows);
    setBuilderResolution(nextW, nextH);
    setStatusMsg(`Matched stitch grid to crop aspect (${nextW}×${nextH} → ${nextOutCols}×${nextOutRows} tiles)`);
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

  const saveCurrentPatternToLibrary = (): SavedPatternEntry => {
    const rendered = renderPixelGridToCanvases(
      builderGrid,
      builderW,
      builderH,
      builderPalette,
      builderOutCols,
      builderOutRows,
      tileDim,
    );
    const code = generateProceduralCodeFromGrid(
      builderGrid,
      builderW,
      builderH,
      builderPalette,
      stampName || 'Motif',
    );
    const entry: SavedPatternEntry = {
      id: `pat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: stampName || `Motif (${builderW}×${builderH})`,
      gridWidth: builderW,
      gridHeight: builderH,
      outCols: builderOutCols,
      outRows: builderOutRows,
      palette: [...builderPalette],
      grid: [...builderGrid],
      previewDataUrl: rendered.previewDataUrl,
      proceduralCode: code,
      createdAt: Date.now(),
    };
    const nextLib = [entry, ...patternLibrary];
    setPatternLibrary(nextLib);
    savePatternLibrary(nextLib);
    return entry;
  };

  // Save traced pixel pattern to Library + Tileset/Map
  const handleSaveTracedPattern = async (options: { addToTileset?: boolean; directPlace?: boolean } = {}) => {
    setIsProcessing(true);
    setStatusMsg(options.addToTileset ? 'Saving pattern & adding tileset stamp…' : 'Saving to Pattern Library…');
    try {
      const entry = saveCurrentPatternToLibrary();

      if (options.addToTileset) {
        const rendered = renderPixelGridToCanvases(
          entry.grid,
          entry.gridWidth,
          entry.gridHeight,
          entry.palette,
          entry.outCols,
          entry.outRows,
          tileDim,
        );
        const existingImg = await loadExistingTileset();
        const appended = await appendTilesToTileset(
          existingImg,
          map.tileSetDimX,
          map.tileSetDimY,
          tileDim,
          rendered.canvases,
        );
        const stamp = createMacroStampFromIndices(
          entry.name,
          entry.outCols,
          entry.outRows,
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
        setStatusMsg(`Saved "${entry.name}" to Pattern Library & Tileset!`);
      } else {
        setStatusMsg(`Saved "${entry.name}" to Pattern Library`);
      }
    } catch (err) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Raw image slice add (bypass trace grid if desired)
  const handleAddRawCropStamp = async () => {
    if (!sourceImg || crop.w <= 0 || crop.h <= 0) return;
    setIsProcessing(true);
    setStatusMsg('Adding raw crop tiles to tileset…');
    try {
      const sliced = sliceSelectionToTiles(sourceImg, imgWidth, imgHeight, crop, tileDim, {
        pixelate,
        trimAndFit,
        chromaKey: getChromaFilter(),
      });
      const existingImg = await loadExistingTileset();
      const appended = await appendTilesToTileset(
        existingImg,
        map.tileSetDimX,
        map.tileSetDimY,
        tileDim,
        sliced.canvases,
      );
      const stamp = createMacroStampFromIndices(
        `${stampName || 'Motif'} (Raw)`,
        sliced.cols,
        sliced.rows,
        appended.tileIndices,
        targetLayer,
        blocksMovement,
      );
      commitStampToMap({
        tilesetUrl: appended.newTilesetUrl,
        tilesetDimX: appended.newDimX,
        tilesetDimY: appended.newDimY,
        stamps: [stamp],
      });
      setStatusMsg(`Added raw crop "${stamp.name}" to Tileset`);
    } catch (err) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

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

      setStatusMsg(`Batch-added ${newStamps.length} motif stamps to Tileset`);
    } catch (err) {
      setStatusMsg(`Batch error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

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

  const handleLoadSavedPattern = (entry: SavedPatternEntry) => {
    pushTraceUndo();
    setStampName(entry.name);
    setBuilderW(entry.gridWidth);
    setBuilderH(entry.gridHeight);
    setBuilderOutCols(entry.outCols);
    setBuilderOutRows(entry.outRows);
    setBuilderPalette([...entry.palette]);
    setBuilderGrid([...entry.grid]);
    setTraceLayerVisible(true);
    setStatusMsg(`Loaded "${entry.name}" onto Pixel Trace Layer`);
  };

  const handleAddSavedPatternToTileset = async (entry: SavedPatternEntry) => {
    setIsProcessing(true);
    try {
      const rendered = renderPixelGridToCanvases(
        entry.grid,
        entry.gridWidth,
        entry.gridHeight,
        entry.palette,
        entry.outCols,
        entry.outRows,
        tileDim,
      );
      const existingImg = await loadExistingTileset();
      const appended = await appendTilesToTileset(
        existingImg,
        map.tileSetDimX,
        map.tileSetDimY,
        tileDim,
        rendered.canvases,
      );
      const stamp = createMacroStampFromIndices(
        entry.name,
        entry.outCols,
        entry.outRows,
        appended.tileIndices,
        targetLayer,
        blocksMovement,
      );
      commitStampToMap({
        tilesetUrl: appended.newTilesetUrl,
        tilesetDimX: appended.newDimX,
        tilesetDimY: appended.newDimY,
        stamps: [stamp],
      });
      setStatusMsg(`Added "${entry.name}" to Tileset`);
    } catch (err) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyCode = async (text?: string) => {
    const val = text ?? builderCode;
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      setStatusMsg('Clipboard copy unavailable; select code below.');
    }
  };

  const selectedSliceCount = autoSlices.filter((s) => s.selected).length;

  // Compute cursor class for unified main canvas
  const canvasCursorClass =
    activeTool === 'pan'
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'frame'
        ? hoverAction === 'nw' || hoverAction === 'se'
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
        : 'cursor-crosshair';

  return (
    <div
      className="flex h-full w-full flex-col bg-linen text-ink overflow-hidden"
      onPaste={handlePaste}
      tabIndex={-1}
    >
      {/* Top Studio Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-borderFolk bg-card px-4 py-1.5 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-crimson/15 text-crimson">
            <Palette className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-sm font-bold leading-tight">
              Tapestry Studio &amp; Pattern Digitizer
            </h2>
            <p className="text-[11px] text-muted">
              Import a reference photo, trace pixels directly as a layer on top, and save clean patterns to your library.
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
        {/* Main Unified Layered Canvas Viewport */}
        <div className="relative flex flex-1 flex-col bg-stone-950 overflow-hidden">
          {/* Unified Layer & Drawing Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white shrink-0">
            {/* Import + Primary Tools */}
            <div className="flex flex-wrap items-center gap-1">
              <label className="inline-flex cursor-pointer items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20">
                <Upload className="h-3 w-3" />
                <span>Image</span>
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
                <span>Sample</span>
              </button>

              <div className="mx-1 h-4 w-px bg-white/15" />

              {/* Unified Canvas Tool Palette */}
              {[
                ['frame', 'Frame (V) - Select/Move/Resize Crop', SquareDashedMousePointer],
                ['pencil', 'Trace Pencil (B) - Paint Pixel Layer', Pencil],
                ['eraser', 'Eraser (E) - Clear Pixel Cell', Eraser],
                ['fill', 'Flood Fill (G)', PaintBucket],
                ['eyedropper', 'Eyedropper (I) - Sample Ref Color', Pipette],
                ['wand', 'Magic Wand - Erase Ref Background', Wand2],
                ['pan', 'Pan Viewport', Hand],
              ].map(([id, title, Icon]) => {
                const IconComp = Icon as React.ComponentType<{ className?: string }>;
                return (
                  <button
                    key={id as string}
                    type="button"
                    onClick={() => {
                      setActiveTool(id as CanvasTool);
                      setPickingChromaKey(false);
                    }}
                    title={title as string}
                    className={`rounded p-1.5 transition ${
                      activeTool === id
                        ? 'bg-crimson text-white shadow-sm'
                        : 'text-white/75 hover:bg-white/15'
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
                title="Symmetry X"
                className={`rounded px-1.5 py-1 text-[10px] inline-flex items-center gap-0.5 ${
                  mirrorX ? 'bg-indigo-600 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                <FlipHorizontal2 className="h-3 w-3" />
                <span>X</span>
              </button>
              <button
                type="button"
                onClick={() => setMirrorY((m) => !m)}
                title="Symmetry Y"
                className={`rounded px-1.5 py-1 text-[10px] inline-flex items-center gap-0.5 ${
                  mirrorY ? 'bg-indigo-600 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                <FlipVertical2 className="h-3 w-3" />
                <span>Y</span>
              </button>
              <button
                type="button"
                onClick={handleTraceUndo}
                disabled={traceUndoCount === 0}
                title="Undo Trace Stroke (Cmd/Ctrl+Z)"
                className="rounded bg-white/10 p-1 text-white/80 hover:bg-white/20 disabled:opacity-40"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Layer Visibility, Opacity & Zoom */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px]">
                <span className="text-white/60">Ref</span>
                <input
                  type="range"
                  min={15}
                  max={100}
                  value={refOpacity}
                  onChange={(e) => setRefOpacity(Number(e.target.value))}
                  title={`Reference Image Opacity: ${refOpacity}%`}
                  className="w-14"
                />
              </div>

              <div className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setTraceLayerVisible((v) => !v)}
                  title="Toggle Pixel Trace Layer Visibility"
                  className={traceLayerVisible ? 'text-cyan-400' : 'text-white/40'}
                >
                  {traceLayerVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <span className="text-white/60">Trace</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={traceLayerOpacity}
                  onChange={(e) => setTraceLayerOpacity(Number(e.target.value))}
                  title={`Trace Pixel Layer Opacity: ${traceLayerOpacity}% (set 0% to inspect raw reference + dots)`}
                  className="w-14"
                />
              </div>

              <div
                className="flex items-center rounded bg-black/30 p-0.5 text-[10px]"
                title="Crop Stitch Grid & Dot Overlay"
              >
                {(['lines', 'dots', 'both', 'off'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTraceOverlayMode(mode)}
                    className={`rounded px-1.5 py-0.5 capitalize transition ${
                      traceOverlayMode === mode
                        ? 'bg-white/20 font-semibold text-white'
                        : 'text-white/55 hover:text-white/85'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowGrid((g) => !g)}
                title="Toggle Reference Sheet Tile Grid"
                className={`rounded p-1 ${showGrid ? 'bg-white/20 text-white' : 'text-white/45 hover:bg-white/10'}`}
              >
                <Grid className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={handleZoomToCrop}
                title="Zoom & Fit Active Crop Frame to Viewport"
                className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-1 text-[10px] text-white/90 hover:bg-white/20"
              >
                <Focus className="h-3 w-3" />
                <span>Fit Crop</span>
              </button>

              <div className="flex items-center gap-0.5 border-l border-white/10 pl-1.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.5).toFixed(2))))}
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
                  onClick={() => setZoom((z) => Math.min(16, Number((z + 0.5).toFixed(2))))}
                  className="rounded p-1 hover:bg-white/10"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Layered Canvas */}
          <div
            ref={viewportRef}
            onContextMenu={(e) => e.preventDefault()}
            className={`relative flex-1 overflow-hidden select-none ${canvasCursorClass}`}
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

            <div className="absolute top-2 left-2 rounded bg-black/65 px-2 py-0.5 text-[10px] font-mono text-white/80 backdrop-blur-sm pointer-events-none">
              {imgWidth > 0
                ? `${imgWidth}×${imgHeight} ref · Crop ${crop.w}×${crop.h} → Trace ${builderW}×${builderH}`
                : 'Import an image to start'}
            </div>
          </div>
        </div>

        {/* Right Merged Inspector Panel with Tabs */}
        <aside className="w-96 border-l border-borderFolk bg-surface flex flex-col overflow-hidden shrink-0">
          {/* RHS Feature Tabs */}
          <div className="grid grid-cols-3 border-b border-borderFolk bg-card p-1 gap-1 shrink-0">
            {[
              ['trace', 'Pattern & Trace'],
              ['slicer', 'BG & Slicer'],
              ['library', `Library (${patternLibrary.length})`],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setInspectorTab(id as InspectorTab)}
                className={`rounded px-2 py-1.5 text-[11px] font-medium transition ${
                  inspectorTab === id
                    ? 'bg-crimson text-white font-semibold shadow-sm'
                    : 'text-muted hover:bg-surface hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Scrollable Tab Content */}
          <div className="flex-1 overflow-y-auto thin-scroll p-3 space-y-3">
            {inspectorTab === 'trace' && (
              <>
                {/* Merged Preview (Raw Sample vs Traced Pixel Layer) */}
                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Pattern Preview
                    </span>
                    <span className="font-mono text-[10px] text-crimson font-semibold">
                      {builderW}×{builderH} · {builderPalette.length}c → {builderOutCols}×{builderOutRows} tiles
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="block text-center text-[9px] uppercase tracking-wider text-muted">
                        Ref Crop ({crop.w}×{crop.h})
                      </span>
                      <div
                        style={SUBTLE_CHECKER_STYLE}
                        className="flex items-center justify-center rounded border border-borderFolk p-1.5 h-24 overflow-hidden"
                      >
                        {rawCropPreviewUrl ? (
                          <img
                            src={rawCropPreviewUrl}
                            alt="Source crop"
                            className="max-h-full max-w-full object-contain pixel-canvas"
                          />
                        ) : (
                          <span className="text-[10px] text-white/50">—</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="block text-center text-[9px] uppercase tracking-wider text-muted">
                        Traced Layer ({builderW}×{builderH})
                      </span>
                      <div
                        style={SUBTLE_CHECKER_STYLE}
                        className="flex items-center justify-center rounded border border-crimson/50 p-1.5 h-24 overflow-hidden"
                      >
                        {builderPreviewUrl ? (
                          <img
                            src={builderPreviewUrl}
                            alt="Traced pixel pattern"
                            className="max-h-full max-w-full object-contain pixel-canvas"
                          />
                        ) : (
                          <span className="text-[10px] text-white/50">Trace or paint</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pixelate}
                        onChange={(e) => setPixelate(e.target.checked)}
                      />
                      <span>Pixelate Raw</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={trimAndFit}
                        onChange={(e) => setTrimAndFit(e.target.checked)}
                      />
                      <span>Trim &amp; Fit Raw</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleTightenCropToMotif}
                      title="Shrink crop box to non-transparent motif bounds"
                      className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] hover:bg-card"
                    >
                      <Crop className="h-3 w-3" />
                      <span>Fit Frame</span>
                    </button>
                  </div>
                </div>

                {/* Interactive Grid Size, Crop Nudge & Auto-Trace */}
                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Grid Size &amp; Auto-Trace
                    </span>
                    <button
                      type="button"
                      onClick={handleMatchCropGrid}
                      title="Size stitch grid proportionally to the current crop aspect ratio"
                      className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] font-medium hover:bg-card"
                    >
                      <Maximize2 className="h-2.5 w-2.5" />
                      <span>Match Crop</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-5 gap-1 text-[10px]">
                    {[8, 16, 24, 32, 48].map((dim) => (
                      <button
                        key={dim}
                        type="button"
                        onClick={() => setBuilderResolution(dim, dim)}
                        className={`rounded border px-1 py-0.5 font-mono ${
                          builderW === dim && builderH === dim
                            ? 'border-crimson bg-crimson/10 font-bold text-crimson'
                            : 'border-borderFolk bg-surface hover:bg-card'
                        }`}
                      >
                        {dim}×{dim}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] text-muted">
                    <label className="space-y-0.5">
                      <span>Grid W (px)</span>
                      <input
                        type="number"
                        min={4}
                        max={128}
                        value={builderW}
                        onChange={(e) => setBuilderResolution(Number(e.target.value), builderH)}
                        className="w-full rounded border border-borderFolk bg-surface px-1.5 py-1 font-mono text-xs text-ink"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span>Grid H (px)</span>
                      <input
                        type="number"
                        min={4}
                        max={128}
                        value={builderH}
                        onChange={(e) => setBuilderResolution(builderW, Number(e.target.value))}
                        className="w-full rounded border border-borderFolk bg-surface px-1.5 py-1 font-mono text-xs text-ink"
                      />
                    </label>
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-muted">
                      <span>Sampled Colors</span>
                      <span className="font-mono">{maxTraceColors} colors</span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={24}
                      value={maxTraceColors}
                      onChange={(e) => setMaxTraceColors(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={!sourceImg}
                      onClick={() =>
                        sourceImg &&
                        traceCropIntoLayer(
                          sourceImg,
                          imgWidth,
                          imgHeight,
                          crop,
                          builderW,
                          builderH,
                          maxTraceColors,
                          true,
                        )
                      }
                      className="inline-flex items-center justify-center gap-1 rounded bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Trace Crop → Layer</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        pushTraceUndo();
                        setBuilderGrid(new Array<number>(builderW * builderH).fill(-1));
                        setActiveTool('pencil');
                      }}
                      className="inline-flex items-center justify-center gap-1 rounded border border-borderFolk bg-surface px-2 py-1 text-[11px] hover:bg-card"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Blank Layer</span>
                    </button>
                  </div>

                  {/* Frame Nudge & Tile Snap */}
                  <div className="flex items-center justify-between gap-1 border-t border-borderFolk/60 pt-1.5">
                    <select
                      aria-label="Frame snap size"
                      value={snapGrid}
                      onChange={(e) => setSnapGrid(Number(e.target.value))}
                      className="rounded border border-borderFolk bg-surface px-1 py-0.5 text-[10px]"
                    >
                      <option value={tileDim}>Snap {tileDim}px</option>
                      <option value={16}>Snap 16px</option>
                      <option value={1}>Free 1px</option>
                    </select>
                    <div className="flex items-center gap-0.5">
                      <span className="text-[10px] text-muted mr-1">Nudge:</span>
                      {[
                        [-1, 0, ArrowLeft],
                        [0, -1, ArrowUp],
                        [0, 1, ArrowDown],
                        [1, 0, ArrowRight],
                      ].map(([dx, dy, Icon], i) => {
                        const IconComp = Icon as React.ComponentType<{ className?: string }>;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => nudgeCrop(dx as number, dy as number)}
                            className="rounded border border-borderFolk bg-surface p-0.5 hover:bg-card"
                          >
                            <IconComp className="h-3 w-3" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Interactive Palette + Eyedropper */}
                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Thread / Pixel Palette
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActiveTool(activeTool === 'eyedropper' ? 'pencil' : 'eyedropper')}
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                          activeTool === 'eyedropper'
                            ? 'border-indigoFolk bg-indigoFolk text-white'
                            : 'border-borderFolk bg-surface hover:bg-card'
                        }`}
                        title="Sample color directly from Reference Image (I)"
                      >
                        <Pipette className="h-3 w-3" />
                        <span>{activeTool === 'eyedropper' ? 'Picking…' : 'Eyedropper'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBuilderPalette((p) => {
                            const next = [...p, '#be1e2d'];
                            setActiveColorIdx(next.length - 1);
                            return next;
                          });
                          setActiveTool('pencil');
                        }}
                        className="inline-flex items-center gap-0.5 rounded border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] hover:bg-card"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {builderPalette.map((hex, idx) => {
                      const active = idx === activeColorIdx && activeTool !== 'eraser';
                      return (
                        <button
                          key={`${idx}-${hex}`}
                          type="button"
                          onClick={() => {
                            setActiveColorIdx(idx);
                            if (activeTool === 'frame' || activeTool === 'eraser' || activeTool === 'eyedropper') {
                              setActiveTool('pencil');
                            }
                          }}
                          title={`Swatch #${idx + 1}: ${hex}`}
                          className={`h-6 w-6 rounded-sm border-2 transition ${
                            active
                              ? 'border-ink ring-2 ring-crimson/60 scale-110'
                              : 'border-borderFolk hover:scale-105'
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      );
                    })}
                  </div>

                  {builderPalette[activeColorIdx] && (
                    <div className="flex items-center justify-between gap-2 border-t border-borderFolk/60 pt-1.5 text-[10px]">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={builderPalette[activeColorIdx]}
                          onChange={(e) => {
                            const nextHex = e.target.value;
                            setBuilderPalette((prev) =>
                              prev.map((c, i) => (i === activeColorIdx ? nextHex : c)),
                            );
                          }}
                          className="h-5 w-7 cursor-pointer rounded border border-borderFolk p-0"
                        />
                        <span className="font-mono">{builderPalette[activeColorIdx]}</span>
                      </div>
                      {builderPalette.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const removeIdx = activeColorIdx;
                            pushTraceUndo();
                            setBuilderPalette((p) => p.filter((_, i) => i !== removeIdx));
                            setBuilderGrid((g) =>
                              g.map((v) => (v === removeIdx ? -1 : v > removeIdx ? v - 1 : v)),
                            );
                            setActiveColorIdx(Math.max(0, removeIdx - 1));
                          }}
                          className="text-muted hover:text-crimson"
                        >
                          Remove Swatch
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Output Footprint & Stamp Config */}
                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
                  <div>
                    <label htmlFor="stamp-name-input" className="block text-[11px] font-medium text-muted mb-0.5">
                      Pattern / Stamp Name
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
                    <span className="block text-[10px] font-medium text-muted mb-1">
                      Output Tile Size ({builderOutCols * tileDim}×{builderOutRows * tileDim}px)
                    </span>
                    <div className="grid grid-cols-4 gap-1 text-[10px] mb-1.5">
                      {[
                        [1, 1],
                        [2, 2],
                        [3, 3],
                        [4, 4],
                      ].map(([c, r]) => (
                        <button
                          key={`out-${c}x${r}`}
                          type="button"
                          onClick={() => {
                            setBuilderOutCols(c);
                            setBuilderOutRows(r);
                          }}
                          className={`rounded border px-1 py-0.5 font-mono ${
                            builderOutCols === c && builderOutRows === r
                              ? 'border-crimson bg-crimson/10 font-bold text-crimson'
                              : 'border-borderFolk bg-surface hover:bg-card'
                          }`}
                        >
                          {c}×{r} tile{c > 1 ? 's' : ''}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-muted">
                      <label className="flex items-center gap-1">
                        <span>Cols</span>
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={builderOutCols}
                          onChange={(e) => setBuilderOutCols(Math.max(1, Math.min(8, Number(e.target.value))))}
                          className="w-full rounded border border-borderFolk bg-surface px-1.5 py-0.5 font-mono text-xs text-ink"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <span>Rows</span>
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={builderOutRows}
                          onChange={(e) => setBuilderOutRows(Math.max(1, Math.min(8, Number(e.target.value))))}
                          className="w-full rounded border border-borderFolk bg-surface px-1.5 py-0.5 font-mono text-xs text-ink"
                        />
                      </label>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[10px] font-medium text-muted mb-1">Target Map Layer</span>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
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
              </>
            )}

            {inspectorTab === 'slicer' && (
              <>
                {/* Background Remover */}
                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Reference Background Remover
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleUndoBg}
                        disabled={bgUndoStackRef.current.length === 0}
                        title="Undo reference background removal"
                        className="rounded border border-borderFolk px-1.5 py-0.5 text-[10px] hover:bg-surface disabled:opacity-40"
                      >
                        <Undo2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={handleResetImage}
                        title="Reset reference image"
                        className="rounded border border-borderFolk px-1.5 py-0.5 text-[10px] hover:bg-surface"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleAutoRemoveBg}
                      className="inline-flex items-center justify-center gap-1 rounded bg-crimson/90 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-crimson"
                    >
                      <Eraser className="h-3.5 w-3.5" />
                      <span>Auto Remove BG</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTool(activeTool === 'wand' ? 'frame' : 'wand')}
                      className={`inline-flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px] font-medium ${
                        activeTool === 'wand'
                          ? 'border-indigoFolk bg-indigoFolk text-white'
                          : 'border-borderFolk bg-surface hover:bg-card'
                      }`}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      <span>{activeTool === 'wand' ? 'Wand Active' : 'Magic Wand'}</span>
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

                  <div className="border-t border-borderFolk/60 pt-1.5 space-y-1.5">
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
                        onClick={() => setPickingChromaKey((p) => !p)}
                        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] border ${
                          pickingChromaKey
                            ? 'border-indigoFolk bg-indigoFolk text-white'
                            : 'border-borderFolk hover:bg-surface'
                        }`}
                      >
                        <Pipette className="h-3 w-3" />
                        <span>{pickingChromaKey ? 'Click Ref' : 'Pick Key'}</span>
                      </button>
                    </div>

                    {enableChroma && (
                      <div className="flex items-center justify-between gap-2">
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
                        >
                          Bake to Ref
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Auto-Slicer */}
                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Auto-Slicer
                    </span>
                    <span className="font-mono text-[10px] text-muted">
                      {autoSlices.length > 0 ? `${selectedSliceCount}/${autoSlices.length}` : 'Ready'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleAutoSlice}
                    disabled={!sourceImg}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-cyan-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    <span>Auto-Slice All Motifs</span>
                  </button>

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
                      <div className="max-h-40 overflow-y-auto thin-scroll space-y-1 rounded border border-borderFolk bg-surface p-1.5">
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
                              onClick={() => {
                                setCrop(item.crop);
                                if (sourceImg) {
                                  traceCropIntoLayer(
                                    sourceImg,
                                    imgWidth,
                                    imgHeight,
                                    item.crop,
                                    builderW,
                                    builderH,
                                    maxTraceColors,
                                    true,
                                  );
                                }
                                setInspectorTab('trace');
                              }}
                              className="text-left text-indigoFolk hover:underline"
                            >
                              Trace {item.crop.w}×{item.crop.h}px →
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={isProcessing || selectedSliceCount === 0}
                        onClick={handleBatchAddAutoSlices}
                        className="w-full rounded bg-cyan-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
                      >
                        Batch Add {selectedSliceCount} Raw Motifs to Tileset
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-1.5">
                  <button
                    type="button"
                    disabled={isProcessing || !sourceImg}
                    onClick={handleAddRawCropStamp}
                    className="flex w-full items-center justify-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-[11px] font-medium hover:bg-card"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Raw Crop Direct to Tileset</span>
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing || !sourceImg}
                    onClick={handleConvertWholeMap}
                    className="flex w-full items-center justify-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted hover:bg-card hover:text-ink"
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span>Convert Whole Reference Image to Map</span>
                  </button>
                </div>
              </>
            )}

            {inspectorTab === 'library' && (
              <>
                {/* Saved Pattern Library */}
                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Pattern Library ({patternLibrary.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSaveTracedPattern({ addToTileset: false })}
                      className="inline-flex items-center gap-1 rounded bg-crimson px-2 py-0.5 text-[10px] font-medium text-white hover:bg-crimson/90"
                    >
                      <BookmarkPlus className="h-3 w-3" />
                      <span>Save Current</span>
                    </button>
                  </div>

                  {patternLibrary.length === 0 ? (
                    <p className="text-[11px] text-muted py-4 text-center">
                      No saved patterns yet. Trace &amp; clean a motif over the reference, then save it here!
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto thin-scroll pr-0.5">
                      {patternLibrary.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center gap-2 rounded border border-borderFolk bg-surface p-1.5"
                        >
                          <img
                            src={entry.previewDataUrl}
                            alt={entry.name}
                            style={SUBTLE_CHECKER_STYLE}
                            className="h-12 w-12 shrink-0 rounded border border-borderFolk object-contain pixel-canvas"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-xs font-semibold">{entry.name}</span>
                              <span className="font-mono text-[9px] text-muted shrink-0">
                                {entry.gridWidth}×{entry.gridHeight}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-0.5">
                              {entry.palette.slice(0, 8).map((hex, i) => (
                                <span
                                  key={`${hex}-${i}`}
                                  className="h-2.5 w-2.5 rounded-sm border border-borderFolk"
                                  style={{ backgroundColor: hex }}
                                />
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <button
                                type="button"
                                onClick={() => handleLoadSavedPattern(entry)}
                                className="text-indigoFolk hover:underline font-medium"
                              >
                                Load Layer
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAddSavedPatternToTileset(entry)}
                                className="text-emerald-700 hover:underline font-medium"
                              >
                                + Tileset
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopyCode(entry.proceduralCode)}
                                className="text-muted hover:text-ink"
                              >
                                Code
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = patternLibrary.filter((p) => p.id !== entry.id);
                                  setPatternLibrary(next);
                                  savePatternLibrary(next);
                                }}
                                className="ml-auto text-muted hover:text-crimson"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Live Procedural Canvas2D Code */}
                <div className="rounded border border-borderFolk bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      <Code2 className="h-3.5 w-3.5" />
                      <span>Procedural Canvas2D Code</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(builderCode)}
                      className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2 py-0.5 text-[10px] font-medium hover:bg-card"
                    >
                      <Copy className="h-3 w-3" />
                      <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                    </button>
                  </div>
                  <pre className="max-h-52 overflow-auto thin-scroll rounded border border-borderFolk bg-stone-950 p-2 text-[9px] font-mono text-emerald-300">
                    {builderCode}
                  </pre>
                </div>
              </>
            )}
          </div>

          {/* Sticky Bottom Save Actions */}
          <div className="border-t border-borderFolk bg-card p-2.5 space-y-1.5 shrink-0">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => handleSaveTracedPattern({ addToTileset: true, directPlace: false })}
              className="flex w-full items-center justify-center gap-1.5 rounded bg-crimson px-3 py-2 text-xs font-semibold text-white hover:bg-crimson/90 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Save to Library &amp; Tileset</span>
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => handleSaveTracedPattern({ addToTileset: false })}
                className="flex items-center justify-center gap-1 rounded border border-borderFolk bg-surface px-2 py-1 text-[11px] font-medium hover:bg-card disabled:opacity-50"
              >
                <BookmarkPlus className="h-3 w-3" />
                <span>Save to Library</span>
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={() => handleSaveTracedPattern({ addToTileset: true, directPlace: true })}
                className="flex items-center justify-center gap-1 rounded border border-indigoFolk bg-indigoFolk/10 px-2 py-1 text-[11px] font-medium text-indigoFolk hover:bg-indigoFolk/20 disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                <span>Place on Map</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
