import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  API_BRAIN_PRESETS,
  createDefaultMap,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VILLAGERS,
  getEffectiveVoice,
  IMAGE_GEN_PRESETS,
  OMNI_SPEECH_LANGUAGES,
  VOICE_BACKEND_PRESETS,
  WEBGPU_BRAIN_PRESETS,
} from '../../data/defaultData';
import { computeSpatialMix, EAVESDROP_WHOLE_MAP_RADIUS } from '../../ai/audioPipeline';
import { brainRouter, isTextTooSimilar, parseDialogueAndNarration } from '../../ai/brainRouter';
import {
  buildChatRequestSpec,
  generateImageViaApi,
  registerAgentImageHandler,
} from '../../ai/localApiClient';
import { SeloToolHost, seloToolHost } from '../../api/seloToolRegistry';
import { installSeloWebMcpAndApi } from '../../api/webMcpBridge';
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
import { SEGMENTATION_MODEL_PRESETS } from '../../ai/segmentationClient';
import {
  appendTilesToTileset,
  applyChromaKeyToPixelGrid,
  applyMacroStampToMap,
  computeAspectPreservingFootprint,
  computeSalientSeedPoints,
  createBlankTilesetDataUrl,
  createMacroStampFromIndices,
  detectMotifRegions,
  detectSalientMotifRegions,
  extractRegionsFromMatte,
  filterMaskCandidatesNMS,
  findNearestPaletteIndex,
  findOpenSlotForOutputBox,
  floodFillTransparent,
  getOpaqueBounds,
  hitTestBoxAction,
  parseAsciiPatternToGrid,
  parseHexColor,
  placeTilesInTilesetAt,
  processTilePixels,
  quantizeAndRebuildPixelGrid,
  remapTileIndicesInMap,
  removeEdgeBackground,
  repositionTilesInTileset,
  resizeBoxWithHandle,
  sampleNearestPaletteIndexFromImageData,
  sliceSelectionToTiles,
} from '../tapestrySampler';
import {
  createBlankWorldMap,
  createBulgarianShevitsaMap,
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

  it('sets LFM3-Omni all-in-one as first choice, keeps Bonsai-2 27B at the bottom, and includes webml-community WebGPU brain presets', () => {
    expect(WEBGPU_BRAIN_PRESETS[0].id).toBe('lfm3-omni-allinone');
    expect(WEBGPU_BRAIN_PRESETS[0].engine).toBe('lfm3-omni');
    expect(DEFAULT_MODEL_SETTINGS.brainEngine).toBe('lfm3-omni');

    const ids = WEBGPU_BRAIN_PRESETS.map((p) => p.id);
    expect(ids).toContain('lfm3-omni-allinone');
    expect(ids).toContain('lfm3-1.7b-local');
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

  it('prevents villagers from looping on repeated motives or dialogue lines', async () => {
    expect(
      isTextTooSimilar(
        'chase the brass key past the gate',
        ['chase the brass key before dusk'],
      ),
    ).toBe(true);
    expect(
      isTextTooSimilar(
        'Inspecting the stone markers around #Plaza',
        ['chase the brass key before dusk'],
      ),
    ).toBe(false);

    const map = createDefaultMap();
    const villagers = structuredClone(DEFAULT_VILLAGERS.slice(0, 2));
    const sim = new VillageSimulation(map, villagers, [], DEFAULT_MODEL_SETTINGS);
    const v0 = villagers[0]!;
    const v1 = villagers[1]!;
    const rt0 = sim.runtimes.get(v0.id)!;

    const motives: string[] = [];
    for (let i = 0; i < 4; i++) {
      const dec = await brainRouter.decideVillagerNextAction({
        villager: v0,
        runtime: rt0,
        otherNames: [v1.name],
        landmarkNames: ['#Plaza', '#River'],
        settings: DEFAULT_MODEL_SETTINGS,
      });
      motives.push(dec.motive);
    }
    expect(new Set(motives).size).toBeGreaterThanOrEqual(3);

    const replies: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await brainRouter.generateVillagerReply({
        villager: v0,
        runtime: rt0,
        partnerName: v1.name,
        history: [],
        settings: DEFAULT_MODEL_SETTINGS,
      });
      replies.push(res.text);
    }
    expect(new Set(replies).size).toBe(3);
  });

  it('supports Gemini, Claude, ChatGPT, GitHub, OpenRouter, Ollama, Voice, and Image Gen request configs', async () => {
    expect(API_BRAIN_PRESETS.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['ollama', 'lmstudio', 'gemini', 'anthropic', 'openai', 'github', 'openrouter']),
    );
    expect(VOICE_BACKEND_PRESETS.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['local-omni-webspeech', 'openai', 'gemini', 'openrouter', 'elevenlabs']),
    );
    expect(IMAGE_GEN_PRESETS.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['agent', 'openrouter', 'openai', 'gemini', 'local-sd', 'comfyui']),
    );

    const msgs = [
      { role: 'system' as const, content: 'You are Mara.' },
      { role: 'user' as const, content: 'Hello!' },
    ];
    const claudeSpec = buildChatRequestSpec({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-latest',
      apiKey: 'sk-ant-test',
      messages: msgs,
    });
    expect(claudeSpec.url).toBe('https://api.anthropic.com/v1/messages');
    expect(claudeSpec.headers['x-api-key']).toBe('sk-ant-test');
    expect(claudeSpec.body.system).toBe('You are Mara.');

    const geminiSpec = buildChatRequestSpec({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      apiKey: 'AIza-test',
      messages: msgs,
    });
    expect(geminiSpec.url).toContain('/models/gemini-2.5-flash:generateContent?key=AIza-test');
    expect(geminiSpec.body.systemInstruction.parts[0].text).toBe('You are Mara.');

    const openrouterSpec = buildChatRequestSpec({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-2.5-flash',
      apiKey: 'sk-or-test',
      messages: msgs,
    });
    expect(openrouterSpec.headers.Authorization).toBe('Bearer sk-or-test');
    expect(openrouterSpec.headers['X-Title']).toBe('SeloAI');

    // Agent image generation callback
    registerAgentImageHandler(async () => 'data:image/png;base64,iVBORw0KGgo=');
    try {
      const img = await generateImageViaApi(
        { prompt: 'Stone watchtower tileset', kind: 'tileset' },
        { ...DEFAULT_MODEL_SETTINGS, imageGenEnabled: true, imageGenProvider: 'agent' },
      );
      expect(img.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(img.provider).toBe('agent');
    } finally {
      registerAgentImageHandler(null);
    }
  });

  it('exposes full autonomous world/character/scenario tools to API, WebMCP, and stdio MCP server', async () => {
    let map = createDefaultMap();
    let villagers = structuredClone(DEFAULT_VILLAGERS.slice(0, 2));
    let settings = { ...DEFAULT_MODEL_SETTINGS };
    const sim = new VillageSimulation(map, villagers, [], settings);

    const host = new SeloToolHost({
      getSimulation: () => sim,
      getMap: () => map,
      getVillagers: () => villagers,
      getSettings: () => settings,
      applyMap: (next) => {
        map = next;
        sim.updateMap(next);
      },
      applyVillagers: (next) => {
        villagers = next;
        sim.syncVillagers(next);
      },
      updateSettings: (patch) => {
        settings = { ...settings, ...patch };
        sim.updateSettings(settings);
      },
    });

    // Autonomous scenario build + interact + query + export
    const scenario = await host.callTool('run_scenario', {
      worldName: 'Clockwork Keep',
      width: 28,
      height: 22,
      clearDatabase: true,
      pois: [{ tag: 'Watchtower', label: 'North Watchtower', x: 14, y: 8 }],
      villagers: [
        { name: 'Kaelen', role: 'Ranger', identity: 'Alert scout.', plan: 'Patrol Watchtower', x: 10, y: 10 },
        { name: 'Vesper', role: 'Archivist', identity: 'Tracks relics.', plan: 'Inspect Watchtower', x: 12, y: 10 },
      ],
      focalWorldlineId: 'Kaelen',
      openingDirective: '@Kaelen go to #Watchtower',
    });
    expect(scenario.ok).toBe(true);
    expect(map.name).toBe('Clockwork Keep');
    expect(villagers.some((v) => v.name === 'Kaelen')).toBe(true);
    expect(sim.focalWorldlineId.toLowerCase()).toContain('kaelen');

    const dbRes = await host.callTool('query_world_db', {
      query: 'Watchtower',
      includeGraph: true,
    });
    expect(dbRes.totalRecords).toBeGreaterThanOrEqual(1);
    expect(dbRes.graph?.nodes?.length).toBeGreaterThan(0);

    const cfgRes = await host.callTool('configure_backends', {
      localApiProvider: 'openrouter',
      localApiKey: 'secret-key-123',
      imageGenEnabled: true,
      imageGenProvider: 'openrouter',
    });
    expect(cfgRes.settings.localApiProvider).toBe('openrouter');
    expect(cfgRes.settings.localApiKey).toBe('***');

    // WebMCP navigator.modelContext registration check
    const registered: string[] = [];
    const origNav = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        modelContext: {
          registerTool: (t: any) => registered.push(t.name),
          unregisterTool: () => {},
        },
      },
    });
    seloToolHost.setHooks({
      getSimulation: () => sim,
      getMap: () => map,
      getVillagers: () => villagers,
      getSettings: () => settings,
      applyMap: (next) => {
        map = next;
      },
      applyVillagers: (next) => {
        villagers = next;
      },
      updateSettings: (patch) => {
        settings = { ...settings, ...patch };
      },
    });
    const cleanup = installSeloWebMcpAndApi();
    try {
      expect(registered.length).toBe(host.listTools().length);
      expect(registered).toContain('seloai_run_scenario');
    } finally {
      cleanup();
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: origNav });
    }

    // Stdio MCP server smoke test (initialize -> tools/list -> tools/call)
    const mcpResponses = await new Promise<any[]>((resolve, reject) => {
      const child = spawn('node', ['mcp/seloai-mcp-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, SELOAI_BRIDGE_URL: 'http://127.0.0.1:1/closed' },
      });
      const out: any[] = [];
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) {
          if (l.trim()) out.push(JSON.parse(l));
        }
        if (out.length >= 3) {
          child.kill();
          resolve(out);
        }
      });
      child.on('error', reject);
      setTimeout(() => {
        child.kill();
        reject(new Error(`MCP server timeout, got ${out.length} responses`));
      }, 4000);

      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'run_scenario',
            arguments: { worldName: 'MCP Fortress', pois: [{ tag: 'Gate', label: 'Main Gate', x: 5, y: 5 }] },
          },
        }) + '\n',
      );
    });
    expect(mcpResponses[0].result.serverInfo.name).toBe('seloai-mcp');
    expect(mcpResponses[1].result.tools.length).toBe(host.listTools().length);
    const callPayload = JSON.parse(mcpResponses[2].result.content[0].text);
    expect(callPayload.ok).toBe(true);
    expect(callPayload.world.map.name).toBe('MCP Fortress');
  });

  it('builds a walkable tile map based on the 7 regional Bulgarian Shevitsa embroidery patterns', async () => {
    const shevitsaMap = createBulgarianShevitsaMap();
    expect(shevitsaMap.width).toBe(64);
    expect(shevitsaMap.height).toBe(48);
    expect(shevitsaMap.tileSetUrl).toContain('shevitsa-tileset.png');

    const tags = (shevitsaMap.pointsOfInterest ?? []).map((p) => p.tag);
    expect(tags).toContain('Elbetitsa');
    expect(tags).toContain('TreeOfLife');
    expect(tags).toContain('PirinLabyrinth');
    expect(tags).toContain('RhodopeRosette');
    expect(tags).toContain('ChiprovtsiLoom');
    expect(tags).toContain('DobrudzhaPlains');
    expect(tags).toContain('StrandzhaGate');
    expect(tags).toContain('DanubeFord');

    // Verify all POIs are walkable
    for (const poi of shevitsaMap.pointsOfInterest ?? []) {
      expect(isTileWalkable(shevitsaMap, poi.x, poi.y)).toBe(true);
    }

    // Pathfinding across the regional embroidery hubs
    const elbetitsa = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'Elbetitsa')!;
    const treeOfLife = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'TreeOfLife')!;
    const pirin = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'PirinLabyrinth')!;
    const rhodope = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'RhodopeRosette')!;
    const dobrudzha = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'DobrudzhaPlains')!;
    const chiprovtsi = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'ChiprovtsiLoom')!;
    const danube = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'DanubeFord')!;

    const pathToTree = findPath(shevitsaMap, elbetitsa, treeOfLife);
    expect(pathToTree.length).toBeGreaterThan(0);

    const pathToPirin = findPath(shevitsaMap, elbetitsa, pirin);
    expect(pathToPirin.length).toBeGreaterThan(0);

    const pathToRhodope = findPath(shevitsaMap, treeOfLife, rhodope);
    expect(pathToRhodope.length).toBeGreaterThan(0);

    const pathToDobrudzha = findPath(shevitsaMap, treeOfLife, dobrudzha);
    expect(pathToDobrudzha.length).toBeGreaterThan(0);

    const pathToChiprovtsi = findPath(shevitsaMap, elbetitsa, chiprovtsi);
    expect(pathToChiprovtsi.length).toBeGreaterThan(0);

    const pathToDanube = findPath(shevitsaMap, chiprovtsi, danube);
    expect(pathToDanube.length).toBeGreaterThan(0);

    // Verify Tile Macro Stamps for the Level Editor
    const stampNames = (shevitsaMap.stamps ?? []).map((s) => s.name);
    expect(stampNames).toContain('Shopluk Elbetitsa (8-Fold Star)');
    expect(stampNames).toContain('Tree of Life & Paired Birds');
    expect(stampNames).toContain('Pirin Stepped Labyrinth (Pink & Blue)');
    expect(stampNames).toContain('Rhodope Sunburst Rosette');
    expect(stampNames).toContain('Chiprovtsi Kilim Diamond Loom');

    // Round-trip level export
    const json = exportLevelJson(shevitsaMap);
    const parsed = parseImportedVillageJson(json);
    expect(parsed.map?.name).toBe(shevitsaMap.name);
    expect(parsed.map?.pointsOfInterest?.length).toBe(shevitsaMap.pointsOfInterest?.length);
    expect(parsed.map?.stamps?.length).toBe(shevitsaMap.stamps?.length);

    // Verify tool execution via seloToolHost with preset: 'shevitsa'
    const toolRes = await seloToolHost.callTool('create_world', { preset: 'shevitsa' });
    expect(toolRes.ok).toBe(true);
    expect(toolRes.map.name).toContain('Шевици');
  });

  it('slices imported tapestry/painting crops into tiles, removes background color, and creates macro stamps', async () => {
    // 1. Test sliceSelectionToTiles calculation
    const sliced = sliceSelectionToTiles(
      {} as any,
      400,
      300,
      { x: 32, y: 64, w: 96, h: 64 },
      32,
    );
    expect(sliced.cols).toBe(3);
    expect(sliced.rows).toBe(2);
    expect(sliced.tileDim).toBe(32);

    // 2. Test chroma-key background transparency filtering
    const mockData = {
      data: new Uint8ClampedArray([
        255, 255, 255, 255, // Exact white -> transparent
        250, 250, 250, 255, // Near white -> transparent within tolerance
        190, 30, 45, 255,   // Crimson thread -> kept opaque
        34, 119, 60, 255,   // Green thread -> kept opaque
      ]),
    } as ImageData;

    processTilePixels(mockData, {
      chromaKey: { r: 255, g: 255, b: 255, tolerance: 20 },
    });

    expect(mockData.data[3]).toBe(0); // White made transparent
    expect(mockData.data[7]).toBe(0); // Near white made transparent
    expect(mockData.data[11]).toBe(255); // Crimson preserved
    expect(mockData.data[15]).toBe(255); // Green preserved

    // 3. Test appending new tiles to an existing tileset
    const appended = await appendTilesToTileset(
      null,
      512,
      512,
      32,
      Array.from({ length: 6 }, () => ({} as any)),
    );
    expect(appended.startTileIndex).toBe(256);
    expect(appended.tileIndices).toEqual([256, 257, 258, 259, 260, 261]);
    expect(appended.newDimX).toBe(512);
    expect(appended.newDimY).toBeGreaterThanOrEqual(512 + 32);

    // 4. Test Macro Stamp generation
    const stamp = createMacroStampFromIndices(
      'Custom Shevitsa Bird',
      3,
      2,
      appended.tileIndices,
      'obj0',
      true,
    );
    expect(stamp.name).toBe('Custom Shevitsa Bird');
    expect(stamp.width).toBe(3);
    expect(stamp.height).toBe(2);
    expect(stamp.tiles.length).toBe(6);
    expect(stamp.layer).toBe('obj0');
    expect(stamp.blocksMovement).toBe(true);
  });

  it('removes edge background while preserving enclosed interior details and computes tight opaque bounds', () => {
    // 5x5 image: white border, 3x3 crimson ring at [1..3, 1..3], white center pixel at (2,2)
    const w = 5;
    const h = 5;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const isRing =
          x >= 1 && x <= 3 && y >= 1 && y <= 3 && !(x === 2 && y === 2);
        if (isRing) {
          buf[i] = 190;
          buf[i + 1] = 30;
          buf[i + 2] = 45;
          buf[i + 3] = 255;
        } else {
          buf[i] = 255;
          buf[i + 1] = 255;
          buf[i + 2] = 255;
          buf[i + 3] = 255;
        }
      }
    }
    const imgData = { width: w, height: h, data: buf } as ImageData;

    removeEdgeBackground(imgData, 15);

    // Outer border (0,0) should be transparent
    expect(imgData.data[3]).toBe(0);
    // Ring pixel (1,1) should stay opaque
    expect(imgData.data[(1 * w + 1) * 4 + 3]).toBe(255);
    // Enclosed white center (2,2) should stay opaque
    expect(imgData.data[(2 * w + 2) * 4 + 3]).toBe(255);

    // Tight opaque bounds should be { x: 1, y: 1, w: 3, h: 3 }
    expect(getOpaqueBounds(imgData)).toEqual({ x: 1, y: 1, w: 3, h: 3 });

    // Magic wand click on center (2,2) removes just the enclosed center
    floodFillTransparent(imgData, [{ x: 2, y: 2 }], 15);
    expect(imgData.data[(2 * w + 2) * 4 + 3]).toBe(0);
    expect(imgData.data[(1 * w + 1) * 4 + 3]).toBe(255);
  });

  it('auto-slices disconnected motifs and rebuilds crisp quantized pixel art with procedural Canvas2D code', () => {
    // Build a 32x16 transparent canvas with two 8x8 motifs:
    // Motif 1 (crimson) at x=2..9, y=2..9; Motif 2 (emerald) at x=20..27, y=4..11
    const w = 32;
    const h = 16;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (x >= 2 && x <= 9 && y >= 2 && y <= 9) {
          buf[i] = 190;
          buf[i + 1] = 30;
          buf[i + 2] = 45;
          buf[i + 3] = 255;
        } else if (x >= 20 && x <= 27 && y >= 4 && y <= 11) {
          buf[i] = 34;
          buf[i + 1] = 139;
          buf[i + 2] = 74;
          buf[i + 3] = 255;
        }
      }
    }
    const imgData = { width: w, height: h, data: buf } as ImageData;

    const regions = detectMotifRegions(imgData, { minSize: 6, mergeGap: 2 });
    expect(regions).toEqual([
      { x: 2, y: 2, w: 8, h: 8 },
      { x: 20, y: 4, w: 8, h: 8 },
    ]);

    const rebuilt = quantizeAndRebuildPixelGrid(imgData, 16, 8, 4, 'ShevitsaPair');
    expect(rebuilt.gridWidth).toBe(16);
    expect(rebuilt.gridHeight).toBe(8);
    expect(rebuilt.palette.length).toBe(2);
    expect(rebuilt.proceduralCode).toContain('export function drawShevitsaPair(');
    expect(rebuilt.proceduralCode).toContain('ctx.fillRect(');

    // Apply chroma-key transparency directly to indexed pattern layer & palette
    const bgRgb = parseHexColor('#fafdf4')!;
    expect(bgRgb).toEqual({ r: 250, g: 253, b: 244 });
    const keyed = applyChromaKeyToPixelGrid(
      [0, 1, 2, 0, -1, 1],
      ['#fafdf4', '#be1e2d', '#f5f8ee'],
      { ...bgRgb, tolerance: 10 },
    );
    expect(keyed.palette).toEqual(['#be1e2d']);
    expect(keyed.grid).toEqual([-1, 0, -1, -1, -1, 0]);
    expect(keyed.removedCells).toBe(3);
    expect(keyed.removedSwatches).toBe(2);
  });

  it('places, repositions, and remaps tiles in output tilesets and sample-brushes palette swatches', async () => {
    const blank = createBlankTilesetDataUrl(8, 4, 32);
    expect(blank.dimX).toBe(256);
    expect(blank.dimY).toBe(128);

    const dummyTiles = Array.from({ length: 4 }, () => ({}) as HTMLCanvasElement);
    const placed = await placeTilesInTilesetAt(null, 256, 128, 32, dummyTiles, 3, 1, 2, 2);
    // 8 cols: row 1 cols 3..4 -> 11,12 ; row 2 cols 3..4 -> 19,20
    expect(placed.tileIndices).toEqual([11, 12, 19, 20]);
    expect(placed.newDimY).toBe(128);

    // Expanding past bottom row (startRow 3 with 2 rows tall -> 5 rows = 160px)
    const expanded = await placeTilesInTilesetAt(null, 256, 128, 32, dummyTiles, 0, 3, 2, 2);
    expect(expanded.tileIndices).toEqual([24, 25, 32, 33]);
    expect(expanded.newDimY).toBe(160);

    // Reposition swap mode between two 2x1 blocks: (1, 0) <-> (4, 1) in 8-col tileset
    const swapped = await repositionTilesInTileset(null, 256, 128, 32, 1, 0, 4, 1, 2, 1, 'swap');
    expect(swapped.srcIndices).toEqual([1, 2]);
    expect(swapped.dstIndices).toEqual([12, 13]);
    expect(swapped.indexRemap).toEqual({ 1: 12, 2: 13, 12: 1, 13: 2 });

    // Move mode only maps source -> dst
    const moved = await repositionTilesInTileset(null, 256, 128, 32, 0, 0, 2, 0, 1, 1, 'move');
    expect(moved.indexRemap).toEqual({ 0: 2 });

    const baseMap = createDefaultMap();
    baseMap.bgTiles[0][1][1] = 1;
    baseMap.bgTiles[0][2][1] = 12;
    baseMap.bgTiles[0][3][1] = 5;
    baseMap.objectTiles[0][1][1] = 2;
    baseMap.stamps = [
      createMacroStampFromIndices('Test', 2, 1, [1, 2], 'bg1', false),
    ];
    const remappedMap = remapTileIndicesInMap(baseMap, swapped.indexRemap);
    expect(remappedMap.bgTiles[0][1][1]).toBe(12);
    expect(remappedMap.bgTiles[0][2][1]).toBe(1);
    expect(remappedMap.bgTiles[0][3][1]).toBe(5);
    expect(remappedMap.objectTiles[0][1][1]).toBe(13);
    expect(remappedMap.stamps?.[0].tiles).toEqual([12, 13]);

    // Palette nearest match + Sample Brush cell approximation
    const palette = ['#be1e2d', '#228b4a', '#1f2937'];
    expect(findNearestPaletteIndex(195, 28, 44, palette)).toBe(0);
    expect(findNearestPaletteIndex(36, 140, 72, palette)).toBe(1);

    // 2x2 cell: 1 transparent pixel + 3 green-ish pixels
    const fgCell = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        0, 0, 0, 0,
        32, 138, 70, 255,
        36, 142, 76, 255,
        34, 136, 74, 255,
      ]),
    } as ImageData;
    expect(sampleNearestPaletteIndexFromImageData(fgCell, palette)).toBe(1);

    // Cell matching chroma-keyed background resolves to transparent (-1)
    const bgCell = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        250, 253, 244, 255,
        251, 252, 245, 255,
        249, 253, 243, 255,
        250, 251, 244, 255,
      ]),
    } as ImageData;
    expect(
      sampleNearestPaletteIndexFromImageData(bgCell, palette, { r: 250, g: 253, b: 244, tolerance: 8 }),
    ).toBe(-1);
  });

  it('hit-tests, resizes with snap/aspect lock, and finds non-overlapping slots for multi-pattern output composition', () => {
    const box = { x: 32, y: 32, w: 64, h: 32 };
    expect(hitTestBoxAction(box, 32, 32, 2)).toBe('nw');
    expect(hitTestBoxAction(box, 96, 64, 2)).toBe('se');
    expect(hitTestBoxAction(box, 64, 32, 2)).toBe('n');
    expect(hitTestBoxAction(box, 96, 48, 2)).toBe('e');
    expect(hitTestBoxAction(box, 64, 48, 2)).toBe('move');
    expect(hitTestBoxAction(box, 140, 140, 2)).toBeNull();

    // Resizing southeast handle with 16px snap
    const resizedSnap = resizeBoxWithHandle(box, 'se', 110, 88, 256, 128, 16, 8, false);
    expect(resizedSnap).toEqual({ x: 32, y: 32, w: 80, h: 64 });

    // Resizing southeast handle with aspect ratio lock (2:1 original ratio)
    const resizedAspect = resizeBoxWithHandle(box, 'se', 160, 60, 256, 128, 1, 8, true);
    expect(resizedAspect.w).toBe(128);
    expect(resizedAspect.h).toBe(64);

    // Non-overlapping placement across occupied layer boxes + occupied base tiles
    const existingLayers = [
      { x: 0, y: 0, w: 32, h: 96 }, // occupies col 0, rows 0..2
      { x: 32, y: 0, w: 32, h: 32 }, // occupies col 1, row 0
    ];
    // Mark col 2, row 0 base tile as occupied too
    const nextSlot = findOpenSlotForOutputBox(
      existingLayers,
      4,
      3,
      32,
      32,
      32,
      (c, r) => c === 2 && r === 0,
    );
    expect(nextSlot).toEqual({ x: 96, y: 0, requiredRows: 3 });

    // Full sheet forces row expansion below existing bottom row
    const fullRowOccupied = [{ x: 0, y: 0, w: 128, h: 64 }];
    const expandedSlot = findOpenSlotForOutputBox(fullRowOccupied, 4, 2, 32, 64, 32);
    expect(expandedSlot).toEqual({ x: 0, y: 64, requiredRows: 3 });
  });

  it('parses ASCII pixel art grids and applies macro stamps cleanly to world maps', () => {
    const parsed = parseAsciiPatternToGrid(
      ['.R.', 'RGR', '.R.'],
      { R: '#c2272d', G: '#3c6e47' },
    );
    expect(parsed.gridWidth).toBe(3);
    expect(parsed.gridHeight).toBe(3);
    expect(parsed.palette).toEqual(['#c2272d', '#3c6e47']);
    expect(parsed.grid).toEqual([-1, 0, -1, 0, 1, 0, -1, 0, -1]);

    const blankMap = createBlankWorldMap('Stamp Test', 12, 10);
    const stamp = createMacroStampFromIndices('Diamond', 2, 2, [10, 11, 12, 13], 'obj0', true);
    const stamped = applyMacroStampToMap(blankMap, stamp, 4, 5);
    expect(stamped.objectTiles[0][4][5]).toBe(10);
    expect(stamped.objectTiles[0][5][5]).toBe(11);
    expect(stamped.objectTiles[0][4][6]).toBe(12);
    expect(stamped.objectTiles[0][5][6]).toBe(13);
    expect(stamped.collisionGrid[4][5]).toBe(true);
    expect(stamped.collisionGrid[5][6]).toBe(true);
  });

  it('supports all 19 SeloAI tools including tapestry tab, stamps, ASCII pattern composition, and headless MCP parity', async () => {
    let map = createBlankWorldMap('Tool Test', 24, 18);
    let villagers = structuredClone(DEFAULT_VILLAGERS.slice(0, 1));
    let settings = { ...DEFAULT_MODEL_SETTINGS };
    let activeTab = 'village';
    const sim = new VillageSimulation(map, villagers, [], settings);

    const host = new SeloToolHost({
      getSimulation: () => sim,
      getMap: () => map,
      getVillagers: () => villagers,
      getSettings: () => settings,
      applyMap: (next) => {
        map = next;
        sim.updateMap(next);
      },
      applyVillagers: (next) => {
        villagers = next;
        sim.syncVillagers(next);
      },
      updateSettings: (patch) => {
        settings = { ...settings, ...patch };
        sim.updateSettings(settings);
      },
      setTab: (tab) => {
        activeTab = tab;
      },
    });

    const tools = host.listTools();
    expect(tools).toHaveLength(19);
    expect(tools.some((t) => t.name === 'compose_pixel_pattern')).toBe(true);

    // Switch to Tapestry Studio tab + run Shevitsa scenario preset
    const tabRes = await host.callTool('control_simulation', { tab: 'tapestry' });
    expect(tabRes.ok).toBe(true);
    expect(activeTab).toBe('tapestry');

    const shevRes = await host.callTool('run_scenario', {
      worldPreset: 'shevitsa',
      worldName: 'Shevitsa Loom Square',
    });
    expect(shevRes.ok).toBe(true);
    expect(map.name).toBe('Shevitsa Loom Square');
    expect(map.tileSetUrl).toContain('shevitsa-tileset.png');

    // Add + place a macro stamp via edit_world_map
    const editRes = await host.callTool('edit_world_map', {
      addStamps: [
        {
          id: 'custom-rug-runner',
          name: 'Rug Runner',
          width: 2,
          height: 1,
          layer: 'bg0',
          tiles: [14, 15],
        },
      ],
      placeStamps: [{ stampId: 'custom-rug-runner', x: 3, y: 3, layer: 'bg0' }],
    });
    expect(editRes.ok).toBe(true);
    expect(map.bgTiles[0][3][3]).toBe(14);
    expect(map.bgTiles[0][4][3]).toBe(15);

    // Compose crisp ASCII pixel art into the tileset and place onto the map
    const composeRes = await host.callTool('compose_pixel_pattern', {
      name: 'Rose Diamond',
      asciiRows: ['.RR.', 'RYYR', 'RYYR', '.RR.'],
      paletteMap: { R: '#c2272d', Y: '#d9a441' },
      outCols: 2,
      outRows: 1,
      targetCol: 0,
      targetRow: 2,
      layer: 'obj0',
      blocksMovement: true,
      applyToMap: true,
      placeAt: { x: 6, y: 7 },
    });
    expect(composeRes.ok).toBe(true);
    expect(composeRes.stamp.width).toBe(2);
    expect(composeRes.stamp.height).toBe(1);
    expect(composeRes.placedAt).toEqual({ x: 6, y: 7 });
    expect(composeRes.proceduralCode).toContain('drawRoseDiamondPalette');
    const sheetCols = Math.floor((map.tileSetDimX ?? 512) / (map.tileDim ?? 32));
    expect(map.objectTiles[0][6][7]).toBe(2 * sheetCols);
    expect(map.objectTiles[0][7][7]).toBe(2 * sheetCols + 1);
    expect(map.collisionGrid[6][7]).toBe(true);

    // Verify stdio MCP headless parity for new tools & arguments
    const mcpResponses = await new Promise<any[]>((resolve, reject) => {
      const child = spawn('node', ['mcp/seloai-mcp-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, SELOAI_BRIDGE_URL: 'http://127.0.0.1:1/closed' },
      });
      const out: any[] = [];
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) {
          if (l.trim()) out.push(JSON.parse(l));
        }
        if (out.length >= 4) {
          child.kill();
          resolve(out);
        }
      });
      child.on('error', reject);
      setTimeout(() => {
        child.kill();
        reject(new Error(`MCP headless parity timeout, got ${out.length} responses`));
      }, 4000);

      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'control_simulation', arguments: { tab: 'tapestry' } },
        }) + '\n',
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'create_world', arguments: { preset: 'shevitsa' } },
        }) + '\n',
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'compose_pixel_pattern',
            arguments: { name: 'MCP Motif', outCols: 2, outRows: 1, targetCol: 1, targetRow: 1, placeAt: { x: 2, y: 3 } },
          },
        }) + '\n',
      );
    });
    expect(mcpResponses[0].result.tools).toHaveLength(19);
    expect(JSON.parse(mcpResponses[1].result.content[0].text).tab).toBe('tapestry');
    expect(JSON.parse(mcpResponses[2].result.content[0].text).preset).toBe('shevitsa');
    const mcpCompose = JSON.parse(mcpResponses[3].result.content[0].text);
    expect(mcpCompose.ok).toBe(true);
    expect(mcpCompose.placedAt).toEqual({ x: 2, y: 3 });
  });

  it('auto-slices colorful motifs inside closed outline maps without merging into full-page boxes', () => {
    const w = 240;
    const h = 180;
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      buf[o] = 250;
      buf[o + 1] = 248;
      buf[o + 2] = 242;
      buf[o + 3] = 255;
    }

    // Draw closed 2px grey border around entire interior (simulates map border that blocked removeEdgeBackground)
    for (let x = 10; x <= 230; x++) {
      for (const y of [10, 11, 168, 169]) {
        const o = (y * w + x) * 4;
        buf[o] = 192;
        buf[o + 1] = 192;
        buf[o + 2] = 190;
      }
    }
    for (let y = 10; y < 170; y++) {
      for (const x of [10, 11, 229, 230]) {
        const o = (y * w + x) * 4;
        buf[o] = 192;
        buf[o + 1] = 192;
        buf[o + 2] = 190;
      }
    }

    const paintBlock = (bx: number, by: number, bw: number, bh: number, r: number, g: number, b: number) => {
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const o = (y * w + x) * 4;
          buf[o] = r;
          buf[o + 1] = g;
          buf[o + 2] = b;
        }
      }
    };

    // 3 distinct motifs inside the closed outline with varied aspect ratios
    paintBlock(28, 28, 28, 28, 190, 30, 45); // Square crimson
    paintBlock(110, 26, 72, 22, 34, 139, 74); // Wide emerald border banner
    paintBlock(130, 88, 26, 60, 30, 64, 175); // Tall sapphire emblem

    const imgData = { width: w, height: h, data: buf } as ImageData;
    const regions = detectSalientMotifRegions(imgData, {
      minSize: 12,
      mergeGap: 4,
      bgTolerance: 28,
    });

    // Must isolate individual motifs inside the closed map outline (not one 220x160 full-page box)
    expect(regions.length).toBeGreaterThanOrEqual(3);
    expect(regions.every((r) => r.w < 140 && r.h < 120)).toBe(true);
    expect(regions.some((r) => r.w > r.h * 2)).toBe(true); // Wide banner preserved
    expect(regions.some((r) => r.h > r.w * 1.6)).toBe(true); // Tall emblem preserved

    const seeds = computeSalientSeedPoints(imgData, 12);
    expect(seeds.length).toBeGreaterThan(0);
    // Seeds must avoid outer cream paper corner (0,0)
    expect(seeds.every((s) => s.x >= 8 && s.y >= 8)).toBe(true);
  });

  it('preserves crop aspect ratios, deduplicates overlapping masks with NMS, and exposes AI segmentation presets', () => {
    const square = computeAspectPreservingFootprint(64, 64, 4, 4, 32, 16);
    expect(square.outCols).toBe(square.outRows);
    expect(square.gridWidth).toBe(square.gridHeight);

    const wide = computeAspectPreservingFootprint(160, 40, 4, 4, 32, 16);
    expect(wide.outCols).toBe(4);
    expect(wide.outRows).toBe(1);
    expect(wide.gridWidth / wide.gridHeight).toBe(4);

    const tall = computeAspectPreservingFootprint(36, 120, 4, 4, 32, 16);
    expect(tall.outRows).toBeGreaterThan(tall.outCols);
    expect(tall.gridHeight).toBeGreaterThan(tall.gridWidth);

    const mw = 40;
    const mh = 40;
    const maskA = new Uint8Array(mw * mh);
    const maskB = new Uint8Array(mw * mh);
    const maskC = new Uint8Array(mw * mh);
    for (let y = 4; y < 16; y++) {
      for (let x = 4; x < 16; x++) {
        maskA[y * mw + x] = 255;
        maskB[y * mw + x] = 255; // exact duplicate overlap
      }
    }
    for (let y = 22; y < 34; y++) {
      for (let x = 22; x < 34; x++) {
        maskC[y * mw + x] = 255;
      }
    }

    const deduped = filterMaskCandidatesNMS(
      [
        { crop: { x: 4, y: 4, w: 12, h: 12 }, mask: maskA, score: 0.92, label: 'Motif A' },
        { crop: { x: 4, y: 4, w: 12, h: 12 }, mask: maskB, score: 0.71, label: 'Dup A' },
        { crop: { x: 22, y: 22, w: 12, h: 12 }, mask: maskC, score: 0.85, label: 'Motif C' },
      ],
      mw,
      mh,
      0.55,
      6,
    );
    expect(deduped).toHaveLength(2);
    expect(deduped.map((d) => d.label)).toEqual(['Motif A', 'Motif C']);

    const mergedMatte = new Uint8Array(mw * mh);
    for (let i = 0; i < mw * mh; i++) {
      mergedMatte[i] = Math.max(maskA[i], maskC[i]);
    }
    const extracted = extractRegionsFromMatte(mergedMatte, mw, mh, {
      minSize: 6,
      mergeGap: 2,
      matteThreshold: 112,
    });
    expect(extracted).toHaveLength(2);
    expect(extracted[0].crop).toEqual({ x: 4, y: 4, w: 12, h: 12 });
    expect(extracted[1].crop).toEqual({ x: 22, y: 22, w: 12, h: 12 });

    expect(SEGMENTATION_MODEL_PRESETS.map((p) => p.id)).toEqual([
      'contrast-fast',
      'edgetam',
      'sam2-tiny',
      'sam3-tracker',
      'grounding-dino',
      'yolos-tiny',
      'ormbg',
    ]);
    expect(SEGMENTATION_MODEL_PRESETS.find((p) => p.id === 'edgetam')?.supportsClickPrompt).toBe(true);
    expect(SEGMENTATION_MODEL_PRESETS.find((p) => p.id === 'sam3-tracker')?.repoId).toBe(
      'onnx-community/sam3-tracker-ONNX',
    );
  });
});
