/**
 * Scheduled cues: things a person places ahead of now on the Loom, to happen when the world
 * reaches them. A cue is a message (to the Scribe, to everyone, or to one character, delivered
 * as if the person had sent it then), a musical break, or a plain note that only marks the
 * cloth. Times are on the world clock (`sim.simTimeMs`), so a cue waits while the world is
 * paused and comes sooner when it runs fast.
 *
 * The schedule is kept with the running world, not saved: the world clock starts again at
 * every load, and a cue belongs to a story as it is being told.
 */
import type { VillageSimulation } from './simulation';

export type CueKind = 'message' | 'music' | 'note';

export interface ScheduledCue {
  id: string;
  kind: CueKind;
  /** When it happens, on the world clock (ms). */
  atSimMs: number;
  /** The words: the message, the note, or what the break is for. */
  text: string;
  /** Who a message goes to: 'narrator' (the Scribe), 'all', or a character's id. */
  to?: string;
  /** How long a musical break lasts (seconds of wall time, as the band plays). */
  holdSeconds?: number;
  /** World time it went off, once it has. */
  firedAtSimMs?: number;
  /** Wall time it went off, so the Loom can lay it among what was said then. */
  firedAtWall?: number;
}

export type CueDraft = Omit<ScheduledCue, 'id' | 'firedAtSimMs' | 'firedAtWall'>;

export const DEFAULT_BREAK_SECONDS = 30;

let nextId = 1;

export class WorldSchedule {
  private items: ScheduledCue[] = [];
  private listeners = new Set<() => void>();

  /** Every cue, soonest first; those already gone off included. */
  list(): readonly ScheduledCue[] {
    return this.items;
  }

  pending(): ScheduledCue[] {
    return this.items.filter((c) => c.firedAtSimMs === undefined);
  }

  get(id: string): ScheduledCue | undefined {
    return this.items.find((c) => c.id === id);
  }

  add(draft: CueDraft): ScheduledCue {
    const cue: ScheduledCue = { ...clean(draft), id: `cue-${Date.now().toString(36)}-${nextId++}` };
    this.items.push(cue);
    this.sort();
    this.changed();
    return cue;
  }

  /** Changes a cue. Moving one that already went off to a later time sets it to go off again. */
  update(id: string, patch: Partial<CueDraft>, nowSimMs?: number): ScheduledCue | undefined {
    const i = this.items.findIndex((c) => c.id === id);
    if (i < 0) return undefined;
    const next: ScheduledCue = { ...this.items[i], ...clean({ ...this.items[i], ...patch }) };
    if (next.firedAtSimMs !== undefined && patch.atSimMs !== undefined && nowSimMs !== undefined && next.atSimMs > nowSimMs) {
      delete next.firedAtSimMs;
      delete next.firedAtWall;
    }
    this.items[i] = next;
    this.sort();
    this.changed();
    return next;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((c) => c.id !== id);
    if (this.items.length === before) return false;
    this.changed();
    return true;
  }

  clear() {
    if (this.items.length === 0) return;
    this.items = [];
    this.changed();
  }

  /**
   * The cues whose time has come by `nowSimMs`, marked as gone off, soonest first. Each goes
   * off once: winding the world back past it does not set it again.
   */
  takeDue(nowSimMs: number, wallNow = Date.now()): ScheduledCue[] {
    const due = this.items.filter((c) => c.firedAtSimMs === undefined && c.atSimMs <= nowSimMs);
    if (due.length === 0) return [];
    for (const c of due) {
      c.firedAtSimMs = nowSimMs;
      c.firedAtWall = wallNow;
    }
    this.changed();
    return due.map((c) => ({ ...c }));
  }

  /**
   * The world clock started again (a new story, a load): cues still to come keep the time
   * they had left, counted from the new clock. Ones gone off keep their place in the past.
   */
  rebase(fromSimMs: number, toSimMs: number) {
    const shift = toSimMs - fromSimMs;
    if (shift === 0 || this.items.length === 0) return;
    for (const c of this.items) {
      c.atSimMs += shift;
      if (c.firedAtSimMs !== undefined) c.firedAtSimMs += shift;
    }
    this.changed();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private sort() {
    this.items.sort((a, b) => a.atSimMs - b.atSimMs);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }
}

function clean<T extends Partial<CueDraft>>(d: T): T {
  const out = { ...d };
  if (out.text !== undefined) out.text = String(out.text).trim();
  if (out.atSimMs !== undefined && !Number.isFinite(out.atSimMs)) throw new Error('A cue needs a time.');
  if (out.kind === 'music') {
    out.holdSeconds = Math.max(5, Math.min(600, Math.round(out.holdSeconds ?? DEFAULT_BREAK_SECONDS)));
    delete out.to;
  } else {
    delete out.holdSeconds;
  }
  if (out.kind === 'message' && !out.to) out.to = 'narrator';
  if (out.kind === 'note') delete out.to;
  return out;
}

/** World time to place a cue at, `msFromNow` of world time after now. */
export function cueTimeFromNow(nowSimMs: number, msFromNow: number): number {
  return nowSimMs + Math.max(0, msFromNow);
}

/**
 * Where a cue sits on a wall-clock axis whose "now" is `wallNow`: ahead of now by the world
 * time it still has to wait. (The Loom draws the past by wall time; the future is world time.)
 */
export function cueWallTime(cue: Pick<ScheduledCue, 'atSimMs'>, nowSimMs: number, wallNow: number): number {
  return wallNow + (cue.atSimMs - nowSimMs);
}

/** The inverse of `cueWallTime`: a point on the axis to world time. */
export function wallToSimTime(wallT: number, nowSimMs: number, wallNow: number): number {
  return nowSimMs + (wallT - wallNow);
}

/**
 * Turns a phrase like "in 1m", "90s", "2 minutes", "1:30" into milliseconds, or null. Plain
 * numbers are seconds.
 */
export function parseDelay(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/^in\s+/, '');
  if (!s) return null;
  const clock = /^(\d+):(\d{1,2})$/.exec(s);
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)?/g;
  let rest = s;
  for (const m of s.matchAll(re)) {
    if (!m[0].trim()) continue;
    matched = true;
    const n = Number(m[1]);
    const unit = m[2] ?? 's';
    total += unit.startsWith('h') ? n * 3_600_000 : unit.startsWith('m') ? n * 60_000 : n * 1000;
    rest = rest.replace(m[0], '');
  }
  if (!matched || rest.replace(/\band\b|[\s,]/g, '')) return null;
  return Math.round(total);
}

/** "in 45s", "in 2m 10s", "45s ago": a cue's distance from now, for labels. */
export function describeOffset(ms: number): string {
  const ahead = ms >= 0;
  const abs = Math.abs(ms);
  const s = Math.round(abs / 1000);
  let body: string;
  if (s < 60) body = `${s}s`;
  else if (s < 3600) body = `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
  else body = `${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60) ? ` ${Math.round((s % 3600) / 60)}m` : ''}`;
  return ahead ? `in ${body}` : `${body} ago`;
}

const schedules = new WeakMap<VillageSimulation, WorldSchedule>();

/** The schedule kept with this world. */
export function scheduleFor(sim: VillageSimulation): WorldSchedule {
  let s = schedules.get(sim);
  if (!s) {
    s = new WorldSchedule();
    schedules.set(sim, s);
  }
  return s;
}
