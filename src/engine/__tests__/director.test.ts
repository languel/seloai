import { describe, expect, it } from 'vitest';
import { Director, MAX_SHOT, MIN_SHOT, type DirectorActor, type DirectorInput } from '../director';

const base = (time: number, actors: DirectorActor[]): DirectorInput => ({
  time,
  actors,
  landmarks: [
    { id: 'well', label: 'The well', x: 10, y: 10 },
    { id: 'bridge', label: 'The bridge', x: 40, y: 30 },
  ],
  mapW: 48,
  mapH: 36,
  aspect: 16 / 9,
});

function run(director: Director, from: number, to: number, actorsAt: (t: number) => DirectorActor[], step = 0.1) {
  for (let t = from; t <= to + 1e-9; t += step) director.update(base(t, actorsAt(t)));
}

describe('the director camera', () => {
  it('opens on an establishing shot, then finds a conversation and frames everyone in it', () => {
    const d = new Director();
    const talk = (): DirectorActor[] => [
      { id: 'a', x: 20, y: 20, moving: false, conversationId: 'c1' },
      { id: 'b', x: 23, y: 21, moving: false, conversationId: 'c1', line: 'The well is dry.' },
      { id: 'c', x: 5, y: 5, moving: false },
    ];
    expect(d.update(base(0, talk())).kind).toBe('establishing');
    run(d, 0.1, MIN_SHOT + 0.5, talk);
    const shot = d.current!;
    expect(shot.kind).toBe('two-shot');
    expect(shot.actors.sort()).toEqual(['a', 'b']);
    for (const [x, y] of [[20, 20], [24, 22]]) {
      expect(x).toBeGreaterThanOrEqual(shot.rect.x);
      expect(x).toBeLessThanOrEqual(shot.rect.x + shot.rect.w);
      expect(y).toBeGreaterThanOrEqual(shot.rect.y);
      expect(y).toBeLessThanOrEqual(shot.rect.y + shot.rect.h);
    }
    expect(shot.rect.w / shot.rect.h).toBeCloseTo(16 / 9, 3);
  });

  it('holds a shot for at least the minimum, and never longer than the maximum when there is elsewhere to go', () => {
    const d = new Director();
    const actors = (t: number): DirectorActor[] => [
      { id: 'a', x: 10, y: 10, moving: false, conversationId: 'c1', line: t % 4 < 2 ? 'Hm.' : undefined },
      { id: 'b', x: 12, y: 10, moving: false, conversationId: 'c1' },
      { id: 'c', x: 40, y: 30, moving: false, conversationId: 'c2', line: t % 4 >= 2 ? 'Yes.' : undefined },
      { id: 'd', x: 42, y: 30, moving: false, conversationId: 'c2' },
    ];
    run(d, 0, 60, actors);
    const shots = d.history;
    expect(shots.length).toBeGreaterThan(2);
    for (let i = 1; i < shots.length; i++) {
      const held = shots[i].startedAt - shots[i - 1].startedAt;
      if (shots[i].subject !== shots[i - 1].subject) expect(held).toBeGreaterThanOrEqual(MIN_SHOT - 1e-6);
    }
    const subjectRuns: number[] = [];
    let start = 0;
    for (let i = 1; i <= shots.length; i++) {
      if (i === shots.length || shots[i].subject !== shots[i - 1].subject) {
        const end = i === shots.length ? 60 : shots[i].startedAt;
        subjectRuns.push(end - shots[start].startedAt);
        start = i;
      }
    }
    for (const r of subjectRuns.slice(0, -1)) expect(r).toBeLessThanOrEqual(MAX_SHOT + 0.2);
  });

  it('pushes in slowly on a dramatic line, then eases back to the two-shot', () => {
    const d = new Director();
    let line: string | undefined;
    const actors = (): DirectorActor[] => [
      { id: 'a', x: 20, y: 20, moving: false, conversationId: 'c1', line },
      { id: 'b', x: 26, y: 20, moving: false, conversationId: 'c1' },
    ];
    run(d, 0, 12, actors);
    expect(d.current!.kind).toBe('two-shot');
    line = 'Who poisoned the well, and why did you stand there and watch it happen without a word?';
    run(d, 12.1, 12.3, actors);
    expect(d.current!.kind).toBe('close');
    expect(d.current!.pace).toBe('slow');
    expect(d.current!.actors).toEqual(['a']);
    expect(d.current!.rect.w).toBeLessThan(12);
    line = undefined;
    run(d, 12.4, 20, actors);
    expect(d.current!.kind).toBe('two-shot');
  });

  it('treats a line that grows word by word as one line, closing in once when it turns strong', () => {
    const d = new Director();
    let line: string | undefined;
    const actors = (): DirectorActor[] => [
      { id: 'a', x: 20, y: 20, moving: false, conversationId: 'c1', line, lineId: line ? 'l1' : undefined },
      { id: 'b', x: 26, y: 20, moving: false, conversationId: 'c1' },
    ];
    run(d, 0, 6, actors);
    const words = 'Did you leave the scarlet thread by the well, knowing full well what she would do with it?'.split(' ');
    let t = 6;
    for (let i = 1; i <= words.length; i++) {
      line = words.slice(0, i).join(' ');
      run(d, t, t + 0.2, actors);
      t += 0.3;
    }
    run(d, t, t + 1, actors);
    expect(d.history.filter((s) => s.kind === 'close').length).toBe(1);
  });

  it('cuts when the story moves across the map, eases when it stays near', () => {
    const d = new Director();
    let where = 'near';
    const actors = (): DirectorActor[] =>
      where === 'near'
        ? [
            { id: 'a', x: 10, y: 10, moving: false, conversationId: 'c1', line: 'Hello.' },
            { id: 'b', x: 12, y: 10, moving: false, conversationId: 'c1' },
          ]
        : [
            { id: 'a', x: 10, y: 10, moving: false },
            { id: 'b', x: 12, y: 10, moving: false },
            { id: 'c', x: 40, y: 30, moving: false, conversationId: 'c2', line: 'Over here.' },
            { id: 'd', x: 43, y: 31, moving: false, conversationId: 'c2' },
          ];
    run(d, 0, 8, actors);
    where = 'far';
    run(d, 8.1, 20, actors);
    const toFar = d.history.find((s) => s.subject === 'talk:c2')!;
    expect(toFar.cut).toBe(true);
  });

  it('favours the plotline the viewer picked', () => {
    const d = new Director();
    d.favour('c');
    const actors = (): DirectorActor[] => [
      { id: 'a', x: 10, y: 10, moving: false, conversationId: 'c1', line: 'Look!' },
      { id: 'b', x: 12, y: 10, moving: false, conversationId: 'c1' },
      { id: 'c', x: 40, y: 30, moving: false, conversationId: 'c2' },
      { id: 'd', x: 42, y: 30, moving: false, conversationId: 'c2' },
    ];
    run(d, 0, 10, actors);
    expect(d.current!.actors).toContain('c');
  });

  it('is reproducible: the same story gives the same cut', () => {
    const story = (t: number): DirectorActor[] => [
      { id: 'a', x: 10 + Math.sin(t) * 3, y: 10, moving: t % 7 < 3, conversationId: t % 10 > 4 ? 'c1' : undefined, line: t % 3 < 1 ? 'Why?' : undefined },
      { id: 'b', x: 14, y: 12, moving: false, conversationId: t % 10 > 4 ? 'c1' : undefined },
      { id: 'c', x: 30, y: 20 + t * 0.1, moving: true },
    ];
    const a = new Director();
    const b = new Director();
    run(a, 0, 40, story);
    run(b, 0, 40, story);
    expect(JSON.stringify(a.history)).toBe(JSON.stringify(b.history));
  });
});

describe('quiet times', () => {
  it('holds each wide shot for a while, then moves on to the next place', () => {
    const d = new Director();
    run(d, 0, 30, () => [{ id: 'a', x: 5, y: 5, moving: false }]);
    const wides = d.history.filter((s) => s.kind === 'establishing');
    expect(new Set(wides.map((s) => s.subject)).size).toBeGreaterThan(1);
    for (let i = 1; i < wides.length; i++) expect(wides[i].startedAt - wides[i - 1].startedAt).toBeGreaterThanOrEqual(6.9);
  });
});

describe('time on a subject', () => {
  it('moves on after the longest hold even while close shots keep coming', () => {
    const d = new Director();
    const actors = (t: number): DirectorActor[] => [
      { id: 'a', x: 10, y: 10, moving: false, conversationId: 'c1', line: `Line ${Math.floor(t / 2)}?`, lineId: String(Math.floor(t / 2)) },
      { id: 'b', x: 13, y: 10, moving: false, conversationId: 'c1' },
      { id: 'c', x: 40, y: 30, moving: false, conversationId: 'c2', line: 'Yes.' },
      { id: 'd', x: 43, y: 30, moving: false, conversationId: 'c2' },
    ];
    run(d, 0, 50, actors);
    expect(new Set(d.history.map((s) => s.subject)).has('talk:c2')).toBe(true);
  });

  it('holds still while the people in the shot stay framed, and does not push in on every remark', () => {
    const d = new Director();
    let line: string | undefined = undefined;
    let ax = 20;
    const actors = (): DirectorActor[] => [
      { id: 'a', x: ax, y: 20, moving: false, conversationId: 'c1', line },
      { id: 'b', x: 26, y: 20, moving: false, conversationId: 'c1' },
    ];
    run(d, 0, 6, actors);
    const held = d.current!.rect;
    ax = 20.6;
    line = 'Who is there?';
    run(d, 6.1, 9, actors);
    expect(d.current!.kind).toBe('two-shot');
    expect(d.current!.rect).toEqual(held);
  });

  it('cuts away to someone a line names, then back', () => {
    const d = new Director();
    d.setNames(new Map([['a', 'Baba Rada'], ['b', 'Stoyan Yunak'], ['c', 'Kuker Marin']]));
    let line: string | undefined = undefined;
    const actors = (): DirectorActor[] => [
      { id: 'a', x: 20, y: 20, moving: false, conversationId: 'c1', line, lineId: line ? 'l1' : undefined },
      { id: 'b', x: 26, y: 20, moving: false, conversationId: 'c1' },
      { id: 'c', x: 40, y: 8, moving: false },
    ];
    run(d, 0, 6, actors);
    line = 'Marin was at the hearth all night.';
    run(d, 6.1, 6.3, actors);
    expect(d.current!.kind).toBe('reaction');
    expect(d.current!.actors).toEqual(['c']);
    expect(d.current!.cut).toBe(true);
    run(d, 6.4, 10, actors);
    expect(d.current!.kind).toBe('two-shot');
  });
});
