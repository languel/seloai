import { describe, expect, it } from 'vitest';
import {
  createDefaultMap,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VILLAGERS,
  getEffectiveVoice,
  OMNI_SPEECH_LANGUAGES,
} from '../../data/defaultData';
import { computeSpatialMix } from '../../ai/audioPipeline';
import { findNearestWalkableTile, findPath, isTileWalkable } from '../pathfinding';
import { VillageSimulation } from '../simulation';
import { exportVillageJson, parseImportedVillageJson } from '../../storage/villageStore';

describe('SeloAI core engine', () => {
  it('creates default map and finds walkable paths around collisions', () => {
    const map = createDefaultMap();
    expect(map.width).toBe(64);
    expect(map.height).toBe(48);

    const start = findNearestWalkableTile(map, 22, 16);
    const goal = findNearestWalkableTile(map, 26, 16);
    expect(isTileWalkable(map, start.x, start.y)).toBe(true);
    expect(isTileWalkable(map, goal.x, goal.y)).toBe(true);

    const path = findPath(map, start, goal);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it('runs VillageSimulation hot-reload and human-to-villager conversation in browser fallback mode', async () => {
    const map = createDefaultMap();
    const sim = new VillageSimulation(
      map,
      DEFAULT_VILLAGERS,
      [],
      { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', enableWebSpeechFallback: false },
    );

    expect(sim.runtimes.size).toBe(DEFAULT_VILLAGERS.length);

    sim.movePlayerTo(23, 16);
    for (let i = 0; i < 20; i++) {
      sim.stepFrame(0.05);
    }
    expect(sim.tickCount).toBe(20);

    const target = DEFAULT_VILLAGERS[0];
    await sim.sendUserTextToVillager(target.id, 'Hello Olena, what are you weaving today?', false);

    const conv = sim.conversations.find((c) => c.participantIds.includes(target.id));
    expect(conv).toBeDefined();
    expect(conv!.messages.length).toBe(2);
    expect(conv!.messages[1].source).toBe('story-sim');
    expect(conv!.messages[1].text.length).toBeGreaterThan(5);
  });

  it('round-trips village bundle JSON cleanly', () => {
    const map = createDefaultMap();
    const json = exportVillageJson({
      map,
      villagers: DEFAULT_VILLAGERS,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      conversations: [],
      savedAt: 1000,
    });
    const parsed = parseImportedVillageJson(json);
    expect(parsed.map?.width).toBe(64);
    expect(parsed.map?.height).toBe(48);
    expect(parsed.villagers?.length).toBe(DEFAULT_VILLAGERS.length);
    expect(parsed.modelSettings?.textModelId).toBe(DEFAULT_MODEL_SETTINGS.textModelId);
  });

  it('computes spatial volume attenuation and left/right stereo pan by proximity', () => {
    const closeRight = computeSpatialMix(12, 10, 10, 10, 8);
    expect(closeRight.inRange).toBe(true);
    expect(closeRight.gain).toBeGreaterThan(0.5);
    expect(closeRight.pan).toBeGreaterThan(0.2);

    const farLeft = computeSpatialMix(4, 10, 10, 10, 8);
    expect(farLeft.inRange).toBe(true);
    expect(farLeft.gain).toBeLessThan(closeRight.gain);
    expect(farLeft.pan).toBeLessThan(-0.5);

    const outOfRange = computeSpatialMix(25, 25, 10, 10, 8);
    expect(outOfRange.inRange).toBe(false);
    expect(outOfRange.gain).toBe(0);
  });

  it('provides effective Omni voice profiles and documented speech locales', () => {
    expect(OMNI_SPEECH_LANGUAGES).toContain('British English');
    expect(OMNI_SPEECH_LANGUAGES).toContain('Polish');
    const taras = DEFAULT_VILLAGERS.find((v) => v.name === 'Taras')!;
    const v = getEffectiveVoice(taras);
    expect(v.gender).toBe('male');
    expect(v.pitchSemitones).toBeLessThan(0);

    const legacyFallback = getEffectiveVoice({ voice: undefined });
    expect(legacyFallback).toEqual({
      gender: 'female',
      language: 'American English',
      pitchSemitones: 0,
      speakingRate: 1.0,
      warmthDb: 0,
    });
  });
});
