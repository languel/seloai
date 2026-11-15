import { createBrowserSimulation } from '../../app/browserSimulation';
import { describe, expect, it } from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { deleteSavedWorld, listSavedWorlds, saveWorldToMemory } from '../villageStore';
import {
  createBlankWorldMap,
  exportCharactersJson,
  exportCharactersWithHistoriesJson,
  exportDatabaseJson,
  exportLevelJson,
  exportProjectJson,
  parseImportedVillageJson,
} from '../villageStore';

describe('World storage and bundles', () => {
  it('round-trips village bundle JSON cleanly', () => {
    const map = createDefaultMap();
    const json = exportProjectJson({
      map,
      villagers: DEFAULT_VILLAGERS,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      conversations: [],
      savedAt: 1000,
    });
    const parsed = parseImportedVillageJson(json);
    expect(parsed.map?.width).toBe(48);
    expect(parsed.map?.height).toBe(36);
    expect(parsed.villagers?.length).toBe(DEFAULT_VILLAGERS.length);
    expect(parsed.modelSettings?.textModelId).toBe(DEFAULT_MODEL_SETTINGS.textModelId);
  });

  it('exports/imports project, level, characters, characters+histories, and database, and clears DB for new story', () => {
    const map = createDefaultMap();
    const villagers = structuredClone(DEFAULT_VILLAGERS.slice(0, 2));
    const sim = createBrowserSimulation(map, villagers, [], DEFAULT_MODEL_SETTINGS);
    const v0 = villagers[0]!;
    const rt0 = sim.runtimes.get(v0.id)!;
    rt0.memories.push({
      id: 'mem-portable-1',
      timestamp: Date.now(),
      importance: 9,
      kind: 'reflection',
      summary: 'Remembers the secret passphrase from the old town.',
    });
    sim.conversations.push({
      id: 'conv-export-1',
      participantIds: [v0.id, 'player'],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      active: false,
      messages: [
        {
          id: 'msg-exp-1',
          senderId: v0.id,
          senderName: v0.name,
          text: 'Remembering the old town.',
          timestamp: Date.now(),
          kind: 'speech',
          source: 'story-sim',
        },
      ],
    });

    const histories = sim.exportCharacterHistories();

    // Whole project
    const proj = parseImportedVillageJson(
      exportProjectJson({
        map,
        villagers,
        modelSettings: DEFAULT_MODEL_SETTINGS,
        conversations: sim.conversations,
        characterHistories: histories,
        focalWorldlineId: v0.id,
        savedAt: Date.now(),
      }),
    );
    expect(proj.map?.name).toBe(map.name);
    expect(proj.villagers?.length).toBe(2);
    expect(proj.conversations?.length).toBe(1);
    expect(proj.characterHistories?.[v0.id]?.memories.some((m) => m.id === 'mem-portable-1')).toBe(true);
    expect(proj.focalWorldlineId).toBe(v0.id);

    // Level only
    const lvl = parseImportedVillageJson(exportLevelJson(map));
    expect(lvl.map?.name).toBe(map.name);
    expect(lvl.villagers).toBeUndefined();

    // Characters only
    const chars = parseImportedVillageJson(exportCharactersJson(villagers));
    expect(chars.villagers?.length).toBe(2);
    expect(chars.map).toBeUndefined();
    expect(chars.characterHistories).toBeUndefined();

    // Characters + histories without world
    const charsHist = parseImportedVillageJson(exportCharactersWithHistoriesJson(villagers, histories));
    expect(charsHist.map).toBeUndefined();
    expect(charsHist.villagers?.length).toBe(2);
    expect(charsHist.characterHistories?.[v0.id]?.memories.some((m) => m.id === 'mem-portable-1')).toBe(true);

    // Database only
    const dbOnly = parseImportedVillageJson(exportDatabaseJson(sim.conversations, histories, v0.id));
    expect(dbOnly.map).toBeUndefined();
    expect(dbOnly.conversations?.length).toBe(1);
    expect(dbOnly.characterHistories?.[v0.id]?.memories.some((m) => m.id === 'mem-portable-1')).toBe(true);

    // Clear DB for new story
    sim.clearDatabase();
    expect(sim.conversations.length).toBe(0);
    expect(sim.runtimes.get(v0.id)?.memories.some((m) => m.id === 'mem-portable-1')).toBe(false);

    // Blank world map creation
    const blank = createBlankWorldMap('Empty Stage', 24, 20);
    expect(blank.width).toBe(24);
    expect(blank.height).toBe(20);
    expect(blank.pointsOfInterest?.length).toBe(1);
  });

  it('saves, lists, overwrites, and deletes worlds in browser memory store', async () => {
    const map = createDefaultMap();
    const saved = await saveWorldToMemory('Test Memory World', {
      map,
      villagers: structuredClone(DEFAULT_VILLAGERS),
      modelSettings: { ...DEFAULT_MODEL_SETTINGS },
      conversations: [],
      savedAt: Date.now(),
    });
    const list = await listSavedWorlds();
    expect(list.some((w) => w.id === saved.id && w.name === 'Test Memory World')).toBe(true);

    const remaining = await deleteSavedWorld(saved.id);
    expect(remaining.some((w) => w.id === saved.id)).toBe(false);
  });
});
