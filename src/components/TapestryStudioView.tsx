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
  Download,
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
  Move,
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
  applyChromaKeyToPixelGrid,
  convertTapestryToMap,
  createMacroStampFromIndices,
  detectMotifRegions,
  findFirstEmptyTileBlock,
  floodFillTransparent,
  generateProceduralCodeFromGrid,
  getOpaqueBounds,
  parseHexColor,
  placeTilesInTilesetAt,
  processTilePixels,
  rebuildCrispPixelArt,
  remapTileIndicesInMap,
  removeEdgeBackground,
  renderPixelGridToCanvases,
  repositionTilesInTileset,
  sampleNearestPaletteIndexForCell,
  sliceSelectionToTiles,
  type ChromaKeyFilter,
  type CropSelection,
} from '../engine/tapestrySampler';
import type { TileMacroStamp, VillageMap } from '../engine/types';
import { resolvePublicUrl } from '../utils/assetUrl';

type CanvasViewMode = 'create' | 'tileset';
type CanvasTool = 'frame' | 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'wand' | 'pan';
type TilesetTool = 'position' | 'move' | 'pencil' | 'eraser' | 'eyedropper' | 'pan';
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

const MIN_STUDIO_ZOOM = 0.25;
const MAX_STUDIO_ZOOM = 24;

function computeAnchoredZoomPan(
  curZoom: number,
  curPan: { x: number; y: number },
  targetZoom: number,
  canvasWidth: number,
  canvasHeight: number,
  fromCanvasPt: { x: number; y: number },
  toCanvasPt: { x: number; y: number } = fromCanvasPt,
): { zoom: number; pan: { x: number; y: number } } {
  const nextZoom = Math.max(
    MIN_STUDIO_ZOOM,
    Math.min(MAX_STUDIO_ZOOM, Number(targetZoom.toFixed(4))),
  );
  const ratio = nextZoom / curZoom;
  return {
    zoom: nextZoom,
    pan: {
      x: toCanvasPt.x - canvasWidth / 2 - (fromCanvasPt.x - canvasWidth / 2 - curPan.x) * ratio,
      y: toCanvasPt.y - canvasHeight / 2 - (fromCanvasPt.y - canvasHeight / 2 - curPan.y) * ratio,
    },
  };
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
  const [traceGridOpacity, setTraceGridOpacity] = useState(45);
  const [traceOverlayMode, setTraceOverlayMode] = useState<TraceOverlayMode>('lines');
  const [previewCompositeRef, setPreviewCompositeRef] = useState(false);
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
  const [useSampleBrush, setUseSampleBrush] = useState(false);
  const [rawCropPreviewUrl, setRawCropPreviewUrl] = useState<string>('');
  const [builderPreviewUrl, setBuilderPreviewUrl] = useState<string>('');
  const [builderCode, setBuilderCode] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState(false);

  // Target Output Tileset Preview & Editing View (separate from map.tileSetUrl until explicitly applied)
  const [canvasViewMode, setCanvasViewMode] = useState<CanvasViewMode>('create');
  const [tilesetTool, setTilesetTool] = useState<TilesetTool>('position');
  const [tilesetGridVisible, setTilesetGridVisible] = useState(true);
  const [tilesetSourceLabel, setTilesetSourceLabel] = useState<'blank' | 'map' | 'uploaded'>('blank');
  const [tilesetDimX, setTilesetDimX] = useState<number>(() => Math.max(256, tileDim * 8));
  const [tilesetDimY, setTilesetDimY] = useState<number>(() => tileDim * 4);
  const [tilesetVersion, setTilesetVersion] = useState(0);
  const [tilesetHasEdits, setTilesetHasEdits] = useState(false);
  const [tilesetUndoCount, setTilesetUndoCount] = useState(0);
  const [studioStamps, setStudioStamps] = useState<TileMacroStamp[]>([]);
  const [showStagedDraft, setShowStagedDraft] = useState(true);
  const [stagedSlot, setStagedSlot] = useState<{ col: number; row: number }>({ col: 0, row: 0 });
  const [selectedTilesetSlot, setSelectedTilesetSlot] = useState<{ col: number; row: number; w: number; h: number }>({
    col: 0,
    row: 0,
    w: 1,
    h: 1,
  });
  const [tilesetHoverSlot, setTilesetHoverSlot] = useState<{ col: number; row: number } | null>(null);
  const [repositionMode, setRepositionMode] = useState<'swap' | 'move'>('swap');

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

  const tilesetWorkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tilesetUndoStackRef = useRef<
    Array<{ width: number; height: number; data: ImageData; stamps: TileMacroStamp[] }>
  >([]);
  const tilesetDragOriginRef = useRef<{ col: number; row: number; w: number; h: number } | null>(null);
  const tilesetPaintSavedRef = useRef(false);
  const stagedPreviewCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const pendingTileRemapsRef = useRef<Array<Record<number, number>>>([]);

  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const gestureStartZoomRef = useRef<{ zoom: number; pan: { x: number; y: number }; clientX: number; clientY: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<
    'none' | 'pan' | 'select' | 'move' | 'resize' | 'paint' | 'ts-position' | 'ts-move' | 'ts-paint'
  >('none');
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

  // Trackpad pinch-zoom, two-finger scroll pan, and Safari gesture events on the canvas viewport
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let wheelPinchSeen = false;

    const applyZoomPan = (nextZoom: number, nextPan: { x: number; y: number }) => {
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
    };

    const clientToCanvasPt = (clientX: number, clientY: number, canvas: HTMLCanvasElement, rect: DOMRect) => ({
      x: ((clientX - rect.left) * canvas.width) / rect.width,
      y: ((clientY - rect.top) * canvas.height) / rect.height,
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const curZoom = zoomRef.current;
      const curPan = panRef.current;

      if (e.ctrlKey || e.metaKey) {
        wheelPinchSeen = true;
        // Trackpad pinch-to-zoom (or Ctrl/Cmd+Wheel): zoom smoothly anchored at cursor
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= rect.height;
        const next = computeAnchoredZoomPan(
          curZoom,
          curPan,
          curZoom * Math.exp(-dy * 0.01),
          canvas.width,
          canvas.height,
          clientToCanvasPt(e.clientX, e.clientY, canvas, rect),
        );
        applyZoomPan(next.zoom, next.pan);
      } else {
        // Two-finger trackpad scroll / wheel pan
        const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
        const stepX = (e.deltaX * mult * canvas.width) / rect.width;
        const stepY = (e.deltaY * mult * canvas.height) / rect.height;
        applyZoomPan(curZoom, {
          x: curPan.x - stepX,
          y: curPan.y - stepY,
        });
      }
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      wheelPinchSeen = false;
      const ge = e as unknown as { clientX?: number; clientY?: number };
      const rect = el.getBoundingClientRect();
      gestureStartZoomRef.current = {
        zoom: zoomRef.current,
        pan: { ...panRef.current },
        clientX: ge.clientX ?? rect.left + rect.width / 2,
        clientY: ge.clientY ?? rect.top + rect.height / 2,
      };
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (wheelPinchSeen) return;
      const ge = e as unknown as { scale?: number; clientX?: number; clientY?: number };
      const start = gestureStartZoomRef.current;
      const canvas = canvasRef.current;
      if (!start || !canvas || typeof ge.scale !== 'number') return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const pt = clientToCanvasPt(
        ge.clientX ?? start.clientX,
        ge.clientY ?? start.clientY,
        canvas,
        rect,
      );
      const next = computeAnchoredZoomPan(
        start.zoom,
        start.pan,
        start.zoom * ge.scale,
        canvas.width,
        canvas.height,
        pt,
      );
      applyZoomPan(next.zoom, next.pan);
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureStartZoomRef.current = null;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  const tilesetCols = Math.max(1, Math.floor(tilesetDimX / tileDim));
  const tilesetRows = Math.max(1, Math.floor(tilesetDimY / tileDim));
  const activeSheetW = canvasViewMode === 'tileset' ? tilesetDimX : imgWidth;
  const activeSheetH = canvasViewMode === 'tileset' ? tilesetDimY : imgHeight;

  const ensureBlankTilesetCanvas = (cols: number = 8, rows: number = 4): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = Math.max(tileDim, cols * tileDim);
    c.height = Math.max(tileDim, rows * tileDim);
    tilesetWorkCanvasRef.current = c;
    tilesetUndoStackRef.current = [];
    pendingTileRemapsRef.current = [];
    setTilesetUndoCount(0);
    setTilesetDimX(c.width);
    setTilesetDimY(c.height);
    setTilesetSourceLabel('blank');
    setTilesetHasEdits(false);
    setStudioStamps([]);
    setStagedSlot({ col: 0, row: 0 });
    setSelectedTilesetSlot({ col: 0, row: 0, w: 1, h: 1 });
    setTilesetVersion((v) => v + 1);
    return c;
  };

  // Load sample on mount if none loaded & init clean blank Output Tileset
  useEffect(() => {
    if (!tilesetWorkCanvasRef.current) {
      ensureBlankTilesetCanvas(8, 4);
    }
    if (!sourceImg && !imgSrcUrl) {
      loadSampleTapestry();
    }
  }, []);

  const getChromaFilter = (forceEnabled: boolean = false, hexOverride?: string): ChromaKeyFilter | null => {
    if (!forceEnabled && !enableChroma) return null;
    const rgb = parseHexColor(hexOverride ?? chromaHex);
    if (!rgb) return null;
    return {
      ...rgb,
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
    chromaOverride?: ChromaKeyFilter | null,
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
      chromaKey: chromaOverride !== undefined ? chromaOverride : getChromaFilter(),
      trimAndFit: false, // keep 1:1 geometric alignment directly over the reference crop!
    });
    const nextPalette =
      res.palette.length > 0
        ? res.palette
        : ['#be1e2d', '#eab308', '#228b4a', '#1f2937', '#f5f0e1'];
    setBuilderW(res.gridWidth);
    setBuilderH(res.gridHeight);
    setBuilderGrid(res.grid);
    setBuilderPalette(nextPalette);
    setActiveColorIdx((idx) => Math.max(0, Math.min(idx, nextPalette.length - 1)));
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

  const handleApplyTranspToLayer = (hexOverride?: string, retraceClean: boolean = false) => {
    const targetHex = hexOverride ?? chromaHex;
    const filter = getChromaFilter(true, targetHex);
    if (!filter) return;
    setChromaHex(targetHex);
    setEnableChroma(true);
    setPickingChromaKey(false);

    if (retraceClean && sourceImg) {
      traceCropIntoLayer(
        sourceImg,
        imgWidth,
        imgHeight,
        crop,
        builderW,
        builderH,
        maxTraceColors,
        true,
        filter,
      );
      setStatusMsg(`Re-traced cleanly with ${targetHex} (±${chromaTolerance}%) set transparent`);
      return;
    }

    pushTraceUndo();
    const res = applyChromaKeyToPixelGrid(builderGrid, builderPalette, filter);
    const nextPalette =
      res.palette.length > 0
        ? res.palette
        : ['#be1e2d', '#eab308', '#228b4a', '#1f2937', '#f5f0e1'];
    setBuilderGrid(res.grid);
    setBuilderPalette(nextPalette);
    setActiveColorIdx((idx) => Math.max(0, Math.min(idx, nextPalette.length - 1)));
    setStatusMsg(
      `Applied transparency for ${targetHex} (±${chromaTolerance}%): cleared ${res.removedCells} pixel(s)`,
    );
  };

  const handleApplyColorKeyToImage = () => {
    if (!sourceImg) return;
    const filter = getChromaFilter(true);
    if (!filter) return;
    const ctx = sourceImg.getContext('2d');
    if (!ctx) return;
    pushBgUndoSnapshot();
    const imgData = ctx.getImageData(0, 0, sourceImg.width, sourceImg.height);
    processTilePixels(imgData, { chromaKey: filter });
    ctx.putImageData(imgData, 0, 0);
    setEnableChroma(true);
    setBgVersion((v) => v + 1);
    setStatusMsg(`Removed ${chromaHex} (±${chromaTolerance}%) across reference image`);
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
    const chromaKey = getChromaFilter();
    if (chromaKey) {
      processTilePixels(data, { chromaKey });
    }
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

  // Zoom & center viewport cleanly onto the active crop frame (or whole Output Tileset)
  const handleZoomToCrop = () => {
    if (canvasViewMode === 'tileset') {
      if (tilesetDimX <= 0 || tilesetDimY <= 0) return;
      const fitZoom = Math.min(
        8,
        Math.max(
          0.5,
          Math.min((canvasSize.w * 0.85) / tilesetDimX, (canvasSize.h * 0.85) / tilesetDimY),
        ),
      );
      zoomRef.current = Number(fitZoom.toFixed(2));
      panRef.current = { x: 0, y: 0 };
      setZoom(zoomRef.current);
      setPan({ x: 0, y: 0 });
      return;
    }
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
    const z = Number(fitZoom.toFixed(2));
    const p = { x: -cropCx * fitZoom, y: -cropCy * fitZoom };
    zoomRef.current = z;
    panRef.current = p;
    setZoom(z);
    setPan(p);
  };

  const nudgeCrop = (dx: number, dy: number) => {
    setCrop((prev) => ({
      ...prev,
      x: Math.max(0, Math.min(Math.max(0, imgWidth - prev.w), prev.x + dx)),
      y: Math.max(0, Math.min(Math.max(0, imgHeight - prev.h), prev.y + dy)),
    }));
  };

  const nudgeStagedSlot = (dc: number, dr: number) => {
    setStagedSlot((prev) => {
      const nextCol = Math.max(0, Math.min(Math.max(0, tilesetCols - builderOutCols), prev.col + dc));
      const nextRow = Math.max(0, Math.min(Math.max(0, tilesetRows - builderOutRows), prev.row + dr));
      setSelectedTilesetSlot({
        col: nextCol,
        row: nextRow,
        w: builderOutCols,
        h: builderOutRows,
      });
      return { col: nextCol, row: nextRow };
    });
  };

  // Keyboard shortcuts: Arrows nudge crop/draft, B/E/G/I/V/M switch tools, Cmd/Ctrl+Z undo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (canvasViewMode === 'tileset') {
          handleTilesetUndo();
        } else {
          handleTraceUndo();
        }
        return;
      }

      if (canvasViewMode === 'tileset') {
        if (e.key === 'v' || e.key === 'V') setTilesetTool('position');
        if (e.key === 'm' || e.key === 'M') setTilesetTool('move');
        if (e.key === 'b' || e.key === 'B') setTilesetTool('pencil');
        if (e.key === 'e' || e.key === 'E') setTilesetTool('eraser');
        if (e.key === 'i' || e.key === 'I') setTilesetTool('eyedropper');
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          nudgeStagedSlot(-1, 0);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          nudgeStagedSlot(1, 0);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          nudgeStagedSlot(0, -1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          nudgeStagedSlot(0, 1);
        }
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
  }, [imgWidth, imgHeight, builderGrid, builderPalette, canvasViewMode, tilesetCols, tilesetRows, builderOutCols, builderOutRows]);

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
      stagedPreviewCanvasesRef.current = rendered.canvases;
      setBuilderPreviewUrl(rendered.previewDataUrl);
    } catch {
      // ignore
    }
  }, [builderGrid, builderPalette, builderW, builderH, builderOutCols, builderOutRows, tileDim, stampName]);

  // Main unified layered canvas renderer (Create Reference/Trace OR Preview Output Tileset)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvasViewMode === 'create' && (!sourceImg || imgWidth <= 0 || imgHeight <= 0)) return;
    if (canvasViewMode === 'tileset' && (tilesetDimX <= 0 || tilesetDimY <= 0)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sheetW = canvasViewMode === 'tileset' ? tilesetDimX : imgWidth;
    const sheetH = canvasViewMode === 'tileset' ? tilesetDimY : imgHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    ctx.save();
    ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-sheetW / 2, -sheetH / 2);

    // 1. Transparency checkerboard backdrop
    const checkSize = Math.max(4, Math.round(16 / Math.max(1, zoom)));
    ctx.fillStyle = '#242428';
    ctx.fillRect(0, 0, sheetW, sheetH);
    ctx.fillStyle = '#313136';
    for (let cy = 0; cy < sheetH; cy += checkSize) {
      for (let cx = 0; cx < sheetW; cx += checkSize) {
        if (((Math.floor(cx / checkSize) + Math.floor(cy / checkSize)) & 1) === 0) {
          ctx.fillRect(cx, cy, Math.min(checkSize, sheetW - cx), Math.min(checkSize, sheetH - cy));
        }
      }
    }

    if (canvasViewMode === 'tileset') {
      const workCanvas = tilesetWorkCanvasRef.current;
      if (workCanvas) {
        ctx.drawImage(workCanvas, 0, 0, tilesetDimX, tilesetDimY);
      }

      // 1px pixel subgrid when zoomed in deeply
      if (zoom >= 6) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1 / zoom;
        ctx.beginPath();
        for (let px = 1; px < tilesetDimX; px++) {
          ctx.moveTo(px, 0);
          ctx.lineTo(px, tilesetDimY);
        }
        for (let py = 1; py < tilesetDimY; py++) {
          ctx.moveTo(0, py);
          ctx.lineTo(tilesetDimX, py);
        }
        ctx.stroke();
      }

      // Tile grid overlay + #idx labels
      if (tilesetGridVisible) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1 / zoom;
        ctx.beginPath();
        for (let c = 0; c <= tilesetCols; c++) {
          const xPos = c * tileDim;
          ctx.moveTo(xPos, 0);
          ctx.lineTo(xPos, tilesetDimY);
        }
        for (let r = 0; r <= tilesetRows; r++) {
          const yPos = r * tileDim;
          ctx.moveTo(0, yPos);
          ctx.lineTo(tilesetDimX, yPos);
        }
        ctx.stroke();

        if (tileDim * zoom >= 24) {
          const fontPx = Math.max(7, Math.min(11, Math.round(10 / zoom * 1)));
          ctx.font = `bold ${Math.max(4, Math.round(9 / Math.max(0.6, Math.min(2.2, zoom * 0.35))))}px monospace`;
          ctx.textBaseline = 'top';
          for (let r = 0; r < tilesetRows; r++) {
            for (let c = 0; c < tilesetCols; c++) {
              const idx = r * tilesetCols + c;
              const tx = c * tileDim + 2 / Math.max(1, zoom * 0.5);
              const ty = r * tileDim + 1.5 / Math.max(1, zoom * 0.5);
              ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
              ctx.fillText(`#${idx}`, tx + 0.4, ty + 0.4);
              ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
              ctx.fillText(`#${idx}`, tx, ty);
            }
          }
          void fontPx;
        }
      }

      // Subtle borders for registered studio stamps
      if (studioStamps.length > 0 && tilesetGridVisible) {
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
        ctx.lineWidth = 1.2 / zoom;
        ctx.setLineDash([3 / zoom, 3 / zoom]);
        for (const st of studioStamps) {
          if (st.tiles.length === 0) continue;
          const firstIdx = st.tiles[0];
          const sc = firstIdx % tilesetCols;
          const sr = Math.floor(firstIdx / tilesetCols);
          ctx.strokeRect(sc * tileDim, sr * tileDim, st.width * tileDim, st.height * tileDim);
        }
        ctx.restore();
      }

      // Selected tile/block outline
      const selX = selectedTilesetSlot.col * tileDim;
      const selY = selectedTilesetSlot.row * tileDim;
      const selW = selectedTilesetSlot.w * tileDim;
      const selH = selectedTilesetSlot.h * tileDim;
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(selX, selY, selW, selH);

      // Staged Draft overlay (created pattern ready to position & stamp)
      if (showStagedDraft && stagedPreviewCanvasesRef.current.length > 0) {
        const draftX = stagedSlot.col * tileDim;
        const draftY = stagedSlot.row * tileDim;
        const draftW = builderOutCols * tileDim;
        const draftH = builderOutRows * tileDim;

        if (traceLayerVisible && traceLayerOpacity > 0) {
          ctx.save();
          ctx.globalAlpha = traceLayerOpacity / 100;
          for (let r = 0; r < builderOutRows; r++) {
            for (let c = 0; c < builderOutCols; c++) {
              const tileC = stagedPreviewCanvasesRef.current[r * builderOutCols + c];
              if (tileC) {
                ctx.drawImage(
                  tileC,
                  (stagedSlot.col + c) * tileDim,
                  (stagedSlot.row + r) * tileDim,
                  tileDim,
                  tileDim,
                );
              }
            }
          }
          ctx.restore();
        }

        ctx.strokeStyle = '#be1e2d';
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(draftX, draftY, draftW, draftH);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2 / zoom;
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        ctx.strokeRect(draftX, draftY, draftW, draftH);
        ctx.setLineDash([]);

        if (tileDim * zoom >= 16) {
          ctx.save();
          ctx.font = `bold ${Math.max(5, Math.min(12, 10 / Math.max(0.5, zoom * 0.45)))}px sans-serif`;
          ctx.fillStyle = 'rgba(190, 30, 45, 0.9)';
          const tag = `DRAFT (${stagedSlot.col},${stagedSlot.row})`;
          const m = ctx.measureText(tag);
          const tagH = Math.max(8, 12 / Math.max(0.6, zoom * 0.45));
          ctx.fillRect(draftX, Math.max(0, draftY - tagH - 1), m.width + 6, tagH);
          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'top';
          ctx.fillText(tag, draftX + 3, Math.max(0, draftY - tagH));
          ctx.restore();
        }
      }

      // Hover / Move-Swap target highlight
      if (tilesetHoverSlot) {
        const isDraggingMove = dragModeRef.current === 'ts-move' && tilesetDragOriginRef.current;
        const hw = (isDraggingMove ? tilesetDragOriginRef.current!.w : 1) * tileDim;
        const hh = (isDraggingMove ? tilesetDragOriginRef.current!.h : 1) * tileDim;
        const hx = Math.min(tilesetCols - (hw / tileDim), Math.max(0, tilesetHoverSlot.col)) * tileDim;
        const hy = Math.min(tilesetRows - (hh / tileDim), Math.max(0, tilesetHoverSlot.row)) * tileDim;
        ctx.strokeStyle = isDraggingMove ? '#34d399' : 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = (isDraggingMove ? 2.2 : 1.2) / zoom;
        ctx.strokeRect(hx, hy, hw, hh);
      }

      ctx.restore();
      return;
    }

    // 2. Reference Image Layer (at adjustable refOpacity)
    if (sourceImg) {
      ctx.save();
      ctx.globalAlpha = refOpacity / 100;
      ctx.drawImage(sourceImg, 0, 0, imgWidth, imgHeight);
      ctx.restore();
    }

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
      const gridAlpha = Math.max(0.04, Math.min(1, traceGridOpacity / 100));
      if (traceOverlayMode === 'lines' || traceOverlayMode === 'both') {
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.62 * gridAlpha).toFixed(2)})`;
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
        ctx.fillStyle = `rgba(15, 23, 42, ${(0.58 * gridAlpha).toFixed(2)})`;
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

        ctx.fillStyle = `rgba(255, 255, 255, ${(0.95 * gridAlpha).toFixed(2)})`;
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
    traceGridOpacity,
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
    canvasViewMode,
    tilesetDimX,
    tilesetDimY,
    tilesetVersion,
    tilesetGridVisible,
    tilesetTool,
    tilesetHoverSlot,
    selectedTilesetSlot,
    stagedSlot,
    showStagedDraft,
    studioStamps,
    useSampleBrush,
  ]);

  // Convert pointer event to floating and clamped pixel coords in active sheet space (Reference or Output Tileset)
  const canvasToImageCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const sheetW = activeSheetW;
    const sheetH = activeSheetH;
    if (!canvas || sheetW <= 0 || sheetH <= 0) return { x: 0, y: 0, ox: 0, oy: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    const ox = (cx - (canvas.width / 2 + pan.x)) / zoom + sheetW / 2;
    const oy = (cy - (canvas.height / 2 + pan.y)) / zoom + sheetH / 2;

    return {
      ox,
      oy,
      x: Math.max(0, Math.min(sheetW - 1, Math.floor(ox))),
      y: Math.max(0, Math.min(sheetH - 1, Math.floor(oy))),
    };
  };

  const imageToTraceCell = (ox: number, oy: number) => {
    if (crop.w <= 0 || crop.h <= 0) return null;
    if (ox < crop.x || ox >= crop.x + crop.w || oy < crop.y || oy >= crop.y + crop.h) return null;
    const gx = Math.min(builderW - 1, Math.max(0, Math.floor(((ox - crop.x) / crop.w) * builderW)));
    const gy = Math.min(builderH - 1, Math.max(0, Math.floor(((oy - crop.y) / crop.h) * builderH)));
    return { gx, gy };
  };

  const imageToOutputDraftCell = (ox: number, oy: number) => {
    if (!showStagedDraft) return null;
    const x0 = stagedSlot.col * tileDim;
    const y0 = stagedSlot.row * tileDim;
    const w = builderOutCols * tileDim;
    const h = builderOutRows * tileDim;
    if (ox < x0 || ox >= x0 + w || oy < y0 || oy >= y0 + h) return null;
    const gx = Math.min(builderW - 1, Math.max(0, Math.floor(((ox - x0) / w) * builderW)));
    const gy = Math.min(builderH - 1, Math.max(0, Math.floor(((oy - y0) / h) * builderH)));
    return { gx, gy };
  };

  const canvasToTilesetSlot = (ox: number, oy: number) => {
    const rawCol = Math.floor(ox / tileDim);
    const rawRow = Math.floor(oy / tileDim);
    return {
      col: Math.max(0, Math.min(tilesetCols - 1, rawCol)),
      row: Math.max(0, Math.min(tilesetRows - 1, rawRow)),
      inside: ox >= 0 && ox < tilesetDimX && oy >= 0 && oy < tilesetDimY,
    };
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

  // Sample Brush: reads pixels under (gx, gy) in sourceImg, finds nearest palette swatch (or -1 if transparent), and paints
  const paintSampleCellAt = (gx: number, gy: number) => {
    if (!sourceImg || builderPalette.length === 0) {
      paintTraceCell(gx, gy, activeColorIdx);
      return;
    }
    const sampledIdx = sampleNearestPaletteIndexForCell(
      sourceImg,
      imgWidth,
      imgHeight,
      crop,
      builderW,
      builderH,
      gx,
      gy,
      builderPalette,
      getChromaFilter(),
    );
    paintTraceCell(gx, gy, sampledIdx);
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

  const samplePixelHexFromCanvas = (
    targetCanvas: HTMLCanvasElement | null,
    x: number,
    y: number,
  ): string | null => {
    if (!targetCanvas || x < 0 || y < 0 || x >= targetCanvas.width || y >= targetCanvas.height) {
      return null;
    }
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return null;
    const p = ctx.getImageData(x, y, 1, 1).data;
    if (p[3] === 0) return null;
    return `#${((1 << 24) + (p[0] << 16) + (p[1] << 8) + p[2]).toString(16).slice(1)}`;
  };

  const sampleColorFromRefAt = (x: number, y: number): string | null =>
    samplePixelHexFromCanvas(sourceImg, x, y);

  const selectOrAddPaletteHex = (hex: string) => {
    setUseSampleBrush(false);
    const existingIdx = builderPalette.indexOf(hex);
    if (existingIdx >= 0) {
      setActiveColorIdx(existingIdx);
      return;
    }
    setBuilderPalette((prev) => {
      const next = [...prev, hex];
      setActiveColorIdx(next.length - 1);
      return next;
    });
  };

  const paintTilesetAtCoords = (ox: number, oy: number, erase: boolean) => {
    const draftCell = imageToOutputDraftCell(ox, oy);
    if (draftCell) {
      setHoveredCell(draftCell);
      if (erase) {
        paintTraceCell(draftCell.gx, draftCell.gy, -1);
      } else if (useSampleBrush) {
        paintSampleCellAt(draftCell.gx, draftCell.gy);
      } else {
        paintTraceCell(draftCell.gx, draftCell.gy, activeColorIdx);
      }
      return;
    }

    const work = tilesetWorkCanvasRef.current;
    if (!work) return;
    const px = Math.floor(ox);
    const py = Math.floor(oy);
    if (px < 0 || py < 0 || px >= work.width || py >= work.height) return;
    const ctx = work.getContext('2d');
    if (!ctx) return;

    if (!tilesetPaintSavedRef.current) {
      pushTilesetUndo();
      tilesetPaintSavedRef.current = true;
    }

    if (erase) {
      ctx.clearRect(px, py, 1, 1);
    } else {
      ctx.fillStyle = builderPalette[activeColorIdx] || '#be1e2d';
      ctx.fillRect(px, py, 1, 1);
    }
    setTilesetHasEdits(true);
    setTilesetVersion((v) => v + 1);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two-finger touchscreen pinch-zoom + two-finger pan
    if (activePointersRef.current.size >= 2) {
      const pts = Array.from(activePointersRef.current.values());
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStateRef.current = { dist, mx, my };
      isDraggingRef.current = false;
      dragModeRef.current = 'none';
      strokeSavedRef.current = false;
      tilesetPaintSavedRef.current = false;
      tilesetDragOriginRef.current = null;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore if already captured
      }
      return;
    }

    const isPanMode =
      e.button === 1 ||
      (canvasViewMode === 'create' && (activeTool === 'pan' || (activeTool === 'frame' && e.altKey))) ||
      (canvasViewMode === 'tileset' && tilesetTool === 'pan');

    if (isPanMode) {
      isDraggingRef.current = true;
      dragModeRef.current = 'pan';
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const { x, y, ox, oy } = canvasToImageCoords(e);

    // Output Tileset canvas interaction
    if (canvasViewMode === 'tileset') {
      const slotHit = canvasToTilesetSlot(ox, oy);
      setTilesetHoverSlot(slotHit.inside ? { col: slotHit.col, row: slotHit.row } : null);

      if (tilesetTool === 'eyedropper' || (e.altKey && (tilesetTool === 'pencil' || tilesetTool === 'eraser'))) {
        const draftCell = imageToOutputDraftCell(ox, oy);
        if (draftCell && showStagedDraft) {
          const idx = builderGrid[draftCell.gy * builderW + draftCell.gx];
          if (idx !== undefined && idx >= 0 && idx < builderPalette.length) {
            setUseSampleBrush(false);
            setActiveColorIdx(idx);
            setTilesetTool('pencil');
            setStatusMsg(`Picked draft swatch #${idx + 1} (${builderPalette[idx]})`);
            return;
          }
        }
        const hex = samplePixelHexFromCanvas(tilesetWorkCanvasRef.current, Math.floor(ox), Math.floor(oy));
        if (hex) {
          selectOrAddPaletteHex(hex);
          setTilesetTool('pencil');
          setStatusMsg(`Picked ${hex} from Output Tileset`);
        } else {
          setStatusMsg('Clicked tile pixel is transparent');
        }
        return;
      }

      if (tilesetTool === 'position') {
        const nextCol = Math.max(0, Math.min(Math.max(0, tilesetCols - builderOutCols), slotHit.col));
        const nextRow = Math.max(0, Math.min(Math.max(0, tilesetRows - builderOutRows), slotHit.row));
        setShowStagedDraft(true);
        setStagedSlot({ col: nextCol, row: nextRow });
        setSelectedTilesetSlot({
          col: nextCol,
          row: nextRow,
          w: builderOutCols,
          h: builderOutRows,
        });
        isDraggingRef.current = true;
        dragModeRef.current = 'ts-position';
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }

      if (tilesetTool === 'move') {
        const insideSel =
          slotHit.col >= selectedTilesetSlot.col &&
          slotHit.col < selectedTilesetSlot.col + selectedTilesetSlot.w &&
          slotHit.row >= selectedTilesetSlot.row &&
          slotHit.row < selectedTilesetSlot.row + selectedTilesetSlot.h;
        const origin = insideSel
          ? { ...selectedTilesetSlot }
          : { col: slotHit.col, row: slotHit.row, w: 1, h: 1 };
        setSelectedTilesetSlot(origin);
        tilesetDragOriginRef.current = origin;
        isDraggingRef.current = true;
        dragModeRef.current = 'ts-move';
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }

      if (tilesetTool === 'pencil' || tilesetTool === 'eraser') {
        isDraggingRef.current = true;
        dragModeRef.current = 'ts-paint';
        strokeSavedRef.current = false;
        tilesetPaintSavedRef.current = false;
        const erase = e.button === 2 || tilesetTool === 'eraser';
        if (!imageToOutputDraftCell(ox, oy) && slotHit.inside) {
          setSelectedTilesetSlot({ col: slotHit.col, row: slotHit.row, w: 1, h: 1 });
        }
        paintTilesetAtCoords(ox, oy, erase);
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      return;
    }

    if (pickingChromaKey && sourceImg) {
      const hex = sampleColorFromRefAt(x, y);
      if (hex) {
        setChromaHex(hex);
        setEnableChroma(true);
        setStatusMsg(`ID'd ${hex} as Transparent Key — adjust Tolerance or Apply`);
      } else {
        setStatusMsg('Clicked pixel is already transparent');
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
          setUseSampleBrush(false);
          setActiveColorIdx(idx);
          setActiveTool('pencil');
          setStatusMsg(`Picked swatch #${idx + 1} (${builderPalette[idx]})`);
          return;
        }
      }
      const hex = sampleColorFromRefAt(x, y);
      if (hex) {
        selectOrAddPaletteHex(hex);
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
        const fillVal =
          useSampleBrush && sourceImg && builderPalette.length > 0
            ? sampleNearestPaletteIndexForCell(
                sourceImg,
                imgWidth,
                imgHeight,
                crop,
                builderW,
                builderH,
                cell.gx,
                cell.gy,
                builderPalette,
                getChromaFilter(),
              )
            : activeColorIdx;
        floodFillTraceCell(cell.gx, cell.gy, fillVal);
        return;
      }

      isDraggingRef.current = true;
      dragModeRef.current = 'paint';
      strokeSavedRef.current = false;
      const erase = e.button === 2 || activeTool === 'eraser';
      if (erase) {
        paintTraceCell(cell.gx, cell.gy, -1);
      } else if (useSampleBrush) {
        paintSampleCellAt(cell.gx, cell.gy);
      } else {
        paintTraceCell(cell.gx, cell.gy, activeColorIdx);
      }
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
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointersRef.current.size >= 2) {
      const pts = Array.from(activePointersRef.current.values());
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const prev = pinchStateRef.current;
      const canvas = canvasRef.current;
      if (prev && canvas) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const curZoom = zoomRef.current;
          const curPan = panRef.current;
          const scale = prev.dist > 4 ? dist / prev.dist : 1;
          const next = computeAnchoredZoomPan(
            curZoom,
            curPan,
            curZoom * scale,
            canvas.width,
            canvas.height,
            {
              x: ((prev.mx - rect.left) * canvas.width) / rect.width,
              y: ((prev.my - rect.top) * canvas.height) / rect.height,
            },
            {
              x: ((mx - rect.left) * canvas.width) / rect.width,
              y: ((my - rect.top) * canvas.height) / rect.height,
            },
          );
          zoomRef.current = next.zoom;
          panRef.current = next.pan;
          setZoom(next.zoom);
          setPan(next.pan);
        }
      }
      pinchStateRef.current = { dist, mx, my };
      return;
    }

    const { x, y, ox, oy } = canvasToImageCoords(e);

    if (dragModeRef.current === 'pan' || e.buttons === 4) {
      const p = {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      };
      panRef.current = p;
      setPan(p);
      return;
    }

    if (canvasViewMode === 'tileset') {
      const slotHit = canvasToTilesetSlot(ox, oy);
      if (
        slotHit.inside &&
        (tilesetHoverSlot?.col !== slotHit.col || tilesetHoverSlot?.row !== slotHit.row)
      ) {
        setTilesetHoverSlot({ col: slotHit.col, row: slotHit.row });
      } else if (!slotHit.inside && tilesetHoverSlot !== null) {
        setTilesetHoverSlot(null);
      }

      if (!isDraggingRef.current) return;

      if (dragModeRef.current === 'ts-position') {
        const nextCol = Math.max(0, Math.min(Math.max(0, tilesetCols - builderOutCols), slotHit.col));
        const nextRow = Math.max(0, Math.min(Math.max(0, tilesetRows - builderOutRows), slotHit.row));
        setStagedSlot({ col: nextCol, row: nextRow });
        setSelectedTilesetSlot({
          col: nextCol,
          row: nextRow,
          w: builderOutCols,
          h: builderOutRows,
        });
        return;
      }

      if (dragModeRef.current === 'ts-paint') {
        const erase = e.buttons === 2 || tilesetTool === 'eraser';
        paintTilesetAtCoords(ox, oy, erase);
        return;
      }
      return;
    }

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

    if (activeTool === 'pan') {
      const p = {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      };
      panRef.current = p;
      setPan(p);
      return;
    }

    if (dragModeRef.current === 'paint') {
      const cell = imageToTraceCell(ox, oy);
      if (cell) {
        setHoveredCell(cell);
        const erase = e.buttons === 2 || activeTool === 'eraser';
        if (erase) {
          paintTraceCell(cell.gx, cell.gy, -1);
        } else if (useSampleBrush) {
          paintSampleCellAt(cell.gx, cell.gy);
        } else {
          paintTraceCell(cell.gx, cell.gy, activeColorIdx);
        }
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

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }

    if (
      dragModeRef.current === 'ts-move' &&
      tilesetDragOriginRef.current &&
      tilesetHoverSlot
    ) {
      const orig = tilesetDragOriginRef.current;
      const toCol = Math.max(0, Math.min(tilesetCols - orig.w, tilesetHoverSlot.col));
      const toRow = Math.max(0, Math.min(tilesetRows - orig.h, tilesetHoverSlot.row));
      if (toCol !== orig.col || toRow !== orig.row) {
        void handleRepositionTilesetSlots(
          orig.col,
          orig.row,
          toCol,
          toRow,
          orig.w,
          orig.h,
          repositionMode,
        );
      }
    }

    isDraggingRef.current = false;
    dragModeRef.current = 'none';
    strokeSavedRef.current = false;
    tilesetPaintSavedRef.current = false;
    tilesetDragOriginRef.current = null;
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

  // Studio Output Tileset Management (non-destructive until explicitly applied to live map)
  const fitTilesetToViewport = (dimX: number, dimY: number) => {
    if (dimX <= 0 || dimY <= 0) return;
    const fitZoom = Math.min(
      6,
      Math.max(
        0.5,
        Math.min((canvasSize.w * 0.85) / dimX, (canvasSize.h * 0.85) / dimY),
      ),
    );
    const z = Number(fitZoom.toFixed(2));
    zoomRef.current = z;
    panRef.current = { x: 0, y: 0 };
    setZoom(z);
    setPan({ x: 0, y: 0 });
  };

  const pushTilesetUndo = () => {
    const work = tilesetWorkCanvasRef.current;
    if (!work) return;
    const ctx = work.getContext('2d');
    if (!ctx) return;
    const snap = {
      width: work.width,
      height: work.height,
      data: ctx.getImageData(0, 0, work.width, work.height),
      stamps: studioStamps.map((s) => ({ ...s, tiles: [...s.tiles] })),
    };
    tilesetUndoStackRef.current = [...tilesetUndoStackRef.current.slice(-24), snap];
    setTilesetUndoCount(tilesetUndoStackRef.current.length);
  };

  const handleTilesetUndo = () => {
    const snap = tilesetUndoStackRef.current[tilesetUndoStackRef.current.length - 1];
    if (!snap) return;
    tilesetUndoStackRef.current = tilesetUndoStackRef.current.slice(0, -1);
    setTilesetUndoCount(tilesetUndoStackRef.current.length);
    const canvas = document.createElement('canvas');
    canvas.width = snap.width;
    canvas.height = snap.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(snap.data, 0, 0);
    }
    tilesetWorkCanvasRef.current = canvas;
    setTilesetDimX(snap.width);
    setTilesetDimY(snap.height);
    setStudioStamps(snap.stamps);
    setTilesetVersion((v) => v + 1);
    setStatusMsg('Undid Output Tileset edit');
  };

  const drawDataUrlOntoWorkCanvas = (dataUrl: string, dimX: number, dimY: number): Promise<void> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = dimX;
        c.height = dimY;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0, dimX, dimY);
        }
        tilesetWorkCanvasRef.current = c;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });

  const loadImageIntoTilesetWorkspace = async (
    imgUrl: string,
    sourceLabel: 'map' | 'uploaded',
    initialStamps: TileMacroStamp[] = [],
  ) => {
    setIsProcessing(true);
    setStatusMsg(sourceLabel === 'map' ? 'Importing current map tileset into Output view…' : 'Loading PNG into Output Tileset…');
    try {
      const img = await new Promise<HTMLImageElement | null>((resolve) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => resolve(null);
        el.src = resolvePublicUrl(imgUrl);
      });
      if (!img) {
        setStatusMsg('Could not load tileset image.');
        return;
      }
      const w = Math.max(tileDim, Math.ceil(img.naturalWidth / tileDim) * tileDim);
      const h = Math.max(tileDim, Math.ceil(img.naturalHeight / tileDim) * tileDim);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
      }
      tilesetWorkCanvasRef.current = canvas;
      tilesetUndoStackRef.current = [];
      pendingTileRemapsRef.current = [];
      setTilesetUndoCount(0);
      setTilesetDimX(w);
      setTilesetDimY(h);
      setTilesetSourceLabel(sourceLabel);
      setTilesetHasEdits(false);
      setStudioStamps(initialStamps.map((s) => ({ ...s, tiles: [...s.tiles] })));
      const nextSlot = findFirstEmptyTileBlock(canvas, tileDim, builderOutCols, builderOutRows);
      setStagedSlot(nextSlot);
      setSelectedTilesetSlot({ ...nextSlot, w: 1, h: 1 });
      setTilesetVersion((v) => v + 1);
      setCanvasViewMode('tileset');
      fitTilesetToViewport(w, h);
      setStatusMsg(
        sourceLabel === 'map'
          ? `Imported current map tileset (${w}×${h}px, ${Math.floor(w / tileDim)}×${Math.floor(h / tileDim)} slots) — editing in Studio safely`
          : `Imported PNG tileset (${w}×${h}px)`,
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImportCurrentTilesetToOutput = () => {
    if (!map.tileSetUrl) {
      setStatusMsg('Current map has no tileset URL.');
      return;
    }
    void loadImageIntoTilesetWorkspace(map.tileSetUrl, 'map', map.stamps ?? []);
  };

  const handleImportCurrentTilesetAsRef = () => {
    if (!map.tileSetUrl) {
      setStatusMsg('Current map has no tileset URL.');
      return;
    }
    setCanvasViewMode('create');
    loadImageUrl(map.tileSetUrl);
    setStampName('Tileset Remix');
  };

  const handleUploadTilesetToOutput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      void loadImageIntoTilesetWorkspace(String(reader.result), 'uploaded', []);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleResetBlankTileset = () => {
    const c = ensureBlankTilesetCanvas(8, 4);
    if (canvasViewMode === 'tileset') {
      fitTilesetToViewport(c.width, c.height);
    }
    setStatusMsg('Created clean blank Output Tileset sheet (8×4 slots)');
  };

  const handleAddTilesetRow = (rowsToAdd: number = 1) => {
    const work = tilesetWorkCanvasRef.current || ensureBlankTilesetCanvas(8, 4);
    pushTilesetUndo();
    const nextH = work.height + Math.max(1, rowsToAdd) * tileDim;
    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = work.width;
    nextCanvas.height = nextH;
    const ctx = nextCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(work, 0, 0);
    }
    tilesetWorkCanvasRef.current = nextCanvas;
    setTilesetDimY(nextH);
    setTilesetHasEdits(true);
    setTilesetVersion((v) => v + 1);
    setStatusMsg(`Added ${rowsToAdd} empty tile row (${work.width}×${nextH}px)`);
  };

  const handleSnapDraftNextEmpty = () => {
    const work = tilesetWorkCanvasRef.current || ensureBlankTilesetCanvas(8, 4);
    const slot = findFirstEmptyTileBlock(work, tileDim, builderOutCols, builderOutRows);
    setShowStagedDraft(true);
    setStagedSlot(slot);
    setSelectedTilesetSlot({ ...slot, w: builderOutCols, h: builderOutRows });
    setStatusMsg(`Positioned Draft at next open ${builderOutCols}×${builderOutRows} slot (${slot.col}, ${slot.row})`);
  };

  const placeCanvasesIntoStudioTileset = async (
    canvases: HTMLCanvasElement[],
    colsSpan: number,
    rowsSpan: number,
    name: string,
    targetCol?: number,
    targetRow?: number,
    pushUndoFlag: boolean = true,
  ) => {
    const work = tilesetWorkCanvasRef.current || ensureBlankTilesetCanvas(8, 4);
    const slot =
      targetCol !== undefined && targetRow !== undefined
        ? { col: targetCol, row: targetRow }
        : findFirstEmptyTileBlock(work, tileDim, colsSpan, rowsSpan);
    if (pushUndoFlag) {
      pushTilesetUndo();
    }
    const placed = await placeTilesInTilesetAt(
      work,
      work.width,
      work.height,
      tileDim,
      canvases,
      slot.col,
      slot.row,
      colsSpan,
      rowsSpan,
    );
    await drawDataUrlOntoWorkCanvas(placed.newTilesetUrl, placed.newDimX, placed.newDimY);
    const stamp = createMacroStampFromIndices(
      name,
      colsSpan,
      rowsSpan,
      placed.tileIndices,
      targetLayer,
      blocksMovement,
    );
    const firstIdx = placed.tileIndices[0];
    setStudioStamps((prev) => [
      ...prev.filter((s) => !(s.tiles[0] === firstIdx && s.width === colsSpan && s.height === rowsSpan)),
      stamp,
    ]);
    setTilesetDimX(placed.newDimX);
    setTilesetDimY(placed.newDimY);
    setSelectedTilesetSlot({ col: slot.col, row: slot.row, w: colsSpan, h: rowsSpan });
    setTilesetHasEdits(true);
    setTilesetVersion((v) => v + 1);
    return { stamp, placed, col: slot.col, row: slot.row };
  };

  const handleCommitDraftToTileset = async () => {
    setIsProcessing(true);
    try {
      const rendered = renderPixelGridToCanvases(
        builderGrid,
        builderW,
        builderH,
        builderPalette,
        builderOutCols,
        builderOutRows,
        tileDim,
      );
      const { stamp, col, row } = await placeCanvasesIntoStudioTileset(
        rendered.canvases,
        builderOutCols,
        builderOutRows,
        stampName || `Motif (${builderW}×${builderH})`,
        stagedSlot.col,
        stagedSlot.row,
      );
      setShowStagedDraft(false);
      setStatusMsg(
        `Stamped "${stamp.name}" at (${col}, ${row}) [#${stamp.tiles[0]}..#${stamp.tiles[stamp.tiles.length - 1]}] — live map untouched until Apply`,
      );
    } catch (err) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRepositionTilesetSlots = async (
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    colsSpan: number,
    rowsSpan: number,
    mode: 'swap' | 'move',
  ) => {
    const work = tilesetWorkCanvasRef.current;
    if (!work) return;
    setIsProcessing(true);
    try {
      pushTilesetUndo();
      const res = await repositionTilesInTileset(
        work,
        work.width,
        work.height,
        tileDim,
        fromCol,
        fromRow,
        toCol,
        toRow,
        colsSpan,
        rowsSpan,
        mode,
      );
      await drawDataUrlOntoWorkCanvas(res.newTilesetUrl, res.newDimX, res.newDimY);
      if (tilesetSourceLabel === 'map' && Object.keys(res.indexRemap).length > 0) {
        pendingTileRemapsRef.current = [...pendingTileRemapsRef.current, res.indexRemap];
      }
      setStudioStamps((prev) =>
        prev.map((s) => ({
          ...s,
          tiles: s.tiles.map((t) => res.indexRemap[t] ?? t),
        })),
      );
      setTilesetDimX(res.newDimX);
      setTilesetDimY(res.newDimY);
      setSelectedTilesetSlot({ col: toCol, row: toRow, w: colsSpan, h: rowsSpan });
      setTilesetHasEdits(true);
      setTilesetVersion((v) => v + 1);
      setStatusMsg(
        `${mode === 'swap' ? 'Swapped' : 'Moved'} ${colsSpan}×${rowsSpan} tile block (${fromCol},${fromRow}) → (${toCol},${toRow})`,
      );
    } catch (err) {
      setStatusMsg(`Reposition error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearSelectedTilesetSlots = () => {
    const work = tilesetWorkCanvasRef.current;
    if (!work) return;
    const ctx = work.getContext('2d');
    if (!ctx) return;
    pushTilesetUndo();
    ctx.clearRect(
      selectedTilesetSlot.col * tileDim,
      selectedTilesetSlot.row * tileDim,
      selectedTilesetSlot.w * tileDim,
      selectedTilesetSlot.h * tileDim,
    );
    setTilesetHasEdits(true);
    setTilesetVersion((v) => v + 1);
    setStatusMsg(
      `Cleared slot (${selectedTilesetSlot.col}, ${selectedTilesetSlot.row}) [${selectedTilesetSlot.w}×${selectedTilesetSlot.h}]`,
    );
  };

  const handleLoadTilesetSlotToCreate = () => {
    const work = tilesetWorkCanvasRef.current;
    if (!work) return;
    const sx = selectedTilesetSlot.col * tileDim;
    const sy = selectedTilesetSlot.row * tileDim;
    const sw = selectedTilesetSlot.w * tileDim;
    const sh = selectedTilesetSlot.h * tileDim;
    const extract = document.createElement('canvas');
    extract.width = sw;
    extract.height = sh;
    const eCtx = extract.getContext('2d');
    if (!eCtx) return;
    eCtx.drawImage(work, sx, sy, sw, sh, 0, 0, sw, sh);
    setBuilderOutCols(selectedTilesetSlot.w);
    setBuilderOutRows(selectedTilesetSlot.h);
    setStampName(`Slot (${selectedTilesetSlot.col},${selectedTilesetSlot.row})`);
    setCanvasViewMode('create');
    loadImageUrl(extract.toDataURL('image/png'));
  };

  const handleDownloadTilesetPng = () => {
    const work = tilesetWorkCanvasRef.current;
    if (!work) return;
    const url = work.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `shevitsa-output-tileset-${work.width}x${work.height}.png`;
    a.click();
    setStatusMsg(`Exported ${work.width}×${work.height} PNG tileset`);
  };

  const handleApplyTilesetToMap = (options: { placeSelected?: boolean } = {}) => {
    const work = tilesetWorkCanvasRef.current;
    if (!work) return;
    const tilesetUrl = work.toDataURL('image/png');
    let nextMap: VillageMap = map;

    for (const remap of pendingTileRemapsRef.current) {
      nextMap = remapTileIndicesInMap(nextMap, remap);
    }

    let nextStamps: TileMacroStamp[] =
      tilesetSourceLabel === 'map'
        ? [...studioStamps]
        : studioStamps.length > 0
          ? [...(map.stamps ?? []), ...studioStamps]
          : [...(map.stamps ?? [])];

    nextMap = {
      ...nextMap,
      tileSetUrl: tilesetUrl,
      tileSetDimX: work.width,
      tileSetDimY: work.height,
      stamps: nextStamps,
    };

    if (options.placeSelected) {
      const cols = Math.max(1, Math.floor(work.width / tileDim));
      const indices: number[] = [];
      for (let r = 0; r < selectedTilesetSlot.h; r++) {
        for (let c = 0; c < selectedTilesetSlot.w; c++) {
          indices.push((selectedTilesetSlot.row + r) * cols + (selectedTilesetSlot.col + c));
        }
      }
      const existingMatch = nextStamps.find(
        (st) =>
          st.width === selectedTilesetSlot.w &&
          st.height === selectedTilesetSlot.h &&
          st.tiles[0] === indices[0],
      );
      const placeStamp =
        existingMatch ??
        createMacroStampFromIndices(
          stampName || `Tile (${selectedTilesetSlot.col},${selectedTilesetSlot.row})`,
          selectedTilesetSlot.w,
          selectedTilesetSlot.h,
          indices,
          targetLayer,
          blocksMovement,
        );
      if (!existingMatch) {
        nextStamps = [...nextStamps, placeStamp];
        nextMap = { ...nextMap, stamps: nextStamps };
      }

      const startX = Math.max(0, Math.floor((nextMap.width - placeStamp.width) / 2));
      const startY = Math.max(0, Math.floor((nextMap.height - placeStamp.height) / 2));
      const nextBg = nextMap.bgTiles.map((l) => l.map((colArr) => [...colArr]));
      const nextObj = nextMap.objectTiles.map((l) => l.map((colArr) => [...colArr]));
      const nextCol = nextMap.collisionGrid.map((colArr) => [...colArr]);
      const tgtLayer = placeStamp.layer ?? targetLayer;
      const layerGrid =
        tgtLayer === 'bg0'
          ? nextBg[0]
          : tgtLayer === 'bg1'
            ? nextBg[1]
            : tgtLayer === 'obj0'
              ? nextObj[0]
              : nextObj[1];

      for (let r = 0; r < placeStamp.height; r++) {
        for (let c = 0; c < placeStamp.width; c++) {
          const mapX = startX + c;
          const mapY = startY + r;
          const idx = placeStamp.tiles[r * placeStamp.width + c];
          if (mapX < nextMap.width && mapY < nextMap.height && idx !== undefined) {
            layerGrid[mapX][mapY] = idx;
            if (placeStamp.blocksMovement) {
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

    pendingTileRemapsRef.current = [];
    setTilesetHasEdits(false);
    onApplyMap(nextMap);
    setStatusMsg(
      options.placeSelected
        ? `Applied Output Tileset (${work.width}×${work.height}) & placed selection on live map!`
        : `Applied Output Tileset (${work.width}×${work.height}) to live world map!`,
    );
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

  // Save traced pixel pattern to Library & optionally stage in Output Tileset (NEVER auto-mutates map.tileSetUrl!)
  const handleSaveTracedPattern = (options: { positionInOutput?: boolean } = {}) => {
    const entry = saveCurrentPatternToLibrary();

    if (options.positionInOutput) {
      const work = tilesetWorkCanvasRef.current || ensureBlankTilesetCanvas(8, 4);
      const slot = findFirstEmptyTileBlock(work, tileDim, builderOutCols, builderOutRows);
      setShowStagedDraft(true);
      setStagedSlot(slot);
      setSelectedTilesetSlot({
        col: slot.col,
        row: slot.row,
        w: builderOutCols,
        h: builderOutRows,
      });
      setTilesetTool('position');
      setCanvasViewMode('tileset');
      fitTilesetToViewport(work.width, work.height);
      setStatusMsg(
        `Saved "${entry.name}" to Library & staged Draft in Output Tileset — position & edit before Stamp / Apply`,
      );
    } else {
      setStatusMsg(`Saved "${entry.name}" to Pattern Library (map tileset unchanged)`);
    }
  };

  // Raw image slice add -> stages directly into Studio Output Tileset (NOT live map!)
  const handleAddRawCropStamp = async () => {
    if (!sourceImg || crop.w <= 0 || crop.h <= 0) return;
    setIsProcessing(true);
    setStatusMsg('Placing raw crop tiles into Studio Output Tileset…');
    try {
      const sliced = sliceSelectionToTiles(sourceImg, imgWidth, imgHeight, crop, tileDim, {
        pixelate,
        trimAndFit,
        chromaKey: getChromaFilter(),
      });
      const { stamp, placed, col, row } = await placeCanvasesIntoStudioTileset(
        sliced.canvases,
        sliced.cols,
        sliced.rows,
        `${stampName || 'Motif'} (Raw)`,
      );
      setShowStagedDraft(false);
      setCanvasViewMode('tileset');
      fitTilesetToViewport(placed.newDimX, placed.newDimY);
      setStatusMsg(
        `Placed raw crop "${stamp.name}" at (${col}, ${row}) in Studio Output Tileset (live map unchanged)`,
      );
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
    setStatusMsg(`Placing ${selectedItems.length} motifs into Studio Output Tileset…`);

    try {
      const chromaKey = getChromaFilter();
      pushTilesetUndo();
      let placedCount = 0;

      for (const item of selectedItems) {
        const sliced = sliceSelectionToTiles(sourceImg, imgWidth, imgHeight, item.crop, tileDim, {
          pixelate,
          trimAndFit,
          chromaKey,
        });
        await placeCanvasesIntoStudioTileset(
          sliced.canvases,
          sliced.cols,
          sliced.rows,
          `${stampName || 'Motif'} #${item.id}`,
          undefined,
          undefined,
          false,
        );
        placedCount++;
      }

      setShowStagedDraft(false);
      setCanvasViewMode('tileset');
      const finalWork = tilesetWorkCanvasRef.current;
      fitTilesetToViewport(finalWork?.width ?? tilesetDimX, finalWork?.height ?? tilesetDimY);
      setStatusMsg(`Placed ${placedCount} batch motifs into Studio Output Tileset (live map unchanged)`);
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

  const handleStageSavedPatternToOutput = (entry: SavedPatternEntry) => {
    handleLoadSavedPattern(entry);
    const work = tilesetWorkCanvasRef.current || ensureBlankTilesetCanvas(8, 4);
    const slot = findFirstEmptyTileBlock(work, tileDim, entry.outCols, entry.outRows);
    setShowStagedDraft(true);
    setStagedSlot(slot);
    setSelectedTilesetSlot({
      col: slot.col,
      row: slot.row,
      w: entry.outCols,
      h: entry.outRows,
    });
    setTilesetTool('position');
    setCanvasViewMode('tileset');
    fitTilesetToViewport(work.width, work.height);
    setStatusMsg(`Staged "${entry.name}" Draft in Output Tileset at (${slot.col}, ${slot.row})`);
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
    canvasViewMode === 'tileset'
      ? tilesetTool === 'pan'
        ? 'cursor-grab active:cursor-grabbing'
        : tilesetTool === 'position' || tilesetTool === 'move'
          ? 'cursor-move'
          : 'cursor-crosshair'
      : pickingChromaKey
        ? 'cursor-crosshair'
        : activeTool === 'pan'
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
          {/* Unified Layer & Drawing / Output Tileset Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white shrink-0">
            {/* View Mode Toggle (Create vs Preview Output) + Contextual Tools */}
            <div className="flex flex-wrap items-center gap-1">
              <div
                className="flex items-center rounded bg-black/60 p-0.5 border border-white/15 mr-1"
                role="tablist"
                aria-label="Canvas View Mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={canvasViewMode === 'create'}
                  onClick={() => {
                    setCanvasViewMode('create');
                    zoomRef.current = 1;
                    panRef.current = { x: 0, y: 0 };
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold transition ${
                    canvasViewMode === 'create'
                      ? 'bg-crimson text-white shadow-sm'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  Create
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={canvasViewMode === 'tileset'}
                  onClick={() => {
                    setCanvasViewMode('tileset');
                    fitTilesetToViewport(tilesetDimX, tilesetDimY);
                  }}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold transition ${
                    canvasViewMode === 'tileset'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-white/65 hover:text-white'
                  }`}
                >
                  Preview Output
                </button>
              </div>

              {canvasViewMode === 'create' ? (
                <>
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

                  <button
                    type="button"
                    onClick={handleImportCurrentTilesetAsRef}
                    title="Load the active map tileset as reference image for tracing/remixing"
                    className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20"
                  >
                    <Layers className="h-3 w-3" />
                    <span>Cur Tileset</span>
                  </button>

                  <div className="mx-1 h-4 w-px bg-white/15" />

                  {/* Create Canvas Tool Palette */}
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
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleImportCurrentTilesetToOutput}
                    title="Import current map tileset into Output Tileset editor (does not modify live map until Applied)"
                    className="inline-flex items-center gap-1 rounded bg-emerald-700/80 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
                  >
                    <Layers className="h-3 w-3" />
                    <span>Import Cur Tileset</span>
                  </button>

                  <label className="inline-flex cursor-pointer items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20">
                    <Upload className="h-3 w-3" />
                    <span>PNG</span>
                    <input
                      type="file"
                      accept="image/png,image/webp,image/jpeg"
                      className="sr-only"
                      onChange={handleUploadTilesetToOutput}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleResetBlankTileset}
                    title="Reset to clean blank 8×4 Output Tileset"
                    className="rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20"
                  >
                    Blank
                  </button>

                  <button
                    type="button"
                    onClick={() => handleAddTilesetRow(1)}
                    title="Append 1 blank tile row"
                    className="inline-flex items-center gap-0.5 rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Row</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadTilesetPng}
                    title="Download Output Tileset as PNG"
                    className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20"
                  >
                    <Download className="h-3 w-3" />
                    <span>Export</span>
                  </button>

                  <div className="mx-1 h-4 w-px bg-white/15" />

                  {/* Output Tileset Tool Palette */}
                  {[
                    ['position', 'Position Staged Draft (V)', SquareDashedMousePointer],
                    ['move', 'Move / Swap Existing Tiles (M)', Move],
                    ['pencil', 'Pixel Pencil (B) - Paint Draft or Sheet', Pencil],
                    ['eraser', 'Eraser (E) - Erase Draft or Sheet Pixel', Eraser],
                    ['eyedropper', 'Eyedropper (I) - Pick Color', Pipette],
                    ['pan', 'Pan Viewport', Hand],
                  ].map(([id, title, Icon]) => {
                    const IconComp = Icon as React.ComponentType<{ className?: string }>;
                    return (
                      <button
                        key={id as string}
                        type="button"
                        onClick={() => setTilesetTool(id as TilesetTool)}
                        title={title as string}
                        className={`rounded p-1.5 transition ${
                          tilesetTool === id
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-white/75 hover:bg-white/15'
                        }`}
                      >
                        <IconComp className="h-3.5 w-3.5" />
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={handleTilesetUndo}
                    disabled={tilesetUndoCount === 0}
                    title="Undo Output Tileset Edit (Cmd/Ctrl+Z)"
                    className="rounded bg-white/10 p-1 text-white/80 hover:bg-white/20 disabled:opacity-40"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>

            {/* Layer Visibility, Opacity & Zoom */}
            <div className="flex flex-wrap items-center gap-2">
              {canvasViewMode === 'create' ? (
                <>
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
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setShowStagedDraft((v) => !v)}
                      title="Toggle Floating Draft Overlay"
                      className={showStagedDraft ? 'text-rose-400' : 'text-white/40'}
                    >
                      {showStagedDraft ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-white/60">Draft</span>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={traceLayerOpacity}
                      onChange={(e) => setTraceLayerOpacity(Number(e.target.value))}
                      title={`Draft Overlay Opacity: ${traceLayerOpacity}%`}
                      className="w-14"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setTilesetGridVisible((g) => !g)}
                    title="Toggle Tileset Slot Grid & Indices"
                    className={`rounded p-1 ${tilesetGridVisible ? 'bg-white/20 text-white' : 'text-white/45 hover:bg-white/10'}`}
                  >
                    <Grid className="h-3.5 w-3.5" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleZoomToCrop}
                title={
                  canvasViewMode === 'tileset'
                    ? 'Fit Output Tileset Sheet to Viewport'
                    : 'Zoom & Fit Active Crop Frame to Viewport'
                }
                className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-1 text-[10px] text-white/90 hover:bg-white/20"
              >
                <Focus className="h-3 w-3" />
                <span>{canvasViewMode === 'tileset' ? 'Fit Sheet' : 'Fit Crop'}</span>
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
                    zoomRef.current = 1;
                    panRef.current = { x: 0, y: 0 };
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  className="px-1 font-mono text-[10px] text-white/80"
                  title="Reset Zoom & Pan"
                >
                  {Number(zoom.toFixed(2))}×
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(24, Number((z + 0.5).toFixed(2))))}
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
            className={`relative flex-1 overflow-hidden select-none touch-none ${canvasCursorClass}`}
          >
            <canvas
              ref={canvasRef}
              width={canvasSize.w}
              height={canvasSize.h}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onLostPointerCapture={handlePointerUp}
              className="w-full h-full block touch-none"
            />

            {statusMsg && (
              <div className="absolute bottom-2 left-2 rounded bg-black/80 px-2 py-1 text-[11px] font-mono text-white/90 backdrop-blur-sm">
                {statusMsg}
              </div>
            )}

            <div className="absolute top-2 left-2 rounded bg-black/65 px-2 py-0.5 text-[10px] font-mono text-white/80 backdrop-blur-sm pointer-events-none">
              {canvasViewMode === 'tileset'
                ? `Output Tileset ${tilesetDimX}×${tilesetDimY} (${tilesetCols}×${tilesetRows} tiles) · Source: ${tilesetSourceLabel} · Slot (${selectedTilesetSlot.col},${selectedTilesetSlot.row})${tilesetHasEdits ? ' · Modified' : ''}`
                : imgWidth > 0
                  ? `${imgWidth}×${imgHeight} ref · Crop ${crop.w}×${crop.h} → Trace ${builderW}×${builderH}${useSampleBrush ? ' · Sample Brush' : ''}`
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
                {canvasViewMode === 'tileset' && (
                  <div className="rounded border border-emerald-700/40 bg-emerald-950/10 p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                        Output Tileset &amp; Slot Editor
                      </span>
                      <span className="font-mono text-[10px] text-muted">
                        #{selectedTilesetSlot.row * tilesetCols + selectedTilesetSlot.col} ({selectedTilesetSlot.col},{selectedTilesetSlot.row})
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                        <input
                          type="checkbox"
                          checked={showStagedDraft}
                          onChange={(e) => setShowStagedDraft(e.target.checked)}
                        />
                        <span>Show Staged Draft ({builderOutCols}×{builderOutRows})</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleSnapDraftNextEmpty}
                        className="rounded border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] font-medium hover:bg-card"
                      >
                        Next Empty
                      </button>
                    </div>

                    {showStagedDraft && (
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-1">
                          <span className="text-muted">Draft @ ({stagedSlot.col},{stagedSlot.row})</span>
                          <button
                            type="button"
                            onClick={() => nudgeStagedSlot(-1, 0)}
                            className="rounded border border-borderFolk bg-surface p-0.5 hover:bg-card"
                            title="Nudge Draft Left"
                          >
                            <ArrowLeft className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => nudgeStagedSlot(0, -1)}
                            className="rounded border border-borderFolk bg-surface p-0.5 hover:bg-card"
                            title="Nudge Draft Up"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => nudgeStagedSlot(0, 1)}
                            className="rounded border border-borderFolk bg-surface p-0.5 hover:bg-card"
                            title="Nudge Draft Down"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => nudgeStagedSlot(1, 0)}
                            className="rounded border border-borderFolk bg-surface p-0.5 hover:bg-card"
                            title="Nudge Draft Right"
                          >
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        </div>

                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={handleCommitDraftToTileset}
                          className="rounded bg-crimson px-2 py-0.5 font-semibold text-white hover:bg-crimson/90 disabled:opacity-50"
                        >
                          Stamp @ ({stagedSlot.col},{stagedSlot.row})
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-1.5 border-t border-borderFolk/50 pt-1.5 text-[10px]">
                      <div className="flex items-center rounded border border-borderFolk bg-surface p-0.5">
                        {(['swap', 'move'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setRepositionMode(m)}
                            className={`rounded px-1.5 py-0.5 capitalize ${
                              repositionMode === m
                                ? 'bg-emerald-600 text-white font-semibold'
                                : 'text-muted hover:text-ink'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleLoadTilesetSlotToCreate}
                          className="rounded border border-borderFolk bg-surface px-1.5 py-0.5 font-medium hover:bg-card"
                          title="Extract selected tile slot into Create tab for high-res tracing/remixing"
                        >
                          Edit in Create
                        </button>
                        <button
                          type="button"
                          onClick={handleClearSelectedTilesetSlots}
                          className="rounded border border-borderFolk bg-surface px-1.5 py-0.5 text-muted hover:text-crimson"
                          title="Erase pixels in selected tile slot"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

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
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] uppercase tracking-wider text-muted">
                          Traced ({builderW}×{builderH})
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewCompositeRef((v) => !v)}
                          title="Toggle isolated checkerboard preview vs transparent overlay over reference crop"
                          className={`rounded px-1 py-0.5 text-[9px] font-medium border transition ${
                            previewCompositeRef
                              ? 'border-indigoFolk bg-indigoFolk text-white'
                              : 'border-borderFolk bg-surface text-muted hover:text-ink'
                          }`}
                        >
                          {previewCompositeRef ? 'Over Ref' : 'Checker'}
                        </button>
                      </div>
                      <div
                        style={SUBTLE_CHECKER_STYLE}
                        className="relative flex items-center justify-center rounded border border-crimson/50 p-1.5 h-24 overflow-hidden"
                      >
                        {previewCompositeRef && rawCropPreviewUrl && (
                          <img
                            src={rawCropPreviewUrl}
                            alt="Reference underlay"
                            style={{ opacity: refOpacity / 100 }}
                            className="absolute inset-1.5 h-[calc(100%-0.75rem)] w-[calc(100%-0.75rem)] object-contain pixel-canvas"
                          />
                        )}
                        {builderPreviewUrl ? (
                          <img
                            src={builderPreviewUrl}
                            alt="Traced pixel pattern"
                            style={{
                              opacity: traceLayerVisible
                                ? (previewCompositeRef ? traceLayerOpacity / 100 : 1)
                                : 0,
                            }}
                            className={
                              previewCompositeRef
                                ? 'relative z-10 max-h-full max-w-full object-contain pixel-canvas'
                                : 'max-h-full max-w-full object-contain pixel-canvas'
                            }
                          />
                        ) : (
                          <span className="text-[10px] text-white/50">Trace or paint</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Overlay & Grid Transparency Controls (synced with canvas while previewing/editing) */}
                  <div className="grid grid-cols-2 gap-2 rounded border border-borderFolk/60 bg-surface/60 px-2 py-1.5 text-[10px]">
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between text-muted">
                        <button
                          type="button"
                          onClick={() => setTraceLayerVisible((v) => !v)}
                          className="inline-flex items-center gap-1 hover:text-ink"
                          title="Toggle Traced Overlay Visibility"
                        >
                          {traceLayerVisible ? (
                            <Eye className="h-3 w-3 text-cyan-400" />
                          ) : (
                            <EyeOff className="h-3 w-3 text-muted" />
                          )}
                          <span>Overlay</span>
                        </button>
                        <span className="font-mono">{traceLayerOpacity}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={traceLayerOpacity}
                        onChange={(e) => setTraceLayerOpacity(Number(e.target.value))}
                        aria-label="Trace Overlay Opacity"
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between text-muted">
                        <span>Grid / Dots</span>
                        <span className="font-mono">{traceGridOpacity}%</span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={100}
                        disabled={traceOverlayMode === 'off'}
                        value={traceGridOpacity}
                        onChange={(e) => setTraceGridOpacity(Number(e.target.value))}
                        aria-label="Stitch Grid Overlay Opacity"
                        className="w-full disabled:opacity-40"
                      />
                    </div>
                  </div>

                  {/* Identify Transparent Color Key & Apply */}
                  <div className="rounded border border-borderFolk/70 bg-surface/60 p-2 space-y-1.5 text-[10px]">
                    <div className="flex items-center justify-between gap-1.5">
                      <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-muted">
                        <input
                          type="checkbox"
                          checked={enableChroma}
                          onChange={(e) => setEnableChroma(e.target.checked)}
                        />
                        <span>Transp Key Color</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !pickingChromaKey;
                          setPickingChromaKey(next);
                          if (next) {
                            setStatusMsg('Click background pixel on canvas to ID Transparent Key');
                          }
                        }}
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium transition ${
                          pickingChromaKey
                            ? 'border-crimson bg-crimson text-white animate-pulse'
                            : 'border-borderFolk bg-card hover:bg-surface'
                        }`}
                        title="Click any color on the canvas to identify transparent background key"
                      >
                        <Pipette className="h-3 w-3" />
                        <span>{pickingChromaKey ? 'Click Canvas…' : 'Pick Transp'}</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={chromaHex}
                        onChange={(e) => {
                          setChromaHex(e.target.value);
                          setEnableChroma(true);
                        }}
                        title="Transparent key color"
                        className="h-5 w-7 shrink-0 cursor-pointer rounded border border-borderFolk p-0"
                      />
                      <span className="font-mono text-[10px] shrink-0">{chromaHex}</span>
                      <div className="flex-1 flex items-center gap-1.5">
                        <span className="text-muted shrink-0">Tol</span>
                        <input
                          type="range"
                          min={0}
                          max={50}
                          value={chromaTolerance}
                          onChange={(e) => {
                            setChromaTolerance(Number(e.target.value));
                            if (!enableChroma) setEnableChroma(true);
                          }}
                          aria-label="Transparent key color tolerance"
                          className="w-full"
                        />
                        <span className="font-mono w-7 text-right shrink-0">{chromaTolerance}%</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => handleApplyTranspToLayer(chromaHex, false)}
                        title="Knock out matching pixels from current traced layer while preserving hand edits"
                        className="rounded bg-indigoFolk px-1.5 py-1 font-medium text-white hover:bg-indigoFolk/90"
                      >
                        Apply → Layer
                      </button>
                      <button
                        type="button"
                        disabled={!sourceImg}
                        onClick={() => handleApplyTranspToLayer(chromaHex, true)}
                        title="Re-trace crop cleanly ignoring transparent key color"
                        className="rounded bg-emerald-700 px-1.5 py-1 font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        Re-Trace Clean
                      </button>
                      <button
                        type="button"
                        disabled={!sourceImg}
                        onClick={handleApplyColorKeyToImage}
                        title="Erase matching background color from the reference image itself"
                        className="rounded border border-borderFolk bg-card px-1.5 py-1 font-medium hover:bg-surface disabled:opacity-50"
                      >
                        Bake → Ref
                      </button>
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
                    {/* Sample Brush: samples underlying source pixel, snaps to closest palette color, and paints */}
                    <button
                      type="button"
                      onClick={() => {
                        setUseSampleBrush(true);
                        if (canvasViewMode === 'tileset') {
                          setTilesetTool('pencil');
                        } else if (activeTool === 'frame' || activeTool === 'eraser' || activeTool === 'eyedropper') {
                          setActiveTool('pencil');
                        }
                        setStatusMsg('Sample brush active — paints closest palette color from source image underneath');
                      }}
                      title="Sample: samples underlying source image cell, approximates closest palette color, and paints with it"
                      className={`inline-flex h-6 items-center gap-1 rounded-sm border-2 px-1.5 text-[10px] font-semibold transition ${
                        useSampleBrush && activeTool !== 'eraser' && tilesetTool !== 'eraser'
                          ? 'border-ink bg-emerald-600 text-white ring-2 ring-crimson/60 scale-105'
                          : 'border-indigoFolk/50 bg-indigoFolk/15 text-indigoFolk hover:bg-indigoFolk/25'
                      }`}
                    >
                      <Pipette className="h-3 w-3" />
                      <span>Sample</span>
                    </button>

                    {builderPalette.map((hex, idx) => {
                      const active = !useSampleBrush && idx === activeColorIdx && activeTool !== 'eraser' && tilesetTool !== 'eraser';
                      return (
                        <button
                          key={`${idx}-${hex}`}
                          type="button"
                          onClick={() => {
                            setUseSampleBrush(false);
                            setActiveColorIdx(idx);
                            if (canvasViewMode === 'tileset') {
                              if (tilesetTool === 'eraser' || tilesetTool === 'eyedropper' || tilesetTool === 'pan') {
                                setTilesetTool('pencil');
                              }
                            } else if (activeTool === 'frame' || activeTool === 'eraser' || activeTool === 'eyedropper') {
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

                  {useSampleBrush && (
                    <div className="flex items-center justify-between gap-2 rounded border border-emerald-600/40 bg-emerald-950/10 px-2 py-1 text-[10px] text-emerald-700">
                      <span>Sample Brush: samples src cell → closest swatch</span>
                      <button
                        type="button"
                        onClick={() => setUseSampleBrush(false)}
                        className="font-semibold underline hover:no-underline"
                      >
                        Use Swatch
                      </button>
                    </div>
                  )}

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
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleApplyTranspToLayer(builderPalette[activeColorIdx], false)}
                          title="Identify this swatch as Transparent Key and clear matching pixels from the traced layer"
                          className="rounded border border-indigoFolk/60 bg-indigoFolk/15 px-1.5 py-0.5 font-medium text-indigoFolk hover:bg-indigoFolk/25"
                        >
                          Set Transp
                        </button>
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
                        Stage {selectedSliceCount} Raw Motifs in Output
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
                    <span>Place Raw Crop in Output Tileset</span>
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
                      onClick={() => handleSaveTracedPattern({ positionInOutput: false })}
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
                                onClick={() => handleStageSavedPatternToOutput(entry)}
                                className="text-emerald-700 hover:underline font-medium"
                              >
                                Position in Output
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

          {/* Sticky Bottom Save / Output Tileset Actions */}
          <div className="border-t border-borderFolk bg-card p-2.5 space-y-1.5 shrink-0">
            {canvasViewMode === 'create' ? (
              <>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => handleSaveTracedPattern({ positionInOutput: true })}
                  className="flex w-full items-center justify-center gap-1.5 rounded bg-crimson px-3 py-2 text-xs font-semibold text-white hover:bg-crimson/90 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Save &amp; Position in Output</span>
                </button>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleSaveTracedPattern({ positionInOutput: false })}
                    className="flex items-center justify-center gap-1 rounded border border-borderFolk bg-surface px-2 py-1 text-[11px] font-medium hover:bg-card disabled:opacity-50"
                  >
                    <BookmarkPlus className="h-3 w-3" />
                    <span>Save to Library</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCanvasViewMode('tileset');
                      fitTilesetToViewport(tilesetDimX, tilesetDimY);
                    }}
                    className="flex items-center justify-center gap-1 rounded border border-emerald-700/50 bg-emerald-950/10 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-950/20"
                  >
                    <Grid className="h-3 w-3" />
                    <span>Preview Output</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                {showStagedDraft && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleCommitDraftToTileset}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-crimson px-3 py-1.5 text-xs font-semibold text-white hover:bg-crimson/90 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>
                      Stamp Draft @ ({stagedSlot.col}, {stagedSlot.row})
                    </span>
                  </button>
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleApplyTilesetToMap({ placeSelected: false })}
                    className="flex items-center justify-center gap-1 rounded bg-emerald-700 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    <span>Apply to Map</span>
                  </button>

                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleApplyTilesetToMap({ placeSelected: true })}
                    className="flex items-center justify-center gap-1 rounded border border-indigoFolk bg-indigoFolk/10 px-2 py-1.5 text-[11px] font-medium text-indigoFolk hover:bg-indigoFolk/20 disabled:opacity-50"
                  >
                    <Layers className="h-3 w-3" />
                    <span>Apply &amp; Place</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
