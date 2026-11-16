import { describe, expect, it } from 'vitest';
import { WovenText, type WovenOptions, type WovenSpeaker } from '../wovenText';

const opts: WovenOptions = { size: 14, holdSec: 10, fadeSec: 4, charsPerSec: 20, bounds: { w: 1200, h: 900 } };
const body = (x: number, y: number) => ({ x: x - 14, y: y - 10, w: 28, h: 60 });

function speak(w: WovenText, from: number, to: number, speakers: (t: number) => WovenSpeaker[], obstacles: (t: number) => ReturnType<typeof body>[]) {
  for (let t = from; t <= to + 1e-9; t += 0.05) w.update(t, speakers(t), obstacles(t), opts);
}

const line = 'One day they wake up and they might decide to do something really strange';

describe('woven text', () => {
  it('sews every letter of a line around its speaker, never on a character', () => {
    const w = new WovenText();
    const a = { id: 'a', x: 400, y: 300, text: line, lineId: '1', kind: 'speech' as const, colour: '#a00' };
    speak(w, 0, 6, () => [a], () => [body(400, 300), body(520, 320)]);
    const letters = w.letters.filter((l) => l.speakerId === 'a');
    expect(letters.length).toBe(line.replace(/ /g, '').length);
    for (const o of [body(400, 300), body(520, 320)]) {
      for (const l of letters) expect(l.x > o.x && l.x < o.x + o.w && l.y > o.y && l.y < o.y + o.h).toBe(false);
    }
    // Letters keep apart from each other.
    for (let i = 0; i < letters.length; i++) {
      for (let j = i + 2; j < letters.length; j++) {
        expect(Math.hypot(letters[i].x - letters[j].x, letters[i].y - letters[j].y)).toBeGreaterThan(opts.size * 0.3);
      }
    }
  });

  it('writes at its pace, follows a walking speaker, and leaves sewn letters where they were', () => {
    const w = new WovenText();
    const at = (t: number) => ({ id: 'a', x: 300 + t * 60, y: 400, text: line, lineId: '1', kind: 'speech' as const, colour: '#a00' });
    speak(w, 0, 1, (t) => [at(t)], (t) => [body(at(t).x, 400)]);
    const early = w.letters.map((l) => ({ ...l }));
    expect(early.length).toBeLessThan(line.length);
    expect(early.length).toBeGreaterThan(10);
    speak(w, 1.05, 6, (t) => [at(t)], (t) => [body(at(t).x, 400)]);
    // Letters that had dried by t=1 never moved again.
    const dry = early.filter((l) => 1 - l.born > 1.2);
    for (const d of dry) {
      const now = w.letters.find((l) => l.lineKey === d.lineKey && l.seq === d.seq)!;
      expect(now.x).toBe(d.x);
      expect(now.y).toBe(d.y);
    }
    // The last letters were sewn nearer to where the speaker had walked.
    const last = w.letters[w.letters.length - 1];
    expect(last.x).toBeGreaterThan(early[0].x);
  });

  it('fades letters out and frees their room', () => {
    const w = new WovenText();
    const a = { id: 'a', x: 400, y: 300, text: 'Hello there', lineId: '1', kind: 'speech' as const, colour: '#a00' };
    speak(w, 0, 2, () => [a], () => []);
    expect(w.letters.length).toBe(10);
    expect(WovenText.alpha(w.letters[0], 12, opts)).toBeLessThan(1);
    speak(w, 2.05, 16, () => [], () => []);
    expect(w.letters.length).toBe(0);
  });

  it('is reproducible', () => {
    const run = () => {
      const w = new WovenText();
      speak(w, 0, 5, (t) => [{ id: 'a', x: 300 + t * 20, y: 300, text: line, lineId: '1', kind: 'speech', colour: '#a00' }, { id: 'b', x: 380, y: 320, text: 'Why?', lineId: '2', kind: 'thought', colour: '#00a' }], () => [body(380, 320)]);
      return JSON.stringify(w.letters);
    };
    expect(run()).toBe(run());
  });
});
