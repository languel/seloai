/**
 * The director: a camera that follows the story. Each frame it is shown who is where, who is
 * talking to whom and who is speaking, and it chooses a shot: a wide establishing view, a
 * two-shot framing a conversation, a close shot on a strong line, a reaction, or following
 * someone on the move. It keeps a simple film grammar: shots last at least a few seconds and
 * at most a dozen or so, the camera cuts when the story moves somewhere else and eases when
 * it stays, it changes subject between lines rather than in the middle of one, and it does
 * not flick back and forth between the same two places.
 *
 * Pure apart from its own memory: the same inputs at the same times give the same shots, so
 * a run can be replayed as a cut. Rectangles are in map cells.
 */

export interface DirectorActor {
  id: string;
  x: number;
  y: number;
  moving: boolean;
  /** The line being said, if any (it may still be growing as it is spoken). */
  line?: string;
  /** Names the line, so a line that grows word by word is still one line. Defaults to its text. */
  lineId?: string;
  conversationId?: string;
}

export interface DirectorLandmark {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface DirectorInput {
  /** Seconds. */
  time: number;
  actors: DirectorActor[];
  landmarks: DirectorLandmark[];
  mapW: number;
  mapH: number;
  /** Width over height of the view. */
  aspect: number;
}

export type ShotKind = 'establishing' | 'two-shot' | 'close' | 'reaction' | 'follow';

export interface ShotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Shot {
  kind: ShotKind;
  /** What the shot is about: a conversation, a person, or a place. */
  subject: string;
  /** Who is in it. */
  actors: string[];
  rect: ShotRect;
  startedAt: number;
  /** True when this shot began with a cut rather than a camera move. */
  cut: boolean;
  /** A few words for a caption or a log. */
  caption: string;
}

/** Shortest and longest a shot is held, in seconds. */
export const MIN_SHOT = 3;
export const MAX_SHOT = 16;
const CLOSE_HOLD = 3.2;
const REACTION_HOLD = 1.7;
const LULL_ESTABLISH = 40;
/** How long a wide shot of one place is held before the next place, when nothing is happening. */
const ESTABLISH_HOLD = 7;
const RECENT = 9;

interface Candidate {
  kind: ShotKind;
  subject: string;
  actors: string[];
  score: number;
  caption: string;
  landmark?: DirectorLandmark;
}

function strongLine(line: string) {
  return /[?!]\s*$/.test(line.trim()) || line.length > 70;
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export class Director {
  current: Shot | null = null;
  /** Every shot taken, in order: the cut so far. */
  readonly history: Shot[] = [];
  private favoured: string | null = null;
  private lastLine = new Map<string, string>();
  private lastText = new Map<string, string>();
  private closedLines = new Set<string>();
  private lastClose = -Infinity;
  private lastEstablish = -Infinity;
  private left = new Map<string, number>();
  private establishVisits = new Map<string, number>();
  private names = new Map<string, string>();
  /** When the camera came to the current subject; sub-shots (close, reaction) keep it. */
  private subjectSince = 0;

  /** Characters' names for captions. */
  setNames(names: Map<string, string>) {
    this.names = names;
  }

  /** The viewer picked a character: their thread becomes the one the director follows first. */
  favour(id: string | null) {
    this.favoured = id;
  }

  reset() {
    this.current = null;
    this.subjectSince = 0;
    this.lastLine.clear();
    this.left.clear();
    this.lastClose = -Infinity;
    this.lastEstablish = -Infinity;
  }

  private name(id: string) {
    return this.names.get(id) ?? id;
  }

  private candidates(input: DirectorInput): Candidate[] {
    const out: Candidate[] = [];
    const groups = new Map<string, DirectorActor[]>();
    for (const a of input.actors) {
      if (!a.conversationId) continue;
      const g = groups.get(a.conversationId) ?? [];
      g.push(a);
      groups.set(a.conversationId, g);
    }
    for (const [id, members] of groups) {
      if (members.length < 2) continue;
      const speaking = members.some((m) => m.line);
      const favoured = members.some((m) => m.id === this.favoured);
      out.push({
        kind: 'two-shot',
        subject: `talk:${id}`,
        actors: members.map((m) => m.id),
        score: 3 + (speaking ? 2 : 0) + (favoured ? 4 : 0) + members.length * 0.2,
        caption: members.map((m) => this.name(m.id)).join(' and '),
      });
    }
    for (const a of input.actors) {
      if (!a.moving || a.conversationId) continue;
      out.push({ kind: 'follow', subject: `walk:${a.id}`, actors: [a.id], score: 1 + (a.id === this.favoured ? 3 : 0), caption: this.name(a.id) });
    }
    // A wide view: the whole place, or one landmark at a time, least seen first.
    const quiet = out.every((c) => c.kind !== 'two-shot');
    const due = input.time - this.lastEstablish > LULL_ESTABLISH;
    const marks = [...input.landmarks].sort((a, b) => (this.establishVisits.get(a.id) ?? 0) - (this.establishVisits.get(b.id) ?? 0));
    // While a wide shot is up it stays the candidate, so the camera does not hop between places.
    const holding = this.current?.kind === 'establishing' && input.time - this.current.startedAt < ESTABLISH_HOLD ? input.landmarks.find((l) => `place:${l.id}` === this.current!.subject) : undefined;
    const mark = holding ?? marks[0];
    out.push({
      kind: 'establishing',
      subject: mark ? `place:${mark.id}` : 'place:all',
      actors: [],
      score: quiet && due ? 2.4 : 1.1,
      caption: mark?.label ?? 'The whole place',
      landmark: mark,
    });
    return out;
  }

  private frame(kind: ShotKind, actors: DirectorActor[], input: DirectorInput, landmark?: DirectorLandmark): ShotRect {
    let x0: number;
    let y0: number;
    let x1: number;
    let y1: number;
    let minW: number;
    if (actors.length === 0) {
      // Establishing: around a landmark, or the whole place when it is small.
      const w = Math.min(input.mapW, 26);
      const cx = landmark ? landmark.x + 0.5 : input.mapW / 2;
      const cy = landmark ? landmark.y + 0.5 : input.mapH / 2;
      x0 = cx - w / 2;
      x1 = cx + w / 2;
      y0 = cy - w / input.aspect / 2;
      y1 = cy + w / input.aspect / 2;
      minW = w;
    } else {
      x0 = Math.min(...actors.map((a) => a.x));
      x1 = Math.max(...actors.map((a) => a.x)) + 1;
      y0 = Math.min(...actors.map((a) => a.y));
      y1 = Math.max(...actors.map((a) => a.y)) + 1;
      const tight = kind === 'close' || kind === 'reaction';
      // Room above for the head and speech bubble, a little below for the feet.
      x0 -= tight ? 2 : 3.5;
      x1 += tight ? 2 : 3.5;
      y0 -= tight ? 3.2 : 4.5;
      y1 += tight ? 1.2 : 2;
      minW = tight ? 7 : kind === 'follow' ? 13 : 12;
    }
    let w = Math.max(minW, x1 - x0);
    let h = y1 - y0;
    if (w / h < input.aspect) w = h * input.aspect;
    else h = w / input.aspect;
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    // Keep the frame on the cloth when the cloth is bigger than the frame.
    if (w < input.mapW) cx = Math.max(w / 2, Math.min(input.mapW - w / 2, cx));
    else cx = input.mapW / 2;
    if (h < input.mapH) cy = Math.max(h / 2, Math.min(input.mapH - h / 2, cy));
    else cy = input.mapH / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  private take(candidate: Candidate, kind: ShotKind, actors: DirectorActor[], input: DirectorInput, caption: string, forceEase = false): Shot {
    const rect = this.frame(kind, actors, input, candidate.landmark);
    const prev = this.current;
    let cut = !prev;
    if (prev && !forceEase) {
      const dx = rect.x + rect.w / 2 - (prev.rect.x + prev.rect.w / 2);
      const dy = rect.y + rect.h / 2 - (prev.rect.y + prev.rect.h / 2);
      const far = Math.hypot(dx, dy) > prev.rect.w * 0.7;
      const rescale = Math.max(rect.w / prev.rect.w, prev.rect.w / rect.w) > 2.4;
      cut = prev.subject !== candidate.subject && (far || rescale);
    }
    if (prev && prev.subject !== candidate.subject) this.left.set(prev.subject, input.time);
    if (!prev || prev.subject !== candidate.subject) this.subjectSince = input.time;
    if (kind === 'establishing') {
      this.lastEstablish = input.time;
      if (candidate.landmark) this.establishVisits.set(candidate.landmark.id, (this.establishVisits.get(candidate.landmark.id) ?? 0) + 1);
    }
    const shot: Shot = { kind, subject: candidate.subject, actors: actors.map((a) => a.id), rect, startedAt: input.time, cut, caption };
    this.current = shot;
    this.history.push(shot);
    if (this.history.length > 500) this.history.shift();
    return shot;
  }

  /** The shot for this moment. Call every frame; it only changes shot when the grammar allows. */
  update(input: DirectorInput): Shot {
    const byId = new Map(input.actors.map((a) => [a.id, a]));
    const candidates = this.candidates(input);
    const cur = this.current;
    const lineChanged = new Set<string>();
    for (const a of input.actors) {
      const key = a.line ? a.lineId ?? a.line : undefined;
      const before = this.lastLine.get(a.id);
      if (key && key !== before) lineChanged.add(a.id);
      if (key) {
        this.lastLine.set(a.id, key);
        this.lastText.set(a.id, a.line!);
      } else this.lastLine.delete(a.id);
    }

    if (!cur) {
      const first = candidates.find((c) => c.kind === 'establishing')!;
      return this.take(first, 'establishing', [], input, first.caption);
    }

    const elapsed = input.time - cur.startedAt;
    const onSubject = input.time - this.subjectSince;
    const mine = candidates.find((c) => c.subject === cur.subject);
    const members = (mine?.actors ?? cur.actors).map((id) => byId.get(id)).filter((a): a is DirectorActor => Boolean(a));
    const valid = Boolean(mine) || (cur.kind === 'establishing' && elapsed < MAX_SHOT);
    const speakingNow = members.find((m) => m.line);
    const midLine = Boolean(speakingNow) && !lineChanged.has(speakingNow!.id);

    // Change subject?
    const others = candidates
      .filter((c) => c.subject !== cur.subject)
      .map((c) => ({ c, score: c.score - (input.time - (this.left.get(c.subject) ?? -Infinity) < RECENT ? 2 : 0) }))
      .sort((a, b) => b.score - a.score);
    const best = others[0];
    const myScore = mine?.score ?? 0;
    const tooLong = cur.kind === 'establishing' ? elapsed >= ESTABLISH_HOLD : onSubject >= MAX_SHOT;
    const better = best && onSubject >= MIN_SHOT && best.score > myScore * 1.25 + 0.5;
    // Change between lines, not in the middle of one, unless the subject has run long.
    const canCut = !midLine || onSubject >= MAX_SHOT + 3;
    if (best && (!valid || (canCut && (tooLong || better)))) {
      const next = best.c;
      const actors = next.actors.map((id) => byId.get(id)).filter((a): a is DirectorActor => Boolean(a));
      return this.take(next, next.kind, actors, input, next.caption);
    }
    if (!mine && cur.kind !== 'establishing') return cur;

    // Within a conversation: a close shot on a strong line, sometimes a reaction, then back.
    if (mine?.kind === 'two-shot') {
      // A line can turn strong as it is spoken (its question mark comes last), so look at
      // every line in progress that has not had its close shot yet.
      const speaker = members.find((m) => m.line && strongLine(m.line) && !this.closedLines.has(`${m.id}:${m.lineId ?? m.line}`));
      if (speaker && cur.kind === 'two-shot' && input.time - this.lastClose > 9) {
        this.lastClose = input.time;
        this.closedLines.add(`${speaker.id}:${speaker.lineId ?? speaker.line}`);
        if (this.closedLines.size > 200) this.closedLines.clear();
        return this.take(mine, 'close', [speaker], input, `${this.name(speaker.id)}`, true);
      }
      if (cur.kind === 'close' && elapsed >= CLOSE_HOLD) {
        const listener = members.find((m) => m.id !== cur.actors[0]);
        const line = this.lastText.get(cur.actors[0]) ?? '';
        if (listener && hash(line) < 0.4) return this.take(mine, 'reaction', [listener], input, `${this.name(listener.id)} listens`, true);
        return this.take(mine, 'two-shot', members, input, mine.caption, true);
      }
      if (cur.kind === 'reaction' && elapsed >= REACTION_HOLD) return this.take(mine, 'two-shot', members, input, mine.caption, true);
    }

    // Same shot: keep framing the subjects as they move.
    const tracked = cur.kind === 'close' || cur.kind === 'reaction' ? cur.actors.map((id) => byId.get(id)).filter((a): a is DirectorActor => Boolean(a)) : members;
    const landmark = cur.kind === 'establishing' ? input.landmarks.find((l) => `place:${l.id}` === cur.subject) : undefined;
    this.current = { ...cur, rect: this.frame(cur.kind, tracked, input, landmark) };
    return this.current;
  }
}
