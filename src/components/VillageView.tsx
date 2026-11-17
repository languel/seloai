import {
  FIGURE_HEIGHT_SCALE,
  chooseFigureView,
  figureLooksFor,
  figurePortrait,
  playerFigureBuild,
  clothOverlayColours,
  expressionFor,
  getFigureRig,
  paintRig,
  renderWorldLayer,
  type WorldLook,
} from '../art/gameLook';
import type { BodyPainter } from '../engine/renderer';
import { tileSemanticsForMap } from '../world/packs';
import { Glyph, GlyphButton, GlyphTip } from './Glyph';
import { KnotDivider, StitchPanel, StitchScope, StitchSlider } from './Stitch';
import { stitchKit } from '../art/uiChrome';
import { drawConversationThreads, type ThreadEnd } from '../art/threads';
import { WovenText, type WovenObstacle, type WovenSpeaker } from '../art/wovenText';
import { DUCTUS_X_HEIGHT, drawWovenLetter, type WovenStyle } from '../art/wovenGlyphs';
import { ductusAdvance } from '../art/ductus';
import { advanceOf } from '../art/wovenText';
import { ScribeBand, type ScribeLine } from '../art/scribeBand';
import { ThreadRope, drawThread } from '../art/threadRope';
import { seededFigureTraits } from '../art/figures';
import { createSeededRng, hashString } from '../core/rng';
import { clothAccent, clothPalette, setActiveWorldThreads, worldPalette, type PaletteName } from '../art/looks';
import { bakeScene } from '../world/worldScene';
import { glyphLookFor, isLightColour } from '../art/glyphRender';
import { getLastSimStepMs } from '../app/simulationDriver';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Director, type DirectorActor } from '../engine/director';
import {
  ArrowDown,
  Captions,
  ChevronDown,
  ChevronRight,
  LayoutList,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';
import { omniEngine } from '../ai/omniEngine';
import { useAutoScrollToBottom } from '../hooks/useAutoScrollToBottom';
import { resolvePublicUrl } from '../utils/assetUrl';
import { perfMemoryTracker, type PerfMemorySnapshot } from '../engine/perfMemoryTracker';
import {
  generateProceduralPlayerCustomSprite,
  getPlayerSpriteCacheCount,
} from '../engine/playerSpriteGenerator';
import {
  resolveWorldTheme,
  loadAestheticSettings,
  resolveAestheticTokens,
  type AestheticSettings,
} from '../utils/aestheticThemes';
import {
  computeSpatialMix,
  EAVESDROP_SLIDER_MAX,
  EAVESDROP_WHOLE_MAP_RADIUS,
  isWholeMapEavesdrop,
  MicRecorder,
} from '../ai/audioPipeline';
import {
  createOverlayCollector,
  drawAnimatedSprites,
  drawPlayer,
  drawPoiMarkers,
  drawTileGrid,
  drawVillager,
  getCachedImage,
  getCustomSpriteFrame,
  renderOverlayBatch,
  resolveOverlayBatch,
  SPEECH_BUBBLE_FONT_PX,
  SPEECH_BUBBLE_LINE_H_PX,
  type DeferredCanvasDraw,
} from '../engine/renderer';
import type { VillageSimulation } from '../engine/simulation';
import type {
  ModelSettings,
  PointOfInterest,
  VillagerConfig,
  VillagerRuntime,
} from '../engine/types';
import { abbreviatePersonName, tokenizeRichText } from '../utils/formatNames';
import { SPEED_LOG_MARKS } from '../utils/speedSlider';

interface VillageViewProps {
  sim: VillageSimulation;
  villagers: VillagerConfig[];
  settings: ModelSettings;
  onUpdateSettings: (patch: Partial<ModelSettings>) => void;
  onOpenMonitor: () => void;
  aestheticSettings?: AestheticSettings;
  /** Changes a style setting from the village toolbar (the letters of woven text). */
  onUpdateAesthetic?: (next: AestheticSettings) => void;
  sidebarOpen?: boolean;
  /**
   * A panel shown in the inspector's place (Style), at the inspector's width. The inspector
   * stays mounted underneath, hidden, so it comes back as it was.
   */
  sidebarSwap?: React.ReactNode;
  /** Starts the story again in the world as it is now (backed up first). */
  onResetStory?: () => void;
}

interface MentionCandidate {
  id: string;
  name: string;
  displayLabel: string;
  tokenText: string;
  role: string;
  accentColor: string;
  prefix?: '@' | '#';
  statusHint?: string;
  searchAliases?: string;
}

function renderRichLabels(
  text: string,
  villagers: VillagerConfig[],
  pois: PointOfInterest[],
  narratorName: string,
  variant: 'light' | 'dark' = 'light',
): React.ReactNode {
  if (!text) return text;
  const actorNames = ['all', 'world', narratorName, ...villagers.map((v) => v.name)].filter(Boolean);
  const segments = tokenizeRichText(text, pois, actorNames);
  return segments.map((seg, idx) => {
    if (seg.kind === 'poi') {
      return (
        <strong
          key={`poi-${idx}`}
          className={`font-bold ${variant === 'dark' ? 'text-amber-200' : 'text-amber-700 dark:text-amber-300'}`}
        >
          {seg.text}
        </strong>
      );
    }
    if (seg.kind === 'actor') {
      return (
        <strong
          key={`at-${idx}`}
          className={`font-bold ${variant === 'dark' ? 'text-sky-200' : 'text-indigoFolk'}`}
        >
          {seg.text}
        </strong>
      );
    }
    return <React.Fragment key={`txt-${idx}`}>{seg.text}</React.Fragment>;
  });
}

interface ActiveComposerMention {
  trigger: '@' | '#';
  query: string;
  node: Text;
  startOffset: number;
  endOffset: number;
}

function detectActiveMentionInComposer(root: HTMLElement | null): ActiveComposerMention | null {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || !root.contains(range.startContainer)) return null;
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;

  const textNode = range.startContainer as Text;
  const before = (textNode.textContent ?? '').slice(0, range.startOffset);
  const match = before.match(/(?:^|\s)([@#])([^\s\n@#]*)$/);
  if (!match) return null;
  const trigger = match[1] as '@' | '#';
  const query = match[2] ?? '';
  const startOffset = range.startOffset - (query.length + 1);
  if (startOffset < 0) return null;
  return {
    trigger,
    query,
    node: textNode,
    startOffset,
    endOffset: range.startOffset,
  };
}

function serializeComposerNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as HTMLElement;
  if (el.dataset.mentionToken) {
    return el.dataset.mentionToken;
  }
  if (el.tagName === 'BR') {
    return '\n';
  }
  let out = '';
  for (const child of el.childNodes) {
    out += serializeComposerNode(child);
  }
  return out;
}

function serializeComposerText(root: HTMLElement | null): string {
  if (!root) return '';
  let out = '';
  root.childNodes.forEach((child, idx) => {
    const isBlock =
      child.nodeType === Node.ELEMENT_NODE &&
      ((child as HTMLElement).tagName === 'DIV' || (child as HTMLElement).tagName === 'P');
    if (isBlock && idx > 0 && !out.endsWith('\n')) {
      out += '\n';
    }
    out += serializeComposerNode(child);
  });
  return out;
}

/** A range input: stitched inside the art looks, the browser's own in the classic tiles. */
function SpeedRange({ stitched, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { stitched: boolean }) {
  return stitched ? <StitchSlider {...rest} /> : <input type="range" {...rest} />;
}

const HAND_NAMES = { script: 'Script', ductus: 'Hand-sewn', satin: 'Satin', counted: 'Counted' } as const;

/** A #rrggbb colour darkened by `amount` (0..1). */
const DANCE_WORDS = /\b(danc\w*|khoro|horo|celebrat\w*|festiv\w*|wedding|feast|music)\b/i;
const danceGrounds = new WeakMap<object, Array<[number, number, number, number]>>();

/**
 * Whether a character is dancing: standing still and not talking, either because what they
 * are doing is a dance or a celebration, or because they stand on a dancing ground.
 * Everyone else keeps their arms down.
 */
function isDancing(sim: VillageSimulation, body: { id: string; tileX: number; tileY: number; tileDim: number; moving: boolean; state?: string }): boolean {
  if (body.moving || body.state === 'speaking' || body.state === 'walking' || body.state === 'thinking') return false;
  const label = sim.runtimes.get(body.id)?.activityLabel ?? '';
  if (DANCE_WORDS.test(label)) return true;
  const scene = sim.map.scene;
  if (!scene) return false;
  let grounds = danceGrounds.get(scene);
  if (!grounds) {
    grounds = bakeScene(scene).model.features.filter((f) => f.kind === 'star').map((f): [number, number, number, number] => [f.x - 0.5, f.y - 0.5, f.x + f.w + 0.5, f.y + f.h + 0.5]);
    danceGrounds.set(scene, grounds);
  }
  const x = body.tileX / body.tileDim + 0.5;
  const y = body.tileY / body.tileDim + 0.5;
  return grounds.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

/** The stitch kit's scope around a part of the interface, when the world is drawn as cloth. */
function MaybeStitch({ on, look, children }: { on: boolean; look: PaletteName; children: React.ReactNode }) {
  return on ? <StitchScope look={look}>{children}</StitchScope> : <>{children}</>;
}

function deepen(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

function SubtitleBox({ stitched, ...rest }: React.HTMLAttributes<HTMLDivElement> & { stitched: boolean }) {
  return stitched ? <StitchPanel {...rest} /> : <div {...rest} />;
}

/** The character's head and shoulders, drawn from the same figure as in the world. */
const FigurePortraitThumb: React.FC<{ villager: VillagerConfig; look: PaletteName; size: number }> = ({ villager, look, size }) => {
  const src = React.useMemo(() => {
    const ratio = typeof window === 'undefined' ? 2 : Math.max(2, Math.ceil(window.devicePixelRatio || 1));
    const { build, kind, seed, traits } = figureLooksFor(villager);
    return figurePortrait(villager.id, look, size, build, 'bust', ratio, kind, { seed, traits })?.toDataURL() ?? '';
  }, [villager, look, size]);
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="shrink-0" style={{ width: size, height: size }} />;
};

const VillagerAvatarThumb: React.FC<{ villager: VillagerConfig; size?: number; look?: PaletteName }> = ({
  villager,
  size = 28,
  look,
}) => {
  if (look) return <FigurePortraitThumb villager={villager} look={look} size={size} />;
  return <SpriteAvatarThumb villager={villager} size={size} />;
};

const SpriteAvatarThumb: React.FC<{ villager: VillagerConfig; size: number }> = ({ villager, size }) => {
  const thumbRef = useRef<HTMLCanvasElement | null>(null);
  const frame = villager.customSprite
    ? getCustomSpriteFrame(villager.customSprite, 'down', 0, false)
    : null;

  useEffect(() => {
    const canvas = thumbRef.current;
    if (!canvas || !frame) return;
    let cancelled = false;
    let preload: HTMLImageElement | null = null;
    const draw = () => {
      if (cancelled) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      const img = getCachedImage(frame.url);
      if (img) {
        const scale = Math.min(size / frame.sw, size / frame.sh);
        const dw = Math.max(1, Math.round(frame.sw * scale));
        const dh = Math.max(1, Math.round(frame.sh * scale));
        const dx = Math.round((size - dw) / 2);
        const dy = Math.round((size - dh) / 2);
        ctx.drawImage(img, frame.sx, frame.sy, frame.sw, frame.sh, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = villager.accentColor;
        ctx.fillRect(4, 4, size - 8, size - 8);
        preload = new Image();
        preload.onload = () => {
          if (!cancelled) draw();
        };
        preload.onerror = () => {
          preload = null;
        };
        preload.src = resolvePublicUrl(frame.url);
      }
    };
    draw();
    return () => {
      cancelled = true;
      if (preload) {
        preload.onload = null;
        preload.onerror = null;
        preload = null;
      }
    };
  }, [frame?.url, frame?.sx, frame?.sy, frame?.sw, frame?.sh, villager.accentColor, size]);

  return (
    <canvas
      ref={thumbRef}
      width={size}
      height={size}
      className="pixel-canvas shrink-0"
      style={{ width: size, height: size }}
    />
  );
};

const LivePerfHudOverlay: React.FC<{
  panelStyle: React.CSSProperties;
  textColor: string;
  mutedColor: string;
  hasBottomSubtitle?: boolean;
  onOpenMonitor: () => void;
  onClose: () => void;
}> = ({ panelStyle, textColor, mutedColor, hasBottomSubtitle, onOpenMonitor, onClose }) => {
  const [snap, setSnap] = useState<PerfMemorySnapshot>(() => perfMemoryTracker.getLatestSnapshot());
  useEffect(() => perfMemoryTracker.subscribe(setSnap), []);

  const fmtMb = (bytes: number | null) =>
    bytes === null ? 'N/A' : `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 * 1000 ? 0 : 1)} MB`;
  const healthColor =
    snap.health.status === 'leak-risk'
      ? '#ef4444'
      : snap.health.status === 'pressure'
        ? '#f97316'
        : snap.health.status === 'watch'
          ? '#eab308'
          : '#22c55e';

  return (
    <div
      role="region"
      aria-label="Live Performance and Memory HUD"
      style={panelStyle}
      className={`absolute right-3 z-20 w-64 rounded-md px-2.5 py-2 text-[11px] font-mono shadow-lg ${
        hasBottomSubtitle ? 'bottom-24' : 'bottom-3'
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: textColor }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: healthColor }} />
          <span>Perf &amp; Memory ({snap.health.status})</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Close Performance HUD"
          aria-label="Close Performance HUD"
          className="rounded p-0.5 hover:bg-white/10"
          style={{ color: mutedColor }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="space-y-1 text-[10px]" style={{ color: textColor }}>
        <div className="flex justify-between">
          <span style={{ color: mutedColor }}>FPS / Frame</span>
          <span>
            {snap.fps} fps · {snap.frameDtAvgMs.toFixed(1)}ms (p95 {snap.frameDtP95Ms.toFixed(0)}ms)
          </span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: mutedColor }}>Step / Render</span>
          <span>
            {snap.simStepAvgMs.toFixed(2)}ms / {snap.renderAvgMs.toFixed(2)}ms
          </span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: mutedColor }}>JS Heap</span>
          <span>
            {snap.jsHeapSupported
              ? `${fmtMb(snap.jsHeapUsedBytes)} (${snap.jsHeapSlopeMbPerMin >= 0 ? '+' : ''}${snap.jsHeapSlopeMbPerMin.toFixed(1)} MB/m)`
              : 'Unavailable (browser)'}
          </span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: mutedColor }}>WebGPU VRAM</span>
          <span>
            {snap.gpuLiveBytes > 0 ? `${(snap.gpuLiveBytes / 1e6).toFixed(0)} MB` : '0 MB'}
          </span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: mutedColor }}>Objects</span>
          <span>
            {snap.simStats.totalMessages}m · {snap.simStats.totalMemories}mem · {snap.simStats.timelineFrames}kf ·{' '}
            {snap.caches.imageCacheCount}img
          </span>
        </div>
        {snap.health.reasons[0] && (
          <div className="truncate pt-0.5 text-[9.5px]" style={{ color: healthColor }}>
            {snap.health.reasons[0]}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-1.5 border-t border-white/15 pt-1.5 font-sans text-[10px]">
        <button
          type="button"
          onClick={() => void perfMemoryTracker.runCleanup()}
          className="rounded bg-white/15 px-2 py-0.5 font-medium hover:bg-white/25"
          style={{ color: textColor }}
        >
          Trim Caches
        </button>
        <button
          type="button"
          onClick={onOpenMonitor}
          className="rounded bg-white/15 px-2 py-0.5 font-medium hover:bg-white/25"
          style={{ color: textColor }}
        >
          Full Profiler →
        </button>
      </div>
    </div>
  );
};

export const VillageView: React.FC<VillageViewProps> = ({
  sim,
  villagers,
  settings,
  onUpdateSettings,
  onOpenMonitor,
  aestheticSettings: aestheticSettingsProp,
  onUpdateAesthetic,
  sidebarOpen: sidebarOpenProp,
  sidebarSwap,
  onResetStory,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const lastRangeRef = useRef<Range | null>(null);
  const [selectedId, setSelectedId] = useState<string>(villagers[0]?.id ?? 'narrator');
  const [tick, setTick] = useState(0);
  const [showPaths, setShowPaths] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showSpeechBubbles, setShowSpeechBubbles] = useState(true);
  const [showThoughtBubbles, setShowThoughtBubbles] = useState(true);
  const [showScribeSubtitles, setShowScribeSubtitles] = useState(true);
  const [showPerfHud, setShowPerfHud] = useState(false);
  const [localAestheticSettings] = useState<AestheticSettings>(() =>
    loadAestheticSettings(),
  );
  const aestheticSettings = aestheticSettingsProp ?? localAestheticSettings;
  const worldTheme = resolveWorldTheme(sim.map, sim.world);
  const aestheticTokens = React.useMemo(
    () => resolveAestheticTokens(aestheticSettings, worldTheme),
    [aestheticSettings, worldTheme],
  );
  // The art looks draw the HUD as stitched cloth; the classic tiles keep their presets.
  const stitchHud = aestheticSettings.worldLook !== 'tiles';
  // The chat panel's controls in the stitch kit when the world is drawn as cloth.
  const chip = (on: boolean, plain: string, size = 'text-[10px]') =>
    stitchHud ? `glyph-button relative rounded-sm px-1.5 py-0.5 ${size} font-medium ${on ? 'glyph-on text-ink' : 'stitch-muted'}` : plain;
  const fieldClass = (plain: string) => (stitchHud ? `${plain.replace(/\bbg-\S+/g, '')} bg-transparent border-dashed` : plain);
  const hudLook = glyphLookFor(aestheticSettings.worldLook, isLightColour(aestheticTokens.hudTextColor));
  const hudKit = React.useMemo(() => stitchKit(hudLook), [hudLook]);
  const playerCustomSprite = React.useMemo(
    () => generateProceduralPlayerCustomSprite(aestheticSettings.player, worldTheme),
    [aestheticSettings.player, worldTheme],
  );
  void getPlayerSpriteCacheCount;
  const sidebarOpen = sidebarOpenProp ?? true;
  const subtitleBoxRef = useRef<HTMLDivElement | null>(null);
  const [rosterView, setRosterView] = useState<'cards' | 'compact'>('cards');
  const [rosterCollapsed, setRosterCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [scriptCollapsed, setScriptCollapsed] = useState(false);
  const [followSelected, setFollowSelected] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Story mode: the director camera follows the story until the viewer takes over.
  const [storyMode, setStoryModeState] = useState(() => {
    try {
      return localStorage.getItem('seloai_story_mode') !== 'off';
    } catch {
      return true;
    }
  });
  const storyRef = useRef(storyMode);
  /** Speech and thoughts embroidered onto the cloth, when the woven text style is on. */
  const wovenRef = useRef(new WovenText());
  /** The Scribe's band along the bottom of the cloth (woven text style), and its current line. */
  const scribeBandRef = useRef(new ScribeBand());
  const scribeLineRef = useRef<ScribeLine | null>(null);
  const threadColourRef = useRef(new Map<string, string>());
  /** The loose thread from each speaker to the words they are sewing, with a little physics. */
  const ropesRef = useRef(new Map<string, ThreadRope>());
  /** The floating toolbar over the top of the view: the director frames only what it leaves visible. */
  const hudRef = useRef<HTMLDivElement>(null);
  const directorRef = useRef(new Director());
  const [shotCaption, setShotCaption] = useState('');
  const setStoryMode = useCallback((on: boolean) => {
    storyRef.current = on;
    setStoryModeState(on);
    if (on) directorRef.current.reset();
    try {
      localStorage.setItem('seloai_story_mode', on ? 'on' : 'off');
    } catch {
      // Remembering the choice is a convenience only.
    }
  }, []);
  /** Any pan, zoom, follow or keyboard move hands the camera to the viewer. */
  const takeOver = useCallback(() => {
    if (storyRef.current) setStoryMode(false);
  }, [setStoryMode]);
  const takeOverRef = useRef(takeOver);
  takeOverRef.current = takeOver;
  const [feedMode, setFeedMode] = useState<'hearing' | 'focused' | 'village'>('hearing');
  const [filterSpeech, setFilterSpeech] = useState(true);
  const [filterScribe, setFilterScribe] = useState(true);
  const [filterThoughts, setFilterThoughts] = useState(true);
  const [filterHuman, setFilterHuman] = useState(true);
  const [scriptActorFilter, setScriptActorFilter] = useState<string>('all');
  const [scriptSearch, setScriptSearch] = useState('');
  const [activeSpeech, setActiveSpeech] = useState(brainRouter.activeSpeechInfo);
  const [chatInput, setChatInput] = useState('');
  const [mentionMatch, setMentionMatch] = useState<ActiveComposerMention | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('seloai:sidebar-width'));
      if (Number.isFinite(saved) && saved >= 260 && saved <= 760) return saved;
    } catch {
      // ignore storage errors
    }
    return 360;
  });

  const handleSidebarResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: PointerEvent) => {
      const maxW = Math.max(360, Math.min(760, window.innerWidth - 260));
      const next = Math.max(260, Math.min(maxW, startW + (startX - ev.clientX)));
      setSidebarWidth(next);
    };
    const onUp = (ev: PointerEvent) => {
      const maxW = Math.max(360, Math.min(760, window.innerWidth - 260));
      const finalW = Math.max(260, Math.min(maxW, startW + (startX - ev.clientX)));
      setSidebarWidth(finalW);
      try {
        localStorage.setItem('seloai:sidebar-width', String(Math.round(finalW)));
      } catch {
        // ignore storage errors
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const cameraRef = useRef<{
    x: number;
    y: number;
    zoom: number;
    targetZoom: number;
    anchor: { dx: number; dy: number } | null;
  }>({ x: 0, y: 0, zoom: 1.15, targetZoom: 1.15, anchor: null });
  const lastActiveSpeedRef = useRef<number>(1);
  const dragRef = useRef<{ active: boolean; moved: boolean; lastX: number; lastY: number }>({
    active: false,
    moved: false,
    lastX: 0,
    lastY: 0,
  });
  const keysRef = useRef(new Set<string>());
  const recorderRef = useRef<MicRecorder | null>(null);

  useEffect(() => {
    if (selectedId !== 'narrator' && !villagers.some((v) => v.id === selectedId) && villagers[0]) {
      setSelectedId(villagers[0].id);
    }
  }, [villagers, selectedId]);

  useEffect(() => {
    const unsub = sim.subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, [sim]);

  useEffect(() => {
    return brainRouter.subscribeSpeechState(setActiveSpeech);
  }, []);

  /** The furthest the camera may zoom out: far enough to see the whole map, with a little margin. */
  const minZoom = () => {
    const canvas = canvasRef.current;
    const worldW = sim.map.width * sim.map.tileDim;
    const worldH = sim.map.height * sim.map.tileDim;
    if (!canvas || !worldW || !worldH) return 0.45;
    const fit = 0.92 * Math.min(canvas.clientWidth / worldW, canvas.clientHeight / worldH);
    return Math.max(0.05, Math.min(0.45, fit));
  };

  // Over the map, a pinch (ctrl+wheel) or scroll belongs to the map: stop the page from
  // zooming or scrolling. React's wheel handlers are passive and cannot do this.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hold = (event: WheelEvent) => event.preventDefault();
    canvas.addEventListener('wheel', hold, { passive: false });
    return () => canvas.removeEventListener('wheel', hold);
  }, []);

  // Center camera initially
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const worldW = sim.map.width * sim.map.tileDim;
    const worldH = sim.map.height * sim.map.tileDim;
    cameraRef.current.x = worldW / 2;
    cameraRef.current.y = worldH / 2;
  }, [sim.map.width, sim.map.height, sim.map.tileDim]);

  // Keyboard movement (WASD / Arrows) when not typing in input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const tag = targetEl?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || targetEl?.isContentEditable) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
        keysRef.current.add(e.key.toLowerCase());
        takeOverRef.current();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Main 60fps simulation + render loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let lastMicUiAt = 0;
    let staticLayerCanvas: HTMLCanvasElement | null = null;
    let artLayer: { map: typeof sim.map; look: WorldLook; canvas: HTMLCanvasElement } | null = null;
    let staticCacheKey: {
      mapRef: object;
      bgRef: unknown;
      objRef: unknown;
      tileSetUrl: string;
      tilesetImg: HTMLImageElement;
      width: number;
      height: number;
      tileDim: number;
      tileSetDimX: number;
    } | null = null;

    const frame = (now: number) => {
      const rawDtMs = Math.max(0.5, now - lastTime);
      const dt = Math.min(0.05, rawDtMs / 1000);
      lastTime = now;

      // Keyboard player nudge
      const keys = keysRef.current;
      let dx = 0;
      let dy = 0;
      if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
      if (keys.has('arrowright') || keys.has('d')) dx += 1;
      if (keys.has('arrowup') || keys.has('w')) dy -= 1;
      if (keys.has('arrowdown') || keys.has('s')) dy += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        sim.nudgePlayer(dx / len, dy / len, dt);
      }

      // The simulation itself is advanced by the app-level driver, not by this view.
      const simStepMs = getLastSimStepMs();

      if (recorderRef.current?.active && now - lastMicUiAt >= 65) {
        lastMicUiAt = now;
        setMicLevel(recorderRef.current.readLevel());
      }

      let renderMs = 0;
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.imageSmoothingEnabled = false;

          const cam = cameraRef.current;
          const zoomDiff = cam.targetZoom - cam.zoom;
          if (Math.abs(zoomDiff) > 0.0004) {
            const prevZoom = cam.zoom;
            const easeAlpha = 1 - Math.exp(-Math.max(0.001, dt) * 12);
            cam.zoom += zoomDiff * easeAlpha;
            if (Math.abs(cam.targetZoom - cam.zoom) <= 0.0004) {
              cam.zoom = cam.targetZoom;
            }
            if (cam.anchor && !followSelected && !dragRef.current.active) {
              cam.x += cam.anchor.dx * (1 / prevZoom - 1 / cam.zoom);
              cam.y += cam.anchor.dy * (1 / prevZoom - 1 / cam.zoom);
            }
          }

          if (storyRef.current) {
            // The director chooses the shot; the camera cuts to it or eases toward it.
            const director = directorRef.current;
            const names = new Map<string, string>();
            const actors: DirectorActor[] = [];
            for (const rt of sim.runtimes.values()) {
              names.set(rt.id, sim.configs.get(rt.id)?.name ?? rt.id);
              actors.push({
                id: rt.id,
                x: rt.x,
                y: rt.y,
                moving: rt.state === 'walking' || rt.path.length > 0,
                // A bubble is shown only while its line is being said (it is cleared when it expires).
                line: rt.currentBubble?.text,
                lineId: rt.currentBubble ? String(rt.currentBubble.startedAt ?? rt.currentBubble.text) : undefined,
                conversationId: rt.activeConversationId,
              });
            }
            director.setNames(names);
            director.favour(sim.focalWorldlineId && sim.focalWorldlineId !== 'traveler' ? sim.focalWorldlineId : null);
            const before = director.current;
            const hudBottom = hudRef.current?.getBoundingClientRect().bottom ?? rect.top;
            const inset = Math.max(0, Math.min(rect.height * 0.6, hudBottom - rect.top));
            // Leave room for the Scribe's band along the bottom when it is showing.
            const below = aestheticSettings.speechStyle === 'woven' && scribeLineRef.current ? Math.min(rect.height * 0.3, ScribeBand.height(rect.width)) : 0;
            const visibleH = Math.max(1, rect.height - inset - below);
            const shot = director.update({
              time: now / 1000,
              actors,
              landmarks: (sim.map.pointsOfInterest ?? []).map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y })),
              mapW: sim.map.width,
              mapH: sim.map.height,
              aspect: rect.width / visibleH,
            });
            const td = sim.map.tileDim;
            const tx = (shot.rect.x + shot.rect.w / 2) * td;
            const zoom = Math.min(3.5, Math.max(minZoom(), Math.min(rect.width / (shot.rect.w * td), visibleH / (shot.rect.h * td))));
            // The camera centre sits half the toolbar's height above the visible middle.
            const ty = (shot.rect.y + shot.rect.h / 2) * td - (inset - below) / 2 / zoom;
            cam.anchor = null;
            const fresh = !before || before.startedAt !== shot.startedAt;
            if (fresh && shot.cut) {
              cam.x = tx;
              cam.y = ty;
              cam.zoom = zoom;
              cam.targetZoom = zoom;
            } else {
              const k = 1 - Math.exp(-dt * 2.4);
              cam.x += (tx - cam.x) * k;
              cam.y += (ty - cam.y) * k;
              cam.targetZoom += (zoom - cam.targetZoom) * k;
            }
            if (fresh) setShotCaption(`${shot.kind === 'two-shot' ? 'Two-shot' : shot.kind[0].toUpperCase() + shot.kind.slice(1)}: ${shot.caption}`);
          } else if (followSelected && selectedId) {
            const rt = sim.runtimes.get(selectedId);
            if (rt) {
              const tx = (rt.x + 0.5) * sim.map.tileDim;
              const ty = (rt.y + 0.5) * sim.map.tileDim;
              cam.anchor = null;
              cam.x += (tx - cam.x) * 0.12;
              cam.y += (ty - cam.y) * 0.12;
            }
          }

          const renderStart = performance.now();
          renderWorld(ctx, rect.width, rect.height, now / 1000);
          if (aestheticSettings.speechStyle === 'woven') {
            // The Scribe's narration, sewn along the bottom of the view in gold.
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const look = (aestheticSettings.worldLook === 'tiles' ? 'festive' : aestheticSettings.worldLook) as PaletteName;
            const pal = clothPalette(look);
            const oneInk = look === 'ink' || look === 'night';
            // A deeper gold than the world's, so it reads against the linen.
            const gold = oneInk ? pal.inks.dark : deepen(pal.inks.gold, 0.32);
            scribeBandRef.current.draw(ctx, rect.width, rect.height, scribeLineRef.current, now / 1000, gold, oneInk ? pal.inks.dark : pal.inks.primary, aestheticSettings.wovenStitch, pal.ground);
          }
          renderMs = performance.now() - renderStart;
        }
      }

      perfMemoryTracker.recordFrameSample(rawDtMs, simStepMs, renderMs);
      rafId = requestAnimationFrame(frame);
    };

    const renderWorld = (ctx: CanvasRenderingContext2D, viewW: number, viewH: number, timeSec: number) => {
      // Beyond the edge of the map: the cloth's own colour in the art looks, so nothing drawn
      // over the view (the Scribe's band) ever sits on a dark void.
      {
        const look = aestheticSettings.worldLook;
        const threads = sim.map.scene ? bakeScene(sim.map.scene).model.palette : undefined;
        // Everything drawn on this cloth this frame is worked in the world's own threads.
        setActiveWorldThreads(threads);
        // Classic tiles has no cloth of its own: use the festive linen, close to its parchment
        // tiles, rather than a dark void.
        ctx.fillStyle = deepen(worldPalette((look === 'tiles' ? 'festive' : look) as PaletteName, threads).ground, 0.06);
      }
      ctx.fillRect(0, 0, viewW, viewH);

      const cam = cameraRef.current;
      ctx.save();
      ctx.translate(viewW / 2, viewH / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      const map = sim.map;
      const tilesetImg = getCachedImage(map.tileSetUrl);
      const tilesetCols = Math.max(1, Math.floor(map.tileSetDimX / map.tileDim));
      // A world authored as a scene has no tiles, so the tiles look shows it as festive cloth.
      const worldLook = map.scene && aestheticSettings.worldLook === 'tiles' ? 'festive' : aestheticSettings.worldLook;
      const canvasTheme =
        worldLook === 'tiles'
          ? aestheticTokens.canvasTheme
          : { ...aestheticTokens.canvasTheme, ...clothOverlayColours(worldLook) };

      if (worldLook !== 'tiles') {
        // Art looks draw the world from its meaning, not from tile images.
        if (!artLayer || artLayer.map !== map || artLayer.look !== worldLook) {
          artLayer = { map, look: worldLook, canvas: renderWorldLayer(map, worldLook, tileSemanticsForMap(map)) };
        }
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(artLayer.canvas, 0, 0);
        ctx.imageSmoothingEnabled = false;
      } else if (tilesetImg) {
        const needsRebuild =
          !staticLayerCanvas ||
          !staticCacheKey ||
          staticCacheKey.mapRef !== map ||
          staticCacheKey.bgRef !== map.bgTiles ||
          staticCacheKey.objRef !== map.objectTiles ||
          staticCacheKey.tileSetUrl !== map.tileSetUrl ||
          staticCacheKey.tilesetImg !== tilesetImg ||
          staticCacheKey.width !== map.width ||
          staticCacheKey.height !== map.height ||
          staticCacheKey.tileDim !== map.tileDim ||
          staticCacheKey.tileSetDimX !== map.tileSetDimX;

        if (needsRebuild) {
          const targetW = Math.max(1, map.width * map.tileDim);
          const targetH = Math.max(1, map.height * map.tileDim);
          if (!staticLayerCanvas) {
            staticLayerCanvas = document.createElement('canvas');
          }
          if (staticLayerCanvas.width !== targetW || staticLayerCanvas.height !== targetH) {
            staticLayerCanvas.width = targetW;
            staticLayerCanvas.height = targetH;
          }
          const sctx = staticLayerCanvas.getContext('2d');
          if (sctx) {
            sctx.imageSmoothingEnabled = false;
            sctx.clearRect(0, 0, targetW, targetH);
            for (const layer of map.bgTiles) {
              drawTileGrid(sctx, tilesetImg, layer, map.tileDim, tilesetCols);
            }
            for (const layer of map.objectTiles) {
              drawTileGrid(sctx, tilesetImg, layer, map.tileDim, tilesetCols);
            }
            staticCacheKey = {
              mapRef: map,
              bgRef: map.bgTiles,
              objRef: map.objectTiles,
              tileSetUrl: map.tileSetUrl,
              tilesetImg,
              width: map.width,
              height: map.height,
              tileDim: map.tileDim,
              tileSetDimX: map.tileSetDimX,
            };
          }
        }

        if (staticLayerCanvas) {
          ctx.drawImage(staticLayerCanvas, 0, 0);
        } else {
          for (const layer of map.bgTiles) {
            drawTileGrid(ctx, tilesetImg, layer, map.tileDim, tilesetCols);
          }
          for (const layer of map.objectTiles) {
            drawTileGrid(ctx, tilesetImg, layer, map.tileDim, tilesetCols);
          }
        }
      }

      drawAnimatedSprites(ctx, map, timeSec);

      // Subtle spatial hearing radius ring around player when eavesdrop radius > 0 (hidden for Whole Map)
      if (
        sim.modelSettings.proximityRadiusTiles > 0 &&
        !isWholeMapEavesdrop(sim.modelSettings.proximityRadiusTiles)
      ) {
        ctx.save();
        ctx.strokeStyle = 'rgba(31, 181, 201, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(
          (sim.player.x + 0.5) * map.tileDim,
          (sim.player.y + 0.5) * map.tileDim,
          sim.modelSettings.proximityRadiusTiles * map.tileDim,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
      }

      // Debug paths
      if (showPaths) {
        ctx.save();
        for (const rt of sim.runtimes.values()) {
          if (rt.path.length === 0) continue;
          const cfg = sim.configs.get(rt.id);
          ctx.strokeStyle = clothAccent(cfg?.accentColor, worldLook === 'tiles' ? undefined : (worldLook as PaletteName)) || '#e6a945';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo((rt.x + 0.5) * map.tileDim, (rt.y + 0.5) * map.tileDim);
          for (const pt of rt.path) {
            ctx.lineTo((pt.x + 0.5) * map.tileDim, (pt.y + 0.5) * map.tileDim);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      const overlayCollector = createOverlayCollector();
      const deferredBodies: DeferredCanvasDraw[] = [];

      // Floor POI diamond beacons & collect POI label pills
      if (showLabels && (map.pointsOfInterest ?? []).length > 0) {
        drawPoiMarkers(
          ctx,
          map.pointsOfInterest ?? [],
          map.tileDim,
          canvasTheme,
          overlayCollector,
        );
      }

      const bodyPainter: BodyPainter | undefined =
        worldLook === 'tiles'
          ? undefined
          : (bodyCtx, body) => {
              const motion = {
                id: body.id,
                facing: body.facing,
                moving: body.moving,
                animFrame: body.animFrame,
                state: body.state,
                dancing: isDancing(sim, body),
                time: timeSec,
              };
              const cfg = sim.configs.get(body.id);
              // The Traveler wears the figure set in their roster entry (with no build chosen, the
              // voice's gender decides, as for villagers); before one is set, the old attire choice.
              const looks = cfg
                ? figureLooksFor(cfg)
                : settings.playerFigure
                  ? figureLooksFor({ figure: settings.playerFigure, voice: settings.playerVoice })
                  : { build: playerFigureBuild(aestheticSettings.player.attire), kind: 'human' as const };
              const heightPx = body.tileDim * body.scale * FIGURE_HEIGHT_SCALE;
              // Always the full figure, at every zoom (no level-of-detail switching).
              const rig = getFigureRig(body.id, worldLook, heightPx, expressionFor(body.state, body.line), {
                ...looks,
                view: chooseFigureView(motion, aestheticSettings.figureTurns),
                quirks: aestheticSettings.figureQuirks,
                solid: aestheticSettings.figureSolid,
              });
              paintRig(bodyCtx, rig, body.tileX, body.tileY, body.tileDim, motion);
            };

      // Collect deferred Y-sorted character sprites + measure labels and bubbles
      for (const rt of sim.runtimes.values()) {
        const cfg = sim.configs.get(rt.id);
        if (!cfg) continue;
        drawVillager(ctx, cfg, rt, map.tileDim, rt.id === selectedId, showLabels, {
          // Woven text replaces the bubbles: words are sewn onto the cloth instead.
          showSpeechBubbles: showSpeechBubbles && aestheticSettings.speechStyle !== 'woven',
          showThoughtBubbles: showThoughtBubbles && aestheticSettings.speechStyle !== 'woven',
          pois: map.pointsOfInterest,
          theme: canvasTheme,
          collector: overlayCollector,
          deferredBodies,
          bodyPainter,
          bodyHeightScale: bodyPainter ? FIGURE_HEIGHT_SCALE : 1,
        });
      }
      drawPlayer(ctx, sim.player, map.tileDim, {
        showLabels,
        playerSprite: playerCustomSprite,
        theme: canvasTheme,
        collector: overlayCollector,
        deferredBodies,
        bodyPainter,
        bodyHeightScale: bodyPainter ? FIGURE_HEIGHT_SCALE : 1,
      });

      const overlayBatch = resolveOverlayBatch(overlayCollector, aestheticSettings.deoverlapLabels, {
        x: cam.x - viewW / 2 / cam.zoom,
        y: cam.y - viewH / 2 / cam.zoom,
        w: viewW / cam.zoom,
        h: viewH / cam.zoom,
      });

      // Pass 0: Stationary location labels stay fixed on the lowest layer behind characters
      renderOverlayBatch(ctx, overlayBatch, 'locations');

      // Pass 1: Character & player name pills draw behind character sprites
      renderOverlayBatch(ctx, overlayBatch, 'pills');

      // Optional pass: Bubbles draw behind character sprites when enabled
      if (aestheticSettings.bubblesBehindCharacters) {
        renderOverlayBatch(ctx, overlayBatch, 'bubbles');
      }

      // Conversation threads hang between talking characters, behind their bodies.
      if (worldLook !== 'tiles') {
        const bodyH = map.tileDim * aestheticTokens.canvasTheme.characterScale * FIGURE_HEIGHT_SCALE;
        const ends: ThreadEnd[] = [];
        for (const rt of sim.runtimes.values()) {
          if (!rt.activeConversationId) continue;
          ends.push({
            id: rt.id,
            x: rt.x * map.tileDim + map.tileDim / 2,
            y: rt.y * map.tileDim + map.tileDim - 4 - bodyH * 0.5,
            speaking: rt.state === 'speaking',
            conversationId: rt.activeConversationId,
          });
        }
        drawConversationThreads(ctx, ends, worldLook, timeSec);
      }

      // Woven text: what is said and thought, embroidered onto the cloth under the characters.
      if (aestheticSettings.speechStyle === 'woven') {
        const td = map.tileDim;
        const bodyH = td * aestheticTokens.canvasTheme.characterScale * FIGURE_HEIGHT_SCALE;
        const look = (worldLook === 'tiles' ? 'festive' : worldLook) as PaletteName;
        const palette = clothPalette(look);
        const lineLook = look === 'ink' || look === 'night';
        const colourFor = (id: string): string => {
          const cfg = sim.configs.get(id);
          // A character's words are sewn in their own colour, the one their dot shows.
          if (cfg?.accentColor && !lineLook) return clothAccent(cfg.accentColor, look)!;
          const key = `${id}|${look}|${cfg?.figure?.seed ?? ''}|${JSON.stringify(cfg?.figure?.traits ?? {})}`;
          const hit = threadColourRef.current.get(key);
          if (hit) return hit;
          // Without a colour of their own, the thread of their bodice (or skirt).
          const looks = cfg ? figureLooksFor(cfg) : undefined;
          const seeded = seededFigureTraits(createSeededRng(looks?.seed ?? hashString(id)), looks?.kind);
          const traits = { ...seeded, ...(looks?.traits ?? {}) };
          const ink = traits.bodiceInk === 'dark' || traits.bodiceInk === 'gold' ? traits.skirtInk : traits.bodiceInk;
          const colour = lineLook ? palette.inks.dark : palette.inks[ink];
          threadColourRef.current.set(key, colour);
          return colour;
        };
        const speakers: WovenSpeaker[] = [];
        const obstacles: WovenObstacle[] = [];
        const headOf = (x: number, y: number): [number, number] => [(x + 0.5) * td, (y + 1) * td - 4 - bodyH * 0.8];
        for (const rt of sim.runtimes.values()) {
          obstacles.push({ x: (rt.x + 0.5) * td - td * 0.45, y: (rt.y + 1) * td - 4 - bodyH, w: td * 0.9, h: bodyH });
          const [hx, hy] = headOf(rt.x, rt.y);
          if (showSpeechBubbles && rt.currentBubble?.text) {
            speakers.push({ id: rt.id, x: hx, y: hy, text: rt.currentBubble.text, lineId: String(rt.currentBubble.startedAt ?? rt.currentBubble.text.slice(0, 12)), kind: 'speech', colour: colourFor(rt.id) });
          }
          if (showThoughtBubbles && rt.currentThoughtBubble?.text) {
            speakers.push({ id: rt.id, x: hx, y: hy, text: rt.currentThoughtBubble.text, lineId: String(rt.currentThoughtBubble.startedAt ?? rt.currentThoughtBubble.text.slice(0, 12)), kind: 'thought', colour: colourFor(rt.id) });
          }
        }
        obstacles.push({ x: (sim.player.x + 0.5) * td - td * 0.45, y: (sim.player.y + 1) * td - 4 - bodyH, w: td * 0.9, h: bodyH });
        const woven = wovenRef.current;
        const style: WovenStyle = {
          hand: aestheticSettings.wovenHand,
          weight: aestheticSettings.wovenWeight,
          slant: aestheticSettings.wovenSlant,
          wobble: aestheticSettings.wovenWobble,
          stitch: aestheticSettings.wovenStitch,
        };
        const options = {
          size: td * 0.46 * aestheticSettings.wovenSize,
          advance: style.hand === 'ductus' ? (ch: string) => ductusAdvance(ch) * DUCTUS_X_HEIGHT : advanceOf,
          holdSec: aestheticSettings.wovenHoldSec,
          fadeSec: aestheticSettings.wovenFadeSec,
          charsPerSec: 16,
          bounds: { w: map.width * td, h: map.height * td },
        };
        woven.update(timeSec, speakers, obstacles, options);
        const scale = Math.min(4, Math.max(1, cam.zoom * (window.devicePixelRatio || 1)));
        for (const l of woven.letters) {
          const a = WovenText.alpha(l, timeSec, options);
          if (a > 0.01) drawWovenLetter(ctx, l, timeSec, a, style, scale, lineLook);
        }
        // A loose thread from each speaker to the words they are sewing: it sags, swings as
        // they walk, and whips a little as each new letter pulls its end along.
        const ropes = ropesRef.current;
        const tails = woven.tails(timeSec, 6);
        for (const id of [...ropes.keys()]) if (!tails.has(id)) ropes.delete(id);
        for (const [id, tail] of tails) {
          const rt = sim.runtimes.get(id);
          if (!rt) continue;
          const [hx, hy] = headOf(rt.x, rt.y);
          let rope = ropes.get(id);
          if (!rope) {
            rope = new ThreadRope();
            ropes.set(id, rope);
          }
          rope.step(timeSec, hx, hy + bodyH * 0.25, tail.x, tail.y, hashString(id) % 100);
          const fade = Math.max(0, 1 - Math.max(0, timeSec - tail.born - 2.5) / 3.5);
          drawThread(ctx, rope, tail.colour, fade, timeSec, { dashed: tail.kind, flowing: timeSec - tail.born < 0.6, lineLook });
        }
      } else if (wovenRef.current.letters.length) {
        wovenRef.current.clear();
      }

      // Pass 2: Y-sorted entities (villagers + player)
      deferredBodies.sort((a, b) => a.y - b.y);
      for (const body of deferredBodies) body.draw();

      // Pass 3 (default): Bubbles draw in front of character sprites
      if (!aestheticSettings.bubblesBehindCharacters) {
        renderOverlayBatch(ctx, overlayBatch, 'bubbles');
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      if (staticLayerCanvas) {
        staticLayerCanvas.width = 0;
        staticLayerCanvas.height = 0;
        staticLayerCanvas = null;
      }
      staticCacheKey = null;
    };
  }, [
    sim,
    selectedId,
    showPaths,
    showLabels,
    followSelected,
    showSpeechBubbles,
    showThoughtBubbles,
    aestheticSettings,
    worldTheme,
    playerCustomSprite,
  ]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { wx: 0, wy: 0 };
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const wx = (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x;
    const wy = (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y;
    return { wx, wy };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { active: true, moved: false, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    if (Math.hypot(dx, dy) > 4) {
      dragRef.current.moved = true;
      setFollowSelected(false);
      takeOver();
    }
    cameraRef.current.anchor = null;
    cameraRef.current.x -= dx / cameraRef.current.zoom;
    cameraRef.current.y -= dy / cameraRef.current.zoom;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const wasClick = !dragRef.current.moved;
    dragRef.current.active = false;
    if (!wasClick) return;

    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    const tileX = wx / sim.map.tileDim;
    const tileY = wy / sim.map.tileDim;

    // Hit-test villagers first
    let clickedVillager: VillagerRuntime | null = null;
    let bestDist = 1.1;
    for (const rt of sim.runtimes.values()) {
      const d = Math.hypot(rt.x + 0.5 - tileX, rt.y + 0.5 - tileY);
      if (d < bestDist) {
        bestDist = d;
        clickedVillager = rt;
      }
    }

    if (clickedVillager) {
      setSelectedId(clickedVillager.id);
      // In story mode, picking someone makes their thread the plotline the camera follows.
      if (storyRef.current) {
        sim.setFocalWorldline(clickedVillager.id);
        setTick((t) => t + 1);
      }
    } else {
      sim.movePlayerTo(Math.floor(tileX), Math.floor(tileY));
    }
  };

  /** Double-click a character to frame and follow them, or a named place to frame it. */
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    const td = sim.map.tileDim;
    const tileX = wx / td;
    const tileY = wy / td;
    let villager: VillagerRuntime | null = null;
    let best = 1.4;
    for (const rt of sim.runtimes.values()) {
      const d = Math.hypot(rt.x + 0.5 - tileX, rt.y + 0.5 - tileY);
      if (d < best) {
        best = d;
        villager = rt;
      }
    }
    const cam = cameraRef.current;
    if (villager) {
      takeOver();
      setSelectedId(villager.id);
      setFollowSelected(true);
      cam.anchor = null;
      cam.targetZoom = Math.max(cam.targetZoom, 2.2);
      return;
    }
    let place: { x: number; y: number } | null = null;
    let near = 2.5;
    for (const p of sim.map.pointsOfInterest ?? []) {
      const d = Math.hypot(p.x + 0.5 - tileX, p.y + 0.5 - tileY);
      if (d < near) {
        near = d;
        place = p;
      }
    }
    if (place) {
      takeOver();
      setFollowSelected(false);
      cam.anchor = null;
      cam.x = (place.x + 0.5) * td;
      cam.y = (place.y + 0.5) * td;
      cam.targetZoom = Math.max(cam.targetZoom, 1.8);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    takeOver();
    const rect = e.currentTarget.getBoundingClientRect();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 320;
    const clampedDy = Math.max(-90, Math.min(90, dy));
    if (clampedDy === 0) return;

    const sensitivity = e.ctrlKey ? 0.0045 : 0.0014;
    const factor = Math.exp(-clampedDy * sensitivity);
    cameraRef.current.targetZoom = Math.min(
      3.5,
      Math.max(minZoom(), cameraRef.current.targetZoom * factor),
    );
    cameraRef.current.anchor = {
      dx: e.clientX - rect.left - rect.width / 2,
      dy: e.clientY - rect.top - rect.height / 2,
    };
  };

  const narratorName = settings.narratorName.trim() || 'Scribe';
  const isScribeSelected = selectedId === 'narrator';
  const selectedCfg = isScribeSelected ? undefined : villagers.find((v) => v.id === selectedId);
  const selectedRt = selectedCfg ? sim.runtimes.get(selectedCfg.id) : undefined;
  const activeConversation = isScribeSelected
    ? sim.conversations.find((c) => c.participantIds.includes('narrator')) ??
      sim.conversations.find((c) => c.messages.some((m) => m.kind === 'narration'))
    : selectedCfg
      ? sim.conversations.find((c) => c.participantIds.includes(selectedCfg.id))
      : undefined;

  const listenerPos = sim.getListenerPosition();
  const isSpeakerAudible = (senderId: string, participantIds: string[]) => {
    if (settings.proximityRadiusTiles <= 0) return false;
    if (isWholeMapEavesdrop(settings.proximityRadiusTiles)) return true;
    const rt =
      sim.runtimes.get(senderId) ??
      participantIds.map((id) => sim.runtimes.get(id)).find((r) => Boolean(r));
    if (!rt) return true;
    return computeSpatialMix(
      rt.x,
      rt.y,
      listenerPos.x,
      listenerPos.y,
      settings.proximityRadiusTiles,
    ).inRange;
  };

  const rawScriptMessages = (() => {
    if (feedMode === 'focused') {
      return activeConversation?.messages ?? [];
    }
    const merged = sim.conversations.flatMap((conv) =>
      conv.messages.map((msg) => ({ msg, participantIds: conv.participantIds })),
    );
    merged.sort((a, b) => a.msg.timestamp - b.msg.timestamp);
    const recent = merged.slice(-140);
    if (feedMode === 'hearing') {
      return recent
        .filter(
          ({ msg, participantIds }) =>
            msg.senderId === sim.player.id ||
            (activeSpeech && msg.senderId === activeSpeech.speakerId && msg.text.includes(activeSpeech.text.slice(0, 24))) ||
            isSpeakerAudible(msg.senderId, participantIds),
        )
        .map((x) => x.msg);
    }
    return recent.map((x) => x.msg);
  })();

  const displayedMessages = rawScriptMessages.filter((msg) => {
    const isHuman = msg.senderId === sim.player.id;
    const isNarration = msg.kind === 'narration' || msg.senderId === 'narrator';
    const isThought = msg.kind === 'thought';
    if (isHuman && !filterHuman) return false;
    if (isNarration && !filterScribe) return false;
    if (isThought && !filterThoughts) return false;
    if (!isHuman && !isNarration && !isThought && !filterSpeech) return false;
    if (scriptActorFilter !== 'all' && msg.senderId !== scriptActorFilter) return false;
    if (scriptSearch.trim()) {
      const q = scriptSearch.trim().toLowerCase();
      if (!`${msg.senderName} ${msg.text} ${msg.reasoning ?? ''}`.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const feedLastId = displayedMessages[displayedMessages.length - 1]?.id ?? '';
  const feedScroll = useAutoScrollToBottom(
    `${displayedMessages.length}:${feedLastId}:${activeSpeech?.startedAt ?? ''}:${scriptCollapsed ? 1 : 0}`,
    { resetKey: feedMode },
  );

  const mentionCandidates: MentionCandidate[] = [
    {
      id: 'all',
      name: 'all',
      displayLabel: 'all',
      tokenText: '@all',
      role: 'Broadcast instruction to every villager (world)',
      accentColor: '#2a9d8f',
      statusHint: `${villagers.length} folk`,
      searchAliases: 'all world everyone village',
    },
    {
      id: 'world',
      name: 'world',
      displayLabel: 'world',
      tokenText: '@world',
      role: 'Broadcast instruction across Selo (all)',
      accentColor: '#2a9d8f',
      statusHint: `${villagers.length} folk`,
      searchAliases: 'world all everyone village',
    },
    {
      id: 'narrator',
      name: narratorName,
      displayLabel: narratorName,
      tokenText: `@${narratorName}`,
      role: `Narrator (${settings.narratorStyle})`,
      accentColor: '#c98a3b',
      statusHint: settings.narratorEnabled ? 'voice on' : 'text',
    },
    ...villagers.map((v) => ({
      id: v.id,
      name: v.name,
      displayLabel: v.name,
      tokenText: `@${v.name}`,
      role: v.role,
      accentColor: v.accentColor,
      statusHint: sim.runtimes.get(v.id)?.state,
    })),
  ];

  const poiCandidates: MentionCandidate[] = (sim.map.pointsOfInterest ?? []).map((p) => ({
    id: `poi-${p.id}`,
    name: p.tag,
    displayLabel: p.label || p.tag,
    tokenText: `#${p.tag}`,
    role: p.description ?? p.tag,
    accentColor: '#d97706',
    prefix: '#',
    statusHint: `(${p.x}, ${p.y})`,
    searchAliases: `${p.tag} ${p.label} ${p.description ?? ''}`,
  }));

  const activePool = mentionMatch?.trigger === '#' ? poiCandidates : mentionCandidates;
  const filteredMentions = mentionMatch
    ? activePool.filter((c) => {
        const q = mentionMatch.query.toLowerCase();
        return (
          c.displayLabel.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.role.toLowerCase().includes(q) ||
          Boolean(c.searchAliases?.toLowerCase().includes(q))
        );
      })
    : [];
  const isMentionMenuOpen = Boolean(mentionMatch && filteredMentions.length > 0);
  const clampedMentionIdx =
    filteredMentions.length > 0 ? Math.min(mentionIdx, filteredMentions.length - 1) : 0;

  const syncComposerState = () => {
    const root = composerRef.current;
    if (!root) return;
    const rawText = serializeComposerText(root);
    if (!rawText && root.childNodes.length > 0) {
      root.innerHTML = '';
    }
    setChatInput(rawText);
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)) {
      lastRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
    const nextMatch = detectActiveMentionInComposer(root);
    setMentionMatch(nextMatch);
    if (nextMatch) {
      setMentionIdx((prev) => prev);
    } else {
      setMentionIdx(0);
    }
  };

  const insertPlainTextAtCaret = (plain: string) => {
    const root = composerRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    let range: Range | null = null;
    if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)) {
      range = sel.getRangeAt(0);
    } else if (lastRangeRef.current && root.contains(lastRangeRef.current.startContainer)) {
      range = lastRangeRef.current.cloneRange();
    } else {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.deleteContents();
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const tn = range.startContainer as Text;
      const off = range.startOffset;
      const existing = tn.textContent ?? '';
      tn.textContent = existing.slice(0, off) + plain + existing.slice(off);
      const nextCaret = document.createRange();
      nextCaret.setStart(tn, off + plain.length);
      nextCaret.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(nextCaret);
      lastRangeRef.current = nextCaret.cloneRange();
    } else {
      const tn = document.createTextNode(plain);
      range.insertNode(tn);
      const nextCaret = document.createRange();
      nextCaret.setStart(tn, plain.length);
      nextCaret.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(nextCaret);
      lastRangeRef.current = nextCaret.cloneRange();
    }
    setMentionIdx(0);
    syncComposerState();
  };

  const insertMentionCandidate = (cand: MentionCandidate) => {
    const root = composerRef.current;
    if (!root) return;
    root.focus();
    const active = mentionMatch && root.contains(mentionMatch.node)
      ? mentionMatch
      : detectActiveMentionInComposer(root);

    const replaceRange = document.createRange();
    if (active) {
      const maxLen = active.node.textContent?.length ?? 0;
      replaceRange.setStart(active.node, Math.min(active.startOffset, maxLen));
      replaceRange.setEnd(active.node, Math.min(active.endOffset, maxLen));
      replaceRange.deleteContents();
    } else if (lastRangeRef.current && root.contains(lastRangeRef.current.startContainer)) {
      replaceRange.setStart(lastRangeRef.current.startContainer, lastRangeRef.current.startOffset);
      replaceRange.collapse(true);
    } else {
      replaceRange.selectNodeContents(root);
      replaceRange.collapse(false);
    }

    const chip = document.createElement('strong');
    chip.setAttribute('contenteditable', 'false');
    chip.dataset.mentionToken = cand.tokenText;
    chip.className =
      cand.prefix === '#'
        ? 'font-bold text-amber-700 dark:text-amber-300'
        : 'font-bold text-indigoFolk';
    chip.textContent = cand.displayLabel;

    const trailingSpace = document.createTextNode(' ');
    replaceRange.insertNode(trailingSpace);
    replaceRange.insertNode(chip);

    const sel = window.getSelection();
    const nextRange = document.createRange();
    nextRange.setStart(trailingSpace, trailingSpace.length);
    nextRange.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(nextRange);
    lastRangeRef.current = nextRange.cloneRange();

    setMentionMatch(null);
    setMentionIdx(0);
    setChatInput(serializeComposerText(root));
  };

  const handleComposerInput = () => {
    setMentionIdx(0);
    syncComposerState();
  };

  const insertTriggerChar = (trigger: '@' | '#') => {
    const root = composerRef.current;
    if (!root) return;
    const rawBefore = serializeComposerText(root);
    let needsSpace = rawBefore.length > 0 && !/\s$/.test(rawBefore);
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)) {
      const r = sel.getRangeAt(0);
      if (r.startContainer.nodeType === Node.TEXT_NODE) {
        const beforeAtCaret = (r.startContainer.textContent ?? '').slice(0, r.startOffset);
        needsSpace = beforeAtCaret.length > 0 && !/\s$/.test(beforeAtCaret);
      }
    }
    insertPlainTextAtCaret(`${needsSpace ? ' ' : ''}${trigger}`);
  };

  const handleTriggerAtMention = () => insertTriggerChar('@');
  const handleTriggerHashMention = () => insertTriggerChar('#');

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = serializeComposerText(composerRef.current) || chatInput;
    const text = raw.trim();
    if (!text || sending) return;
    if (composerRef.current) {
      composerRef.current.innerHTML = '';
    }
    lastRangeRef.current = null;
    setChatInput('');
    setMentionMatch(null);
    setSending(true);
    setVoiceError(null);
    try {
      const res = await sim.sendUserAddressedMessage(
        selectedId || undefined,
        text,
        settings.enableOmniTts || settings.enableWebSpeechFallback,
      );
      if (res.focusedTargetId) {
        setSelectedId(res.focusedTargetId);
      }
    } catch (err: any) {
      setVoiceError(err?.message || String(err));
    } finally {
      setSending(false);
    }
  };

  const toggleVoiceRecording = async () => {
    setVoiceError(null);
    if (recording && recorderRef.current) {
      setRecording(false);
      setMicLevel(0);
      try {
        const { audioBuffer, duration } = await recorderRef.current.stop();
        if (duration < 0.3) {
          setVoiceError('Recording too short — hold or speak for at least half a second.');
          return;
        }
        if (!selectedCfg) return;
        setSending(true);
        await sim.sendUserVoiceToVillager(selectedCfg.id, audioBuffer);
      } catch (err: any) {
        setVoiceError(err?.message || String(err));
      } finally {
        setSending(false);
      }
      return;
    }

    if (!omniEngine.isReady()) {
      setVoiceError('LFM3-Omni-2B is not loaded yet. Open AI Monitor to load it for WebGPU STT + TTS.');
      return;
    }

    try {
      const rec = new MicRecorder();
      await rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setVoiceError('Microphone permission denied or unavailable.');
    }
  };

  const centerOnSelected = () => {
    if (!selectedRt) return;
    cameraRef.current.x = (selectedRt.x + 0.5) * sim.map.tileDim;
    cameraRef.current.y = (selectedRt.y + 0.5) * sim.map.tileDim;
  };

  let latestScribeSubtitle: {
    id: string;
    senderName: string;
    text: string;
    timestamp: number;
  } | null = null;
  for (const conv of sim.conversations) {
    for (const msg of conv.messages) {
      if (msg.kind === 'narration' && msg.text.trim()) {
        if (!latestScribeSubtitle || msg.timestamp >= latestScribeSubtitle.timestamp) {
          latestScribeSubtitle = {
            id: msg.id,
            senderName: msg.senderName || narratorName,
            text: msg.text.trim(),
            timestamp: msg.timestamp,
          };
        }
      }
    }
  }

  scribeLineRef.current = showScribeSubtitles && latestScribeSubtitle ? { id: latestScribeSubtitle.id, text: latestScribeSubtitle.text } : null;

  useEffect(() => {
    const el = subtitleBoxRef.current;
    if (!el || !latestScribeSubtitle) return;
    el.scrollTop = 0;
    if (el.scrollHeight <= el.clientHeight + 2) return;
    const timer = window.setInterval(() => {
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
        el.scrollTop += 1;
      }
    }, 55);
    return () => window.clearInterval(timer);
  }, [latestScribeSubtitle?.id, latestScribeSubtitle?.text]);

  // Suppress unused tick warning while keeping live reactivity
  void tick;

  return (
    <div
      className="flex h-full flex-col lg:flex-row overflow-hidden"
      style={
        {
          '--sidebar-w': `${sidebarWidth}px`,
          fontFamily: aestheticTokens.fontFamilyCss,
        } as React.CSSProperties
      }
    >
      {/* Left: Interactive Village World */}
      <section className="relative flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden bg-linen" aria-label="Village Canvas">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          className="pixel-canvas h-full w-full cursor-grab active:cursor-grabbing touch-none"
        />

        {/* Top HUD Flex Row: prevents toolbar from ever colliding with right action pills */}
        <div ref={hudRef} className="pointer-events-none absolute inset-x-2 top-2 z-20 flex items-start justify-between gap-2">
          <StitchScope look={hudLook}>
          <div
            role="toolbar"
            aria-label="Village simulation controls"
            style={stitchHud ? { fontFamily: aestheticTokens.hudStyle.fontFamily } : aestheticTokens.hudStyle}
            className={`pointer-events-auto relative flex min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto rounded-md thin-scroll ${
              stitchHud ? 'stitch-panel px-2 py-0.5' : 'px-1.5 py-0.5'
            } ${aestheticSettings.showDecorations && !stitchHud ? 'pt-1' : ''}`}
          >
            {aestheticSettings.showDecorations && !stitchHud && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                style={{ backgroundImage: aestheticTokens.ribbonGradient }}
              />
            )}

            <GlyphButton
              glyph={sim.paused || Math.abs(sim.speedMultiplier) < 0.001 ? 'play' : 'pause'}
              label={sim.paused || Math.abs(sim.speedMultiplier) < 0.001 ? 'Resume simulation' : 'Pause simulation'}
              size={17}
              onClick={() => {
                if (sim.paused) {
                  if (Math.abs(sim.speedMultiplier) < 0.001) {
                    sim.speedMultiplier = lastActiveSpeedRef.current || 1;
                  }
                  sim.paused = false;
                } else {
                  sim.paused = true;
                }
                setTick((t) => t + 1);
              }}
            />

            {stitchHud ? <KnotDivider /> : <div className="h-4 w-px" style={{ backgroundColor: aestheticTokens.hudBorderColor }} />}

            {/* Signed logarithmic time-pace & rewind slider (-10× .. 0 .. +10×) */}
            {(() => {
              const effectiveSpeed = sim.paused ? 0 : sim.speedMultiplier;
              const rewindInfo = sim.getRewindInfo();
              const isRewinding = effectiveSpeed < 0;
              const isStopped = Math.abs(effectiveSpeed) < 0.001;
              const applySpeed = (nextSpeed: number) => {
                if (Math.abs(nextSpeed) < 0.001) {
                  sim.speedMultiplier = 0;
                  sim.paused = true;
                } else {
                  lastActiveSpeedRef.current = nextSpeed;
                  sim.speedMultiplier = nextSpeed;
                  sim.paused = false;
                }
                setTick((t) => t + 1);
              };
              const speedBadgeStyle: React.CSSProperties = stitchHud
                ? {
                    color: isRewinding || effectiveSpeed > 1 ? hudKit.thread : isStopped || effectiveSpeed < 1 ? hudKit.muted : hudKit.ink,
                  }
                : isRewinding
                ? { backgroundColor: aestheticTokens.accentHex, color: '#ffffff' }
                : isStopped
                  ? { backgroundColor: aestheticTokens.activeSubtitleBg, color: aestheticTokens.activeSubtitleText }
                  : effectiveSpeed < 1
                    ? { backgroundColor: aestheticTokens.activeThoughtBg, color: aestheticTokens.activeThoughtText }
                    : effectiveSpeed > 1
                      ? { backgroundColor: aestheticTokens.activeSpeechBg, color: aestheticTokens.activeSpeechText }
                      : { backgroundColor: aestheticTokens.hudChipIdleBg, color: aestheticTokens.hudTextColor };
              return (
                <div className="flex items-center gap-1 px-0.5" role="group" aria-label="Time pace and rewind">
                  <select
                    value={String(SPEED_LOG_MARKS.reduce((best, m) => (Math.abs(m.value - effectiveSpeed) < Math.abs(best - effectiveSpeed) ? m.value : best), 1))}
                    onChange={(e) => applySpeed(Number(e.target.value))}
                    aria-label="Simulation speed (negative rewinds, 0 pauses)"
                    title="Simulation speed: negative rewinds, 0 pauses"
                    style={speedBadgeStyle}
                    className={`h-6 cursor-pointer rounded border-0 px-1 font-mono text-[11px] font-semibold ${stitchHud ? 'glyph-button bg-transparent' : ''}`}
                  >
                    {[...SPEED_LOG_MARKS].reverse().map((mark) => (
                      <option key={mark.value} value={String(mark.value)}>
                        {mark.value === 0 ? 'Pause' : `${mark.label}×`}
                      </option>
                    ))}
                  </select>
                  {(isRewinding || rewindInfo.behindPresentSec >= 0.4) && (
                    <span
                      className="whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
                      style={
                        stitchHud
                          ? { color: hudKit.thread }
                          : { backgroundColor: aestheticTokens.activeSpeechBg, color: aestheticTokens.activeSpeechText }
                      }
                      title="Rewind offset behind present time"
                    >
                      ◀ -{rewindInfo.behindPresentSec.toFixed(1)}s
                    </span>
                  )}
                </div>
              );
            })()}

            {stitchHud ? <KnotDivider /> : <div className="h-4 w-px" style={{ backgroundColor: aestheticTokens.hudBorderColor }} />}

            <GlyphButton
              glyph="zoomIn"
              label="Zoom in"
              onClick={() => {
                takeOver();
                cameraRef.current.anchor = null;
                cameraRef.current.targetZoom = Math.min(3.5, cameraRef.current.targetZoom * 1.18);
              }}
            />
            <GlyphButton
              glyph="zoomOut"
              label="Zoom out"
              onClick={() => {
                takeOver();
                cameraRef.current.anchor = null;
                cameraRef.current.targetZoom = Math.max(minZoom(), cameraRef.current.targetZoom / 1.18);
              }}
            />
            <GlyphButton glyph="paths" label="Show walking paths" pressed={showPaths} dimOff onClick={() => setShowPaths((p) => !p)} />
            <GlyphButton glyph="labels" label="Show character and place labels" pressed={showLabels} dimOff onClick={() => setShowLabels((l) => !l)} />
            <GlyphButton glyph="speech" label="Show speech bubbles" pressed={showSpeechBubbles} dimOff onClick={() => setShowSpeechBubbles((s) => !s)} />
            <GlyphButton glyph="thoughts" label="Show thought bubbles" pressed={showThoughtBubbles} dimOff onClick={() => setShowThoughtBubbles((t) => !t)} />
            <GlyphButton glyph="subtitles" label="Show the Scribe's subtitles" pressed={showScribeSubtitles} dimOff onClick={() => setShowScribeSubtitles((s) => !s)} />
            {aestheticSettings.speechStyle === 'woven' && onUpdateAesthetic && (
              <button
                type="button"
                className="glyph-button group relative inline-flex h-7 min-w-7 items-center justify-center rounded-sm px-1 text-[12px] italic"
                aria-label={`Letters for woven text: ${HAND_NAMES[aestheticSettings.wovenHand]}. Click for the next; more in Style.`}
                onClick={() => {
                  const order = ['script', 'ductus', 'satin', 'counted'] as const;
                  const next = order[(order.indexOf(aestheticSettings.wovenHand) + 1) % order.length];
                  onUpdateAesthetic({ ...aestheticSettings, wovenHand: next });
                }}
                style={{ fontFamily: aestheticSettings.wovenHand === 'script' ? '"Bradley Hand", "Segoe Print", cursive' : 'Georgia, serif' }}
              >
                Aa
                <GlyphTip>Letters: {HAND_NAMES[aestheticSettings.wovenHand]} (click for the next)</GlyphTip>
              </button>
            )}
            <GlyphButton
              glyph="story"
              label={storyMode ? 'Story mode is on: the camera follows the story. Pan or zoom to take over.' : 'Story mode: let the camera follow the story'}
              pressed={storyMode}
              dimOff
              onClick={() => setStoryMode(!storyMode)}
            />
            {storyMode && shotCaption && (
              <span className="stitch-muted max-w-[11rem] truncate text-[10px]" title={shotCaption}>
                {shotCaption}
              </span>
            )}
            <GlyphButton
              glyph="follow"
              label="Follow the selected character"
              pressed={followSelected}
              dimOff
              onClick={() => {
                takeOver();
                setFollowSelected((f) => !f);
                centerOnSelected();
              }}
            />
            <GlyphButton glyph="perf" label="Show frame rate and memory" pressed={showPerfHud} dimOff onClick={() => setShowPerfHud((p) => !p)} />
            <button
              type="button"
              onClick={() => {
                if (!isScribeSelected && selectedCfg) {
                  sim.setFocalWorldline(
                    sim.focalWorldlineId === selectedCfg.id ? 'traveler' : selectedCfg.id,
                  );
                  setTick((t) => t + 1);
                } else {
                  sim.setFocalWorldline('traveler');
                  setTick((t) => t + 1);
                }
              }}
              aria-pressed={sim.focalWorldlineId !== 'traveler'}
              title="Hop Scribe & spatial audio POV to selected character (or click again to return to You)"
              style={
                stitchHud
                  ? { color: sim.focalWorldlineId !== 'traveler' ? hudKit.thread : hudKit.ink, fontWeight: 600 }
                  : sim.focalWorldlineId !== 'traveler'
                    ? { backgroundColor: aestheticTokens.accentHex, color: '#ffffff', fontWeight: 600 }
                    : { backgroundColor: aestheticTokens.hudChipIdleBg, color: aestheticTokens.hudTextColor }
              }
              className={`relative inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition ${
                stitchHud ? `glyph-button ${sim.focalWorldlineId !== 'traveler' ? 'glyph-on' : ''}` : 'hover:opacity-90'
              }`}
            >
              <span className="whitespace-nowrap">
                POV:{' '}
                {sim.focalWorldlineId === 'traveler'
                  ? 'You'
                  : abbreviatePersonName(
                      sim.configs.get(sim.focalWorldlineId)?.name ?? 'Char',
                      11,
                    )}
              </span>
            </button>
            {onResetStory &&
              (confirmReset ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px]">
                  <span>Reset the story?</span>
                  <button
                    type="button"
                    className="glyph-button rounded-sm px-1.5 py-0.5 font-semibold"
                    onClick={() => {
                      setConfirmReset(false);
                      onResetStory();
                      setTick((t) => t + 1);
                    }}
                  >
                    Reset
                  </button>
                  <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={() => setConfirmReset(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <GlyphButton
                  glyph="reset"
                  label="Reset the story: same world and cast, everyone back at their starting places (the old story is backed up)"
                  onClick={() => setConfirmReset(true)}
                />
              ))}
            <GlyphButton
              glyph="scatter"
              label="Scatter villagers around the map"
              onClick={() => {
                sim.scatterVillagers();
                setTick((t) => t + 1);
              }}
            />
            <div
              role="group"
              aria-label="Eavesdrop distance"
              style={{
                backgroundColor:
                  settings.proximityRadiusTiles > 0 && !stitchHud
                    ? aestheticTokens.hudChipIdleBg
                    : 'transparent',
                color: stitchHud ? hudKit.ink : aestheticTokens.hudTextColor,
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs transition"
            >
              <label htmlFor="village-eavesdrop-radius" className="group relative inline-flex cursor-pointer items-center" aria-label="Eavesdrop distance">
                <span className={settings.proximityRadiusTiles > 0 ? '' : 'opacity-45'}>
                  <Glyph name="eavesdrop" size={16} />
                </span>
                <GlyphTip>Eavesdrop distance</GlyphTip>
              </label>
              <SpeedRange
                stitched={stitchHud}
                id="village-eavesdrop-radius"
                min={0}
                max={EAVESDROP_SLIDER_MAX}
                step={1}
                value={
                  isWholeMapEavesdrop(settings.proximityRadiusTiles)
                    ? EAVESDROP_SLIDER_MAX
                    : Math.max(0, Math.min(EAVESDROP_SLIDER_MAX - 1, Math.round(settings.proximityRadiusTiles)))
                }
                aria-valuetext={
                  settings.proximityRadiusTiles <= 0
                    ? 'Off'
                    : isWholeMapEavesdrop(settings.proximityRadiusTiles)
                      ? 'Whole map'
                      : `${settings.proximityRadiusTiles} tiles`
                }
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  const nextRadius = raw >= EAVESDROP_SLIDER_MAX ? EAVESDROP_WHOLE_MAP_RADIUS : raw;
                  if (nextRadius <= 0) {
                    brainRouter.stopSpeech();
                  }
                  onUpdateSettings({ proximityRadiusTiles: nextRadius });
                }}
                className={stitchHud ? 'w-14' : 'w-14 cursor-pointer accent-emerald-400'}
                title="Eavesdrop hearing radius (0 = Off, right end = Whole Map)"
              />
              <span className="w-7 text-right font-mono text-[11px]">
                {settings.proximityRadiusTiles <= 0
                  ? 'Off'
                  : isWholeMapEavesdrop(settings.proximityRadiusTiles)
                    ? 'All'
                    : `${settings.proximityRadiusTiles}t`}
              </span>
              <GlyphButton
                glyph="wholeMap"
                label="Listen across the whole map"
                pressed={isWholeMapEavesdrop(settings.proximityRadiusTiles)}
                dimOff
                size={15}
                onClick={() =>
                  onUpdateSettings({
                    proximityRadiusTiles: isWholeMapEavesdrop(settings.proximityRadiusTiles)
                      ? 10
                      : EAVESDROP_WHOLE_MAP_RADIUS,
                  })
                }
              />
              <GlyphButton glyph="flush" label="Flush queued speech audio" size={15} onClick={() => brainRouter.flushAudioQueue()} />
            </div>
          </div>
          </StitchScope>
        </div>

        {/* Bottom-Center Docked Scribe Subtitle Field */}
        {showScribeSubtitles && latestScribeSubtitle && aestheticSettings.speechStyle !== 'woven' && (
          <StitchScope look={hudLook}>
          <SubtitleBox
            stitched={stitchHud}
            role="status"
            aria-live="polite"
            aria-label="Scribe subtitles"
            style={stitchHud ? { fontFamily: aestheticTokens.hudStyle.fontFamily } : aestheticTokens.subtitleStyle}
            className={`absolute bottom-3 left-1/2 z-10 w-[min(92%,42rem)] -translate-x-1/2 rounded-md ${
              stitchHud ? 'px-4 py-2.5' : 'overflow-hidden px-3.5 py-2'
            }`}
          >
            {aestheticSettings.showDecorations && !stitchHud && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                style={{ backgroundImage: aestheticTokens.ribbonGradient }}
              />
            )}
            <div
              className="mb-0.5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider"
              style={{ color: stitchHud ? hudKit.thread : aestheticTokens.poiHighlightHex }}
            >
              <span className="inline-flex items-center gap-1 font-semibold">
                {stitchHud ? <Glyph name="subtitles" size={13} /> : <Captions className="h-3 w-3" aria-hidden="true" />}
                <span>{latestScribeSubtitle.senderName}</span>
              </span>
              {stitchHud ? (
                <GlyphButton
                  glyph="close"
                  label="Hide Scribe subtitles"
                  size={12}
                  tipSide="above"
                  className="h-5 min-w-5"
                  onClick={() => setShowScribeSubtitles(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowScribeSubtitles(false)}
                  title="Hide Scribe subtitles"
                  aria-label="Hide Scribe subtitles"
                  className="rounded p-0.5 transition hover:bg-white/10"
                  style={{ color: aestheticTokens.hudMutedColor }}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
            <div
              ref={subtitleBoxRef}
              style={{
                fontSize: `${(SPEECH_BUBBLE_FONT_PX * aestheticSettings.fontScale).toFixed(1)}px`,
                lineHeight: `${(SPEECH_BUBBLE_LINE_H_PX * aestheticSettings.fontScale).toFixed(1)}px`,
                fontWeight: 500,
                color: stitchHud ? hudKit.ink : aestheticTokens.hudTextColor,
              }}
              className="max-h-16 overflow-y-auto pr-1"
            >
              {renderRichLabels(
                latestScribeSubtitle.text,
                villagers,
                sim.map.pointsOfInterest ?? [],
                narratorName,
                aestheticTokens.isLightSurface ? 'light' : 'dark',
              )}
            </div>
          </SubtitleBox>
          </StitchScope>
        )}
        {showPerfHud && (
          <LivePerfHudOverlay
            panelStyle={aestheticTokens.subtitleStyle}
            textColor={aestheticTokens.hudTextColor}
            mutedColor={aestheticTokens.hudMutedColor}
            hasBottomSubtitle={Boolean(showScribeSubtitles && latestScribeSubtitle && aestheticSettings.speechStyle !== 'woven')}
            onOpenMonitor={onOpenMonitor}
            onClose={() => setShowPerfHud(false)}
          />
        )}
      </section>

      {(sidebarOpen || sidebarSwap) && (
        <>
          {/* Draggable Sidebar Resize Handle */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector sidebar"
            onPointerDown={handleSidebarResizeStart}
            title="Drag to resize sidebar"
            className="hidden lg:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l border-borderFolk bg-surface hover:bg-ink/20 active:bg-ink/30 transition-colors"
          />

          {/* Right: Villager Inspector + Voice & Chat */}
          {sidebarSwap ? <div className="flex w-full lg:w-[var(--sidebar-w)] shrink-0 flex-col overflow-hidden max-h-[52vh] lg:max-h-none">{sidebarSwap}</div> : null}
          <aside
            className={`${sidebarSwap ? 'hidden' : 'flex'} w-full lg:w-[var(--sidebar-w)] shrink-0 flex-col bg-surface overflow-hidden max-h-[52vh] lg:max-h-none`}
            aria-label="Villager Inspector"
          >
        {/* Villager Quick Roster */}
        <div className="border-b border-borderFolk p-2">
          <div className={`flex items-center justify-between gap-2 ${rosterCollapsed ? '' : 'mb-2'}`}>
            <button
              type="button"
              onClick={() => setRosterCollapsed((c) => !c)}
              aria-expanded={!rosterCollapsed}
              className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink"
            >
              {rosterCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Villagers ({villagers.length})</span>
              {rosterCollapsed && (
                <span className="ml-1 font-normal normal-case text-ink">
                  · {isScribeSelected ? narratorName : selectedCfg?.name ?? ''}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2">
              {!rosterCollapsed && (
                <button
                  type="button"
                  onClick={() => setRosterView((m) => (m === 'cards' ? 'compact' : 'cards'))}
                  aria-pressed={rosterView === 'compact'}
                  title={rosterView === 'cards' ? 'Switch to compact pills' : 'Switch to thumbnail cards'}
                  className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted hover:text-ink"
                >
                  <LayoutList className="h-3 w-3" aria-hidden="true" />
                  <span>{rosterView === 'cards' ? 'Compact' : 'Thumbnails'}</span>
                </button>
              )}
              <span className="font-mono text-[11px] text-muted">{sim.fps} FPS</span>
            </div>
          </div>

          {!rosterCollapsed && (rosterView === 'cards' ? (
            <div className="max-h-56 overflow-y-auto thin-scroll space-y-1 pr-0.5">
              {villagers.map((v) => {
                const rt = sim.runtimes.get(v.id);
                const active = v.id === selectedId;
                const isBusy =
                  rt?.state === 'conversing' || rt?.state === 'speaking' || rt?.state === 'thinking';
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`flex w-full items-center gap-1.5 rounded-sm border py-0.5 pl-0.5 pr-2 text-left transition ${
                      active
                        ? 'border-ink/50 bg-linen'
                        : 'border-borderFolk bg-surface hover:border-ink/30'
                    }`}
                  >
                    <VillagerAvatarThumb villager={v} size={46} look={aestheticSettings.worldLook === 'tiles' ? undefined : aestheticSettings.worldLook} />
                    <div className="min-w-0 flex-1 py-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${isBusy ? 'animate-pulse' : ''}`}
                          style={{ backgroundColor: v.accentColor }}
                        />
                        <span className="truncate text-xs font-semibold text-ink">{v.name}</span>
                      </div>
                      <p className="truncate text-[10px] text-muted">{v.role}</p>
                    </div>
                    <span className="shrink-0 rounded-sm bg-card px-1.5 py-0.5 font-mono text-[10px] capitalize text-muted border border-borderFolk">
                      {rt?.state ?? 'idle'}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedId('narrator')}
                className={`flex w-full items-center gap-1.5 rounded-sm border py-0.5 pl-0.5 pr-2 text-left transition ${
                  isScribeSelected
                    ? 'border-ochre bg-linen'
                    : 'border-borderFolk bg-surface hover:border-ochre/60'
                }`}
              >
                <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center font-serif text-xl font-bold text-ochre">
                  S
                </span>
                <div className="min-w-0 flex-1 py-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-ochre" />
                    <span className="truncate text-xs font-semibold text-ink">{narratorName}</span>
                  </div>
                  <p className="truncate text-[10px] text-muted">
                    Village Scribe · {settings.narratorStyle}
                  </p>
                </div>
                <span className="shrink-0 rounded-sm bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted border border-borderFolk">
                  DM
                </span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {villagers.map((v) => {
                const rt = sim.runtimes.get(v.id);
                const active = v.id === selectedId;
                const isBusy =
                  rt?.state === 'conversing' || rt?.state === 'speaking' || rt?.state === 'thinking';
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium transition ${
                      active
                        ? 'border-ink/50 bg-ink text-linen'
                        : 'border-borderFolk bg-surface text-ink hover:border-ink/40'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${isBusy ? 'animate-pulse' : ''}`}
                      style={{ backgroundColor: v.accentColor }}
                    />
                    <span>{v.name}</span>
                    {rt?.state === 'thinking' && <span className="text-[10px] opacity-80">…</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedId('narrator')}
                className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium transition ${
                  isScribeSelected
                    ? 'border-ochre bg-ochre text-white'
                    : 'border-borderFolk bg-surface text-ink hover:border-ochre/60'
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: isScribeSelected ? '#fff' : '#c79646' }}
                />
                <span>{narratorName}</span>
              </button>
            </div>
          ))}
        </div>

        {/* Selected Villager or Scribe Details + Shared Chat */}
        {(selectedCfg && selectedRt) || isScribeSelected ? (
          <>
            {isScribeSelected ? (
              <div className="border-b border-borderFolk bg-card/80 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailCollapsed((c) => !c)}
                    aria-expanded={!detailCollapsed}
                    className="flex items-center gap-1.5 text-left min-w-0"
                  >
                    {detailCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <h3 className="text-xs font-bold leading-tight truncate">{narratorName}</h3>
                      <p className="text-[10px] text-muted truncate">Village Scribe · {settings.narratorStyle}</p>
                    </div>
                  </button>
                  <span className="rounded-sm border border-ochre/50 bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ochre shrink-0">
                    {settings.narratorEnabled ? 'Voiced' : 'Muted'}
                  </span>
                </div>
                {!detailCollapsed && (
                  <p className="text-[11px] leading-snug text-ink/90">
                    Chronicler of Selo. Reads non-dialogue scene beats in turn, and answers directly
                    when addressed as <strong className="font-bold text-indigoFolk">{narratorName}</strong>.
                  </p>
                )}
              </div>
            ) : (
              selectedCfg &&
              selectedRt && (
                <div className="border-b border-borderFolk bg-card/80 p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailCollapsed((c) => !c)}
                      aria-expanded={!detailCollapsed}
                      className="flex items-center gap-1.5 text-left min-w-0"
                    >
                      {detailCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold leading-tight truncate">{selectedCfg.name}</h3>
                        <p className="text-[10px] text-muted truncate">{selectedCfg.role}</p>
                      </div>
                    </button>
                    <span className="rounded-sm border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] font-medium capitalize shrink-0">
                      {selectedRt.state}
                    </span>
                  </div>
                  {!detailCollapsed && (
                    <>
                      <p className="text-xs leading-relaxed text-ink/90">{selectedCfg.identity}</p>
                      <div className="rounded border border-borderFolk bg-surface/80 px-2.5 py-1.5 text-xs">
                        <span className="font-semibold text-ochre">Motive:</span>{' '}
                        {renderRichLabels(
                          selectedRt.currentIntention || selectedCfg.plan,
                          villagers,
                          sim.map.pointsOfInterest ?? [],
                          narratorName,
                        )}
                      </div>

                      <div className="flex flex-col gap-1 text-xs">
                        <details>
                          <summary className="cursor-pointer font-medium text-indigoFolk hover:underline">
                            Recent Memories ({selectedRt.memories.length})
                          </summary>
                          <ul className="mt-1.5 max-h-24 space-y-1 overflow-y-auto thin-scroll pr-1">
                            {[...selectedRt.memories].reverse().slice(0, 8).map((m) => (
                              <li key={m.id} className="rounded bg-card px-2 py-1 text-[11px] border border-borderFolk/60">
                                {m.summary}
                              </li>
                            ))}
                          </ul>
                        </details>
                        {selectedRt.worldFeed && selectedRt.worldFeed.length > 0 && (
                          <details>
                            <summary className="cursor-pointer font-medium text-sage hover:underline">
                              World Session Log ({selectedRt.worldFeed.length})
                            </summary>
                            <ul className="mt-1.5 max-h-24 space-y-1 overflow-y-auto thin-scroll pr-1">
                              {[...selectedRt.worldFeed].reverse().slice(0, 8).map((item, idx) => (
                                <li key={idx} className="rounded bg-card px-2 py-1 text-[11px] border border-borderFolk/60">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            )}

            {/* Active Conversation / World Script Stream */}
            <MaybeStitch on={stitchHud} look={hudLook}>
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className={`border-b border-borderFolk px-3 py-2 space-y-1.5 ${stitchHud ? 'border-dashed' : 'bg-surface/80'}`}>
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-muted">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setScriptCollapsed((c) => !c)}
                      aria-expanded={!scriptCollapsed}
                      aria-label="Toggle world script panel"
                      className="rounded p-0.5 hover:bg-card"
                    >
                      {scriptCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                    {(
                      [
                        ['hearing', 'Live Audio'],
                        ['focused', 'Thread'],
                        ['village', `World Script (${sim.conversations.length})`],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setFeedMode(id);
                          setScriptCollapsed(false);
                        }}
                        aria-pressed={feedMode === id}
                        className={chip(
                          feedMode === id,
                          `rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${feedMode === id ? 'bg-indigoFolk text-white' : 'hover:bg-card'}`,
                          'text-[11px] font-display',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ eavesdropSpeech: !settings.eavesdropSpeech })}
                      aria-pressed={settings.eavesdropSpeech}
                      title="Hear spoken villager dialogue within eavesdrop radius"
                      className={chip(
                        settings.eavesdropSpeech,
                        `rounded border px-1.5 py-0.5 text-[10px] font-medium ${settings.eavesdropSpeech ? 'border-sage bg-sage/15 text-ink' : 'border-borderFolk bg-card text-muted hover:text-ink'}`,
                      )}
                    >
                      Speech {settings.eavesdropSpeech ? 'On' : 'Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ eavesdropThoughts: !settings.eavesdropThoughts })}
                      aria-pressed={settings.eavesdropThoughts}
                      title="Eavesdrop on in-character villager thoughts within radius"
                      className={chip(
                        settings.eavesdropThoughts,
                        `rounded border px-1.5 py-0.5 text-[10px] font-medium ${settings.eavesdropThoughts ? 'border-indigoFolk bg-indigoFolk/15 text-ink' : 'border-borderFolk bg-card text-muted hover:text-ink'}`,
                      )}
                    >
                      Thoughts {settings.eavesdropThoughts ? 'On' : 'Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ showReasoning: !settings.showReasoning })}
                      aria-pressed={settings.showReasoning}
                      title="Toggle separate <think> reasoning mode (audio off by default)"
                      className={chip(
                        settings.showReasoning,
                        `rounded border px-1.5 py-0.5 text-[10px] font-mono ${settings.showReasoning ? 'border-ochre bg-ochre/15 text-ink' : 'border-borderFolk bg-card text-muted hover:text-ink'}`,
                      )}
                    >
                      &lt;think&gt; {settings.showReasoning ? 'On' : 'Off'}
                    </button>
                    {settings.showReasoning && (
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ speakReasoning: !settings.speakReasoning })}
                        aria-pressed={settings.speakReasoning}
                        title="Read <think> reasoning aloud (off by default)"
                        className={chip(
                          settings.speakReasoning,
                          `rounded border px-1.5 py-0.5 text-[10px] font-mono ${settings.speakReasoning ? 'border-crimson bg-crimson/15 text-ink' : 'border-borderFolk bg-card text-muted hover:text-ink'}`,
                        )}
                      >
                        &lt;think&gt; Sound {settings.speakReasoning ? 'On' : 'Off'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const next = !settings.enableOmniTts;
                        if (!next) brainRouter.flushAudioQueue();
                        onUpdateSettings({
                          enableOmniTts: next,
                        });
                      }}
                      aria-pressed={settings.enableOmniTts}
                      className={`inline-flex items-center gap-1 ${chip(settings.enableOmniTts, 'rounded border border-borderFolk bg-card px-2 py-0.5 text-[11px] hover:bg-surface')}`}
                    >
                      {settings.enableOmniTts ? (
                        <Volume2 className="h-3 w-3 text-sage" />
                      ) : (
                        <VolumeX className="h-3 w-3 text-muted" />
                      )}
                      <span>Voice {settings.enableOmniTts ? 'On' : 'Off'}</span>
                    </button>
                  </div>
                </div>

                {!scriptCollapsed && (
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    <span className={`${stitchHud ? 'stitch-muted' : 'text-muted'} mr-0.5`}>Show:</span>
                    {(
                      [
                        ['Speech', filterSpeech, setFilterSpeech],
                        ['Scribe', filterScribe, setFilterScribe],
                        ['Thoughts', filterThoughts, setFilterThoughts],
                        ['You', filterHuman, setFilterHuman],
                      ] as const
                    ).map(([label, active, setter]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setter((v) => !v)}
                        aria-pressed={active}
                        className={chip(
                          active,
                          `rounded-sm border px-1.5 py-0.5 font-medium ${active ? 'border-ink/40 bg-surface text-ink' : 'border-borderFolk bg-card text-muted line-through'}`,
                        )}
                      >
                        {label}
                      </button>
                    ))}
                    <select
                      aria-label="Filter script by character"
                      value={scriptActorFilter}
                      onChange={(e) => setScriptActorFilter(e.target.value)}
                      className={fieldClass('rounded border border-borderFolk bg-card px-1.5 py-0.5 text-[10px]')}
                    >
                      <option value="all">All Actors</option>
                      {villagers.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                      <option value="narrator">{narratorName}</option>
                      <option value={sim.player.id}>{sim.player.name}</option>
                    </select>
                    <input
                      type="text"
                      value={scriptSearch}
                      onChange={(e) => setScriptSearch(e.target.value)}
                      placeholder="Filter text…"
                      aria-label="Filter world script text"
                      className={fieldClass('min-w-[88px] flex-1 rounded border border-borderFolk bg-card px-2 py-0.5 text-[10px]')}
                    />
                  </div>
                )}
              </div>

              {!scriptCollapsed && (
                <div
                  ref={feedScroll.containerRef}
                  onScroll={feedScroll.handleScroll}
                  className="relative flex-1 overflow-y-auto p-2 space-y-1.5 thin-scroll"
                >
                  {activeSpeech && (
                    <div className="rounded-sm border border-sage/60 bg-card px-2 py-1 text-xs flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sage">
                          <Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" />
                          <span>
                            Now Hearing · {activeSpeech.speakerName} ({activeSpeech.engine})
                          </span>
                        </div>
                        <p className="text-ink mt-0.5 line-clamp-2">
                          {renderRichLabels(
                            activeSpeech.text,
                            villagers,
                            sim.map.pointsOfInterest ?? [],
                            narratorName,
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {sim.configs.has(activeSpeech.speakerId) && (
                          <button
                            type="button"
                            onClick={() => setSelectedId(activeSpeech.speakerId)}
                            className="rounded-sm border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] hover:border-ink/40"
                          >
                            Focus
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => brainRouter.flushAudioQueue()}
                          className="rounded-sm border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] hover:text-crimson"
                        >
                          Flush
                        </button>
                      </div>
                    </div>
                  )}

                  {displayedMessages.length === 0 ? (
                    <div className="rounded-sm border border-dashed border-borderFolk p-3 text-center text-xs text-muted">
                      Type a message below — press <kbd className="font-mono">@</kbd> to mention someone or{' '}
                      <kbd className="font-mono">#</kbd> to pick a place to guide characters.
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {displayedMessages.map((msg) => {
                        const isHuman = msg.senderId === sim.player.id;
                        const isNarration = msg.kind === 'narration' || msg.senderId === 'narrator';
                        const isThought = msg.kind === 'thought';
                        const isNowSpeaking =
                          Boolean(activeSpeech) &&
                          activeSpeech!.speakerId === msg.senderId &&
                          msg.text.includes(activeSpeech!.text.slice(0, 20));
                        if (stitchHud) {
                          // A line of the script, marked by a thread in the speaker's own colour.
                          const thread = isNarration
                            ? 'var(--stitch-thread)'
                            : clothAccent(sim.configs.get(msg.senderId)?.accentColor, aestheticSettings.worldLook === "tiles" ? undefined : (aestheticSettings.worldLook as PaletteName)) ?? 'var(--stitch-ink)';
                          return (
                            <li
                              key={msg.id}
                              className={`border-l-[3px] py-1 pl-2.5 pr-1 text-xs ${isThought ? 'border-dashed italic opacity-90' : ''} ${isNarration ? 'italic' : ''} ${isHuman ? 'ml-3' : ''} ${isNowSpeaking ? 'layer-active' : ''}`}
                              style={{ borderLeftColor: thread }}
                            >
                              <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] not-italic">
                                <span className="font-display text-[12px] text-ink" style={{ color: isNarration ? undefined : thread }}>
                                  {msg.senderName}
                                  {isNowSpeaking && <span className="stitch-thread ml-1.5 text-[10px]">speaking</span>}
                                </span>
                                <span className="stitch-muted">{isNarration ? 'scribe' : isThought ? 'thought' : msg.source}</span>
                              </div>
                              <p className="leading-relaxed whitespace-pre-wrap">
                                {msg.text ? renderRichLabels(msg.text, villagers, sim.map.pointsOfInterest ?? [], narratorName) : '…'}
                              </p>
                              {settings.showReasoning && msg.reasoning && (
                                <aside aria-label="Model reasoning" className="stitch-muted mt-1 border-l border-dashed border-borderFolk pl-2 font-mono text-[10px] not-italic whitespace-pre-wrap">
                                  &lt;think&gt; {msg.reasoning}
                                </aside>
                              )}
                            </li>
                          );
                        }
                        return (
                          <li
                            key={msg.id}
                            className={`rounded-sm border px-2 py-1.5 text-xs ${
                              isNowSpeaking
                                ? 'border-sage bg-card ring-1 ring-sage/50'
                                : isNarration
                                  ? 'border-borderFolk border-l-2 border-l-ochre bg-card italic'
                                  : isThought
                                    ? 'mr-2 border-dashed border-borderFolk bg-card/70 italic text-ink/90'
                                    : isHuman
                                      ? 'ml-3 border-borderFolk border-l-2 border-l-indigoFolk bg-card'
                                      : 'mr-2 border-borderFolk bg-card'
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted not-italic">
                              <span className="font-semibold text-ink">
                                {msg.senderName}
                                {isNowSpeaking && (
                                  <span className="ml-1.5 rounded bg-sage px-1 py-0.2 text-[9px] text-white uppercase">
                                    Speaking
                                  </span>
                                )}
                              </span>
                              <span className="rounded bg-surface px-1.5 py-0.5 font-mono uppercase">
                                {isNarration ? 'scribe' : isThought ? 'thought' : msg.source}
                              </span>
                            </div>
                            <p className="leading-relaxed whitespace-pre-wrap">
                              {msg.text
                                ? renderRichLabels(
                                    msg.text,
                                    villagers,
                                    sim.map.pointsOfInterest ?? [],
                                    narratorName,
                                  )
                                : '…'}
                            </p>
                            {settings.showReasoning && msg.reasoning && (
                              <aside
                                aria-label="Model reasoning"
                                className="mt-1.5 rounded border border-borderFolk/70 bg-surface/80 px-2 py-1 font-mono text-[10px] not-italic text-muted whitespace-pre-wrap"
                              >
                                <span className="font-semibold text-ink/70">&lt;think&gt;</span> {msg.reasoning}
                              </aside>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!feedScroll.isFollowing && displayedMessages.length > 0 && (
                    <div className="sticky bottom-1 flex justify-center pt-1">
                      <button
                        type="button"
                        onClick={feedScroll.jumpToBottom}
                        className={stitchHud ? 'stitch-panel glyph-button inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium' : 'inline-flex items-center gap-1 rounded-full border border-borderFolk bg-card/95 px-2.5 py-1 text-[10px] font-medium text-ink shadow-md backdrop-blur hover:bg-surface'}
                      >
                        <ArrowDown className="h-3 w-3 text-indigoFolk" />
                        <span>Jump to Latest</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Composer & LFM3-Omni Voice Input */}
            <div className={`relative border-t border-borderFolk p-3 space-y-2 ${stitchHud ? 'border-dashed' : 'bg-card'}`}>
              {voiceError && (
                <div role="alert" className="flex items-center justify-between gap-2 rounded border border-crimson/50 bg-crimson/10 px-2.5 py-1.5 text-[11px] text-crimson">
                  <span>{voiceError}</span>
                  {!omniEngine.isReady() && (
                    <button
                      type="button"
                      onClick={onOpenMonitor}
                      className="shrink-0 underline font-semibold"
                    >
                      Open Monitor
                    </button>
                  )}
                </div>
              )}

              {recording && (
                <div className="flex items-center gap-2 rounded bg-surface px-2.5 py-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full bg-crimson animate-pulse" />
                  <span className="font-medium">Listening…</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-borderFolk/40">
                    <div
                      className="h-full bg-crimson transition-all duration-75"
                      style={{ width: `${Math.round(micLevel * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {isMentionMenuOpen && (
                <div className="absolute bottom-full left-3 right-3 z-20 mb-1.5 rounded-lg border border-borderFolk bg-card p-1 shadow-lg">
                  <ul
                    id="mention-listbox"
                    role="listbox"
                    aria-label="Address a character or Scribe"
                    className="max-h-48 overflow-y-auto thin-scroll space-y-0.5"
                  >
                    {filteredMentions.map((cand, idx) => {
                      const active = idx === clampedMentionIdx;
                      return (
                        <li
                          key={cand.id}
                          id={`mention-opt-${cand.id}`}
                          role="option"
                          aria-selected={active}
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            insertMentionCandidate(cand);
                          }}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2.5 py-1.5 text-xs ${
                            active ? 'bg-indigoFolk text-white' : 'hover:bg-surface text-ink'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: active ? '#fff' : cand.accentColor }}
                            />
                            <span className="font-bold truncate">
                              {cand.displayLabel}
                            </span>
                            <span className={`truncate text-[11px] ${active ? 'text-white/80' : 'text-muted'}`}>
                              {cand.role}
                            </span>
                          </div>
                          {cand.statusHint && (
                            <span className={`shrink-0 text-[10px] font-mono ${active ? 'text-white/80' : 'text-muted'}`}>
                              {cand.statusHint}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <form onSubmit={handleSendText} className="space-y-1.5">
                <div className="relative w-full">
                  <label htmlFor="village-chat-input" className="visually-hidden">
                    Message {isScribeSelected ? narratorName : selectedCfg?.name ?? 'village'} (use @ for characters or # for places)
                  </label>
                  {!chatInput && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 right-2.5 top-2 text-xs leading-relaxed text-muted select-none"
                    >
                      {isScribeSelected
                        ? `Ask ${narratorName}, or address characters (@) and places (#)…`
                        : `Talk to ${selectedCfg?.name ?? ''} — type @ for people or # for places…`}
                    </span>
                  )}
                  <div
                    ref={composerRef}
                    id="village-chat-input"
                    role="textbox"
                    aria-multiline="true"
                    contentEditable={!sending}
                    suppressContentEditableWarning
                    aria-expanded={isMentionMenuOpen}
                    aria-controls={isMentionMenuOpen ? 'mention-listbox' : undefined}
                    aria-activedescendant={
                      isMentionMenuOpen && filteredMentions[clampedMentionIdx]
                        ? `mention-opt-${filteredMentions[clampedMentionIdx].id}`
                        : undefined
                    }
                    aria-describedby="chat-mention-hint"
                    onInput={handleComposerInput}
                    onClick={() => syncComposerState()}
                    onKeyUp={() => syncComposerState()}
                    onPaste={(e) => {
                      e.preventDefault();
                      const plain = e.clipboardData.getData('text/plain');
                      if (plain) insertPlainTextAtCaret(plain);
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (isMentionMenuOpen) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setMentionIdx((i) => (i + 1) % filteredMentions.length);
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setMentionIdx(
                            (i) => (i - 1 + filteredMentions.length) % filteredMentions.length,
                          );
                          return;
                        }
                        if (e.key === 'Tab' || e.key === 'Enter') {
                          e.preventDefault();
                          const choice = filteredMentions[clampedMentionIdx];
                          if (choice) insertMentionCandidate(choice);
                          return;
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setMentionMatch(null);
                          return;
                        }
                      }
                      if (e.key === 'Backspace') {
                        const root = composerRef.current;
                        const sel = window.getSelection();
                        if (root && sel && sel.rangeCount > 0 && sel.isCollapsed) {
                          const r = sel.getRangeAt(0);
                          let targetChip: HTMLElement | null = null;
                          if (r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset === 0) {
                            const prev = r.startContainer.previousSibling;
                            if (prev instanceof HTMLElement && prev.dataset.mentionToken) {
                              targetChip = prev;
                            }
                          } else if (r.startContainer === root && r.startOffset > 0) {
                            const prev = root.childNodes[r.startOffset - 1];
                            if (prev instanceof HTMLElement && prev.dataset.mentionToken) {
                              targetChip = prev;
                            }
                          }
                          if (targetChip) {
                            e.preventDefault();
                            targetChip.remove();
                            syncComposerState();
                            return;
                          }
                        }
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendText(e);
                      }
                    }}
                    className={
                      stitchHud
                        ? 'stitch-panel min-h-[82px] max-h-[168px] w-full overflow-y-auto thin-scroll px-3 py-2.5 text-xs leading-relaxed text-ink focus:outline-none whitespace-pre-wrap break-words'
                        : 'min-h-[82px] max-h-[168px] w-full overflow-y-auto thin-scroll rounded border border-borderFolk bg-surface px-2.5 py-2 text-xs leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-indigoFolk whitespace-pre-wrap break-words'
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleTriggerAtMention}
                      aria-label="Address a character with @"
                      title="Insert @ character mention"
                      className={stitchHud ? 'glyph-button relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm font-display text-sm text-ink' : 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-borderFolk bg-surface font-mono text-xs font-bold text-ink hover:border-ink/40'}
                    >
                      @
                    </button>

                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleTriggerHashMention}
                      aria-label="Reference a Point of Interest with #"
                      title="Insert # landmark place"
                      className={stitchHud ? 'glyph-button relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm font-display text-sm text-ink' : 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-borderFolk bg-surface font-mono text-xs font-bold text-ink hover:border-ink/40'}
                    >
                      #
                    </button>

                    {!isScribeSelected && (
                      <button
                        type="button"
                        onClick={toggleVoiceRecording}
                        aria-pressed={recording}
                        aria-label={recording ? 'Stop voice recording and send' : 'Talk with microphone'}
                        title={recording ? 'Stop voice recording' : 'Voice message'}
                        className={
                          stitchHud
                            ? `glyph-button relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm ${recording ? 'glyph-on stitch-thread' : 'text-ink'}`
                            : `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border transition ${recording ? 'border-crimson bg-crimson text-white' : 'border-borderFolk bg-surface text-ink hover:border-crimson'}`
                        }
                      >
                        {recording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      </button>
                    )}

                    <span id="chat-mention-hint" className={`text-[10px] truncate ${stitchHud ? 'stitch-muted' : 'text-muted'}`}>
                      Type <kbd className="font-mono">@</kbd> person · <kbd className="font-mono">#</kbd> place
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={sending || !chatInput.trim()}
                    aria-label="Send message"
                    title="Send message"
                    className={stitchHud ? 'glyph-button glyph-on relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm stitch-thread disabled:opacity-45' : 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-ink/30 bg-ink text-linen hover:opacity-90 disabled:opacity-45'}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </form>
            </div>
            </MaybeStitch>
          </>
        ) : (
          <div className="p-6 text-center text-xs text-muted">No villagers in the village yet.</div>
        )}
          </aside>
        </>
      )}
    </div>
  );
};
