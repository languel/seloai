import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  ChevronDown,
  Database,
  Download,
  FolderOpen,
  Map as MapIcon,
  Network,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Trees,
} from 'lucide-react';
import { bonsaiEngine } from './ai/bonsaiEngine';
import { brainRouter } from './ai/brainRouter';
import { minicpmEngine } from './ai/minicpmEngine';
import { resolveStartupAutoLoadCandidate } from './ai/modelCache';
import { omniEngine } from './ai/omniEngine';
import { seloToolHost, type WorkspaceTabId } from './api/seloToolRegistry';
import { installSeloWebMcpAndApi } from './api/webMcpBridge';
import { abbreviateWorldName } from './utils/formatNames';
import {
  detectWorldTheme,
  loadAestheticSettings,
  resolveAestheticTokens,
  saveAestheticSettings,
  type AestheticSettings,
} from './utils/aestheticThemes';
import { AestheticStudioPanel } from './components/AestheticStudioPanel';
import { AssetGuideView } from './components/AssetGuideView';
import { CharacterEditorView } from './components/CharacterEditorView';
import { LevelEditorView } from './components/LevelEditorView';
import { MonitorView } from './components/MonitorView';
import { ObservatoryView } from './components/ObservatoryView';
import { TapestryStudioView } from './components/TapestryStudioView';
import { VillageView } from './components/VillageView';
import { generateProceduralPlayerCustomSprite } from './engine/playerSpriteGenerator';
import { VillageSimulation } from './engine/simulation';
import type { ModelProgress, ModelSettings, VillageMap, VillagerConfig } from './engine/types';
import {
  createBalkanMythWorld,
  createBlankWorldMap,
  createBulgarianShevitsaMap,
  deleteSavedWorld,
  exportCharactersJson,
  exportCharactersWithHistoriesJson,
  exportDatabaseJson,
  exportLevelJson,
  exportProjectJson,
  listSavedWorlds,
  loadPersistedState,
  parseImportedVillageJson,
  resetPersistedState,
  savePersistedState,
  saveWorldToMemory,
  type PersistedVillageState,
  type SavedWorldSlot,
} from './storage/villageStore';

type DemoWorldId = 'balkan-myth' | 'shevitsa' | 'starter';

const DEMO_WORLDS: Array<{ id: DemoWorldId; label: string; description: string }> = [
  {
    id: 'balkan-myth',
    label: 'Zmeyovo: Well of the Lamia',
    description: '48×36 Balkan myth map, 6 embroidered characters, Wang brook & Lamia sacrifice lore',
  },
  {
    id: 'shevitsa',
    label: 'Шевици: Embroidered Bulgaria',
    description: '44×32 regional Shevitsa motifs (Elbetitsa, Kanatitsa, Tree of Life) & POIs',
  },
  {
    id: 'starter',
    label: 'SeloAI Starter Village',
    description: 'Classic SeloAI starter meadow village, plaza, cottage & default cast',
  },
];

type TabId = 'village' | 'observatory' | 'level' | 'tapestry' | 'characters' | 'monitor' | 'guides';

export function App() {
  const [tab, setTab] = useState<TabId>('village');
  const [ready, setReady] = useState(false);
  const [map, setMap] = useState<VillageMap | null>(null);
  const [villagers, setVillagers] = useState<VillagerConfig[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
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
  const [selectedDemoId, setSelectedDemoId] = useState<DemoWorldId>('balkan-myth');
  const [selectedSavedWorldId, setSelectedSavedWorldId] = useState<string>('');
  const [saveWorldName, setSaveWorldName] = useState<string>('');

  const simRef = useRef<VillageSimulation | null>(null);
  const resetDialogRef = useRef<HTMLDialogElement | null>(null);
  const dataDialogRef = useRef<HTMLDialogElement | null>(null);
  const autoLoadAttemptedRef = useRef(false);
  const latestRef = useRef<{
    tab: WorkspaceTabId;
    map: VillageMap | null;
    villagers: VillagerConfig[];
    settings: ModelSettings | null;
  }>({ tab, map, villagers, settings });
  latestRef.current = { tab, map, villagers, settings };

  const handleUpdateAesthetic = (next: AestheticSettings) => {
    setAestheticSettings(next);
    saveAestheticSettings(next);
  };

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

  useEffect(() => {
    const u1 = brainRouter.subscribeTextStatus(setTextStatus);
    const u2 = omniEngine.subscribe(setOmniStatus);
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadPersistedState(), listSavedWorlds()]).then(([persisted, saved]) => {
      if (!mounted) return;
      simRef.current = new VillageSimulation(
        persisted.map,
        persisted.villagers,
        persisted.conversations,
        persisted.modelSettings,
      );
      if (persisted.characterHistories) {
        simRef.current.applyCharacterHistories(persisted.characterHistories);
      }
      if (persisted.focalWorldlineId) {
        simRef.current.setFocalWorldline(persisted.focalWorldlineId);
      }
      setMap(persisted.map);
      setVillagers(persisted.villagers);
      setSettings(persisted.modelSettings);
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
      savedAt: Date.now(),
    });
  };

  const handleApplyMap = (nextMap: VillageMap) => {
    latestRef.current.map = nextMap;
    setMap(nextMap);
    simRef.current?.updateMap(nextMap);
    const curVillagers = latestRef.current.villagers;
    const curSettings = latestRef.current.settings;
    if (curSettings) persistAll(nextMap, curVillagers, curSettings);
    brainRouter.log({
      channel: 'storage',
      level: 'info',
      title: 'Map Updated',
      detail: `Applied "${nextMap.name}" (${nextMap.width}×${nextMap.height}) to live village.`,
    });
  };

  const handleApplyVillagers = (nextVillagers: VillagerConfig[]) => {
    latestRef.current.villagers = nextVillagers;
    setVillagers(nextVillagers);
    simRef.current?.syncVillagers(nextVillagers);
    const curMap = latestRef.current.map;
    const curSettings = latestRef.current.settings;
    if (curMap && curSettings) persistAll(curMap, nextVillagers, curSettings);
    brainRouter.log({
      channel: 'storage',
      level: 'info',
      title: 'Roster Updated',
      detail: `Synced ${nextVillagers.length} villagers to live simulation.`,
    });
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
    seloToolHost.setHooks({
      getSimulation: () => simRef.current!,
      getMap: () => latestRef.current.map!,
      getVillagers: () => latestRef.current.villagers,
      getSettings: () => latestRef.current.settings!,
      getTab: () => latestRef.current.tab,
      setTab: (nextTab) => {
        latestRef.current.tab = nextTab;
        setTab(nextTab);
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
      if (cancelled || !candidate) return;
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

  const downloadJson = (filename: string, raw: string) => {
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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
        const parsed = parseImportedVillageJson(String(reader.result));
        const nextMap = parsed.map ?? map;
        const nextVillagers = parsed.villagers ?? villagers;
        const nextSettings = { ...settings, ...(parsed.modelSettings ?? {}) };
        const parts: string[] = [];

        if (parsed.map) {
          setMap(nextMap);
          simRef.current?.updateMap(nextMap);
          parts.push(`level "${nextMap.name}"`);
        }
        if (parsed.villagers) {
          setVillagers(nextVillagers);
          simRef.current?.syncVillagers(nextVillagers);
          parts.push(`${nextVillagers.length} characters`);
        }
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

  const handleNewStoryClearDb = () => {
    if (!map || !settings) return;
    brainRouter.flushAudioQueue();
    simRef.current?.clearDatabase();
    persistAll(map, villagers, settings);
    setDataNotice('Started a fresh story (cleared conversations & character memories).');
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
    const nextSim = new VillageSimulation(
      structuredClone(s.map),
      structuredClone(s.villagers),
      structuredClone(s.conversations ?? []),
      { ...s.modelSettings },
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
    setMap(nextSim.map);
    setVillagers(structuredClone(s.villagers));
    setSettings({ ...s.modelSettings });
    savePersistedState({ ...s, savedAt: Date.now() });
    setSelectedSavedWorldId(target.id);
    dataDialogRef.current?.close();
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
    setMap(blankMap);
    simRef.current?.updateMap(blankMap);
    simRef.current?.clearDatabase();
    persistAll(blankMap, villagers, settings);
    setDataNotice('Created a new blank world and cleared the story database.');
  };

  const handleLoadShevitsaRealm = async () => {
    if (!settings) return;
    await autoBackupCurrentWorld();
    brainRouter.flushAudioQueue();
    const shevitsaMap = createBulgarianShevitsaMap();
    setMap(shevitsaMap);
    simRef.current?.updateMap(shevitsaMap);
    simRef.current?.clearDatabase();
    persistAll(shevitsaMap, villagers, settings);
    dataDialogRef.current?.close();
    setDataNotice('Loaded "Шевици: The Embroidered Realm of Bulgaria" with regional embroidery motifs & POIs.');
  };

  const handleLoadBalkanMythWorld = async () => {
    if (!settings) return;
    await autoBackupCurrentWorld();
    brainRouter.flushAudioQueue();
    const balkan = createBalkanMythWorld();
    latestRef.current.map = balkan.map;
    latestRef.current.villagers = balkan.villagers;
    setMap(balkan.map);
    setVillagers(balkan.villagers);
    simRef.current?.updateMap(balkan.map);
    simRef.current?.syncVillagers(balkan.villagers);
    simRef.current?.clearDatabase();
    simRef.current?.setFocalWorldline('lamia');
    void simRef.current?.sendUserAddressedMessage('lamia', balkan.openingDirective, false);
    persistAll(balkan.map, balkan.villagers, settings);
    dataDialogRef.current?.close();
    setTab('village');
    setDataNotice('Loaded "Zmeyovo: Well of the Lamia" — Balkan embroidery village & myth cast.');
  };

  const handleConfirmReset = async () => {
    await autoBackupCurrentWorld();
    const fresh = await resetPersistedState();
    simRef.current = new VillageSimulation(
      fresh.map,
      fresh.villagers,
      fresh.conversations,
      fresh.modelSettings,
    );
    setMap(fresh.map);
    setVillagers(fresh.villagers);
    setSettings(fresh.modelSettings);
  };

  const handleLoadDemoWorld = async (demoId: DemoWorldId) => {
    setSelectedDemoId(demoId);
    if (demoId === 'balkan-myth') {
      await handleLoadBalkanMythWorld();
    } else if (demoId === 'shevitsa') {
      await handleLoadShevitsaRealm();
    } else {
      await handleConfirmReset();
      dataDialogRef.current?.close();
      setDataNotice('Loaded "SeloAI Starter Village" demo.');
    }
  };

  if (!ready || !map || !settings || !simRef.current) {
    return (
      <div className="flex h-full items-center justify-center bg-linen text-sm text-muted">
        Initializing SeloAI village…
      </div>
    );
  }

  const worldTheme = detectWorldTheme(map);
  const aestheticTokens = resolveAestheticTokens(aestheticSettings, worldTheme);
  const playerCustomSprite = generateProceduralPlayerCustomSprite(
    aestheticSettings.player,
    worldTheme,
  );

  return (
    <div className="flex h-full flex-col bg-linen text-ink overflow-hidden">
      <header className="relative z-30 flex items-center justify-between gap-2 border-b border-borderFolk bg-card px-2 py-1 shrink-0">
        {/* Navigation Tabs (glyph-only with hover labels) */}
        <nav aria-label="Workspace Views" className="flex items-center gap-1">
          {(
            [
              ['village', 'Village', Trees],
              ['observatory', 'Control Room', Network],
              ['level', 'Level Editor', MapIcon],
              ['tapestry', 'Tapestry Studio', Palette],
              ['characters', 'Characters', Users],
              ['monitor', 'AI & Voice Monitor', Activity],
              ['guides', 'Guides & Templates', BookOpen],
            ] as const
          ).map(([id, label, Icon]) => {
            const active = tab === id;
            const tabBtn = (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                title={label}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`group relative inline-flex h-7 items-center justify-center gap-1 rounded-sm px-2 text-xs transition ${
                  active
                    ? 'border border-ink/40 bg-surface text-ink font-semibold'
                    : 'border border-transparent text-muted hover:bg-surface hover:text-ink'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {id === 'monitor' && (
                  <span className="flex items-center gap-0.5" aria-hidden="true">
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
                <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-sm border border-borderFolk bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100">
                  {label}
                </span>
              </button>
            );

            if (id === 'guides') {
              return (
                <React.Fragment key={id}>
                  <button
                    type="button"
                    onClick={() => setStylePanelOpen((o) => !o)}
                    aria-pressed={stylePanelOpen}
                    title="Style, Theme & Player Appearance"
                    aria-label="Style, Theme & Player Appearance"
                    className={`group relative inline-flex h-7 items-center justify-center gap-1 rounded-sm px-2 text-xs transition ${
                      stylePanelOpen
                        ? 'border border-ink/40 bg-surface text-ink font-semibold'
                        : 'border border-transparent text-muted hover:bg-surface hover:text-ink'
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-sm border border-borderFolk bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100">
                      Style &amp; Theme
                    </span>
                  </button>
                  {tabBtn}
                </React.Fragment>
              );
            }

            return tabBtn;
          })}
        </nav>

        {/* Global Utilities */}
        <div className="flex items-center gap-1">
          <div
            title={`Current world: ${map.name} (click to switch demo or saved world)`}
            className="relative inline-flex h-7 max-w-[165px] sm:max-w-[200px] items-center gap-1 rounded-sm border border-sage/45 bg-surface px-2 text-[11px] font-medium text-ink hover:bg-card focus-within:ring-1 focus-within:ring-sage"
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
                  dataDialogRef.current?.showModal();
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

          <button
            type="button"
            onClick={() => {
              setDataNotice(null);
              dataDialogRef.current?.showModal();
            }}
            title="New World / Story, Export & Database"
            aria-label="New World / Story, Export & Database"
            className="group relative inline-flex h-7 w-7 items-center justify-center rounded-sm border border-borderFolk bg-surface text-muted hover:bg-card hover:text-ink"
          >
            <Database className="h-3.5 w-3.5" />
            <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-sm border border-borderFolk bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100">
              World &amp; Data
            </span>
          </button>

          <button
            type="button"
            onClick={handleExportBundle}
            title="Export whole project JSON"
            aria-label="Export whole project JSON"
            className="group relative inline-flex h-7 w-7 items-center justify-center rounded-sm border border-borderFolk bg-surface text-muted hover:bg-card hover:text-ink"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-sm border border-borderFolk bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100">
              Export Project
            </span>
          </button>

          <label
            title="Import village JSON"
            aria-label="Import village JSON"
            className="group relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm border border-borderFolk bg-surface text-muted hover:bg-card hover:text-ink"
          >
            <Upload className="h-3.5 w-3.5" />
            <input type="file" accept="application/json" className="sr-only" onChange={handleImportBundle} />
            <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-sm border border-borderFolk bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100">
              Import JSON
            </span>
          </label>

          <button
            type="button"
            onClick={() => resetDialogRef.current?.showModal()}
            title="Reset village to defaults"
            aria-label="Reset village to defaults"
            className="group relative inline-flex h-7 w-7 items-center justify-center rounded-sm border border-borderFolk bg-surface text-muted hover:bg-card hover:text-crimson"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-sm border border-borderFolk bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100">
              Reset Defaults
            </span>
          </button>

          <button
            type="button"
            onClick={toggleSidebarOpen}
            aria-pressed={!sidebarOpen}
            title={sidebarOpen ? 'Hide Inspector Panel' : 'Show Inspector Panel'}
            aria-label={sidebarOpen ? 'Hide Inspector Panel' : 'Show Inspector Panel'}
            className={`group relative inline-flex h-7 w-7 items-center justify-center rounded-sm border bg-surface transition hover:bg-card hover:text-ink ${
              sidebarOpen
                ? 'border-borderFolk text-muted'
                : 'border-ink/40 text-ink font-semibold'
            }`}
          >
            {sidebarOpen ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
            <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-sm border border-borderFolk bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100">
              {sidebarOpen ? 'Hide Panel' : 'Show Panel'}
            </span>
          </button>
        </div>
      </header>

      <main className="relative flex-1 min-h-0 overflow-hidden">
        {stylePanelOpen && (
          <AestheticStudioPanel
            settings={aestheticSettings}
            tokens={aestheticTokens}
            playerSprite={playerCustomSprite}
            worldName={map.name}
            appTheme={theme}
            onChangeAppTheme={setTheme}
            onChange={handleUpdateAesthetic}
            onClose={() => setStylePanelOpen(false)}
          />
        )}
        {tab === 'village' && (
          <VillageView
            sim={simRef.current}
            villagers={villagers}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onOpenMonitor={() => setTab('monitor')}
            aestheticSettings={aestheticSettings}
            sidebarOpen={sidebarOpen}
          />
        )}
        {tab === 'observatory' && (
          <ObservatoryView
            sim={simRef.current}
            villagers={villagers}
            settings={settings}
            onJumpToVillage={(villagerId) => {
              if (villagerId) simRef.current?.setFocalWorldline(villagerId);
              setTab('village');
            }}
          />
        )}
        {tab === 'level' && (
          <LevelEditorView
            map={map}
            onApplyMap={handleApplyMap}
            onOpenTapestryStudio={() => setTab('tapestry')}
          />
        )}
        {tab === 'tapestry' && (
          <TapestryStudioView
            map={map}
            onApplyMap={handleApplyMap}
            onOpenLevelEditor={() => setTab('level')}
          />
        )}
        {tab === 'characters' && (
          <CharacterEditorView
            villagers={villagers}
            map={map}
            settings={settings}
            onApplyVillagers={handleApplyVillagers}
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

      {/* World, Story & Data Management Modal */}
      <dialog
        ref={dataDialogRef}
        aria-labelledby="data-dialog-title"
        className="w-full max-w-lg rounded-sm border border-borderFolk bg-card p-3.5 text-ink"
      >
        <div className="flex items-center justify-between gap-2 border-b border-borderFolk pb-2">
          <h2 id="data-dialog-title" className="text-sm font-bold">
            World, Story &amp; Data
          </h2>
          <form method="dialog">
            <button
              value="close"
              className="rounded-sm border border-borderFolk bg-surface px-2 py-0.5 text-xs text-muted hover:text-ink"
            >
              Close
            </button>
          </form>
        </div>

        <div className="mt-2.5 space-y-3 text-xs">
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
                onClick={handleNewStoryClearDb}
                className="rounded-sm border border-borderFolk bg-surface px-2 py-1.5 text-left hover:border-ink/40"
              >
                <div className="font-semibold">New Story</div>
                <div className="text-[10px] text-muted">Clear DB &amp; memories</div>
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
                onClick={() => {
                  dataDialogRef.current?.close();
                  resetDialogRef.current?.showModal();
                }}
                className="rounded-sm border border-crimson/40 bg-surface px-2 py-1.5 text-left text-crimson hover:border-crimson"
              >
                <div className="font-semibold">Reset Defaults</div>
                <div className="text-[10px] text-muted">Starter map &amp; cast</div>
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
              Import (Auto-detects Project, Level, Cast, Histories, or DB)
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-dashed border-borderFolk bg-surface px-3 py-2 text-xs font-medium hover:border-ink/50">
              <Upload className="h-3.5 w-3.5" />
              <span>Choose JSON File to Import…</span>
              <input type="file" accept="application/json" className="sr-only" onChange={handleImportBundle} />
            </label>
          </section>
        </div>
      </dialog>

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
          This restores the default placeholder map, starter villagers, and clears locally saved
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
  );
}

export default App;
