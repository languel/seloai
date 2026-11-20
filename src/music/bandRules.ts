/**
 * The band's standing rules: what a person (or Spinner, for them) has asked it to keep doing
 * and to leave out, after listening. A rule can be scoped to a mood and to a part of the music
 * (ambience, the in-between motifs, song); left out, it holds everywhere.
 *
 * - `keep-figure`: a melodic figure heard and liked (from a phrase on the Loom), played again
 *   in matching moments, moved into the mode of the moment (the village plays in one key).
 * - `thin`: an instrument plays less (`amount` 1 leaves it out entirely).
 * - `no-ornaments`: grace notes, glides or trills left off an instrument.
 * - `prefer-dance` / `avoid-dance`: which dance the band plays in, in a mood.
 *
 * Pure: `ruleCue` adjusts what the band is asked for before it composes, `applyRules` adjusts
 * a phrase once composed, and both say which rules they used, for the Loom.
 */
import type { Mood, MusicCue } from './cue';
import type { HitEvent, NoteEvent, PhrasePlan } from './composer';
import { MOODS } from './cue';
import { DANCES, MODES, TONIC_MIDI, degreeToMidi, type DanceId, type ModeId } from './theory';

export type Part = 'ambience' | 'between' | 'song';
export type Instrument = 'kaval' | 'gaida' | 'tapan' | 'drone';
export type Ornament = 'graces' | 'glide' | 'trill';

export interface RuleScope {
  mood?: Mood;
  part?: Part;
}

interface RuleBase {
  id: string;
  when: RuleScope;
  /** Why, in the person's words, for the list and for Spinner. */
  reason?: string;
  /** When it was made (ms). */
  at: number;
}

export type BandRule = RuleBase &
  (
    | {
        kind: 'keep-figure';
        /** A name for the list: "Lamia's kaval figure". */
        name: string;
        /** Which instrument plays it back (the kaval or the gaida). */
        instrument: 'kaval' | 'gaida';
        /** The notes, from the figure's start (seconds), in `mode`. */
        notes: NoteEvent[];
        mode: ModeId;
        /** The figure's unit in a dance, so it can follow the tempo of the moment. */
        unit?: number;
        /** How often it comes back where it fits, 0 to 1. */
        weight: number;
      }
    | { kind: 'thin'; instrument: Instrument; amount: number }
    | { kind: 'no-ornaments'; instrument: 'kaval' | 'gaida'; ornaments: Ornament[] }
    | { kind: 'prefer-dance'; dance: DanceId }
    | { kind: 'avoid-dance'; dance: DanceId }
  );

export type RuleDraft = BandRule extends infer R ? (R extends BandRule ? Omit<R, 'id' | 'at'> & { id?: string; at?: number } : never) : never;

const fits = (when: RuleScope, mood: Mood, part: Part | null) => (!when.mood || when.mood === mood) && (!when.part || part === null || when.part === part);

/** The nearest scale degree of `midi` in `mode` (the village's tonic). */
export function degreeOf(midi: number, mode: ModeId): number {
  const rel = midi - TONIC_MIDI;
  const octave = Math.floor(rel / 12);
  const within = rel - octave * 12;
  const steps = MODES[mode];
  let best = 0;
  let bestD = Infinity;
  steps.forEach((s, i) => {
    for (const cand of [s, s + 12, s - 12]) {
      const d = Math.abs(cand - within);
      if (d < bestD) {
        bestD = d;
        best = i + (cand - s) / 12 * 7;
      }
    }
  });
  return octave * 7 + best;
}

/** A pitch moved from one mode to another, degree for degree. */
export function moveToMode(midi: number, from: ModeId, to: ModeId): number {
  if (from === to) return midi;
  return degreeToMidi(degreeOf(midi, from), to);
}

/** What the band is asked for, with the dance rules applied (an explicit dance in the cue wins). */
export function ruleCue(cue: MusicCue, rules: readonly BandRule[], part: Part | null = null): { cue: MusicCue; applied: string[] } {
  if (cue.dance) return { cue, applied: [] };
  const applied: string[] = [];
  const mine = rules.filter((r) => fits(r.when, cue.mood, part));
  const prefer = mine.find((r) => r.kind === 'prefer-dance');
  if (prefer && prefer.kind === 'prefer-dance') return { cue: { ...cue, dance: prefer.dance }, applied: [prefer.id] };
  const avoided = new Set(mine.flatMap((r) => (r.kind === 'avoid-dance' ? [r.dance] : [])));
  if (avoided.size) {
    const dances = MOODS[cue.mood].dances;
    if (avoided.has(dances[0])) {
      const other = dances.find((d) => !avoided.has(d)) ?? (['pravo', 'bavno', 'lesnoto', 'rachenitsa'] as DanceId[]).find((d) => !avoided.has(d));
      if (other) {
        applied.push(...mine.filter((r) => r.kind === 'avoid-dance').map((r) => r.id));
        return { cue: { ...cue, dance: other }, applied };
      }
    }
  }
  return { cue, applied };
}

/**
 * A composed phrase with the rules applied: figures kept come back, instruments thin out,
 * ornaments come off. `rng` decides the chancy parts (whether a figure comes back, which hits
 * a thinned tapan keeps), so the same seed gives the same music.
 */
export function applyRules(plan: PhrasePlan, part: Part, rules: readonly BandRule[], rng: () => number): { plan: PhrasePlan; applied: string[] } {
  const mine = rules.filter((r) => fits(r.when, plan.mood, part));
  if (mine.length === 0) return { plan, applied: [] };
  const applied: string[] = [];
  let out: PhrasePlan = { ...plan, kaval: plan.kaval, gaida: plan.gaida, tapan: plan.tapan };

  // A kept figure, where the music is melodic and the moment fits.
  if (part !== 'ambience' && plan.texture !== 'drone') {
    const figures = mine.filter((r): r is Extract<BandRule, { kind: 'keep-figure' }> => r.kind === 'keep-figure');
    for (const f of figures) {
      if (rng() >= f.weight) continue;
      const scale = f.unit && plan.unit ? plan.unit / f.unit : 1;
      const notes = f.notes.map((n) => ({
        ...n,
        t: n.t * scale,
        dur: n.dur * scale,
        midi: moveToMode(n.midi, f.mode, plan.mode),
        graces: n.graces?.map((g) => moveToMode(g, f.mode, plan.mode)),
        glideFrom: n.glideFrom === undefined ? undefined : moveToMode(n.glideFrom, f.mode, plan.mode),
        trillTo: n.trillTo === undefined ? undefined : moveToMode(n.trillTo, f.mode, plan.mode),
      }));
      const end = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
      // A song keeps its bars: the figure only where it fits in the phrase.
      if (part === 'song' && end > plan.length * 1.05) continue;
      const length = part === 'song' ? plan.length : Math.max(plan.length, end + 0.4);
      out = {
        ...out,
        length,
        kaval: f.instrument === 'kaval' ? notes : [],
        gaida: f.instrument === 'gaida' ? notes : part === 'song' ? out.gaida : [],
        gaidaOn: f.instrument === 'gaida' ? true : out.gaidaOn,
        label: `${plan.label} · kept: ${f.name}`,
      };
      applied.push(f.id);
      break;
    }
  }

  for (const r of mine) {
    if (r.kind === 'thin') {
      const keep = 1 - Math.max(0, Math.min(1, r.amount));
      const thinNotes = (notes: NoteEvent[]) => (keep <= 0 ? [] : notes.filter((_, i) => i === 0 || rng() < keep));
      if (r.instrument === 'kaval') out = { ...out, kaval: thinNotes(out.kaval) };
      else if (r.instrument === 'gaida') out = keep <= 0 ? { ...out, gaida: [], gaidaOn: false } : { ...out, gaida: thinNotes(out.gaida) };
      else if (r.instrument === 'tapan') out = { ...out, tapan: keep <= 0 ? [] : out.tapan.filter((h: HitEvent) => (h.kind === 'dum' && h.t === 0) || rng() < keep) };
      else out = { ...out, drone: out.drone * keep };
      applied.push(r.id);
    } else if (r.kind === 'no-ornaments') {
      const strip = (n: NoteEvent): NoteEvent => ({
        ...n,
        graces: r.ornaments.includes('graces') ? undefined : n.graces,
        glideFrom: r.ornaments.includes('glide') ? undefined : n.glideFrom,
        trillTo: r.ornaments.includes('trill') ? undefined : n.trillTo,
      });
      out = { ...out, [r.instrument]: out[r.instrument].map(strip) };
      applied.push(r.id);
    }
  }
  return { plan: out, applied };
}

/** A rule in a few words, for the list and for Spinner. */
export function describeRule(r: BandRule): string {
  const scope = [r.when.mood ? `in ${r.when.mood}` : '', r.when.part ? `in the ${r.when.part === 'between' ? 'in-between' : r.when.part}` : ''].filter(Boolean).join(', ');
  const where = scope ? ` (${scope})` : '';
  switch (r.kind) {
    case 'keep-figure':
      return `keep the figure "${r.name}" on the ${r.instrument}, ${Math.round(r.weight * 100)}% of the time${where}`;
    case 'thin':
      return r.amount >= 1 ? `leave out the ${r.instrument}${where}` : `${r.instrument} plays ${Math.round(r.amount * 100)}% less${where}`;
    case 'no-ornaments':
      return `no ${r.ornaments.join(' or ')} on the ${r.instrument}${where}`;
    case 'prefer-dance':
      return `play the ${DANCES[r.dance].label}${where}`;
    case 'avoid-dance':
      return `avoid the ${DANCES[r.dance].label}${where}`;
  }
}

let nextId = 1;

/** Fills in an id and a time, and checks the values. */
export function makeRule(d: RuleDraft, now = Date.now()): BandRule {
  const id = d.id ?? `rule-${now.toString(36)}-${nextId++}`;
  const base = { ...d, id, at: d.at ?? now, when: { ...(d.when ?? {}) } } as BandRule;
  if (base.when.mood && !(base.when.mood in MOODS)) throw new Error(`"${base.when.mood}" is not a mood: use ${Object.keys(MOODS).join(', ')}.`);
  if (base.when.part && !['ambience', 'between', 'song'].includes(base.when.part)) throw new Error('part is ambience, between or song.');
  switch (base.kind) {
    case 'keep-figure':
      if (!base.notes?.length) throw new Error('A figure needs notes.');
      if (base.instrument !== 'kaval' && base.instrument !== 'gaida') throw new Error('A figure is played on the kaval or the gaida.');
      base.weight = Math.max(0.05, Math.min(1, base.weight ?? 0.5));
      break;
    case 'thin':
      if (!['kaval', 'gaida', 'tapan', 'drone'].includes(base.instrument)) throw new Error('instrument is kaval, gaida, tapan or drone.');
      base.amount = Math.max(0.05, Math.min(1, Number.isFinite(base.amount) ? base.amount : 1));
      break;
    case 'no-ornaments':
      if (base.instrument !== 'kaval' && base.instrument !== 'gaida') throw new Error('Ornaments are on the kaval or the gaida.');
      base.ornaments = (base.ornaments?.length ? base.ornaments : (['graces', 'glide', 'trill'] as Ornament[])).filter((o) => ['graces', 'glide', 'trill'].includes(o));
      break;
    case 'prefer-dance':
    case 'avoid-dance':
      if (!(base.dance in DANCES) || base.dance === 'free') throw new Error(`dance is one of ${Object.keys(DANCES).filter((d) => d !== 'free').join(', ')}.`);
      break;
    default:
      throw new Error('kind is keep-figure, thin, no-ornaments, prefer-dance or avoid-dance.');
  }
  return base;
}
