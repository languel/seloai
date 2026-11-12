import {
  createDefaultMap,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VILLAGERS,
} from '../data/defaultData';
import { ensureVillagerAppearanceSprite } from '../engine/spriteGenerator';
import type { Conversation, ModelSettings, VillageMap, VillagerConfig } from '../engine/types';

const DB_NAME = 'seloai-db';
const DB_VERSION = 1;
const STORE_NAME = 'state';

export interface PersistedVillageState {
  map: VillageMap;
  villagers: VillagerConfig[];
  modelSettings: ModelSettings;
  conversations: Conversation[];
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadPersistedState(): Promise<PersistedVillageState> {
  try {
    const stored = await idbGet<Partial<PersistedVillageState>>('village_v1');
    if (stored && stored.map && Array.isArray(stored.villagers) && stored.villagers.length > 0) {
      return {
        map: stored.map,
        villagers: stored.villagers.map(ensureVillagerAppearanceSprite),
        modelSettings: {
          ...DEFAULT_MODEL_SETTINGS,
          ...(stored.modelSettings ?? {}),
          narratorVoice: {
            ...DEFAULT_MODEL_SETTINGS.narratorVoice,
            ...(stored.modelSettings?.narratorVoice ?? {}),
          },
        },
        conversations: Array.isArray(stored.conversations) ? stored.conversations : [],
        savedAt: stored.savedAt ?? Date.now(),
      };
    }
  } catch {
    // Fall back to defaults
  }

  return {
    map: createDefaultMap(),
    villagers: structuredClone(DEFAULT_VILLAGERS),
    modelSettings: { ...DEFAULT_MODEL_SETTINGS },
    conversations: [],
    savedAt: Date.now(),
  };
}

export async function savePersistedState(state: PersistedVillageState): Promise<void> {
  try {
    await idbSet('village_v1', { ...state, savedAt: Date.now() });
  } catch {
    // Ignore storage quota / environment errors silently
  }
}

export async function resetPersistedState(): Promise<PersistedVillageState> {
  const fresh: PersistedVillageState = {
    map: createDefaultMap(),
    villagers: structuredClone(DEFAULT_VILLAGERS),
    modelSettings: { ...DEFAULT_MODEL_SETTINGS },
    conversations: [],
    savedAt: Date.now(),
  };
  await savePersistedState(fresh);
  return fresh;
}

export function exportVillageJson(state: PersistedVillageState): string {
  return JSON.stringify(
    {
      format: 'seloai-village-v1',
      exportedAt: new Date().toISOString(),
      map: state.map,
      villagers: state.villagers,
      modelSettings: state.modelSettings,
    },
    null,
    2,
  );
}

export function parseImportedVillageJson(raw: string): {
  map?: VillageMap;
  villagers?: VillagerConfig[];
  modelSettings?: Partial<ModelSettings>;
} {
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid JSON payload.');
  }
  const result: {
    map?: VillageMap;
    villagers?: VillagerConfig[];
    modelSettings?: Partial<ModelSettings>;
  } = {};

  if (data.map && Array.isArray(data.map.bgTiles) && typeof data.map.width === 'number') {
    result.map = data.map as VillageMap;
  }
  if (Array.isArray(data.villagers) && data.villagers.length > 0) {
    result.villagers = (data.villagers as VillagerConfig[]).map(ensureVillagerAppearanceSprite);
  }
  if (data.modelSettings && typeof data.modelSettings === 'object') {
    result.modelSettings = data.modelSettings as Partial<ModelSettings>;
  }
  if (!result.map && !result.villagers) {
    throw new Error('JSON must contain a valid "map" and/or "villagers" array.');
  }
  return result;
}
