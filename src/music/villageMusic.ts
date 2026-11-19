import { getAudioContext } from '../ai/audioPipeline';
import { busInput } from '../ai/mixer';
import { clamp01, type MusicCue } from './cue';
import { MusicListener, type SceneReading } from './listener';
import { DEFAULT_AMOUNTS, MusicPlayer, answerSeconds, lineAnswerSeconds, type MusicAmounts } from './player';
import { ScribeEar, type ScribeScore } from './scribeScore';
import { normalizeTone, type BandTone } from './tone';

/**
 * The village's musicians: the third storyteller beside the characters and the Scribe. While
 * the music is on they listen to the story (the village view reads them the scene about once
 * a second) and play to it. The Scribe's own model is their ear when one is loaded: now and
 * then it reads the latest moment and names its mood (`scribeScore.ts`); between its readings,
 * and when no model answers, word lists hear the lines. Anyone can give them a direction, a
 * person or an agent such as
 * Spinner: a mood, an intensity, a dance or a lead, held for a while or until released. What
 * a direction leaves out still follows the story, so "play it darker" keeps the story's pace.
 * They play through the mixer's music bus and step back while someone speaks.
 */

const PREF = 'seloai.music.on';
const TONE_PREF = 'seloai.music.tone';
const AMOUNTS_PREF = 'seloai.music.amounts';
/** The music keeps its level under speech: the players thin out instead (see the player). */
const DUCK = 1;

export interface MusicDirection extends Partial<MusicCue> {
  /** Seconds the direction holds; left out, until it is released or replaced. */
  holdSeconds?: number;
}

export interface MusicStatus {
  on: boolean;
  /** The cue being played (the story's, with any direction over it). */
  cue: MusicCue;
  /** What the story alone asks for. */
  heard: MusicCue;
  /** Where the intensity actually is (it eases towards the cue). */
  intensity: number;
  /** What is being played right now. */
  playing: string | null;
  direction: (Partial<MusicCue> & { until: number | null }) | null;
  /** Who reads the story for them: the Scribe's model, or the word lists alone. */
  listening: 'scribe' | 'words';
  /** The Scribe's latest reading, while it is fresh. */
  scribe: ScribeScore | null;
  /** Whether a line is being said, so the band is holding back. */
  speaking: boolean;
  /** The part of the music being played: ambience, in-between or song. */
  part: 'ambience' | 'between' | 'song' | null;
}

/** Asks a model what the latest lines feel like (the app wires in the Scribe's). */
/** One stretch of what the band played, on the story's clock (ms), for the Loom. */
export interface MusicSpan {
  t0: number;
  t1: number;
  part: 'ambience' | 'between' | 'song';
  label: string;
}

const TIMELINE_MAX = 3000;

export type MusicScorer = (lines: SceneReading['lines']) => Promise<ScribeScore | null>;

class VillageMusic {
  private player: MusicPlayer | null = null;
  private listener = new MusicListener();
  private heard: MusicCue = { mood: 'pastoral', intensity: 0.2, reason: 'nothing heard yet' };
  private dir: (Partial<MusicCue> & { until: number | null }) | null = null;
  private on = readPref();
  private listeners = new Set<() => void>();
  private version = 0;
  private ear = new ScribeEar();
  private scorer: MusicScorer | null = null;
  private useScribe = true;
  private lastReading: SceneReading | null = null;
  private toneNow: BandTone = normalizeTone(readJson(TONE_PREF));
  private amountsNow: MusicAmounts = readAmounts();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get enabled() {
    return this.on;
  }

  /** Turns the music on or off (remembered on this device). Call from a click, so audio may start. */
  setEnabled(on: boolean) {
    this.on = on;
    try {
      localStorage.setItem(PREF, on ? '1' : '0');
    } catch {
      // private mode
    }
    if (on) this.ensurePlayer().start();
    else this.player?.stop();
    if (!on) this.player = null;
    this.changed();
  }

  /** Starts the music if it was left on, e.g. on the first click after the page loads. */
  resume() {
    if (this.on && !this.player?.playing) this.ensurePlayer().start();
  }

  private ensurePlayer() {
    if (!this.player) {
      const ctx = getAudioContext();
      this.player = new MusicPlayer({
        ctx,
        output: busInput(ctx, 'music'),
        seed: Math.floor(Math.random() * 1e6),
        tone: this.toneNow,
        amounts: this.amountsNow,
      });
      this.player.setCue(this.cue());
      this.player.setSpeaking(this.speakingNow);
      const player = this.player;
      player.onPhrase((plan, at) => {
        // On the story's clock, so the Loom can lay it beside what was said.
        const t0 = Date.now() + (at - player.ctx.currentTime) * 1000;
        this.record({ t0, t1: t0 + plan.length * 1000, part: player.part, label: plan.label });
        this.changed();
      });
    }
    return this.player;
  }

  /** The cue being played: the story's, overridden by a direction while it holds. */
  cue(): MusicCue {
    if (this.dir && this.dir.until !== null && Date.now() > this.dir.until) this.dir = null;
    if (!this.dir) return this.heard;
    const { until: _until, ...over } = this.dir;
    void _until;
    return { ...this.heard, ...over, reason: over.reason ?? `directed${this.heard.reason ? `; the story: ${this.heard.reason}` : ''}` };
  }

  /** Gives the musicians a direction (see `MusicDirection`). */
  direct(d: MusicDirection) {
    const { holdSeconds, ...cue } = d;
    if (cue.intensity !== undefined) cue.intensity = clamp01(cue.intensity);
    this.dir = { ...cue, until: holdSeconds ? Date.now() + holdSeconds * 1000 : null };
    this.player?.setCue(this.cue());
    this.changed();
  }

  /** Lets the story lead again. */
  release() {
    this.dir = null;
    this.player?.setCue(this.cue());
    this.changed();
  }

  /** The band's sound (see `tone.ts`). */
  get tone(): BandTone {
    return this.toneNow;
  }

  /** Changes the band's sound; parts left out stay as they are. Remembered on this device. */
  setTone(patch: Partial<{ [K in keyof BandTone]: Partial<BandTone[K]> }>) {
    const t = this.toneNow;
    this.toneNow = normalizeTone({
      gaida: { ...t.gaida, ...patch.gaida },
      drone: { ...t.drone, ...patch.drone },
      kaval: { ...t.kaval, ...patch.kaval },
      tapan: { ...t.tapan, ...patch.tapan },
      ambience: { ...t.ambience, ...patch.ambience },
    });
    this.player?.setTone(this.toneNow);
    save(TONE_PREF, JSON.stringify(this.toneNow));
    this.changed();
  }

  /**
   * How much of each part of the music there is, 0 to 1: the ambience always underneath, the
   * in-between motifs around the lines, the songs while no one speaks. 0 turns a part off.
   */
  get amounts(): MusicAmounts {
    return this.amountsNow;
  }

  setAmounts(patch: Partial<MusicAmounts>) {
    const next = { ...this.amountsNow };
    for (const k of ['ambience', 'between', 'song'] as const) if (typeof patch[k] === 'number' && Number.isFinite(patch[k])) next[k] = clamp01(patch[k]!);
    this.amountsNow = next;
    this.player?.setAmounts(next);
    save(AMOUNTS_PREF, JSON.stringify(next));
    this.changed();
  }

  /** Gives the musicians an ear that reads meaning (the Scribe's model); null for words alone. */
  setScorer(scorer: MusicScorer | null) {
    this.scorer = scorer;
  }

  /** Whether the Scribe's model reads the story for them (when one is loaded), or words alone. */
  listenWith(who: 'scribe' | 'words') {
    this.useScribe = who === 'scribe';
    if (!this.useScribe) this.ear.reset();
    this.changed();
  }

  /** The scene as it is now; the village view calls this about once a second. */
  hear(reading: SceneReading) {
    this.lastReading = reading;
    this.update(reading);
    const scorer = this.scorer;
    if (this.on && this.useScribe && scorer && this.ear.shouldAsk(reading.lines, reading.now)) {
      const lines = reading.lines;
      void this.ear.ask(reading.now, () => scorer(lines)).then((score) => {
        if (!score) return;
        this.listener.adopt(score.mood, this.lastReading?.now ?? reading.now);
        if (this.lastReading) this.update(this.lastReading, true);
        this.changed();
      });
    }
    if (!this.player) return;
    this.player.duck((reading.speaking ?? 0) > 0 ? DUCK : 1, 0.8);
  }

  private update(reading: SceneReading, again = false) {
    // Read once a second; a fresh answer from the Scribe re-blends without reading twice.
    const words = again ? this.words : this.listener.read(reading);
    this.words = words;
    this.heard = this.useScribe ? this.ear.blend(words, reading.now) : words;
    this.player?.setCue(this.cue());
  }
  private words: MusicCue = this.heard;

  /**
   * Someone has begun or stopped saying a line: the band holds back under it and fills the
   * gap after it (see `MusicPlayer.setSpeaking`). The village view calls this as it happens.
   */
  setSpeaking(speaking: boolean, opts: { answer?: boolean } = {}) {
    if (speaking !== this.speakingNow) {
      const now = Date.now();
      if (speaking) {
        this.speech.push({ t0: now, t1: now });
        // Whatever the band was playing gives way here.
        const last = this.spans[this.spans.length - 1];
        if (last && last.part !== 'ambience' && last.t1 > now) last.t1 = now;
      } else {
        const open = this.speech[this.speech.length - 1];
        if (open) open.t1 = now;
      }
      if (this.speech.length > TIMELINE_MAX) this.speech.splice(0, this.speech.length - TIMELINE_MAX);
    }
    this.speakingNow = speaking;
    this.player?.setSpeaking(speaking, opts);
  }

  private spans: MusicSpan[] = [];
  private speech: Array<{ t0: number; t1: number }> = [];

  private record(span: MusicSpan) {
    const last = this.spans[this.spans.length - 1];
    // Bars of the same part run together into one stretch.
    if (last && last.part === span.part && span.t0 <= last.t1 + 400) last.t1 = Math.max(last.t1, span.t1);
    else this.spans.push(span);
    if (this.spans.length > TIMELINE_MAX) this.spans.splice(0, this.spans.length - TIMELINE_MAX);
  }

  /** What the band played and when lines were being said, on the story's clock, for the Loom. */
  timeline(): { spans: readonly MusicSpan[]; speech: ReadonlyArray<{ t0: number; t1: number }>; now: number } {
    const now = Date.now();
    const speech = this.speech.map((s, i) => (i === this.speech.length - 1 && this.speakingNow ? { t0: s.t0, t1: now } : s));
    return { spans: this.spans, speech, now };
  }

  /**
   * How long, in milliseconds, the story should pause after a passage of the teller (the
   * Scribe) or an ordinary line so the band can answer it: the pause of a sung story before
   * the instruments' turn. Nothing when the music is off or there is no in-between.
   */
  answerPauseMs(after: 'line' | 'passage' = 'passage'): number {
    if (!this.on || !this.player?.playing) return 0;
    const between = this.amountsNow.between;
    return Math.round((after === 'passage' ? answerSeconds(between) * 0.85 : lineAnswerSeconds(between)) * 1000);
  }
  private speakingNow = false;

  /** Forget the story so far (a new story). */
  resetStory() {
    this.listener.reset();
    this.ear.reset();
    this.heard = { mood: 'pastoral', intensity: 0.2, reason: 'a new story' };
    this.player?.setCue(this.cue());
  }

  status(): MusicStatus {
    const cue = this.cue();
    return {
      on: this.on,
      cue,
      heard: this.heard,
      intensity: this.player?.intensity ?? cue.intensity,
      playing: this.player?.playing ? this.player.activity || 'starting' : null,
      direction: this.dir,
      listening: this.useScribe && this.scorer ? 'scribe' : 'words',
      scribe: this.useScribe ? this.ear.current(Date.now() / 1000) : null,
      speaking: this.speakingNow,
      part: this.player?.playing ? this.player.part : null,
    };
  }
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readAmounts(): MusicAmounts {
  const raw = readJson(AMOUNTS_PREF) as Partial<MusicAmounts> | null;
  const out = { ...DEFAULT_AMOUNTS };
  for (const k of ['ambience', 'between', 'song'] as const) if (typeof raw?.[k] === 'number' && Number.isFinite(raw[k])) out[k] = clamp01(raw[k]!);
  return out;
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode
  }
}

function readPref(): boolean {
  try {
    // On unless turned off; it starts on the first click, as browsers ask.
    return localStorage.getItem(PREF) !== '0';
  } catch {
    return false;
  }
}

export const villageMusic = new VillageMusic();
