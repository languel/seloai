import type { HitEvent, NoteEvent } from './composer';
import { TONIC_MIDI, midiToHz } from './theory';
import { DEFAULT_TONE, gritCurve, type DroneTone, type VoiceTone } from './tone';

/**
 * The three instruments, synthesized: nothing is a recording.
 *
 * - Tapan: a double-headed drum. The `dum` is a membrane whose pitch drops as it rings, with
 *   the thud of the beater; the `tek` is the thin switch on the other head, a bright burst
 *   with a little of the shell in it.
 * - Gaida: a bagpipe. One reed voice for the chanter and one for the drone two octaves
 *   below, both always sounding while the bag is full. Notes change at once, the way fingers
 *   on a chanter do; ornaments are quick changes of pitch. It swells as the bag fills and
 *   sags as it empties. The drone can sound the fifth and the octave too, beat between its
 *   reeds, drift in tone on its own, and brighten as the music grows.
 * - Kaval: an end-blown flute. A soft tone with breath noise tuned to the note, a vibrato
 *   that blooms on held notes, and a rough "kaba" growl in the low register.
 *
 * Each takes a tone (`tone.ts`): level, breath and noise, and a character from a clean
 * electronic synth to gritty and overdriven.
 */

export function makeNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

/** A hall made of decaying noise: early reflections, then a darkening tail. */
export function makeImpulse(ctx: BaseAudioContext, seconds = 2.8): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = 777 + ch * 31;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const white = (seed / 0x7fffffff) * 2 - 1;
      const p = i / len;
      // The tail darkens: a one-pole lowpass that closes as it decays.
      const k = 0.55 - 0.45 * p;
      lp += (white - lp) * k;
      const early = i < ctx.sampleRate * 0.08 && i % Math.floor(ctx.sampleRate * (0.011 + ch * 0.003)) < 40 ? 0.5 : 0;
      d[i] = (lp + early * white) * Math.pow(1 - p, 2.6);
    }
  }
  return buf;
}

function reedWave(ctx: BaseAudioContext, n: number, evenScale: number, tilt: number): PeriodicWave {
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) imag[k] = ((k % 2 ? 1 : evenScale) / Math.pow(k, tilt)) * (k > 3 && k < 9 ? 1.25 : 1);
  return ctx.createPeriodicWave(real, imag);
}

function fluteWave(ctx: BaseAudioContext): PeriodicWave {
  const imag = new Float32Array([0, 1, 0.32, 0.14, 0.05, 0.025, 0.01]);
  return ctx.createPeriodicWave(new Float32Array(imag.length), imag);
}

// ---------------------------------------------------------------------------------------------

const lin = (a: number, b: number, t: number) => a + (b - a) * t;
/** How "electronic" a character is: 1 at the clean end, 0 from the usual upwards. */
const synthiness = (character: number) => Math.max(0, 1 - character * 2);
/** How "rough" a character is: 0 up to the usual, 1 at the gritty end. */
const roughness = (character: number) => Math.max(0, character * 2 - 1);

function setCurve(shaper: WaveShaperNode, character: number, last: { c: number }) {
  if (Math.abs(last.c - character) < 0.01) return;
  last.c = character;
  shaper.curve = gritCurve(character);
}

function smooth(param: AudioParam, value: number, ctx: BaseAudioContext, seconds = 0.15) {
  param.setTargetAtTime(value, ctx.currentTime, seconds);
}

export class Tapan {
  private shaper: WaveShaperNode;
  private trim: GainNode;
  private tone: VoiceTone = DEFAULT_TONE.tapan;
  private curveAt = { c: -1 };

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.trim = ctx.createGain();
    this.shaper.connect(this.trim).connect(out);
    this.setTone(this.tone);
  }

  setTone(t: VoiceTone) {
    this.tone = t;
    setCurve(this.shaper, t.character, this.curveAt);
    smooth(this.trim.gain, t.level / 0.8, this.ctx);
  }

  /** Hits scheduled but perhaps not yet heard, so they can be called off. */
  private pending: Array<{ at: number; sources: AudioScheduledSourceNode[] }> = [];
  private collecting: AudioScheduledSourceNode[] | null = null;

  hit(ev: HitEvent, at: number) {
    this.collecting = [];
    if (ev.kind === 'dum') this.dum(at, ev.vel);
    else this.tek(at, ev.vel);
    const now = this.ctx.currentTime;
    this.pending = this.pending.filter((p) => p.at > now - 1);
    this.pending.push({ at, sources: this.collecting });
    this.collecting = null;
  }

  /** Calls off every hit from `at` on. */
  cancelFrom(at: number) {
    for (const p of this.pending) {
      if (p.at < at) continue;
      for (const s of p.sources) {
        try {
          s.stop();
        } catch {
          // already stopped
        }
      }
    }
    this.pending = this.pending.filter((p) => p.at < at);
  }

  private env(at: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.shaper);
    return g;
  }

  private noiseSource(at: number, dur: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(at, Math.random() * 1.5, dur);
    this.collecting?.push(src);
    return src;
  }

  private osc(at: number, until: number) {
    const o = this.ctx.createOscillator();
    o.start(at);
    o.stop(until);
    this.collecting?.push(o);
    return o;
  }

  /**
   * The big beater on the bass head. Every stroke is a little different (the drummer's hand is
   * not a machine): its pitch and ring vary, and some strokes are muted with the other hand,
   * some land near the edge of the head, and a strong one may be flammed with a soft grace
   * stroke just before.
   */
  private dum(at: number, vel: number, grace = false) {
    const ctx = this.ctx;
    const r = Math.random();
    const stroke = grace ? 'open' : r < 0.6 ? 'open' : r < 0.8 ? 'muted' : r < 0.92 ? 'edge' : vel > 0.5 ? 'flam' : 'open';
    if (stroke === 'flam') this.dum(at - 0.028 - Math.random() * 0.012, vel * 0.4, true);
    const synth = synthiness(this.tone.character);
    const noiseMul = this.tone.breath * 2 * (1 - 0.75 * synth);
    const pitch = (stroke === 'edge' ? 1.45 : stroke === 'muted' ? 1.06 : 1) * (0.94 + Math.random() * 0.12);
    const ring = (stroke === 'muted' ? 0.35 : stroke === 'edge' ? 0.55 : 1) * (0.85 + Math.random() * 0.3);
    const thudMul = stroke === 'muted' ? 1.6 : 1;
    const slapMul = stroke === 'edge' ? 2.6 : stroke === 'muted' ? 0.6 : 1;
    // At the electronic end the drum is a long, deep sweep, like a drum machine's.
    const decay = (0.45 + 0.35 * vel + synth * 0.6) * ring;
    const o = this.osc(at, at + decay + 0.05);
    o.frequency.setValueAtTime((92 + 30 * vel + synth * 110) * pitch, at);
    o.frequency.exponentialRampToValueAtTime((54 - synth * 6) * pitch, at + 0.09 + synth * 0.08);
    o.frequency.exponentialRampToValueAtTime((49 - synth * 6) * pitch, at + decay);
    o.connect(this.env(at, 0.95 * vel, 0.003, decay));
    const o2 = this.osc(at, at + 0.3);
    o2.frequency.setValueAtTime(150 * pitch, at);
    o2.frequency.exponentialRampToValueAtTime(88 * pitch, at + 0.12);
    o2.connect(this.env(at, 0.28 * vel * (1 - synth * 0.8) * (stroke === 'edge' ? 1.8 : 1), 0.002, 0.2 * ring));
    if (noiseMul > 0.01) {
      const thud = this.noiseSource(at, 0.12);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520 * (0.9 + Math.random() * 0.25);
      thud.connect(lp).connect(this.env(at, 0.7 * vel * noiseMul * thudMul, 0.002, 0.07));
      const slap = this.noiseSource(at, 0.06);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (stroke === 'edge' ? 1700 : 1100) * (0.9 + Math.random() * 0.2);
      bp.Q.value = 0.9;
      slap.connect(bp).connect(this.env(at, 0.22 * vel * noiseMul * slapMul, 0.001, 0.035));
    }
  }

  /**
   * The thin switch on the treble head: mostly its tip, sometimes on the rim (brighter and
   * shorter), sometimes bouncing twice (a buzz), sometimes a soft, low brush.
   */
  private tek(at: number, vel: number, bounce = false) {
    const ctx = this.ctx;
    const r = Math.random();
    const stroke = bounce ? 'tip' : r < 0.55 ? 'tip' : r < 0.75 ? 'rim' : r < 0.9 ? 'buzz' : 'soft';
    if (stroke === 'buzz') this.tek(at + 0.016 + Math.random() * 0.01, vel * 0.55, true);
    const synth = synthiness(this.tone.character);
    const noiseMul = this.tone.breath * 2;
    const band = (stroke === 'rim' ? 5200 : stroke === 'soft' ? 2400 : 3600) + Math.random() * 600;
    const gain = stroke === 'soft' ? 0.6 : stroke === 'rim' ? 0.9 : 1;
    const len = stroke === 'rim' ? 0.7 : stroke === 'soft' ? 1.5 : 1;
    if (noiseMul > 0.01) {
      const src = this.noiseSource(at, 0.12 * len);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = stroke === 'soft' ? 900 : 1900;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = band;
      bp.Q.value = 0.8 + synth * 6;
      src.connect(hp).connect(bp).connect(this.env(at, 0.55 * vel * noiseMul * gain, 0.001, (0.06 + 0.03 * vel) * len));
    }
    // The rod's click (loud on the rim, barely there on a brush); at the electronic end a bright blip.
    const click = this.osc(at, at + 0.06);
    click.type = synth > 0.3 ? 'square' : 'triangle';
    click.frequency.value = (synth > 0.3 ? 2600 : 1750) * (stroke === 'rim' ? 1.5 : 1);
    click.connect(this.env(at, (0.07 + synth * 0.12) * vel * (stroke === 'rim' ? 2 : stroke === 'soft' ? 0.3 : 1), 0.0008, 0.014 + synth * 0.03));
    const shell = this.osc(at, at + 0.09);
    shell.frequency.setValueAtTime(240 * (0.92 + Math.random() * 0.16), at);
    shell.frequency.exponentialRampToValueAtTime(190, at + 0.06);
    shell.connect(this.env(at, 0.13 * vel * gain, 0.001, 0.06));
  }
}

// ---------------------------------------------------------------------------------------------

/** The chanter is loud and piercing by nature: it sits well below the kaval. */
const GAIDA_PEAK = 0.065;
const DRONE_PEAK = 0.11;
/**
 * A drone change is a long chord: the new note fades in over `DRONE_IN` seconds while the old
 * one fades out over `DRONE_OUT`, both sounding for a while. Never a glide in pitch.
 */
const DRONE_IN = 6;
const DRONE_OUT = 4.5;
const DRONE_HOLD = 18;

export class Gaida {
  private chanter: OscillatorNode;
  private chanterGain: GainNode;
  private chShaper: WaveShaperNode;
  private chF1: BiquadFilterNode;
  private chF2: BiquadFilterNode;
  private chLp: BiquadFilterNode;
  private chTrim: GainNode;
  private chNoise: GainNode;
  private chCurve = { c: -1 };

  /** The drone's reeds: the tonic, a second reed a breath out of tune, the fifth, the octave. */
  /**
   * Two banks of drone reeds (tonic, a second tonic a breath out of tune, the fifth, the
   * octave). One sounds; when the drone changes note the other is set to the new note while
   * silent and fades in slowly as the first fades out, so the change is a long chord, never a glide.
   */
  private banks: Array<{ voices: Array<{ osc: OscillatorNode; ratio: number; gain: GainNode }>; gain: GainNode }> = [];
  private activeBank = 0;
  /** Voice `i` (0 tonic, 1 second reed, 2 fifth, 3 octave) in both banks. */
  private voice(i: number) {
    return this.banks.map((b) => b.voices[i]);
  }
  private get allVoices() {
    return this.banks.flatMap((b) => b.voices);
  }
  private dShaper: WaveShaperNode;
  private dLp: BiquadFilterNode;
  private dTrim: GainNode;
  private dNoise: GainNode;
  private dMoveDepth: GainNode;
  private dSwellDepth: GainNode;
  private dSwell: GainNode;
  private dGrit: GainNode;
  private droneGain: GainNode;
  private dCurve = { c: -1 };
  private droneTone: DroneTone = DEFAULT_TONE.drone;
  private chanterTone: VoiceTone = DEFAULT_TONE.gaida;
  private droneBase = 1900;

  private sources: AudioScheduledSourceNode[] = [];
  private on = false;
  private droneLevel = 0;
  private hz = midiToHz(TONIC_MIDI);
  private readonly droneHz = midiToHz(TONIC_MIDI - 24);

  /**
   * `droneFx`, when given, also receives the drone alone (for a deep echo and room of its own).
   */
  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    noise: AudioBuffer,
    droneFx?: AudioNode,
  ) {
    const now = ctx.currentTime;
    const air = () => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.loopStart = Math.random();
      this.sources.push(src);
      return src;
    };

    // The chanter: reed through a shaper (clean to overdriven), the body's formants, a lowpass.
    this.chanter = ctx.createOscillator();
    this.chanter.setPeriodicWave(reedWave(ctx, 36, 0.5, 0.85));
    this.chanter.frequency.value = this.hz;
    this.chShaper = ctx.createWaveShaper();
    this.chShaper.oversample = '2x';
    this.chF1 = ctx.createBiquadFilter();
    this.chF1.type = 'peaking';
    this.chF1.frequency.value = 1350;
    this.chF1.Q.value = 1.6;
    this.chF2 = ctx.createBiquadFilter();
    this.chF2.type = 'peaking';
    this.chF2.frequency.value = 3100;
    this.chF2.Q.value = 2;
    this.chLp = ctx.createBiquadFilter();
    this.chLp.type = 'lowpass';
    this.chTrim = ctx.createGain();
    this.chanterGain = ctx.createGain();
    this.chanterGain.gain.value = 0;
    this.chanter.connect(this.chShaper).connect(this.chF1).connect(this.chF2).connect(this.chLp).connect(this.chTrim).connect(this.chanterGain).connect(out);
    // The reed's hiss, sounding only while the chanter does.
    const chBp = ctx.createBiquadFilter();
    chBp.type = 'bandpass';
    chBp.frequency.value = 3200;
    chBp.Q.value = 0.7;
    this.chNoise = ctx.createGain();
    air().connect(chBp).connect(this.chNoise).connect(this.chanterGain);

    // The drone.
    const dw = reedWave(ctx, 60, 0.8, 0.7);
    const dMix = ctx.createGain();
    for (let b = 0; b < 2; b++) {
      const bankGain = ctx.createGain();
      bankGain.gain.value = b === 0 ? 1 : 0;
      bankGain.connect(dMix);
      const voices: Array<{ osc: OscillatorNode; ratio: number; gain: GainNode }> = [];
      for (const [ratio, detune] of [
        [1, 0],
        [1, 3],
        [1.5, 0],
        [2, 0],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(dw);
        osc.frequency.value = this.droneHz * ratio;
        osc.detune.value = detune;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(bankGain);
        voices.push({ osc, ratio, gain });
      }
      this.banks.push({ voices, gain: bankGain });
    }
    this.dShaper = ctx.createWaveShaper();
    this.dShaper.oversample = '2x';
    this.dLp = ctx.createBiquadFilter();
    this.dLp.type = 'lowpass';
    this.dLp.Q.value = 1.1;
    this.dTrim = ctx.createGain();
    const swell = ctx.createGain();
    swell.gain.value = 1;
    this.dSwell = swell;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    dMix.connect(this.dShaper).connect(this.dLp).connect(this.dTrim).connect(swell).connect(this.droneGain).connect(out);
    if (droneFx) this.droneGain.connect(droneFx);
    // A rough, overdriven copy of the drone that the drift swells in and out over many bars.
    const gritShaper = ctx.createWaveShaper();
    gritShaper.curve = gritCurve(0.95);
    gritShaper.oversample = '2x';
    this.dGrit = ctx.createGain();
    this.dGrit.gain.value = 0;
    dMix.connect(gritShaper).connect(this.dGrit).connect(this.dLp);
    const dBp = ctx.createBiquadFilter();
    dBp.type = 'bandpass';
    dBp.frequency.value = 900;
    dBp.Q.value = 0.6;
    this.dNoise = ctx.createGain();
    air().connect(dBp).connect(this.dNoise).connect(this.droneGain);

    // The drone's own life: its tone opens and closes slowly, and it swells a little.
    const move = ctx.createOscillator();
    move.frequency.value = 0.061;
    this.dMoveDepth = ctx.createGain();
    move.connect(this.dMoveDepth).connect(this.dLp.frequency);
    const breathe = ctx.createOscillator();
    breathe.frequency.value = 0.137;
    this.dSwellDepth = ctx.createGain();
    breathe.connect(this.dSwellDepth).connect(swell.gain);

    // The player's breath into the bag is never perfectly steady.
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.23;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 3;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(this.chanter.detune);
    for (const d of this.allVoices) wobbleDepth.connect(d.osc.detune);

    const oscs = [this.chanter, ...this.allVoices.map((d) => d.osc), move, breathe, wobble];
    for (const o of oscs) o.start(now);
    for (const s of this.sources) s.start(now);
    this.sources.push(...oscs);
    this.setTone(this.chanterTone, this.droneTone);
  }

  setTone(chanter: VoiceTone, drone: DroneTone) {
    const ctx = this.ctx;
    this.chanterTone = chanter;
    this.droneTone = drone;
    // The chanter: no body at the electronic end, a hot, buzzing reed at the gritty end.
    const cc = chanter.character;
    setCurve(this.chShaper, cc, this.chCurve);
    smooth(this.chF1.gain, 9 * Math.min(1, cc * 2) + 3 * roughness(cc), ctx);
    smooth(this.chF2.gain, 5 * Math.min(1, cc * 2), ctx);
    smooth(this.chLp.frequency, lin(1500, 8000, cc), ctx);
    smooth(this.chTrim.gain, chanter.level / 0.8, ctx);
    smooth(this.chNoise.gain, chanter.breath * 0.09 * (1 - 0.6 * synthiness(cc)), ctx);

    // The drone: its voicing, beating, movement, character and breath.
    const dc = drone.character;
    setCurve(this.dShaper, dc, this.dCurve);
    this.droneBase = lin(650, 3600, dc);
    smooth(this.dLp.frequency, this.droneBase, ctx, 0.4);
    smooth(this.dLp.Q, 1.1 + synthiness(dc) * 5, ctx);
    smooth(this.dTrim.gain, drone.level / 0.8, ctx);
    smooth(this.dNoise.gain, drone.breath * 0.07, ctx);
    smooth(this.dMoveDepth.gain, drone.movement * this.droneBase * 0.06, ctx);
    smooth(this.dSwellDepth.gain, drone.movement * 0.08, ctx);
    for (const v of this.voice(0)) smooth(v.gain.gain, 1, ctx);
    for (const v of this.voice(1)) {
      smooth(v.gain.gain, 0.15 + 0.35 * drone.beating, ctx);
      smooth(v.osc.detune, 1 + drone.beating * 10, ctx, 0.5);
    }
    for (const v of this.voice(2)) smooth(v.gain.gain, drone.voicing === 'fifth' || drone.voicing === 'open' ? 0.45 : 0, ctx, 0.6);
    for (const v of this.voice(3)) smooth(v.gain.gain, drone.voicing === 'octave' || drone.voicing === 'open' ? 0.32 : 0, ctx, 0.6);
  }

  /**
   * Brings the drone to a level (0 to 1) on a root (semitones from the tonic). From silence it
   * swells in as the bag fills, at pitch; a new root fades in slowly over the old one, which
   * lingers and fades: a long chord, never a glide.
   */
  setDrone(at: number, level: number, intensity = 0.5, rootSemitones = 0) {
    const target = level * DRONE_PEAK;
    const g = this.droneGain.gain;
    const root = Math.pow(2, rootSemitones / 12);
    const tune = (bank: number, r: number) => {
      for (const v of this.banks[bank].voices) {
        v.osc.frequency.cancelScheduledValues(at);
        v.osc.frequency.setValueAtTime(this.droneHz * r * v.ratio, at);
      }
    };
    if (this.droneLevel === 0 && level > 0) {
      // From silence: the sounding bank on the new note, the other quiet.
      tune(this.activeBank, root);
      for (const [i, b] of this.banks.entries()) {
        b.gain.gain.cancelScheduledValues(at);
        b.gain.gain.setValueAtTime(i === this.activeBank ? 1 : 0, at);
      }
      this.root = root;
      this.rootSince = at;
      g.cancelScheduledValues(at);
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(target, at + 0.9);
    } else if (level === 0 && this.droneLevel > 0) {
      g.setTargetAtTime(0, at, 0.25);
    } else {
      g.setTargetAtTime(target, at, 0.8);
      // A chord needs time to sound: the drone holds a note at least `DRONE_HOLD` seconds.
      if (Math.abs(root - this.root) > 0.001 && at - this.rootSince >= DRONE_HOLD) {
        this.root = root;
        this.rootSince = at;
        // Set the silent bank to the new note, then let it bloom in over the old one.
        const from = this.banks[this.activeBank].gain.gain;
        const next = 1 - this.activeBank;
        const to = this.banks[next].gain.gain;
        tune(next, root);
        from.cancelScheduledValues(at);
        to.cancelScheduledValues(at);
        from.setValueAtTime(from.value, at);
        to.setValueAtTime(0, at);
        // The old note lingers, the new one blooms in under it: for a while, a chord.
        from.setTargetAtTime(0, at + 0.8, DRONE_OUT / 3);
        to.setTargetAtTime(1, at, DRONE_IN / 3);
        this.activeBank = next;
      }
    }
    this.intensity = intensity;
    this.droneLevel = level;
  }

  private rootSince = -Infinity;

  private intensity = 0.3;
  private root = 1;

  /**
   * The drone's long life: over the next `span` seconds (a few bars) its brightness, breath,
   * roughness, the bloom of the fifth above, the beating between its reeds and its swell glide
   * towards new places near the tone's settings, so it never quite stands still. How far it
   * wanders is the tone's `movement`; the music's intensity brightens it overall.
   */
  drift(at: number, span: number, rng: () => number = Math.random) {
    const t = this.droneTone;
    // Movement and beating themselves rise and fall over minutes, out of step with each other.
    const slow = (period: number, phase: number) => 0.5 + 0.5 * Math.sin((2 * Math.PI * at) / period + phase);
    const m = t.movement * (0.3 + 0.9 * slow(97, 0.4));
    const beating = t.beating * (0.25 + 1.05 * slow(143, 2.1));
    const tau = span / 3;
    const r = () => rng();
    // Brightness moves only a little: a wide sweep of the filter sounds like a jet passing.
    const bright = this.droneBase * lin(0.85, 1.2, this.intensity) * (1 + m * (r() * 0.4 - 0.2));
    this.dLp.frequency.setTargetAtTime(Math.max(180, bright), at, tau);
    this.dNoise.gain.setTargetAtTime(t.breath * 0.07 * (1 + m * (r() * 2.2 - 0.8)), at, tau);
    // Now and then the drone roughens, then smooths again.
    const grit = r() < 0.4 * m ? m * 0.55 * r() : 0;
    this.dGrit.gain.setTargetAtTime(grit, at, tau);
    this.dSwell.gain.setTargetAtTime(1 + m * (r() * 0.5 - 0.2), at, tau);
    // The beating changes its rate only gently, so it shimmers rather than sweeps.
    const detune = 1 + beating * 10 * (0.8 + r() * 0.4);
    for (const v of this.voice(1)) {
      v.osc.detune.setTargetAtTime(detune, at, tau);
      v.gain.gain.setTargetAtTime(0.15 + 0.35 * Math.min(1, beating), at, tau);
    }
    const hasFifth = t.voicing === 'fifth' || t.voicing === 'open';
    const hasOctave = t.voicing === 'octave' || t.voicing === 'open';
    const fifth = hasFifth ? 0.45 * (0.6 + 0.5 * r()) : r() < 0.3 * m ? 0.22 * m : 0;
    const octave = hasOctave ? 0.32 * (0.6 + 0.5 * r()) : r() < 0.2 * m ? 0.15 * m : 0;
    for (const v of this.voice(2)) v.gain.gain.setTargetAtTime(fifth, at, tau);
    for (const v of this.voice(3)) v.gain.gain.setTargetAtTime(octave, at, tau);
  }

  /** Plays a phrase's notes from `at`; fills the bag or empties it as the phrase asks. */
  play(on: boolean, notes: NoteEvent[], at: number) {
    const f = this.chanter.frequency;
    const g = this.chanterGain.gain;
    if (on && !this.on) {
      const first = notes[0] ? midiToHz(notes[0].midi) : this.hz;
      f.setValueAtTime(first * 0.95, at);
      f.exponentialRampToValueAtTime(first, at + 0.28);
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(GAIDA_PEAK, at + 0.3);
    } else if (!on && this.on) {
      f.setValueAtTime(this.hz, at);
      f.exponentialRampToValueAtTime(this.hz * 0.9, at + 0.4);
      g.setValueAtTime(GAIDA_PEAK, at);
      g.linearRampToValueAtTime(0, at + 0.4);
    }
    this.on = on;
    if (!on) return;
    for (const n of notes) {
      const t = at + n.t;
      const graceDur = Math.min(0.032, n.dur * 0.25);
      (n.graces ?? []).forEach((m, i, all) => f.setValueAtTime(midiToHz(m), t - (all.length - i) * graceDur));
      this.hz = midiToHz(n.midi);
      f.setValueAtTime(this.hz, t);
      if (n.trillTo) {
        const up = midiToHz(n.trillTo);
        const rate = 0.052;
        for (let k = 1; t + k * rate < t + n.dur * 0.8; k++) f.setValueAtTime(k % 2 ? up : this.hz, t + k * rate);
        f.setValueAtTime(this.hz, t + n.dur * 0.8);
      }
      // Each new note leans in a touch, the way a squeeze of the bag does.
      g.setValueAtTime(GAIDA_PEAK * (0.9 + 0.12 * n.vel), t);
    }
  }

  /** Lets the chanter fall silent from `at` over `fade` seconds, dropping what was to come. */
  fadeChanter(at: number, fade = 0.4) {
    const f = this.chanter.frequency;
    const g = this.chanterGain.gain;
    f.cancelScheduledValues(at);
    g.cancelScheduledValues(at);
    f.setValueAtTime(this.hz, at);
    g.setValueAtTime(this.on ? GAIDA_PEAK * 0.9 : 0, at);
    g.linearRampToValueAtTime(0, at + fade);
    this.on = false;
  }

  dispose() {
    for (const o of this.sources) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------

const KAVAL_PEAK = 0.2;

export class Kaval {
  private osc: OscillatorNode;
  private amp: GainNode;
  private shaper: WaveShaperNode;
  private toneLp: BiquadFilterNode;
  private trim: GainNode;
  private breath: GainNode;
  private breathFilter: BiquadFilterNode;
  private growl: GainNode;
  private vib: GainNode;
  private hz = midiToHz(TONIC_MIDI);
  private lastEnd = -Infinity;
  private sources: AudioScheduledSourceNode[] = [];
  private tone: VoiceTone = DEFAULT_TONE.kaval;
  private curveAt = { c: -1 };

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    noise: AudioBuffer,
  ) {
    const now = ctx.currentTime;
    this.trim = ctx.createGain();
    this.trim.connect(out);
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(fluteWave(ctx));
    this.osc.frequency.value = this.hz;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.toneLp = ctx.createBiquadFilter();
    this.toneLp.type = 'lowpass';
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.osc.connect(this.shaper).connect(this.toneLp).connect(this.amp).connect(this.trim);

    // Breath: noise tuned to the note, so the air sounds like it is in the tube.
    const air = ctx.createBufferSource();
    air.buffer = noise;
    air.loop = true;
    this.breathFilter = ctx.createBiquadFilter();
    this.breathFilter.type = 'bandpass';
    this.breathFilter.Q.value = 1.4;
    this.breathFilter.frequency.value = this.hz * 2;
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 600;
    this.breath = ctx.createGain();
    this.breath.gain.value = 0;
    air.connect(hiss).connect(this.breathFilter).connect(this.breath).connect(this.trim);

    // Kaba: the low register's growl, the tone pushed through the throat.
    const growlShaper = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(4 * ((i / (curve.length - 1)) * 2 - 1));
    growlShaper.curve = curve;
    const gbp = ctx.createBiquadFilter();
    gbp.type = 'bandpass';
    gbp.frequency.value = 900;
    gbp.Q.value = 0.7;
    this.growl = ctx.createGain();
    this.growl.gain.value = 0;
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 31;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 0.5;
    const growlAm = ctx.createGain();
    growlAm.gain.value = 0.5;
    flutter.connect(flutterDepth).connect(growlAm.gain);
    this.osc.connect(growlShaper).connect(gbp).connect(growlAm).connect(this.growl).connect(this.trim);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.1;
    this.vib = ctx.createGain();
    this.vib.gain.value = 0;
    lfo.connect(this.vib).connect(this.osc.detune);

    for (const o of [this.osc, air, flutter, lfo]) o.start(now);
    this.sources = [this.osc, air, flutter, lfo];
    this.setTone(this.tone);
  }

  setTone(t: VoiceTone) {
    this.tone = t;
    setCurve(this.shaper, t.character, this.curveAt);
    // Electronic: a pure, rounded tone; usual and up: the whole tube.
    smooth(this.toneLp.frequency, lin(1400, 9000, Math.min(1, t.character * 1.6)), this.ctx);
    smooth(this.trim.gain, t.level / 0.8, this.ctx);
  }

  /** Fades the kaval out from `at` over `fade` seconds, dropping the notes still to come. */
  fadeOut(at: number, fade = 0.4) {
    const params = [this.osc.frequency, this.amp.gain, this.breath.gain, this.vib.gain, this.growl.gain, this.breathFilter.frequency];
    for (const p of params) p.cancelScheduledValues(at);
    this.osc.frequency.setValueAtTime(this.hz, at);
    this.breathFilter.frequency.setValueAtTime(this.hz * 2, at);
    for (const p of [this.amp.gain, this.breath.gain, this.growl.gain]) {
      p.setValueAtTime(p.value, at);
      p.linearRampToValueAtTime(0, at + fade);
    }
    this.vib.gain.setValueAtTime(0, at);
    this.lastEnd = at + fade;
  }

  play(notes: NoteEvent[], at: number) {
    const f = this.osc.frequency;
    const a = this.amp.gain;
    const b = this.breath.gain;
    const breathMul = this.tone.breath * 2;
    const growlMul = Math.min(2, this.tone.character * 2);
    notes.forEach((n, i) => {
      const t = at + n.t;
      const end = t + n.dur;
      const next = notes[i + 1];
      const peak = KAVAL_PEAK * (0.45 + 0.55 * n.vel);
      const air = peak * breathMul;
      const hz = midiToHz(n.midi);
      const fresh = t - this.lastEnd > 0.03;
      const graceDur = 0.045;
      const gStart = t - (n.graces?.length ?? 0) * graceDur;

      // Pitch.
      if (n.graces?.length) n.graces.forEach((m, k) => f.setValueAtTime(midiToHz(m), gStart + k * graceDur));
      if (n.glideFrom !== undefined) {
        f.setValueAtTime(midiToHz(n.glideFrom), t);
        f.exponentialRampToValueAtTime(hz, t + Math.min(0.14, n.dur * 0.4));
      } else if (!fresh && !n.graces?.length) {
        f.setValueAtTime(this.hz, Math.max(this.lastEnd - 0.012, t - 0.012));
        f.exponentialRampToValueAtTime(hz, t);
      } else f.setValueAtTime(hz, t);
      this.breathFilter.frequency.setValueAtTime(hz * 2, t);

      // Loudness: a fresh breath, a tongued dip, or a slur.
      const s = Math.min(gStart, t);
      if (fresh) {
        a.setValueAtTime(0, s);
        a.linearRampToValueAtTime(peak, t + 0.06);
        b.setValueAtTime(0, s);
        b.linearRampToValueAtTime(air * 0.55, s + 0.03);
        b.linearRampToValueAtTime(air * 0.16, t + 0.12);
      } else if (n.tongued) {
        a.setValueAtTime(peak * 0.9, s - 0.02);
        a.linearRampToValueAtTime(peak * 0.3, s);
        a.linearRampToValueAtTime(peak, t + 0.04);
        b.setValueAtTime(air * 0.4, s);
        b.linearRampToValueAtTime(air * 0.16, t + 0.08);
      } else {
        a.setValueAtTime(peak, t);
        b.setValueAtTime(air * 0.16, t);
      }
      if (n.dur > 0.5) a.linearRampToValueAtTime(peak * 1.08, t + n.dur * 0.6);

      // Vibrato blooms late on a held note.
      const v = this.vib.gain;
      v.setValueAtTime(0, t);
      if (n.vibrato && n.dur > 0.5) {
        v.linearRampToValueAtTime(0, t + Math.min(0.35, n.dur * 0.3));
        v.linearRampToValueAtTime(n.vibrato * 16, t + Math.min(1.2, n.dur * 0.85));
      }

      // The growl in the low register (none at the electronic end).
      const low = n.midi < TONIC_MIDI + 5;
      this.growl.gain.setTargetAtTime(low ? peak * 0.45 * n.vel * growlMul : 0, t, 0.05);

      const gapAfter = next ? next.t - (n.t + n.dur) : Infinity;
      if (gapAfter > 0.03) {
        a.setValueAtTime(peak, end - 0.02);
        a.linearRampToValueAtTime(0, end + 0.1);
        b.setValueAtTime(air * 0.16, end - 0.02);
        b.linearRampToValueAtTime(0, end + 0.12);
        this.growl.gain.setTargetAtTime(0, end, 0.04);
      }
      this.hz = hz;
      this.lastEnd = end;
    });
  }

  dispose() {
    for (const o of this.sources) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
  }
}
