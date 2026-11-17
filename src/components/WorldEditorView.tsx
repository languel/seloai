import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderWorldLayer } from '../art/gameLook';
import type { PaletteName } from '../art/looks';
import { SCENE_LAYERS, kindsOnLayer, layerOf, type FeatureKind, type SceneFeature, type SceneLayer, type Terrain } from '../art/scene';
import { SHEVITSA_REFERENCES } from '../art/patternReferences';
import type { VillageMap } from '../engine/types';
import { PLACEABLE_FEATURES, type WorldCommand } from '../world/commands';
import { SCENE_GENERATORS, findGenerator, type SceneParamSpec, type SceneParams } from '../world/sceneGenerators';
import { PLOT_KINDS, pointInPolygon } from '../world/patchworkVillage';
import type { PatchKind } from '../art/scene';
import { bakeScene, type PlacedFeature, type SceneEdit } from '../world/worldScene';
import { GlyphButton } from './Glyph';
import { KnotDivider, StitchPanel, StitchSlider } from './Stitch';

interface WorldEditorViewProps {
  map: VillageMap;
  look: PaletteName;
  /** Runs a world command; returns an error message, or null when it was applied. */
  dispatch: (command: WorldCommand, label: string) => string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

type Tool = 'select' | 'paint' | 'place' | 'scatter' | 'erase' | 'landmark' | 'spawn';

const TOOLS: Array<[Tool, React.ComponentProps<typeof GlyphButton>['glyph'], string]> = [
  ['select', 'select', 'Select and move (drag a feature)'],
  ['paint', 'paint', 'Paint the ground'],
  ['place', 'place', 'Place a feature'],
  ['scatter', 'scatter', 'Scatter features with a brush (drag to sow)'],
  ['erase', 'erase', 'Cut away a feature or a landmark'],
  ['landmark', 'landmark', 'Name a place'],
  ['spawn', 'spawn', 'Add a start point'],
];

const TERRAIN_CHOICES: Array<[Terrain, string]> = [
  ['ground', 'Meadow'],
  ['road', 'Road'],
  ['water', 'Water'],
  ['bridge', 'Bridge'],
  ['dry', 'Dry ground'],
  ['wall', 'Wall'],
];

const FEATURE_SIZE: Partial<Record<FeatureKind, [number, number]>> = {
  house: [2, 2],
  well: [2, 2],
  hearth: [2, 2],
  star: [2, 2],
  pool: [2, 2],
  tree: [1, 2],
  pine: [1, 2],
  grove: [1, 2],
  sapling: [1, 2],
  field: [4, 3],
  vineyard: [4, 3],
  fence: [3, 3],
};

/** Medallion patterns a dancing ground can be grown from. */
const MEDALLION_REFS = SHEVITSA_REFERENCES.filter((r) => ['star', 'lozenge', 'rosette', 'labyrinth'].includes(r.grammar));
const TURN = Math.PI / 12;

const FEATURE_NAMES: Partial<Record<FeatureKind, string>> = {
  star: 'dancing ground',
  prop: 'bench or cross',
  wheat: 'wheat sheaf',
  rosette: 'knot rosette',
  hen: 'hens',
  duck: 'ducks',
};

const CELL = 32;

function describeEdit(edit: SceneEdit): string {
  switch (edit.op) {
    case 'terrain':
      return `Painted ${edit.cells.length} cell${edit.cells.length === 1 ? '' : 's'} ${edit.terrain}`;
    case 'place':
      return `Placed ${FEATURE_NAMES[edit.feature.kind] ?? edit.feature.kind} at ${edit.feature.x}, ${edit.feature.y}`;
    case 'scatter':
      return `Scattered ${edit.features.length} ${FEATURE_NAMES[edit.features[0]?.kind] ?? edit.features[0]?.kind ?? ''}`;
    case 'rotate':
      return `Turned ${edit.id} to ${Math.round((edit.angle * 180) / Math.PI)}°`;
    case 'layer':
      return `Moved ${edit.id} to ${edit.layer}`;
    case 'move':
      return `Moved ${edit.id} to ${edit.x}, ${edit.y}`;
    case 'remove':
      return `Removed ${edit.id}`;
    case 'landmark':
      return `Named ${edit.landmark.label}`;
    case 'removeLandmark':
      return `Unnamed ${edit.id}`;
    case 'spawn':
      return `Start point ${edit.spawn.label}`;
    case 'removeSpawn':
      return `Removed start ${edit.id}`;
    case 'title':
      return `Renamed to ${edit.title}`;
    case 'plot':
      return `Plot ${edit.id} became ${edit.kind}`;
  }
}

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function WorldEditorView({ map, look, dispatch, canUndo, canRedo, onUndo, onRedo }: WorldEditorViewProps) {
  const scene = map.scene;
  const baked = useMemo(() => (scene ? bakeScene(scene) : null), [scene]);
  // Layers, as in a tile map: one to work on, and any number hidden or locked.
  const [activeLayer, setActiveLayer] = useState<SceneLayer>('buildings');
  const [hidden, setHidden] = useState<ReadonlySet<SceneLayer>>(new Set());
  const [locked, setLocked] = useState<ReadonlySet<SceneLayer>>(new Set());
  const world = useMemo(() => renderWorldLayer(map, look, undefined, hidden), [map, look, hidden]);
  const generator = scene ? findGenerator(scene.recipe.generator) : undefined;

  const [tool, setTool] = useState<Tool>('select');
  const [terrain, setTerrain] = useState<Terrain>('road');
  const [plotKind, setPlotKind] = useState<PatchKind>('garden');
  const [brush, setBrush] = useState(1);
  const [featureKind, setFeatureKind] = useState<FeatureKind>('house');
  const [patternRef, setPatternRef] = useState<string>('');
  const [patternSize, setPatternSize] = useState(2);
  const [scatterCount, setScatterCount] = useState(4);
  const [showWalk, setShowWalk] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingPlace, setPendingPlace] = useState<{ kind: 'landmark' | 'spawn'; x: number; y: number } | null>(null);
  const [pendingLabel, setPendingLabel] = useState('');
  const [newGenerator, setNewGenerator] = useState(SCENE_GENERATORS[0].id);
  // Inline confirmations (pop-up dialogs can be blocked inside the app's browser).
  const [confirming, setConfirming] = useState<'new' | 'clear' | null>(null);
  const [titleDraft, setTitleDraft] = useState(map.name);
  useEffect(() => setTitleDraft(map.name), [map.name]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ zoom: 1, x: 0, y: 0, fitted: '' });
  const drag = useRef<
    | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { mode: 'paint'; cells: Map<number, [number, number]> }
    | { mode: 'move'; feature: SceneFeature; start: [number, number]; at: [number, number] }
    | { mode: 'scatter'; features: PlacedFeature[]; last: [number, number] }
    | null
  >(null);
  const hover = useRef<[number, number] | null>(null);
  const [frame, setFrame] = useState(0);
  const redraw = () => setFrame((f) => f + 1);

  const run = (command: WorldCommand, label: string) => {
    const error = dispatch(command, label);
    setNotice(error);
    return error === null;
  };
  const edit = (e: SceneEdit, label: string) => run({ type: 'scene.edit', edit: e }, label);

  // Only what can be seen and is not locked can be picked; the layer being worked on first.
  const featureAt = (x: number, y: number): SceneFeature | undefined => {
    if (!baked) return undefined;
    const open = baked.model.features.filter((f) => {
      const layer = layerOf(f);
      return !hidden.has(layer) && !locked.has(layer) && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h;
    });
    const rank = (f: SceneFeature) => (layerOf(f) === activeLayer ? 2 : 0) + (f.id?.startsWith('amb-') ? 0 : 1);
    return open.reduce<SceneFeature | undefined>((best, f) => (!best || rank(f) >= rank(best) ? f : best), undefined);
  };
  const layerKinds = kindsOnLayer(activeLayer, PLACEABLE_FEATURES);
  const sizeOf = (kind: FeatureKind): [number, number] => (kind === 'star' ? [patternSize, patternSize] : FEATURE_SIZE[kind] ?? [1, 1]);
  const pickLayer = (layer: SceneLayer) => {
    setActiveLayer(layer);
    if (layer === 'ground') {
      if (tool === 'place' || tool === 'scatter') setTool('paint');
      return;
    }
    const kinds = kindsOnLayer(layer, PLACEABLE_FEATURES);
    if (!kinds.includes(featureKind) && kinds[0]) setFeatureKind(kinds[0]);
    if (tool === 'paint') setTool('place');
  };
  const pickTool = (id: Tool) => {
    setTool(id);
    if (id === 'paint') setActiveLayer('ground');
    else if ((id === 'place' || id === 'scatter') && activeLayer === 'ground') pickLayer('plantings');
  };
  const placed = (kind: FeatureKind, x: number, y: number, id: string, angle?: number): PlacedFeature => {
    const [w, h] = sizeOf(kind);
    return { id, kind, x, y, w, h, ...(kind === 'star' && patternRef ? { ref: patternRef } : {}), ...(angle ? { angle } : {}) };
  };
  /** Sows a handful of the chosen kind round a cell, on cells nothing of the layer holds. */
  const sow = (into: PlacedFeature[], [cx, cy]: [number, number]) => {
    const r = brush + 1;
    const taken = new Set<number>();
    const mark = (f: { x: number; y: number; w: number; h: number }) => {
      for (let i = f.x; i < f.x + f.w; i++) for (let j = f.y; j < f.y + f.h; j++) taken.add(i * 100003 + j);
    };
    for (const f of baked?.model.features ?? []) if (layerOf(f) === activeLayer && !f.id?.startsWith('amb-')) mark(f);
    into.forEach(mark);
    const used = new Set([...(baked?.model.features ?? []).map((f) => f.id), ...into.map((f) => f.id)]);
    const [w, h] = sizeOf(featureKind);
    for (let tries = 0, made = 0; tries < scatterCount * 8 && made < scatterCount; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const x = Math.round(cx + Math.cos(a) * d - w / 2);
      const y = Math.round(cy + Math.sin(a) * d - h / 2);
      if (!inside([x, y]) || !inside([x + w - 1, y + h - 1])) continue;
      let free = true;
      for (let i = x; i < x + w && free; i++) for (let j = y; j < y + h; j++) if (taken.has(i * 100003 + j)) free = false;
      if (!free) continue;
      let id = uniqueId(`my-${featureKind}`);
      for (let n = 1; used.has(id); n++) id = `${uniqueId(`my-${featureKind}`)}-${n}`;
      used.add(id);
      // Houses lean a little, Chagall-wise; flat things may lie any way round.
      const angle = featureKind === 'house' ? (Math.random() - 0.5) * 0.4 : ['field', 'vineyard', 'star', 'rosette'].includes(featureKind) ? (Math.random() - 0.5) * 0.8 : 0;
      const f = placed(featureKind, x, y, id, angle);
      into.push(f);
      mark(f);
      made++;
    }
  };
  const turn = (f: SceneFeature, angle: number) => {
    if (!f.id) return;
    const a = Math.abs(angle) < 1e-6 ? 0 : Math.atan2(Math.sin(angle), Math.cos(angle));
    edit({ op: 'rotate', id: f.id, angle: a }, `Turn ${f.kind}`);
  };
  const selected = baked?.model.features.find((f) => f.id === selectedId);

  // Fit the world to the canvas when a different world (or size) arrives.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const key = `${map.width}x${map.height}`;
      const canvas = canvasRef.current!;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(wrap.clientWidth * ratio);
      canvas.height = Math.round(wrap.clientHeight * ratio);
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      if (view.current.fitted !== key) {
        const zoom = Math.min(wrap.clientWidth / (map.width * CELL), wrap.clientHeight / (map.height * CELL)) * 0.96;
        view.current = { zoom, x: (wrap.clientWidth - map.width * CELL * zoom) / 2, y: (wrap.clientHeight - map.height * CELL * zoom) / 2, fitted: key };
      }
      redraw();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [map.width, map.height]);

  // Draw the world, then the overlays and whatever is being done.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    const { zoom, x: ox, y: oy } = view.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio * zoom, 0, 0, ratio * zoom, ratio * ox, ratio * oy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(world, 0, 0);
    const lineW = 1 / zoom;
    if (showWalk) {
      ctx.fillStyle = 'rgba(170, 30, 20, 0.22)';
      for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) if (map.collisionGrid[x]?.[y]) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
    // Named places and start points, as small stitched markers.
    ctx.lineWidth = 1.5 * lineW;
    for (const p of map.pointsOfInterest ?? []) {
      ctx.strokeStyle = 'rgba(150, 20, 20, 0.9)';
      ctx.setLineDash([4 * lineW, 3 * lineW]);
      ctx.strokeRect(p.x * CELL + 3, p.y * CELL + 3, CELL - 6, CELL - 6);
    }
    for (const s of map.spawnPoints) {
      ctx.strokeStyle = 'rgba(20, 60, 140, 0.9)';
      ctx.setLineDash([2 * lineW, 2 * lineW]);
      ctx.beginPath();
      ctx.arc(s.x * CELL + CELL / 2, s.y * CELL + CELL / 2, CELL * 0.28, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([5 * lineW, 3 * lineW]);
    if (selected) {
      ctx.strokeStyle = 'rgba(160, 20, 20, 1)';
      ctx.lineWidth = 2 * lineW;
      ctx.strokeRect(selected.x * CELL, selected.y * CELL, selected.w * CELL, selected.h * CELL);
    }
    const d = drag.current;
    if (d?.mode === 'paint') {
      ctx.fillStyle = 'rgba(40, 90, 160, 0.35)';
      for (const [x, y] of d.cells.values()) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    } else if (d?.mode === 'move') {
      ctx.strokeStyle = 'rgba(160, 20, 20, 1)';
      ctx.strokeRect(d.at[0] * CELL, d.at[1] * CELL, d.feature.w * CELL, d.feature.h * CELL);
    } else if (d?.mode === 'scatter') {
      ctx.fillStyle = 'rgba(40, 110, 60, 0.35)';
      for (const f of d.features) ctx.fillRect(f.x * CELL, f.y * CELL, f.w * CELL, f.h * CELL);
    }
    const h = hover.current;
    if (h && !d) {
      ctx.strokeStyle = 'rgba(30, 30, 30, 0.7)';
      ctx.lineWidth = 1.2 * lineW;
      const hovered = tool === 'paint' ? baked?.model.patches?.find((p) => pointInPolygon([h[0] + 0.5, h[1] + 0.5], p.points)) : undefined;
      if (hovered) {
        ctx.lineWidth = 2.4 * lineW;
        ctx.beginPath();
        hovered.points.forEach(([px, py], k) => (k ? ctx.lineTo(px * CELL, py * CELL) : ctx.moveTo(px * CELL, py * CELL)));
        ctx.closePath();
        ctx.stroke();
      } else if (tool === 'paint') {
        const r = brush - 1;
        ctx.strokeRect((h[0] - r) * CELL, (h[1] - r) * CELL, (2 * r + 1) * CELL, (2 * r + 1) * CELL);
      } else if (tool === 'place') {
        const [w, hh] = sizeOf(featureKind);
        ctx.strokeRect(h[0] * CELL, h[1] * CELL, w * CELL, hh * CELL);
      } else if (tool === 'scatter') {
        ctx.beginPath();
        ctx.arc((h[0] + 0.5) * CELL, (h[1] + 0.5) * CELL, (brush + 1) * CELL, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(h[0] * CELL, h[1] * CELL, CELL, CELL);
      }
    }
    ctx.setLineDash([]);
  }, [frame, world, map, showWalk, selected, tool, brush, featureKind, patternSize]);

  const cellAt = (event: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { zoom, x, y } = view.current;
    return [Math.floor((event.clientX - rect.left - x) / (zoom * CELL)), Math.floor((event.clientY - rect.top - y) / (zoom * CELL))];
  };
  const inside = ([x, y]: [number, number]) => x >= 0 && y >= 0 && x < map.width && y < map.height;

  const addBrush = (cells: Map<number, [number, number]>, [cx, cy]: [number, number]) => {
    const r = brush - 1;
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) if (inside([x, y])) cells.set(x * 100003 + y, [x, y]);
  };

  const uniqueId = (base: string) => {
    const used = new Set([...(baked?.model.features ?? []).map((f) => f.id), ...(scene?.edits ?? []).flatMap((e) => (e.op === 'place' ? [e.feature.id] : []))]);
    let n = 1;
    while (used.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  };

  const onPointerDown = (event: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(event.pointerId);
    const cell = cellAt(event);
    const panning = event.button === 1 || event.button === 2 || event.altKey;
    // A tile map becomes a place on the first edit, as one undo step of its own.
    if (!panning && !scene && tool !== 'select') {
      if (!run({ type: 'scene.fromTiles' }, 'Edit as a place')) return;
      setNotice('This world is now a place you can edit. Do that again to make your first change.');
      return;
    }
    if (panning) {
      drag.current = { mode: 'pan', sx: event.clientX, sy: event.clientY, vx: view.current.x, vy: view.current.y };
      return;
    }
    if (!inside(cell)) return;
    const [x, y] = cell;
    const plots = baked?.model.patches;
    if (tool === 'paint' && plots) {
      // A patchwork village is painted plot by plot: the plot under the pointer takes the kind.
      const plot = plots.find((p) => pointInPolygon([x + 0.5, y + 0.5], p.points));
      if (plot?.id !== undefined && plot.kind !== plotKind) edit({ op: 'plot', id: plot.id, kind: plotKind }, `Plot becomes ${plotKind}`);
      redraw();
      return;
    }
    if (tool === 'paint') {
      const cells = new Map<number, [number, number]>();
      addBrush(cells, cell);
      drag.current = { mode: 'paint', cells };
    } else if (tool === 'select') {
      const f = featureAt(x, y);
      setSelectedId(f?.id ?? null);
      if (f) drag.current = { mode: 'move', feature: f, start: cell, at: [f.x, f.y] };
      else drag.current = { mode: 'pan', sx: event.clientX, sy: event.clientY, vx: view.current.x, vy: view.current.y };
    } else if (tool === 'place') {
      if (locked.has(activeLayer)) return void setNotice(`The ${activeLayer} layer is locked.`);
      const id = uniqueId(`my-${featureKind}`);
      if (edit({ op: 'place', feature: placed(featureKind, x, y, id) }, `Place ${featureKind}`)) setSelectedId(id);
    } else if (tool === 'scatter') {
      if (locked.has(activeLayer)) return void setNotice(`The ${activeLayer} layer is locked.`);
      const features: PlacedFeature[] = [];
      sow(features, cell);
      drag.current = { mode: 'scatter', features, last: cell };
    } else if (tool === 'erase') {
      const f = featureAt(x, y);
      const poi = (map.pointsOfInterest ?? []).find((p) => p.x === x && p.y === y);
      const spawn = map.spawnPoints.find((s) => s.x === x && s.y === y);
      if (poi) edit({ op: 'removeLandmark', id: poi.id }, `Unname ${poi.label}`);
      else if (spawn) edit({ op: 'removeSpawn', id: spawn.id }, `Remove start ${spawn.label}`);
      else if (f?.id) edit({ op: 'remove', id: f.id }, `Remove ${f.kind}`);
    } else {
      setPendingPlace({ kind: tool, x, y });
      setPendingLabel('');
    }
    redraw();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const cell = cellAt(event);
    hover.current = inside(cell) ? cell : null;
    const d = drag.current;
    if (d?.mode === 'pan') {
      view.current.x = d.vx + event.clientX - d.sx;
      view.current.y = d.vy + event.clientY - d.sy;
    } else if (d?.mode === 'paint' && inside(cell)) {
      addBrush(d.cells, cell);
    } else if (d?.mode === 'move') {
      d.at = [d.feature.x + cell[0] - d.start[0], d.feature.y + cell[1] - d.start[1]];
    } else if (d?.mode === 'scatter' && inside(cell) && Math.hypot(cell[0] - d.last[0], cell[1] - d.last[1]) >= brush + 1) {
      sow(d.features, cell);
      d.last = cell;
    }
    redraw();
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'paint' && d.cells.size > 0) {
      edit({ op: 'terrain', cells: [...d.cells.values()], terrain }, `Paint ${terrain}`);
    } else if (d?.mode === 'scatter' && d.features.length > 0) {
      edit({ op: 'scatter', features: d.features }, `Scatter ${featureKind}`);
    } else if (d?.mode === 'move' && d.feature.id && (d.at[0] !== d.feature.x || d.at[1] !== d.feature.y)) {
      edit({ op: 'move', id: d.feature.id, x: d.at[0], y: d.at[1] }, `Move ${d.feature.kind}`);
    }
    redraw();
  };

  // [ and ] turn the selected feature, as in a drawing program.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!selected || (event.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        turn(selected, (selected.angle ?? 0) + (event.key === ']' ? TURN : -TURN));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onWheel = (event: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const v = view.current;
    const zoom = Math.max(0.15, Math.min(4, v.zoom * Math.exp(-event.deltaY * 0.0015)));
    v.x = mx - ((mx - v.x) * zoom) / v.zoom;
    v.y = my - ((my - v.y) * zoom) / v.zoom;
    v.zoom = zoom;
    redraw();
  };

  const commitPending = () => {
    if (!pendingPlace) return;
    const label = pendingLabel.trim() || (pendingPlace.kind === 'landmark' ? 'A named place' : 'A start point');
    if (pendingPlace.kind === 'landmark') {
      const tag = label
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join('');
      edit({ op: 'landmark', landmark: { id: `poi-${slug(label) || 'place'}`, tag: tag || 'Place', label, x: pendingPlace.x, y: pendingPlace.y } }, `Name ${label}`);
    } else {
      edit({ op: 'spawn', spawn: { id: `spawn-${slug(label) || 'start'}`, label, x: pendingPlace.x, y: pendingPlace.y } }, `Start point ${label}`);
    }
    setPendingPlace(null);
  };

  const setParam = (spec: SceneParamSpec, value: SceneParams[string]) =>
    run({ type: 'scene.setRecipe', params: { [spec.key]: value } }, `${spec.label}: ${value}`);

  const skipped = new Map((baked?.skipped ?? []).map((s) => [s.index, s.reason]));

  return (
    <div className="flex h-full min-h-0 gap-2 p-2 text-ink">
      {/* Left: the recipe */}
      <StitchPanel className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto p-3 text-xs">
        <div className="font-display text-sm">World</div>
        {scene ? (
          <>
            <label className="flex flex-col gap-0.5">
              <span className="stitch-muted text-[10px]">Name</span>
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => titleDraft.trim() && titleDraft !== map.name && edit({ op: 'title', title: titleDraft.trim() }, 'Rename world')}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="rounded-sm border border-borderFolk bg-transparent px-1.5 py-1"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="stitch-muted text-[10px]">Made by</span>
              <select
                value={scene.base ? 'tiles' : scene.recipe.generator}
                disabled={Boolean(scene.base)}
                onChange={(e) => run({ type: 'scene.setRecipe', generator: e.target.value }, `Generator: ${e.target.value}`)}
                className="rounded-sm border border-borderFolk bg-transparent px-1 py-1"
              >
                {scene.base && <option value="tiles">A tile map, frozen as it was</option>}
                {SCENE_GENERATORS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <span className="stitch-muted text-[10px] leading-snug">{scene.base ? 'This world came from a tile map, so it has no recipe to change. Hand edits still work.' : generator?.description}</span>
            </label>
            {!scene.base && (
              <>
                {generator?.params.map((spec) => {
                  const value = scene.recipe.params[spec.key];
                  if (spec.type === 'bool') {
                    return (
                      <label key={spec.key} title={spec.hint} className="flex items-center justify-between gap-2">
                        <span>{spec.label}</span>
                        <input type="checkbox" checked={Boolean(value)} onChange={(e) => setParam(spec, e.target.checked)} />
                      </label>
                    );
                  }
                  if (spec.type === 'enum') {
                    return (
                      <label key={spec.key} title={spec.hint} className="flex flex-col gap-0.5">
                        <span>{spec.label}</span>
                        <select value={String(value)} onChange={(e) => setParam(spec, e.target.value)} className="rounded-sm border border-borderFolk bg-transparent px-1 py-1">
                          {spec.options.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  return (
                    <label key={spec.key} title={spec.hint} className="flex flex-col gap-0.5">
                      <span className="flex justify-between">
                        <span>{spec.label}</span>
                        <span className="stitch-muted">{String(value)}</span>
                      </span>
                      <StitchSlider
                        min={spec.min}
                        max={spec.max}
                        step={spec.step ?? (spec.type === 'int' ? 1 : 0.05)}
                        defaultValue={Number(value)}
                        key={`${spec.key}:${value}`}
                        onPointerUp={(e) => setParam(spec, Number((e.target as HTMLInputElement).value))}
                        onKeyUp={(e) => setParam(spec, Number((e.target as HTMLInputElement).value))}
                      />
                    </label>
                  );
                })}
                <div className="flex items-center gap-1.5">
                  <span>Seed</span>
                  <input
                    type="number"
                    value={scene.recipe.seed}
                    onChange={(e) => run({ type: 'scene.setRecipe', seed: Number(e.target.value) || 0 }, 'Change seed')}
                    className="w-20 rounded-sm border border-borderFolk bg-transparent px-1 py-0.5"
                  />
                  <GlyphButton
                    glyph="dice"
                    label="A new seed (your edits are kept)"
                    tipSide="below-left"
                    onClick={() => run({ type: 'scene.setRecipe', seed: (scene.recipe.seed * 7919 + 104729) % 1000003 }, 'New seed')}
                  />
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 leading-snug">
            <p>This world is a tile map. To edit it here, turn it into a place: it keeps how it looks and where people can walk.</p>
            <button type="button" className="stitch-panel px-2 py-1 text-left" onClick={() => run({ type: 'scene.fromTiles' }, 'Edit as a place')}>
              Edit this world as a place
            </button>
          </div>
        )}
        <KnotDivider orientation="horizontal" className="my-1" />
        <div className="font-display text-sm">New world</div>
        <select value={newGenerator} onChange={(e) => setNewGenerator(e.target.value)} className="rounded-sm border border-borderFolk bg-transparent px-1 py-1">
          {SCENE_GENERATORS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="stitch-panel px-2 py-1 text-left"
          onClick={() => setConfirming(confirming === 'new' ? null : 'new')}
        >
          Make a new world
        </button>
        {confirming === 'new' && (
          <div className="flex flex-col gap-1 leading-snug">
            <span>Replace this world with a new one? The cast stays, and you can undo.</span>
            <span className="flex gap-1">
              <button
                type="button"
                className="glyph-button glyph-on rounded-sm px-2 py-0.5"
                onClick={() => {
                  setConfirming(null);
                  run({ type: 'scene.create', generator: newGenerator, seed: 1 + Math.floor(Math.random() * 9999) }, 'New world');
                }}
              >
                Yes, make it
              </button>
              <button type="button" className="glyph-button rounded-sm px-2 py-0.5" onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </span>
          </div>
        )}
      </StitchPanel>

      {/* Middle: tools and the cloth */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <StitchPanel className="relative z-20 flex flex-wrap items-center gap-1 px-2 py-1 text-xs">
          {TOOLS.map(([id, glyph, label]) => (
            <GlyphButton
              key={id}
              glyph={glyph}
              label={scene || id === 'select' ? label : `${label} (this tile map becomes an editable place)`}
              pressed={tool === id}
              onClick={() => {
                pickTool(id);
                if (!scene && id !== 'select') run({ type: 'scene.fromTiles' }, 'Edit as a place');
              }}
            />
          ))}
          <KnotDivider className="mx-1 h-5" />
          {tool === 'paint' && baked?.model.patches && (
            <>
              <span className="stitch-muted">Plot</span>
              {PLOT_KINDS.map((k) => (
                <button key={k} type="button" aria-pressed={plotKind === k} onClick={() => setPlotKind(k)} className={`glyph-button rounded-sm px-1.5 py-0.5 capitalize ${plotKind === k ? 'glyph-on' : ''}`}>
                  {k}
                </button>
              ))}
              <span className="stitch-muted">click a plot</span>
            </>
          )}
          {tool === 'paint' && !baked?.model.patches && (
            <>
              {TERRAIN_CHOICES.map(([t, label]) => (
                <button key={t} type="button" aria-pressed={terrain === t} onClick={() => setTerrain(t)} className={`glyph-button rounded-sm px-1.5 py-0.5 ${terrain === t ? 'glyph-on' : ''}`}>
                  {label}
                </button>
              ))}
              <span className="stitch-muted ml-1">Brush</span>
              {[1, 2, 3].map((b) => (
                <button key={b} type="button" aria-pressed={brush === b} onClick={() => setBrush(b)} className={`glyph-button rounded-sm px-1.5 py-0.5 ${brush === b ? 'glyph-on' : ''}`}>
                  {b * 2 - 1}
                </button>
              ))}
            </>
          )}
          {(tool === 'place' || tool === 'scatter') && (
            <>
              {layerKinds.map((k) => (
                <button key={k} type="button" aria-pressed={featureKind === k} onClick={() => setFeatureKind(k)} className={`glyph-button rounded-sm px-1.5 py-0.5 ${featureKind === k ? 'glyph-on' : ''}`}>
                  {FEATURE_NAMES[k] ?? k}
                </button>
              ))}
              {featureKind === 'star' && (
                <>
                  <select value={patternRef} onChange={(e) => setPatternRef(e.target.value)} title="The pattern it is grown from" className="rounded-sm border border-borderFolk bg-transparent px-1 py-0.5">
                    <option value="">the world's own</option>
                    {MEDALLION_REFS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <span className="stitch-muted">Size</span>
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} type="button" aria-pressed={patternSize === n} onClick={() => setPatternSize(n)} className={`glyph-button rounded-sm px-1.5 py-0.5 ${patternSize === n ? 'glyph-on' : ''}`}>
                      {n}
                    </button>
                  ))}
                </>
              )}
              {tool === 'scatter' && (
                <>
                  <span className="stitch-muted ml-1">Brush</span>
                  {[1, 2, 3].map((b) => (
                    <button key={b} type="button" aria-pressed={brush === b} onClick={() => setBrush(b)} className={`glyph-button rounded-sm px-1.5 py-0.5 ${brush === b ? 'glyph-on' : ''}`}>
                      {b * 2 + 1}
                    </button>
                  ))}
                  <span className="stitch-muted ml-1">Each</span>
                  {[2, 4, 8].map((n) => (
                    <button key={n} type="button" aria-pressed={scatterCount === n} onClick={() => setScatterCount(n)} className={`glyph-button rounded-sm px-1.5 py-0.5 ${scatterCount === n ? 'glyph-on' : ''}`}>
                      {n}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
          {(tool === 'select' || tool === 'erase') && <span className="stitch-muted">Drag empty cloth to pan; scroll to zoom.</span>}
          <span className="flex-1" />
          <GlyphButton glyph="walkable" label="Show where people cannot walk" pressed={showWalk} dimOff onClick={() => setShowWalk((v) => !v)} />
          <GlyphButton glyph="undo" label="Undo" disabled={!canUndo} onClick={onUndo} />
          <GlyphButton glyph="redo" label="Redo" disabled={!canRedo} onClick={onRedo} tipSide="below-left" />
        </StitchPanel>
        <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden rounded-sm">
          <canvas
            ref={canvasRef}
            className={tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              hover.current = null;
              redraw();
            }}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
          {pendingPlace && (
            <StitchPanel className="absolute left-3 top-3 flex items-center gap-1.5 p-2 text-xs">
              <span>{pendingPlace.kind === 'landmark' ? 'Name this place' : 'Name this start point'}</span>
              <input
                autoFocus
                value={pendingLabel}
                onChange={(e) => setPendingLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitPending();
                  if (e.key === 'Escape') setPendingPlace(null);
                }}
                className="w-44 rounded-sm border border-borderFolk bg-transparent px-1 py-0.5"
              />
              <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={commitPending}>
                Add
              </button>
              <GlyphButton glyph="close" label="Cancel" onClick={() => setPendingPlace(null)} />
            </StitchPanel>
          )}
          {notice && (
            <StitchPanel className="stitch-thread absolute bottom-3 left-3 max-w-md p-2 text-xs" onClick={() => setNotice(null)}>
              {notice}
            </StitchPanel>
          )}
        </div>
      </div>

      {/* Right: selection and the hand edits */}
      <StitchPanel className="flex w-52 shrink-0 flex-col gap-2 overflow-hidden p-3 text-xs">
        <div className="font-display text-sm">Layers</div>
        <ol className="flex flex-col-reverse gap-0.5">
          {SCENE_LAYERS.map(({ id, name }) => {
            const count = id === 'ground' ? null : (baked?.model.features ?? []).filter((f) => layerOf(f) === id && !f.id?.startsWith('amb-')).length;
            const toggle = (set: ReadonlySet<SceneLayer>, apply: (s: Set<SceneLayer>) => void) => {
              const next = new Set(set);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              apply(next);
            };
            return (
              <li key={id} className={`flex items-center gap-1 rounded-sm px-1 ${activeLayer === id ? 'glyph-on' : ''}`}>
                <GlyphButton glyph="eye" size={13} label={hidden.has(id) ? `Show ${name}` : `Hide ${name}`} pressed={!hidden.has(id)} dimOff tipSide="below-right" onClick={() => toggle(hidden, setHidden)} />
                <GlyphButton glyph="lock" size={13} label={locked.has(id) ? `Unlock ${name}` : `Lock ${name}`} pressed={locked.has(id)} dimOff tipSide="below-right" onClick={() => toggle(locked, setLocked)} />
                <button type="button" aria-pressed={activeLayer === id} onClick={() => pickLayer(id)} className={`flex flex-1 justify-between text-left ${hidden.has(id) ? 'opacity-50' : ''}`}>
                  <span>{name}</span>
                  {count !== null && <span className="stitch-muted">{count}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <KnotDivider orientation="horizontal" className="my-1" />
        <div className="font-display text-sm">Selected</div>
        {selected ? (
          <div className="flex items-center justify-between gap-2">
            <span>
              {FEATURE_NAMES[selected.kind] ?? selected.kind} at {selected.x}, {selected.y}
              <span className="stitch-muted block text-[10px]">{selected.id}</span>
            </span>
            {selected.id && (
              <GlyphButton
                glyph="erase"
                label="Cut it away"
                tipSide="below-left"
                onClick={() => {
                  edit({ op: 'remove', id: selected.id! }, `Remove ${selected.kind}`);
                  setSelectedId(null);
                }}
              />
            )}
          </div>
        ) : (
          <span className="stitch-muted">Nothing. Pick the pointer and click a house, a tree or a well.</span>
        )}
        {selected?.id && (
          <>
            <div className="flex items-center gap-1">
              <GlyphButton glyph="rotate" label="Turn left ( [ )" size={14} tipSide="below-right" className="-scale-x-100" onClick={() => turn(selected, (selected.angle ?? 0) - TURN)} />
              <GlyphButton glyph="rotate" label="Turn right ( ] )" size={14} tipSide="below-right" onClick={() => turn(selected, (selected.angle ?? 0) + TURN)} />
              <span className="stitch-muted">{Math.round(((selected.angle ?? 0) * 180) / Math.PI)}°</span>
              {selected.angle ? (
                <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={() => turn(selected, 0)}>
                  Upright
                </button>
              ) : null}
            </div>
            <label className="flex items-center justify-between gap-1">
              <span className="stitch-muted">Layer</span>
              <select
                value={layerOf(selected)}
                onChange={(e) => edit({ op: 'layer', id: selected.id!, layer: e.target.value as SceneLayer }, `Move ${selected.kind} to ${e.target.value}`)}
                className="rounded-sm border border-borderFolk bg-transparent px-1 py-0.5"
              >
                {SCENE_LAYERS.filter((l) => l.id !== 'ground').map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <KnotDivider orientation="horizontal" className="my-1" />
        <div className="flex items-center justify-between">
          <span className="font-display text-sm">Your edits</span>
          {scene && scene.edits.length > 0 && (
            <button
              type="button"
              className="glyph-button rounded-sm px-1.5 py-0.5"
              onClick={() => setConfirming(confirming === 'clear' ? null : 'clear')}
            >
              Clear all
            </button>
          )}
        </div>
        {confirming === 'clear' && (
          <div className="flex items-center gap-1 text-[10px]">
            <span>Remove every hand edit? You can undo.</span>
            <button
              type="button"
              className="glyph-button glyph-on rounded-sm px-1.5 py-0.5"
              onClick={() => {
                setConfirming(null);
                run({ type: 'scene.clearEdits' }, 'Clear edits');
              }}
            >
              Yes
            </button>
            <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={() => setConfirming(null)}>
              No
            </button>
          </div>
        )}
        <span className="stitch-muted text-[10px] leading-snug">Kept on top of the generated world, so a new seed or setting keeps them.</span>
        <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {(scene?.edits ?? [])
            .map((e, i) => ({ e, i }))
            .reverse()
            .map(({ e, i }) => (
              <li key={i} className={`flex items-start justify-between gap-1 ${skipped.has(i) ? 'opacity-55' : ''}`}>
                <span>
                  {describeEdit(e)}
                  {skipped.has(i) && <span className="stitch-thread block text-[10px]">No longer applies: {skipped.get(i)}</span>}
                </span>
                <GlyphButton glyph="close" label="Remove this edit" size={12} tipSide="below-left" onClick={() => run({ type: 'scene.removeEdit', index: i }, 'Remove edit')} />
              </li>
            ))}
          {scene && scene.edits.length === 0 && <li className="stitch-muted">None yet.</li>}
        </ol>
      </StitchPanel>
    </div>
  );
}
