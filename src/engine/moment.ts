/**
 * A moment of the story, looked back on: what the band was playing and why, where each
 * character was and what they were about, the last thing each said and thought, and the lines
 * around it. Read from the records the app keeps (conversations, the worldline recorder's
 * frames, the band's score, Spinner's transcript); pure, so the same records always give the
 * same moment. `momentText` puts it in words for the Scribe or Spinner to answer questions on.
 */
import type { MusicEvent, MusicPhrase } from '../music/villageMusic';
import { frameAt, type WorldlineFrame } from './worldlines';

export interface MomentLine {
  t: number;
  from: string;
  fromName: string;
  kind: 'speech' | 'thought' | 'narration';
  text: string;
}

export interface MomentCharacter {
  id: string;
  name: string;
  place: string | null;
  state?: string;
  intention?: string;
  headingTo?: string;
  lastLine?: MomentLine;
  lastThought?: MomentLine;
}

export interface MomentMusic {
  part: MusicPhrase['part'];
  label: string;
  mood: string;
  mode: string;
  dance: string;
  intensity: number;
  texture: string;
  /** Why it was playing that: the cue's reason (a direction, or the story heard). */
  reason?: string;
  /** Whether the phrase had been cut short by a line by then. */
  cut: boolean;
  /** The notes sounding at the moment, by instrument. */
  sounding: Array<{ instrument: 'kaval' | 'gaida' | 'tapan'; midi?: number; kind?: string }>;
}

export interface Moment {
  t: number;
  music: MomentMusic | null;
  /** The latest instructions the band had been given by then. */
  musicEvents: MusicEvent[];
  characters: MomentCharacter[];
  /** Lines said within the window around the moment, in order. */
  around: MomentLine[];
  /** The Scribe's latest passage before the moment. */
  scribe?: MomentLine;
  /** What Spinner was doing around then. */
  spinner: Array<{ t: number; kind: string; text: string }>;
}

export interface MomentSources {
  characters: Array<{ id: string; name: string }>;
  places: Array<{ id: string; label: string; x: number; y: number }>;
  lines: MomentLine[];
  frames: Map<string, readonly WorldlineFrame[]>;
  phrases: readonly MusicPhrase[];
  musicEvents: readonly MusicEvent[];
  spinner: Array<{ t: number; kind: string; text: string }>;
}

const AROUND_MS = 30_000;
const NEAR_PLACE = 4.5;

export function momentAt(src: MomentSources, t: number, aroundMs = AROUND_MS): Moment {
  const placeNear = (x: number, y: number, reach = NEAR_PLACE) => {
    let best: string | null = null;
    let d = reach;
    for (const p of src.places) {
      const dd = Math.hypot(p.x - x, p.y - y);
      if (dd < d) {
        d = dd;
        best = p.label;
      }
    }
    return best;
  };
  const before = src.lines.filter((l) => l.t <= t);
  const names = new Map(src.characters.map((c) => [c.id, c.name]));

  const characters: MomentCharacter[] = src.characters.map((c) => {
    const f = frameAt(src.frames.get(c.id), t);
    let lastLine: MomentLine | undefined;
    let lastThought: MomentLine | undefined;
    for (let i = before.length - 1; i >= 0 && (!lastLine || !lastThought); i--) {
      const l = before[i];
      if (l.from !== c.id) continue;
      if (l.kind === 'thought') lastThought ??= l;
      else if (l.kind === 'speech') lastLine ??= l;
    }
    const headingTo = f?.errand ? names.get(f.errand) ?? f.errand : f?.goal ? placeNear(f.goal.x, f.goal.y, 3.5) ?? undefined : undefined;
    return {
      id: c.id,
      name: c.name,
      place: f ? placeNear(f.x, f.y) : null,
      state: f?.state,
      intention: f?.intention || undefined,
      headingTo,
      lastLine,
      lastThought,
    };
  });

  let music: MomentMusic | null = null;
  for (let i = src.phrases.length - 1; i >= 0; i--) {
    const p = src.phrases[i];
    if (p.t0 > t) continue;
    if (p.t1 < t) break;
    const cut = p.cutAt !== undefined && p.cutAt <= t;
    // Under a line the cut song gave way to ambience: keep looking for what played then.
    if (cut && p.part !== 'ambience') continue;
    const rel = (t - p.t0) / 1000;
    const sounding: MomentMusic['sounding'] = [];
    for (const n of p.plan.kaval) if (n.t <= rel && rel < n.t + n.dur) sounding.push({ instrument: 'kaval', midi: n.midi });
    if (p.plan.gaidaOn) for (const n of p.plan.gaida) if (n.t <= rel && rel < n.t + n.dur) sounding.push({ instrument: 'gaida', midi: n.midi });
    for (const h of p.plan.tapan) if (Math.abs(h.t - rel) < 0.15) sounding.push({ instrument: 'tapan', kind: h.kind });
    music = {
      part: p.part,
      label: p.plan.label,
      mood: p.plan.mood,
      mode: p.plan.mode,
      dance: p.plan.dance,
      intensity: p.plan.intensity,
      texture: p.plan.texture,
      reason: p.cue.reason,
      cut,
      sounding,
    };
    break;
  }

  const musicEvents = src.musicEvents.filter((e) => e.t <= t).slice(-3);
  const around = src.lines.filter((l) => Math.abs(l.t - t) <= aroundMs);
  let scribe: MomentLine | undefined;
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i].kind === 'narration') {
      scribe = before[i];
      break;
    }
  }
  const spinner = src.spinner.filter((s) => Math.abs(s.t - t) <= aroundMs * 2);
  return { t, music, musicEvents, characters, around, scribe, spinner };
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** A MIDI number as a note name: 62 → D4. */
export function noteName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

function clock(ms: number) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** The moment in plain words, as context for a question to the Scribe or Spinner. */
export function momentText(m: Moment, now = Date.now()): string {
  const out: string[] = [];
  const ago = Math.round((now - m.t) / 1000);
  out.push(`The moment: ${clock(m.t)}${ago > 0 ? `, ${ago}s before now` : ago < 0 ? `, ${-ago}s ahead of now` : ', now'}.`);
  if (m.music) {
    const mu = m.music;
    out.push(
      `Music: ${mu.part === 'between' ? 'an in-between motif' : mu.part}${mu.cut ? ' (given way to a line)' : ''}: ${mu.label}; mood ${mu.mood}, mode ${mu.mode}, dance ${mu.dance}, intensity ${mu.intensity.toFixed(2)}, texture ${mu.texture}${mu.reason ? `; because: ${mu.reason}` : ''}.`,
    );
    if (mu.sounding.length) out.push(`Sounding: ${mu.sounding.map((s) => (s.midi !== undefined ? `${s.instrument} ${noteName(s.midi)}` : `${s.instrument} ${s.kind}`)).join(', ')}.`);
  } else out.push('Music: nothing recorded at this moment.');
  if (m.musicEvents.length) out.push(`Latest instructions to the band: ${m.musicEvents.map((e) => `${e.kind}: ${e.text}`).join('; ')}.`);
  out.push('Characters:');
  for (const c of m.characters) {
    const bits = [c.place ? `at ${c.place}` : 'between places'];
    if (c.state) bits.push(c.state);
    if (c.headingTo) bits.push(`heading to ${c.headingTo}`);
    if (c.intention) bits.push(`meaning to: ${c.intention}`);
    if (c.lastLine) bits.push(`last said: "${c.lastLine.text.slice(0, 140)}"`);
    if (c.lastThought) bits.push(`last thought: "${c.lastThought.text.slice(0, 140)}"`);
    out.push(`- ${c.name}: ${bits.join('; ')}`);
  }
  if (m.scribe) out.push(`The Scribe's latest passage: "${m.scribe.text.slice(0, 300)}"`);
  if (m.around.length) {
    out.push('Lines around the moment:');
    for (const l of m.around.slice(-16)) out.push(`- [${Math.round((l.t - m.t) / 1000)}s] ${l.fromName}${l.kind === 'thought' ? ' (thinks)' : ''}: ${l.text.slice(0, 200)}`);
  }
  return out.join('\n');
}
