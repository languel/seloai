import { busInput, effectiveLevel, type Bus } from './mixer';
let sharedAudioCtx: AudioContext | null = null;
let activePcmPlayers = 0;
let activePcmSources = 0;

export function getAudioDebugStats(): {
  activePlayers: number;
  activeSourcesCount: number;
  contextState: string;
} {
  return {
    activePlayers: activePcmPlayers,
    activeSourcesCount: activePcmSources,
    contextState: sharedAudioCtx ? sharedAudioCtx.state : 'uninitialized',
  };
}

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioContext();
  }
  if (sharedAudioCtx.state === 'suspended' && !audioPaused) {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

let audioPaused = false;
const extraPlaybackContexts = new Set<AudioContext>();
let webSpeechGuard: { arm: () => void; disarm: () => void } | null = null;

/** Registers a one-off playback context so pausing holds it too. Returns an unregister function. */
export function trackPlaybackContext(ctx: AudioContext): () => void {
  extraPlaybackContexts.add(ctx);
  if (audioPaused) ctx.suspend().catch(() => {});
  return () => extraPlaybackContexts.delete(ctx);
}

/**
 * Holds or releases all speech playback mid-utterance. Playback resumes from where it
 * stopped, and anything waiting for an utterance to end keeps waiting while paused.
 */
export function setAudioPaused(paused: boolean): void {
  if (paused === audioPaused) return;
  audioPaused = paused;
  const contexts = [sharedAudioCtx, ...extraPlaybackContexts].filter(
    (ctx): ctx is AudioContext => Boolean(ctx) && ctx!.state !== 'closed',
  );
  for (const ctx of contexts) {
    (paused ? ctx.suspend() : ctx.resume()).catch(() => {});
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      if (paused) window.speechSynthesis.pause();
      else window.speechSynthesis.resume();
    } catch {
      // ignore
    }
  }
  if (paused) webSpeechGuard?.disarm();
  else webSpeechGuard?.arm();
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private samples = new Float32Array(1024);
  private startedAt = 0;
  public active = false;

  async start(): Promise<void> {
    const ctx = getAudioContext();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const mime = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ].find((m) => MediaRecorder.isTypeSupported(m));

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(200);

    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this.startedAt = performance.now();
    this.active = true;
  }

  readLevel(): number {
    if (!this.analyser || !this.active) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) {
      sum += this.samples[i] * this.samples[i];
    }
    const rms = Math.sqrt(sum / this.samples.length);
    return Math.min(1, Math.pow(rms * 6, 0.75));
  }

  elapsedSeconds(): number {
    return this.active ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  async stop(): Promise<{ audioBuffer: AudioBuffer; duration: number; blob: Blob }> {
    const duration = this.elapsedSeconds();
    this.active = false;
    const blob = await new Promise<Blob>((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve(new Blob(this.chunks));
        return;
      }
      this.recorder.onstop = () => {
        resolve(
          new Blob(this.chunks, {
            type: this.recorder?.mimeType || this.chunks[0]?.type || 'audio/webm',
          }),
        );
      };
      this.recorder.stop();
    });
    this.release();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer);
    return { audioBuffer, duration, blob };
  }

  cancel() {
    this.active = false;
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // ignore
      }
    }
    this.release();
  }

  private release() {
    this.active = false;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.chunks = [];
  }
}

export {
  EAVESDROP_SLIDER_MAX,
  EAVESDROP_WHOLE_MAP_RADIUS,
  EAVESDROP_WHOLE_MAP_THRESHOLD,
  computeSpatialMix,
  isWholeMapEavesdrop,
  type SpatialMix,
} from '../engine/spatialMix';
export interface AcousticShaping {
  pitchSemitones?: number;
  speakingRate?: number;
  warmthDb?: number;
}

export class StreamingPcmPlayer {
  private output: GainNode;
  private filter: BiquadFilterNode | null = null;
  private panner: StereoPannerNode | null = null;
  private playhead = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private sampleRate: number;
  private onEnd?: () => void;
  private completed = false;
  private ended = false;
  private endWaiters: Array<() => void> = [];
  private pitchSemitones: number;
  private speakingRate: number;
  private ctx: AudioContext;

  /**
   * `ctx` plays on a context of its own (a preview the world's pause must not hold); `bus` is
   * the mixer channel it plays through (characters' voices, the narrator, or the guide).
   */
  constructor(
    sampleRate = 24000,
    onEnd?: () => void,
    spatial?: { gain: number; pan: number },
    acoustic?: AcousticShaping,
    ctx: AudioContext = getAudioContext(),
    bus: Bus = 'voices',
  ) {
    this.ctx = ctx;
    this.sampleRate = sampleRate;
    this.onEnd = onEnd;
    this.pitchSemitones = Math.max(-6, Math.min(6, acoustic?.pitchSemitones ?? 0));
    this.speakingRate = Math.max(0.75, Math.min(1.35, acoustic?.speakingRate ?? 1.0));
    const warmthDb = Math.max(-8, Math.min(8, acoustic?.warmthDb ?? 0));

    this.output = ctx.createGain();
    this.output.gain.value = spatial ? Math.max(0, Math.min(1, spatial.gain)) : 1;

    let tail: AudioNode = this.output;
    if (Math.abs(warmthDb) > 0.1 && typeof ctx.createBiquadFilter === 'function') {
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowshelf';
      this.filter.frequency.value = 320;
      this.filter.gain.value = warmthDb;
      tail.connect(this.filter);
      tail = this.filter;
    }

    if (typeof ctx.createStereoPanner === 'function') {
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = spatial ? Math.max(-1, Math.min(1, spatial.pan)) : 0;
      tail.connect(this.panner);
      this.panner.connect(busInput(ctx, bus));
    } else {
      tail.connect(busInput(ctx, bus));
    }
    this.playhead = ctx.currentTime + 0.08;
    activePcmPlayers += 1;
  }

  setSpatial(gain: number, pan: number) {
    const ctx = this.ctx;
    const clampedGain = Math.max(0, Math.min(1, gain));
    const clampedPan = Math.max(-1, Math.min(1, pan));
    this.output.gain.setTargetAtTime(clampedGain, ctx.currentTime, 0.05);
    if (this.panner) {
      this.panner.pan.setTargetAtTime(clampedPan, ctx.currentTime, 0.05);
    }
  }

  push(chunk: Float32Array) {
    const ctx = this.ctx;
    if (this.playhead < ctx.currentTime) {
      this.playhead = ctx.currentTime + 0.02;
    }
    const buffer = ctx.createBuffer(1, chunk.length, this.sampleRate);
    buffer.copyToChannel(new Float32Array(chunk), 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.speakingRate;
    if (this.pitchSemitones !== 0 && 'detune' in src) {
      src.detune.value = this.pitchSemitones * 100;
    }
    src.connect(this.output);
    src.start(this.playhead);
    this.sources.add(src);
    activePcmSources += 1;
    src.onended = () => {
      if (this.sources.delete(src)) {
        activePcmSources = Math.max(0, activePcmSources - 1);
      }
      src.onended = null;
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
      src.buffer = null;
      if (this.completed && this.sources.size === 0) {
        this.finish();
      }
    };
    const effectiveRate =
      this.speakingRate * Math.pow(2, this.pitchSemitones / 12);
    this.playhead += buffer.duration / Math.max(0.5, effectiveRate);
  }

  waitForEnd(): Promise<void> {
    if (this.ended) return Promise.resolve();
    return new Promise((resolve) => {
      this.endWaiters.push(resolve);
    });
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    activePcmPlayers = Math.max(0, activePcmPlayers - 1);
    this.disconnect();
    const waiters = this.endWaiters.splice(0);
    for (const w of waiters) w();
    this.onEnd?.();
  }

  end() {
    this.completed = true;
    if (this.sources.size === 0) {
      this.finish();
    }
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.onended = null;
        s.stop();
      } catch {
        // ignore
      }
      try {
        s.disconnect();
      } catch {
        // ignore
      }
      s.buffer = null;
    }
    activePcmSources = Math.max(0, activePcmSources - this.sources.size);
    this.sources.clear();
    this.finish();
  }

  private disconnect() {
    try {
      this.output.disconnect();
      this.filter?.disconnect();
      this.panner?.disconnect();
    } catch {
      // ignore
    }
  }
}

let activeWebSpeechAbort: (() => void) | null = null;

export function cancelActiveWebSpeech(): void {
  activeWebSpeechAbort?.();
  activeWebSpeechAbort = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export function speakWebSpeechFallback(
  text: string,
  volume = 1,
  acoustic?: AcousticShaping,
  onEnd?: () => void,
  options: { ignorePause?: boolean; bus?: Bus } = {},
): boolean {
  const held = audioPaused && !options.ignorePause;
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) {
    onEnd?.();
    return false;
  }
  try {
    const clamped = Math.max(0, Math.min(1, volume));
    if (clamped <= 0.02) {
      onEnd?.();
      return false;
    }
    // Settle any previous pending utterance immediately before starting a new one
    activeWebSpeechAbort?.();

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guardTimer);
      if (webSpeechGuard === guard) webSpeechGuard = null;
      if (activeWebSpeechAbort === finish) {
        activeWebSpeechAbort = null;
      }
      onEnd?.();
    };
    const words = Math.max(1, text.trim().split(/\s+/).length);
    const guardMs = Math.max(2500, Math.min(16000, words * 550));
    // The guard ends a stuck utterance, but must not fire while playback is deliberately held.
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    const guard = {
      arm: () => {
        clearTimeout(guardTimer);
        guardTimer = setTimeout(finish, guardMs);
      },
      disarm: () => clearTimeout(guardTimer),
    };
    // A preview plays through a paused world, so the pause must not hold its guard.
    if (options.ignorePause) guard.arm();
    else {
      webSpeechGuard = guard;
      if (!held) guard.arm();
    }
    activeWebSpeechAbort = finish;

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = Math.max(0.7, Math.min(1.4, acoustic?.speakingRate ?? 0.98));
    utter.pitch = Math.max(0.5, Math.min(1.6, 1.0 + (acoustic?.pitchSemitones ?? 0) * 0.05));
    // The browser's own voice cannot go through the mixer: it takes the bus's level as it starts.
    utter.volume = clamped * effectiveLevel(options.bus ?? 'voices');
    utter.onend = finish;
    utter.onerror = finish;
    if (!held && window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(utter);
    if (held) window.speechSynthesis.pause();
    return true;
  } catch {
    onEnd?.();
    return false;
  }
}

export function speakWebSpeechAsync(
  text: string,
  volume = 1,
  acoustic?: AcousticShaping,
  options: { ignorePause?: boolean; bus?: Bus } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const started = speakWebSpeechFallback(text, volume, acoustic, () => {
      resolve(true);
    }, options);
    if (!started) {
      resolve(false);
    }
  });
}
