import { describe, expect, it } from 'vitest';
import { buildTracks, clampScroll, clothY, placeTracks, scrollToTrack, trackAt, zoomRows, FOCUS_SHARE, LANE_H, MUSIC_COLLAPSED } from '../../components/loom/tracks';
import { phraseAt } from '../../components/loom/drawMusic';
import type { MusicPhrase } from '../../music/villageMusic';
import { momentAt, momentText, noteName, type MomentSources } from '../moment';
import { frameAt, type WorldlineFrame } from '../worldlines';

const phrase = (t0: number, t1: number, part: MusicPhrase['part'], extra: Partial<MusicPhrase> = {}): MusicPhrase => ({
  id: `phrase-${t0}`,
  t0,
  t1,
  part,
  cue: { mood: 'dread', intensity: 0.8, reason: 'the Lamia rises' },
  plan: {
    length: (t1 - t0) / 1000,
    mood: 'dread',
    mode: 'phrygian' as never,
    dance: 'free' as never,
    intensity: 0.8,
    texture: part === 'ambience' ? 'ambience' : 'motif',
    gaidaOn: false,
    gaida: [],
    kaval: [
      { t: 0, dur: 1, midi: 74, vel: 0.8 },
      { t: 1, dur: 1, midi: 72, vel: 0.6 },
    ],
    tapan: [{ t: 1, kind: 'dum', vel: 1 }],
    drone: 0.5,
    label: part === 'song' ? 'a song in dread' : 'a drone',
  },
  ...extra,
});

describe('The Loom’s lanes', () => {
  it('fits the Scribe, Spinner, every band and the music into the view at zoom 1', () => {
    const tracks = buildTracks({ bands: [{ id: 'a', label: 'Well' }, { id: 'b', label: 'Hearth' }], showMusic: true, viewH: 400 });
    expect(tracks.map((t) => t.kind)).toEqual(['scribe', 'spinner', 'band', 'band', 'music']);
    const { placed, total } = placeTracks(tracks, 1, null, 400);
    expect(total).toBeCloseTo(400);
    expect(placed[0]).toMatchObject({ top: 0, h: LANE_H });
    expect(placed[4].h).toBe(MUSIC_COLLAPSED);
  });

  it('zooms one lane to fill most of the view, and scrolls it into view', () => {
    const tracks = buildTracks({ bands: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, label: `P${i}` })), showMusic: true, viewH: 400 });
    const { placed, total } = placeTracks(tracks, 1, 'lane:music', 400);
    const music = placed.find((t) => t.kind === 'music')!;
    expect(music.h).toBeCloseTo(400 * FOCUS_SHARE);
    expect(total).toBeGreaterThan(400);
    const scroll = scrollToTrack(music, total, 400);
    expect(music.top - scroll).toBeGreaterThanOrEqual(0);
    expect(music.top + music.h - scroll).toBeLessThanOrEqual(400 + 1e-6);
    expect(trackAt(placed, music.top + 5)?.id).toBe('lane:music');
  });

  it('maps the cloth’s heights through bands of different sizes', () => {
    const tracks = buildTracks({ bands: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], showMusic: false, viewH: 260 });
    const { placed } = placeTracks(tracks, 1, 'band:b', 260);
    const [a, b] = placed.filter((t) => t.kind === 'band');
    expect(clothY(placed, 2, 0)).toBeCloseTo(a.top);
    expect(clothY(placed, 2, 0.25)).toBeCloseTo(a.top + a.h / 2);
    expect(clothY(placed, 2, 0.75)).toBeCloseTo(b.top + b.h / 2);
    expect(b.h).toBeGreaterThan(a.h);
  });

  it('grows the lanes about a point and keeps scrolling within the content', () => {
    const r = zoomRows(1, 0, 2, 100);
    expect(r.vzoom).toBe(2);
    expect(r.scroll).toBe(100);
    expect(zoomRows(8, 0, 2, 0).vzoom).toBe(8);
    expect(clampScroll(-5, 500, 400)).toBe(0);
    expect(clampScroll(900, 500, 400)).toBe(100);
    expect(clampScroll(50, 300, 400)).toBe(0);
  });

  it('picks the phrase sounding at a time, song before ambience, and not past where it was cut', () => {
    const amb = phrase(0, 10_000, 'ambience');
    const song = phrase(2_000, 8_000, 'song', { cutAt: 5_000 });
    expect(phraseAt([amb, song], 3_000)).toBe(song);
    expect(phraseAt([amb, song], 6_000)).toBe(amb);
    expect(phraseAt([amb, song], 12_000)).toBeNull();
  });
});

describe('A moment, looked back on', () => {
  const frames = new Map<string, WorldlineFrame[]>([
    [
      'rada',
      [
        { t: 1_000, x: 1, y: 1, state: 'walking', intention: 'Take honey to Stoyan', errand: 'stoyan', goal: { x: 9, y: 9 } },
        { t: 6_000, x: 9, y: 9, state: 'conversing', intention: 'Talk with Stoyan', errand: null, goal: null },
      ],
    ],
  ]);
  const src: MomentSources = {
    characters: [
      { id: 'rada', name: 'Baba Rada' },
      { id: 'stoyan', name: 'Stoyan' },
    ],
    places: [
      { id: 'well', label: 'the Well', x: 1, y: 1 },
      { id: 'hearth', label: 'the Hearth', x: 9, y: 9 },
    ],
    lines: [
      { t: 2_000, from: 'rada', fromName: 'Baba Rada', kind: 'thought', text: 'He will want the honey.' },
      { t: 3_000, from: 'narrator', fromName: 'Scribe', kind: 'narration', text: 'The wind turns cold.' },
      { t: 7_000, from: 'rada', fromName: 'Baba Rada', kind: 'speech', text: 'Here, take it.' },
    ],
    frames,
    phrases: [phrase(0, 10_000, 'ambience'), phrase(3_500, 9_000, 'song')],
    musicEvents: [{ t: 3_200, kind: 'direction', text: 'mood dread, intensity 0.80' }],
    spinner: [{ t: 4_000, kind: 'user', text: 'make it darker' }],
  };

  it('finds the frame at or before a time', () => {
    expect(frameAt(frames.get('rada'), 500)).toBeUndefined();
    expect(frameAt(frames.get('rada'), 5_999)?.state).toBe('walking');
    expect(frameAt(frames.get('rada'), 6_000)?.state).toBe('conversing');
  });

  it('says where everyone was, what they meant to do, and what they had said and thought by then', () => {
    const m = momentAt(src, 4_500);
    const rada = m.characters.find((c) => c.id === 'rada')!;
    expect(rada).toMatchObject({ place: 'the Well', state: 'walking', headingTo: 'Stoyan', intention: 'Take honey to Stoyan' });
    expect(rada.lastThought?.text).toBe('He will want the honey.');
    expect(rada.lastLine).toBeUndefined();
    expect(m.scribe?.text).toBe('The wind turns cold.');
    expect(m.characters.find((c) => c.id === 'stoyan')!.place).toBeNull();
    const later = momentAt(src, 8_000).characters.find((c) => c.id === 'rada')!;
    expect(later).toMatchObject({ place: 'the Hearth', state: 'conversing' });
    expect(later.lastLine?.text).toBe('Here, take it.');
  });

  it('says what the band was playing, why, and which notes sounded', () => {
    const m = momentAt(src, 4_000);
    expect(m.music).toMatchObject({ part: 'song', mood: 'dread', reason: 'the Lamia rises', cut: false });
    expect(m.music!.sounding).toContainEqual({ instrument: 'kaval', midi: 74 });
    expect(m.musicEvents.map((e) => e.kind)).toEqual(['direction']);
    expect(m.spinner).toHaveLength(1);
    expect(momentAt(src, 20_000).music).toBeNull();
  });

  it('puts the moment in words for a question', () => {
    const text = momentText(momentAt(src, 4_000), 10_000);
    expect(text).toMatch(/6s before now/);
    expect(text).toMatch(/Music: song: a song in dread; mood dread/);
    expect(text).toMatch(/Sounding: kaval D5/);
    expect(text).toMatch(/Baba Rada: at the Well; walking; heading to Stoyan/);
    expect(text).toMatch(/The wind turns cold/);
  });

  it('names notes', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(74)).toBe('D5');
    expect(noteName(70)).toBe('B♭4');
  });
});
