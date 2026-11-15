import { describe, expect, it } from 'vitest';
import { exportProjectJson, parseImportedVillageJson } from '../../storage/villageStore';
import { DEFAULT_MODEL_SETTINGS } from '../../data/defaultData';
import { WORLD_PACKS, inferWorldContext } from '../packs';
import { GENERIC_WORLD_CONTEXT, describeSetting, fillTemplate, placeName, selectLines } from '../worldContext';
import { WORLD_PACK_VERSION, validateWorldPack } from '../worldPack';

describe('World packs', () => {
  it('ships only valid packs with unique ids', () => {
    const ids = new Set<string>();
    for (const definition of WORLD_PACKS) {
      const pack = definition.build();
      expect(validateWorldPack(pack), definition.id).toEqual([]);
      expect(pack.id).toBe(definition.id);
      expect(ids.has(pack.id)).toBe(false);
      ids.add(pack.id);
    }
  });

  it('reports what is wrong with a malformed pack', () => {
    const pack = WORLD_PACKS[0].build();
    const broken = {
      ...pack,
      version: WORLD_PACK_VERSION + 1,
      story: { focalCharacterId: 'nobody' },
      cast: [...pack.cast!, pack.cast![0]],
    };
    const problems = validateWorldPack(broken);
    expect(problems.some((p) => p.includes('newer'))).toBe(true);
    expect(problems.some((p) => p.includes('duplicate cast id'))).toBe(true);
    expect(problems.some((p) => p.includes('focalCharacterId'))).toBe(true);
    expect(validateWorldPack(null)).toEqual(['Pack is not an object.']);
  });

  it('names the setting from the pack, with a neutral fallback', () => {
    const zmeyovo = WORLD_PACKS[0].build().context;
    expect(placeName(zmeyovo)).toBe('Zmeyovo');
    expect(describeSetting(zmeyovo)).toBe('village of Zmeyovo');
    expect(placeName(GENERIC_WORLD_CONTEXT)).toBe('the village');
    expect(describeSetting(GENERIC_WORLD_CONTEXT)).toBe('village');
  });

  it('fills templates and applies line conditions', () => {
    expect(fillTemplate('{a} meets {b} at {place}', { a: 'A', b: 'B', place: 'P' })).toBe('A meets B at P');
    expect(fillTemplate('{unknown} stays', {})).toBe('{unknown} stays');
    const pool = { lines: ['x'], whenMentioned: ['well'] };
    expect(selectLines(pool, 'by the well')).toEqual(['x']);
    expect(selectLines(pool, 'by the bridge')).toEqual([]);
    expect(selectLines({ lines: ['y'] }, '')).toEqual(['y']);
    expect(selectLines(undefined, 'anything')).toEqual([]);
  });

  it('carries the world context through a project export and recovers it for older saves', () => {
    const pack = WORLD_PACKS[0].build();
    const json = exportProjectJson({
      map: pack.map,
      villagers: pack.cast!,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      conversations: [],
      world: pack.context,
      savedAt: 1,
    });
    expect(parseImportedVillageJson(json).world?.settingName).toBe('Zmeyovo');
    expect(inferWorldContext(pack.map).settingName).toBe('Zmeyovo');
    expect(inferWorldContext({ tileSetUrl: 'data:image/png;base64,AAAA' }).settingName).toBe('');
  });
});
