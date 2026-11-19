import { describe, expect, it } from 'vitest';
import { estimateLineDurationMs } from '../../engine/simulation';
import { findWorldPack } from '../../world/packs';
import { runHeadless } from '../runHeadless';

describe('Headless reproducible runs', () => {
  const pack = findWorldPack('balkan-myth')!.build();
  const run = (seed: number) =>
    runHeadless({
      seed,
      simSeconds: 240,
      map: pack.map,
      villagers: pack.cast!,
      world: pack.context,
    });

  it('produces an identical trace for the same seed', async () => {
    const first = await run(7);
    const second = await run(7);
    expect(first.trace.length).toBeGreaterThan(5);
    expect(second.trace).toEqual(first.trace);
    expect(second.finalState).toEqual(first.finalState);
    expect(second.digest).toBe(first.digest);
  });

  it('only lets a character speak the lines the pack scripts for them', async () => {
    const result = await run(7);
    const lamiaOnly = pack.context.storyLines.characterLines.lamia.lines.map((line) =>
      line.slice(0, line.indexOf('{partner}')),
    );
    const misattributed = result.trace.filter(
      (ev) => ev.senderId !== 'lamia' && lamiaOnly.some((start) => start && ev.text.startsWith(start)),
    );
    expect(misattributed).toEqual([]);
  });

  it('paces each conversation in world time rather than as fast as text can be produced', async () => {
    const result = await run(7);
    const byConversation = new Map<string, number[]>();
    for (const ev of result.trace) {
      byConversation.set(ev.conversationId, [...(byConversation.get(ev.conversationId) ?? []), ev.t]);
    }
    const gaps = [...byConversation.values()].flatMap((times) =>
      times.slice(1).map((t, i) => t - times[i]),
    );
    expect(gaps.length).toBeGreaterThan(3);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1400);
    expect(estimateLineDurationMs('One two three four five six seven eight nine ten.')).toBe(4100);
    expect(estimateLineDurationMs('Hi.')).toBe(1400);
  });

  it('produces a different run for a different seed', async () => {
    const a = await run(7);
    const b = await run(8);
    expect(b.digest).not.toBe(a.digest);
  });
});
