import { describe, expect, it } from 'vitest';
import { Composer } from '../composer';
import { DRONE_BELOW, GAIDA_FROM, METERED_FROM, type MusicCue } from '../cue';
import { MusicListener, moodVotes } from '../listener';
import { DANCES, degreeToMidi } from '../theory';
import { SCORE_STALE, ScribeEar, parseScore, scorePrompt } from '../scribeScore';
import { DEFAULT_TONE, TONE_PRESETS, gritCurve, normalizeTone } from '../tone';

describe('theory', () => {
  it('maps degrees across octaves', () => {
    expect(degreeToMidi(0, 'mixolydian')).toBe(62);
    expect(degreeToMidi(7, 'mixolydian')).toBe(74);
    expect(degreeToMidi(-1, 'mixolydian')).toBe(60);
    expect(degreeToMidi(2, 'hijaz') - degreeToMidi(1, 'hijaz')).toBe(3); // the augmented second
  });
});

describe('composer', () => {
  const play = (cue: MusicCue, n: number, seed = 3) => {
    const c = new Composer(seed);
    return Array.from({ length: n }, () => c.next(cue));
  };

  it('is deterministic for a seed', () => {
    const a = play({ mood: 'festive', intensity: 0.8 }, 6);
    const b = play({ mood: 'festive', intensity: 0.8 }, 6);
    expect(a).toEqual(b);
  });

  it('plays a drone when still, free rhythm when calm, a dance when busy', () => {
    expect(play({ mood: 'pastoral', intensity: DRONE_BELOW / 2 }, 1)[0].texture).toBe('drone');
    const free = play({ mood: 'lament', intensity: 0.25 }, 1)[0];
    expect(free.texture).toBe('free');
    expect(free.kaval.length).toBeGreaterThan(2);
    const dance = play({ mood: 'festive', intensity: 0.9 }, 1)[0];
    expect(dance.texture).toBe('dance');
    expect(dance.gaidaOn).toBe(true);
    expect(dance.tapan.some((h) => h.kind === 'dum')).toBe(true);
  });

  it('fits a dance phrase to whole bars of its meter', () => {
    for (const p of play({ mood: 'festive', intensity: 0.7, dance: 'rachenitsa' }, 4)) {
      const barUnits = DANCES.rachenitsa.groups.reduce((a, b) => a + b, 0);
      const bars = p.length / (barUnits * p.unit!);
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-9);
      for (const n of p.gaida) expect(n.t + n.dur).toBeLessThanOrEqual(p.length + 1e-9);
    }
  });

  it('plays the same tune faster when the intensity rises', () => {
    const c = new Composer(9);
    const slow = c.next({ mood: 'joy', intensity: METERED_FROM + 0.05, dance: 'pravo' });
    const fast = c.next({ mood: 'joy', intensity: 1, dance: 'pravo' });
    expect(fast.unit!).toBeLessThan(slow.unit!);
  });

  it('parts repeated gaida notes with a grace note', () => {
    for (const p of play({ mood: 'festive', intensity: 0.85 }, 8)) {
      for (let i = 1; i < p.gaida.length; i++) {
        if (p.gaida[i].midi === p.gaida[i - 1].midi) expect(p.gaida[i].graces?.length).toBeGreaterThan(0);
      }
    }
  });

  it('brings the gaida in only with the dance, unless told', () => {
    expect(play({ mood: 'pastoral', intensity: GAIDA_FROM - 0.1 }, 1)[0].gaidaOn).toBe(false);
    expect(play({ mood: 'pastoral', intensity: 0.3, lead: 'gaida' }, 1)[0].gaidaOn).toBe(true);
  });
});

describe('listener', () => {
  it('hears moods in words, whole words for short ones', () => {
    expect(moodVotes('The lamia cursed the well').scores.dread).toBe(2);
    expect(moodVotes('now, north, nothing').scores.tension).toBe(0);
    expect(moodVotes('No! Never!').scores.tension).toBe(2);
  });

  it('starts pastoral and quiet', () => {
    const cue = new MusicListener().read({ now: 0, lines: [] });
    expect(cue.mood).toBe('pastoral');
    expect(cue.intensity).toBeLessThan(METERED_FROM);
  });

  it('turns to dread on dark lines and swells with exclamations', () => {
    const l = new MusicListener();
    l.read({ now: 0, lines: [] });
    const lines = [
      { at: 18, kind: 'narration' as const, text: 'The serpent coils in the dark well; the curse demands blood.' },
      { at: 19, text: 'Beware the lamia! She will devour us all!' },
    ];
    let cue = l.read({ now: 20, lines, activeConversations: 1, speaking: 1 });
    for (let t = 21; t < 26; t++) cue = l.read({ now: t, lines, activeConversations: 1, speaking: 1 });
    expect(cue.mood).toBe('dread');
    expect(cue.intensity).toBeGreaterThan(0.45);
    expect(cue.reason).toMatch(/dread/);
  });

  it('does not flicker: a mood holds before another takes over', () => {
    const l = new MusicListener();
    l.read({ now: 0, lines: [{ at: 0, text: 'A wedding! Dance the horo, sing!' }] });
    const cue = l.read({ now: 3, lines: [{ at: 3, text: 'the curse, the blood, the lamia' }] });
    expect(cue.mood).not.toBe('dread');
  });

  it('dancing people make a festive scene', () => {
    const l = new MusicListener();
    l.read({ now: 0, lines: [] });
    const cue = l.read({ now: 20, lines: [], dancing: 4 });
    expect(cue.mood).toBe('festive');
  });
});

describe("the Scribe's ear", () => {
  it('reads a model answer', () => {
    expect(parseScore('dread 0.6 — the serpent stirs in the well')).toEqual({ mood: 'dread', intensity: 0.6, reason: 'the serpent stirs in the well' });
    expect(parseScore('Mood: Festive, intensity 8/10')?.mood).toBe('festive');
    expect(parseScore('festive 80%')?.intensity).toBe(0.8);
    expect(parseScore('<think>maybe joy</think> lament 0.3')?.mood).toBe('lament');
    expect(parseScore('an ominous hush')?.mood).toBe('dread');
    expect(parseScore('I cannot say')).toBeNull();
  });

  it('asks after narration or a few lines, never too often or twice at once', async () => {
    const ear = new ScribeEar();
    expect(ear.shouldAsk([], 0)).toBe(false);
    expect(ear.shouldAsk([{ text: 'Hello', at: 1 }], 2)).toBe(true);
    let release!: (v: null) => void;
    const pending = ear.ask(2, () => new Promise((r) => (release = r)));
    expect(ear.shouldAsk([{ text: 'x', kind: 'narration', at: 30 }], 40)).toBe(false); // in flight
    release(null);
    await pending;
    expect(ear.shouldAsk([{ text: 'x', at: 5 }], 10)).toBe(false); // too soon
    expect(ear.shouldAsk([{ text: 'one', at: 30 }], 40)).toBe(false); // one line is not enough
    expect(ear.shouldAsk([{ text: 'x', kind: 'narration', at: 30 }], 40)).toBe(true);
  });

  it("leads the mood while fresh, then gives way", async () => {
    const ear = new ScribeEar();
    await ear.ask(0, async () => ({ mood: 'mystery', intensity: 0.4 }));
    const heard = { mood: 'pastoral' as const, intensity: 0.2 };
    const led = ear.blend(heard, 10);
    expect(led.mood).toBe('mystery');
    expect(led.intensity).toBeCloseTo(0.33, 2);
    expect(ear.blend(heard, SCORE_STALE + 1).mood).toBe('pastoral');
  });

  it('builds a short prompt naming the speakers', () => {
    const msgs = scorePrompt({ lines: [{ text: 'Beware!', speaker: 'Baba Rada', at: 1 }], premise: 'Drought.' });
    expect(msgs[1].content).toContain('Baba Rada: Beware!');
    expect(msgs[0].content).toContain('dread');
  });
});

describe('the band tone', () => {
  it('fills in and clamps a stored tone', () => {
    const t = normalizeTone({ gaida: { breath: 3 }, drone: { voicing: 'nonsense', beating: -1 } });
    expect(t.gaida.breath).toBe(1);
    expect(t.gaida.level).toBe(DEFAULT_TONE.gaida.level);
    expect(t.drone.voicing).toBe(DEFAULT_TONE.drone.voicing);
    expect(t.drone.beating).toBe(0);
    for (const p of Object.values(TONE_PRESETS)) expect(normalizeTone(p.tone)).toEqual(p.tone);
  });

  it('is clean up to the usual character and clips towards gritty', () => {
    const clean = gritCurve(0.3, 9);
    expect(clean[8]).toBeCloseTo(1);
    expect(clean[6]).toBeCloseTo(0.5);
    const gritty = gritCurve(1, 9);
    expect(gritty[6]).toBeGreaterThan(0.85);
    expect(Math.max(...gritty)).toBeLessThanOrEqual(1.0001);
  });
});

describe('storyteller motifs', () => {
  it('fills a gap with a short motif that swells and fades, on the kaval when calm', () => {
    const c = new Composer(4);
    for (const intensity of [0.2, 0.5]) {
      const m = c.motif({ mood: 'pastoral', intensity }, intensity, 5);
      expect(m.texture).toBe('motif');
      expect(m.gaida).toEqual([]);
      expect(m.kaval.length).toBeGreaterThan(0);
      const end = Math.max(...m.kaval.map((n) => n.t + n.dur));
      expect(end).toBeLessThan(5 + 2.5);
      expect(m.tapan.length).toBeLessThanOrEqual(1);
      const vels = m.kaval.map((n) => n.vel);
      if (vels.length >= 3) expect(Math.max(...vels.slice(1, -1))).toBeGreaterThanOrEqual(vels[0]);
    }
  });

  it('lets the gaida carry a motif only when the scene is wild or it is told to', () => {
    const c = new Composer(4);
    expect(c.motif({ mood: 'festive', intensity: 0.9 }, 0.9).gaidaOn).toBe(true);
    expect(c.motif({ mood: 'festive', intensity: 0.9, lead: 'kaval' }, 0.9).gaidaOn).toBe(false);
  });
});
