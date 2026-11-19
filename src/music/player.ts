import { Composer, type PhrasePlan } from './composer';
import { clamp01, type MusicCue } from './cue';
import { Gaida, Kaval, Tapan, makeImpulse, makeNoiseBuffer } from './instruments';
import { DEFAULT_TONE, type BandTone } from './tone';

/**
 * Plays the composer's music on the instruments, a little ahead of time. A new cue lands at
 * the next bar or phrase; the intensity eases toward it (about half a minute from still to
 * wild, a few seconds when urgent). The music moves between three parts, each with its own
 * amount (`MusicAmounts`, 0 to 1, 0 turning that part off):
 *
 * - ambience: always there underneath. The drone, drifting slowly over many bars in breath,
 *   roughness and harmonics, and the tapan keeping a sparse, soft pulse. Under a spoken line
 *   the drummer plays slower and sparser, never simply quieter.
 * - in-between: motifs that come in around the lines of the story, the teller's accompanist
 *   filling the breath before the next sentence. The amount sets how soon after a line they
 *   come, how often they return in a longer gap, and how long they linger under the next line.
 * - song: the band playing in full, only while no one speaks: once the story has been quiet a
 *   while (sooner the higher the amount), for a while, then back to ambience.
 *
 * The village view tells it when lines start and end (`setSpeaking`). The band sits in a room
 * with a tape echo (`tone.ambience`), each instrument shaped by its tone.
 */

export interface MusicPlayerOptions {
  ctx: AudioContext;
  /** Where the music goes: the mixer's music bus, or the speakers. */
  output?: AudioNode;
  seed?: number;
  tone?: BandTone;
  amounts?: MusicAmounts;
}

/** How much of each part of the music there is, 0 (none) to 1. */
export interface MusicAmounts {
  ambience: number;
  between: number;
  song: number;
}

export const DEFAULT_AMOUNTS: MusicAmounts = { ambience: 0.6, between: 0.6, song: 0.5 };

/** Intensity per second the music may move towards its cue. */
const EASE = 0.028;
const EASE_URGENT = 0.14;
/** How far ahead phrases are written. */
const LOOKAHEAD = 1.6;
/** How often, in seconds, the drone takes a new direction, at most and at least movement. */
const DRIFT_SLOW = 26;
const DRIFT_FAST = 11;
/** The longest a motif runs, seconds. */
const MOTIF_MAX = 5;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** How long the band's answer to a passage of the teller runs, seconds, for an in-between amount. */
export const answerSeconds = (between: number) => (between > 0 ? lerp(5, 13, between) : 0);

export class MusicPlayer {
  readonly ctx: AudioContext;
  private output: AudioNode;
  private composer: Composer;
  private cue: MusicCue = { mood: 'pastoral', intensity: 0.2 };
  private eased = 0.2;
  private nextAt = 0;
  private lastLength = 4;
  private timer: ReturnType<typeof setInterval> | null = null;
  private graph: {
    master: GainNode;
    duck: GainNode;
    gaida: Gaida;
    kaval: Kaval;
    tapan: Tapan;
    reverb: ConvolverNode;
    wet: GainNode;
    echoMix: GainNode;
    echoDelay: DelayNode;
    echoFeedback: GainNode;
    nodes: AudioNode[];
  } | null = null;
  private tone: BandTone;
  private room = -1;
  private roomTimer: ReturnType<typeof setTimeout> | null = null;
  private amounts: MusicAmounts;
  private phraseListeners = new Set<(plan: PhrasePlan, at: number) => void>();
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  /** Instruments muted by hand (for auditioning). */
  readonly muted = { gaida: false, kaval: false, tapan: false, drone: false };
  current: PhrasePlan | null = null;
  /** What the band is doing now, in a few words. */
  activity = '';
  private speaking = false;
  /** When the last line ended, or the band started: quiet is measured from here. */
  private silentSince = 0;
  /** Whether any line has been said since the band started (motifs answer lines). */
  private heardLine = false;
  private nextMotifAt = Infinity;
  private motifMax = MOTIF_MAX;
  /** The part being played, when the song began, and until when the next song waits. */
  part: 'ambience' | 'between' | 'song' = 'ambience';
  private songStartedAt = 0;
  private songRestUntil = 0;
  private nextDriftAt = 0;

  constructor(opts: MusicPlayerOptions) {
    this.ctx = opts.ctx;
    this.output = opts.output ?? opts.ctx.destination;
    this.composer = new Composer(opts.seed ?? 1);
    this.tone = opts.tone ?? DEFAULT_TONE;
    this.amounts = opts.amounts ?? DEFAULT_AMOUNTS;
  }

  /** How much ambience, in-between and song there is (each 0 to 1). */
  setAmounts(amounts: MusicAmounts) {
    this.amounts = { ambience: clamp01(amounts.ambience), between: clamp01(amounts.between), song: clamp01(amounts.song) };
  }

  /** The band's sound: each instrument's tone and the room (see `tone.ts`). */
  setTone(tone: BandTone) {
    this.tone = tone;
    if (this.graph) this.applyTone(this.graph);
  }

  private applyTone(graph: NonNullable<MusicPlayer['graph']>) {
    const t = this.tone;
    const now = this.ctx.currentTime;
    graph.gaida.setTone(t.gaida, t.drone);
    graph.kaval.setTone(t.kaval);
    graph.tapan.setTone(t.tapan);
    graph.wet.gain.setTargetAtTime(t.ambience.reverb * 0.85, now, 0.2);
    graph.echoMix.gain.setTargetAtTime(t.ambience.echo * 0.55, now, 0.2);
    graph.echoFeedback.gain.setTargetAtTime(0.2 + t.ambience.echo * 0.45, now, 0.2);
    graph.echoDelay.delayTime.setTargetAtTime(0.32 + t.ambience.room * 0.22, now, 0.5);
    // A new room is built only once the slider rests: making one costs a moment.
    if (Math.abs(t.ambience.room - this.room) > 0.04) {
      if (this.roomTimer) clearTimeout(this.roomTimer);
      this.roomTimer = setTimeout(() => {
        this.room = t.ambience.room;
        graph.reverb.buffer = makeImpulse(this.ctx, 0.8 + t.ambience.room * 5.2);
      }, this.room < 0 ? 0 : 250);
    }
  }

  get playing() {
    return this.timer !== null;
  }

  get intensity() {
    return this.eased;
  }

  get direction(): MusicCue {
    return { ...this.cue };
  }

  onPhrase(fn: (plan: PhrasePlan, at: number) => void) {
    this.phraseListeners.add(fn);
    return () => this.phraseListeners.delete(fn);
  }

  setCue(cue: MusicCue) {
    this.cue = { ...cue, intensity: clamp01(cue.intensity) };
    if (!this.playing) this.eased = this.cue.intensity;
  }

  /** Starts the band, fading in over `fade` seconds. */
  start(fade = 2) {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.timer) return;
    const ctx = this.ctx;
    if (!this.graph) this.graph = this.build();
    const now = ctx.currentTime;
    const m = this.graph.master.gain;
    m.cancelScheduledValues(now);
    m.setValueAtTime(m.value, now);
    m.linearRampToValueAtTime(1, now + fade);
    this.nextAt = Math.max(this.nextAt, now + 0.1);
    this.silentSince = now;
    this.nextDriftAt = now;
    this.songRestUntil = 0;
    this.timer = setInterval(() => this.tick(), 120);
    this.tick();
  }

  /** Lets the band fall silent over `fade` seconds, then frees its voices. */
  stop(fade = 2.5) {
    if (!this.timer || !this.graph) return;
    clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    const m = this.graph.master.gain;
    m.cancelScheduledValues(now);
    m.setValueAtTime(m.value, now);
    m.linearRampToValueAtTime(0, now + fade);
    const graph = this.graph;
    this.stopTimer = setTimeout(() => {
      graph.gaida.dispose();
      graph.kaval.dispose();
      for (const n of graph.nodes) n.disconnect();
      if (this.graph === graph) this.graph = null;
      this.nextAt = 0;
      this.stopTimer = null;
    }, (fade + 0.3) * 1000 + Math.max(0, this.nextAt - now) * 1000);
  }

  /** Steps the music back (0 to 1 of its level) while someone speaks; 1 restores it. */
  duck(level: number, seconds = 0.6) {
    if (!this.graph) return;
    this.graph.duck.gain.setTargetAtTime(clamp01(level), this.ctx.currentTime, seconds / 3);
  }

  private build() {
    const ctx = this.ctx;
    const noise = makeNoiseBuffer(ctx);
    const master = ctx.createGain();
    master.gain.value = 0;
    const duck = ctx.createGain();
    duck.connect(master).connect(this.output);

    // The room.
    const reverb = ctx.createConvolver();
    const wet = ctx.createGain();
    reverb.connect(wet).connect(duck);
    // A tape echo: each repeat darker, feeding the room as well.
    const echoIn = ctx.createGain();
    const echoDelay = ctx.createDelay(2);
    const echoFeedback = ctx.createGain();
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2400;
    const echoMix = ctx.createGain();
    echoIn.connect(echoDelay).connect(echoTone).connect(echoFeedback).connect(echoDelay);
    echoTone.connect(echoMix);
    echoMix.connect(duck);
    echoMix.connect(reverb);

    const channel = (pan: number, send: number, echo: number) => {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(duck);
      const s = ctx.createGain();
      s.gain.value = send;
      p.connect(s).connect(reverb);
      const e = ctx.createGain();
      e.gain.value = echo;
      p.connect(e).connect(echoIn);
      return { input: p as AudioNode, nodes: [p, s, e] as AudioNode[] };
    };
    const g = channel(0.22, 0.6, 0.8);
    const k = channel(-0.12, 0.9, 1);
    const t = channel(-0.28, 0.5, 0.35);
    const graph = {
      master,
      duck,
      gaida: new Gaida(ctx, g.input, noise),
      kaval: new Kaval(ctx, k.input, noise),
      tapan: new Tapan(ctx, t.input, noise),
      reverb,
      wet,
      echoMix,
      echoDelay,
      echoFeedback,
      nodes: [master, duck, reverb, wet, echoIn, echoDelay, echoFeedback, echoTone, echoMix, ...g.nodes, ...k.nodes, ...t.nodes],
    };
    this.room = -1;
    this.applyTone(graph);
    return graph;
  }

  private tick() {
    const ctx = this.ctx;
    if (!this.graph || ctx.state !== 'running') return;
    // After the page was hidden or the world paused, start again from now rather than catching up.
    if (this.nextAt < ctx.currentTime) this.nextAt = ctx.currentTime + 0.05;
    let guard = 0;
    while (this.nextAt < ctx.currentTime + LOOKAHEAD && guard++ < 4) this.schedule();
  }

  /**
   * Someone has begun or stopped saying a line (a character, the Scribe or the guide). A song
   * gives way at once; a motif lingers under the new line for a moment and fades; the ambience
   * carries on, slower and sparser. When the line ends, the in-between motifs may answer it.
   */
  setSpeaking(speaking: boolean, opts: { answer?: boolean } = {}) {
    if (speaking === this.speaking) return;
    this.speaking = speaking;
    const graph = this.graph;
    const now = this.ctx.currentTime;
    if (speaking) {
      if (!graph) return;
      const linger = this.part === 'song' ? 0.5 : lerp(0.4, 1.6, this.amounts.between);
      graph.kaval.fadeOut(now, linger);
      graph.gaida.fadeChanter(now, Math.min(linger, 0.6));
      // What was written for the gap or the song is called off; the ambience starts again, sparser.
      graph.tapan.cancelFrom(now + 0.05);
      this.part = 'ambience';
      this.nextAt = now + 0.05;
      this.nextMotifAt = Infinity;
    } else {
      this.silentSince = now;
      this.heardLine = true;
      // The busier the in-between, the sooner a motif answers the line. After a passage of the
      // teller (`answer`) the band always answers, at length: a musical translation of it.
      const between = this.amounts.between;
      if (between > 0 && opts.answer) {
        this.nextMotifAt = now + 0.4;
        this.motifMax = answerSeconds(between);
      } else {
        this.nextMotifAt = between > 0 && Math.random() < 0.35 + between ? now + lerp(1.6, 0.3, between) : Infinity;
        this.motifMax = MOTIF_MAX;
      }
      this.nextAt = Math.min(this.nextAt, now + 0.25);
    }
  }

  private schedule() {
    const graph = this.graph!;
    const rate = this.cue.urgent ? EASE_URGENT : EASE;
    // A long phrase must not let the music leap a whole stage in one go.
    const step = Math.min(rate * this.lastLength, this.cue.urgent ? 0.35 : 0.12);
    this.eased += Math.max(-step, Math.min(step, this.cue.intensity - this.eased));
    const at = this.nextAt;
    const { ambience, between, song } = this.amounts;

    // The drone's long life, whatever else is happening.
    if (at >= this.nextDriftAt) {
      const span = lerp(DRIFT_SLOW, DRIFT_FAST, this.tone.drone.movement) * (0.75 + Math.random() * 0.5);
      graph.gaida.drift(at, span);
      this.nextDriftAt = at + span;
    }

    const quiet = at - this.silentSince;
    let plan: PhrasePlan;
    if (this.speaking) {
      plan = this.composer.ambience(this.cue, this.eased, { underSpeech: true, amount: ambience });
      this.part = 'ambience';
    } else {
      // A song: once the story has been quiet a while, for a while, then a rest.
      if (this.part === 'song' && at - this.songStartedAt > lerp(25, 150, song)) {
        this.part = 'ambience';
        this.songRestUntil = at + lerp(90, 12, song);
      }
      const songDue = song > 0 && this.part !== 'song' && quiet >= lerp(70, 5, song) && at >= this.songRestUntil;
      if (songDue) {
        this.part = 'song';
        this.songStartedAt = at;
      }
      if (this.part === 'song') {
        plan = this.composer.next(this.cue, this.eased);
        plan = { ...plan, drone: Math.max(plan.drone, ambience * 0.7) };
      } else if (between > 0 && this.heardLine && at >= this.nextMotifAt && quiet < lerp(20, 60, between)) {
        plan = this.composer.motif(this.cue, this.eased, this.motifMax);
        this.motifMax = MOTIF_MAX;
        plan = { ...plan, drone: ambience * 0.7 };
        this.part = 'between';
        // In a longer gap, the motif may come back.
        this.nextMotifAt = at + plan.length + lerp(16, 2.5, between) * (0.7 + Math.random() * 0.6);
      } else {
        plan = this.composer.ambience(this.cue, this.eased, { underSpeech: false, amount: ambience });
        this.part = 'ambience';
      }
    }
    this.play(plan, at);
    this.nextAt = at + plan.length;
    // An ambience bar ends early when a motif is due within it.
    if (plan.texture === 'ambience' && !this.speaking && this.nextMotifAt > at && this.nextMotifAt < this.nextAt) this.nextAt = this.nextMotifAt;
    this.lastLength = plan.length;
    this.current = plan;
    this.activity = this.speaking ? `${plan.label}` : plan.label;
    for (const fn of this.phraseListeners) fn(plan, at);
  }

  private play(plan: PhrasePlan, at: number) {
    const graph = this.graph!;
    graph.gaida.setDrone(at, this.muted.drone ? 0 : plan.drone, plan.intensity);
    graph.gaida.play(plan.gaidaOn && !this.muted.gaida, plan.gaida, at);
    if (!this.muted.kaval && plan.kaval.length) graph.kaval.play(plan.kaval, at);
    if (!this.muted.tapan) for (const h of plan.tapan) graph.tapan.hit(h, at + h.t);
  }
}
