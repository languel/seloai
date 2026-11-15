import { createBrowserSimulation } from '../../app/browserSimulation';
import { describe, expect, it } from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { isTileWalkable } from '../pathfinding';
import {
  createAutomatedVillagerBatch,
  createSeededRng,
  DEFAULT_APPEARANCE,
  randomizeAppearance,
} from '../characterGenerator';
import {
  buildCustomSpriteFromAppearance,
  renderAppearanceSpritePixels,
  SPRITE_SHEET_HEIGHT,
  SPRITE_SHEET_WIDTH,
} from '../spriteGenerator';

describe('Character generation', () => {
  it('auto-generates distinct 128x128 pixel spritesheets across independent visual traits', () => {
    const basePixels = renderAppearanceSpritePixels(DEFAULT_APPEARANCE);
    expect(basePixels.length).toBe(SPRITE_SHEET_WIDTH * SPRITE_SHEET_HEIGHT * 4);

    // Ensure opaque sprite pixels exist (non-blank sheet)
    let opaqueCount = 0;
    for (let i = 3; i < basePixels.length; i += 4) {
      if (basePixels[i] > 0) opaqueCount++;
    }
    expect(opaqueCount).toBeGreaterThan(1500);

    // Independent changes across hair, skin, clothing, facial hair, gender, and accessories produce distinct sprites
    const variants = [
      { ...DEFAULT_APPEARANCE, hairStyle: 'spiky' as const },
      { ...DEFAULT_APPEARANCE, hairColor: 'golden-blonde' as const },
      { ...DEFAULT_APPEARANCE, skinTone: 'chestnut' as const },
      { ...DEFAULT_APPEARANCE, clothingStyle: 'blacksmith-apron' as const },
      { ...DEFAULT_APPEARANCE, clothingColor: 'cobalt' as const },
      { ...DEFAULT_APPEARANCE, facialHair: 'full-beard' as const },
      { ...DEFAULT_APPEARANCE, gender: 'male' as const },
      { ...DEFAULT_APPEARANCE, accessory: 'straw-hat' as const },
    ];

    for (const variant of variants) {
      const varPixels = renderAppearanceSpritePixels(variant);
      let diffBytes = 0;
      for (let i = 0; i < basePixels.length; i++) {
        if (basePixels[i] !== varPixels[i]) diffBytes++;
      }
      expect(diffBytes).toBeGreaterThan(20);
    }

    const sheet = buildCustomSpriteFromAppearance(variants[3]);
    expect(sheet.textureUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(sheet.frameWidth).toBe(32);
    expect(sheet.frameHeight).toBe(32);
    expect(sheet.cols).toBe(4);
    expect(sheet.rows).toBe(4);
    expect(sheet.framesPerDirection).toBe(4);
    expect(sheet.rowMap).toEqual({ down: 0, left: 1, right: 2, up: 3 });
  });

  it('randomizes character features independently with lock support and high variation', () => {
    const rng = createSeededRng(42);
    const seenKeys = new Set<string>();
    const lockedBase = {
      ...DEFAULT_APPEARANCE,
      gender: 'male' as const,
      skinTone: 'olive' as const,
    };

    for (let i = 0; i < 12; i++) {
      const next = randomizeAppearance({
        base: lockedBase,
        locks: { gender: true, skinTone: true },
        rng,
      });
      expect(next.gender).toBe('male');
      expect(next.skinTone).toBe('olive');
      seenKeys.add(
        `${next.hairStyle}:${next.hairColor}:${next.clothingStyle}:${next.clothingColor}:${next.accessory}`,
      );
    }
    expect(seenKeys.size).toBeGreaterThanOrEqual(10);
  });

  it('automates batch villager creation with unique identities, walkable spawns, and modular sprites', () => {
    const map = createDefaultMap();
    const rng = createSeededRng(1337);
    const created = createAutomatedVillagerBatch(5, {
      map,
      existingVillagers: DEFAULT_VILLAGERS,
      rng,
    });

    expect(created.length).toBe(5);
    const names = new Set(created.map((v) => v.name));
    const existingNames = new Set(DEFAULT_VILLAGERS.map((v) => v.name));
    expect(names.size).toBe(5);
    for (const v of created) {
      expect(existingNames.has(v.name)).toBe(false);
      expect(isTileWalkable(map, v.homeTile.x, v.homeTile.y)).toBe(true);
      expect(v.appearance).toBeDefined();
      expect(v.customSprite?.textureUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(v.voice?.language.length).toBeGreaterThan(2);
    }

    const sim = createBrowserSimulation(
      map,
      [...DEFAULT_VILLAGERS, ...created],
      [],
      { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', enableWebSpeechFallback: false },
    );
    expect(sim.runtimes.size).toBe(DEFAULT_VILLAGERS.length + 5);
  });

  it('generates generic fantasy names without regional-locked defaults', () => {
    const batch = createAutomatedVillagerBatch(6, { rng: createSeededRng(99) });
    expect(batch).toHaveLength(6);
    const banned = ['rushnyk', 'vyshyvanka', 'bandura', 'olena', 'taras', 'marusia', 'bogdan', 'kalyna'];
    for (const v of batch) {
      const hay = `${v.name} ${v.role} ${v.identity}`.toLowerCase();
      for (const word of banned) {
        expect(hay).not.toContain(word);
      }
    }
  });
});
