import type { ModelProgress } from '../engine/types';

interface BonsaiModule {
  DEFAULT_MODEL_ID: string;
  DEFAULT_GGUF_FILE: string;
  TernaryBonsai2: {
    checkAvailability(
      modelId?: string,
      opts?: { file?: string },
    ): Promise<string | null | undefined>;
    load(
      modelId?: string,
      opts?: {
        file?: string;
        maxLength?: number;
        chatTemplateArgs?: Record<string, unknown>;
        onProgress?: (p: any) => void;
      },
    ): Promise<BonsaiModelInstance>;
  };
}

interface BonsaiModelInstance {
  generate(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: { maxNewTokens?: number; signal?: AbortSignal },
  ): AsyncIterable<{ token: number | null; delta: string; text: string }>;
  resetCache?: () => void;
  dispose?: () => void;
}

let cachedModule: BonsaiModule | null = null;

async function loadBonsaiModule(): Promise<BonsaiModule> {
  if (cachedModule) return cachedModule;
  const base =
    typeof globalThis.location !== 'undefined' && globalThis.location.origin !== 'null'
      ? globalThis.location.origin
      : 'http://localhost';
  const moduleUrl = `${base}/vendor/TernaryBonsai2.js`;
  const mod = (await import(/* @vite-ignore */ moduleUrl)) as BonsaiModule;
  cachedModule = mod;
  return mod;
}

function stripThinkingTags(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*$/gi, '')
    .trim();
}

class BonsaiEngine {
  private model: BonsaiModelInstance | null = null;
  private loadedModelId = '';
  private queue: Promise<void> = Promise.resolve();
  public progress: ModelProgress = {
    status: 'unloaded',
    fraction: 0,
    message: 'Ternary Bonsai-2 27B not loaded',
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

  async load(modelId = 'prism-ml/Ternary-Bonsai-2-27B-gguf'): Promise<void> {
    if (this.model && this.loadedModelId === modelId) return;

    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      const msg = 'This browser does not support WebGPU.';
      this.emit({ status: 'error', fraction: 0, message: 'WebGPU unavailable', error: msg });
      throw new Error(msg);
    }

    this.emit({
      status: 'loading',
      fraction: 0.02,
      message: `Checking WebGPU compatibility for ${modelId} (~5.95 GB)…`,
    });

    try {
      const { TernaryBonsai2, DEFAULT_GGUF_FILE } = await loadBonsaiModule();
      const unsupported = await TernaryBonsai2.checkAvailability(modelId, {
        file: DEFAULT_GGUF_FILE,
      });
      if (unsupported) {
        throw new Error(unsupported);
      }

      if (this.model?.dispose) {
        try {
          this.model.dispose();
        } catch {
          // ignore cleanup failure
        }
      }
      this.model = null;

      this.model = await TernaryBonsai2.load(modelId, {
        file: DEFAULT_GGUF_FILE,
        maxLength: 4096,
        chatTemplateArgs: { enable_thinking: false },
        onProgress: (p: any) => {
          let fraction = 0.08;
          if (p.status === 'weights' && p.kind === 'bytes' && p.total > 0) {
            fraction = 0.08 + 0.78 * Math.min(1, (p.loaded ?? 0) / p.total);
          } else if (p.status === 'weights' && p.kind === 'tensors' && p.total > 0) {
            fraction = 0.86 + 0.12 * Math.min(1, (p.loaded ?? 0) / p.total);
          } else if (p.status === 'tokenizer') {
            fraction = 0.06;
          }
          const detailMsg =
            p.message ??
            (p.status === 'weights'
              ? p.fromCache
                ? 'Reading cached Bonsai-2 weights…'
                : 'Downloading Bonsai-2 27B PTQ1_0…'
              : `Loading ${modelId}…`);
          this.emit({
            status: 'loading',
            fraction,
            loadedBytes: p.loaded,
            totalBytes: p.total,
            message: detailMsg,
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
        message: 'Failed to load Ternary Bonsai-2 27B',
        error: err?.message || String(err),
      });
      throw err;
    }
  }

  async unload(): Promise<void> {
    if (this.model?.dispose) {
      try {
        this.model.dispose();
      } catch {
        // ignore cleanup failure
      }
    }
    this.model = null;
    this.loadedModelId = '';
    this.emit({
      status: 'unloaded',
      fraction: 0,
      message: 'Ternary Bonsai-2 27B unloaded',
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
    if (!this.model) throw new Error('Ternary Bonsai-2 27B is not loaded.');
    return this.enqueue(async () => {
      const startedAt = performance.now();
      let fullText = '';
      let emittedLength = 0;
      let tokenCount = 0;

      // Keep distinct villager prompts isolated cleanly
      this.model!.resetCache?.();

      for await (const chunk of this.model!.generate(messages, {
        maxNewTokens: opts?.maxNewTokens ?? 140,
      })) {
        if (chunk.token !== null) tokenCount += 1;
        fullText = chunk.text;
        const clean = stripThinkingTags(fullText);
        if (clean.length > emittedLength) {
          opts?.onChunk?.(clean.slice(emittedLength));
          emittedLength = clean.length;
        }
      }
      const cleaned = stripThinkingTags(fullText);
      const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
      const tokensPerSec = Number(((Math.max(1, tokenCount) / durationMs) * 1000).toFixed(1));
      return { text: cleaned, durationMs, tokensPerSec };
    });
  }
}

export const bonsaiEngine = new BonsaiEngine();
