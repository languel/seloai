import { describe, expect, it } from 'vitest';
import { findWorldPack } from '../../world/packs';
import { runHeadless } from '../runHeadless';

describe('talk and Scribe density', () => {
  const pack = findWorldPack('balkan-myth')!.build();
  const run = (settings: { talkDensity?: number; scribeDensity?: number }, simSeconds = 180) =>
    runHeadless({ seed: 5, simSeconds, map: pack.map, villagers: pack.cast!, world: pack.context, settings });
  const spoken = (r: Awaited<ReturnType<typeof run>>) => r.trace.filter((e) => e.senderId !== 'narrator' && e.kind !== 'narration');
  const told = (r: Awaited<ReturnType<typeof run>>) => r.trace.filter((e) => e.senderId === 'narrator');

  it('at talk 0 the characters go about their business without talking', async () => {
    const r = await run({ talkDensity: 0 });
    expect(spoken(r)).toEqual([]);
  });

  it('more talk density gives more dialogue', async () => {
    const quiet = await run({ talkDensity: 0.15 });
    const busy = await run({ talkDensity: 0.95 });
    expect(spoken(busy).length).toBeGreaterThan(spoken(quiet).length);
  });

  it('at Scribe 0 nothing is narrated', async () => {
    const r = await run({ scribeDensity: 0 });
    expect(told(r)).toEqual([]);
    expect(spoken(r).length).toBeGreaterThan(0);
  });

  it('a high Scribe density tells village life even when no one talks', async () => {
    const r = await run({ talkDensity: 0, scribeDensity: 1 }, 240);
    expect(told(r).length).toBeGreaterThan(2);
  });
});

describe('room for the music', () => {
  it('the story pauses after a passage of the Scribe when the band asks for it', async () => {
    const pack = findWorldPack('balkan-myth')!.build();
    const run = (musicPauseMs: number) =>
      runHeadless({ seed: 5, simSeconds: 300, map: pack.map, villagers: pack.cast!, world: pack.context, musicPauseMs, settings: { talkDensity: 0.8, scribeDensity: 1, storyPace: 0.5 } });
    // The wait between a passage of the Scribe and the next line of the same conversation.
    const afterPassage = (trace: Awaited<ReturnType<typeof run>>['trace']) => {
      const gaps: number[] = [];
      const byConv = new Map<string, typeof trace>();
      for (const e of trace) byConv.set(e.conversationId, [...(byConv.get(e.conversationId) ?? []), e]);
      for (const lines of byConv.values()) {
        lines.sort((a, b) => a.t - b.t);
        for (let i = 0; i + 1 < lines.length; i++) if (lines[i].senderId === 'narrator' && lines[i + 1].senderId !== 'narrator') gaps.push(lines[i + 1].t - lines[i].t);
      }
      return gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
    };
    const plain = afterPassage((await run(0)).trace);
    const paused = afterPassage((await run(8000)).trace);
    expect(paused - plain).toBeGreaterThan(5000);
  });
});

describe('a village alive from the first moment', () => {
  it('people stroll about while their minds are still busy (no plan has come back)', async () => {
    const { VillageSimulation } = await import('../../engine/simulation');
    const { createSilentMind } = await import('../silentMind');
    const { createSeededRng } = await import('../../core/rng');
    const { DEFAULT_MODEL_SETTINGS } = await import('../../data/defaultData');
    const pack = findWorldPack('balkan-myth')!.build();
    const mind = createSilentMind();
    // A mind so busy with the story that no plan for where to go ever comes back.
    mind.decideVillagerNextAction = () => new Promise(() => {});
    const sim = new VillageSimulation(structuredClone(pack.map), structuredClone(pack.cast!), [], { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', proximityRadiusTiles: 0, talkDensity: 0 }, { mind, world: pack.context, rng: createSeededRng(4), timers: 'sim' });
    const start = new Map([...sim.runtimes.values()].map((rt) => [rt.id, { x: rt.x, y: rt.y }]));
    for (let i = 0; i < 100; i++) {
      sim.stepFrame(0.1);
      await Promise.resolve();
    }
    const moved = [...sim.runtimes.values()].filter((rt) => Math.hypot(rt.x - start.get(rt.id)!.x, rt.y - start.get(rt.id)!.y) > 1);
    expect(moved.length).toBeGreaterThanOrEqual(Math.ceil(sim.runtimes.size / 2));
  });
});

describe('keeping to a place', () => {
  const makeSim = async (overtureMs = 0, talkDensity = 0.5) => {
    const { VillageSimulation } = await import('../../engine/simulation');
    const { createSilentMind } = await import('../silentMind');
    const { createSeededRng } = await import('../../core/rng');
    const { DEFAULT_MODEL_SETTINGS } = await import('../../data/defaultData');
    const pack = findWorldPack('balkan-myth')!.build();
    const sim = new VillageSimulation(structuredClone(pack.map), structuredClone(pack.cast!), [], { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', proximityRadiusTiles: 0, talkDensity }, { mind: createSilentMind(), world: pack.context, rng: createSeededRng(9), timers: 'sim' });
    if (overtureMs) sim.setMusicPause((after) => (after === 'overture' ? overtureMs : 0));
    // As the headless runner does: the story engine's waits run on the world clock.
    const { brainRouter } = await import('../../ai/brainRouter');
    brainRouter.configureStoryRuntime({ random: createSeededRng(17), now: () => 1_000_000 + Math.round(sim.simTimeMs), delay: (ms) => sim.waitSimTime(ms) });
    const well = pack.map.pointsOfInterest!.find((p) => p.tag === 'LamiaWell')!;
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    const run = async (seconds: number, each?: () => void) => {
      for (let i = 0; i < seconds * 10; i++) {
        sim.stepFrame(0.1);
        await settle();
        each?.();
      }
    };
    return { sim, well, run };
  };

  it('the Lamia circles her well while the others roam, until the water flows', async () => {
    // No talk, so she is never held in a conversation and her circling shows.
    const { sim, well, run } = await makeSim(0, 0);
    const lamia = sim.runtimes.get('lamia')!;
    let farthest = 0;
    const seen = new Set<string>();
    await run(20);
    await run(180, () => {
      farthest = Math.max(farthest, Math.hypot(lamia.x - well.x, lamia.y - well.y));
      seen.add(`${Math.round(lamia.x)},${Math.round(lamia.y)}`);
    });
    expect(farthest).toBeLessThan(6.5);
    expect(seen.size).toBeGreaterThan(3); // she moves round it, not frozen
    sim.setWellWater('flowing');
    let after = 0;
    await run(240, () => (after = Math.max(after, Math.hypot(lamia.x - well.x, lamia.y - well.y))));
    expect(after).toBeGreaterThan(8);
  });

  it('no conversation begins while the opening music plays', async () => {
    const { sim, run } = await makeSim(30_000);
    let firstTalkAt = Infinity;
    let prologueAt = Infinity;
    await run(90, () => {
      for (const c of sim.conversations) {
        for (const m of c.messages) {
          if (m.senderId === 'narrator' && prologueAt === Infinity) prologueAt = sim.simTimeMs;
          if (m.kind === 'speech' && !c.participantIds.includes('narrator') && firstTalkAt === Infinity) firstTalkAt = sim.simTimeMs;
        }
      }
    });
    expect(prologueAt).toBeLessThan(Infinity);
    expect(firstTalkAt - prologueAt).toBeGreaterThanOrEqual(30_000);
  });
});
