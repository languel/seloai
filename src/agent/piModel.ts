/**
 * The models Pi can think with. All of them take the same chat messages (OpenAI shape) and
 * the same tool list, and answer with an assistant message that may carry tool calls:
 *
 *   - local: LFM3-1.7B on WebGPU, downloaded once and run in the browser (no key, no server);
 *   - api:   the Brain API set in the settings (OpenAI-compatible, OpenRouter, Ollama,
 *            LM Studio, GitHub Models, or Anthropic).
 */
import type { ApiBrainProvider, ModelSettings } from '../engine/types';
import { resolveOriginUrl } from '../utils/assetUrl';

export interface PiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: Record<string, unknown> };
  /** Problems the model made in the call (unknown tool, missing arguments). */
  errors?: string[];
}

export type PiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: PiToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

export interface PiToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface PiTurn {
  message: Extract<PiMessage, { role: 'assistant' }>;
  finish: 'stop' | 'tool_calls' | 'length' | 'cancelled';
}

/** What a model is doing before its words come: taking in the conversation, or thinking. */
export type PiActivity = { kind: 'reading'; fraction: number } | { kind: 'thinking'; delta: string };

export interface PiCompleteOptions {
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onActivity?: (activity: PiActivity) => void;
}

export interface PiModel {
  /** Shown in the panel. */
  label: string;
  complete(messages: PiMessage[], tools: PiToolSpec[], opts: PiCompleteOptions): Promise<PiTurn>;
}

let callCounter = 0;
const newCallId = () => `call_${Date.now().toString(36)}_${(callCounter++).toString(36)}`;

// ---------------------------------------------------------------------------------------------
// Local: LFM3-1.7B on WebGPU
// ---------------------------------------------------------------------------------------------

export const PI_LOCAL_MODEL_ID = 'LiquidAI/LFM3-1.7B-GGUF';
/** Roughly what the first load downloads (Q4_K_M weights). */
export const PI_LOCAL_DOWNLOAD = 'about 1.1 GB';

interface LocalSession {
  generate(messages: unknown[], opts: Record<string, unknown>): AsyncIterable<{ type: string; text?: string; done?: number; total?: number }> & {
    result: Promise<{ finish_reason: string; message: { role: 'assistant'; content: string; tool_calls?: PiToolCall[] } }>;
  };
  dispose?(): Promise<void> | void;
}
interface LocalModel {
  create_session(): LocalSession;
  dispose?(): Promise<void>;
}
interface LocalModule {
  Lfm3ForCausalLM: {
    checkAvailability(modelId: string, opts?: Record<string, unknown>): Promise<{ ok?: boolean; reason?: string } | boolean | string>;
    from_pretrained(modelId: string, opts?: Record<string, unknown>): Promise<LocalModel>;
  };
}

export interface LocalLoadProgress {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 0 to 1 while downloading. */
  fraction: number;
  message: string;
}

/**
 * The local model, loaded once and kept: one session, reused across turns, so the
 * instructions and tool list stay cached on the GPU between turns.
 */
class LocalPi {
  private model: LocalModel | null = null;
  private session: LocalSession | null = null;
  private loading: Promise<void> | null = null;
  progress: LocalLoadProgress = { status: 'idle', fraction: 0, message: 'Not downloaded yet' };
  private listeners = new Set<(p: LocalLoadProgress) => void>();

  subscribe(fn: (p: LocalLoadProgress) => void): () => void {
    this.listeners.add(fn);
    fn(this.progress);
    return () => this.listeners.delete(fn);
  }

  private set(p: LocalLoadProgress) {
    this.progress = p;
    for (const fn of this.listeners) fn(p);
  }

  isReady() {
    return Boolean(this.session);
  }

  load(): Promise<void> {
    if (this.session) return Promise.resolve();
    this.loading ??= (async () => {
      try {
        if (typeof navigator === 'undefined' || !('gpu' in navigator)) throw new Error('This browser has no WebGPU. Try a recent Chrome or Edge, or use a cloud model.');
        this.set({ status: 'loading', fraction: 0, message: 'Loading the runtime…' });
        const mod = (await import(/* @vite-ignore */ resolveOriginUrl('/vendor/Lfm3ForCausalLM.js'))) as LocalModule;
        const check = await mod.Lfm3ForCausalLM.checkAvailability(PI_LOCAL_MODEL_ID).catch(() => true);
        if (check && typeof check === 'object' && check.ok === false) throw new Error(check.reason || 'This GPU cannot run the model.');
        this.model = await mod.Lfm3ForCausalLM.from_pretrained(PI_LOCAL_MODEL_ID, {
          maxLength: 32768,
          onProgress: (p: { status?: string; kind?: string; loaded?: number; total?: number; progress?: number }) => {
            const fraction =
              typeof p.progress === 'number' ? (p.progress > 1 ? p.progress / 100 : p.progress) : p.total ? (p.loaded ?? 0) / p.total : this.progress.fraction;
            this.set({ status: 'loading', fraction: Math.max(0, Math.min(1, fraction)), message: p.status === 'weights' ? 'Downloading Spinner…' : 'Preparing Spinner…' });
          },
        });
        this.session = this.model.create_session();
        this.set({ status: 'ready', fraction: 1, message: 'Spinner is ready (runs on this machine)' });
      } catch (err) {
        this.set({ status: 'error', fraction: 0, message: err instanceof Error ? err.message : String(err) });
        this.loading = null;
        throw err;
      }
    })();
    return this.loading;
  }

  async complete(messages: PiMessage[], tools: PiToolSpec[], opts: PiCompleteOptions): Promise<PiTurn> {
    // The download is a choice the person makes (it is large): never start it from a message.
    if (!this.session) {
      if (this.loading) await this.loading;
      else throw new Error(`Spinner's local model is not downloaded yet. Use "Download Spinner" (${PI_LOCAL_DOWNLOAD}), or switch to a cloud model.`);
    }
    // Room for the model's thinking as well as a long answer (a table, a whole cast).
    const gen = this.session!.generate(messages, { tools, max_new_tokens: 4096, do_sample: false, signal: opts.signal });
    for await (const ev of gen) {
      if (ev.type === 'text' && ev.text) opts.onText?.(ev.text);
      else if (ev.type === 'reasoning' && ev.text) opts.onActivity?.({ kind: 'thinking', delta: ev.text });
      else if (ev.type === 'prefill' && ev.total) opts.onActivity?.({ kind: 'reading', fraction: Math.min(1, (ev.done ?? 0) / ev.total) });
    }
    const res = await gen.result;
    const calls = (res.message.tool_calls ?? []).map((c) => ({ ...c, id: c.id || newCallId() }));
    return {
      message: { role: 'assistant', content: res.message.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) },
      finish: res.finish_reason === 'tool_calls' && calls.length ? 'tool_calls' : res.finish_reason === 'cancelled' ? 'cancelled' : res.finish_reason === 'length' ? 'length' : 'stop',
    };
  }

  /** Forget the conversation's cache (a new chat). */
  reset() {
    void Promise.resolve(this.session?.dispose?.()).catch(() => {});
    this.session = this.model ? this.model.create_session() : null;
  }
}

export const localPi = new LocalPi();

export const localPiModel: PiModel = {
  label: 'LFM3-1.7B on this machine',
  complete: (messages, tools, opts) => localPi.complete(messages, tools, opts),
};

// ---------------------------------------------------------------------------------------------
// API: the Brain API from the settings
// ---------------------------------------------------------------------------------------------

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** The request for one turn, for each kind of provider (exported for tests). */
export function buildPiApiRequest(
  settings: Pick<ModelSettings, 'localApiProvider' | 'localApiUrl' | 'localApiModel' | 'localApiKey'>,
  messages: PiMessage[],
  tools: PiToolSpec[],
): { url: string; headers: Record<string, string>; body: Record<string, unknown>; kind: 'anthropic' | 'openai' } {
  const provider = (settings.localApiProvider ?? 'custom') as ApiBrainProvider;
  const base = String(settings.localApiUrl || '').replace(/\/+$/, '');
  const key = String(settings.localApiKey || '').trim();
  if (provider === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
        const last = out[out.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
        else out.push({ role: 'user', content: [block] });
      } else if (m.role === 'assistant') {
        const content: unknown[] = [];
        if (m.content.trim()) content.push({ type: 'text', text: m.content });
        for (const c of m.tool_calls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: c.function.arguments });
        out.push({ role: 'assistant', content: content.length ? content : m.content });
      } else out.push({ role: 'user', content: m.content });
    }
    return {
      kind: 'anthropic',
      url: `${base}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        ...(key ? { 'x-api-key': key } : {}),
      },
      body: {
        model: settings.localApiModel,
        max_tokens: 2000,
        system,
        messages: out,
        tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
      },
    };
  }
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  return {
    kind: 'openai',
    url,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(provider === 'openrouter' && typeof globalThis.location !== 'undefined' ? { 'HTTP-Referer': globalThis.location.origin, 'X-Title': 'SeloAI' } : {}),
    },
    body: {
      model: settings.localApiModel,
      max_tokens: 2000,
      temperature: 0.4,
      messages: messages.map((m) =>
        m.role === 'assistant' && m.tool_calls?.length
          ? { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments) } })) }
          : m,
      ),
      tools,
      tool_choice: 'auto',
    },
  };
}

/** One turn's answer from the provider's JSON (exported for tests). */
export function readPiApiResponse(kind: 'anthropic' | 'openai', json: any): PiTurn {
  if (kind === 'anthropic') {
    const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
    const calls: PiToolCall[] = blocks.filter((b) => b?.type === 'tool_use').map((b) => ({ id: String(b.id || newCallId()), type: 'function', function: { name: String(b.name), arguments: parseArgs(b.input) } }));
    return { message: { role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) }, finish: calls.length ? 'tool_calls' : json?.stop_reason === 'max_tokens' ? 'length' : 'stop' };
  }
  const choice = json?.choices?.[0];
  const msg = choice?.message ?? {};
  const calls: PiToolCall[] = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c: any) => ({
    id: String(c.id || newCallId()),
    type: 'function',
    function: { name: String(c.function?.name ?? ''), arguments: parseArgs(c.function?.arguments) },
  }));
  return {
    message: { role: 'assistant', content: typeof msg.content === 'string' ? msg.content : '', ...(calls.length ? { tool_calls: calls } : {}) },
    finish: calls.length ? 'tool_calls' : choice?.finish_reason === 'length' ? 'length' : 'stop',
  };
}

export function apiPiModel(getSettings: () => ModelSettings): PiModel {
  return {
    get label() {
      const s = getSettings();
      return `${s.localApiModel || 'model'} (${s.localApiProvider ?? 'API'})`;
    },
    async complete(messages, tools, opts) {
      const settings = getSettings();
      if (settings.localApiProvider === 'gemini') throw new Error('Spinner cannot use Gemini tools yet. Choose another provider in the Brain API settings, or the local model.');
      if (!settings.localApiUrl || !settings.localApiModel) throw new Error('Set a Brain API (address and model) in the settings first, or use the local model.');
      const req = buildPiApiRequest(settings, messages, tools);
      const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: opts.signal });
      if (!res.ok) throw new Error(`The model API answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      const turn = readPiApiResponse(req.kind, await res.json());
      if (turn.message.content) opts.onText?.(turn.message.content);
      return turn;
    },
  };
}
