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
      runHeadless({ seed: 5, simSeconds: 300, map: pack.map, villagers: pack.cast!, world: pack.context, musicPauseMs, settings: { talkDensity: 0.8, scribeDensity: 0.5, storyPace: 0.5 } });
    const plain = await run(0);
    const paused = await run(15000);
    expect(paused.trace.length).toBeLessThan(plain.trace.length);
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
