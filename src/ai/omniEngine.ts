import type { ModelProgress } from '../engine/types';

interface OmniModule {
  Lfm3OmniForConditionalGeneration: {
    checkAvailability(modelId: string, opts?: { mmproj?: string }): Promise<{ ok: boolean; reason?: string }>;
    from_pretrained(
      modelId: string,
      opts?: { mmproj?: string; onProgress?: (p: any) => void },
    ): Promise<OmniModelInstance>;
  };
}

interface OmniSession {
  prime(messages: any[], opts?: any): { result: Promise<any> };
  generate(messages: any[], opts?: any): AsyncIterable<any> & { result: Promise<any> };
}

interface OmniModelInstance {
  input_sampling_rate: number;
  audio_sampling_rate: number;
  create_session(): OmniSession;
  deviceInfo(): { vendor?: string; architecture?: string; description?: string };
  dispose?(): Promise<void>;
}

let cachedModule: OmniModule | null = null;

async function loadOmniModule(): Promise<OmniModule> {
  if (cachedModule) return cachedModule;
  const base =
    typeof globalThis.location !== 'undefined' && globalThis.location.origin !== 'null'
      ? globalThis.location.origin
      : 'http://localhost';
  const moduleUrl = `${base}/vendor/Lfm3OmniForConditionalGeneration.js`;
  const mod = (await import(/* @vite-ignore */ moduleUrl)) as OmniModule;
  cachedModule = mod;
  return mod;
}

async function resolveLocalOmniSource(modelId: string, mmproj?: string): Promise<{
  resolvedModelId: string;
  resolvedMmproj?: string;
  isLocal: boolean;
}> {
  const trimmed = modelId.trim();
  const cleanMmproj = mmproj?.trim() || undefined;
  if (/^https?:/i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('.')) {
    const abs =
      trimmed.startsWith('/') && typeof globalThis.location !== 'undefined'
        ? `${globalThis.location.origin}${trimmed}`
        : trimmed;
    return { resolvedModelId: abs, resolvedMmproj: cleanMmproj, isLocal: !/^https?:\/\/huggingface\.co/i.test(abs) };
  }

  // Probe BOTH local GGUF and mmproj before switching to local /models/
  if (typeof globalThis.location !== 'undefined' && globalThis.location.origin !== 'null') {
    const repoName = (trimmed.split('/').pop() ?? trimmed).replace(/-GGUF$/i, '');
    const localBase = `${globalThis.location.origin}/models/${trimmed}`;
    const ggufUrl = `${localBase}/${repoName}-Q4_K_M.gguf`;
    const mmprojUrl = cleanMmproj
      ? cleanMmproj.startsWith('/') || /^https?:/i.test(cleanMmproj)
        ? cleanMmproj
        : `${localBase}/${cleanMmproj}`
      : `${localBase}/mmproj-${repoName}-Q8_0.gguf`;
    try {
      const [r1, r2] = await Promise.all([
        fetch(ggufUrl, { method: 'HEAD' }),
        fetch(mmprojUrl, { method: 'HEAD' }),
      ]);
      if (r1.ok && r2.ok) {
        return {
          resolvedModelId: localBase,
          resolvedMmproj: cleanMmproj,
          isLocal: true,
        };
      }
    } catch {
      // Fall back to Hugging Face
    }
  }

  return { resolvedModelId: trimmed, resolvedMmproj: cleanMmproj, isLocal: false };
}

class OmniEngine {
  private model: OmniModelInstance | null = null;
  private loadedModelId = '';
  private loadedMmproj = '';
  private queue: Promise<void> = Promise.resolve();
  public progress: ModelProgress = {
    status: 'unloaded',
    fraction: 0,
    message: 'LFM3-Omni-2B not loaded',
  };
  public deviceLabel = 'Unknown GPU';
  private listeners = new Set<(p: ModelProgress) => void>();

  subscribe(fn: (p: ModelProgress) => void): () => void {
    this.listeners.add(fn);
    fn(this.progress);
    return () => this.listeners.delete(fn);
  }

  private emit(p: ModelProgress) {
    this.progress = p;
    for (const fn of this.listeners) fn(p);
  }

  isReady(): boolean {
    return this.model !== null && this.progress.status === 'ready';
  }

  get audioSampleRate(): number {
    return this.model?.audio_sampling_rate ?? 24000;
  }

  get inputSampleRate(): number {
    return this.model?.input_sampling_rate ?? 16000;
  }

  async checkWebGpu(): Promise<{ ok: boolean; reason?: string }> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      return { ok: false, reason: 'This browser does not support WebGPU.' };
    }
    const adapter = await (navigator as any).gpu?.requestAdapter().catch(() => null);
    if (!adapter) {
      return { ok: false, reason: 'No WebGPU adapter available.' };
    }
    return { ok: true };
  }

  async load(modelId: string, mmproj?: string): Promise<void> {
    if (this.model && this.loadedModelId === modelId && this.loadedMmproj === (mmproj ?? '')) {
      return;
    }

    const gpuCheck = await this.checkWebGpu();
    if (!gpuCheck.ok) {
      this.emit({
        status: 'error',
        fraction: 0,
        message: 'WebGPU unavailable',
        error: gpuCheck.reason,
      });
      throw new Error(gpuCheck.reason);
    }

    this.emit({
      status: 'loading',
      fraction: 0.02,
      message: `Checking GPU availability for ${modelId}…`,
    });

    try {
      const { Lfm3OmniForConditionalGeneration } = await loadOmniModule();
      const { resolvedModelId, resolvedMmproj, isLocal } = await resolveLocalOmniSource(
        modelId,
        mmproj,
      );
      const opts = resolvedMmproj ? { mmproj: resolvedMmproj } : {};
      this.emit({
        status: 'loading',
        fraction: 0.04,
        message: isLocal
          ? `Checking GPU & loading local ${resolvedModelId}…`
          : `Checking GPU & fetching ${resolvedModelId}…`,
      });
      const avail = await Lfm3OmniForConditionalGeneration.checkAvailability(resolvedModelId, opts);
      if (!avail.ok) {
        throw new Error(avail.reason ?? 'Device GPU cannot run LFM3-Omni-2B.');
      }

      if (this.model?.dispose) {
        await this.model.dispose().catch(() => {});
      }
      this.model = null;

      this.model = await Lfm3OmniForConditionalGeneration.from_pretrained(resolvedModelId, {
        ...opts,
        onProgress: (t: any) => {
          const fraction =
            t.kind === 'bytes' && t.total > 0
              ? Math.min(0.99, t.loaded / t.total)
              : t.status === 'ready'
                ? 1
                : t.fraction ?? 0.1;
          this.emit({
            status: 'loading',
            fraction,
            loadedBytes: t.loaded,
            totalBytes: t.total,
            message: t.message ?? t.status ?? `Loading ${modelId} (${Math.round(fraction * 100)}%)`,
          });
        },
      });

      const info = this.model.deviceInfo();
      this.deviceLabel =
        info.description || [info.vendor, info.architecture].filter(Boolean).join(' · ') || 'WebGPU';

      this.loadedModelId = modelId;
      this.loadedMmproj = mmproj ?? '';
      this.emit({
        status: 'ready',
        fraction: 1,
        message: `${modelId} ready on ${this.deviceLabel}`,
      });
    } catch (err: any) {
      this.model = null;
      this.loadedModelId = '';
      this.emit({
        status: 'error',
        fraction: 0,
        message: 'Failed to load LFM3-Omni-2B',
        error: err?.message || String(err),
      });
      throw err;
    }
  }

  async unload(): Promise<void> {
    if (this.model?.dispose) {
      await this.model.dispose().catch(() => {});
    }
    this.model = null;
    this.loadedModelId = '';
    this.emit({
      status: 'unloaded',
      fraction: 0,
      message: 'LFM3-Omni-2B unloaded',
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Speech-to-Text (STT) using LFM3-Omni-2B in text generation mode.
   */
  async transcribeAudio(audio: AudioBuffer): Promise<{ text: string; durationMs: number }> {
    if (!this.model) throw new Error('LFM3-Omni-2B is not loaded.');
    return this.enqueue(async () => {
      const session = this.model!.create_session();
      const startedAt = performance.now();
      const messages = [
        {
          role: 'system',
          content:
            'Transcribe the user audio accurately into plain text. Return only the spoken words with punctuation and no commentary.',
        },
        {
          role: 'user',
          content: [{ type: 'audio', audio }],
        },
      ];
      let text = '';
      const gen = session.generate(messages, { generation_mode: 'text', max_new_tokens: 256 });
      for await (const ev of gen) {
        if (ev.type === 'text' && ev.text) {
          text += ev.text;
        }
      }
      await gen.result;
      return {
        text: text.trim(),
        durationMs: Math.round(performance.now() - startedAt),
      };
    });
  }

  /**
   * Text-to-Speech (TTS) using LFM3-Omni-2B interleaved audio_out mode.
   */
  async synthesizeSpeech(
    line: string,
    voiceStyle: string,
    onAudioChunk: (pcm: Float32Array) => void,
    signal?: AbortSignal,
  ): Promise<{ durationMs: number; sampleRate: number }> {
    if (!this.model) throw new Error('LFM3-Omni-2B is not loaded.');
    return this.enqueue(async () => {
      const session = this.model!.create_session();
      const startedAt = performance.now();
      const messages = [
        {
          role: 'system',
          content: `Respond with interleaved text and audio. Speak the exact line requested by the user naturally in this voice style: ${voiceStyle || 'warm and natural'}. Do not add extra words.`,
        },
        {
          role: 'user',
          content: `Read aloud verbatim: "${line}"`,
        },
      ];
      const gen = session.generate(messages, {
        generation_mode: 'interleaved',
        max_new_tokens: 512,
        signal,
      });
      for await (const ev of gen) {
        if (ev.type === 'audio' && ev.audio?.length) {
          onAudioChunk(ev.audio);
        }
      }
      await gen.result;
      return {
        durationMs: Math.round(performance.now() - startedAt),
        sampleRate: this.audioSampleRate,
      };
    });
  }

  /**
   * Full Multimodal Turn (Audio/Text In -> Interleaved Text + Speech Out)
   */
  async respondMultimodal(params: {
    systemPrompt: string;
    text?: string;
    audio?: AudioBuffer | null;
    voice: boolean;
    onTextChunk?: (text: string) => void;
    onAudioChunk?: (pcm: Float32Array) => void;
    signal?: AbortSignal;
  }): Promise<{ text: string; audioChunks: Float32Array[]; durationMs: number }> {
    if (!this.model) throw new Error('LFM3-Omni-2B is not loaded.');
    return this.enqueue(async () => {
      const session = this.model!.create_session();
      const startedAt = performance.now();
      const userContent: any = params.audio
        ? [
            { type: 'audio', audio: params.audio },
            ...(params.text ? [{ type: 'text', text: params.text }] : []),
          ]
        : params.text || 'Hello!';

      const messages = [
        {
          role: 'system',
          content: params.voice
            ? `Respond with interleaved text and audio. ${params.systemPrompt}`
            : params.systemPrompt,
        },
        { role: 'user', content: userContent },
      ];

      let fullText = '';
      const audioChunks: Float32Array[] = [];
      const gen = session.generate(messages, {
        generation_mode: params.voice ? 'interleaved' : 'text',
        max_new_tokens: 512,
        signal: params.signal,
      });

      for await (const ev of gen) {
        if (ev.type === 'text' && ev.text) {
          fullText += ev.text;
          params.onTextChunk?.(ev.text);
        } else if (ev.type === 'audio' && ev.audio?.length) {
          audioChunks.push(ev.audio);
          params.onAudioChunk?.(ev.audio);
        }
      }
      await gen.result;
      return {
        text: fullText.trim(),
        audioChunks,
        durationMs: Math.round(performance.now() - startedAt),
      };
    });
  }
}

export const omniEngine = new OmniEngine();
