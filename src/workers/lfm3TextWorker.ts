import { pipeline, TextStreamer, env } from '@huggingface/transformers';

// Prefer locally hosted models under /models/ first, with remote HF fallback
env.localModelPath = '/models/';
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.useBrowserCache = true;

type TextDtype = 'q4f16' | 'q4' | 'q2f16' | 'q2' | 'q1' | 'fp16';

type WorkerCommand =
  | { type: 'load'; modelId: string; dtype: TextDtype }
  | {
      type: 'generate';
      requestId: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      maxNewTokens?: number;
      temperature?: number;
    }
  | { type: 'unload' };

let generator: any = null;
let loadedModelId = '';
let loadedDtype = '';
let generating = false;

function post(msg: unknown) {
  self.postMessage(msg);
}

async function handleLoad(modelId: string, dtype: TextDtype) {
  if (generator && loadedModelId === modelId && loadedDtype === dtype) {
    post({ type: 'status', status: 'ready', fraction: 1, message: `${modelId} already loaded` });
    return;
  }

  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      throw new Error('WebGPU is not available in this browser worker context.');
    }
    const adapter = await (navigator as any).gpu?.requestAdapter();
    if (!adapter) {
      throw new Error('No WebGPU GPU adapter found.');
    }

    if (generator?.dispose) {
      await generator.dispose().catch(() => {});
    }
    generator = null;

    post({
      type: 'status',
      status: 'loading',
      fraction: 0.02,
      message: `Downloading & compiling ${modelId} (${dtype})…`,
    });

    const fileProgress = new Map<string, { loaded: number; total: number }>();

    generator = await pipeline('text-generation', modelId, {
      dtype,
      device: 'webgpu',
      progress_callback: (info: any) => {
        if (info?.file && typeof info.loaded === 'number' && typeof info.total === 'number' && info.total > 0) {
          fileProgress.set(info.file, { loaded: info.loaded, total: info.total });
          let loaded = 0;
          let total = 0;
          for (const entry of fileProgress.values()) {
            loaded += entry.loaded;
            total += entry.total;
          }
          const fraction = total > 0 ? Math.min(0.99, loaded / total) : 0;
          post({
            type: 'status',
            status: 'loading',
            fraction,
            loadedBytes: loaded,
            totalBytes: total,
            message: `Loading ${info.file} (${Math.round(fraction * 100)}%)`,
          });
        } else if (info?.status) {
          post({
            type: 'status',
            status: 'loading',
            fraction: info.status === 'ready' ? 1 : 0.1,
            message: `${info.status}${info.file ? `: ${info.file}` : ''}`,
          });
        }
      },
    } as any);

    loadedModelId = modelId;
    loadedDtype = dtype;
    post({
      type: 'status',
      status: 'ready',
      fraction: 1,
      message: `${modelId} ready on WebGPU`,
    });
  } catch (err: any) {
    generator = null;
    loadedModelId = '';
    post({
      type: 'status',
      status: 'error',
      fraction: 0,
      message: 'Failed to load LFM3-1.7B',
      error: err?.message || String(err),
    });
  }
}

async function handleGenerate(cmd: Extract<WorkerCommand, { type: 'generate' }>) {
  if (!generator) {
    post({
      type: 'generate_error',
      requestId: cmd.requestId,
      error: 'LFM3-1.7B model is not loaded.',
    });
    return;
  }

  while (generating) {
    await new Promise((r) => setTimeout(r, 40));
  }
  generating = true;
  const startedAt = performance.now();
  let tokenCount = 0;
  let fullText = '';

  try {
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        tokenCount += 1;
        fullText += chunk;
        post({
          type: 'generate_chunk',
          requestId: cmd.requestId,
          chunk,
        });
      },
    });

    const output = await generator(cmd.messages, {
      max_new_tokens: cmd.maxNewTokens ?? 180,
      do_sample: true,
      temperature: cmd.temperature ?? 0.35,
      top_k: 50,
      repetition_penalty: 1.1,
      tokenizer_encode_kwargs: { enable_thinking: false },
      streamer,
    });

    const elapsedMs = performance.now() - startedAt;
    if (!fullText && Array.isArray(output)) {
      const generated = output[0]?.generated_text;
      if (Array.isArray(generated)) {
        const last = generated[generated.length - 1];
        fullText = typeof last?.content === 'string' ? last.content : '';
      } else if (typeof generated === 'string') {
        fullText = generated;
      }
    }

    const tokensPerSec = elapsedMs > 0 ? (Math.max(1, tokenCount) / elapsedMs) * 1000 : 0;
    post({
      type: 'generate_done',
      requestId: cmd.requestId,
      text: fullText.trim(),
      durationMs: Math.round(elapsedMs),
      tokensPerSec: Number(tokensPerSec.toFixed(1)),
    });
  } catch (err: any) {
    post({
      type: 'generate_error',
      requestId: cmd.requestId,
      error: err?.message || String(err),
    });
  } finally {
    generating = false;
  }
}

self.onmessage = async (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
  if (cmd.type === 'load') {
    await handleLoad(cmd.modelId, cmd.dtype);
  } else if (cmd.type === 'generate') {
    await handleGenerate(cmd);
  } else if (cmd.type === 'unload') {
    if (generator?.dispose) {
      await generator.dispose().catch(() => {});
    }
    generator = null;
    loadedModelId = '';
    post({ type: 'status', status: 'unloaded', fraction: 0, message: 'LFM3-1.7B unloaded' });
  }
};
