import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Eraser,
  PaintBucket,
  Paintbrush,
  Pipette,
  Plus,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { ANIMATION_CATALOG, TILESET_PRESETS } from '../data/defaultData';
import { drawAnimatedSprites, drawTileGrid, getCachedImage } from '../engine/renderer';
import type { TileGrid, VillageMap } from '../engine/types';

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
  | 'spawns';

type Tool = 'brush' | 'eraser' | 'fill' | 'eyedropper';

function cloneMap(m: VillageMap): VillageMap {
  return {
    ...m,
    bgTiles: m.bgTiles.map((l) => l.map((c) => [...c])),
    objectTiles: m.objectTiles.map((l) => l.map((c) => [...c])),
    collisionGrid: m.collisionGrid.map((c) => [...c]),
    animatedSprites: m.animatedSprites.map((s) => ({ ...s })),
    spawnPoints: m.spawnPoints.map((p) => ({ ...p })),
  };
}

export const LevelEditorView: React.FC<LevelEditorViewProps> = ({ map, onApplyMap }) => {
  const [draft, setDraft] = useState<VillageMap>(() => cloneMap(map));
  const [undoStack, setUndoStack] = useState<VillageMap[]>([]);
  const [activeLayer, setActiveLayer] = useState<EditorLayer>('bg0');
  const [tool, setTool] = useState<Tool>('brush');
  const [selectedTileIdx, setSelectedTileIdx] = useState<number>(271); // grass tile in gentle-obj
  const [selectedAnimSheet, setSelectedAnimSheet] = useState<string>('campfire.json');
  const [newSpawnLabel, setNewSpawnLabel] = useState('Village Gathering');
  const [showGrid, setShowGrid] = useState(true);
  const [showCollision, setShowCollision] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [appliedToast, setAppliedToast] = useState(false);

  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);

  useEffect(() => {
    setDraft(cloneMap(map));
  }, [map]);

  const tilesetCols = Math.max(1, Math.floor(draft.tileSetDimX / draft.tileDim));
  const tilesetRows = Math.max(1, Math.floor(draft.tileSetDimY / draft.tileDim));

  const pushUndo = (snapshot: VillageMap) => {
    setUndoStack((prev) => [...prev.slice(-19), cloneMap(snapshot)]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setDraft(prev);
  };

  // Render tileset palette
  useEffect(() => {
    const canvas = paletteCanvasRef.current;
    if (!canvas) return;
    const img = getCachedImage(draft.tileSetUrl);
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (img) {
        ctx.drawImage(img, 0, 0, draft.tileSetDimX, draft.tileSetDimY);
      }
      // Highlight selected tile
      if (selectedTileIdx >= 0) {
        const tx = (selectedTileIdx % tilesetCols) * draft.tileDim;
        const ty = Math.floor(selectedTileIdx / tilesetCols) * draft.tileDim;
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 3;
        ctx.strokeRect(tx + 1.5, ty + 1.5, draft.tileDim - 3, draft.tileDim - 3);
      }
    };
    draw();
    const timer = setInterval(draw, 350);
    return () => clearInterval(timer);
  }, [draft.tileSetUrl, draft.tileSetDimX, draft.tileSetDimY, draft.tileDim, selectedTileIdx, tilesetCols]);

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

    if (activeLayer === 'collision') {
      if (isInitialClick) pushUndo(draft);
      setDraft((prev) => {
        const next = cloneMap(prev);
        next.collisionGrid[tx][ty] = tool !== 'eraser';
        return next;
      });
      return;
    }

    const grid = getActiveTileGrid(draft);
    if (!grid) return;

    if (tool === 'eyedropper') {
      const picked = grid[tx]?.[ty] ?? -1;
      if (picked >= 0) {
        setSelectedTileIdx(picked);
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
    const val = tool === 'eraser' ? -1 : selectedTileIdx;
    setDraft((prev) => {
      const next = cloneMap(prev);
      const targetGrid = getActiveTileGrid(next);
      if (targetGrid) {
        targetGrid[tx][ty] = val;
        if (activeLayer.startsWith('obj')) {
          next.collisionGrid[tx][ty] = val !== -1;
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
          setDraft(parsed);
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

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[310px_1fr] overflow-hidden">
      {/* Left Sidebar: Layers, Tools, Tileset Palette */}
      <aside className="flex flex-col border-r border-borderFolk bg-surface overflow-hidden">
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
        </div>

        {/* Context Palette: Tileset / Animated / Spawns */}
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
                  <option value={draft.tileSetUrl}>Custom Embroidery Tileset</option>
                )}
              </select>

              <div className="text-[11px] font-mono text-muted">
                Tile #{selectedTileIdx} ({selectedTileIdx % tilesetCols},{' '}
                {Math.floor(selectedTileIdx / tilesetCols)}) · {tilesetCols}×{tilesetRows} grid
              </div>

              <div className="overflow-auto rounded border border-borderFolk bg-stone-900 max-h-80 thin-scroll">
                <canvas
                  ref={paletteCanvasRef}
                  width={draft.tileSetDimX}
                  height={draft.tileSetDimY}
                  onClick={(e) => {
                    const c = paletteCanvasRef.current!;
                    const rect = c.getBoundingClientRect();
                    const px = ((e.clientX - rect.left) / rect.width) * c.width;
                    const py = ((e.clientY - rect.top) / rect.height) * c.height;
                    const tx = Math.floor(px / draft.tileDim);
                    const ty = Math.floor(py / draft.tileDim);
                    setSelectedTileIdx(tx + ty * tilesetCols);
                    setTool('brush');
                  }}
                  className="pixel-canvas cursor-crosshair block"
                  style={{ width: `${Math.min(280, draft.tileSetDimX)}px`, height: 'auto' }}
                />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Editor Canvas + Action Header */}
      <section className="flex flex-col overflow-hidden bg-stone-950">
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
