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

export class StreamingPcmPlayer {
  private output: GainNode;
  private playhead = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private sampleRate: number;
  private onEnd?: () => void;
  private completed = false;

  constructor(sampleRate = 24000, onEnd?: () => void) {
    const ctx = getAudioContext();
    this.sampleRate = sampleRate;
    this.onEnd = onEnd;
    this.output = ctx.createGain();
    this.output.connect(ctx.destination);
    this.playhead = ctx.currentTime + 0.08;
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
    src.connect(this.output);
    src.start(this.playhead);
    src.onended = () => {
      this.sources.delete(src);
      if (this.completed && this.sources.size === 0) {
        this.output.disconnect();
        this.onEnd?.();
      }
    };
    this.sources.add(src);
    this.playhead += buffer.duration;
  }

  end() {
    this.completed = true;
    if (this.sources.size === 0) {
      this.output.disconnect();
      this.onEnd?.();
    }
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // ignore
      }
    }
    this.sources.clear();
    this.output.disconnect();
  }
}

export function speakWebSpeechFallback(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.98;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}
