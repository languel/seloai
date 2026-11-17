/**
 * A light voice: Kokoro-82M (about 330 MB on WebGPU, 90 MB quantised without it), which reads English far more naturally
 * than the browser's built-in speech. It is the voice the village uses until the Omni
 * voice+brain is loaded, or instead of it on machines that cannot run Omni.
 *
 * English only. Characters get variety from Kokoro's many American and British voices, chosen
 * by gender; the per-voice locale is for Omni and is ignored here.
 * The library is imported only when the voice is first loaded, so it costs nothing until then.
 */
import type { ModelProgress, VillagerVoiceProfile } from '../engine/types';

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** Remembers that the light voice was chosen, so it loads again on later visits. */
export const KOKORO_CHOSEN_KEY = 'seloai:light-voice-v1';

const FEMALE_US = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_aoede', 'af_kore', 'af_jessica', 'af_river', 'af_nova', 'af_sky'];
const FEMALE_GB = ['bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily'];
const MALE_US = ['am_michael', 'am_fenrir', 'am_puck', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'am_adam'];
const MALE_GB = ['bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The Kokoro voice a speaker is given: one of its voices of that gender, steady for the same
 * id and spread across speakers for variety. The voice locale is an Omni setting and is not
 * used here.
 */
export function kokoroVoiceFor(id: string, voice: Pick<VillagerVoiceProfile, 'gender'>): string {
  const pool = voice.gender === 'male' ? [...MALE_US, ...MALE_GB] : [...FEMALE_US, ...FEMALE_GB];
  return pool[hash(id) % pool.length];
}

interface KokoroLike {
  generate(text: string, opts: { voice: string; speed?: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
}

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

class KokoroEngine {
  private tts: KokoroLike | null = null;
  private loading: Promise<void> | null = null;
  private progress: ModelProgress = { status: 'unloaded', fraction: 0, message: 'Light voice not loaded' };
  private listeners = new Set<(p: ModelProgress) => void>();
  /** One line at a time: the model is not safe to run concurrently. */
  private queue: Promise<unknown> = Promise.resolve();

  subscribe(fn: (p: ModelProgress) => void): () => void {
    this.listeners.add(fn);
    fn(this.progress);
    return () => this.listeners.delete(fn);
  }

  getProgress(): ModelProgress {
    return this.progress;
  }

  isReady(): boolean {
    return this.tts !== null;
  }

  private emit(p: ModelProgress) {
    this.progress = p;
    for (const fn of this.listeners) fn(p);
  }

  load(): Promise<void> {
    if (this.tts) return Promise.resolve();
    if (this.loading) return this.loading;
    this.emit({ status: 'loading', fraction: 0, message: 'Fetching the light voice (Kokoro-82M)…' });
    const files = new Map<string, { loaded: number; total: number }>();
    this.loading = (async () => {
      try {
        const { KokoroTTS } = await import('kokoro-js');
        // On the GPU a line takes a tenth of its length to make; on WASM it is slower than
        // real time and holds the page's thread, so the GPU is used whenever there is one.
        const gpu = await hasWebGpu();
        const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
          dtype: gpu ? 'fp32' : 'q8',
          device: gpu ? 'webgpu' : 'wasm',
          progress_callback: (p: any) => {
            if (p?.status !== 'progress' || !p.file) return;
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
            let loaded = 0;
            let total = 0;
            for (const f of files.values()) {
              loaded += f.loaded;
              total += f.total;
            }
            const fraction = total > 0 ? Math.min(0.99, loaded / total) : 0;
            this.emit({ status: 'loading', fraction, message: `Fetching the light voice… ${Math.round(fraction * 100)}%` });
          },
        });
        this.tts = tts as unknown as KokoroLike;
        try {
          localStorage.setItem(KOKORO_CHOSEN_KEY, '1');
        } catch {
          // ignore
        }
        this.emit({ status: 'ready', fraction: 1, message: 'Light voice ready (Kokoro-82M)' });
      } catch (err: any) {
        this.emit({ status: 'error', fraction: 0, message: `Light voice failed: ${err?.message || String(err)}` });
        throw err;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Reads a line in the given Kokoro voice; returns mono samples and their rate. */
  synthesize(text: string, voice: string, speed = 1): Promise<{ audio: Float32Array; sampleRate: number }> {
    const run = this.queue.then(async () => {
      if (!this.tts) throw new Error('The light voice is not loaded.');
      const out = await this.tts.generate(text, { voice, speed: Math.max(0.7, Math.min(1.4, speed)) });
      return { audio: out.audio, sampleRate: out.sampling_rate };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export const kokoroEngine = new KokoroEngine();

/** Whether the light voice was chosen on an earlier visit (so it can load again quietly). */
export function lightVoiceWasChosen(): boolean {
  try {
    return localStorage.getItem(KOKORO_CHOSEN_KEY) === '1';
  } catch {
    return false;
  }
}
