import { afterEach, describe, expect, it, vi } from 'vitest';
import { findWorldPack } from '../../world/packs';
import { cueWallTime, describeOffset, parseDelay, scheduleFor, wallToSimTime, WorldSchedule, type ScheduledCue } from '../worldSchedule';
import { setSpeed, togglePause } from '../timeControl';

const village = async () => {
  const { VillageSimulation } = await import('../simulation');
  const { createSilentMind } = await import('../../headless/silentMind');
  const { createSeededRng } = await import('../../core/rng');
  const { DEFAULT_MODEL_SETTINGS } = await import('../../data/defaultData');
  const pack = findWorldPack('balkan-myth')!.build();
  return new VillageSimulation(structuredClone(pack.map), structuredClone(pack.cast!), [], { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', autoConverse: false }, { mind: createSilentMind(), world: pack.context, rng: createSeededRng(2), timers: 'sim' });
};

describe('The schedule: cues placed ahead of now', () => {
  it('keeps cues soonest first and hands each over once, when its world time comes', () => {
    const s = new WorldSchedule();
    const late = s.add({ kind: 'message', atSimMs: 90_000, text: 'a storm rolls in', to: 'narrator' });
    const soon = s.add({ kind: 'music', atSimMs: 60_000, text: 'a wedding horo' });
    expect(s.list().map((c) => c.id)).toEqual([soon.id, late.id]);
    expect(s.takeDue(59_999)).toEqual([]);
    const due = s.takeDue(60_000, 1234);
    expect(due.map((c) => c.id)).toEqual([soon.id]);
    expect(due[0].firedAtWall).toBe(1234);
    // Gone off once; later checks, even winding back and forth, do not hand it over again.
    expect(s.takeDue(70_000)).toEqual([]);
    expect(s.takeDue(30_000)).toEqual([]);
    expect(s.takeDue(95_000).map((c) => c.id)).toEqual([late.id]);
    expect(s.pending()).toEqual([]);
  });

  it('tidies a draft: a message has someone to go to, a break a sensible length, a note neither', () => {
    const s = new WorldSchedule();
    expect(s.add({ kind: 'message', atSimMs: 1, text: '  hello  ' })).toMatchObject({ to: 'narrator', text: 'hello' });
    expect(s.add({ kind: 'message', atSimMs: 1, text: 'x', to: 'all', holdSeconds: 9 }).holdSeconds).toBeUndefined();
    const brk = s.add({ kind: 'music', atSimMs: 1, text: '', to: 'all' });
    expect(brk.holdSeconds).toBe(30);
    expect(brk.to).toBeUndefined();
    expect(s.add({ kind: 'music', atSimMs: 1, text: '', holdSeconds: 9999 }).holdSeconds).toBe(600);
    expect(s.add({ kind: 'note', atSimMs: 1, text: 'remember', to: 'narrator' }).to).toBeUndefined();
    expect(() => s.add({ kind: 'note', atSimMs: Number.NaN, text: '' })).toThrow();
  });

  it('edits, moves and removes; moving one that went off to later sets it again', () => {
    const s = new WorldSchedule();
    const heard: number[] = [];
    s.subscribe(() => heard.push(s.list().length));
    const a = s.add({ kind: 'message', atSimMs: 10_000, text: 'first', to: 'narrator' });
    const b = s.add({ kind: 'note', atSimMs: 20_000, text: 'second' });
    s.update(a.id, { atSimMs: 30_000, text: 'first, later' });
    expect(s.list().map((c) => c.id)).toEqual([b.id, a.id]);
    expect(s.get(a.id)?.text).toBe('first, later');
    s.takeDue(25_000);
    expect(s.get(b.id)?.firedAtSimMs).toBe(25_000);
    s.update(b.id, { atSimMs: 40_000 }, 25_000);
    expect(s.get(b.id)?.firedAtSimMs).toBeUndefined();
    expect(s.remove(a.id)).toBe(true);
    expect(s.remove(a.id)).toBe(false);
    expect(s.list().map((c) => c.id)).toEqual([b.id]);
    expect(heard.length).toBeGreaterThanOrEqual(5);
  });

  it('when the world clock starts again, cues still to come keep the time they had left', () => {
    const s = new WorldSchedule();
    const c = s.add({ kind: 'note', atSimMs: 125_000, text: '' });
    s.rebase(100_000, 0);
    expect(s.get(c.id)?.atSimMs).toBe(25_000);
  });

  it('places cues ahead of the needle by the world time they still have to wait', () => {
    const cue: Pick<ScheduledCue, 'atSimMs'> = { atSimMs: 70_000 };
    expect(cueWallTime(cue, 40_000, 1_000_000)).toBe(1_030_000);
    expect(wallToSimTime(1_030_000, 40_000, 1_000_000)).toBe(70_000);
  });

  it('reads how long from now, and says it back', () => {
    expect(parseDelay('45')).toBe(45_000);
    expect(parseDelay('45s')).toBe(45_000);
    expect(parseDelay('in 2m')).toBe(120_000);
    expect(parseDelay('1 minute')).toBe(60_000);
    expect(parseDelay('1m 30s')).toBe(90_000);
    expect(parseDelay('1 min and 30 sec')).toBe(90_000);
    expect(parseDelay('1:30')).toBe(90_000);
    expect(parseDelay('1h')).toBe(3_600_000);
    expect(parseDelay('')).toBeNull();
    expect(parseDelay('soon')).toBeNull();
    expect(parseDelay('2m tomorrow')).toBeNull();
    expect(describeOffset(45_000)).toBe('in 45s');
    expect(describeOffset(90_000)).toBe('in 1m 30s');
    expect(describeOffset(120_000)).toBe('in 2m');
    expect(describeOffset(-5_000)).toBe('5s ago');
  });
});

describe('The schedule on the world clock', () => {
  afterEach(() => vi.useRealTimers());

  it('waits while the world is paused, comes sooner when it runs fast, and is delivered like a message', async () => {
    vi.useFakeTimers();
    const { startScheduleRunner } = await import('../../app/scheduleRunner');
    const sim = await village();
    const schedule = scheduleFor(sim);
    const delivered: ScheduledCue[] = [];
    const stop = startScheduleRunner(() => sim, async (_sim, cue) => {
      delivered.push(cue);
    });
    schedule.add({ kind: 'message', atSimMs: sim.simTimeMs + 10_000, text: 'a storm rolls in', to: 'narrator' });

    // Paused: wall time passes, the world clock does not, and nothing goes off.
    togglePause(sim);
    expect(sim.paused).toBe(true);
    for (let i = 0; i < 20; i++) vi.advanceTimersByTime(1000);
    expect(delivered).toEqual([]);

    // At four times the pace, ten seconds of world time take two and a half of ours.
    setSpeed(sim, 4);
    expect(sim.paused).toBe(false);
    for (let i = 0; i < 25; i++) {
      sim.stepFrame(0.1);
      vi.advanceTimersByTime(100);
    }
    expect(sim.simTimeMs).toBeGreaterThanOrEqual(10_000);
    vi.advanceTimersByTime(250);
    expect(delivered.map((c) => c.text)).toEqual(['a storm rolls in']);

    // Winding back never sets it off again.
    setSpeed(sim, -2);
    for (let i = 0; i < 10; i++) {
      sim.stepFrame(0.1);
      vi.advanceTimersByTime(100);
    }
    setSpeed(sim, 1);
    for (let i = 0; i < 10; i++) {
      sim.stepFrame(0.1);
      vi.advanceTimersByTime(100);
    }
    expect(delivered.length).toBe(1);
    stop();
  });

  it('a new story keeps the time cues still had to wait', async () => {
    vi.useFakeTimers();
    const { startScheduleRunner } = await import('../../app/scheduleRunner');
    const sim = await village();
    for (let i = 0; i < 50; i++) sim.stepFrame(0.1);
    const schedule = scheduleFor(sim);
    const stop = startScheduleRunner(() => sim, async () => {});
    vi.advanceTimersByTime(250);
    const cue = schedule.add({ kind: 'note', atSimMs: sim.simTimeMs + 30_000, text: 'later' });
    sim.resetStory();
    vi.advanceTimersByTime(250);
    expect(schedule.get(cue.id)!.atSimMs - sim.simTimeMs).toBeGreaterThan(29_000);
    expect(schedule.get(cue.id)!.atSimMs - sim.simTimeMs).toBeLessThanOrEqual(30_000);
    stop();
  });

  it('delivers a message to the Scribe, to everyone, or to one character as a person’s message', async () => {
    const { deliverCue } = await import('../../app/scheduleRunner');
    const sim = await village();
    const sent: Array<[string | undefined, string]> = [];
    sim.sendUserAddressedMessage = async (to, text) => {
      sent.push([to, text]);
      return {};
    };
    const base = { id: 'x', atSimMs: 0 } as const;
    await deliverCue(sim, { ...base, kind: 'message', text: 'tell of the storm', to: 'narrator' });
    await deliverCue(sim, { ...base, kind: 'message', text: 'gather at the well', to: 'all' });
    await deliverCue(sim, { ...base, kind: 'message', text: 'go home', to: 'baba-rada' });
    await deliverCue(sim, { ...base, kind: 'note', text: 'just a note' });
    expect(sent).toEqual([
      ['narrator', 'tell of the storm'],
      [undefined, '@all gather at the well'],
      ['baba-rada', 'go home'],
    ]);
  });
});
