import type { ModelProgress } from '../engine/types';

interface MiniCpmModule {
  MiniCPM5ForCausalLM: {
    checkAvailability(modelId?: string): Promise<{ ok: boolean; reason?: string }>;
    from_pretrained(
      modelId?: string,
      opts?: { onProgress?: (p: any) => void },
    ): Promise<MiniCpmModelInstance>;
  };
}

interface MiniCpmSession {
  generate(messages: any[], opts?: any): AsyncIterable<any> & { result: Promise<any> };
}

interface MiniCpmModelInstance {
  create_session(): MiniCpmSession;
  deviceInfo?(): { vendor?: string; architecture?: string; description?: string };
  dispose?(): Promise<void>;
}

let cachedModule: MiniCpmModule | null = null;

async function loadMiniCpmModule(): Promise<MiniCpmModule> {
  if (cachedModule) return cachedModule;
  const base =
    typeof globalThis.location !== 'undefined' && globalThis.location.origin !== 'null'
      ? globalThis.location.origin
      : 'http://localhost';
  const moduleUrl = `${base}/vendor/MiniCPM5ForCausalLM.js`;
  const mod = (await import(/* @vite-ignore */ moduleUrl)) as MiniCpmModule;
  cachedModule = mod;
  return mod;
}

class MiniCpmEngine {
  private model: MiniCpmModelInstance | null = null;
  private loadedModelId = '';
  private queue: Promise<void> = Promise.resolve();
  public progress: ModelProgress = {
    status: 'unloaded',
    fraction: 0,
    message: 'MiniCPM5-2B not loaded',
  };
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

  async load(modelId = 'openbmb/MiniCPM5-2B-GGUF'): Promise<void> {
    if (this.model && this.loadedModelId === modelId) return;

    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      const msg = 'This browser does not support WebGPU.';
      this.emit({ status: 'error', fraction: 0, message: 'WebGPU unavailable', error: msg });
      throw new Error(msg);
    }

    this.emit({
      status: 'loading',
      fraction: 0.02,
      message: `Checking GPU availability for ${modelId}…`,
    });

    try {
      const { MiniCPM5ForCausalLM } = await loadMiniCpmModule();
      const avail = await MiniCPM5ForCausalLM.checkAvailability(modelId);
      if (!avail.ok) {
        throw new Error(avail.reason ?? 'Device GPU cannot run MiniCPM5-2B.');
      }

      if (this.model?.dispose) {
        await this.model.dispose().catch(() => {});
      }
      this.model = null;

      this.model = await MiniCPM5ForCausalLM.from_pretrained(modelId, {
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

      this.loadedModelId = modelId;
      this.emit({
        status: 'ready',
        fraction: 1,
        message: `${modelId} ready on WebGPU`,
      });
    } catch (err: any) {
      this.model = null;
      this.loadedModelId = '';
      this.emit({
        status: 'error',
        fraction: 0,
        message: 'Failed to load MiniCPM5-2B',
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
      message: 'MiniCPM5-2B unloaded',
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

  async generateText(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: { maxNewTokens?: number; onChunk?: (chunk: string) => void },
  ): Promise<{ text: string; durationMs: number; tokensPerSec: number }> {
    if (!this.model) throw new Error('MiniCPM5-2B is not loaded.');
    return this.enqueue(async () => {
      const session = this.model!.create_session();
      const startedAt = performance.now();
      let fullText = '';
      let chunks = 0;

      const gen = session.generate(messages, {
        max_new_tokens: opts?.maxNewTokens ?? 140,
      });
      for await (const ev of gen) {
        if (ev.type === 'text' && ev.text) {
          chunks += 1;
          fullText += ev.text;
          opts?.onChunk?.(ev.text);
        }
      }
      await gen.result;
      const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
      const tokensPerSec = Number(((Math.max(1, chunks) / durationMs) * 1000).toFixed(1));
      return { text: fullText.trim(), durationMs, tokensPerSec };
    });
  }
}

export const minicpmEngine = new MiniCpmEngine();
