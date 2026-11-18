import { startSimulationDriver } from './app/simulationDriver';
import type { WorldCommand } from './world/commands';
import { WorldStore } from './world/worldStore';
import { DEFAULT_WORLD_PACK_ID, WORLD_PACKS, findWorldPack, inferWorldContext, tileSemanticsForMap } from './world/packs';
import { createWorldArt } from './art/gameLook';
import { storyToMarkdown } from './world/storyText';
import { GENERIC_WORLD_CONTEXT } from './world/worldContext';
import { createBrowserSimulation } from './app/browserSimulation';
import { GlyphButton } from './components/Glyph';
import { StitchScope } from './components/Stitch';
import { shellVars } from './art/uiChrome';
import type { PaletteName } from './art/looks';
import { glyphLookFor } from './art/glyphRender';
import React, { useEffect, useRef, useState } from 'react';
import { captureView } from './app/viewCapture';
import { registerControls, type AppControls } from './app/uiControl';
import PiPanel from './components/PiPanel';
import AgentOverlay from './components/AgentOverlay';
import { piSession } from './agent/piSession';

/** The side panel's modes besides the village's own Storyline. */
type PanelMode = 'pi' | 'style' | 'data';
import {
  ChevronDown,
  FolderOpen,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { bonsaiEngine } from './ai/bonsaiEngine';
import { brainRouter } from './ai/brainRouter';
import { minicpmEngine } from './ai/minicpmEngine';
import { resolveStartupAutoLoadCandidate } from './ai/modelCache';
import { kokoroEngine, lightVoiceWasChosen } from './ai/kokoroEngine';
import { VoiceNudge, voiceNudgeDismissed } from './components/VoiceNudge';
import { omniEngine } from './ai/omniEngine';
import { seloToolHost, type WorkspaceTabId } from './api/seloToolRegistry';
import { installSeloWebMcpAndApi } from './api/webMcpBridge';
import { abbreviateWorldName } from './utils/formatNames';
import {
  resolveWorldTheme,
  loadAestheticSettings,
  resolveAestheticTokens,
  saveAestheticSettings,
  type AestheticSettings,
} from './utils/aestheticThemes';
import { AestheticStudioPanel } from './components/AestheticStudioPanel';
import { AssetGuideView } from './components/AssetGuideView';
import { CharacterEditorView } from './components/CharacterEditorView';
import { MonitorView } from './components/MonitorView';
import { ObservatoryView } from './components/ObservatoryView';
import WorldEditorView from './components/WorldEditorView';
import PatternStudioView from './components/PatternStudioView';
import { WorldCommandError } from './world/commands';
import { VillageView } from './components/VillageView';
import {
  generateProceduralPlayerCustomSprite,
  getPlayerSpriteCacheCount,
} from './engine/playerSpriteGenerator';
import { getAudioDebugStats } from './ai/audioPipeline';
import { segmentationClient } from './ai/segmentationClient';
import { perfMemoryTracker } from './engine/perfMemoryTracker';
import { getImageCacheStats, pruneImageCache } from './engine/renderer';
import { getSpriteSheetCacheCount } from './engine/spriteGenerator';
import { VillageSimulation } from './engine/simulation';
import type { ModelProgress, ModelSettings, VillageMap, VillagerConfig } from './engine/types';
import {
  createBlankWorldMap,
  deleteSavedWorld,
  exportCharactersJson,
  exportCharactersWithHistoriesJson,
  exportDatabaseJson,
  exportLevelJson,
  exportProjectJson,
  listSavedWorlds,
  loadPersistedState,
  parseImportedFile,
  resetPersistedState,
  savePersistedState,
  saveWorldToMemory,
  type PersistedVillageState,
  type SavedWorldSlot,
} from './storage/villageStore';

type DemoWorldId = string;

const DEMO_WORLDS: Array<{ id: DemoWorldId; label: string; description: string }> = WORLD_PACKS.map(
  (pack) => ({ id: pack.id, label: pack.name, description: pack.description }),
);

type TabId = 'village' | 'observatory' | 'world' | 'patterns' | 'characters' | 'monitor' | 'guides';

export function App() {
  const [tab, setTab] = useState<TabId>('village');
  const [ready, setReady] = useState(false);
  const [map, setMap] = useState<VillageMap | null>(null);
  const [villagers, setVillagers] = useState<VillagerConfig[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  // One side panel at a time: Style or World & Data. In the village it takes the inspector's place.
  const [sidePanel, setSidePanel] = useState<PanelMode | null>(null);
  /** The mode the panel last showed, so the panel button can bring it back outside the village. */
  const lastPanelRef = useRef<PanelMode>('style');
  useEffect(() => {
    if (sidePanel) lastPanelRef.current = sidePanel;
  }, [sidePanel]);
  // Where the village draws its controls: a slot in the top bar.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  // How wide the village's panel is, so the right of the top bar sits over it.
  const [panelWidth, setPanelWidth] = useState(0);
  const [aestheticSettings, setAestheticSettings] = useState<AestheticSettings>(() =>
    loadAestheticSettings(),
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('seloai:sidebar-open');
      if (saved === 'false') return false;
    } catch {
      // ignore storage errors
    }
    return true;
  });
  const [textStatus, setTextStatus] = useState<ModelProgress>(brainRouter.textProgress);
  const [omniStatus, setOmniStatus] = useState<ModelProgress>(omniEngine.progress);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [savedWorlds, setSavedWorlds] = useState<SavedWorldSlot[]>([]);
  const [selectedDemoId, setSelectedDemoId] = useState<DemoWorldId>(DEFAULT_WORLD_PACK_ID);
  const [selectedSavedWorldId, setSelectedSavedWorldId] = useState<string>('');
  const [saveWorldName, setSaveWorldName] = useState<string>('');

  const simRef = useRef<VillageSimulation | null>(null);
  // The app's controls for agents (filled in below, every render): declared up here, before any
  // early return, so the hooks run in the same order on every render.
  const appControlsRef = useRef<AppControls | null>(null);
  useEffect(
    () =>
      registerControls('app', {
        state: () => appControlsRef.current!.state(),
        setTab: (t) => appControlsRef.current!.setTab(t),
        setPanel: (m) => appControlsRef.current!.setPanel(m),
        setTopBar: (show) => appControlsRef.current!.setTopBar(show),
        exportImage: (w) => appControlsRef.current!.exportImage(w),
      }),
    [],
  );
  // On a local dev server, the live simulation and Pi are reachable from the console as `__sim` and `__pi`, for debugging.
  useEffect(() => {
    if (!/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) return;
    const id = window.setInterval(() => {
      (window as unknown as { __sim?: unknown; __pi?: unknown }).__sim = simRef.current;
      (window as unknown as { __pi?: unknown }).__pi = piSession;
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  const storeRef = useRef<WorldStore>(new WorldStore());
  const syncedCastRef = useRef<VillagerConfig[] | null>(null);
  const [, setHistoryTick] = useState(0);
  const resetDialogRef = useRef<HTMLDialogElement | null>(null);
  const autoLoadAttemptedRef = useRef(false);
  const [showVoiceNudge, setShowVoiceNudge] = useState(false);
  // Until the startup check has decided which voice to load, the story waits.
  const [voiceDecided, setVoiceDecided] = useState(false);
  const [lightStatus, setLightStatus] = useState<ModelProgress>(kokoroEngine.getProgress());
  useEffect(() => kokoroEngine.subscribe(setLightStatus), []);
  // The story does not begin before a voice: hold it while the startup check runs, while a
  // voice model loads, and while the voice card asks; let go once a voice is ready (or the
  // card is dismissed, when the browser's voice will do).
  const voiceReady = omniStatus.status === 'ready' || lightStatus.status === 'ready';
  const voiceLoading = omniStatus.status === 'loading' || lightStatus.status === 'loading';
  const holdStory = !voiceReady && (!voiceDecided || voiceLoading || showVoiceNudge);
  useEffect(() => {
    if (simRef.current) simRef.current.holdStory = holdStory;
  }, [holdStory, ready]);
  const latestRef = useRef<{
    tab: WorkspaceTabId;
    map: VillageMap | null;
    villagers: VillagerConfig[];
    settings: ModelSettings | null;
  }>({ tab, map, villagers, settings });
  latestRef.current = { tab, map, villagers, settings };

  // The newest style settings and theme, for tools that read them outside a render.
  const aestheticRef = useRef(aestheticSettings);
  aestheticRef.current = aestheticSettings;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const handleUpdateAesthetic = (next: AestheticSettings) => {
    aestheticRef.current = next;
    setAestheticSettings(next);
    saveAestheticSettings(next);
  };

  // The top bar can tuck itself away: it slides out when the pointer reaches the top edge,
  // and the ` key keeps it out (or tucks it away again).
  const autoHideBar = aestheticSettings.topBarAutoHide;
  const [barPinned, setBarPinned] = useState(false);
  const [barHover, setBarHover] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const barOut = !autoHideBar || barPinned || barHover;
  useEffect(() => {
    if (!autoHideBar) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key !== '`' || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setBarPinned((v) => !v);
      setBarHover(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autoHideBar]);
  const toggleSidebarOpen = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('seloai:sidebar-open', String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  // `\` shows or hides the side panel, whichever mode it is in.
  const togglePanelRef = useRef<() => void>(() => {});
  togglePanelRef.current = () => (tab === 'village' ? toggleSidebarOpen() : setSidePanel((p) => (p ? null : lastPanelRef.current)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      e.preventDefault();
      togglePanelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const u1 = brainRouter.subscribeTextStatus(setTextStatus);
    const u2 = omniEngine.subscribe(setOmniStatus);
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    if (theme !== 'system') {
      document.documentElement.dataset.theme = theme;
    } else if (aestheticSettings.worldLook === 'tiles') {
      delete document.documentElement.dataset.theme;
    } else {
      // With no explicit choice, the panels follow the world: light beside cloth and paper,
      // dark beside the night plate.
      document.documentElement.dataset.theme = aestheticSettings.worldLook === 'night' ? 'dark' : 'light';
    }
  }, [theme, aestheticSettings.worldLook]);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadPersistedState(), listSavedWorlds()]).then(([persisted, saved]) => {
      if (!mounted) return;
      simRef.current = createBrowserSimulation(
        persisted.map,
        persisted.villagers,
        persisted.conversations,
        persisted.modelSettings,
        persisted.world,
        { timers: 'sim' },
      );
      if (persisted.characterHistories) {
        simRef.current.applyCharacterHistories(persisted.characterHistories);
      }
      if (persisted.focalWorldlineId) {
        simRef.current.setFocalWorldline(persisted.focalWorldlineId);
      }
      setSettings(persisted.modelSettings);
      storeRef.current.reset({
        map: persisted.map,
        cast: persisted.villagers,
        context: simRef.current.world,
      });
      setSavedWorlds(saved);
      if (saved.length > 0) {
        setSelectedSavedWorldId(saved[0].id);
      }
      latestRef.current = {
        tab: latestRef.current.tab,
        map: persisted.map,
        villagers: persisted.villagers,
        settings: persisted.modelSettings,
      };
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const persistAll = (
    nextMap: VillageMap,
    nextVillagers: VillagerConfig[],
    nextSettings: ModelSettings,
  ) => {
    savePersistedState({
      map: nextMap,
      villagers: nextVillagers,
      modelSettings: nextSettings,
      conversations: simRef.current?.conversations ?? [],
      characterHistories: simRef.current?.exportCharacterHistories(),
      focalWorldlineId: simRef.current?.focalWorldlineId,
      world: simRef.current?.world,
      savedAt: Date.now(),
    });
  };

  // The world keeps running whichever workspace tab is showing.
  useEffect(() => {
    if (!ready) return;
    return startSimulationDriver(() => simRef.current);
  }, [ready]);

  // The store is the single path for changing the authored world. Every change, whoever
  // made it, lands here and is pushed out to the interface, the simulation and storage.
  useEffect(
    () =>
      storeRef.current.subscribe((doc, _previous, reason) => {
        latestRef.current.map = doc.map;
        latestRef.current.villagers = doc.cast;
        setMap(doc.map);
        setVillagers(doc.cast);
        setHistoryTick((tick) => tick + 1);
        const sim = simRef.current;
        if (sim) {
          if (sim.world !== doc.context) sim.setWorld(doc.context);
          if (sim.map !== doc.map) sim.updateMap(doc.map);
          if (syncedCastRef.current !== doc.cast) sim.syncVillagers(doc.cast);
        }
        syncedCastRef.current = doc.cast;
        const curSettings = latestRef.current.settings;
        if (reason !== 'reset' && curSettings) persistAll(doc.map, doc.cast, curSettings);
      }),
    [],
  );

  const handleApplyMap = (nextMap: VillageMap) => {
    storeRef.current.dispatch({ type: 'map.replace', map: nextMap }, `Apply map "${nextMap.name}"`);
    brainRouter.log({
      channel: 'storage',
      level: 'info',
      title: 'Map Updated',
      detail: `Applied "${nextMap.name}" (${nextMap.width}×${nextMap.height}) to live village.`,
    });
  };

  /** Runs one world command from an editor; returns its error message, or null. */
  const handleWorldCommand = (command: WorldCommand, label: string): string | null => {
    try {
      storeRef.current.dispatch(command, label);
      return null;
    } catch (error) {
      if (error instanceof WorldCommandError || error instanceof Error) return error.message;
      return String(error);
    }
  };

  const handleApplyVillagers = (nextVillagers: VillagerConfig[]) => {
    storeRef.current.dispatch({ type: 'cast.replace', cast: nextVillagers }, 'Update cast');
    brainRouter.log({
      channel: 'storage',
      level: 'info',
      title: 'Roster Updated',
      detail: `Synced ${nextVillagers.length} villagers to live simulation.`,
    });
  };

  const handleUndoWorld = () => {
    const label = storeRef.current.undo();
    if (label) setDataNotice(`Undid: ${label}`);
  };

  const handleRedoWorld = () => {
    const label = storeRef.current.redo();
    if (label) setDataNotice(`Redid: ${label}`);
  };

  const handleUpdateSettings = (patch: Partial<ModelSettings>) => {
    const curSettings = latestRef.current.settings;
    const curMap = latestRef.current.map;
    if (!curSettings || !curMap) return;
    const next = { ...curSettings, ...patch };
    latestRef.current.settings = next;
    setSettings(next);
    simRef.current?.updateSettings(next);
    persistAll(curMap, latestRef.current.villagers, next);
  };

  useEffect(() => {
    if (!ready) return;
    piSession.connect(() => latestRef.current.settings!);
    seloToolHost.setHooks({
      getSimulation: () => simRef.current!,
      getMap: () => latestRef.current.map!,
      getVillagers: () => latestRef.current.villagers,
      getSettings: () => latestRef.current.settings!,
      getTab: () => latestRef.current.tab,
      setTab: (requested) => {
        // The Level Editor and Tapestry Studio are now the World editor.
        const nextTab: TabId = requested === 'level' ? 'world' : requested === 'tapestry' ? 'patterns' : requested;
        latestRef.current.tab = nextTab;
        setTab(nextTab);
      },
      getStore: () => storeRef.current,
      captureView,
      style: {
        get: () => aestheticRef.current,
        update: handleUpdateAesthetic,
        getTheme: () => themeRef.current,
        setTheme,
      },
      applyMap: handleApplyMap,
      applyVillagers: handleApplyVillagers,
      updateSettings: handleUpdateSettings,
      persistAll: () => {
        if (latestRef.current.map && latestRef.current.settings) {
          persistAll(
            latestRef.current.map,
            latestRef.current.villagers,
            latestRef.current.settings,
          );
        }
      },
    });
    return installSeloWebMcpAndApi();
  }, [ready]);

  // Automatically load the last-used WebGPU brain model if already downloaded in cache or /models/
  useEffect(() => {
    if (!ready || !settings || autoLoadAttemptedRef.current) return;
    autoLoadAttemptedRef.current = true;
    let cancelled = false;

    resolveStartupAutoLoadCandidate(settings).then((candidate) => {
      if (cancelled) return;
      setVoiceDecided(true);
      if (!candidate) {
        // No cached brain: load the light voice if it was chosen before, otherwise offer a voice.
        if (lightVoiceWasChosen()) kokoroEngine.load().catch(() => {});
        else if (!voiceNudgeDismissed() && !omniEngine.isReady()) setShowVoiceNudge(true);
        return;
      }
      if (
        omniEngine.isReady() ||
        brainRouter.isTextModelReady() ||
        minicpmEngine.isReady() ||
        bonsaiEngine.isReady()
      ) {
        return;
      }

      const { spec, probe } = candidate;
      const curSettings = latestRef.current.settings;
      if (curSettings) {
        const patch: Partial<ModelSettings> = {};
        if (curSettings.brainEngine !== spec.brainEngine) {
          patch.brainEngine = spec.brainEngine;
        }
        if (spec.brainEngine === 'lfm3-omni') {
          if (curSettings.omniModelId !== spec.modelId) patch.omniModelId = spec.modelId;
        } else {
          if (curSettings.textModelId !== spec.modelId) patch.textModelId = spec.modelId;
          if (curSettings.textDtype !== spec.textDtype) patch.textDtype = spec.textDtype;
        }
        if (Object.keys(patch).length > 0) {
          handleUpdateSettings(patch);
        }
      }

      brainRouter.log({
        channel: spec.brainEngine === 'lfm3-omni' ? 'lfm3-omni' : 'lfm3-1.7b',
        level: 'info',
        title: 'Auto-Loading Cached Model',
        detail: `${spec.modelId} (${probe.detail})`,
      });
      brainRouter.loadConfiguredBrain(spec).catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    perfMemoryTracker.registerProvider({
      getEngines: () => {
        const curSettings = latestRef.current.settings;
        const omniStats = omniEngine.getMemoryStats();
        const miniStats = minicpmEngine.getMemoryStats();
        const bonsaiStats = bonsaiEngine.getMemoryStats();
        const segStatus = segmentationClient.getStatus();
        return [
          {
            id: 'lfm3-omni',
            label: 'LFM3-Omni-2B',
            backend: 'webgpu',
            status: omniEngine.progress.status,
            modelId: omniEngine.getLoadedModelId() || curSettings?.omniModelId || '',
            liveBytes: omniStats?.liveBytes ?? null,
            peakBytes: omniStats?.peakBytes ?? null,
          },
          {
            id: 'minicpm5-gguf',
            label: 'MiniCPM5-2B',
            backend: 'webgpu',
            status: minicpmEngine.progress.status,
            modelId: minicpmEngine.getLoadedModelId() || '',
            liveBytes: miniStats?.liveBytes ?? null,
            peakBytes: miniStats?.peakBytes ?? null,
          },
          {
            id: 'bonsai2-gguf',
            label: 'Bonsai-2 27B',
            backend: 'webgpu',
            status: bonsaiEngine.progress.status,
            modelId: bonsaiEngine.getLoadedModelId() || '',
            liveBytes: bonsaiStats?.liveBytes ?? null,
            peakBytes: bonsaiStats?.peakBytes ?? null,
          },
          {
            id: 'transformers-onnx',
            label: 'ONNX Text Worker',
            backend: 'worker-onnx',
            status: brainRouter.textProgress.status,
            modelId: brainRouter.getLoadedTextModelId() || '',
            liveBytes: null,
            peakBytes: null,
          },
          {
            id: 'vision-seg',
            label: 'Vision Segmentation',
            backend: 'worker-vision',
            status: segStatus.status,
            modelId: segStatus.modelId ?? '',
            liveBytes: null,
            peakBytes: null,
          },
        ];
      },
      getSimCounters: () =>
        simRef.current?.getMemoryStats() ?? {
          conversationCount: 0,
          activeConversationCount: 0,
          totalMessages: 0,
          villagerCount: 0,
          totalMemories: 0,
          totalWorldFeedItems: 0,
          timelineFrames: 0,
          cachedConvSnapshots: 0,
        },
      getCacheCounters: () => {
        const img = getImageCacheStats();
        const audio = getAudioDebugStats();
        const routerCounts = brainRouter.getDebugCounts();
        return {
          imageCacheCount: img.totalEntries,
          imageCacheDataUrlCount: img.dataUrlEntries,
          spriteSheetCacheCount: getSpriteSheetCacheCount(),
          playerSpriteCacheCount: getPlayerSpriteCacheCount(),
          telemetryEvents: routerCounts.telemetryEvents,
          pendingWorkerRequests: routerCounts.pendingWorkerRequests,
          audioActiveSources: audio.activeSourcesCount,
          audioContextState: audio.contextState,
        };
      },
      onCleanup: async (opts) => {
        const sim = simRef.current;
        if (sim) {
          sim.trimMemoryUsage({
            maxTimelineFrames: 120,
            maxMessagesPerConv: 120,
            maxMemoriesPerVillager: 48,
          });
        }
        const activeUrls = new Set<string>();
        const curMap = latestRef.current.map;
        if (curMap?.tileSetUrl) activeUrls.add(curMap.tileSetUrl);
        for (const v of latestRef.current.villagers) {
          if (v.customSprite?.textureUrl) activeUrls.add(v.customSprite.textureUrl);
        }
        pruneImageCache(activeUrls);
        brainRouter.clearTelemetryLog();
        if (opts?.unloadModels) {
          await brainRouter.unloadAllModels();
          await segmentationClient.unload();
          segmentationClient.terminateWorker();
        }
      },
    });
    perfMemoryTracker.captureSnapshot(true);
    const intervalId = window.setInterval(() => {
      perfMemoryTracker.captureSnapshot(true);
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [ready]);

  const downloadJson = (filename: string, raw: string) => {
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveBlob = (blob: Blob | null, name: string) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const imageName = (what: string) => `${(map?.name ?? 'world').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${what}.png`;
  /** The view on screen now (the village or the editor), as a picture. */
  const handleExportViewImage = () => {
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>('main canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!canvas) return setDataNotice('Nothing to take a picture of here.');
    canvas.toBlob((blob) => saveBlob(blob, imageName('view')), 'image/png');
    setDataNotice('Saved a picture of this view.');
  };
  /** The whole world, drawn sharp at up to three times its size, without the people. */
  const handleExportTapestry = () => {
    if (!map) return;
    const look = (aestheticSettings.worldLook === 'tiles' ? 'festive' : aestheticSettings.worldLook) as PaletteName;
    const art = createWorldArt(map, look, tileSemanticsForMap(map), undefined, simRef.current?.wellWater ?? null);
    const scale = Math.max(1, Math.min(3, 12000 / art.width, 12000 / art.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(art.width * scale);
    canvas.height = Math.round(art.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    art.drawRegion(ctx, 0, 0, art.width, art.height);
    canvas.toBlob((blob) => saveBlob(blob, imageName('tapestry')), 'image/png');
    setDataNotice(`Saved the whole tapestry (${canvas.width}×${canvas.height}).`);
  };

  const handleExportBundle = () => {
    if (!map || !settings) return;
    downloadJson(
      'seloai-project.json',
      exportProjectJson({
        map,
        villagers,
        modelSettings: settings,
        conversations: simRef.current?.conversations ?? [],
        characterHistories: simRef.current?.exportCharacterHistories() ?? {},
        focalWorldlineId: simRef.current?.focalWorldlineId ?? 'scribe',
        savedAt: Date.now(),
      }),
    );
    setDataNotice('Exported whole project (world, characters, DB, histories).');
  };

  const handleExportLevel = () => {
    if (!map) return;
    const slug = (map.name || 'level').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'level';
    downloadJson(`${slug}.seloai-level.json`, exportLevelJson(map));
    setDataNotice(`Exported level "${map.name}".`);
  };

  /** The story and cast as a Markdown file, the friendly form to share or start from. */
  const handleExportStoryMarkdown = () => {
    if (!map) return;
    const sim = simRef.current;
    const text = storyToMarkdown(sim?.world ?? GENERIC_WORLD_CONTEXT, villagers, map.name, sim?.focalWorldlineId);
    const blob = new Blob([text], { type: 'text/markdown' });
    saveBlob(blob, `${map.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story'}.story.md`);
    setDataNotice(`Exported the story and ${villagers.length} characters as Markdown.`);
  };

  const handleExportCharacters = () => {
    downloadJson('characters.seloai.json', exportCharactersJson(villagers));
    setDataNotice(`Exported ${villagers.length} characters (without histories or world).`);
  };

  const handleExportCharactersWithHistories = () => {
    const histories = simRef.current?.exportCharacterHistories() ?? {};
    downloadJson(
      'characters-with-histories.seloai.json',
      exportCharactersWithHistoriesJson(villagers, histories),
    );
    setDataNotice(`Exported ${villagers.length} characters + personal histories (portable).`);
  };

  const handleExportDatabase = () => {
    const histories = simRef.current?.exportCharacterHistories() ?? {};
    downloadJson(
      'world-database.seloai.json',
      exportDatabaseJson(
        simRef.current?.conversations ?? [],
        histories,
        simRef.current?.focalWorldlineId ?? 'scribe',
      ),
    );
    setDataNotice('Exported world database (conversations & character memories).');
  };

  const handleImportBundle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !map || !settings) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseImportedFile(file.name, String(reader.result));
        const nextMap = parsed.map ?? map;
        const nextVillagers = parsed.villagers ?? villagers;
        const nextSettings = { ...settings, ...(parsed.modelSettings ?? {}) };
        const parts: string[] = [];

        const importCommands: WorldCommand[] = [];
        if (parsed.map) {
          importCommands.push({ type: 'map.replace', map: nextMap });
          parts.push(`level "${nextMap.name}"`);
        }
        const importedContext = parsed.world ?? (parsed.map ? inferWorldContext(parsed.map) : null);
        if (importedContext) importCommands.push({ type: 'context.update', patch: importedContext });
        if (parsed.villagers) {
          importCommands.push({ type: 'cast.replace', cast: nextVillagers });
          parts.push(`${nextVillagers.length} characters`);
        }
        if (importCommands.length > 0) storeRef.current.dispatchAll(importCommands, 'Import');
        if (parsed.modelSettings) {
          setSettings(nextSettings);
          simRef.current?.updateSettings(nextSettings);
          parts.push('settings');
        }
        if (parsed.conversations) {
          simRef.current?.replaceConversations(parsed.conversations);
          parts.push(`${parsed.conversations.length} conversations`);
        }
        if (parsed.characterHistories) {
          simRef.current?.applyCharacterHistories(parsed.characterHistories);
          parts.push('character histories');
        }
        if (parsed.focalWorldlineId) {
          simRef.current?.setFocalWorldline(parsed.focalWorldlineId);
        }
        // A new story (a world without its conversations) starts afresh: greetings, then the
        // Scribe's prologue.
        if (parsed.world && !parsed.conversations) {
          simRef.current?.resetStory();
          parts.push('a fresh story');
        }
        persistAll(nextMap, nextVillagers, nextSettings);
        setDataNotice(`Imported ${parts.join(', ') || 'bundle'}.`);
      } catch (err: any) {
        setDataNotice(`Import failed: ${err?.message || String(err)}`);
        brainRouter.log({
          channel: 'storage',
          level: 'error',
          title: 'Import Failed',
          detail: err?.message || String(err),
        });
      }
    };
    reader.readAsText(file);
  };

  /** Starts the story again in the world as it is now; the old story is backed up first. */
  const handleResetStory = async () => {
    if (!map || !settings) return;
    await autoBackupCurrentWorld().catch(() => undefined);
    simRef.current?.resetStory();
    persistAll(map, villagers, settings);
    setDataNotice('Story reset: conversations, memories and the script cleared, everyone back at their starting places. The old story was saved as an auto-backup.');
  };

  const captureCurrentWorldState = (): PersistedVillageState | null => {
    const curMap = latestRef.current.map;
    const curSettings = latestRef.current.settings;
    if (!curMap || !curSettings) return null;
    return {
      map: curMap,
      villagers: latestRef.current.villagers,
      modelSettings: curSettings,
      conversations: simRef.current?.conversations ?? [],
      characterHistories: simRef.current?.exportCharacterHistories() ?? {},
      focalWorldlineId: simRef.current?.focalWorldlineId ?? 'scribe',
      world: simRef.current?.world,
      savedAt: Date.now(),
    };
  };

  const refreshSavedWorlds = async (selectId?: string) => {
    const list = await listSavedWorlds();
    setSavedWorlds(list);
    if (selectId) {
      setSelectedSavedWorldId(selectId);
    } else if (list.length > 0 && !list.some((w) => w.id === selectedSavedWorldId)) {
      setSelectedSavedWorldId(list[0].id);
    }
  };

  const autoBackupCurrentWorld = async () => {
    const cur = captureCurrentWorldState();
    if (!cur) return;
    if (cur.conversations.length > 0 || (cur.map.stamps?.length ?? 0) > 0) {
      const slot = await saveWorldToMemory(`Auto-Backup: ${cur.map.name}`, cur, 'auto-backup');
      await refreshSavedWorlds(slot.id);
    }
  };

  const handleSaveWorldToMemory = async (overwriteId?: string) => {
    const cur = captureCurrentWorldState();
    if (!cur) return;
    const chosenName =
      overwriteId
        ? savedWorlds.find((w) => w.id === overwriteId)?.name ?? cur.map.name
        : saveWorldName.trim() || `${cur.map.name} (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    const slot = await saveWorldToMemory(chosenName, cur, overwriteId);
    await refreshSavedWorlds(slot.id);
    if (!overwriteId) setSaveWorldName('');
    setDataNotice(`Saved "${slot.name}" to browser memory (${slot.width}×${slot.height}, ${slot.villagerCount} folk).`);
  };

  const handleLoadSavedWorld = (worldId: string) => {
    const target = savedWorlds.find((w) => w.id === worldId);
    if (!target) return;
    brainRouter.flushAudioQueue();
    const s = target.state;
    const nextSim = createBrowserSimulation(
      structuredClone(s.map),
      structuredClone(s.villagers),
      structuredClone(s.conversations ?? []),
      { ...s.modelSettings },
      s.world,
      { timers: 'sim' },
    );
    if (s.characterHistories) {
      nextSim.applyCharacterHistories(structuredClone(s.characterHistories));
    }
    if (s.focalWorldlineId) {
      nextSim.setFocalWorldline(s.focalWorldlineId);
    }
    simRef.current = nextSim;
    latestRef.current.map = nextSim.map;
    latestRef.current.villagers = s.villagers;
    latestRef.current.settings = s.modelSettings;
    storeRef.current.reset({
      map: nextSim.map,
      cast: structuredClone(s.villagers),
      context: nextSim.world,
    });
    setSettings({ ...s.modelSettings });
    savePersistedState({ ...s, savedAt: Date.now() });
    setSelectedSavedWorldId(target.id);
    setDataNotice(`Loaded saved world "${target.name}" from memory.`);
  };

  const handleDeleteSavedWorld = async (worldId: string) => {
    const target = savedWorlds.find((w) => w.id === worldId);
    const remaining = await deleteSavedWorld(worldId);
    setSavedWorlds(remaining);
    if (selectedSavedWorldId === worldId) {
      setSelectedSavedWorldId(remaining[0]?.id ?? '');
    }
    if (target) {
      setDataNotice(`Removed saved world "${target.name}" from memory.`);
    }
  };

  const handleNewBlankWorld = async () => {
    if (!settings) return;
    await autoBackupCurrentWorld();
    brainRouter.flushAudioQueue();
    const blankMap = createBlankWorldMap(`World ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    storeRef.current.reset({
      map: blankMap,
      cast: latestRef.current.villagers,
      context: structuredClone(GENERIC_WORLD_CONTEXT),
    });
    simRef.current?.clearDatabase();
    persistAll(blankMap, villagers, settings);
    setDataNotice('Created a new blank world and cleared the story database.');
  };

  const handleConfirmReset = async () => {
    await autoBackupCurrentWorld();
    const fresh = await resetPersistedState();
    simRef.current = createBrowserSimulation(
      fresh.map,
      fresh.villagers,
      fresh.conversations,
      fresh.modelSettings,
      fresh.world,
      { timers: 'sim' },
    );
    simRef.current.holdStory = holdStory;
    storeRef.current.reset({ map: fresh.map, cast: fresh.villagers, context: simRef.current.world });
    setSettings(fresh.modelSettings);
  };

  const handleLoadDemoWorld = async (packId: DemoWorldId) => {
    const definition = findWorldPack(packId);
    if (!definition || !settings) return;
    setSelectedDemoId(packId);
    await autoBackupCurrentWorld();
    brainRouter.flushAudioQueue();
    const pack = definition.build();
    const nextVillagers = pack.cast ?? latestRef.current.villagers;
    storeRef.current.reset({ map: pack.map, cast: nextVillagers, context: pack.context });
    const sim = simRef.current;
    sim?.clearDatabase();
    if (pack.story.focalCharacterId) sim?.setFocalWorldline(pack.story.focalCharacterId);
    if (pack.story.openingDirective && pack.story.focalCharacterId) {
      void sim?.sendUserAddressedMessage(pack.story.focalCharacterId, pack.story.openingDirective, false);
    }
    persistAll(pack.map, nextVillagers, settings);
    setTab('village');
    setDataNotice(`Loaded "${pack.name}".`);
  };

  const worldTheme = map ? resolveWorldTheme(map, simRef.current?.world) : 'classic';
  const aestheticTokens = React.useMemo(
    () => resolveAestheticTokens(aestheticSettings, worldTheme),
    [aestheticSettings, worldTheme],
  );
  const playerCustomSprite = React.useMemo(
    () =>
      map ? generateProceduralPlayerCustomSprite(aestheticSettings.player, worldTheme) : undefined,
    [map, aestheticSettings.player, worldTheme],
  );

  // In the art looks the whole shell takes its colours from the look's palette.
  const artShell = aestheticSettings.worldLook !== 'tiles';
  useEffect(() => {
    const root = document.documentElement;
    const vars = artShell ? shellVars(aestheticSettings.worldLook as PaletteName) : {};
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
    };
  }, [artShell, aestheticSettings.worldLook]);

  if (!ready || !map || !settings || !simRef.current || !playerCustomSprite) {
    return (
      <div className="flex h-full items-center justify-center bg-linen text-sm text-muted">
        Initializing SeloAI village…
      </div>
    );
  }

  const darkUi =
    theme === 'dark' ||
    (theme === 'system' &&
      (aestheticSettings.worldLook === 'night' ||
        (aestheticSettings.worldLook === 'tiles' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)));


  // Style: in the village it takes the inspector's place; elsewhere it docks on the right.
  /** World & Data: worlds, the story, saving, files and images; a side panel like Style. */
  const dataPanel = (fill: boolean) => (
    <aside
      aria-label="World and data"
      className={`flex h-full ${fill ? 'w-full' : 'w-[min(92vw,22rem)] border-l border-borderFolk'} shrink-0 flex-col overflow-hidden bg-surface text-ink`}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 thin-scroll">
        <div className="space-y-3 text-xs">
          {dataNotice && (
            <div className="rounded-sm border border-sage/50 bg-surface px-2 py-1 text-[11px] text-sage">
              {dataNotice}
            </div>
          )}

          {/* Demo Worlds Dropdown */}
          <section className="space-y-1.5 rounded-sm border border-borderFolk/80 bg-surface/60 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Demo Worlds
            </div>
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Select demo world"
                value={selectedDemoId}
                onChange={(e) => setSelectedDemoId(e.target.value as DemoWorldId)}
                className="min-w-0 flex-1 rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-xs text-ink"
              >
                {DEMO_WORLDS.map((demo) => (
                  <option key={demo.id} value={demo.id}>
                    {demo.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleLoadDemoWorld(selectedDemoId)}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-sage bg-sage px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Load Demo</span>
              </button>
            </div>
            <p className="text-[11px] text-muted">
              {DEMO_WORLDS.find((d) => d.id === selectedDemoId)?.description}
            </p>
          </section>

          {/* Saved Worlds in Browser Memory */}
          <section className="space-y-2 rounded-sm border border-borderFolk/80 bg-surface/60 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Saved Worlds in Memory ({savedWorlds.length})
              </span>
              <span className="text-[10px] text-muted">Stored locally in IndexedDB</span>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={saveWorldName}
                onChange={(e) => setSaveWorldName(e.target.value)}
                placeholder={`Save current: ${map.name}`}
                aria-label="Saved world name"
                className="min-w-0 flex-1 rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs text-ink"
              />
              <button
                type="button"
                onClick={() => void handleSaveWorldToMemory()}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-ink/30 bg-ink px-2.5 py-1 text-xs font-semibold text-linen hover:opacity-90"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save Copy</span>
              </button>
            </div>

            {savedWorlds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label="Select saved world from memory"
                  value={selectedSavedWorldId}
                  onChange={(e) => setSelectedSavedWorldId(e.target.value)}
                  className="min-w-[180px] flex-1 rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-xs text-ink"
                >
                  {savedWorlds.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.name} — {slot.width}×{slot.height} · {slot.villagerCount} folk · {new Date(slot.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => selectedSavedWorldId && handleLoadSavedWorld(selectedSavedWorldId)}
                  disabled={!selectedSavedWorldId}
                  className="inline-flex items-center gap-1 rounded-sm border border-sage/60 bg-surface px-2 py-1.5 text-xs font-semibold text-sage hover:border-sage disabled:opacity-45"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Load</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    selectedSavedWorldId && void handleSaveWorldToMemory(selectedSavedWorldId)
                  }
                  disabled={!selectedSavedWorldId}
                  title="Overwrite selected saved world with current live world"
                  className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-xs text-muted hover:text-ink disabled:opacity-45"
                >
                  Overwrite
                </button>
                <button
                  type="button"
                  onClick={() =>
                    selectedSavedWorldId && void handleDeleteSavedWorld(selectedSavedWorldId)
                  }
                  disabled={!selectedSavedWorldId}
                  title="Delete selected saved world"
                  aria-label="Delete selected saved world"
                  className="rounded-sm border border-crimson/40 bg-surface p-1.5 text-crimson hover:border-crimson disabled:opacity-45"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="text-[11px] text-muted">
                No saved worlds in memory yet — click <strong>Save Copy</strong> above to keep a snapshot.
              </div>
            )}
          </section>

          {/* Story & Blank / Reset Actions */}
          <section className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Story &amp; Clean Slate Actions
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => void handleResetStory()}
                className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">Reset story</div>
                <div className="text-[10px] text-muted">Same world and cast; start again</div>
              </button>
              <button
                type="button"
                onClick={() => void handleNewBlankWorld()}
                className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">New Blank World</div>
                <div className="text-[10px] text-muted">Empty map + clear DB</div>
              </button>
              <button
                type="button"
                onClick={() => resetDialogRef.current?.showModal()}
                className="rounded-sm border border-crimson/40 bg-surface px-2 py-1.5 text-left text-crimson hover:border-crimson"
              >
                <div className="font-semibold">Reset Defaults</div>
                <div className="text-[10px] text-muted">Zmeyovo map &amp; cast</div>
              </button>
            </div>
          </section>

          <section className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Images</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <button type="button" onClick={handleExportViewImage} className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40">
                <div className="font-semibold">This view (.png)</div>
                <div className="text-[10px] text-muted">What is on screen now, people included</div>
              </button>
              <button type="button" onClick={handleExportTapestry} className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40">
                <div className="font-semibold">Whole tapestry (.png)</div>
                <div className="text-[10px] text-muted">The whole world, sharp, at print size</div>
              </button>
            </div>
          </section>

          <section className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Export
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={handleExportStoryMarkdown}
                className="sm:col-span-2 rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">Story (.md)</div>
                <div className="text-[10px] text-muted">Premise, opening, characters and lines, easy to read and edit</div>
              </button>
              <button
                type="button"
                onClick={handleExportBundle}
                className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">Whole Project (.json)</div>
                <div className="text-[10px] text-muted">World, cast, DB &amp; settings</div>
              </button>
              <button
                type="button"
                onClick={handleExportLevel}
                className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">Level Only (.json)</div>
                <div className="text-[10px] text-muted">Map tiles, POIs &amp; stamps</div>
              </button>
              <button
                type="button"
                onClick={handleExportCharacters}
                className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">Characters Only (.json)</div>
                <div className="text-[10px] text-muted">Roster &amp; appearance</div>
              </button>
              <button
                type="button"
                onClick={handleExportCharactersWithHistories}
                className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">Characters + Histories</div>
                <div className="text-[10px] text-muted">Portable cast + memories</div>
              </button>
              <button
                type="button"
                onClick={handleExportDatabase}
                className="sm:col-span-2 rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">Database Only (.json)</div>
                <div className="text-[10px] text-muted">Conversations &amp; character memories</div>
              </button>
            </div>
          </section>

          <section className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Import (a story .md, or a project, level, cast or story pack .json)
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-dashed border-borderFolk bg-surface px-3 py-2 text-xs font-medium hover:border-ink/50">
              <Upload className="h-3.5 w-3.5" />
              <span>Choose a file to import…</span>
              <input type="file" accept=".json,.md,.markdown,application/json,text/markdown" className="sr-only" onChange={handleImportBundle} />
            </label>
          </section>
        </div>
      </div>
    </aside>
  );
  /** Opens the panel in a mode; in the village, the panel is shown if it was hidden. */
  const openPanel = (mode: PanelMode | null) => {
    if (mode === 'data') setDataNotice(null);
    setSidePanel(mode);
    if (mode && tab === 'village' && !sidebarOpen) toggleSidebarOpen();
  };
  /** The panel's modes, as tabs: Storyline (the village's own inspector), Style, World & Data. */
  const panelTabs = (inVillage: boolean) => {
    const modes: Array<[string, string, PanelMode | null]> = [
      ...(inVillage ? [['storyline', 'Storyline', null] as [string, string, null]] : []),
      ['pi', 'Spinner', 'pi'],
      ['style', 'Style', 'style'],
      ['data', 'World & Data', 'data'],
    ];
    return (
      <div role="tablist" aria-label="Panel" className="flex shrink-0 items-center gap-0.5 border-b border-borderFolk bg-surface px-1.5 py-1 text-[12px]">
        {modes.map(([id, label, mode]) => {
          const on = sidePanel === mode;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => openPanel(mode)}
              className={`rounded-sm px-2 py-0.5 ${on ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          );
        })}
        {!inVillage && (
          <button type="button" onClick={() => setSidePanel(null)} aria-label="Close the panel" className="ml-auto rounded-sm px-1.5 py-0.5 text-muted hover:text-ink">
            Close
          </button>
        )}
      </div>
    );
  };

  const sidePanelNode = (fill: boolean) => (sidePanel === 'style' ? stylePanel(fill) : sidePanel === 'data' ? dataPanel(fill) : sidePanel === 'pi' ? <PiPanel people={villagers.map((v) => v.name)} places={(map.pointsOfInterest ?? []).map((p) => p.label)} /> : null);

  const stylePanel = (fill: boolean) => (
    <AestheticStudioPanel
      settings={aestheticSettings}
      tokens={aestheticTokens}
      worldName={map.name}
      appTheme={theme}
      onChangeAppTheme={setTheme}
      onChange={handleUpdateAesthetic}
      onClose={() => setSidePanel(null)}
      fill={fill}
    />
  );

  // The app's own controls (views, the side panel, the top bar, image export), for agents and
  // scripted performances. Rebuilt every render; registered once through a stable proxy.
  appControlsRef.current = {
    state: () => ({
      tab,
      panel: tab === 'village' ? (sidebarOpen ? (sidePanel === 'pi' ? 'spinner' : sidePanel ?? 'storyline') : 'closed') : sidePanel === 'pi' ? 'spinner' : sidePanel ?? 'closed',
      topBarHidden: autoHideBar && !barOut,
    }),
    setTab: (next) => {
      const id = (next === 'level' ? 'world' : next === 'tapestry' ? 'patterns' : next) as TabId;
      if (!['village', 'observatory', 'world', 'patterns', 'characters', 'monitor', 'guides'].includes(id)) throw new Error(`Unknown view "${next}".`);
      latestRef.current.tab = id;
      setTab(id);
    },
    setPanel: (mode) => {
      if (mode === 'closed') {
        if (tab === 'village' && sidebarOpen) toggleSidebarOpen();
        if (tab !== 'village') setSidePanel(null);
        return;
      }
      if (mode === 'storyline') {
        setSidePanel(null);
        if (tab === 'village' && !sidebarOpen) toggleSidebarOpen();
        return;
      }
      openPanel(mode === 'spinner' ? 'pi' : mode);
    },
    setTopBar: (show) => {
      setBarPinned(show);
      setBarHover(false);
    },
    exportImage: (what) => (what === 'tapestry' ? handleExportTapestry() : handleExportViewImage()),
  };
  return (
    <StitchScope look={glyphLookFor(aestheticSettings.worldLook, darkUi)}>
    <div className={`relative flex h-full flex-col bg-linen text-ink overflow-hidden ${artShell ? 'look-art' : ''}`}>
      {autoHideBar && !barOut ? (
        <div aria-hidden className="absolute inset-x-0 top-0 z-40 h-1.5" onMouseEnter={() => setBarHover(true)} />
      ) : null}
      {showVoiceNudge && settings ? <VoiceNudge settings={settings} onClose={() => setShowVoiceNudge(false)} /> : null}
      <AgentOverlay />
      <header
        ref={headerRef}
        className={`relative z-30 flex items-center gap-2 border-b border-borderFolk bg-card px-2 py-1 shrink-0 ${
          autoHideBar ? 'transition-[margin] duration-200' : ''
        }`}
        style={autoHideBar && !barOut ? { marginTop: -(headerRef.current?.offsetHeight ?? 41) } : undefined}
        onMouseLeave={autoHideBar ? () => setBarHover(false) : undefined}
      >
        {/* Left: home, then the village's own controls (they render into this slot). */}
        <GlyphButton
          glyph="village"
          label="Village"
          onClick={() => setTab('village')}
          aria-current={tab === 'village' ? 'page' : undefined}
          className={tab === 'village' ? 'glyph-on' : ''}
          size={17}
        />
        <div
            title={`Current world: ${map.name} (click to switch demo or saved world)`}
            className="relative inline-flex h-7 max-w-[165px] sm:max-w-[200px] items-center gap-1 rounded-sm bg-transparent px-2 text-[11px] font-medium text-ink hover:bg-ink/5 focus-within:ring-1 focus-within:ring-sage"
          >
            <Sparkles className="pointer-events-none h-3.5 w-3.5 shrink-0 text-sage" />
            <span className="min-w-0 truncate whitespace-nowrap">
              {abbreviateWorldName(map.name, 20)}
            </span>
            <ChevronDown className="pointer-events-none h-3 w-3 shrink-0 text-muted" />
            <select
              aria-label="Switch demo or saved world"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v.startsWith('demo:')) {
                  void handleLoadDemoWorld(v.slice(5) as DemoWorldId);
                } else if (v.startsWith('saved:')) {
                  handleLoadSavedWorld(v.slice(6));
                } else if (v === 'action:save-current') {
                  setDataNotice(null);
                  setSaveWorldName(map.name);
                  setSidePanel('data');
                }
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              <option value="" disabled>
                Current: {map.name}
              </option>
              <optgroup label="Demo Worlds">
                {DEMO_WORLDS.map((demo) => (
                  <option key={demo.id} value={`demo:${demo.id}`}>
                    {demo.label}
                  </option>
                ))}
              </optgroup>
              {savedWorlds.length > 0 && (
                <optgroup label="Saved Worlds (Memory)">
                  {savedWorlds.map((slot) => (
                    <option key={slot.id} value={`saved:${slot.id}`}>
                      {slot.name} ({slot.width}×{slot.height})
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="action:save-current">+ Save Current World to Memory…</option>
            </select>
          </div>
        <div ref={setToolbarSlot} className="flex min-w-0 flex-1 items-center" />
        {/* Right, over the panel: the other views, undo and redo, and the panel toggle. */}
        <div
          className="flex shrink-0 items-center justify-between gap-1"
          style={tab === 'village' && panelWidth ? { minWidth: panelWidth } : tab !== 'village' && sidePanel ? { minWidth: 'min(92vw, 22rem)' } : undefined}
        >
        <nav aria-label="Workspace Views" className="flex shrink-0 items-center gap-1">
          {(
            [
              ['observatory', 'Control Room', 'observatory'],
              ['world', 'World Editor', 'world'],
              ['patterns', 'Pattern Studio', 'tapestry'],
              ['characters', 'Characters', 'characters'],
              ['monitor', 'AI & Voice Monitor', 'monitor'],
              ['guides', 'Guides & Templates', 'guides'],
            ] as const
          ).map(([id, label, glyph]) => {
            const active = tab === id;
            const tabBtn = (
              <GlyphButton
                key={id}
                glyph={glyph}
                label={label}
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                className={active ? 'glyph-on' : ''}
                size={17}
              >
                {id === 'monitor' && (
                  <span className="flex flex-col items-center gap-0.5" aria-hidden="true">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        textStatus.status === 'ready' ? 'bg-sage' : 'bg-borderFolk'
                      }`}
                    />
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        omniStatus.status === 'ready' ? 'bg-sage' : 'bg-borderFolk'
                      }`}
                    />
                  </span>
                )}
              </GlyphButton>
            );

            return tabBtn;
          })}
        </nav>

        {/* Global Utilities */}
        <div className="flex shrink-0 items-center gap-1">

          <GlyphButton glyph="undo" label="Undo world edit" tipSide="below-left" onClick={handleUndoWorld} disabled={!storeRef.current.canUndo} />

          <GlyphButton glyph="redo" label="Redo world edit" tipSide="below-left" onClick={handleRedoWorld} disabled={!storeRef.current.canRedo} />

          <GlyphButton
            glyph="panel"
            label={(tab === 'village' ? sidebarOpen : Boolean(sidePanel)) ? 'Hide the side panel (\\)' : 'Show the side panel (\\)'}
            tipSide="below-left"
            onClick={() => togglePanelRef.current()}
            pressed={tab === 'village' ? sidebarOpen : Boolean(sidePanel)}
          />
        </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
      <main className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
        {tab === 'village' && (
          <VillageView
            sim={simRef.current}
            villagers={villagers}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onOpenMonitor={() => setTab('monitor')}
            aestheticSettings={aestheticSettings}
            onUpdateAesthetic={handleUpdateAesthetic}
            sidebarOpen={sidebarOpen}
            sidebarSwap={sidePanel ? sidePanelNode(true) : undefined}
            onAskSpinner={(text) => {
              openPanel('pi');
              piSession.ask(text);
            }}
            panelTabs={panelTabs(true)}
            toolbarSlot={toolbarSlot}
            onPanelWidth={setPanelWidth}
            onResetStory={() => void handleResetStory()}
          />
        )}
        {tab === 'observatory' && (
          <ObservatoryView
            sim={simRef.current}
            look={(aestheticSettings.worldLook === 'tiles' ? 'festive' : aestheticSettings.worldLook) as PaletteName}
            villagers={villagers}
            settings={settings}
            onJumpToVillage={(villagerId) => {
              if (villagerId) simRef.current?.setFocalWorldline(villagerId);
              setTab('village');
            }}
          />
        )}
        {tab === 'patterns' && (
          <PatternStudioView look={(aestheticSettings.worldLook === 'tiles' ? 'festive' : aestheticSettings.worldLook) as PaletteName} />
        )}
        {tab === 'world' && (
          <WorldEditorView
            map={map}
            look={(aestheticSettings.worldLook === 'tiles' ? 'festive' : aestheticSettings.worldLook) as PaletteName}
            dispatch={handleWorldCommand}
            canUndo={storeRef.current.canUndo}
            canRedo={storeRef.current.canRedo}
            onUndo={handleUndoWorld}
            onRedo={handleRedoWorld}
          />
        )}
        {tab === 'characters' && (
          <CharacterEditorView
            villagers={villagers}
            map={map}
            settings={settings}
            onApplyVillagers={handleApplyVillagers}
            onUpdateSettings={handleUpdateSettings}
            worldLook={aestheticSettings.worldLook}
            figureTurns={aestheticSettings.figureTurns}
            figureQuirks={aestheticSettings.figureQuirks}
          />
        )}
        {tab === 'monitor' && (
          <MonitorView
            sim={simRef.current}
            villagers={villagers}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}
        {tab === 'guides' && <AssetGuideView />}
      </main>
      {/* Style docks on the right beside whatever view is open, so changes show as they are made. */}
      {sidePanel && tab !== 'village' && (
        <div className="flex h-full w-[min(92vw,22rem)] shrink-0 flex-col overflow-hidden border-l border-borderFolk bg-surface">
          {panelTabs(false)}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{sidePanelNode(true)}</div>
        </div>
      )}
      </div>


      {/* Native Accessible Modal Dialog for Reset Confirmation */}
      <dialog
        ref={resetDialogRef}
        aria-labelledby="reset-dialog-title"
        className="max-w-sm rounded-sm border border-borderFolk bg-card p-3.5 text-ink"
        onClose={(e) => {
          const dlg = e.currentTarget;
          if (dlg.returnValue === 'reset') {
            handleConfirmReset();
          }
          dlg.returnValue = '';
        }}
      >
        <h2 id="reset-dialog-title" className="text-base font-bold">
          Reset Village to Defaults?
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          This restores the default Zmeyovo map and cast, and clears locally saved
          conversations in IndexedDB. Loaded WebGPU models stay in memory.
        </p>
        <form method="dialog" className="mt-4 flex justify-end gap-2">
          <button
            value="cancel"
            autoFocus
            className="rounded border border-borderFolk bg-surface px-3 py-1.5 text-xs font-medium"
          >
            Cancel
          </button>
          <button
            value="reset"
            className="rounded bg-crimson px-3 py-1.5 text-xs font-semibold text-white"
          >
            Reset Village
          </button>
        </form>
      </dialog>
    </div>
    </StitchScope>
  );
}

export default App;
