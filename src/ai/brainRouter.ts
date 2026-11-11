import { buildNarratorConfig, getEffectiveVoice } from '../data/defaultData';
import type {
  ChatMessage,
  ModelProgress,
  ModelSettings,
  TelemetryEvent,
  TextDtype,
  VillagerConfig,
  VillagerRuntime,
} from '../engine/types';
import { bonsaiEngine } from './bonsaiEngine';
import { omniEngine } from './omniEngine';
import { minicpmEngine } from './minicpmEngine';
import { chatWithLocalApi } from './localApiClient';
import {
  StreamingPcmPlayer,
  speakWebSpeechAsync,
  type SpatialMix,
} from './audioPipeline';

export interface ParsedDialogue {
  spoken: string;
  narration: string[];
  display: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strips accidental self-name speaker prefixes ("Olena: Hello") and separates
 * inline stage actions (*looks out*, [waves]) so NPCs never utter their own
 * names and the Scribe/Narrator can read non-spoken beats in turn.
 */
export function parseDialogueAndNarration(
  rawText: string,
  speakerName?: string,
): ParsedDialogue {
  let cleaned = (rawText ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  const candidateNames = new Set<string>(['assistant', 'npc', 'villager']);
  if (speakerName?.trim()) {
    const trimmed = speakerName.trim();
    candidateNames.add(trimmed);
    const firstWord = trimmed.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 2) {
      candidateNames.add(firstWord);
    }
  }
  const namesPattern = Array.from(candidateNames).map(escapeRegExp).join('|');
  const prefixRegex = new RegExp(
    `^(?:\\*\\*|__)?\\[?(?:${namesPattern})\\]?(?:\\*\\*|__)?\\s*(?:says\\s*)?[:\\-—]\\s*`,
    'i',
  );

  for (let i = 0; i < 3; i += 1) {
    const next = cleaned.replace(prefixRegex, '').trim();
    if (next === cleaned) break;
    cleaned = next;
  }

  // Unwrap balanced outer quotes if prefix removal left a single quoted speech string
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith('“') && cleaned.endsWith('”'))
  ) {
    const inner = cleaned.slice(1, -1).trim();
    if (inner.length > 0 && !inner.slice(0, -1).includes('"')) {
      cleaned = inner;
    }
  }

  const narration: string[] = [];
  const spoken = cleaned
    .replace(/(?:\*([^*\n]{2,120})\*|\[([^\]\n]{2,120})\])/g, (_full, starBody, bracketBody) => {
      const note = String(starBody ?? bracketBody ?? '').trim();
      if (note) {
        narration.push(note.charAt(0).toUpperCase() + note.slice(1));
      }
      return ' ';
    })
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    spoken,
    narration,
    display: spoken || narration.join(' ') || cleaned,
  };
}

type WorkerEvent =
  | {
      type: 'status';
      status: ModelProgress['status'];
      fraction: number;
      loadedBytes?: number;
      totalBytes?: number;
      message: string;
      error?: string;
    }
  | { type: 'generate_chunk'; requestId: string; chunk: string }
  | { type: 'generate_done'; requestId: string; text: string; durationMs: number; tokensPerSec: number }
  | { type: 'generate_error'; requestId: string; error: string };

interface PendingRequest {
  resolve: (val: { text: string; durationMs: number; tokensPerSec: number }) => void;
  reject: (err: Error) => void;
  onChunk?: (chunk: string) => void;
}

class BrainRouter {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private reqCounter = 0;
  public textProgress: ModelProgress = {
    status: 'unloaded',
    fraction: 0,
    message: 'LFM3-1.7B not loaded',
  };
  private textListeners = new Set<(p: ModelProgress) => void>();
  private telemetryListeners = new Set<(ev: TelemetryEvent) => void>();
  public telemetryLog: TelemetryEvent[] = [];
  private activePlayer: StreamingPcmPlayer | null = null;
  private activeSpatialResolver: (() => SpatialMix) | null = null;
  private speechQueue: Promise<void> = Promise.resolve();
  private speechEpoch = 0;
  public lastMetrics = {
    avgTokensPerSec: 0,
    lastTextLatencyMs: 0,
    lastOmniLatencyMs: 0,
    totalCalls: 0,
  };

  subscribeTextStatus(fn: (p: ModelProgress) => void): () => void {
    this.textListeners.add(fn);
    fn(this.textProgress);
    return () => this.textListeners.delete(fn);
  }

  subscribeTelemetry(fn: (ev: TelemetryEvent) => void): () => void {
    this.telemetryListeners.add(fn);
    return () => this.telemetryListeners.delete(fn);
  }

  log(ev: Omit<TelemetryEvent, 'id' | 'timestamp'>) {
    const full: TelemetryEvent = {
      id: `tel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...ev,
    };
    this.telemetryLog = [full, ...this.telemetryLog].slice(0, 200);
    for (const fn of this.telemetryListeners) fn(full);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../workers/lfm3TextWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
      const msg = e.data;
      if (msg.type === 'status') {
        this.textProgress = {
          status: msg.status,
          fraction: msg.fraction,
          loadedBytes: msg.loadedBytes,
          totalBytes: msg.totalBytes,
          message: msg.message,
          error: msg.error,
        };
        for (const fn of this.textListeners) fn(this.textProgress);
        if (msg.status === 'ready') {
          this.log({
            channel: 'lfm3-1.7b',
            level: 'success',
            title: 'LFM3-1.7B Ready',
            detail: msg.message,
          });
        } else if (msg.status === 'error') {
          this.log({
            channel: 'lfm3-1.7b',
            level: 'error',
            title: 'LFM3-1.7B Load Error',
            detail: msg.error || msg.message,
          });
        }
      } else if (msg.type === 'generate_chunk') {
        this.pending.get(msg.requestId)?.onChunk?.(msg.chunk);
      } else if (msg.type === 'generate_done') {
        const req = this.pending.get(msg.requestId);
        if (req) {
          this.pending.delete(msg.requestId);
          req.resolve({
            text: msg.text,
            durationMs: msg.durationMs,
            tokensPerSec: msg.tokensPerSec,
          });
        }
      } else if (msg.type === 'generate_error') {
        const req = this.pending.get(msg.requestId);
        if (req) {
          this.pending.delete(msg.requestId);
          req.reject(new Error(msg.error));
        }
      }
    };
    return this.worker;
  }

  loadTextModel(modelId: string, dtype: TextDtype) {
    this.log({
      channel: 'lfm3-1.7b',
      level: 'info',
      title: 'Loading ONNX Brain',
      detail: `Model: ${modelId} (${dtype})`,
    });
    const w = this.ensureWorker();
    w.postMessage({ type: 'load', modelId, dtype });
  }

  unloadTextModel() {
    this.worker?.postMessage({ type: 'unload' });
  }

  isTextModelReady(): boolean {
    return this.textProgress.status === 'ready';
  }

  async generateText(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: { maxNewTokens?: number; temperature?: number; onChunk?: (c: string) => void },
  ): Promise<{ text: string; durationMs: number; tokensPerSec: number }> {
    if (!this.isTextModelReady()) {
      throw new Error('LFM3-1.7B is not loaded.');
    }
    const w = this.ensureWorker();
    const requestId = `req-${++this.reqCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onChunk: opts?.onChunk });
      w.postMessage({
        type: 'generate',
        requestId,
        messages,
        maxNewTokens: opts?.maxNewTokens ?? 140,
        temperature: opts?.temperature ?? 0.45,
      });
    });
  }

  async generateVillagerReply(params: {
    villager: VillagerConfig;
    runtime: VillagerRuntime;
    partnerName: string;
    history: ChatMessage[];
    settings: ModelSettings;
    onChunk?: (chunk: string) => void;
    speakSpatialResolver?: () => SpatialMix;
  }): Promise<{
    text: string;
    source: ChatMessage['source'];
    durationMs: number;
    audioHandled?: boolean;
  }> {
    const { villager, runtime, partnerName, history, settings } = params;
    const memories = runtime.memories
      .slice(-4)
      .map((m) => `- ${m.summary}`)
      .join('\n');

    const systemPrompt = [
      `You are ${villager.name}, the ${villager.role} in the village of Selo.`,
      `Identity: ${villager.identity}`,
      `Current plan: ${villager.plan}`,
      memories ? `Recent memories:\n${memories}` : '',
      `Respond in character to ${partnerName} in 1 to 2 natural, spoken sentences (under 45 words).`,
      `Speak ONLY plain dialogue in first person. NEVER start with or utter your own name (never write "${villager.name}:"), avoid stage directions, and never break character.`,
    ]
      .filter(Boolean)
      .join('\n');

    const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6).map((m) => {
        if (m.senderId === villager.id) {
          return { role: 'assistant' as const, content: m.text };
        }
        if (m.kind === 'narration' || m.senderId === 'narrator') {
          return { role: 'user' as const, content: `Scene note: ${m.text}` };
        }
        return { role: 'user' as const, content: `${m.senderName} says: "${m.text}"` };
      }),
    ];

    if (chatMessages.length === 1) {
      chatMessages.push({
        role: 'user',
        content: `Greet ${partnerName} warmly in your own voice and share what you are working on today.`,
      });
    }

    // 1. LFM3-Omni-2B as All-in-One Village Brain (when selected or when it's the only WebGPU model loaded)
    const preferOmniBrain =
      settings.inferenceMode === 'lfm3-omni-brain' ||
      (settings.inferenceMode === 'auto' && settings.brainEngine === 'lfm3-omni') ||
      (settings.inferenceMode === 'auto' &&
        !this.isTextModelReady() &&
        !minicpmEngine.isReady() &&
        !bonsaiEngine.isReady() &&
        omniEngine.isReady());

    if (preferOmniBrain) {
      if (omniEngine.isReady()) {
        const voice = getEffectiveVoice(villager);
        const mix = params.speakSpatialResolver?.();
        const wantVoice = Boolean(
          params.speakSpatialResolver && settings.enableOmniTts && mix?.inRange,
        );

        const omniMessages = wantVoice
          ? [
              {
                role: 'system' as const,
                content: `Respond with interleaved text and audio. Speak in ${voice.language} using a ${voice.gender} voice.\n${systemPrompt}`,
              },
              ...chatMessages.slice(1),
            ]
          : chatMessages;

        const runOmniBrainTurn = async () => {
          let player: StreamingPcmPlayer | null = null;
          if (wantVoice && mix) {
            this.activeSpatialResolver = params.speakSpatialResolver ?? null;
            player = new StreamingPcmPlayer(
              omniEngine.audioSampleRate,
              () => {
                if (this.activePlayer === player) {
                  this.activePlayer = null;
                  this.activeSpatialResolver = null;
                }
              },
              mix,
              voice,
            );
            this.activePlayer = player;
          }

          try {
            const res = await omniEngine.generateChatReply({
              messages: omniMessages,
              voice: wantVoice,
              maxNewTokens: wantVoice ? 260 : 120,
              onTextChunk: params.onChunk,
              onAudioChunk: (pcm) => player?.push(pcm),
            });
            player?.end();
            if (player) {
              await player.waitForEnd();
            }
            const cleanText = parseDialogueAndNarration(res.text, villager.name).display;
            this.lastMetrics.lastOmniLatencyMs = res.durationMs;
            this.lastMetrics.lastTextLatencyMs = res.durationMs;
            this.lastMetrics.avgTokensPerSec = res.tokensPerSec;
            this.lastMetrics.totalCalls += 1;
            this.log({
              channel: 'lfm3-omni',
              level: 'success',
              title: `${villager.name} → ${partnerName} (Omni Brain${wantVoice ? '+Voice' : ''})`,
              detail: cleanText,
              durationMs: res.durationMs,
              tokensPerSec: res.tokensPerSec,
            });
            return {
              text: cleanText,
              source: 'lfm3-omni' as const,
              durationMs: res.durationMs,
              audioHandled: wantVoice,
            };
          } catch (err: any) {
            player?.stop();
            this.activeSpatialResolver = null;
            this.log({
              channel: 'lfm3-omni',
              level: 'warn',
              title: 'Omni Brain fallback',
              detail: err?.message || String(err),
            });
            if (
              settings.inferenceMode === 'lfm3-omni-brain' ||
              settings.inferenceMode === 'strict-webgpu'
            ) {
              throw err;
            }
            return null;
          }
        };

        const omniResult = wantVoice
          ? await this.enqueueSpeechTurn(() => runOmniBrainTurn())
          : await runOmniBrainTurn();
        if (omniResult) return omniResult;
      } else if (settings.inferenceMode === 'lfm3-omni-brain') {
        throw new Error('LFM3-Omni Brain mode selected, but LFM3-Omni-2B is not loaded yet.');
      }
    }

    // 2. MiniCPM5-2B GGUF WebGPU Brain
    if (
      (settings.inferenceMode === 'auto' || settings.inferenceMode === 'strict-webgpu') &&
      settings.brainEngine === 'minicpm5-gguf' &&
      minicpmEngine.isReady()
    ) {
      try {
        const res = await minicpmEngine.generateText(chatMessages, {
          maxNewTokens: 110,
          onChunk: params.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, villager.name).display;
        this.lastMetrics.avgTokensPerSec = res.tokensPerSec;
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.totalCalls += 1;
        this.log({
          channel: 'lfm3-1.7b',
          level: 'success',
          title: `${villager.name} → ${partnerName} (MiniCPM5-2B)`,
          detail: cleanText,
          durationMs: res.durationMs,
          tokensPerSec: res.tokensPerSec,
        });
        return { text: cleanText, source: 'minicpm5', durationMs: res.durationMs };
      } catch (err: any) {
        if (settings.inferenceMode === 'strict-webgpu') throw err;
      }
    }

    // 2b. Ternary Bonsai-2 27B GGUF WebGPU Brain
    if (
      (settings.inferenceMode === 'auto' || settings.inferenceMode === 'strict-webgpu') &&
      settings.brainEngine === 'bonsai2-gguf' &&
      bonsaiEngine.isReady()
    ) {
      try {
        const res = await bonsaiEngine.generateText(chatMessages, {
          maxNewTokens: 110,
          onChunk: params.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, villager.name).display;
        this.lastMetrics.avgTokensPerSec = res.tokensPerSec;
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.totalCalls += 1;
        this.log({
          channel: 'lfm3-1.7b',
          level: 'success',
          title: `${villager.name} → ${partnerName} (Bonsai-2 27B)`,
          detail: cleanText,
          durationMs: res.durationMs,
          tokensPerSec: res.tokensPerSec,
        });
        return { text: cleanText, source: 'bonsai2', durationMs: res.durationMs };
      } catch (err: any) {
        if (settings.inferenceMode === 'strict-webgpu') throw err;
      }
    }

    // 3. Transformers.js ONNX WebGPU Brain (LFM3-1.7B, Qwen3.5, Gemma 4, Bonsai)
    const useOnnxWebGpu =
      (settings.inferenceMode === 'auto' || settings.inferenceMode === 'strict-webgpu') &&
      this.isTextModelReady();

    if (useOnnxWebGpu) {
      try {
        const res = await this.generateText(chatMessages, {
          maxNewTokens: 110,
          temperature: 0.45,
          onChunk: params.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, villager.name).display;
        const source: ChatMessage['source'] = settings.textModelId.toLowerCase().includes('lfm3')
          ? 'lfm3-1.7b'
          : 'webgpu-onnx';
        this.lastMetrics.avgTokensPerSec = res.tokensPerSec;
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.totalCalls += 1;
        this.log({
          channel: 'lfm3-1.7b',
          level: 'success',
          title: `${villager.name} → ${partnerName}`,
          detail: cleanText,
          durationMs: res.durationMs,
          tokensPerSec: res.tokensPerSec,
        });
        return { text: cleanText, source, durationMs: res.durationMs };
      } catch (err: any) {
        this.log({
          channel: 'lfm3-1.7b',
          level: 'warn',
          title: 'ONNX WebGPU fallback',
          detail: err?.message || String(err),
        });
        if (settings.inferenceMode === 'strict-webgpu') throw err;
      }
    }

    if (settings.inferenceMode === 'strict-webgpu') {
      throw new Error('Strict WebGPU mode enabled, but no WebGPU brain model is loaded yet.');
    }

    // Ollama / LM Studio HTTP fallback (or primary when inferenceMode === 'local-api')
    const useLocalApi =
      settings.inferenceMode === 'local-api' ||
      (settings.inferenceMode === 'auto' && settings.localApiEnabled && Boolean(settings.localApiUrl.trim()));

    if (useLocalApi && settings.localApiModel.trim()) {
      try {
        const res = await chatWithLocalApi({
          baseUrl: settings.localApiUrl,
          model: settings.localApiModel.trim(),
          messages: chatMessages,
          maxTokens: 110,
          temperature: 0.5,
          onChunk: params.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, villager.name).display;
        const src: ChatMessage['source'] =
          settings.localApiProvider === 'lmstudio' ? 'lmstudio' : 'ollama';
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.totalCalls += 1;
        this.log({
          channel: 'local-api',
          level: 'success',
          title: `${villager.name} → ${partnerName} (${src})`,
          detail: cleanText,
          durationMs: res.durationMs,
        });
        return { text: cleanText, source: src, durationMs: res.durationMs };
      } catch (err: any) {
        this.log({
          channel: 'local-api',
          level: 'warn',
          title: 'Ollama / LM Studio unavailable',
          detail: err?.message || String(err),
        });
        if (settings.inferenceMode === 'local-api') throw err;
      }
    }

    // Story-Sim deterministic persona fallback (instant, zero VRAM)
    const started = performance.now();
    await new Promise((r) => setTimeout(r, 180));
    const reply = synthesizeStorySimReply(villager, partnerName, history);
    const durationMs = Math.round(performance.now() - started);
    this.log({
      channel: 'sim',
      level: 'info',
      title: `${villager.name} → ${partnerName} (Story Sim)`,
      detail: reply,
      durationMs,
    });
    return { text: reply, source: 'story-sim', durationMs };
  }

  async reflectMemory(params: {
    villager: VillagerConfig;
    transcript: string;
    settings: ModelSettings;
  }): Promise<string> {
    const msgs = [
      {
        role: 'system' as const,
        content: `Summarize this short village conversation from ${params.villager.name}'s first-person perspective in one concise sentence (max 22 words).`,
      },
      { role: 'user' as const, content: params.transcript },
    ];
    if (params.settings.inferenceMode !== 'story-sim') {
      try {
        if (
          (params.settings.inferenceMode === 'lfm3-omni-brain' ||
            params.settings.brainEngine === 'lfm3-omni' ||
            (!this.isTextModelReady() && !minicpmEngine.isReady() && !bonsaiEngine.isReady())) &&
          omniEngine.isReady()
        ) {
          const res = await omniEngine.generateChatReply({
            messages: msgs,
            voice: false,
            maxNewTokens: 55,
          });
          return res.text;
        }
        if (params.settings.brainEngine === 'minicpm5-gguf' && minicpmEngine.isReady()) {
          const res = await minicpmEngine.generateText(msgs, { maxNewTokens: 55 });
          return res.text;
        }
        if (params.settings.brainEngine === 'bonsai2-gguf' && bonsaiEngine.isReady()) {
          const res = await bonsaiEngine.generateText(msgs, { maxNewTokens: 55 });
          return res.text;
        }
        if (this.isTextModelReady()) {
          const res = await this.generateText(msgs, { maxNewTokens: 55, temperature: 0.25 });
          return res.text;
        }
      } catch {
        // fall through
      }
    }
    const snippet = params.transcript.split('\n').slice(-1)[0] || '';
    return `Spoke with a neighbor: ${snippet.slice(0, 72)}`;
  }

  refreshActiveSpatialMix() {
    if (!this.activePlayer || !this.activeSpatialResolver) return;
    const mix = this.activeSpatialResolver();
    this.activePlayer.setSpatial(mix.gain, mix.pan);
  }

  /**
   * Serializes all voice turns (Narrator/Scribe + Villagers) so speakers
   * finish speaking cleanly in turn without overlapping or cutting each other off.
   */
  private enqueueSpeechTurn<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const enqueuedEpoch = this.speechEpoch;
    const run = this.speechQueue.then(async () => {
      if (enqueuedEpoch !== this.speechEpoch) return undefined;
      return fn();
    });
    this.speechQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Spoken voice reply using LFM3-Omni-2B (or Web Speech fallback),
   * strictly queued in turn and attenuated/panned by spatial proximity.
   */
  async speakLine(
    text: string,
    villager: VillagerConfig,
    settings: ModelSettings,
    spatialResolver?: () => SpatialMix,
  ): Promise<void> {
    const cleanSpeech = parseDialogueAndNarration(text, villager.name).display;
    if (!cleanSpeech.trim()) return;

    await this.enqueueSpeechTurn(async () => {
      const initialMix = spatialResolver?.() ?? { gain: 1, pan: 0, distance: 0, inRange: true };
      if (!initialMix.inRange) return;

      this.activeSpatialResolver = spatialResolver ?? null;
      const voice = getEffectiveVoice(villager);

      if (settings.enableOmniTts && omniEngine.isReady()) {
        const player = new StreamingPcmPlayer(
          omniEngine.audioSampleRate,
          () => {
            if (this.activePlayer === player) {
              this.activePlayer = null;
              this.activeSpatialResolver = null;
            }
          },
          initialMix,
          voice,
        );
        this.activePlayer = player;
        try {
          const res = await omniEngine.synthesizeSpeech(
            cleanSpeech,
            {
              voiceStyle: villager.voiceStyle,
              gender: voice.gender,
              language: voice.language,
            },
            (pcm) => {
              player.push(pcm);
            },
          );
          player.end();
          this.lastMetrics.lastOmniLatencyMs = res.durationMs;
          this.log({
            channel: 'lfm3-omni',
            level: 'success',
            title: `TTS (${villager.name} · ${voice.language} ${voice.gender})`,
            detail: `${cleanSpeech} [vol ${Math.round(initialMix.gain * 100)}%, pan ${initialMix.pan.toFixed(2)}, pitch ${voice.pitchSemitones >= 0 ? '+' : ''}${voice.pitchSemitones}st]`,
            durationMs: res.durationMs,
          });
          await player.waitForEnd();
          return;
        } catch (err: any) {
          player.stop();
          if (this.activePlayer === player) {
            this.activePlayer = null;
            this.activeSpatialResolver = null;
          }
          this.log({
            channel: 'lfm3-omni',
            level: 'warn',
            title: 'Omni TTS failed',
            detail: err?.message || String(err),
          });
        }
      }

      if (settings.enableWebSpeechFallback) {
        this.log({
          channel: 'audio',
          level: 'info',
          title: `Web Speech Fallback (${villager.name})`,
          detail: `${cleanSpeech} [vol ${Math.round(initialMix.gain * 100)}%]`,
        });
        await speakWebSpeechAsync(cleanSpeech, initialMix.gain, voice);
      }
    });
  }

  /**
   * Speaks non-conversation narration (scene beats, stage directions, memory
   * reflections) using the Scribe / Narrator voice strictly in turn.
   */
  async speakNarration(
    text: string,
    settings: ModelSettings,
    spatialResolver?: () => SpatialMix,
  ): Promise<void> {
    if (!settings.narratorEnabled) return;
    const clean = text.trim();
    if (!clean) return;
    const narratorCfg = buildNarratorConfig(settings);
    await this.speakLine(clean, narratorCfg, settings, spatialResolver);
  }

  stopSpeech() {
    this.speechEpoch += 1;
    this.activePlayer?.stop();
    this.activePlayer = null;
    this.activeSpatialResolver = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Handle user microphone audio sent to a villager via LFM3-Omni-2B.
   */
  async converseWithVoice(params: {
    villager: VillagerConfig;
    runtime: VillagerRuntime;
    audioBuffer: AudioBuffer;
    settings: ModelSettings;
    onTextChunk?: (chunk: string) => void;
  }): Promise<{ userTranscript: string; replyText: string; durationMs: number }> {
    if (!omniEngine.isReady()) {
      throw new Error('Load LFM3-Omni-2B in the Monitor tab first to use live voice STT + TTS.');
    }

    // 1. Transcribe user audio cleanly for the conversation log
    const stt = await omniEngine.transcribeAudio(params.audioBuffer);
    this.log({
      channel: 'lfm3-omni',
      level: 'info',
      title: 'STT User Speech',
      detail: stt.text || '(inaudible)',
      durationMs: stt.durationMs,
    });

    // 2. Generate villager's interleaved voice + text response strictly in turn
    const voice = getEffectiveVoice(params.villager);
    const systemPrompt = [
      `You are ${params.villager.name}, the ${params.villager.role} in the village of Selo.`,
      params.villager.identity,
      `Speak in ${voice.language} using a ${voice.gender} voice. Style: ${params.villager.voiceStyle}.`,
      `Respond naturally to the visitor in 1 to 2 short spoken sentences. NEVER utter or prefix your own name.`,
    ].join(' ');

    const runReply = async () => {
      const player = params.settings.enableOmniTts
        ? new StreamingPcmPlayer(
            omniEngine.audioSampleRate,
            () => {
              if (this.activePlayer === player) {
                this.activePlayer = null;
              }
            },
            undefined,
            voice,
          )
        : null;
      this.activePlayer = player;

      try {
        const res = await omniEngine.respondMultimodal({
          systemPrompt,
          audio: params.audioBuffer,
          voice: params.settings.enableOmniTts,
          onTextChunk: params.onTextChunk,
          onAudioChunk: (pcm) => player?.push(pcm),
        });
        player?.end();
        if (player) {
          await player.waitForEnd();
        }
        const cleanReply = parseDialogueAndNarration(res.text, params.villager.name).display;
        this.lastMetrics.lastOmniLatencyMs = res.durationMs;
        this.log({
          channel: 'lfm3-omni',
          level: 'success',
          title: `Omni Reply (${params.villager.name})`,
          detail: cleanReply,
          durationMs: res.durationMs,
        });
        return {
          userTranscript: stt.text || '[Voice message]',
          replyText: cleanReply,
          durationMs: res.durationMs,
        };
      } catch (err) {
        player?.stop();
        throw err;
      }
    };

    if (params.settings.enableOmniTts) {
      const turned = await this.enqueueSpeechTurn(runReply);
      if (turned) return turned;
    }
    return runReply();
  }
}

function synthesizeStorySimReply(
  villager: VillagerConfig,
  partnerName: string,
  history: ChatMessage[],
): string {
  const spokenHistory = history.filter((m) => m.kind !== 'narration');
  const last = spokenHistory[spokenHistory.length - 1];
  if (!last) {
    return `Good day, ${partnerName}! I was just about to ${villager.plan.toLowerCase()}`;
  }
  const lower = last.text.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('greetings')) {
    return `Well met, ${partnerName}! As ${villager.role.toLowerCase()}, today I'm focused on ${villager.plan.toLowerCase()}`;
  }
  if (lower.includes('?')) {
    return `That reminds me of something in my work as ${villager.role.toLowerCase()}—every pattern in Selo connects if you watch closely, ${partnerName}.`;
  }
  const templates = [
    `I hear you, ${partnerName}. Even while I ${villager.plan.toLowerCase().replace(/\.$/, '')}, I keep thinking about the village stories.`,
    `True enough, ${partnerName}! Let's cross paths by the square later once I finish my rounds.`,
    `Aye, ${partnerName}, the wind off the hills feels auspicious today—perfect weather for craft and good company.`,
  ];
  return templates[(spokenHistory.length + villager.name.length) % templates.length];
}

export const brainRouter = new BrainRouter();
