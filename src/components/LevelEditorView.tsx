import React, { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Download,
  Eraser,
  Hand,
  PaintBucket,
  Paintbrush,
  Pipette,
  Plus,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ANIMATION_CATALOG, TILESET_PRESETS } from '../data/defaultData';
import { drawAnimatedSprites, drawTileGrid, getCachedImage } from '../engine/renderer';
import type { PointOfInterest, TileGrid, TileMacroStamp, VillageMap } from '../engine/types';

interface LevelEditorViewProps {
  map: VillageMap;
  onApplyMap: (nextMap: VillageMap) => void;
}

type EditorLayer =
  | 'bg0'
  | 'bg1'
  | 'obj0'
  | 'obj1'
  | 'collision'
  | 'animated'
  | 'spawns'
  | 'pois';

type Tool = 'brush' | 'eraser' | 'fill' | 'eyedropper';

interface PaletteSelection {
  startX: number;
  startY: number;
  w: number;
  h: number;
}

function cloneMap(m: VillageMap): VillageMap {
  return {
    ...m,
    bgTiles: m.bgTiles.map((l) => l.map((c) => [...c])),
    objectTiles: m.objectTiles.map((l) => l.map((c) => [...c])),
    collisionGrid: m.collisionGrid.map((c) => [...c]),
    animatedSprites: m.animatedSprites.map((s) => ({ ...s })),
    spawnPoints: m.spawnPoints.map((p) => ({ ...p })),
    pointsOfInterest: (m.pointsOfInterest ?? []).map((p) => ({ ...p })),
    stamps: (m.stamps ?? []).map((s) => ({ ...s, tiles: [...s.tiles] })),
  };
}

export const LevelEditorView: React.FC<LevelEditorViewProps> = ({ map, onApplyMap }) => {
  const [draft, setDraft] = useState<VillageMap>(() => cloneMap(map));
  const [undoStack, setUndoStack] = useState<VillageMap[]>([]);
  const [activeLayer, setActiveLayer] = useState<EditorLayer>('bg0');
  const [tool, setTool] = useState<Tool>('brush');
  const [paletteSel, setPaletteSel] = useState<PaletteSelection>({
    startX: 271 % Math.max(1, Math.floor(map.tileSetDimX / map.tileDim)),
    startY: Math.floor(271 / Math.max(1, Math.floor(map.tileSetDimX / map.tileDim))),
    w: 1,
    h: 1,
  });
  const [brushSize, setBrushSize] = useState<number>(1);
  const [activeStampId, setActiveStampId] = useState<string | null>(null);
  const [newStampName, setNewStampName] = useState('House');
  const [newStampBlocks, setNewStampBlocks] = useState(true);
  const [selectedAnimSheet, setSelectedAnimSheet] = useState<string>('campfire.json');
  const [newSpawnLabel, setNewSpawnLabel] = useState('Village Gathering');
  const [newPoiTag, setNewPoiTag] = useState('Plaza');
  const [newPoiLabel, setNewPoiLabel] = useState('Village Plaza');
  const [newPoiNote, setNewPoiNote] = useState('');
  const [showGrid, setShowGrid] = useState(true);
  const [showCollision, setShowCollision] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [paletteZoom, setPaletteZoom] = useState(1);
  const [palettePanMode, setPalettePanMode] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [appliedToast, setAppliedToast] = useState(false);
  const [tilesetLoadTick, setTilesetLoadTick] = useState(0);

  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteScrollRef = useRef<HTMLDivElement | null>(null);
  const paintingRef = useRef(false);
  const paletteDragRef = useRef<{
    mode: 'none' | 'select' | 'pan';
    anchorX: number;
    anchorY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({ mode: 'none', anchorX: 0, anchorY: 0, scrollLeft: 0, scrollTop: 0 });

  useEffect(() => {
    setDraft(cloneMap(map));
  }, [map]);

  const tilesetCols = Math.max(1, Math.floor(draft.tileSetDimX / draft.tileDim));
  const tilesetRows = Math.max(1, Math.floor(draft.tileSetDimY / draft.tileDim));
  const selectedTileIdx = paletteSel.startX + paletteSel.startY * tilesetCols;
  const activeStamp: TileMacroStamp | undefined = activeStampId
    ? (draft.stamps ?? []).find((s) => s.id === activeStampId)
    : undefined;

  const pushUndo = (snapshot: VillageMap) => {
    setUndoStack((prev) => [...prev.slice(-19), cloneMap(snapshot)]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setDraft(prev);
  };

  // Preload/notify when tileset URL changes so switching tilesets renders immediately
  useEffect(() => {
    const img = new Image();
    img.onload = () => setTilesetLoadTick((t) => t + 1);
    img.src = draft.tileSetUrl;
  }, [draft.tileSetUrl]);

  // Render tileset palette
  useEffect(() => {
    const canvas = paletteCanvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const img = getCachedImage(draft.tileSetUrl);
      if (img) {
        ctx.drawImage(img, 0, 0, draft.tileSetDimX, draft.tileSetDimY);
      }
      // Highlight selected single or multi-tile rectangle
      const rx = paletteSel.startX * draft.tileDim;
      const ry = paletteSel.startY * draft.tileDim;
      const rw = paletteSel.w * draft.tileDim;
      const rh = paletteSel.h * draft.tileDim;
      ctx.fillStyle = 'rgba(255, 59, 48, 0.18)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = Math.max(2, 2 / paletteZoom);
      ctx.strokeRect(rx + 1, ry + 1, Math.max(2, rw - 2), Math.max(2, rh - 2));
    };
    draw();
    const timer = setInterval(draw, 200);
    return () => clearInterval(timer);
  }, [
    draft.tileSetUrl,
    draft.tileSetDimX,
    draft.tileSetDimY,
    draft.tileDim,
    paletteSel,
    paletteZoom,
    tilesetLoadTick,
  ]);

  // Render map editor canvas
  useEffect(() => {
    let raf = 0;
    const render = (now: number) => {
      const canvas = mapCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.fillStyle = '#1b1d1b';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const img = getCachedImage(draft.tileSetUrl);
          if (img) {
            draft.bgTiles.forEach((layer, idx) => {
              const alpha = activeLayer.startsWith('bg') && activeLayer !== `bg${idx}` ? 0.85 : 1;
              drawTileGrid(ctx, img, layer, draft.tileDim, tilesetCols, alpha);
            });
            draft.objectTiles.forEach((layer, idx) => {
              const alpha = activeLayer.startsWith('obj') && activeLayer !== `obj${idx}` ? 0.75 : 1;
              drawTileGrid(ctx, img, layer, draft.tileDim, tilesetCols, alpha);
            });
          }

          drawAnimatedSprites(ctx, draft, now / 1000);

          if (showCollision || activeLayer === 'collision') {
            ctx.save();
            ctx.fillStyle = 'rgba(210, 42, 42, 0.34)';
            for (let x = 0; x < draft.width; x++) {
              for (let y = 0; y < draft.height; y++) {
                if (draft.collisionGrid[x]?.[y]) {
                  ctx.fillRect(x * draft.tileDim, y * draft.tileDim, draft.tileDim, draft.tileDim);
                }
              }
            }
            ctx.restore();
          }

          if (showGrid) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
            ctx.lineWidth = 1;
            for (let x = 0; x <= draft.width; x++) {
              ctx.beginPath();
              ctx.moveTo(x * draft.tileDim, 0);
              ctx.lineTo(x * draft.tileDim, draft.height * draft.tileDim);
              ctx.stroke();
            }
            for (let y = 0; y <= draft.height; y++) {
              ctx.beginPath();
              ctx.moveTo(0, y * draft.tileDim);
              ctx.lineTo(draft.width * draft.tileDim, y * draft.tileDim);
              ctx.stroke();
            }
            ctx.restore();
          }

          // Spawn points
          for (const sp of draft.spawnPoints) {
            const cx = (sp.x + 0.5) * draft.tileDim;
            const cy = (sp.y + 0.5) * draft.tileDim;
            ctx.save();
            ctx.fillStyle = '#23436b';
            ctx.strokeStyle = '#fbf7ef';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.font = '600 10px Inter, sans-serif';
            ctx.fillStyle = '#fbf7ef';
            ctx.textAlign = 'center';
            ctx.fillText(sp.label, cx, cy - 13);
            ctx.restore();
          }

          // Points of Interest (#Tag markers)
          for (const poi of draft.pointsOfInterest ?? []) {
            const cx = (poi.x + 0.5) * draft.tileDim;
            const cy = (poi.y + 0.5) * draft.tileDim;
            ctx.save();
            ctx.fillStyle = '#d97706';
            ctx.strokeStyle = '#fffbeb';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy - 10);
            ctx.lineTo(cx + 9, cy);
            ctx.lineTo(cx, cy + 10);
            ctx.lineTo(cx - 9, cy);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.font = '700 10px Inter, sans-serif';
            ctx.fillStyle = '#fef3c7';
            ctx.textAlign = 'center';
            ctx.fillText(`#${poi.tag}`, cx, cy - 14);
            ctx.restore();
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [draft, activeLayer, showGrid, showCollision, tilesetCols]);

  const getActiveTileGrid = (m: VillageMap): TileGrid | null => {
    if (activeLayer === 'bg0') return m.bgTiles[0] ?? null;
    if (activeLayer === 'bg1') return m.bgTiles[1] ?? null;
    if (activeLayer === 'obj0') return m.objectTiles[0] ?? null;
    if (activeLayer === 'obj1') return m.objectTiles[1] ?? null;
    return null;
  };

  const applyAtTile = (tx: number, ty: number, isInitialClick: boolean) => {
    if (tx < 0 || ty < 0 || tx >= draft.width || ty >= draft.height) return;

    if (activeLayer === 'animated' && isInitialClick) {
      pushUndo(draft);
      const next = cloneMap(draft);
      if (tool === 'eraser') {
        const px = tx * next.tileDim;
        const py = ty * next.tileDim;
        next.animatedSprites = next.animatedSprites.filter(
          (s) => !(px >= s.x && px < s.x + s.w && py >= s.y && py < s.y + s.h),
        );
      } else {
        const cat = ANIMATION_CATALOG[selectedAnimSheet];
        if (cat) {
          next.animatedSprites.push({
            id: `anim-${Date.now()}`,
            x: tx * next.tileDim,
            y: ty * next.tileDim,
            w: cat.defaultW,
            h: cat.defaultH,
            layer: 1,
            sheet: selectedAnimSheet,
            animation: Object.keys(cat.spritesheet.animations)[0] || 'pixels_large',
          });
        }
      }
      setDraft(next);
      return;
    }

    if (activeLayer === 'spawns' && isInitialClick) {
      pushUndo(draft);
      const next = cloneMap(draft);
      if (tool === 'eraser') {
        next.spawnPoints = next.spawnPoints.filter((s) => s.x !== tx || s.y !== ty);
      } else {
        next.spawnPoints.push({
          id: `spawn-${Date.now()}`,
          label: newSpawnLabel.trim() || `Point ${next.spawnPoints.length + 1}`,
          x: tx,
          y: ty,
        });
      }
      setDraft(next);
      return;
    }

    if (activeLayer === 'pois' && isInitialClick) {
      pushUndo(draft);
      const next = cloneMap(draft);
      const pois: PointOfInterest[] = next.pointsOfInterest ?? [];
      if (tool === 'eraser') {
        next.pointsOfInterest = pois.filter((p) => p.x !== tx || p.y !== ty);
      } else {
        const cleanTag = newPoiTag.trim().replace(/^#/, '').replace(/[^a-zA-Z0-9_-]/g, '') || `POI${pois.length + 1}`;
        next.pointsOfInterest = [
          ...pois,
          {
            id: `poi-${Date.now()}`,
            tag: cleanTag,
            label: newPoiLabel.trim() || cleanTag,
            x: tx,
            y: ty,
            description: newPoiNote.trim() || undefined,
          },
        ];
      }
      setDraft(next);
      return;
    }

    if (activeLayer === 'collision') {
      if (isInitialClick) pushUndo(draft);
      setDraft((prev) => {
        const next = cloneMap(prev);
        for (let dx = 0; dx < brushSize; dx++) {
          for (let dy = 0; dy < brushSize; dy++) {
            const gx = tx + dx;
            const gy = ty + dy;
            if (gx >= 0 && gy >= 0 && gx < next.width && gy < next.height) {
              next.collisionGrid[gx][gy] = tool !== 'eraser';
            }
          }
        }
        return next;
      });
      return;
    }

    const grid = getActiveTileGrid(draft);
    if (!grid) return;

    if (tool === 'eyedropper') {
      const picked = grid[tx]?.[ty] ?? -1;
      if (picked >= 0) {
        setPaletteSel({
          startX: picked % tilesetCols,
          startY: Math.floor(picked / tilesetCols),
          w: 1,
          h: 1,
        });
        setActiveStampId(null);
        setTool('brush');
      }
      return;
    }

    if (tool === 'fill' && isInitialClick) {
      pushUndo(draft);
      const next = cloneMap(draft);
      const targetGrid = getActiveTileGrid(next)!;
      const targetVal = targetGrid[tx][ty];
      const replacement = selectedTileIdx;
      if (targetVal === replacement) return;

      const queue: Array<[number, number]> = [[tx, ty]];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        const k = `${cx},${cy}`;
        if (visited.has(k)) continue;
        visited.add(k);
        if (cx < 0 || cy < 0 || cx >= next.width || cy >= next.height) continue;
        if (targetGrid[cx][cy] !== targetVal) continue;
        targetGrid[cx][cy] = replacement;
        queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      setDraft(next);
      return;
    }

    if (isInitialClick) pushUndo(draft);
    setDraft((prev) => {
      const next = cloneMap(prev);
      const targetGrid = getActiveTileGrid(next);
      if (!targetGrid) return next;

      if (tool === 'eraser') {
        for (let dx = 0; dx < brushSize; dx++) {
          for (let dy = 0; dy < brushSize; dy++) {
            const gx = tx + dx;
            const gy = ty + dy;
            if (gx >= 0 && gy >= 0 && gx < next.width && gy < next.height) {
              targetGrid[gx][gy] = -1;
              if (activeLayer.startsWith('obj')) {
                next.collisionGrid[gx][gy] = false;
              }
            }
          }
        }
        return next;
      }

      if (activeStamp) {
        for (let dy = 0; dy < activeStamp.height; dy++) {
          for (let dx = 0; dx < activeStamp.width; dx++) {
            const gx = tx + dx;
            const gy = ty + dy;
            const tileVal = activeStamp.tiles[dy * activeStamp.width + dx] ?? -1;
            if (tileVal >= 0 && gx >= 0 && gy >= 0 && gx < next.width && gy < next.height) {
              targetGrid[gx][gy] = tileVal;
              if (activeStamp.blocksMovement || activeLayer.startsWith('obj')) {
                next.collisionGrid[gx][gy] = true;
              }
            }
          }
        }
        return next;
      }

      if (paletteSel.w > 1 || paletteSel.h > 1) {
        for (let dy = 0; dy < paletteSel.h; dy++) {
          for (let dx = 0; dx < paletteSel.w; dx++) {
            const gx = tx + dx;
            const gy = ty + dy;
            if (gx >= 0 && gy >= 0 && gx < next.width && gy < next.height) {
              const tileVal = paletteSel.startX + dx + (paletteSel.startY + dy) * tilesetCols;
              targetGrid[gx][gy] = tileVal;
              if (activeLayer.startsWith('obj')) {
                next.collisionGrid[gx][gy] = true;
              }
            }
          }
        }
        return next;
      }

      for (let dx = 0; dx < brushSize; dx++) {
        for (let dy = 0; dy < brushSize; dy++) {
          const gx = tx + dx;
          const gy = ty + dy;
          if (gx >= 0 && gy >= 0 && gx < next.width && gy < next.height) {
            targetGrid[gx][gy] = selectedTileIdx;
            if (activeLayer.startsWith('obj')) {
              next.collisionGrid[gx][gy] = true;
            }
          }
        }
      }
      return next;
    });
  };

  const getTileFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = mapCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    return {
      tx: Math.floor(px / draft.tileDim),
      ty: Math.floor(py / draft.tileDim),
    };
  };

  const handleTilesetUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const img = new Image();
      img.onload = () => {
        pushUndo(draft);
        setDraft((prev) => ({
          ...prev,
          tileSetUrl: url,
          tileSetDimX: img.naturalWidth,
          tileSetDimY: img.naturalHeight,
        }));
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };

  const handleResizeMap = (newW: number, newH: number) => {
    const w = Math.max(12, Math.min(80, newW));
    const h = Math.max(12, Math.min(64, newH));
    pushUndo(draft);
    const resizeGrid = (grid: TileGrid, fill: number) =>
      Array.from({ length: w }, (_, x) =>
        Array.from({ length: h }, (_, y) => grid[x]?.[y] ?? fill),
      );
    setDraft((prev) => ({
      ...prev,
      width: w,
      height: h,
      bgTiles: prev.bgTiles.map((l, i) => resizeGrid(l, i === 0 ? 271 : -1)),
      objectTiles: prev.objectTiles.map((l) => resizeGrid(l, -1)),
      collisionGrid: Array.from({ length: w }, (_, x) =>
        Array.from({ length: h }, (_, y) => prev.collisionGrid[x]?.[y] ?? false),
      ),
    }));
  };

  const handleExportMap = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportMap = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed.bgTiles) && typeof parsed.width === 'number') {
          pushUndo(draft);
          setDraft(cloneMap({
            ...parsed,
            pointsOfInterest: Array.isArray(parsed.pointsOfInterest) ? parsed.pointsOfInterest : [],
            stamps: Array.isArray(parsed.stamps) ? parsed.stamps : [],
          }));
        }
      } catch {
        // ignore invalid json
      }
    };
    reader.readAsText(file);
  };

  const applyLive = () => {
    onApplyMap(cloneMap(draft));
    setAppliedToast(true);
    setTimeout(() => setAppliedToast(false), 2000);
  };

  const getPaletteTileFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = paletteCanvasRef.current!;
    const rect = c.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * c.width;
    const py = ((e.clientY - rect.top) / rect.height) * c.height;
    return {
      tx: Math.max(0, Math.min(tilesetCols - 1, Math.floor(px / draft.tileDim))),
      ty: Math.max(0, Math.min(tilesetRows - 1, Math.floor(py / draft.tileDim))),
    };
  };

  const handleSaveStamp = () => {
    const tiles: number[] = [];
    for (let dy = 0; dy < paletteSel.h; dy++) {
      for (let dx = 0; dx < paletteSel.w; dx++) {
        tiles.push(paletteSel.startX + dx + (paletteSel.startY + dy) * tilesetCols);
      }
    }
    const stamp: TileMacroStamp = {
      id: `stamp-${Date.now()}`,
      name: newStampName.trim() || `Stamp ${(draft.stamps?.length ?? 0) + 1}`,
      width: paletteSel.w,
      height: paletteSel.h,
      tiles,
      blocksMovement: newStampBlocks,
    };
    pushUndo(draft);
    setDraft((prev) => ({
      ...prev,
      stamps: [...(prev.stamps ?? []), stamp],
    }));
    setActiveStampId(stamp.id);
    setTool('brush');
  };

  const handleStartSidebarResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(260, Math.min(680, startW + (ev.clientX - startX)));
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className="flex flex-col lg:flex-row h-full overflow-hidden"
      style={{ '--editor-sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* Left Sidebar: Layers, Tools, Tileset Palette */}
      <aside className="flex flex-col border-b lg:border-b-0 lg:border-r border-borderFolk bg-surface overflow-hidden shrink-0 lg:w-[var(--editor-sidebar-w)]">
        <div className="border-b border-borderFolk bg-card p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="map-name-input" className="text-xs font-semibold uppercase tracking-wider text-muted">
              Level Name
            </label>
            <span className="font-mono text-[11px] text-muted">
              {draft.width}×{draft.height}
            </span>
          </div>
          <input
            id="map-name-input"
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
            className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs"
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="map-width" className="block text-[11px] text-muted">
                Width (tiles)
              </label>
              <input
                id="map-width"
                type="number"
                min={12}
                max={80}
                value={draft.width}
                onChange={(e) => handleResizeMap(Number(e.target.value), draft.height)}
                className="w-full rounded border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
              />
            </div>
            <div>
              <label htmlFor="map-height" className="block text-[11px] text-muted">
                Height (tiles)
              </label>
              <input
                id="map-height"
                type="number"
                min={12}
                max={64}
                value={draft.height}
                onChange={(e) => handleResizeMap(draft.width, Number(e.target.value))}
                className="w-full rounded border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Layer Selector */}
        <div className="border-b border-borderFolk p-3 space-y-2">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Active Layer
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['bg0', 'Ground (BG 0)'],
                ['bg1', 'Detail (BG 1)'],
                ['obj0', 'Objects 0'],
                ['obj1', 'Objects 1'],
                ['collision', 'Collision Mask'],
                ['animated', 'Anim Sprites'],
                ['spawns', 'Spawn Points'],
                ['pois', 'POIs (#Tag)'],
              ] as Array<[EditorLayer, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveLayer(id)}
                className={`rounded border px-2 py-1 text-left text-xs font-medium ${
                  activeLayer === id
                    ? 'border-crimson bg-crimson text-white'
                    : 'border-borderFolk bg-card hover:border-crimson/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Paint Tools */}
          <div className="flex items-center gap-1 pt-1">
            {(
              [
                ['brush', Paintbrush, 'Brush'],
                ['fill', PaintBucket, 'Flood Fill'],
                ['eraser', Eraser, 'Eraser'],
                ['eyedropper', Pipette, 'Pick Tile'],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                aria-label={label}
                aria-pressed={tool === id}
                className={`inline-flex flex-1 items-center justify-center gap-1 rounded border py-1.5 text-xs ${
                  tool === id
                    ? 'border-indigoFolk bg-indigoFolk text-white'
                    : 'border-borderFolk bg-card hover:bg-surface'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          {/* Brush Size */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] font-medium text-muted">Brush Size</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => {
                    setBrushSize(sz);
                    setActiveStampId(null);
                  }}
                  aria-pressed={brushSize === sz}
                  className={`rounded border px-2 py-0.5 font-mono text-[11px] ${
                    brushSize === sz
                      ? 'border-indigoFolk bg-indigoFolk text-white'
                      : 'border-borderFolk bg-card hover:bg-surface'
                  }`}
                >
                  {sz}×{sz}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Context Palette: Tileset / Animated / Spawns / POIs */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 thin-scroll">
          {activeLayer === 'animated' ? (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                Click the map to place animated props (or use Eraser to remove).
              </p>
              {Object.entries(ANIMATION_CATALOG).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedAnimSheet(key)}
                  className={`flex w-full items-center justify-between rounded border px-2.5 py-2 text-xs ${
                    selectedAnimSheet === key
                      ? 'border-crimson bg-crimson/10 font-semibold'
                      : 'border-borderFolk bg-card'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="font-mono text-[10px] text-muted">
                    {item.defaultW}×{item.defaultH}
                  </span>
                </button>
              ))}
            </div>
          ) : activeLayer === 'spawns' ? (
            <div className="space-y-2">
              <label htmlFor="spawn-label" className="block text-xs font-medium">
                New Landmark / Spawn Label
              </label>
              <input
                id="spawn-label"
                type="text"
                value={newSpawnLabel}
                onChange={(e) => setNewSpawnLabel(e.target.value)}
                className="w-full rounded border border-borderFolk bg-card px-2 py-1 text-xs"
              />
              <ul className="space-y-1">
                {draft.spawnPoints.map((sp) => (
                  <li
                    key={sp.id}
                    className="flex items-center justify-between rounded border border-borderFolk bg-card px-2 py-1 text-xs"
                  >
                    <span>
                      {sp.label} <span className="font-mono text-[10px] text-muted">({sp.x},{sp.y})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          spawnPoints: p.spawnPoints.filter((x) => x.id !== sp.id),
                        }))
                      }
                      aria-label={`Remove ${sp.label}`}
                      className="text-crimson hover:opacity-80"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : activeLayer === 'pois' ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted">
                Place <code className="font-mono">#Tag</code> landmarks on the map to reference them in chat (e.g. <code className="font-mono">@Mara go to #Plaza</code>).
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label htmlFor="poi-tag" className="block text-[11px] font-medium">
                    #Tag
                  </label>
                  <input
                    id="poi-tag"
                    type="text"
                    value={newPoiTag}
                    onChange={(e) => setNewPoiTag(e.target.value.replace(/^#/, '').replace(/[^a-zA-Z0-9_-]/g, ''))}
                    placeholder="Plaza"
                    className="w-full rounded border border-borderFolk bg-card px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="poi-label" className="block text-[11px] font-medium">
                    Label
                  </label>
                  <input
                    id="poi-label"
                    type="text"
                    value={newPoiLabel}
                    onChange={(e) => setNewPoiLabel(e.target.value)}
                    placeholder="Village Plaza"
                    className="w-full rounded border border-borderFolk bg-card px-2 py-1 text-xs"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="poi-note" className="block text-[11px] font-medium">
                  Lore / Note (optional)
                </label>
                <input
                  id="poi-note"
                  type="text"
                  value={newPoiNote}
                  onChange={(e) => setNewPoiNote(e.target.value)}
                  placeholder="Stone fountain & market stalls"
                  className="w-full rounded border border-borderFolk bg-card px-2 py-1 text-xs"
                />
              </div>
              <ul className="space-y-1 pt-1">
                {(draft.pointsOfInterest ?? []).map((poi) => (
                  <li
                    key={poi.id}
                    className="flex items-center justify-between gap-2 rounded border border-borderFolk bg-card px-2 py-1 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-amberFolk">#{poi.tag}</span>{' '}
                      <span className="truncate">{poi.label}</span>{' '}
                      <span className="font-mono text-[10px] text-muted">({poi.x},{poi.y})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          pointsOfInterest: (p.pointsOfInterest ?? []).filter((x) => x.id !== poi.id),
                        }))
                      }
                      aria-label={`Remove #${poi.tag}`}
                      className="text-crimson hover:opacity-80 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="tileset-select" className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Tileset
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-borderFolk bg-card px-2 py-0.5 text-[11px] hover:bg-surface">
                  <Plus className="h-3 w-3" />
                  <span>Custom PNG</span>
                  <input type="file" accept="image/png,image/webp" className="sr-only" onChange={handleTilesetUpload} />
                </label>
              </div>
              <select
                id="tileset-select"
                value={draft.tileSetUrl}
                onChange={(e) => {
                  const preset = TILESET_PRESETS.find((t) => t.url === e.target.value);
                  if (preset) {
                    pushUndo(draft);
                    setDraft((p) => ({
                      ...p,
                      tileSetUrl: preset.url,
                      tileSetDimX: preset.w,
                      tileSetDimY: preset.h,
                    }));
                    setPaletteSel({ startX: 0, startY: 0, w: 1, h: 1 });
                    setActiveStampId(null);
                  }
                }}
                className="w-full rounded border border-borderFolk bg-card px-2 py-1 text-xs"
              >
                {TILESET_PRESETS.map((t) => (
                  <option key={t.url} value={t.url}>
                    {t.label}
                  </option>
                ))}
                {!TILESET_PRESETS.some((t) => t.url === draft.tileSetUrl) && (
                  <option value={draft.tileSetUrl}>Custom Tileset</option>
                )}
              </select>

              {/* Tile Resolution + Palette Zoom/Pan */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                <div className="flex items-center gap-1">
                  <label htmlFor="tile-res-select" className="text-muted">
                    Tile px
                  </label>
                  <select
                    id="tile-res-select"
                    value={draft.tileDim}
                    onChange={(e) => {
                      const nextDim = Number(e.target.value);
                      pushUndo(draft);
                      setDraft((p) => ({ ...p, tileDim: nextDim }));
                      setPaletteSel({ startX: 0, startY: 0, w: 1, h: 1 });
                      setActiveStampId(null);
                    }}
                    className="rounded border border-borderFolk bg-card px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    {[16, 24, 32, 48].map((dim) => (
                      <option key={dim} value={dim}>
                        {dim}px
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPaletteZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                    aria-label="Zoom out palette"
                    className="rounded border border-borderFolk bg-card p-1 hover:bg-surface"
                  >
                    <ZoomOut className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaletteZoom(1)}
                    aria-label="Reset palette zoom"
                    className="rounded border border-borderFolk bg-card px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {paletteZoom}×
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaletteZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                    aria-label="Zoom in palette"
                    className="rounded border border-borderFolk bg-card p-1 hover:bg-surface"
                  >
                    <ZoomIn className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPalettePanMode((v) => !v)}
                    aria-pressed={palettePanMode}
                    aria-label="Toggle palette pan mode"
                    className={`rounded border p-1 ${
                      palettePanMode
                        ? 'border-indigoFolk bg-indigoFolk text-white'
                        : 'border-borderFolk bg-card hover:bg-surface'
                    }`}
                  >
                    <Hand className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="text-[11px] font-mono text-muted flex items-center justify-between gap-2">
                <span>
                  {activeStamp
                    ? `Stamp: ${activeStamp.name} (${activeStamp.width}×${activeStamp.height})`
                    : paletteSel.w > 1 || paletteSel.h > 1
                      ? `Block ${paletteSel.w}×${paletteSel.h} @ (${paletteSel.startX},${paletteSel.startY})`
                      : `Tile #${selectedTileIdx} (${paletteSel.startX},${paletteSel.startY})`}
                </span>
                <span>
                  {tilesetCols}×{tilesetRows}
                </span>
              </div>

              <div
                ref={paletteScrollRef}
                className="overflow-auto rounded border border-borderFolk bg-stone-900 max-h-80 thin-scroll"
                onWheel={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY < 0 ? 0.25 : -0.25;
                    setPaletteZoom((z) => Math.max(0.5, Math.min(4, Number((z + delta).toFixed(2)))));
                  }
                }}
              >
                <canvas
                  ref={paletteCanvasRef}
                  width={draft.tileSetDimX}
                  height={draft.tileSetDimY}
                  onPointerDown={(e) => {
                    if (palettePanMode || e.button === 1 || e.altKey) {
                      const sc = paletteScrollRef.current;
                      paletteDragRef.current = {
                        mode: 'pan',
                        anchorX: e.clientX,
                        anchorY: e.clientY,
                        scrollLeft: sc?.scrollLeft ?? 0,
                        scrollTop: sc?.scrollTop ?? 0,
                      };
                      e.currentTarget.setPointerCapture(e.pointerId);
                      return;
                    }
                    const { tx, ty } = getPaletteTileFromEvent(e);
                    paletteDragRef.current = {
                      mode: 'select',
                      anchorX: tx,
                      anchorY: ty,
                      scrollLeft: 0,
                      scrollTop: 0,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setPaletteSel({ startX: tx, startY: ty, w: 1, h: 1 });
                    setActiveStampId(null);
                    setTool('brush');
                  }}
                  onPointerMove={(e) => {
                    const drag = paletteDragRef.current;
                    if (drag.mode === 'pan') {
                      const sc = paletteScrollRef.current;
                      if (sc) {
                        sc.scrollLeft = drag.scrollLeft - (e.clientX - drag.anchorX);
                        sc.scrollTop = drag.scrollTop - (e.clientY - drag.anchorY);
                      }
                      return;
                    }
                    if (drag.mode === 'select') {
                      const { tx, ty } = getPaletteTileFromEvent(e);
                      const minX = Math.min(drag.anchorX, tx);
                      const minY = Math.min(drag.anchorY, ty);
                      const maxX = Math.max(drag.anchorX, tx);
                      const maxY = Math.max(drag.anchorY, ty);
                      setPaletteSel({
                        startX: minX,
                        startY: minY,
                        w: maxX - minX + 1,
                        h: maxY - minY + 1,
                      });
                    }
                  }}
                  onPointerUp={() => {
                    paletteDragRef.current.mode = 'none';
                  }}
                  className={`pixel-canvas block ${palettePanMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
                  style={{
                    width: `${Math.round(draft.tileSetDimX * paletteZoom)}px`,
                    height: `${Math.round(draft.tileSetDimY * paletteZoom)}px`,
                  }}
                />
              </div>

              {/* Macros / Stamps */}
              <div className="rounded border border-borderFolk bg-card p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Macros / Stamps
                  </span>
                  <span className="text-[10px] font-mono text-muted">
                    {paletteSel.w}×{paletteSel.h} selected
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newStampName}
                    onChange={(e) => setNewStampName(e.target.value)}
                    placeholder="House, Bridge..."
                    aria-label="Stamp name"
                    className="min-w-0 flex-1 rounded border border-borderFolk bg-surface px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleSaveStamp}
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-indigoFolk px-2 py-1 text-[11px] font-medium text-white hover:opacity-95"
                  >
                    <BookmarkPlus className="h-3 w-3" />
                    <span>Save</span>
                  </button>
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newStampBlocks}
                    onChange={(e) => setNewStampBlocks(e.target.checked)}
                  />
                  <span>Stamp marks collision</span>
                </label>

                {(draft.stamps ?? []).length > 0 && (
                  <ul className="space-y-1 max-h-32 overflow-y-auto thin-scroll">
                    {(draft.stamps ?? []).map((st) => (
                      <li
                        key={st.id}
                        className={`flex items-center justify-between gap-1 rounded border px-2 py-1 text-xs ${
                          activeStampId === st.id
                            ? 'border-crimson bg-crimson/10 font-semibold'
                            : 'border-borderFolk bg-surface'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveStampId((cur) => (cur === st.id ? null : st.id));
                            setTool('brush');
                          }}
                          className="min-w-0 flex-1 text-left truncate"
                        >
                          {st.name}{' '}
                          <span className="font-mono text-[10px] text-muted">
                            ({st.width}×{st.height})
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (activeStampId === st.id) setActiveStampId(null);
                            setDraft((p) => ({
                              ...p,
                              stamps: (p.stamps ?? []).filter((x) => x.id !== st.id),
                            }));
                          }}
                          aria-label={`Delete stamp ${st.name}`}
                          className="text-crimson hover:opacity-80 shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Resizable vertical divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize tileset palette panel"
        onPointerDown={handleStartSidebarResize}
        className="hidden lg:block w-1.5 cursor-col-resize bg-borderFolk/60 hover:bg-indigoFolk/70 transition-colors shrink-0"
      />

      {/* Main Editor Canvas + Action Header */}
      <section className="flex flex-1 flex-col overflow-hidden bg-stone-950 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borderFolk bg-card px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>Undo</span>
            </button>

            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              <span>Grid</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={showCollision}
                onChange={(e) => setShowCollision(e.target.checked)}
              />
              <span>Collisions</span>
            </label>

            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted">Zoom</span>
              {[0.75, 1, 1.5].map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoom(z)}
                  className={`rounded px-2 py-0.5 font-mono ${
                    zoom === z ? 'bg-indigoFolk text-white' : 'bg-surface'
                  }`}
                >
                  {z}×
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportMap}
              className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs hover:bg-card"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export JSON</span>
            </button>

            <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs hover:bg-card">
              <Upload className="h-3.5 w-3.5" />
              <span>Import</span>
              <input type="file" accept="application/json" className="sr-only" onChange={handleImportMap} />
            </label>

            <button
              type="button"
              onClick={applyLive}
              className="inline-flex items-center gap-1.5 rounded bg-crimson px-3 py-1 text-xs font-semibold text-white hover:opacity-95"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{appliedToast ? 'Applied to Village!' : 'Apply to Live Village'}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 thin-scroll">
          <canvas
            ref={mapCanvasRef}
            width={draft.width * draft.tileDim}
            height={draft.height * draft.tileDim}
            onPointerDown={(e) => {
              paintingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              const { tx, ty } = getTileFromEvent(e);
              applyAtTile(tx, ty, true);
            }}
            onPointerMove={(e) => {
              if (!paintingRef.current) return;
              const { tx, ty } = getTileFromEvent(e);
              applyAtTile(tx, ty, false);
            }}
            onPointerUp={() => {
              paintingRef.current = false;
            }}
            className="pixel-canvas shadow-2xl border border-borderFolk cursor-crosshair"
            style={{
              width: `${draft.width * draft.tileDim * zoom}px`,
              height: `${draft.height * draft.tileDim * zoom}px`,
            }}
          />
        </div>
      </section>
    </div>
  );
};
