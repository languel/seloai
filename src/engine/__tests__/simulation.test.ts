import { createBrowserSimulation } from '../../app/browserSimulation';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { computeSpatialMix, EAVESDROP_WHOLE_MAP_RADIUS } from '../../ai/audioPipeline';
import { brainRouter, isTextTooSimilar, parseDialogueAndNarration } from '../../ai/brainRouter';
import { findNearestWalkableTile, findPath, isTileWalkable } from '../pathfinding';
import {
  CHAR_COLLISION_RADIUS,
  computeBubbleDurationMs,
  parseMentionTargets,
  VillageSimulation,
} from '../simulation';
import { exportProjectJson, parseImportedVillageJson } from '../../storage/villageStore';

describe('Simulation', () => {
  it('creates default map and finds walkable paths around collisions', () => {
    const map = createDefaultMap();
    expect(map.width).toBe(48);
    expect(map.height).toBe(36);

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
    const sim = createBrowserSimulation(
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

  it('interleaves Scribe narration and alternate NPC turns in strict sequence without self-names', async () => {
    const map = createDefaultMap();
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
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
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
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

  it('routes @Scribe narration, @Target replies, multi-target turn order, and @Mara world directions', async () => {
    const map = createDefaultMap();
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
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
      '@Stoyan tell me about the clockwork forge',
      false,
    );
    expect(bramRes.focusedTargetId).toBe('stoyan');
    const bramConv = sim.conversations.find(
      (c) => c.participantIds.includes('stoyan') && c.messages.some((m) => m.senderId === 'stoyan'),
    );
    expect(bramConv).toBeDefined();

    // 3. Multi-target @Scribe @Mara @Bram turn order
    const multiRes = await sim.sendUserAddressedMessage(
      undefined,
      '@Scribe @Tsveta @Stoyan gather and share your thoughts',
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
    expect(replySenders).toEqual(['narrator', 'tsveta', 'stoyan']);

    // 4. World direction "@Mara walk to Windmill Meadow" updates intention & path
    await sim.sendUserAddressedMessage(
      undefined,
      '@Tsveta walk to Kukeri Fire Hearth',
      false,
    );
    const maraRt = sim.runtimes.get('tsveta')!;
    expect(maraRt.currentIntention?.toLowerCase()).toContain('kukeri');
    expect(maraRt.path.length).toBeGreaterThan(0);
  });

  it('produces creative non-repetitive DM beats and avoids reciting villager job titles in dialogue', async () => {
    const map = createDefaultMap();
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
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
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
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
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
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

  it('keeps Scribe context- and location-aware around the focal landmark', async () => {
    const map = createDefaultMap();
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      narratorEnabled: true,
    });

    // Move traveler to Windmill Meadow (35, 20) and ask @Scribe what is happening
    sim.player.x = 34;
    sim.player.y = 23;
    await sim.sendUserAddressedMessage('narrator', '@Scribe describe what is happening here', false);

    const narConv = sim.conversations.find((c) => c.participantIds.includes('narrator'));
    expect(narConv).toBeDefined();
    const reply = narConv!.messages.find((m) => m.senderId === 'narrator');
    expect(reply?.senderName).toBe('The Scribe');
    expect(reply?.text).toContain('Kukeri Fire Hearth');
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
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      narratorEnabled: true,
    });

    await sim.sendUserAddressedMessage(undefined, '@Tsveta go to #KhoroStar', false);
    const maraRt = sim.runtimes.get('tsveta')!;
    expect(maraRt.currentIntention).toContain('Elbetitsa Khoro Square');
    expect(maraRt.currentIntention).not.toContain('#');
    expect(maraRt.path.length).toBeGreaterThan(0);

    const json = exportProjectJson({
      map,
      villagers: DEFAULT_VILLAGERS,
      modelSettings: DEFAULT_MODEL_SETTINGS,
      conversations: [],
      savedAt: 2000,
    });
    const parsed = parseImportedVillageJson(json);
    expect(parsed.map?.pointsOfInterest?.some((p) => p.tag === 'KhoroStar')).toBe(true);
    expect(parsed.map?.stamps?.[0].name).toBe('Cottage');
    expect(parsed.map?.stamps?.[0].tiles).toEqual([10, 11, 42, 43]);
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
    const sim = createBrowserSimulation(map, villagers, [], DEFAULT_MODEL_SETTINGS);
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

  it('prevents stuck-character rapid facing oscillation and cleanly resolves pinched sidesteps', () => {
    const map = createDefaultMap();
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 0,
      enableWebSpeechFallback: false,
      autoConverse: false,
    });

    const v0 = sim.runtimes.get(DEFAULT_VILLAGERS[0].id)!;
    const v1 = sim.runtimes.get(DEFAULT_VILLAGERS[1].id)!;
    const v2 = sim.runtimes.get(DEFAULT_VILLAGERS[2].id)!;

    // Wedge v0 between two villagers in a 1-tile corridor segment
    v0.x = 20;
    v0.y = 15;
    v0.facing = 'right';
    v0.path = [{ x: 21, y: 15 }, { x: 22, y: 15 }];
    v0.state = 'walking';
    v1.x = 20.6;
    v1.y = 15;
    v1.path = [];
    v1.state = 'idle';
    v2.x = 20;
    v2.y = 16;
    v2.path = [];
    v2.state = 'idle';

    let facingFlips = 0;
    let prevFacing = v0.facing;
    for (let i = 0; i < 45; i++) {
      sim.stepFrame(0.05);
      if (v0.facing !== prevFacing) {
        facingFlips++;
        prevFacing = v0.facing;
      }
    }

    // Must not oscillate back-and-forth every frame while squeezed/blocked
    expect(facingFlips).toBeLessThanOrEqual(4);
    expect(v0.blockedTicks ?? 0).toBeLessThanOrEqual(19);
    expect(v0.sidestepTicks ?? 0).toBeLessThanOrEqual(21);
  });

  it('populates distinct currentThoughtBubble vs currentBubble and scales duration by length', () => {
    const shortDur = computeBubbleDurationMs('Hi!');
    const longDur = computeBubbleDurationMs('A'.repeat(160));
    expect(shortDur).toBeGreaterThanOrEqual(5500);
    expect(longDur).toBeGreaterThan(shortDur);
    expect(longDur).toBeLessThanOrEqual(16000);

    const parsed = parseDialogueAndNarration(
      '<thought>She clutches her herbal satchel nervously.</thought>Baba Rada: Only pure spring water will suffice.',
      'Baba Rada',
    );
    expect(parsed.thoughts).toEqual(['She clutches her herbal satchel nervously.']);
    expect(parsed.spoken).toBe('Only pure spring water will suffice.');
  });

  it('commits character speech into conversation log before audio playback starts (Scribe parity)', async () => {
    const map = createDefaultMap();
    const firstVillager = DEFAULT_VILLAGERS[0]!;
    const secondVillager = DEFAULT_VILLAGERS[1]!;
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      narratorEnabled: false,
      eavesdropSpeech: true,
      eavesdropThoughts: false,
      enableWebSpeechFallback: false,
      proximityRadiusTiles: 999,
    });

    const events: string[] = [];
    let notifyCountBeforeAudio = 0;
    const unsub = sim.subscribe(() => {
      notifyCountBeforeAudio += 1;
    });

    let turnSeq = 0;
    const replySpy = vi
      .spyOn(brainRouter, 'generateVillagerReply')
      .mockImplementation(async (params) => {
        const line = `Turn ${++turnSeq} from ${params.villager.name}`;
        if (params.onBeforeSpeak) {
          await params.onBeforeSpeak({
            text: line,
            source: 'lfm3-omni',
            durationMs: 12,
          });
          // Simulate integrated Omni voice starting ONLY after onBeforeSpeak ran
          const convAfterCommit = sim.conversations.find((c) =>
            c.participantIds.includes(params.villager.id),
          );
          const committedMsg = convAfterCommit?.messages.find(
            (m) => m.senderId === params.villager.id && m.kind === 'speech' && m.text === line,
          );
          expect(committedMsg?.text).toBe(line);
          expect(notifyCountBeforeAudio).toBeGreaterThan(0);
          events.push(`omni-audio:${line}`);
          return {
            text: line,
            source: 'lfm3-omni',
            durationMs: 12,
            audioHandled: true,
          };
        }
        return {
          text: line,
          source: 'story-sim',
          durationMs: 10,
        };
      });

    const speakSpy = vi.spyOn(brainRouter, 'speakLine').mockImplementation(async (text, villager) => {
      const conv = sim.conversations.find(
        (c) =>
          c.participantIds.includes(villager.id) &&
          c.messages.some((m) => m.senderId === villager.id && m.kind === 'speech' && m.text === text),
      );
      expect(conv).toBeDefined();
      events.push(`tts:${villager.id}:${text}`);
    });
    const speakThoughtSpy = vi.spyOn(brainRouter, 'speakThought').mockResolvedValue();

    try {
      // 1. Player-directed reply with integrated voice hook (onBeforeSpeak)
      await sim.sendUserTextToVillager(firstVillager.id, 'Good morning!', true);
      expect(events.some((e) => e.startsWith(`omni-audio:Turn 1 from ${firstVillager.name}`))).toBe(true);

      // 2. Player-directed reply with external speakLine fallback (audioHandled: false)
      replySpy.mockImplementationOnce(async (params) => ({
        text: `Standard line for ${params.partnerName}`,
        source: 'story-sim',
        durationMs: 15,
        audioHandled: false,
      }));
      await sim.sendUserTextToVillager(secondVillager.id, 'Any news?', true);
      expect(
        events.some((e) => e.startsWith(`tts:${secondVillager.id}:Standard line for `)),
      ).toBe(true);

      // 3. Autonomous villager conversation using standard TTS (audioHandled: false)
      replySpy.mockImplementation(async (params) => ({
        text: `Auto line ${++turnSeq} by ${params.villager.name}`,
        source: 'story-sim',
        durationMs: 14,
        audioHandled: false,
      }));
      const autoConv = await sim.runConversationBetween(firstVillager.id, secondVillager.id);
      expect(autoConv?.messages.filter((m) => m.kind === 'speech').length).toBe(3);
      expect(events.filter((e) => e.includes('Auto line')).length).toBe(3);
    } finally {
      unsub();
      replySpy.mockRestore();
      speakSpy.mockRestore();
      speakThoughtSpy.mockRestore();
    }
  });
});

describe('Pause', () => {
  it('holds autonomous conversation turns and suspends speech until resumed', async () => {
    const speechPauseCalls: boolean[] = [];
    const mind = {
      decideVillagerNextAction: (p: any) => brainRouter.decideVillagerNextAction(p),
      generateVillagerReply: (p: any) => brainRouter.generateVillagerReply(p),
      generateNarratorReply: (p: any) => brainRouter.generateNarratorReply(p),
      generateSceneBeat: (p: any) => brainRouter.generateSceneBeat(p),
      reflectMemory: (p: any) => brainRouter.reflectMemory(p),
      converseWithVoice: (p: any) => brainRouter.converseWithVoice(p),
      speakLine: async () => {},
      speakThought: async () => {},
      speakNarration: async () => {},
      refreshActiveSpatialMix: () => {},
      flushAudioQueue: () => {},
      setSpeechPaused: (paused: boolean) => {
        speechPauseCalls.push(paused);
      },
      log: () => {},
    };
    const sim = new VillageSimulation(
      createDefaultMap(),
      structuredClone(DEFAULT_VILLAGERS.slice(0, 2)),
      [],
      { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', narratorEnabled: false },
      { mind },
    );
    const [a, b] = DEFAULT_VILLAGERS;

    sim.paused = true;
    expect(speechPauseCalls).toEqual([true]);
    const conversation = sim.runConversationBetween(a.id, b.id);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sim.conversations[0]?.messages.length ?? 0).toBe(0);

    sim.paused = false;
    expect(speechPauseCalls).toEqual([true, false]);
    await conversation;
    expect(sim.conversations[0].messages.filter((m) => m.kind !== 'narration').length).toBe(3);
  });
});
