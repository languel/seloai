import { describe, expect, it } from 'vitest';
import { layoutLoom, motifOf, WorldlineRecorder, type LoomInput } from '../worldlines';

const input = (arrangement: 'place' | 'character'): LoomInput => ({
  characters: [
    { id: 'a', name: 'Ana' },
    { id: 'b', name: 'Boris' },
    { id: 'c', name: 'Cveta' },
  ],
  places: [
    { id: 'well', label: 'The well' },
    { id: 'bridge', label: 'The bridge' },
  ],
  samples: new Map([
    ['a', [{ t: 0, place: 'well' }, { t: 50_000, place: null }, { t: 60_000, place: 'bridge' }]],
    ['b', [{ t: 0, place: 'bridge' }]],
    ['c', [{ t: 0, place: null }]],
  ]),
  heading: new Map([['c', 'well']]),
  messages: [
    { id: 'm1', t: 70_000, senderId: 'a', partnerIds: ['b'], text: 'Did you see the stranger?', kind: 'speech', conversationId: 'k' },
    { id: 'm2', t: 75_000, senderId: 'b', partnerIds: ['a'], text: 'I did.', kind: 'speech', conversationId: 'k' },
    { id: 'm3', t: 80_000, senderId: 'narrator', partnerIds: [], text: 'Night fell.', kind: 'narration' },
  ],
  now: 90_000,
  arrangement,
});

describe('the Loom', () => {
  it('lays each thread through the band of the place its character was at', () => {
    const layout = layoutLoom(input('place'));
    const band = (id: string) => layout.bands.find((b) => b.id === id)!;
    const ana = layout.threads.find((t) => t.id === 'a')!;
    const at = (t: number) => ana.points.filter((p) => p.t <= t).pop()!.y;
    expect(at(10_000)).toBeGreaterThan(band('well').y0);
    expect(at(10_000)).toBeLessThan(band('well').y1);
    expect(at(65_000)).toBeGreaterThan(band('bridge').y0);
    expect(at(65_000)).toBeLessThan(band('bridge').y1);
    // Cveta is on her way to the well: basting from now toward the well's band.
    const cveta = layout.threads.find((t) => t.id === 'c')!;
    expect(cveta.basting?.[1].y).toBeCloseTo((band('well').y0 + band('well').y1) / 2);
  });

  it('makes a stitch per line, between speaker and listener, with a motif for its kind', () => {
    const layout = layoutLoom(input('place'));
    expect(layout.stitches.map((s) => s.motif)).toEqual(['question', 'plain', 'plain']);
    const first = layout.stitches[0];
    expect(first.to).toEqual(['b']);
    expect(first.toY.length).toBe(1);
    expect(layout.stitches[2].kind).toBe('narration');
  });

  it('by character, gives each a row and draws talkers together', () => {
    const layout = layoutLoom(input('character'));
    expect(layout.bands.map((b) => b.label)).toEqual(['Ana', 'Boris', 'Cveta']);
    const a = layout.threads.find((t) => t.id === 'a')!;
    const b = layout.threads.find((t) => t.id === 'b')!;
    const gap = (t: number) => Math.abs(a.points.filter((p) => p.t <= t).pop()!.y - b.points.filter((p) => p.t <= t).pop()!.y);
    expect(gap(73_000)).toBeLessThan(gap(20_000));
  });

  it('is pure, and reads the kind of a line', () => {
    expect(JSON.stringify(layoutLoom(input('place')))).toBe(JSON.stringify(layoutLoom(input('place'))));
    expect(motifOf('Come here!')).toBe('exclaim');
    expect(motifOf('Why?')).toBe('question');
    expect(motifOf('x'.repeat(120))).toBe('long');
  });

  it('records where people were, keeping samples small', () => {
    let now = 0;
    const rec = new WorldlineRecorder(() => now);
    const map = { pointsOfInterest: [{ id: 'well', tag: 'Well', label: 'Well', x: 5, y: 5 }] } as never;
    const rt = { id: 'a', x: 5, y: 5, path: [] as Array<{ x: number; y: number }> };
    const sim = { map, runtimes: new Map([['a', rt]]) } as never;
    for (let i = 0; i < 20; i++) {
      now = i * 1600;
      if (i === 10) rt.x = 30;
      rec.sample(sim);
    }
    const s = rec.samples.get('a')!;
    expect(s.map((x) => x.place)).toEqual(['well', null]);
  });
});
