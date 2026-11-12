import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
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
import { AssetGuideView } from './components/AssetGuideView';
import { CharacterEditorView } from './components/CharacterEditorView';
import { LevelEditorView } from './components/LevelEditorView';
import { MonitorView } from './components/MonitorView';
import { ObservatoryView } from './components/ObservatoryView';
import { VillageView } from './components/VillageView';
import { VillageSimulation } from './engine/simulation';
import type { ModelProgress, ModelSettings, VillageMap, VillagerConfig } from './engine/types';
import {
  exportVillageJson,
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

  const simRef = useRef<VillageSimulation | null>(null);
  const resetDialogRef = useRef<HTMLDialogElement | null>(null);

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
      setMap(persisted.map);
      setVillagers(persisted.villagers);
      setSettings(persisted.modelSettings);
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
      savedAt: Date.now(),
    });
  };

  const handleApplyMap = (nextMap: VillageMap) => {
    setMap(nextMap);
    simRef.current?.updateMap(nextMap);
    if (settings) persistAll(nextMap, villagers, settings);
    brainRouter.log({
      channel: 'storage',
      level: 'info',
      title: 'Map Updated',
      detail: `Applied "${nextMap.name}" (${nextMap.width}×${nextMap.height}) to live village.`,
    });
  };

  const handleApplyVillagers = (nextVillagers: VillagerConfig[]) => {
    setVillagers(nextVillagers);
    simRef.current?.syncVillagers(nextVillagers);
    if (map && settings) persistAll(map, nextVillagers, settings);
    brainRouter.log({
      channel: 'storage',
      level: 'info',
      title: 'Roster Updated',
      detail: `Synced ${nextVillagers.length} villagers to live simulation.`,
    });
  };

  const handleUpdateSettings = (patch: Partial<ModelSettings>) => {
    if (!settings || !map) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    simRef.current?.updateSettings(next);
    persistAll(map, villagers, next);
  };

  const handleExportBundle = () => {
    if (!map || !settings) return;
    const raw = exportVillageJson({
      map,
      villagers,
      modelSettings: settings,
      conversations: simRef.current?.conversations ?? [],
      savedAt: Date.now(),
    });
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seloai-village-bundle.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBundle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !map || !settings) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseImportedVillageJson(String(reader.result));
        const nextMap = parsed.map ?? map;
        const nextVillagers = parsed.villagers ?? villagers;
        const nextSettings = { ...settings, ...(parsed.modelSettings ?? {}) };
        setMap(nextMap);
        setVillagers(nextVillagers);
        setSettings(nextSettings);
        simRef.current?.updateMap(nextMap);
        simRef.current?.syncVillagers(nextVillagers);
        simRef.current?.updateSettings(nextSettings);
        persistAll(nextMap, nextVillagers, nextSettings);
      } catch (err: any) {
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
      <div className="rushnyk-ribbon shrink-0" aria-hidden="true" />

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-borderFolk bg-card px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-crimson bg-crimson text-xs font-bold text-white"
              aria-hidden="true"
            >
              S
            </span>
            <div>
              <span className="font-display text-base tracking-wide">SELO.AI</span>
              <span className="ml-2 hidden sm:inline text-[11px] text-muted">
                Local WebGPU Village · LFM3-1.7B + LFM3-Omni-2B
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
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
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-crimson text-white shadow-sm'
                    : 'text-ink hover:bg-surface'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
                {id === 'monitor' && (
                  <span className="ml-1 flex items-center gap-1" aria-hidden="true">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        textStatus.status === 'ready' ? 'bg-sage' : 'bg-borderFolk'
                      }`}
                    />
                    <span
                      className={`h-2 w-2 rounded-full ${
                        omniStatus.status === 'ready' ? 'bg-sage' : 'bg-borderFolk'
                      }`}
                    />
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Global Utilities */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportBundle}
            className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs hover:bg-card"
            aria-label="Export village JSON"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Export</span>
          </button>

          <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs hover:bg-card">
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Import</span>
            <input type="file" accept="application/json" className="sr-only" onChange={handleImportBundle} />
          </label>

          <button
            type="button"
            onClick={() => resetDialogRef.current?.showModal()}
            className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs hover:bg-card"
            aria-label="Reset village to defaults"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() =>
              setTheme((t) => (t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system'))
            }
            className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2 py-1 text-xs hover:bg-card"
            aria-label={`Theme: ${theme}. Click to switch.`}
          >
            {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            <span className="hidden xl:inline capitalize">{theme}</span>
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

      {/* Native Accessible Modal Dialog for Reset Confirmation */}
      <dialog
        ref={resetDialogRef}
        aria-labelledby="reset-dialog-title"
        className="max-w-sm rounded-lg p-5 shadow-2xl"
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
