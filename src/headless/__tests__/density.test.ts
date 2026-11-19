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
