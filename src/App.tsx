import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Database,
  Download,
  Map as MapIcon,
  Moon,
  Network,
  RotateCcw,
  Sun,
  Upload,
  Users,
  Trees,
} from 'lucide-react';
import { brainRouter } from './ai/brainRouter';
import { omniEngine } from './ai/omniEngine';
import { seloToolHost, type WorkspaceTabId } from './api/seloToolRegistry';
import { installSeloWebMcpAndApi } from './api/webMcpBridge';
import { AssetGuideView } from './components/AssetGuideView';
import { CharacterEditorView } from './components/CharacterEditorView';
import { LevelEditorView } from './components/LevelEditorView';
import { MonitorView } from './components/MonitorView';
import { ObservatoryView } from './components/ObservatoryView';
import { VillageView } from './components/VillageView';
import { VillageSimulation } from './engine/simulation';
import type { ModelProgress, ModelSettings, VillageMap, VillagerConfig } from './engine/types';
import {
  createBlankWorldMap,
  exportCharactersJson,
  exportCharactersWithHistoriesJson,
  exportDatabaseJson,
  exportLevelJson,
  exportProjectJson,
  loadPersistedState,
  parseImportedVillageJson,
  resetPersistedState,
  savePersistedState,
} from './storage/villageStore';

type TabId = 'village' | 'observatory' | 'level' | 'characters' | 'monitor' | 'guides';

export function App() {
  const [tab, setTab] = useState<TabId>('village');
  const [ready, setReady] = useState(false);
  const [map, setMap] = useState<VillageMap | null>(null);
  const [villagers, setVillagers] = useState<VillagerConfig[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [textStatus, setTextStatus] = useState<ModelProgress>(brainRouter.textProgress);
  const [omniStatus, setOmniStatus] = useState<ModelProgress>(omniEngine.progress);
  const [dataNotice, setDataNotice] = useState<string | null>(null);

  const simRef = useRef<VillageSimulation | null>(null);
  const resetDialogRef = useRef<HTMLDialogElement | null>(null);
  const dataDialogRef = useRef<HTMLDialogElement | null>(null);
  const latestRef = useRef<{
    tab: WorkspaceTabId;
    map: VillageMap | null;
    villagers: VillagerConfig[];
    settings: ModelSettings | null;
  }>({ tab, map, villagers, settings });
  latestRef.current = { tab, map, villagers, settings };

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
    loadPersistedState().then((persisted) => {
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

  const handleNewBlankWorld = () => {
    if (!settings) return;
    brainRouter.flushAudioQueue();
    const blankMap = createBlankWorldMap(`World ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    setMap(blankMap);
    simRef.current?.updateMap(blankMap);
    simRef.current?.clearDatabase();
    persistAll(blankMap, villagers, settings);
    setDataNotice('Created a new blank world and cleared the story database.');
  };

  const handleConfirmReset = async () => {
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

  if (!ready || !map || !settings || !simRef.current) {
    return (
      <div className="flex h-full items-center justify-center bg-linen text-sm text-muted">
        Initializing SeloAI village…
      </div>
    );
  }

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
              ['characters', 'Characters', Users],
              ['monitor', 'AI & Voice Monitor', Activity],
              ['guides', 'Guides & Templates', BookOpen],
            ] as const
          ).map(([id, label, Icon]) => {
            const active = tab === id;
            return (
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
          })}
        </nav>

        {/* Global Utilities (glyph-only with hover labels) */}
        <div className="flex items-center gap-1">
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
            onClick={() =>
              setTheme((t) => (t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system'))
            }
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}. Click to switch.`}
            className="group relative inline-flex h-7 w-7 items-center justify-center rounded-sm border border-borderFolk bg-surface text-muted hover:bg-card hover:text-ink"
          >
            {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-sm border border-borderFolk bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink capitalize opacity-0 transition-opacity group-hover:opacity-100">
              Theme: {theme}
            </span>
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        {tab === 'village' && (
          <VillageView
            sim={simRef.current}
            villagers={villagers}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onOpenMonitor={() => setTab('monitor')}
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
        {tab === 'level' && <LevelEditorView map={map} onApplyMap={handleApplyMap} />}
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
        className="w-full max-w-md rounded-sm border border-borderFolk bg-card p-3.5 text-ink"
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

          <section className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              New World / Story &amp; Database
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
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
                onClick={handleNewBlankWorld}
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
