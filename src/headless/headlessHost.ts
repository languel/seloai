import { seloToolHost, type WorkspaceTabId } from '../api/seloToolRegistry';
import { DEFAULT_MODEL_SETTINGS } from '../data/defaultData';
import { VillageSimulation } from '../engine/simulation';
import type { ModelSettings } from '../engine/types';
import { DEFAULT_WORLD_PACK_ID, findWorldPack } from '../world/packs';
import { WorldStore } from '../world/worldStore';
import { createSilentMind } from './silentMind';

export interface HeadlessHost {
  sim: VillageSimulation;
  store: WorldStore;
  /** Stops advancing the world. */
  stop: () => void;
}

/**
 * Runs the real engine with no browser and connects the agent tools to it: the same
 * simulation, world store and tool implementations the app uses, minus rendering and audio.
 */
export function startHeadlessHost(options: { packId?: string; tickMs?: number } = {}): HeadlessHost {
  const pack = (findWorldPack(options.packId ?? DEFAULT_WORLD_PACK_ID) ?? findWorldPack(DEFAULT_WORLD_PACK_ID)!).build();
  let settings: ModelSettings = {
    ...DEFAULT_MODEL_SETTINGS,
    enableOmniTts: false,
    enableWebSpeechFallback: false,
    ambientAudioEnabled: false,
  };
  let tab: WorkspaceTabId = 'village';

  const store = new WorldStore();
  const cast = pack.cast ?? [];
  const sim = new VillageSimulation(pack.map, cast, [], settings, {
    mind: createSilentMind(),
    world: pack.context,
  });
  if (pack.story.focalCharacterId) sim.setFocalWorldline(pack.story.focalCharacterId);

  let syncedCast = cast;
  store.subscribe((doc) => {
    if (sim.world !== doc.context) sim.setWorld(doc.context);
    if (sim.map !== doc.map) sim.updateMap(doc.map);
    if (syncedCast !== doc.cast) sim.syncVillagers(doc.cast);
    syncedCast = doc.cast;
  });
  store.reset({ map: pack.map, cast, context: pack.context });

  seloToolHost.setHooks({
    getSimulation: () => sim,
    getMap: () => store.document.map,
    getVillagers: () => store.document.cast,
    getSettings: () => settings,
    getTab: () => tab,
    setTab: (next) => {
      tab = next;
    },
    getStore: () => store,
    applyMap: (map) => {
      store.dispatch({ type: 'map.replace', map }, `Apply map "${map.name}"`);
    },
    applyVillagers: (next) => {
      store.dispatch({ type: 'cast.replace', cast: next }, 'Update cast');
    },
    updateSettings: (patch) => {
      settings = { ...settings, ...patch };
      sim.updateSettings(settings);
    },
  });

  const tickMs = Math.max(16, Math.min(100, options.tickMs ?? 100));
  const timer = setInterval(() => sim.stepFrame(tickMs / 1000), tickMs);
  (timer as { unref?: () => void }).unref?.();

  return { sim, store, stop: () => clearInterval(timer) };
}
