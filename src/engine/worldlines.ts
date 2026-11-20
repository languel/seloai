/**
 * Worldlines: the history of a world laid out as a piece of weaving, for the Loom.
 *
 * Time runs along the cloth. Each character is a thread. Places are bands across the cloth
 * (the warp), so where someone was reads as where their thread lies. Meetings draw threads
 * together; each line spoken is a cross stitch between speaker and listener, its motif the
 * kind of line; thoughts are seed stitches on one thread; the Scribe's narration is laid
 * across the whole width. Ahead of now, what a character means to do is basting: long loose
 * stitches toward where they are going.
 *
 * `WorldlineRecorder` remembers where everyone was (the simulation only knows where they
 * are now). `layoutLoom` is pure: the same history always lays out the same cloth.
 */
import type { VillageSimulation } from './simulation';

export interface WorldlineSample {
  /** Timestamp, on the same clock as conversation messages. */
  t: number;
  /** The landmark they were at, or null between places. */
  place: string | null;
}

const SAMPLE_EVERY_MS = 1500;
const NEAR_PLACE = 4.5;
const MAX_SAMPLES = 6000;

/** A character as they were at one moment, for looking back (the probe, Psychohistory). */
export interface WorldlineFrame {
  t: number;
  x: number;
  y: number;
  state: string;
  intention: string;
  /** Who they were walking to, if anyone. */
  errand: string | null;
  /** The end of their path, in cells, if walking. */
  goal: { x: number; y: number } | null;
}

/** The frame at or before t (the first one if t is earlier than all). */
export function frameAt(frames: readonly WorldlineFrame[] | undefined, t: number): WorldlineFrame | undefined {
  if (!frames || frames.length === 0) return undefined;
  if (t < frames[0].t) return undefined;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

/** Remembers where every character was, a sample every second and a half. */
export class WorldlineRecorder {
  readonly samples = new Map<string, WorldlineSample[]>();
  /** Every sample's fuller picture: position, state and intention, for looking back. */
  readonly frames = new Map<string, WorldlineFrame[]>();
  /** Where each walker is heading, as a place id, for basting. */
  readonly heading = new Map<string, string | null>();
  private last = -Infinity;

  constructor(private readonly clock: () => number = () => Date.now()) {}

  sample(sim: Pick<VillageSimulation, 'runtimes' | 'map'>) {
    const t = this.clock();
    if (t - this.last < SAMPLE_EVERY_MS) return;
    this.last = t;
    const places = sim.map.pointsOfInterest ?? [];
    const nearest = (x: number, y: number) => {
      let best: string | null = null;
      let dist = NEAR_PLACE;
      for (const p of places) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < dist) {
          dist = d;
          best = p.id;
        }
      }
      return best;
    };
    for (const rt of sim.runtimes.values()) {
      const list = this.samples.get(rt.id) ?? [];
      const place = nearest(rt.x, rt.y);
      // Only keep a sample when something changed or a while has passed, to stay small.
      const prev = list[list.length - 1];
      if (!prev || prev.place !== place || t - prev.t > 20000) list.push({ t, place });
      if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
      this.samples.set(rt.id, list);
      const goal = rt.path[rt.path.length - 1];
      const frames = this.frames.get(rt.id) ?? [];
      const last = frames[frames.length - 1];
      const intention = rt.currentIntention ?? '';
      const errand = rt.errand?.targetId ?? null;
      // A new frame when they moved, changed, or a while has passed.
      if (
        !last ||
        Math.hypot(last.x - rt.x, last.y - rt.y) > 0.4 ||
        last.state !== rt.state ||
        last.intention !== intention ||
        last.errand !== errand ||
        t - last.t > 20000
      ) {
        frames.push({ t, x: rt.x, y: rt.y, state: rt.state, intention, errand, goal: goal ? { x: goal.x, y: goal.y } : null });
        if (frames.length > MAX_SAMPLES) frames.splice(0, frames.length - MAX_SAMPLES);
        this.frames.set(rt.id, frames);
      }
      this.heading.set(rt.id, goal ? nearest(goal.x, goal.y) : null);
    }
  }
}

const recorders = new WeakMap<object, WorldlineRecorder>();

/** The recorder for a simulation, started on first use and fed on every change. */
export function worldlineRecorderFor(sim: VillageSimulation, clock?: () => number): WorldlineRecorder {
  let rec = recorders.get(sim);
  if (!rec) {
    const created = new WorldlineRecorder(clock);
    recorders.set(sim, created);
    created.sample(sim);
    sim.subscribe(() => created.sample(sim));
    rec = created;
  }
  return rec;
}

// ---------------------------------------------------------------------------------------
// Layout

export interface LoomCharacter {
  id: string;
  name: string;
}

export interface LoomPlace {
  id: string;
  label: string;
}

export interface LoomMessage {
  id: string;
  t: number;
  senderId: string;
  partnerIds: string[];
  text: string;
  kind: 'speech' | 'thought' | 'narration';
  conversationId?: string;
}

export type LoomArrangement = 'place' | 'character';

export interface LoomInput {
  characters: LoomCharacter[];
  places: LoomPlace[];
  samples: Map<string, WorldlineSample[]>;
  heading?: Map<string, string | null>;
  messages: LoomMessage[];
  now: number;
  arrangement: LoomArrangement;
}

export interface LoomBand {
  id: string;
  label: string;
  /** Top and bottom of the band, 0..1 down the cloth. */
  y0: number;
  y1: number;
}

export interface LoomThread {
  id: string;
  name: string;
  /** Index into the thread colours. */
  ink: number;
  /** Points along the thread: time and height (0..1). */
  points: Array<{ t: number; y: number }>;
  /** Basting ahead of now, toward where they are going. */
  basting?: Array<{ t: number; y: number }>;
}

export type StitchMotif = 'plain' | 'question' | 'exclaim' | 'long';

export interface LoomStitch {
  id: string;
  t: number;
  kind: 'speech' | 'thought' | 'narration';
  motif: StitchMotif;
  from: string;
  to: string[];
  /** Heights at the speaker and at each listener. */
  y: number;
  toY: number[];
  text: string;
  conversationId?: string;
}

export interface LoomLayout {
  bands: LoomBand[];
  threads: LoomThread[];
  stitches: LoomStitch[];
  start: number;
  now: number;
}

const BETWEEN = '__between';
const BASTE_MS = 45000;

export function motifOf(text: string): StitchMotif {
  const trimmed = text.trim();
  if (/\?\s*["”’']?$/.test(trimmed)) return 'question';
  if (/!\s*["”’']?$/.test(trimmed)) return 'exclaim';
  if (trimmed.length > 110) return 'long';
  return 'plain';
}

/** Where someone was at time t: the last sample at or before t. */
function placeAt(samples: WorldlineSample[] | undefined, t: number): string | null | undefined {
  if (!samples || samples.length === 0 || t < samples[0].t) return undefined;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo].place;
}

export function layoutLoom(input: LoomInput): LoomLayout {
  const { characters, places, samples, messages, now, arrangement } = input;
  const firstSample = Math.min(...[...samples.values()].map((s) => s[0]?.t ?? Infinity));
  const firstMessage = Math.min(...messages.map((m) => m.t));
  const start = Math.min(Number.isFinite(firstSample) ? firstSample : now, Number.isFinite(firstMessage) ? firstMessage : now, now - 60000);

  // Bands: by place (each place a band, with "on the roads" in the middle), or by character.
  const bands: LoomBand[] = [];
  const bandIndex = new Map<string, number>();
  const rows: Array<{ id: string; label: string }> =
    arrangement === 'place'
      ? [...places.slice(0, Math.ceil(places.length / 2)), { id: BETWEEN, label: 'On the roads' }, ...places.slice(Math.ceil(places.length / 2))]
      : characters.map((c) => ({ id: c.id, label: c.name }));
  rows.forEach((r, i) => {
    bandIndex.set(r.id, i);
    bands.push({ id: r.id, label: r.label, y0: i / rows.length, y1: (i + 1) / rows.length });
  });
  const bandOf = (id: string) => bands[bandIndex.get(id) ?? bandIndex.get(BETWEEN) ?? 0];

  const order = new Map(characters.map((c, i) => [c.id, i]));
  // Height of a character's thread at a time.
  const heightAt = (id: string, t: number): number => {
    if (arrangement === 'character') {
      const b = bandOf(id);
      return (b.y0 + b.y1) / 2;
    }
    const place = placeAt(samples.get(id), t);
    const b = bandOf(place ?? BETWEEN);
    // Threads in the same band lie side by side, in a fixed order.
    const k = order.get(id) ?? 0;
    const slot = (k + 0.5) / Math.max(1, characters.length);
    return b.y0 + (b.y1 - b.y0) * (0.15 + 0.7 * slot);
  };

  // In the character arrangement, threads are drawn toward each other while they talk.
  const talkPull = new Map<string, Array<{ t0: number; t1: number; towards: string[] }>>();
  if (arrangement === 'character') {
    const convs = new Map<string, { t0: number; t1: number; members: Set<string> }>();
    for (const m of messages) {
      if (!m.conversationId || m.kind === 'narration') continue;
      const c = convs.get(m.conversationId) ?? { t0: m.t, t1: m.t, members: new Set<string>() };
      c.t0 = Math.min(c.t0, m.t);
      c.t1 = Math.max(c.t1, m.t);
      c.members.add(m.senderId);
      m.partnerIds.forEach((p) => c.members.add(p));
      convs.set(m.conversationId, c);
    }
    for (const c of convs.values()) {
      const members = [...c.members].filter((id) => order.has(id));
      for (const id of members) {
        const list = talkPull.get(id) ?? [];
        list.push({ t0: c.t0 - 4000, t1: c.t1 + 4000, towards: members.filter((m) => m !== id) });
        talkPull.set(id, list);
      }
    }
  }
  const pulled = (id: string, t: number): number => {
    const base = heightAt(id, t);
    if (arrangement !== 'character') return base;
    const spans = talkPull.get(id)?.filter((s) => t >= s.t0 && t <= s.t1) ?? [];
    if (spans.length === 0) return base;
    const others = spans[0].towards.map((o) => heightAt(o, t));
    const meet = (base + others.reduce((a, b) => a + b, 0)) / (others.length + 1);
    const span = spans[0];
    const edge = Math.min(1, (t - span.t0) / 4000, (span.t1 - t) / 4000);
    return base + (meet - base) * 0.75 * Math.max(0, edge);
  };

  // Threads: a point at each sample change and at regular times, so meetings bend them.
  const threads: LoomThread[] = characters.map((c, i) => {
    // A thread begins where its record begins: before that, nothing is known of them.
    const own = samples.get(c.id) ?? [];
    // By character, a row needs no record of places, so it runs the whole length.
    const begin = arrangement === 'character' ? start : own[0]?.t ?? now;
    const times = new Set<number>([begin, now]);
    own.forEach((s, k) => {
      // A change of place slopes over the moment before it, like a thread carried across.
      if (k > 0 && s.place !== own[k - 1].place) times.add(Math.max(own[k - 1].t, s.t - 1200));
      times.add(s.t);
    });
    if (arrangement === 'character') for (const span of talkPull.get(c.id) ?? []) for (let t = span.t0; t <= span.t1; t += 2000) times.add(t);
    const sorted = [...times].filter((t) => t >= begin && t <= now).sort((a, b) => a - b);
    const points = sorted.map((t) => ({ t, y: pulled(c.id, t) }));
    const goal = input.heading?.get(c.id);
    const basting =
      goal !== undefined && goal !== null && arrangement === 'place'
        ? [
            { t: now, y: pulled(c.id, now) },
            { t: now + BASTE_MS, y: (bandOf(goal).y0 + bandOf(goal).y1) / 2 },
          ]
        : undefined;
    return { id: c.id, name: c.name, ink: i, points, basting };
  });

  const stitches: LoomStitch[] = messages
    .filter((m) => m.t >= start && m.t <= now)
    .map((m) => {
      const to = m.partnerIds.filter((p) => order.has(p));
      return {
        id: m.id,
        t: m.t,
        kind: m.kind,
        motif: motifOf(m.text),
        from: m.senderId,
        to,
        y: order.has(m.senderId) ? pulled(m.senderId, m.t) : 0.5,
        toY: to.map((p) => pulled(p, m.t)),
        text: m.text,
        conversationId: m.conversationId,
      };
    });

  return { bands, threads, stitches, start, now };
}

/** The simulation's history as Loom input. */
export function loomInputFor(sim: VillageSimulation, recorder: WorldlineRecorder, arrangement: LoomArrangement, now = Date.now()): LoomInput {
  const characters = [...sim.configs.values()].map((c) => ({ id: c.id, name: c.name }));
  const places = (sim.map.pointsOfInterest ?? []).map((p) => ({ id: p.id, label: p.label }));
  const messages: LoomMessage[] = [];
  for (const conv of sim.conversations) {
    for (const msg of conv.messages) {
      const kind = msg.kind === 'thought' ? 'thought' : msg.kind === 'narration' || msg.senderId === 'narrator' ? 'narration' : 'speech';
      messages.push({
        id: `${conv.id}:${msg.id}`,
        t: msg.timestamp,
        senderId: msg.senderId,
        partnerIds: conv.participantIds.filter((id) => id !== msg.senderId),
        text: msg.text,
        kind,
        conversationId: conv.id,
      });
    }
  }
  messages.sort((a, b) => a.t - b.t);
  return { characters, places, samples: recorder.samples, heading: recorder.heading, messages, now, arrangement };
}
