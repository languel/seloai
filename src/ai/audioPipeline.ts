let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioContext();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
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
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.stream = null;
    this.source = null;
    this.analyser = null;
  }
}

export interface SpatialMix {
  gain: number;
  pan: number;
  distance: number;
  inRange: boolean;
}

export function computeSpatialMix(
  speakerX: number,
  speakerY: number,
  listenerX: number,
  listenerY: number,
  radiusTiles = 9,
): SpatialMix {
  const dx = speakerX - listenerX;
  const dy = speakerY - listenerY;
  const distance = Math.hypot(dx, dy);
  if (radiusTiles <= 0 || distance >= radiusTiles) {
    return { gain: 0, pan: 0, distance, inRange: false };
  }
  const normalized = 1 - distance / radiusTiles;
  const gain = Math.max(0, Math.min(1, Math.pow(normalized, 1.5)));
  const pan = Math.max(-0.92, Math.min(0.92, dx / Math.max(1, radiusTiles * 0.65)));
  return { gain, pan, distance, inRange: gain > 0.03 };
}

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

  constructor(
    sampleRate = 24000,
    onEnd?: () => void,
    spatial?: { gain: number; pan: number },
    acoustic?: AcousticShaping,
  ) {
    const ctx = getAudioContext();
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
      this.panner.connect(ctx.destination);
    } else {
      tail.connect(ctx.destination);
    }
    this.playhead = ctx.currentTime + 0.08;
  }

  setSpatial(gain: number, pan: number) {
    const ctx = getAudioContext();
    const clampedGain = Math.max(0, Math.min(1, gain));
    const clampedPan = Math.max(-1, Math.min(1, pan));
    this.output.gain.setTargetAtTime(clampedGain, ctx.currentTime, 0.05);
    if (this.panner) {
      this.panner.pan.setTargetAtTime(clampedPan, ctx.currentTime, 0.05);
    }
  }

  push(chunk: Float32Array) {
    const ctx = getAudioContext();
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
    src.onended = () => {
      this.sources.delete(src);
      if (this.completed && this.sources.size === 0) {
        this.finish();
      }
    };
    this.sources.add(src);
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
    }
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

export function speakWebSpeechFallback(
  text: string,
  volume = 1,
  acoustic?: AcousticShaping,
  onEnd?: () => void,
): boolean {
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
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guardTimer);
      onEnd?.();
    };
    const words = Math.max(1, text.trim().split(/\s+/).length);
    const guardMs = Math.max(2500, Math.min(16000, words * 550));
    const guardTimer = setTimeout(finish, guardMs);

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = Math.max(0.7, Math.min(1.4, acoustic?.speakingRate ?? 0.98));
    utter.pitch = Math.max(0.5, Math.min(1.6, 1.0 + (acoustic?.pitchSemitones ?? 0) * 0.05));
    utter.volume = clamped;
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
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
): Promise<boolean> {
  return new Promise((resolve) => {
    const started = speakWebSpeechFallback(text, volume, acoustic, () => {
      resolve(true);
    });
    if (!started) {
      resolve(false);
    }
  });
}
