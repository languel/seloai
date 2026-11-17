import { storyPackFromMarkdown } from '../world/storyText';
import { normalizeWorldContext } from '../world/worldContext';
import { DEFAULT_WORLD_PACK_ID, WORLD_PACKS, findWorldPack, inferWorldContext, withBundledTileMeanings } from '../world/packs';
import type { WorldContext } from '../world/worldContext';
import {
  createBalkanMythMap,
  createBalkanMythVillagers,
  createBalkanMythWorld,
  createBulgarianShevitsaMap,
  createDefaultMap,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VILLAGERS,
} from '../data/defaultData';
import { EAVESDROP_WHOLE_MAP_RADIUS } from '../ai/audioPipeline';
import { ensureVillagerSprite } from '../engine/characterGenerator';
import type {
  Conversation,
  MemoryEntry,
  ModelSettings,
  VillageMap,
  VillagerConfig,
} from '../engine/types';

const DB_NAME = 'seloai-db';
const DB_VERSION = 1;
const STORE_NAME = 'state';

export type CharacterHistoriesMap = Record<
  string,
  { memories: MemoryEntry[]; currentIntention?: string; worldFeed?: string[] }
>;

export interface PersistedVillageState {
  map: VillageMap;
  villagers: VillagerConfig[];
  modelSettings: ModelSettings;
  conversations: Conversation[];
  characterHistories?: CharacterHistoriesMap;
  focalWorldlineId?: string;
  /** Setting-specific knowledge from the world pack this world came from. */
  world?: WorldContext;
  savedAt: number;
}

export interface SavedWorldSlot {
  id: string;
  name: string;
  villagerCount: number;
  width: number;
  height: number;
  conversationCount: number;
  savedAt: number;
  state: PersistedVillageState;
}

/** Third-party tilesets that no longer ship; worlds built on them cannot be drawn. */
const REMOVED_TILESET_URLS = ['/assets/gentle-obj.png', '/assets/rpg-tileset.png', '/assets/magecity.png'];

function buildDefaultState(): PersistedVillageState {
  const pack = findWorldPack(DEFAULT_WORLD_PACK_ID)!.build();
  return {
    map: pack.map,
    villagers: pack.cast ?? structuredClone(DEFAULT_VILLAGERS),
    modelSettings: { ...DEFAULT_MODEL_SETTINGS },
    conversations: [],
    world: pack.context,
    focalWorldlineId: pack.story.focalCharacterId,
    savedAt: Date.now(),
  };
}

const SAVED_WORLDS_KEY = 'saved_worlds_v1';
let memorySavedWorldsCache: SavedWorldSlot[] | null = null;

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

/**
 * Gives a saved character the figure its world pack now declares (a lamia's serpent body,
 * say) when the save predates it. Matched on id and name, so a renamed or new character is
 * left alone, and a figure the user chose is never overwritten.
 */
let packFigures: VillagerConfig[] | null = null;

function withPackFigure(villager: VillagerConfig): VillagerConfig {
  if (villager.figure) return villager;
  packFigures ??= WORLD_PACKS.flatMap((pack) => pack.build().cast ?? []).filter((c) => c.figure);
  const match = packFigures.find((c) => c.id === villager.id && c.name === villager.name);
  return match ? { ...villager, figure: structuredClone(match.figure) } : villager;
}

export async function loadPersistedState(): Promise<PersistedVillageState> {
  try {
    const stored = await idbGet<Partial<PersistedVillageState>>('village_v1');
    if (
      stored &&
      stored.map &&
      !REMOVED_TILESET_URLS.some((url) => stored.map!.tileSetUrl?.endsWith(url)) &&
      Array.isArray(stored.villagers) &&
      stored.villagers.length > 0
    ) {
      const rawSettings = (stored.modelSettings ?? {}) as Partial<ModelSettings> & {
        proximityAudioEnabled?: boolean;
      };
      const radius =
        typeof rawSettings.proximityRadiusTiles === 'number'
          ? rawSettings.proximityAudioEnabled === false
            ? 0
            : rawSettings.proximityRadiusTiles
          : DEFAULT_MODEL_SETTINGS.proximityRadiusTiles;
      return {
        map: withBundledTileMeanings(stored.map),
        villagers: stored.villagers.map(ensureVillagerSprite).map(withPackFigure),
        modelSettings: {
          ...DEFAULT_MODEL_SETTINGS,
          ...rawSettings,
          eavesdropSpeech: rawSettings.eavesdropSpeech ?? DEFAULT_MODEL_SETTINGS.eavesdropSpeech,
          eavesdropThoughts: rawSettings.eavesdropThoughts ?? DEFAULT_MODEL_SETTINGS.eavesdropThoughts,
          showReasoning: rawSettings.showReasoning ?? DEFAULT_MODEL_SETTINGS.showReasoning,
          speakReasoning: rawSettings.speakReasoning ?? DEFAULT_MODEL_SETTINGS.speakReasoning,
          autoLoadCachedModel:
            rawSettings.autoLoadCachedModel ?? DEFAULT_MODEL_SETTINGS.autoLoadCachedModel,
          proximityRadiusTiles: Math.max(0, Math.min(EAVESDROP_WHOLE_MAP_RADIUS, radius)),
          narratorVoice: {
            ...DEFAULT_MODEL_SETTINGS.narratorVoice,
            ...(stored.modelSettings?.narratorVoice ?? {}),
          },
          playerVoice: {
            ...DEFAULT_MODEL_SETTINGS.playerVoice,
            ...(stored.modelSettings?.playerVoice ?? {}),
          },
        },
        conversations: Array.isArray(stored.conversations) ? stored.conversations : [],
        characterHistories:
          stored.characterHistories && typeof stored.characterHistories === 'object'
            ? stored.characterHistories
            : undefined,
        focalWorldlineId: typeof stored.focalWorldlineId === 'string' ? stored.focalWorldlineId : undefined,
        world: isWorldContext(stored.world) ? stored.world : inferWorldContext(stored.map),
        savedAt: stored.savedAt ?? Date.now(),
      };
    }
  } catch {
    // Fall back to defaults
  }

  return buildDefaultState();
}

export async function savePersistedState(state: PersistedVillageState): Promise<void> {
  try {
    await idbSet('village_v1', { ...state, savedAt: Date.now() });
  } catch {
    // Ignore storage quota / environment errors silently
  }
}

export async function resetPersistedState(): Promise<PersistedVillageState> {
  const fresh = buildDefaultState();
  await savePersistedState(fresh);
  return fresh;
}

export async function listSavedWorlds(): Promise<SavedWorldSlot[]> {
  if (memorySavedWorldsCache) {
    return memorySavedWorldsCache;
  }
  try {
    const raw = await idbGet<SavedWorldSlot[]>(SAVED_WORLDS_KEY);
    if (Array.isArray(raw)) {
      memorySavedWorldsCache = raw
        .filter((s) => s && typeof s.id === 'string' && s.state?.map)
        .sort((a, b) => b.savedAt - a.savedAt);
      return memorySavedWorldsCache;
    }
  } catch {
    // ignore storage errors and fall back to memory cache
  }
  memorySavedWorldsCache = [];
  return memorySavedWorldsCache;
}

export async function saveWorldToMemory(
  name: string,
  state: PersistedVillageState,
  existingId?: string,
): Promise<SavedWorldSlot> {
  const cleanName = name.trim() || state.map.name || 'Untitled World';
  const clonedState: PersistedVillageState = {
    ...structuredClone(state),
    map: { ...structuredClone(state.map), name: cleanName },
    savedAt: Date.now(),
  };
  const slotId =
    existingId && existingId.trim()
      ? existingId.trim()
      : `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const slot: SavedWorldSlot = {
    id: slotId,
    name: cleanName,
    villagerCount: clonedState.villagers.length,
    width: clonedState.map.width,
    height: clonedState.map.height,
    conversationCount: clonedState.conversations.length,
    savedAt: clonedState.savedAt,
    state: clonedState,
  };
  const existing = await listSavedWorlds();
  const next = [slot, ...existing.filter((item) => item.id !== slotId)].sort(
    (a, b) => b.savedAt - a.savedAt,
  );
  memorySavedWorldsCache = next;
  try {
    await idbSet(SAVED_WORLDS_KEY, next);
  } catch {
    // keep working in memory even if IndexedDB is unavailable
  }
  return slot;
}

export async function deleteSavedWorld(id: string): Promise<SavedWorldSlot[]> {
  const existing = await listSavedWorlds();
  const next = existing.filter((item) => item.id !== id);
  memorySavedWorldsCache = next;
  try {
    await idbSet(SAVED_WORLDS_KEY, next);
  } catch {
    // keep memory state updated
  }
  return next;
}

export {
  createBalkanMythMap,
  createBalkanMythVillagers,
  createBalkanMythWorld,
  createBulgarianShevitsaMap,
};

export function createBlankWorldMap(name = 'New World', width = 36, height = 28): VillageMap {
  const base = createDefaultMap();
  const emptyBg = () => Array.from({ length: width }, () => Array(height).fill(0));
  const emptyObj = () => Array.from({ length: width }, () => Array(height).fill(-1));
  return {
    ...base,
    name,
    width,
    height,
    bgTiles: [emptyBg(), emptyObj()],
    objectTiles: [emptyObj(), emptyObj()],
    collisionGrid: Array.from({ length: width }, () => Array(height).fill(false)),
    animatedSprites: [],
    spawnPoints: [
      { id: 'spawn-center', x: Math.floor(width / 2), y: Math.floor(height / 2), label: 'Center' },
    ],
    pointsOfInterest: [
      {
        id: 'poi-center',
        tag: 'Center',
        label: 'Center',
        x: Math.floor(width / 2),
        y: Math.floor(height / 2),
        description: 'Starting gathering point',
      },
    ],
    stamps: [],
  };
}

const SECRET_SETTING_KEYS = ['localApiKey', 'voiceApiKey', 'imageGenApiKey'] as const;

/** Removes API keys so they never travel in an export or arrive via an import. */
export function stripSecretSettings<T extends Partial<ModelSettings>>(settings: T): T {
  const copy = { ...settings };
  for (const key of SECRET_SETTING_KEYS) delete copy[key];
  return copy;
}

export function exportProjectJson(state: PersistedVillageState): string {
  return JSON.stringify(
    {
      format: 'seloai-project-v1',
      exportedAt: new Date().toISOString(),
      map: state.map,
      villagers: state.villagers,
      modelSettings: stripSecretSettings(state.modelSettings),
      conversations: state.conversations,
      characterHistories: state.characterHistories ?? {},
      focalWorldlineId: state.focalWorldlineId ?? 'scribe',
      world: state.world,
    },
    null,
    2,
  );
}

export function exportLevelJson(map: VillageMap): string {
  return JSON.stringify(
    {
      format: 'seloai-level-v1',
      exportedAt: new Date().toISOString(),
      map,
    },
    null,
    2,
  );
}

export function exportCharactersJson(villagers: VillagerConfig[]): string {
  return JSON.stringify(
    {
      format: 'seloai-characters-v1',
      exportedAt: new Date().toISOString(),
      villagers,
    },
    null,
    2,
  );
}

export function exportCharactersWithHistoriesJson(
  villagers: VillagerConfig[],
  characterHistories: CharacterHistoriesMap,
): string {
  return JSON.stringify(
    {
      format: 'seloai-characters-history-v1',
      exportedAt: new Date().toISOString(),
      villagers,
      characterHistories,
    },
    null,
    2,
  );
}

export function exportDatabaseJson(
  conversations: Conversation[],
  characterHistories: CharacterHistoriesMap,
  focalWorldlineId = 'scribe',
): string {
  return JSON.stringify(
    {
      format: 'seloai-db-v1',
      exportedAt: new Date().toISOString(),
      conversations,
      characterHistories,
      focalWorldlineId,
    },
    null,
    2,
  );
}

export interface ParsedImportBundle {
  format?: string;
  map?: VillageMap;
  villagers?: VillagerConfig[];
  modelSettings?: Partial<ModelSettings>;
  conversations?: Conversation[];
  characterHistories?: CharacterHistoriesMap;
  focalWorldlineId?: string;
  world?: WorldContext;
}

function isWorldContext(value: unknown): value is WorldContext {
  const w = value as Partial<WorldContext> | null;
  return Boolean(
    w &&
      typeof w === 'object' &&
      typeof w.settingKind === 'string' &&
      typeof w.playerName === 'string' &&
      w.storyLines &&
      Array.isArray(w.storyLines.openingBeats),
  );
}

/**
 * An imported file of any kind the app reads: a Markdown story (with a YAML header) by its
 * name, otherwise JSON (a project, a level, a cast, a story pack…).
 */
export function parseImportedFile(name: string, raw: string): ParsedImportBundle {
  if (/\.(md|markdown)$/i.test(name)) return parseImportedVillageJson(JSON.stringify(storyPackFromMarkdown(raw)));
  return parseImportedVillageJson(raw);
}

export function parseImportedVillageJson(raw: string): ParsedImportBundle {
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid JSON payload.');
  }

  // Support bare array of villagers
  if (Array.isArray(data)) {
    if (data.length === 0) throw new Error('Imported villager array is empty.');
    return {
      format: 'seloai-characters-v1',
      villagers: (data as VillagerConfig[]).map(ensureVillagerSprite),
    };
  }

  // A story pack (format "seloai-world-pack"): the premise, the opening, the cast and, if it
  // has one, the place. Without a map it goes onto the world already loaded.
  if (data.format === 'seloai-world-pack') {
    const pack: ParsedImportBundle = { format: data.format, world: normalizeWorldContext(data.context) };
    if (typeof data.story?.openingDirective === 'string' && data.story.openingDirective.trim() && !pack.world!.opening) {
      pack.world = { ...pack.world!, opening: data.story.openingDirective };
    }
    if (data.map && Array.isArray(data.map.bgTiles) && typeof data.map.width === 'number') pack.map = withBundledTileMeanings(data.map as VillageMap);
    if (Array.isArray(data.cast) && data.cast.length > 0) pack.villagers = (data.cast as VillagerConfig[]).map(ensureVillagerSprite);
    if (typeof data.story?.focalCharacterId === 'string') pack.focalWorldlineId = data.story.focalCharacterId;
    return pack;
  }

  // Support bare VillageMap JSON
  if (Array.isArray(data.bgTiles) && typeof data.width === 'number') {
    return {
      format: 'seloai-level-v1',
      map: withBundledTileMeanings(data as VillageMap),
    };
  }

  const result: ParsedImportBundle = {
    format: typeof data.format === 'string' ? data.format : undefined,
  };

  if (data.map && Array.isArray(data.map.bgTiles) && typeof data.map.width === 'number') {
    result.map = withBundledTileMeanings(data.map as VillageMap);
  }
  if (Array.isArray(data.villagers) && data.villagers.length > 0) {
    result.villagers = (data.villagers as VillagerConfig[]).map(ensureVillagerSprite);
  }
  if (data.modelSettings && typeof data.modelSettings === 'object') {
    result.modelSettings = stripSecretSettings(data.modelSettings as Partial<ModelSettings>);
  }
  if (Array.isArray(data.conversations)) {
    result.conversations = data.conversations as Conversation[];
  }
  if (data.characterHistories && typeof data.characterHistories === 'object') {
    result.characterHistories = data.characterHistories as CharacterHistoriesMap;
  }
  if (typeof data.focalWorldlineId === 'string') {
    result.focalWorldlineId = data.focalWorldlineId;
  }
  if (isWorldContext(data.world)) {
    result.world = data.world;
  }

  if (
    !result.map &&
    !result.villagers &&
    !result.conversations &&
    !result.characterHistories
  ) {
    throw new Error('JSON must contain a valid map, villagers, conversations, or characterHistories.');
  }
  return result;
}
