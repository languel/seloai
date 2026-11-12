import { describe, expect, it } from 'vitest';
import {
  createDefaultMap,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VILLAGERS,
  getEffectiveVoice,
  OMNI_SPEECH_LANGUAGES,
  WEBGPU_BRAIN_PRESETS,
} from '../../data/defaultData';
import { computeSpatialMix, EAVESDROP_WHOLE_MAP_RADIUS } from '../../ai/audioPipeline';
import { parseDialogueAndNarration } from '../../ai/brainRouter';
import { findNearestWalkableTile, findPath, isTileWalkable } from '../pathfinding';
import {
  createAutomatedVillagerBatch,
  createSeededRng,
  DEFAULT_APPEARANCE,
  randomizeAppearance,
} from '../characterGenerator';
import {
  buildPsychophysicalGraph,
  buildWorldDatabase,
  queryWorldDatabase,
} from '../observatory';
import { CHAR_COLLISION_RADIUS, parseMentionTargets, VillageSimulation } from '../simulation';
import {
  buildCustomSpriteFromAppearance,
  renderAppearanceSpritePixels,
  SPRITE_SHEET_HEIGHT,
  SPRITE_SHEET_WIDTH,
} from '../spriteGenerator';
import {
  createBlankWorldMap,
  exportCharactersJson,
  exportCharactersWithHistoriesJson,
  exportDatabaseJson,
  exportLevelJson,
  exportProjectJson,
  exportVillageJson,
  parseImportedVillageJson,
} from '../../storage/villageStore';

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
    await sim.sendUserTextToVillager(target.id, 'Hello Mara, what are you weaving today?', false);

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
    const bram = DEFAULT_VILLAGERS.find((v) => v.name === 'Bram')!;
    const v = getEffectiveVoice(bram);
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
      'Mara: *adjusts her shawl by the loom* "Good morning, neighbor!" [smiles warmly]',
      'Mara',
    );
    expect(parsed.spoken).toBe('"Good morning, neighbor!"');
    expect(parsed.spoken.toLowerCase().startsWith('mara:')).toBe(false);
    expect(parsed.narration).toEqual([
      'Adjusts her shawl by the loom',
      'Smiles warmly',
    ]);

    const quoted = parseDialogueAndNarration('**Bram**: "The gears are freshly oiled."', 'Bram');
    expect(quoted.spoken).toBe('The gears are freshly oiled.');
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

    const mara = DEFAULT_VILLAGERS[0];
    const rt = sim.runtimes.get(mara.id)!;
    // Place the player directly left of Mara on a walkable tile and try to walk straight through her.
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
      'Hey @Bram how is the forge?',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(targetsSingle.map((t) => t.id)).toEqual(['v-bram']);

    const targetsMulti = parseMentionTargets(
      '@Scribe @Mara @Bram discuss the festival',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(targetsMulti.map((t) => t.id)).toEqual(['narrator', 'v-mara', 'v-bram']);
  });

  it('routes @Scribe narration, @Target replies, multi-target turn order, and @Mara world directions', async () => {
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

    // 2. Direct @Bram reply switches focused target and invokes Bram
    const bramRes = await sim.sendUserAddressedMessage(
      'narrator',
      '@Bram tell me about the clockwork forge',
      false,
    );
    expect(bramRes.focusedTargetId).toBe('v-bram');
    const bramConv = sim.conversations.find(
      (c) => c.participantIds.includes('v-bram') && c.messages.some((m) => m.senderId === 'v-bram'),
    );
    expect(bramConv).toBeDefined();

    // 3. Multi-target @Scribe @Mara @Bram turn order
    const multiRes = await sim.sendUserAddressedMessage(
      undefined,
      '@Scribe @Mara @Bram gather and share your thoughts',
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
    expect(replySenders).toEqual(['narrator', 'v-mara', 'v-bram']);

    // 4. World direction "@Mara walk to Windmill Meadow" updates intention & path
    await sim.sendUserAddressedMessage(
      undefined,
      '@Mara walk to Windmill Meadow',
      false,
    );
    const maraRt = sim.runtimes.get('v-mara')!;
    expect(maraRt.currentIntention?.toLowerCase()).toContain('windmill');
    expect(maraRt.path.length).toBeGreaterThan(0);
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

  it('produces creative non-repetitive DM beats and avoids reciting villager job titles in dialogue', async () => {
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
    const vB = DEFAULT_VILLAGERS[3];
    const c1 = await sim.runConversationBetween(vA.id, vB.id);
    const c2 = await sim.runConversationBetween(vA.id, vB.id);
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();

    const nar1 = c1!.messages.filter((m) => m.kind === 'narration').map((m) => m.text);
    const nar2 = c2!.messages.filter((m) => m.kind === 'narration').map((m) => m.text);
    expect(nar1[0]).not.toContain('steps close to speak');
    expect(nar1[0]).not.toEqual(nar2[0]);
    expect(nar1[nar1.length - 1]).not.toEqual(nar2[nar2.length - 1]);

    const speech1 = c1!.messages.filter((m) => m.kind === 'speech');
    for (const msg of speech1) {
      expect(msg.text.toLowerCase()).not.toContain('tapestry weaver');
      expect(msg.text.toLowerCase()).not.toContain('lantern astronomer');
    }
  });

  it('supports whole-map eavesdrop audio mix alongside 0=off radius', () => {
    const wholeCorner = computeSpatialMix(60, 44, 4, 4, EAVESDROP_WHOLE_MAP_RADIUS);
    expect(wholeCorner.inRange).toBe(true);
    expect(wholeCorner.gain).toBeGreaterThanOrEqual(0.38);
    expect(wholeCorner.pan).toBeGreaterThan(0.5);

    const offCorner = computeSpatialMix(5, 5, 4, 4, 0);
    expect(offCorner.inRange).toBe(false);
    expect(offCorner.gain).toBe(0);
  });

  it('unsticks villagers via perpendicular sidestepping, re-routing, and scatterVillagers()', () => {
    const map = createDefaultMap();
    const sim = new VillageSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      autoConverse: false,
    });

    const walker = sim.runtimes.get(DEFAULT_VILLAGERS[0].id)!;
    const blocker = sim.runtimes.get(DEFAULT_VILLAGERS[1].id)!;
    // Clear neighbors out of the Village Square lane (y=16) so only walker and blocker interact
    sim.player.x = 14;
    sim.player.y = 14;
    for (const rt of sim.runtimes.values()) {
      if (rt.id !== walker.id && rt.id !== blocker.id) {
        rt.x = 14;
        rt.y = 14;
        rt.path = [];
      }
    }

    // Locate an open 6x3 walkable courtyard in createDefaultMap so walls don't confound blocker avoidance
    let baseX = 20;
    let baseY = 15;
    let foundOpen = false;
    for (let y = 2; y < map.height - 4 && !foundOpen; y++) {
      for (let x = 2; x < map.width - 7 && !foundOpen; x++) {
        let allClear = true;
        for (let dy = -1; dy <= 1 && allClear; dy++) {
          for (let dx = 0; dx <= 5 && allClear; dx++) {
            if (!isTileWalkable(map, x + dx, y + dy)) allClear = false;
          }
        }
        if (allClear) {
          baseX = x;
          baseY = y;
          foundOpen = true;
        }
      }
    }
    expect(foundOpen).toBe(true);

    walker.x = baseX;
    walker.y = baseY;
    walker.path = [
      { x: baseX + 1, y: baseY },
      { x: baseX + 2, y: baseY },
      { x: baseX + 3, y: baseY },
      { x: baseX + 4, y: baseY },
    ];
    walker.state = 'walking';

    blocker.x = baseX + 2;
    blocker.y = baseY;
    blocker.path = [];
    blocker.state = 'idle';

    for (let i = 0; i < 160; i++) {
      sim.stepFrame(0.05);
    }

    // Walker sidesteps/reroutes cleanly past blocker instead of deadlocking at baseX + 1.2
    expect(walker.x).toBeGreaterThan(baseX + 3);

    // Scatter should assign walkable destinations across idle villagers
    for (const rt of sim.runtimes.values()) {
      rt.path = [];
      rt.state = 'idle';
    }
    sim.scatterVillagers();
    const movingCount = Array.from(sim.runtimes.values()).filter((rt) => rt.path.length > 0).length;
    expect(movingCount).toBeGreaterThanOrEqual(DEFAULT_VILLAGERS.length - 1);
  });

  it('broadcasts @world / @all and multi-@ instructions to every targeted villager immediately', async () => {
    const map = createDefaultMap();
    const sim = new VillageSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      narratorEnabled: false,
    });

    const allTargets = parseMentionTargets(
      '@world @Olena gather near the windmill',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(allTargets.length).toBe(DEFAULT_VILLAGERS.length);
    expect(new Set(allTargets.map((t) => t.id)).size).toBe(DEFAULT_VILLAGERS.length);

    await sim.sendUserAddressedMessage(undefined, '@all scatter and check the windmill', false);
    for (const v of DEFAULT_VILLAGERS) {
      const rt = sim.runtimes.get(v.id)!;
      expect(rt.worldFeed?.some((ev) => ev.includes('@all scatter'))).toBe(true);
      expect(rt.path.length).toBeGreaterThan(0);
    }
  });

  it('separates <think> meta-reasoning from <thought> inner flow and spoken dialogue, with sound off by default', () => {
    expect(DEFAULT_MODEL_SETTINGS.eavesdropSpeech).toBe(true);
    expect(DEFAULT_MODEL_SETTINGS.eavesdropThoughts).toBe(false);
    expect(DEFAULT_MODEL_SETTINGS.showReasoning).toBe(false);
    expect(DEFAULT_MODEL_SETTINGS.speakReasoning).toBe(false);

    const parsed = parseDialogueAndNarration(
      '<think>I need to respond in character as Mara.</think><thought>Did Bram hide the brass key?</thought>*glances at the lantern* Mara: Who left the gate unlatched?',
      'Mara',
    );
    expect(parsed.reasoning).toEqual(['I need to respond in character as Mara.']);
    expect(parsed.thoughts).toEqual(['Did Bram hide the brass key?']);
    expect(parsed.narration).toEqual(['Glances at the lantern']);
    expect(parsed.spoken).toBe('Who left the gate unlatched?');
    expect(parsed.display).not.toContain('I need to respond in character');

    // Unclosed streaming <think> must never leak into story display
    const streaming = parseDialogueAndNarration('<think>I need to stay in character', 'Mara');
    expect(streaming.spoken).toBe('');
    expect(streaming.display).toBe('');
    expect(streaming.reasoning).toEqual(['I need to stay in character']);
  });

  it('keeps Scribe context- and location-aware around the focal landmark', async () => {
    const map = createDefaultMap();
    const sim = new VillageSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      narratorEnabled: true,
    });

    // Move traveler to Windmill Meadow (35, 20) and ask @Scribe what is happening
    sim.player.x = 35;
    sim.player.y = 20;
    await sim.sendUserAddressedMessage('narrator', '@Scribe describe what is happening here', false);

    const narConv = sim.conversations.find((c) => c.participantIds.includes('narrator'));
    expect(narConv).toBeDefined();
    const reply = narConv!.messages.find((m) => m.senderId === 'narrator');
    expect(reply?.senderName).toBe('Scribe');
    expect(reply?.text).toContain('Windmill');
  });

  it('routes @Character go to #POI and preserves POIs and macro stamps in map JSON', async () => {
    const map = createDefaultMap();
    map.stamps = [
      {
        id: 'stamp-house',
        name: 'Cottage',
        width: 2,
        height: 2,
        tiles: [10, 11, 42, 43],
        blocksMovement: true,
      },
    ];
    const sim = new VillageSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      narratorEnabled: true,
    });

    await sim.sendUserAddressedMessage(undefined, '@Mara go to #Plaza', false);
    const maraRt = sim.runtimes.get('v-mara')!;
    expect(maraRt.currentIntention).toContain('#Plaza');
    expect(maraRt.path.length).toBeGreaterThan(0);

    const json = exportVillageJson({
      map,
      villagers: DEFAULT_VILLAGERS,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      conversations: [],
      savedAt: 2000,
    });
    const parsed = parseImportedVillageJson(json);
    expect(parsed.map?.pointsOfInterest?.some((p) => p.tag === 'Plaza')).toBe(true);
    expect(parsed.map?.stamps?.[0].name).toBe('Cottage');
    expect(parsed.map?.stamps?.[0].tiles).toEqual([10, 11, 42, 43]);
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

  it('supports worldline POV hopping, psychophysical graph building, and natural-language world DB queries', async () => {
    const map = createDefaultMap();
    const sim = new VillageSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 10,
      enableWebSpeechFallback: false,
    });

    const mara = DEFAULT_VILLAGERS[0];
    const bram = DEFAULT_VILLAGERS[1];
    const maraRt = sim.runtimes.get(mara.id)!;
    const bramRt = sim.runtimes.get(bram.id)!;
    const now = Date.now();

    sim.conversations.push({
      id: 'conv-artifact-1',
      participantIds: [mara.id, bram.id],
      startedAt: now - 3600_000,
      updatedAt: now - 3500_000,
      active: false,
      messages: [
        {
          id: 'm1',
          senderId: mara.id,
          senderName: mara.name,
          text: 'Have you seen the glowing artifact near #Plaza?',
          timestamp: now - 3550_000,
          kind: 'speech',
          source: 'story-sim',
        },
        {
          id: 'm2',
          senderId: bram.id,
          senderName: bram.name,
          text: 'The artifact hums like clockwork — I think it is a relic.',
          timestamp: now - 3500_000,
          kind: 'speech',
          source: 'story-sim',
        },
      ],
    });
    bramRt.memories.push({
      id: 'mem-art',
      timestamp: now - 3400_000,
      importance: 8,
      kind: 'reflection',
      summary: 'Believes the artifact beneath #Plaza is an ancient clockwork beacon.',
    });

    // 1. Worldline POV hopping shifts audio listener & Scribe focus
    sim.setFocalWorldline(mara.id);
    expect(sim.getListenerPosition()).toEqual({
      x: maraRt.x,
      y: maraRt.y,
      label: mara.name,
      villagerId: mara.id,
    });

    // 2. Psychophysical graph links Mara <-> Bram
    const graph = buildPsychophysicalGraph(sim);
    expect(graph.nodes.some((n) => n.id === mara.id && n.type === 'character')).toBe(true);
    expect(graph.edges.some((e) => e.kind === 'interaction')).toBe(true);

    // 3. Natural-language query finds Mara's partners & thoughts on the artifact in past day
    const allRows = buildWorldDatabase(sim);
    expect(allRows.length).toBeGreaterThanOrEqual(3);

    const res = queryWorldDatabase(
      sim,
      `who has ${mara.name} talked to in the past day and what do they think about the artifact?`,
      now,
    );
    expect(res.subjectVillager?.id).toBe(mara.id);
    expect(res.partners.some((p) => p.id === bram.id)).toBe(true);
    expect(res.matchingRecords.some((r) => r.text.toLowerCase().includes('artifact'))).toBe(true);
    expect(res.answerSummary).toContain(bram.name);
  });

  it('exports/imports project, level, characters, characters+histories, and database, and clears DB for new story', () => {
    const map = createDefaultMap();
    const villagers = structuredClone(DEFAULT_VILLAGERS.slice(0, 2));
    const sim = new VillageSimulation(map, villagers, [], DEFAULT_MODEL_SETTINGS);
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
});
