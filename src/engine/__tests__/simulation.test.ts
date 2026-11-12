import { describe, expect, it } from 'vitest';
import {
  createDefaultMap,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VILLAGERS,
  getEffectiveVoice,
  OMNI_SPEECH_LANGUAGES,
  WEBGPU_BRAIN_PRESETS,
} from '../../data/defaultData';
import { computeSpatialMix } from '../../ai/audioPipeline';
import { parseDialogueAndNarration } from '../../ai/brainRouter';
import { findNearestWalkableTile, findPath, isTileWalkable } from '../pathfinding';
import {
  createAutomatedVillagerBatch,
  createSeededRng,
  DEFAULT_APPEARANCE,
  randomizeAppearance,
} from '../characterGenerator';
import { CHAR_COLLISION_RADIUS, parseMentionTargets, VillageSimulation } from '../simulation';
import {
  buildCustomSpriteFromAppearance,
  renderAppearanceSpritePixels,
  SPRITE_SHEET_HEIGHT,
  SPRITE_SHEET_WIDTH,
} from '../spriteGenerator';
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

    const radiusZeroOff = computeSpatialMix(10, 10, 10, 10, 0);
    expect(radiusZeroOff.inRange).toBe(false);
    expect(radiusZeroOff.gain).toBe(0);
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

  it('includes LFM3-Omni all-in-one, Bonsai-2 27B at the bottom, and webml-community WebGPU brain presets', () => {
    const ids = WEBGPU_BRAIN_PRESETS.map((p) => p.id);
    expect(ids).toContain('lfm3-omni-allinone');
    expect(ids).toContain('qwen3.5-0.8b-text');
    expect(ids).toContain('ternary-bonsai-1.7b');
    expect(ids).toContain('bonsai-1.7b-q1');
    expect(ids).toContain('minicpm5-2b');
    expect(ids).toContain('gemma-4-e2b');
    const last = WEBGPU_BRAIN_PRESETS[WEBGPU_BRAIN_PRESETS.length - 1];
    expect(last.id).toBe('bonsai-2-27b');
    expect(last.engine).toBe('bonsai2-gguf');
    expect(last.modelId).toBe('prism-ml/Ternary-Bonsai-2-27B-gguf');
  });

  it('strips NPC self-name prefixes and separates stage narration for the Scribe', () => {
    const parsed = parseDialogueAndNarration(
      'Olena: *adjusts her shawl by the loom* "Good morning, neighbor!" [smiles warmly]',
      'Olena',
    );
    expect(parsed.spoken).toBe('"Good morning, neighbor!"');
    expect(parsed.spoken.toLowerCase().startsWith('olena:')).toBe(false);
    expect(parsed.narration).toEqual([
      'Adjusts her shawl by the loom',
      'Smiles warmly',
    ]);

    const quoted = parseDialogueAndNarration('**Taras**: "The flour is freshly milled."', 'Taras');
    expect(quoted.spoken).toBe('The flour is freshly milled.');
  });

  it('interleaves Scribe narration and alternate NPC turns in strict sequence without self-names', async () => {
    const map = createDefaultMap();
    const sim = new VillageSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      narratorEnabled: true,
      narrateEvents: true,
    });

    const vA = DEFAULT_VILLAGERS[0];
    const vB = DEFAULT_VILLAGERS[1];
    const conv = await sim.runConversationBetween(vA.id, vB.id);
    expect(conv).toBeDefined();

    const msgs = conv!.messages;
    expect(msgs[0].kind).toBe('narration');
    expect(msgs[0].senderId).toBe('narrator');
    expect(msgs[0].senderName).toBe(DEFAULT_MODEL_SETTINGS.narratorName);

    const speechMsgs = msgs.filter((m) => m.kind === 'speech');
    expect(speechMsgs.map((m) => m.senderId)).toEqual([vA.id, vB.id, vA.id]);
    for (const m of speechMsgs) {
      expect(m.text.startsWith(`${m.senderName}:`)).toBe(false);
    }

    expect(msgs[msgs.length - 1].kind).toBe('narration');
    expect(msgs[msgs.length - 1].senderId).toBe('narrator');
  });

  it('prevents the player from walking through a villager via collision radius', () => {
    const map = createDefaultMap();
    const sim = new VillageSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
    });

    const olena = DEFAULT_VILLAGERS[0];
    const rt = sim.runtimes.get(olena.id)!;
    // Place the player directly left of Olena on a walkable tile and try to walk straight through her.
    sim.player.x = rt.x - 1.2;
    sim.player.y = rt.y;
    rt.path = [];
    rt.state = 'idle';

    for (let i = 0; i < 40; i++) {
      sim.nudgePlayer(1, 0, 0.05);
    }

    const dist = Math.hypot(sim.player.x - rt.x, sim.player.y - rt.y);
    expect(dist).toBeGreaterThanOrEqual(CHAR_COLLISION_RADIUS - 0.15);
    expect(sim.player.x).toBeLessThan(rt.x);
  });

  it('parses @Scribe, custom narratorName, and multi-target @mentions cleanly', () => {
    const targetsScribe = parseMentionTargets(
      '@Scribe describe the square',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(targetsScribe.map((t) => t.id)).toEqual(['narrator']);

    const targetsCustomNarrator = parseMentionTargets(
      '@Chronicle what happens next?',
      DEFAULT_VILLAGERS,
      { ...DEFAULT_MODEL_SETTINGS, narratorName: 'Chronicle' },
    );
    expect(targetsCustomNarrator.map((t) => t.id)).toEqual(['narrator']);

    const targetsSingle = parseMentionTargets(
      'Hey @Taras how is the mill?',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(targetsSingle.map((t) => t.id)).toEqual(['v-taras']);

    const targetsMulti = parseMentionTargets(
      '@Scribe @Olena @Taras discuss the harvest',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(targetsMulti.map((t) => t.id)).toEqual(['narrator', 'v-olena', 'v-taras']);
  });

  it('routes @Scribe narration, @Target replies, multi-target turn order, and @Olena world directions', async () => {
    const map = createDefaultMap();
    const sim = new VillageSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      narratorEnabled: true,
    });

    // 1. Direct @Scribe narration
    const scribeRes = await sim.sendUserAddressedMessage(
      undefined,
      '@Scribe describe what is happening in the village right now',
      false,
    );
    expect(scribeRes.focusedTargetId).toBe('narrator');
    const latestAfterScribe = sim.conversations[sim.conversations.length - 1];
    expect(latestAfterScribe.messages.some((m) => m.senderId === 'narrator' && m.kind === 'narration')).toBe(true);

    // 2. Direct @Taras reply switches focused target and invokes Taras
    const tarasRes = await sim.sendUserAddressedMessage(
      'narrator',
      '@Taras tell me about the flour mill',
      false,
    );
    expect(tarasRes.focusedTargetId).toBe('v-taras');
    const tarasConv = sim.conversations.find(
      (c) => c.participantIds.includes('v-taras') && c.messages.some((m) => m.senderId === 'v-taras'),
    );
    expect(tarasConv).toBeDefined();

    // 3. Multi-target @Scribe @Olena @Taras turn order
    const multiRes = await sim.sendUserAddressedMessage(
      undefined,
      '@Scribe @Olena @Taras gather and share your thoughts',
      false,
    );
    expect(multiRes.focusedTargetId).toBe('narrator');
    const multiConv = sim.conversations.find((c) =>
      c.messages.some((m) => m.text.includes('gather and share your thoughts')),
    )!;
    const promptIdx = multiConv.messages.findIndex((m) =>
      m.text.includes('gather and share your thoughts'),
    );
    const replySenders = multiConv.messages
      .slice(promptIdx + 1)
      .filter((m) => m.senderId !== 'human-visitor')
      .map((m) => m.senderId);
    expect(replySenders).toEqual(['narrator', 'v-olena', 'v-taras']);

    // 4. World direction "@Olena walk to Windmill Meadow" updates intention & path
    await sim.sendUserAddressedMessage(
      undefined,
      '@Olena walk to Windmill Meadow',
      false,
    );
    const olenaRt = sim.runtimes.get('v-olena')!;
    expect(olenaRt.currentIntention?.toLowerCase()).toContain('windmill meadow');
    expect(olenaRt.path.length).toBeGreaterThan(0);
  });

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

    const sim = new VillageSimulation(
      map,
      [...DEFAULT_VILLAGERS, ...created],
      [],
      { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', enableWebSpeechFallback: false },
    );
    expect(sim.runtimes.size).toBe(DEFAULT_VILLAGERS.length + 5);
  });
});
