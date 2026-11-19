import { createSeededRng, type Rng } from '../core/rng';
import { DRONE_BELOW, GAIDA_FROM, METERED_FROM, MOODS, clamp01, type Mood, type MusicCue } from './cue';
import { DANCES, degreeToMidi, type DanceId, type ModeId } from './theory';

/**
 * The composer writes the music one phrase at a time, from a cue and the current (eased)
 * intensity. It plays three ways, the way a village band would tell a story:
 *
 * - a drone: the gaida's drone alone with the odd long, low kaval tone;
 * - free rhythm: the kaval (or a slow gaida) sings rubato phrases that breathe, call and answer;
 * - a dance: a tune in an aksak meter, played in the old A A B B form, with the tapan's big
 *   beater on the start of each group and the switch on the rest. The gaida takes the tune
 *   when the music gets going and the kaval follows its skeleton, an octave up when it is wild.
 *
 * A tune stays the same tune while the scene stays in its mood; as the intensity rises the
 * same tune is played faster and busier (more grace notes, trills, fills), which is how the
 * horo's accelerando works. Pure and seeded: the same cues give the same notes.
 */

export interface NoteEvent {
  /** Seconds from the start of the phrase. */
  t: number;
  dur: number;
  midi: number;
  /** 0 to 1. */
  vel: number;
  /** Grace notes struck just before `t`, in order. */
  graces?: number[];
  /** Slide up into the note from this pitch. */
  glideFrom?: number;
  /** Trill with this upper note for the note's length. */
  trillTo?: number;
  /** 0 to 1: how much vibrato blooms on a held note. */
  vibrato?: number;
  /** Start the note with a fresh breath or tongue, not slurred from the last. */
  tongued?: boolean;
}

export interface HitEvent {
  t: number;
  /** `dum`: the big beater on the bass head. `tek`: the thin switch on the treble head. */
  kind: 'dum' | 'tek';
  vel: number;
}

export interface PhrasePlan {
  /** Seconds until the next phrase begins. */
  length: number;
  mood: Mood;
  mode: ModeId;
  dance: DanceId;
  intensity: number;
  texture: 'drone' | 'free' | 'dance' | 'motif' | 'ambience';
  /** The gaida's chanter sounds through this phrase. */
  gaidaOn: boolean;
  gaida: NoteEvent[];
  kaval: NoteEvent[];
  tapan: HitEvent[];
  /** The drone's level, 0 to 1. */
  drone: number;
  /** Seconds per unit, in a dance. */
  unit?: number;
  /** For logs and the lab: what is being played. */
  label: string;
  /** The scale degree the drone sounds under this phrase (0, the tonic, when left out). */
  droneDegree?: number;
}

/**
 * Where the drone may move away from the tonic, by mood: degrees of the mood's mode (4 the
 * fifth, 3 the fourth, -1 the note below, 1 the second, -2 the sixth below).
 */
const DRONE_MOVES: Record<Mood, readonly number[]> = {
  pastoral: [4, 3, -1],
  lament: [-1, -2, 3],
  mystery: [1, -1, 4],
  dread: [1, -2],
  tension: [3, 1, 4],
  joy: [4, 3],
  festive: [4, 3, -1],
  triumph: [4, 3],
};

interface TuneNote {
  /** Units from the start of the line. */
  u: number;
  len: number;
  deg: number;
}

interface Tune {
  key: string;
  mood: Mood;
  dance: DanceId;
  bars: number;
  barUnits: number;
  /** Phrase A, then B. */
  lines: [TuneNote[], TuneNote[]];
  /** Where the drone moves for the B phrase. */
  bDrone: number;
}

/** The A A B B form, as indices into `Tune.lines`. */
const FORM = [0, 0, 1, 1] as const;

const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length) % items.length];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ways to fill a group of 2 or 3 units with notes; the first is the plainest. */
const CELLS: Record<number, number[][]> = {
  1: [[1]],
  2: [[2], [1, 1]],
  3: [[3], [2, 1], [1, 2], [1, 1, 1]],
};

export class Composer {
  private rng: Rng;
  private tune: Tune | null = null;
  private formPos = 0;
  private formsPlayed = 0;
  private gaidaOn = false;
  private freeCount = 0;
  private ambienceDrone = 0;
  private ambienceHold = 0;
  private ambienceMood: Mood | null = null;

  constructor(seed = 1) {
    this.rng = createSeededRng(seed);
  }

  /** The next phrase for a cue at an intensity (the player eases intensity; the cue holds the target). */
  next(cue: MusicCue, intensityNow?: number): PhrasePlan {
    const intensity = clamp01(intensityNow ?? cue.intensity);
    const mood = cue.mood;
    const prof = MOODS[mood];
    const free = cue.dance === 'free';
    const metered = !free && intensity >= METERED_FROM;

    // The gaida comes in with the dance and stays a little past it (hysteresis), unless told.
    if (cue.lead === 'gaida') this.gaidaOn = intensity >= DRONE_BELOW;
    else if (cue.lead === 'kaval') this.gaidaOn = false;
    else if (!this.gaidaOn && metered && intensity >= GAIDA_FROM) this.gaidaOn = true;
    else if (this.gaidaOn && (intensity < GAIDA_FROM - 0.07 || !metered)) this.gaidaOn = false;

    if (intensity < DRONE_BELOW && !cue.dance) return this.dronePhrase(mood, intensity);
    if (!metered) return this.freePhrase(mood, intensity);
    return this.dancePhrase(cue, mood, intensity, prof.mode);
  }

  /**
   * Two bars of ambience: the drone, and the tapan keeping a sparse, soft pulse in the meter of
   * the tune (or of the mood's first dance). Under a spoken line the drummer plays slower and
   * much sparser rather than quieter: mostly the downbeat, now and then the long group. `amount`
   * (0 to 1) is how much ambience there is; at 0 the bars are silent.
   */
  ambience(cue: MusicCue, intensityNow: number, opts: { underSpeech: boolean; amount: number }): PhrasePlan {
    const rng = this.rng;
    const intensity = clamp01(intensityNow);
    const mood = cue.mood;
    const prof = MOODS[mood];
    const amount = clamp01(opts.amount);
    const under = opts.underSpeech;
    const danceId: DanceId = this.tune?.mood === mood ? this.tune.dance : cue.dance && cue.dance !== 'free' ? cue.dance : prof.dances[0];
    const d = DANCES[danceId];
    const drive = clamp01((intensity - 0.2) / 0.8);
    const unit = lerp(d.unit[0], d.unit[1], drive) * (under ? 1.9 : 1.35);
    const barUnits = d.groups.reduce((a, b) => a + b, 0);
    const bars = 2;
    const longest = d.groups.indexOf(Math.max(...d.groups));
    const drums = amount * prof.drums;
    const soft = (under ? 0.16 : 0.24) + (under ? 0.12 : 0.18) * intensity;
    const tapan: HitEvent[] = [];
    for (let bar = 0; bar < bars; bar++) {
      let u = bar * barUnits;
      d.groups.forEach((g, gi) => {
        const pDum = drums * (gi === 0 ? (under ? 0.6 : 0.85) : gi === longest ? (under ? 0.18 : 0.4) : under ? 0.04 : 0.15);
        if (rng() < pDum) tapan.push({ t: u * unit, kind: 'dum', vel: soft * (gi === 0 ? 1 : 0.8) * (0.85 + 0.15 * rng()) });
        for (let k = 1; k < g; k++) if (rng() < drums * (under ? 0.03 : 0.12)) tapan.push({ t: (u + k) * unit, kind: 'tek', vel: soft * 0.6 });
        u += g;
      });
    }
    // Every few bars the drone may move to another degree, or home again.
    if (--this.ambienceHold <= 0 || this.ambienceMood !== mood) {
      this.ambienceDrone = this.ambienceDrone !== 0 || rng() < 0.65 ? 0 : pick(rng, DRONE_MOVES[mood]);
      this.ambienceHold = 6 + Math.floor(rng() * 7);
      this.ambienceMood = mood;
    }
    return {
      droneDegree: this.ambienceDrone,
      length: bars * barUnits * unit,
      mood,
      mode: prof.mode,
      dance: danceId,
      intensity,
      texture: 'ambience',
      gaidaOn: false,
      gaida: [],
      kaval: [],
      tapan,
      drone: amount * 0.7,
      unit,
      label: `ambience · ${d.label}${under ? ' · under the line' : ''}`,
    };
  }

  /**
   * A motif for the gap between two lines of the story, the way a teller's accompanist fills
   * the breath before the next sentence: a few notes from the tune being played (or a short
   * free phrase when calm) that swell in and fade away, never longer than `maxSeconds`. The
   * kaval carries it; the gaida only when the scene is wild and it is let lead. The tapan gives
   * at most one soft stroke.
   */
  motif(cue: MusicCue, intensityNow: number, maxSeconds = 5): PhrasePlan {
    const intensity = clamp01(intensityNow);
    const rng = this.rng;
    const metered = cue.dance !== 'free' && intensity >= METERED_FROM;
    const phrase = () => (metered ? this.dancePhrase(cue, cue.mood, intensity, MOODS[cue.mood].mode) : this.freePhrase(cue.mood, Math.min(intensity, METERED_FROM - 0.02)));
    const base = phrase();
    const gaidaLeads = cue.lead === 'gaida' || (cue.lead !== 'kaval' && intensity > 0.75);
    const source = [...(base.gaida.length ? base.gaida : base.kaval)];
    // A longer answer (a musical translation of a passage) runs on into the next phrases.
    let offset = base.length;
    for (let k = 0; k < 3 && offset < maxSeconds * 0.75; k++) {
      const more = phrase();
      for (const n of more.gaida.length ? more.gaida : more.kaval) source.push({ ...n, t: n.t + offset });
      offset += more.length;
    }
    // A fragment: from the start, cut at a note boundary near the limit.
    const notes: NoteEvent[] = [];
    for (const n of source) {
      if (n.t + n.dur > maxSeconds && notes.length >= 3) break;
      notes.push({ ...n });
      if (n.t + n.dur > maxSeconds) break;
    }
    // The fragment ends on its last note held a little; velocities swell and fade.
    const last = notes[notes.length - 1];
    if (last) {
      last.dur = Math.max(last.dur, 0.6 + rng() * 0.8);
      last.vibrato = Math.max(last.vibrato ?? 0, 0.6);
    }
    notes.forEach((n, i) => {
      const p = notes.length > 1 ? i / (notes.length - 1) : 0.5;
      n.vel *= 0.45 + 0.55 * Math.sin(Math.PI * (0.15 + 0.7 * p));
      if (i === 0) n.tongued = true;
    });
    const end = last ? last.t + last.dur : 1;
    const strokes = base.tapan.length && rng() < MOODS[cue.mood].drums * 0.6 ? [{ t: 0, kind: 'dum' as const, vel: 0.25 + 0.3 * intensity }] : [];
    return {
      ...base,
      texture: 'motif',
      length: end + 0.4,
      gaidaOn: gaidaLeads,
      gaida: gaidaLeads ? notes.map((n) => ({ ...n, vibrato: 0 })) : [],
      kaval: gaidaLeads ? [] : notes,
      tapan: strokes,
      drone: 0.4,
      label: `motif · ${base.mode} · ${gaidaLeads ? 'gaida' : 'kaval'}`,
    };
  }

  /** The bare drone with, now and then, a long low kaval tone and (in dark moods) a far-off drum. */
  private dronePhrase(mood: Mood, intensity: number): PhrasePlan {
    const rng = this.rng;
    const mode = MOODS[mood].mode;
    const length = 7 + rng() * 5;
    const kaval: NoteEvent[] = [];
    if (rng() < 0.6) {
      const deg = pick(rng, [0, 4, -3, 0, 2]);
      const t = 0.6 + rng() * 2;
      const dur = 2.8 + rng() * 2.4;
      kaval.push({ t, dur, midi: degreeToMidi(deg, mode), vel: 0.42, glideFrom: degreeToMidi(deg - 1, mode), vibrato: 0.6, tongued: true });
      if (rng() < 0.45 && t + dur + 0.2 < length) {
        const d2 = deg - 1;
        kaval.push({ t: t + dur, dur: Math.min(2.2, length - t - dur), midi: degreeToMidi(d2, mode), vel: 0.36, vibrato: 0.5 });
      }
    }
    const tapan: HitEvent[] = [];
    if (MOODS[mood].drums >= 0.9 && rng() < 0.35) tapan.push({ t: rng() * length * 0.6, kind: 'dum', vel: 0.3 });
    return {
      length,
      mood,
      mode,
      dance: 'free',
      intensity,
      texture: 'drone',
      gaidaOn: false,
      gaida: [],
      kaval,
      tapan,
      drone: mood === 'lament' ? 0.35 : 0.5,
      label: `drone · ${mode}`,
    };
  }

  /** A rubato phrase: rises a little, falls to rest, holds its last note, breathes. */
  private freePhrase(mood: Mood, intensity: number): PhrasePlan {
    const rng = this.rng;
    const prof = MOODS[mood];
    const mode = prof.mode;
    const slow = clamp01(1 - (intensity - DRONE_BELOW) / (METERED_FROM - DRONE_BELOW));
    const register = mood === 'lament' ? -2 : mood === 'mystery' ? 3 : 0;
    const answer = this.freeCount++ % 2 === 1;
    const end = (answer ? 0 : pick(rng, [4, 4, 2, 1])) + (register > 1 ? 7 : 0);
    const n = 3 + Math.floor(rng() * 4) + (slow < 0.5 ? 2 : 0);
    let deg = pick(rng, [4, 5, 7, 6, 3]) + register;
    const peakAt = Math.floor(n * (0.2 + rng() * 0.3));

    const notes: NoteEvent[] = [];
    let t = 0.2 + rng() * 0.4;
    const base = 0.32 + slow * 0.55;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      if (last) deg = end;
      else if (i > 0) {
        const toward = i < peakAt ? 1 : end < deg ? -1 : 1;
        const step = rng() < 0.75 ? toward : rng() < 0.5 ? toward * 2 : -toward;
        deg += step;
      }
      const dur = last ? 1.6 + slow * 2 + rng() : base * (0.6 + rng() * 1.4);
      const midi = degreeToMidi(deg, mode);
      const note: NoteEvent = { t, dur, midi, vel: 0.5 + 0.25 * (1 - slow) - (last ? 0.08 : 0), vibrato: dur > 0.7 ? 0.7 : 0.2 };
      if (i === 0) note.tongued = true;
      if (dur > 0.6 && rng() < 0.35) note.graces = [degreeToMidi(deg + 1, mode)];
      else if (rng() < 0.25) note.glideFrom = degreeToMidi(deg - 1, mode);
      // A short breath mid-phrase now and then.
      if (i > 1 && !last && rng() < 0.18) {
        t += 0.18;
        note.t = t;
        note.tongued = true;
      }
      notes.push(note);
      t += dur;
    }
    const rest = 0.7 + slow * 2.6 + rng() * 1.2;
    let length = t + rest;

    const tapan: HitEvent[] = [];
    if (prof.drums >= 0.9 && intensity > 0.2 && rng() < 0.5) {
      // A roll like distant thunder: accelerating, swelling, landing on one big stroke.
      let rt = length * (0.25 + rng() * 0.2);
      const hits = 6 + Math.floor(rng() * 7);
      for (let i = 0; i < hits; i++) {
        const p = i / (hits - 1);
        tapan.push({ t: rt, kind: 'dum', vel: lerp(0.18, 0.75, p * p) });
        rt += lerp(0.38, 0.07, p);
      }
      tapan.push({ t: rt + 0.05, kind: 'dum', vel: 0.95 });
      length = Math.max(length, rt + 1.2);
    } else if (intensity > 0.24 && rng() < prof.drums * 0.45) {
      tapan.push({ t: notes[0]?.t ?? 0, kind: 'dum', vel: 0.38 });
    }

    const gaidaLead = this.gaidaOn;
    return {
      length,
      mood,
      mode,
      dance: 'free',
      intensity,
      texture: 'free',
      gaidaOn: gaidaLead,
      gaida: gaidaLead ? notes.map((n) => ({ ...n, midi: n.midi, vibrato: 0 })) : [],
      kaval: gaidaLead ? [] : notes,
      tapan,
      drone: gaidaLead ? 1 : mood === 'lament' ? 0.4 : 0.55,
      droneDegree: answer || rng() < 0.7 ? 0 : pick(rng, DRONE_MOVES[mood]),
      label: `free · ${mode} · ${gaidaLead ? 'gaida' : 'kaval'}${answer ? ' (answer)' : ''}`,
    };
  }

  private chooseDance(cue: MusicCue, intensity: number): DanceId {
    if (cue.dance && cue.dance !== 'free') return cue.dance;
    const prof = MOODS[cue.mood];
    if (this.tune && this.tune.mood === cue.mood) return this.tune.dance;
    const slowOnes = prof.dances.filter((d) => d === 'bavno' || d === 'lesnoto');
    if (intensity < 0.5 && slowOnes.length) return pick(this.rng, slowOnes);
    return this.rng() < 0.55 ? prof.dances[0] : pick(this.rng, prof.dances);
  }

  private makeTune(mood: Mood, dance: DanceId): Tune {
    const rng = this.rng;
    const groups = DANCES[dance].groups;
    const barUnits = groups.reduce((a, b) => a + b, 0);
    const bars = barUnits <= 5 ? 4 : 2;
    const register = mood === 'lament' ? -1 : 0;
    const a = this.makeLine(groups, bars, pick(rng, [0, 1, 2]) + register, pick(rng, [4, 5]) + register, pick(rng, [4, 1, 4]) + register);
    // B climbs higher, often as a sequence of A's opening, and comes home to the tonic.
    const b = this.makeLine(groups, bars, pick(rng, [4, 5]) + register, pick(rng, [6, 7, 8]) + register, 0 + register);
    return { key: `${mood}:${dance}`, mood, dance, bars, barUnits, lines: [a, b], bDrone: rng() < 0.5 ? pick(rng, DRONE_MOVES[mood]) : 0 };
  }

  /** One line of a tune: rhythm cell per group, an arching stepwise contour, a held cadence. */
  private makeLine(groups: readonly number[], bars: number, start: number, peak: number, end: number): TuneNote[] {
    const rng = this.rng;
    const rhythm: Array<{ u: number; len: number }> = [];
    let u = 0;
    for (let bar = 0; bar < bars; bar++) {
      groups.forEach((g, gi) => {
        const cadence = bar === bars - 1 && gi === groups.length - 1;
        const options = CELLS[g] ?? [[g]];
        const cell = cadence ? [g] : rng() < 0.62 ? pick(rng, options.slice(1).length ? options.slice(1) : options) : options[0];
        for (const len of cell) {
          rhythm.push({ u, len });
          u += len;
        }
      });
    }
    const n = rhythm.length;
    const notes: TuneNote[] = [];
    let deg = start;
    for (let i = 0; i < n; i++) {
      const p = n > 1 ? i / (n - 1) : 1;
      const arch = p < 0.45 ? lerp(start, peak, p / 0.45) : lerp(peak, end, (p - 0.45) / 0.55);
      if (i === 0) deg = start;
      else if (i === n - 1) deg = end;
      else if (i === n - 2) deg = end + (rng() < 0.65 ? 1 : -1);
      else {
        const pull = Math.round(arch - deg);
        let step = Math.max(-2, Math.min(2, pull + (rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0)));
        if (step === 0 && rng() < 0.45) step = rng() < 0.5 ? -1 : 1;
        if (rng() < 0.08) step = rng() < 0.5 ? 3 : -3;
        deg += step;
      }
      deg = Math.max(-1, Math.min(9, deg));
      notes.push({ u: rhythm[i].u, len: rhythm[i].len, deg });
    }
    return notes;
  }

  private dancePhrase(cue: MusicCue, mood: Mood, intensity: number, mode: ModeId): PhrasePlan {
    const rng = this.rng;
    const prof = MOODS[mood];
    const dance = this.chooseDance(cue, intensity);
    const key = `${mood}:${dance}`;
    if (!this.tune || this.tune.key !== key || (this.formPos === 0 && this.formsPlayed >= 2 + Math.floor(rng() * 2))) {
      this.tune = this.makeTune(mood, dance);
      this.formPos = 0;
      this.formsPlayed = 0;
    }
    const tune = this.tune;
    const lineIdx = FORM[this.formPos];
    const formEnd = this.formPos === FORM.length - 1;
    this.formPos = (this.formPos + 1) % FORM.length;
    if (this.formPos === 0) this.formsPlayed++;

    const groups = DANCES[dance].groups;
    const d = DANCES[dance];
    const drive = clamp01((intensity - METERED_FROM) / (1 - METERED_FROM));
    const unit = lerp(d.unit[0], d.unit[1], drive);
    const length = tune.bars * tune.barUnits * unit;
    const line = tune.lines[lineIdx];

    // The melody as played this time: busier as the drive rises.
    const played: TuneNote[] = [];
    for (const note of line) {
      if (intensity > 0.78 && note.len >= 2 && rng() < (intensity - 0.7) * 1.6) {
        const nb = note.deg + (rng() < 0.6 ? 1 : -1);
        played.push({ u: note.u, len: 1, deg: note.deg }, { u: note.u + 1, len: note.len - 1, deg: rng() < 0.5 ? nb : note.deg });
      } else played.push(note);
    }

    const gaida: NoteEvent[] = [];
    const kaval: NoteEvent[] = [];
    if (this.gaidaOn) {
      let prev: number | null = null;
      for (const note of played) {
        const ev: NoteEvent = { t: note.u * unit, dur: note.len * unit, midi: degreeToMidi(note.deg, mode), vel: 0.85 };
        // A bagpipe cannot stop between notes: a repeated note is parted by a grace note.
        if (prev === note.deg) ev.graces = [degreeToMidi(note.deg + (rng() < 0.7 ? 1 : 2), mode)];
        else if (rng() < 0.15 + intensity * 0.35) ev.graces = [degreeToMidi(note.deg + (rng() < 0.6 ? 1 : 2), mode)];
        if (note.len >= 3 && intensity > 0.72 && rng() < 0.45) ev.trillTo = degreeToMidi(note.deg + 1, mode);
        gaida.push(ev);
        prev = note.deg;
      }
      // The kaval follows the skeleton: the first note of each group, held through it.
      const octave = intensity > 0.75 ? 7 : 0;
      let u = 0;
      const rest = rng() < 0.2 ? Math.floor(rng() * tune.bars) : -1;
      for (let bar = 0; bar < tune.bars; bar++) {
        for (const g of groups) {
          const at = played.find((n) => n.u >= u) ?? played[played.length - 1];
          if (bar !== rest) kaval.push({ t: u * unit, dur: g * unit, midi: degreeToMidi(at.deg + octave, mode), vel: 0.42, tongued: true, vibrato: g * unit > 0.4 ? 0.4 : 0 });
          u += g;
        }
      }
    } else {
      let prev: number | null = null;
      for (const note of played) {
        const dur = note.len * unit;
        const ev: NoteEvent = { t: note.u * unit, dur, midi: degreeToMidi(note.deg, mode), vel: 0.62, tongued: prev === note.deg || note.u === 0 || rng() < 0.3 };
        if (dur > 0.45) ev.vibrato = 0.6;
        if (dur > 0.3 && rng() < 0.3) ev.graces = [degreeToMidi(note.deg + 1, mode)];
        else if (rng() < 0.15) ev.glideFrom = degreeToMidi(note.deg - 1, mode);
        kaval.push(ev);
        prev = note.deg;
      }
    }

    const tapan = this.tapanPattern(groups, tune.bars, unit, intensity, prof.drums, formEnd);
    const lead = this.gaidaOn ? 'gaida' : 'kaval';
    return {
      length,
      mood,
      mode,
      dance,
      intensity,
      texture: 'dance',
      gaidaOn: this.gaidaOn,
      gaida,
      kaval,
      tapan,
      drone: this.gaidaOn ? 1 : 0.5,
      droneDegree: lineIdx === 0 ? 0 : tune.bDrone,
      unit,
      label: `${DANCES[dance].label} · ${mode} · ${lead} · ${lineIdx === 0 ? 'A' : 'B'}${formEnd ? ' · fill' : ''}`,
    };
  }

  /** Dum on each group's start, tek on the rest; sparser when calm, doubled and filled when wild. */
  private tapanPattern(groups: readonly number[], bars: number, unit: number, intensity: number, drums: number, fill: boolean): HitEvent[] {
    const rng = this.rng;
    const hits: HitEvent[] = [];
    const full = intensity >= GAIDA_FROM && drums >= 0.5;
    const barUnits = groups.reduce((a, b) => a + b, 0);
    const longest = groups.indexOf(Math.max(...groups));
    for (let bar = 0; bar < bars; bar++) {
      const b0 = bar * barUnits;
      const lastBar = bar === bars - 1;
      if (fill && lastBar && intensity > 0.6) {
        // The fill: the switch rattles in half units, the beater lands on the long group.
        for (let h = 0; h < barUnits * 2; h++) hits.push({ t: (b0 + h / 2) * unit, kind: 'tek', vel: lerp(0.3, 0.75, h / (barUnits * 2)) });
        let u = 0;
        groups.forEach((g, gi) => {
          if (gi >= groups.length - 2) for (let k = 0; k < g; k++) hits.push({ t: (b0 + u + k) * unit, kind: 'dum', vel: 0.7 + 0.1 * k });
          u += g;
        });
        continue;
      }
      if (!full && drums < 0.5 && bar % 2 === 1) continue;
      let u = 0;
      groups.forEach((g, gi) => {
        const t0 = b0 + u;
        const strong = gi === 0 || gi === longest;
        if (full || strong) hits.push({ t: t0 * unit, kind: 'dum', vel: (gi === 0 ? 0.95 : g === 3 ? 0.82 : 0.72) * (0.92 + rng() * 0.08) * (full ? 1 : 0.7) });
        for (let k = 1; k < g; k++) {
          if (full || (gi === groups.length - 1 && k === g - 1)) hits.push({ t: (t0 + k) * unit, kind: 'tek', vel: (k === g - 1 ? 0.55 : 0.45) * (0.85 + rng() * 0.15) });
        }
        if (intensity > 0.75 && rng() < (intensity - 0.72) * 2) hits.push({ t: (t0 + g - 0.5) * unit, kind: 'tek', vel: 0.32 });
        u += g;
      });
    }
    return hits.sort((a, b) => a.t - b.t);
  }
}
