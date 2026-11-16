/**
 * Woven text: speech and thoughts embroidered straight onto the cloth, in the manner of
 * concrete poetry, instead of in bubbles.
 *
 * Each line is laid letter by letter along a path that curls around its speaker, turning to
 * avoid characters and the text already there. The newest letters stay "wet" for a moment:
 * a small packing simulation nudges them away from their neighbours and keeps their spacing
 * along the line, and then they dry and never move again, as if stitched. As the speaker
 * walks, new letters follow them; old ones stay where they were sewn. After a while letters
 * fade, which leaves room for new ones. Legibility is welcome but not the point.
 *
 * Pure apart from its own memory, and in world pixels.
 */

export interface WovenSpeaker {
  id: string;
  /** Where the line starts from: the speaker's head, in world pixels. */
  x: number;
  y: number;
  /** The line so far (it may still be growing as it is spoken). */
  text: string;
  /** Names the line, so a growing line stays one line. */
  lineId: string;
  kind: 'speech' | 'thought';
  colour: string;
}

export interface WovenObstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WovenOptions {
  /** Letter height in world pixels. */
  size: number;
  /** Seconds a letter stays at full strength before it starts to fade. */
  holdSec: number;
  /** Seconds a letter takes to fade away. */
  fadeSec: number;
  /** Letters sewn per second, at most: the pace of the writing. */
  charsPerSec: number;
  bounds: { w: number; h: number };
}

export interface WovenLetter {
  ch: string;
  x: number;
  y: number;
  /** Radians: the direction the line runs at this letter. */
  angle: number;
  size: number;
  colour: string;
  speakerId: string;
  kind: 'speech' | 'thought';
  lineKey: string;
  /** Seconds. */
  born: number;
  /** Order within its line. */
  seq: number;
}

interface LineState {
  key: string;
  speakerId: string;
  kind: 'speech' | 'thought';
  colour: string;
  text: string;
  placed: number;
  /** Where the next letter goes, and which way the line is running. */
  hx: number;
  hy: number;
  heading: number;
  /** The radius the line keeps around its speaker; it grows as the space fills. */
  orbit: number;
  /** +1 runs clockwise around the speaker, -1 anticlockwise. */
  spin: number;
  lastPlacedAt: number;
  started: boolean;
  /** Speaker position, followed while they move. */
  sx: number;
  sy: number;
  live: boolean;
}

const WET_SEC = 1.1;
const SPACE = ' ';

function hash01(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** How wide a letter sits along its line, as a share of the letter height. */
export function advanceOf(ch: string): number {
  if (ch === SPACE) return 0.42;
  if ('iljtf.,:;!\'|'.includes(ch)) return 0.36;
  if ('mwMW'.includes(ch)) return 0.82;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  return 0.56;
}

export class WovenText {
  letters: WovenLetter[] = [];
  private lines = new Map<string, LineState>();
  private grid = new Map<number, WovenLetter[]>();
  private cell = 16;

  private key(x: number, y: number) {
    return Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell);
  }

  private reindex() {
    this.grid.clear();
    for (const l of this.letters) {
      const k = this.key(l.x, l.y);
      const list = this.grid.get(k);
      if (list) list.push(l);
      else this.grid.set(k, [l]);
    }
  }

  private near(x: number, y: number, r: number): WovenLetter[] {
    const out: WovenLetter[] = [];
    const c = this.cell;
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++) {
      for (let gy = Math.floor((y - r) / c); gy <= Math.floor((y + r) / c); gy++) {
        const list = this.grid.get(gx * 100003 + gy);
        if (list) out.push(...list);
      }
    }
    return out;
  }

  /** Is a letter of this size free to sit here? */
  private free(x: number, y: number, size: number, line: LineState, obstacles: WovenObstacle[], opts: WovenOptions): boolean {
    const m = size * 0.5;
    if (x < m || y < m || x > opts.bounds.w - m || y > opts.bounds.h - m) return false;
    for (const o of obstacles) {
      if (x > o.x - m && x < o.x + o.w + m && y > o.y - m && y < o.y + o.h + m) return false;
    }
    const r = size * 0.56;
    for (const l of this.near(x, y, r + size)) {
      // A line's own last few letters are its neighbours, not obstacles.
      if (l.lineKey === line.key && l.seq >= line.placed - 2) continue;
      const rr = (l.size + size) * 0.28;
      if ((l.x - x) ** 2 + (l.y - y) ** 2 < rr * rr) return false;
    }
    return true;
  }

  /** Where to begin a new line: somewhere free on a ring around the speaker. */
  private start(line: LineState, obstacles: WovenObstacle[], opts: WovenOptions) {
    const size = opts.size * (line.kind === 'thought' ? 0.85 : 1);
    const base = hash01(line.key) * Math.PI * 2;
    for (let ring = 0; ring < 6; ring++) {
      const radius = size * (3.4 + ring * 1.6);
      for (let k = 0; k < 16; k++) {
        const a = base + (k / 16) * Math.PI * 2;
        const x = line.sx + Math.cos(a) * radius;
        const y = line.sy + Math.sin(a) * radius * 0.8;
        const heading = a + (line.spin * Math.PI) / 2;
        // Room for a few letters running on from here, so a jump never strands one letter.
        let room = this.free(x, y, size, line, obstacles, opts);
        for (let k = 1; room && k <= 4; k++) room = this.free(x + Math.cos(heading) * size * 0.6 * k, y + Math.sin(heading) * size * 0.6 * k, size, line, obstacles, opts);
        if (room) {
          line.hx = x;
          line.hy = y;
          line.heading = heading;
          line.orbit = radius;
          line.started = true;
          return true;
        }
      }
    }
    return false;
  }

  /** Lays one more character of a line; false when there is no room anywhere near. */
  private place(line: LineState, ch: string, t: number, obstacles: WovenObstacle[], opts: WovenOptions): boolean {
    const size = opts.size * (line.kind === 'thought' ? 0.85 : 1);
    if (!line.started && !this.start(line, obstacles, opts)) return false;
    const step = advanceOf(ch) * size;
    // The way the line wants to go: around the speaker at its orbit, curling in or out.
    const dx = line.hx - line.sx;
    const dy = line.hy - line.sy;
    const dist = Math.hypot(dx, dy) || 1;
    const tangent = Math.atan2(dy, dx) + (line.spin * Math.PI) / 2;
    const radial = Math.max(-0.45, Math.min(0.45, ((line.orbit - dist) / size) * 0.1)) * -line.spin;
    let want = tangent + radial;
    // Follow a speaker who walks off: aim back toward them once the text trails too far.
    if (dist > line.orbit * 2.4) want = Math.atan2(-dy, -dx);
    const turnBy = ((want - line.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    // A line bends gently, like thread laid by hand, never in tight curls; it wanders a
    // little and spirals slowly outward, so it reads as sewn rather than drawn with a compass.
    const wander = Math.sin(line.placed * 0.37 + hash01(line.key) * 6.28) * 0.07;
    const preferred = line.heading + Math.max(-0.15, Math.min(0.15, turnBy * 0.7)) + wander;
    line.orbit += size * 0.035;
    if (ch !== SPACE) {
      for (let k = 0; k <= 12; k++) {
        const offset = (k === 0 ? 0 : Math.ceil(k / 2) * 0.22 * (k % 2 ? 1 : -1)) * line.spin;
        const a = preferred + offset;
        const x = line.hx + Math.cos(a) * step * 0.5;
        const y = line.hy + Math.sin(a) * step * 0.5;
        if (!this.free(x, y, size, line, obstacles, opts)) continue;
        this.letters.push({ ch, x, y, angle: a, size, colour: line.colour, speakerId: line.speakerId, kind: line.kind, lineKey: line.key, born: t, seq: line.placed });
        const k2 = this.key(x, y);
        const list = this.grid.get(k2);
        const letter = this.letters[this.letters.length - 1];
        if (list) list.push(letter);
        else this.grid.set(k2, [letter]);
        line.hx += Math.cos(a) * step;
        line.hy += Math.sin(a) * step;
        line.heading = a;
        return true;
      }
      // Blocked: widen the orbit and jump to a fresh spot, leaving a gap in the line.
      line.orbit += size * 1.2;
      line.started = false;
      return this.start(line, obstacles, opts) && this.place(line, ch, t, obstacles, opts);
    }
    line.hx += Math.cos(preferred) * step;
    line.hy += Math.sin(preferred) * step;
    line.heading = preferred;
    return true;
  }

  /** The packing step: wet letters push off their neighbours and keep their spacing. */
  private relax(t: number, obstacles: WovenObstacle[]) {
    const wet = this.letters.filter((l) => t - l.born < WET_SEC);
    if (wet.length === 0) return;
    const byLine = new Map<string, WovenLetter[]>();
    for (const l of this.letters) {
      if (!wet.some((w) => w.lineKey === l.lineKey)) continue;
      const list = byLine.get(l.lineKey) ?? [];
      list.push(l);
      byLine.set(l.lineKey, list);
    }
    for (const l of wet) {
      const dryness = (t - l.born) / WET_SEC;
      const give = (1 - dryness) * 0.35;
      let fx = 0;
      let fy = 0;
      // Repelled by other text that is too close.
      for (const o of this.near(l.x, l.y, l.size)) {
        if (o === l || (o.lineKey === l.lineKey && Math.abs(o.seq - l.seq) <= 1)) continue;
        const dx = l.x - o.x;
        const dy = l.y - o.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const want = (l.size + o.size) * 0.34;
        if (d < want) {
          fx += (dx / d) * (want - d);
          fy += (dy / d) * (want - d);
        }
      }
      // Pushed out of characters.
      for (const ob of obstacles) {
        const cx = Math.max(ob.x, Math.min(ob.x + ob.w, l.x));
        const cy = Math.max(ob.y, Math.min(ob.y + ob.h, l.y));
        const dx = l.x - cx;
        const dy = l.y - cy;
        const d = Math.hypot(dx, dy);
        const want = l.size * 0.5;
        if (d < want) {
          const ux = d > 0.01 ? dx / d : 0;
          const uy = d > 0.01 ? dy / d : -1;
          fx += ux * (want - d);
          fy += uy * (want - d);
        }
      }
      // Springs to the letters either side keep the line's spacing and smooth its turns.
      const siblings = byLine.get(l.lineKey) ?? [];
      for (const s of siblings) {
        if (Math.abs(s.seq - l.seq) !== 1) continue;
        const dx = s.x - l.x;
        const dy = s.y - l.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const rest = l.size * 0.56;
        fx += (dx / d) * (d - rest) * 0.5;
        fy += (dy / d) * (d - rest) * 0.5;
      }
      l.x += fx * give;
      l.y += fy * give;
      const prev = siblings.find((s) => s.seq === l.seq - 1);
      const next = siblings.find((s) => s.seq === l.seq + 1);
      if (prev && next) l.angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    }
    this.reindex();
  }

  /**
   * Advance to time t (seconds): sew what the speakers have said since, relax the wet
   * letters, and let faded ones go.
   */
  update(t: number, speakers: WovenSpeaker[], obstacles: WovenObstacle[], opts: WovenOptions) {
    this.cell = Math.max(8, opts.size);
    const life = opts.holdSec + opts.fadeSec;
    const before = this.letters.length;
    this.letters = this.letters.filter((l) => t - l.born < life);
    if (this.letters.length !== before || this.grid.size === 0) this.reindex();

    for (const line of this.lines.values()) line.live = false;
    for (const s of speakers) {
      const key = `${s.id}:${s.kind}:${s.lineId}`;
      let line = this.lines.get(key);
      if (!line) {
        line = {
          key,
          speakerId: s.id,
          kind: s.kind,
          colour: s.colour,
          text: s.text,
          placed: 0,
          hx: s.x,
          hy: s.y,
          heading: 0,
          orbit: 0,
          spin: hash01(`${key}:spin`) < 0.5 ? 1 : -1,
          lastPlacedAt: t,
          started: false,
          sx: s.x,
          sy: s.y,
          live: true,
        };
        this.lines.set(key, line);
      }
      line.text = s.text.length >= line.text.length ? s.text : line.text;
      line.sx = s.x;
      line.sy = s.y;
      line.live = true;
    }

    for (const [key, line] of this.lines) {
      const remaining = line.text.length - line.placed;
      if (remaining <= 0) {
        if (!line.live && t - line.lastPlacedAt > 4) this.lines.delete(key);
        continue;
      }
      // Sew at the writing pace; catch up a little faster if the line is far ahead.
      const due = Math.min(remaining, Math.floor((t - line.lastPlacedAt) * opts.charsPerSec * (remaining > 40 ? 2 : 1)));
      for (let i = 0; i < due; i++) {
        const ch = line.text[line.placed];
        if (!this.place(line, ch, t, obstacles, opts)) {
          // No room near the speaker at all: drop the rest of this line quietly.
          line.placed = line.text.length;
          break;
        }
        line.placed++;
        line.lastPlacedAt = t;
      }
    }
    this.relax(t, obstacles);
  }

  /** How strong a letter is now, 1 to 0. */
  static alpha(l: WovenLetter, t: number, opts: Pick<WovenOptions, 'holdSec' | 'fadeSec'>): number {
    const age = t - l.born;
    if (age <= opts.holdSec) return 1;
    return Math.max(0, 1 - (age - opts.holdSec) / Math.max(0.1, opts.fadeSec));
  }

  /** The newest letter of each speaker's latest line, if sewn in the last few seconds: the thread's end. */
  tails(t: number, within = 5): Map<string, WovenLetter> {
    const out = new Map<string, WovenLetter>();
    for (const l of this.letters) {
      if (t - l.born > within) continue;
      const cur = out.get(l.speakerId);
      if (!cur || l.born > cur.born || (l.born === cur.born && l.seq > cur.seq)) out.set(l.speakerId, l);
    }
    return out;
  }

  clear() {
    this.letters = [];
    this.lines.clear();
    this.grid.clear();
  }
}
