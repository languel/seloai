import { describe, expect, it } from 'vitest';
import { applyRules, degreeOf, describeRule, makeRule, moveToMode, ruleCue, type BandRule } from '../bandRules';
import type { PhrasePlan } from '../composer';
import { degreeToMidi } from '../theory';

const plan = (over: Partial<PhrasePlan> = {}): PhrasePlan => ({
  length: 4,
  mood: 'dread',
  mode: 'phrygian',
  dance: 'paidushko',
  intensity: 0.6,
  texture: 'motif',
  gaidaOn: false,
  gaida: [],
  kaval: [
    { t: 0, dur: 0.5, midi: 62, vel: 0.8, graces: [64] },
    { t: 0.5, dur: 0.5, midi: 63, vel: 0.7, glideFrom: 62 },
    { t: 1, dur: 1, midi: 65, vel: 0.6, trillTo: 67 },
  ],
  tapan: [
    { t: 0, kind: 'dum', vel: 0.8 },
    { t: 0.5, kind: 'tek', vel: 0.4 },
    { t: 1, kind: 'dum', vel: 0.6 },
    { t: 1.5, kind: 'tek', vel: 0.4 },
  ],
  drone: 0.6,
  unit: 0.2,
  label: 'motif · phrygian · kaval',
  ...over,
});

const always = () => 0;
const never = () => 0.999;

describe('Band rules', () => {
  it('moves a pitch between modes degree for degree, in the village key', () => {
    for (let d = -3; d < 10; d++) expect(degreeOf(degreeToMidi(d, 'hijaz'), 'hijaz')).toBe(d);
    // The second degree of phrygian (E♭4) is the second degree of dorian (E4).
    expect(moveToMode(63, 'phrygian', 'dorian')).toBe(64);
    expect(moveToMode(62, 'phrygian', 'dorian')).toBe(62);
    expect(moveToMode(74, 'aeolian', 'aeolian')).toBe(74);
  });

  it('checks a rule and fills in what is left out', () => {
    expect((makeRule({ kind: 'thin', instrument: 'tapan', amount: 3, when: {} }) as { amount: number }).amount).toBe(1);
    expect((makeRule({ kind: 'no-ornaments', instrument: 'kaval', ornaments: [], when: {} }) as { ornaments: string[] }).ornaments).toEqual(['graces', 'glide', 'trill']);
    expect(() => makeRule({ kind: 'thin', instrument: 'lute' as never, amount: 1, when: {} })).toThrow(/instrument/);
    expect(() => makeRule({ kind: 'prefer-dance', dance: 'free', when: {} })).toThrow(/dance/);
    expect(() => makeRule({ kind: 'thin', instrument: 'tapan', amount: 1, when: { mood: 'bored' as never } })).toThrow(/mood/);
    expect(() => makeRule({ kind: 'keep-figure', name: 'x', instrument: 'kaval', notes: [], mode: 'dorian', weight: 1, when: {} })).toThrow(/notes/);
  });

  it('leaves an instrument out, or thins it, only where the rule holds', () => {
    const noTapan = makeRule({ kind: 'thin', instrument: 'tapan', amount: 1, when: { mood: 'dread' } });
    const out = applyRules(plan(), 'between', [noTapan], always);
    expect(out.plan.tapan).toEqual([]);
    expect(out.applied).toEqual([noTapan.id]);
    // Another mood: untouched.
    const joy = applyRules(plan({ mood: 'joy' }), 'between', [noTapan], always);
    expect(joy.plan.tapan).toHaveLength(4);
    expect(joy.applied).toEqual([]);
    // Half as much: the downbeat stays, the rest by chance.
    const half = makeRule({ kind: 'thin', instrument: 'tapan', amount: 0.5, when: {} });
    expect(applyRules(plan(), 'song', [half], never).plan.tapan).toEqual([{ t: 0, kind: 'dum', vel: 0.8 }]);
    const softer = makeRule({ kind: 'thin', instrument: 'drone', amount: 0.5, when: { part: 'song' } });
    expect(applyRules(plan(), 'song', [softer], always).plan.drone).toBeCloseTo(0.3);
    expect(applyRules(plan(), 'between', [softer], always).plan.drone).toBe(0.6);
  });

  it('takes the ornaments off', () => {
    const plain = makeRule({ kind: 'no-ornaments', instrument: 'kaval', ornaments: ['graces', 'trill'], when: {} });
    const notes = applyRules(plan(), 'between', [plain], always).plan.kaval;
    expect(notes.some((n) => n.graces || n.trillTo !== undefined)).toBe(false);
    expect(notes[1].glideFrom).toBe(62);
  });

  it('plays a kept figure again in a moment like it, in that moment’s mode and tempo', () => {
    const figure = makeRule({
      kind: 'keep-figure',
      name: "the Lamia's call",
      instrument: 'kaval',
      notes: [
        { t: 0, dur: 0.4, midi: 63, vel: 0.8 },
        { t: 0.4, dur: 0.8, midi: 67, vel: 0.7 },
      ],
      mode: 'phrygian',
      unit: 0.2,
      weight: 1,
      when: { part: 'between' },
    });
    const there = applyRules(plan({ mode: 'dorian', unit: 0.1 }), 'between', [figure], always);
    expect(there.applied).toEqual([figure.id]);
    expect(there.plan.label).toMatch(/kept: the Lamia's call/);
    // Twice as fast, and E♭ (phrygian's second) becomes E (dorian's second).
    expect(there.plan.kaval).toMatchObject([
      { t: 0, dur: 0.2, midi: 64 },
      { t: 0.2, dur: 0.4, midi: 67 },
    ]);
    // Not in ambience, and not when chance says no.
    expect(applyRules(plan(), 'ambience', [figure], always).applied).toEqual([]);
    expect(applyRules(plan(), 'between', [{ ...figure, weight: 0.5 } as BandRule], never).applied).toEqual([]);
    // A song keeps its bars: a figure longer than the phrase waits for another.
    const long = { ...figure, when: {}, notes: [{ t: 0, dur: 9, midi: 62, vel: 1 }] } as BandRule;
    expect(applyRules(plan({ length: 2 }), 'song', [long], always).applied).toEqual([]);
  });

  it('chooses the dance: a preference first, else away from an avoided one; an explicit dance wins', () => {
    const prefer = makeRule({ kind: 'prefer-dance', dance: 'lesnoto', when: { mood: 'joy' } });
    expect(ruleCue({ mood: 'joy', intensity: 0.6 }, [prefer]).cue.dance).toBe('lesnoto');
    expect(ruleCue({ mood: 'dread', intensity: 0.6 }, [prefer]).cue.dance).toBeUndefined();
    expect(ruleCue({ mood: 'joy', intensity: 0.6, dance: 'pravo' }, [prefer]).cue.dance).toBe('pravo');
    const avoid = makeRule({ kind: 'avoid-dance', dance: 'pravo', when: { mood: 'pastoral' } });
    const r = ruleCue({ mood: 'pastoral', intensity: 0.6 }, [avoid]);
    expect(r.cue.dance).toBe('daychovo');
    expect(r.applied).toEqual([avoid.id]);
  });

  it('says each rule in a few words', () => {
    expect(describeRule(makeRule({ kind: 'thin', instrument: 'tapan', amount: 1, when: { mood: 'lament' } }))).toBe('leave out the tapan (in lament)');
    expect(describeRule(makeRule({ kind: 'thin', instrument: 'gaida', amount: 0.4, when: { part: 'between' } }))).toBe('gaida plays 40% less (in the in-between)');
    expect(describeRule(makeRule({ kind: 'avoid-dance', dance: 'kopanitsa', when: {} }))).toMatch(/avoid the kopanitsa/);
  });
});

describe('The band_rules tool', () => {
  it('keeps a figure from a phrase on the record, adds and drops rules, and the band hears them', async () => {
    const { runUiTool } = await import('../../api/uiTools');
    const { villageMusic } = await import('../villageMusic');
    const call = (args: Record<string, unknown>) => runUiTool('band_rules', args, {} as never, new Set());
    villageMusic.clearRules();
    // A phrase as the band records it.
    (villageMusic as unknown as { phrases: unknown[] }).phrases.push({
      id: 'phrase-1000',
      t0: 1000,
      t1: 5000,
      part: 'between',
      plan: plan({ mood: 'lament', mode: 'aeolian' }),
      cue: { mood: 'lament', intensity: 0.4 },
      cutAt: 2000,
    });
    const kept = await call({ action: 'keep_figure', phrase_id: 'phrase-1000', name: 'the widow’s turn', reason: 'it fits her' });
    expect(kept.added.rule).toMatch(/keep the figure "the widow’s turn" on the kaval, 50% of the time \(in lament, in the in-between\)/);
    // Only the notes played before the line cut it are kept.
    const rule = villageMusic.rules[0];
    expect(rule.kind === 'keep-figure' && rule.notes.map((n) => n.t)).toEqual([0, 0.5]);
    const thin = await call({ action: 'add', kind: 'thin', instrument: 'tapan', mood: 'lament' });
    expect(thin.added.rule).toBe('leave out the tapan (in lament)');
    await expect(call({ action: 'add', kind: 'louder' })).rejects.toThrow(/kind is/);
    await expect(call({ action: 'keep_figure', phrase_id: 'phrase-9' })).rejects.toThrow(/No phrase/);
    expect((await call({})).rules).toHaveLength(2);
    await call({ action: 'remove', id: thin.added.id });
    expect((await call({ action: 'list' })).rules.map((r: { id: string }) => r.id)).toEqual([rule.id]);
    expect(villageMusic.score().events.filter((e) => e.kind === 'rule')).toHaveLength(3);
    await call({ action: 'clear' });
    expect(villageMusic.rules).toEqual([]);
  });
});
