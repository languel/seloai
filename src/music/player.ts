import { Composer, type PhrasePlan } from './composer';
import { clamp01, type MusicCue } from './cue';
import { Gaida, Kaval, Tapan, makeImpulse, makeNoiseBuffer } from './instruments';
import { DEFAULT_TONE, type BandTone } from './tone';

/**
 * Plays the composer's phrases on the instruments, a phrase ahead of time. A new cue lands at
 * the next phrase; the intensity eases toward it (about half a minute from still to wild, a
 * few seconds when the cue is urgent), so the music grows with the scene rather than jumping.
 * The band sits in a room with a tape echo (`tone.ambience`), each instrument shaped by its
 * tone, and steps back while someone speaks (`duck`). Below full density it leaves rests
 * between its calm phrases, longer the sparser it is.
 */

export interface MusicPlayerOptions {
  ctx: AudioContext;
  /** Where the music goes: the mixer's music bus, or the speakers. */
  output?: AudioNode;
  seed?: number;
  tone?: BandTone;
  /** How much music, 0 (sparse, long silences) to 1 (it never stops); 0.7 is usual. */
  density?: number;
}

/** Intensity per second the music may move towards its cue. */
const EASE = 0.028;
const EASE_URGENT = 0.14;
/** How far ahead phrases are written. */
const LOOKAHEAD = 1.6;

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
  private density: number;
  private phraseListeners = new Set<(plan: PhrasePlan, at: number) => void>();
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  /** Instruments muted by hand (for auditioning). */
  readonly muted = { gaida: false, kaval: false, tapan: false, drone: false };
  current: PhrasePlan | null = null;

  constructor(opts: MusicPlayerOptions) {
    this.ctx = opts.ctx;
    this.output = opts.output ?? opts.ctx.destination;
    this.composer = new Composer(opts.seed ?? 1);
    this.tone = opts.tone ?? DEFAULT_TONE;
    this.density = opts.density ?? 0.7;
  }

  /** How much music, 0 (sparse) to 1 (continuous). */
  setDensity(density: number) {
    this.density = clamp01(density);
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

  private schedule() {
    const graph = this.graph!;
    const rate = this.cue.urgent ? EASE_URGENT : EASE;
    // A long free phrase must not let the music leap a whole stage in one go.
    const step = Math.min(rate * this.lastLength, this.cue.urgent ? 0.35 : 0.12);
    this.eased += Math.max(-step, Math.min(step, this.cue.intensity - this.eased));
    const plan = this.composer.next(this.cue, this.eased);
    const at = this.nextAt;
    graph.gaida.setDrone(at, this.muted.drone ? 0 : plan.drone, plan.intensity);
    graph.gaida.play(plan.gaidaOn && !this.muted.gaida, plan.gaida, at);
    if (!this.muted.kaval) graph.kaval.play(plan.kaval, at);
    if (!this.muted.tapan) for (const h of plan.tapan) graph.tapan.hit(h, at + h.t);
    this.lastLength = plan.length;
    this.nextAt = at + plan.length;
    // Below full density a calm phrase may be followed by a rest; when sparse the drone rests too.
    const sparse = 1 - this.density;
    if (plan.texture !== 'dance' && sparse > 0 && Math.random() < sparse * 0.9) {
      const rest = sparse * (2 + Math.random() * 12);
      if (this.density < 0.4 && !this.muted.drone) graph.gaida.setDrone(this.nextAt, 0);
      this.nextAt += rest;
    }
    this.current = plan;
    for (const fn of this.phraseListeners) fn(plan, at);
  }
}
