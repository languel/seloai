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
    const worldEvents = (runtime.worldFeed ?? [])
      .slice(-4)
      .map((ev) => `- ${ev}`)
      .join('\n');

    const spokenHistory = history.filter((m) => m.kind !== 'narration');
    const latestNarration = [...history].reverse().find((m) => m.kind === 'narration')?.text;
    const turnIdx = spokenHistory.length;
    const sceneTactic =
      turnIdx === 0
        ? `Jump straight into the moment: react to what just happened nearby, tease a suspicion, or ask ${partnerName} something unexpected.`
        : turnIdx === 1
          ? `Counter, question, or complicate what ${partnerName} just said—reveal a subtle detail, doubt, wager, or local rumor.`
          : `Steer the moment toward a decision: make a pact, warn ${partnerName}, change the subject sharply, or commit to what you'll do next.`;

    const systemPrompt = [
      `You are ${villager.name} in the living village of Selo.`,
      `Background subtext (keep implicit—NEVER recite your job title or copy this bio): ${villager.identity}`,
      `Current drive: ${runtime.currentIntention || villager.plan}`,
      memories ? `Personal memories:\n${memories}` : '',
      worldEvents ? `Recent world events & rumors:\n${worldEvents}` : '',
      latestNarration ? `Just unfolded right here: ${latestNarration}` : '',
      `Dramatic direction: ${sceneTactic}`,
      `Respond to ${partnerName} in 1 to 2 crisp, vivid spoken sentences (under 45 words). Vary rhythm and tone—be playful, guarded, superstitious, blunt, or curious as the moment demands.`,
      `Speak ONLY plain dialogue in first person. Always write strictly in natural English regardless of voice accent. NEVER start with or utter your own name (never write "${villager.name}:"), never re-introduce your profession, and avoid stage directions.`,
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
          return { role: 'user' as const, content: `[Dungeon Master Scene]: ${m.text}` };
        }
        return { role: 'user' as const, content: `${m.senderName}: "${m.text}"` };
      }),
    ];

    if (chatMessages.length === 1) {
      chatMessages.push({
        role: 'user',
        content: `Spark an interesting exchange with ${partnerName} right here—react to the atmosphere, a rumor, or something unresolved between you.`,
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

        const accentCue = voice.language.toLowerCase().includes('english')
          ? voice.language
          : `English (with a subtle ${voice.language} cadence/accent, never translating out of English)`;
        const omniMessages = wantVoice
          ? [
              {
                role: 'system' as const,
                content: `Respond with interleaved text and audio. Always write and speak strictly in ${accentCue} using a ${voice.gender} voice.\n${systemPrompt}`,
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

    // Shared fallback chain across WebGPU GGUF/ONNX and local Ollama/LM Studio
    const routed = await this.runTextBrain(chatMessages, settings, {
      maxTokens: 125,
      temperature: 0.74,
      onChunk: params.onChunk,
      logLabel: `${villager.name} → ${partnerName}`,
      sanitizeName: villager.name,
      allowOmniFallback: false,
    });
    if (routed) {
      return routed;
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

  private async runTextBrain(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    settings: ModelSettings,
    opts: {
      maxTokens: number;
      temperature: number;
      onChunk?: (chunk: string) => void;
      logLabel?: string;
      sanitizeName?: string;
      allowOmniFallback?: boolean;
    },
  ): Promise<{ text: string; source: ChatMessage['source']; durationMs: number } | null> {
    if (settings.inferenceMode === 'story-sim') return null;

    if (
      opts.allowOmniFallback &&
      (settings.inferenceMode === 'lfm3-omni-brain' ||
        settings.brainEngine === 'lfm3-omni' ||
        (!this.isTextModelReady() && !minicpmEngine.isReady() && !bonsaiEngine.isReady())) &&
      omniEngine.isReady()
    ) {
      try {
        const res = await omniEngine.generateChatReply({
          messages,
          voice: false,
          maxNewTokens: opts.maxTokens,
          onTextChunk: opts.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, opts.sanitizeName).display;
        this.lastMetrics.lastOmniLatencyMs = res.durationMs;
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.avgTokensPerSec = res.tokensPerSec;
        this.lastMetrics.totalCalls += 1;
        return { text: cleanText, source: 'lfm3-omni', durationMs: res.durationMs };
      } catch (err: any) {
        if (settings.inferenceMode === 'lfm3-omni-brain' || settings.inferenceMode === 'strict-webgpu') {
          throw err;
        }
      }
    }

    if (
      (settings.inferenceMode === 'auto' || settings.inferenceMode === 'strict-webgpu') &&
      settings.brainEngine === 'minicpm5-gguf' &&
      minicpmEngine.isReady()
    ) {
      try {
        const res = await minicpmEngine.generateText(messages, {
          maxNewTokens: opts.maxTokens,
          onChunk: opts.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, opts.sanitizeName).display;
        this.lastMetrics.avgTokensPerSec = res.tokensPerSec;
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.totalCalls += 1;
        if (opts.logLabel) {
          this.log({
            channel: 'lfm3-1.7b',
            level: 'success',
            title: `${opts.logLabel} (MiniCPM5-2B)`,
            detail: cleanText,
            durationMs: res.durationMs,
            tokensPerSec: res.tokensPerSec,
          });
        }
        return { text: cleanText, source: 'minicpm5', durationMs: res.durationMs };
      } catch (err: any) {
        if (settings.inferenceMode === 'strict-webgpu') throw err;
      }
    }

    if (
      (settings.inferenceMode === 'auto' || settings.inferenceMode === 'strict-webgpu') &&
      settings.brainEngine === 'bonsai2-gguf' &&
      bonsaiEngine.isReady()
    ) {
      try {
        const res = await bonsaiEngine.generateText(messages, {
          maxNewTokens: opts.maxTokens,
          onChunk: opts.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, opts.sanitizeName).display;
        this.lastMetrics.avgTokensPerSec = res.tokensPerSec;
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.totalCalls += 1;
        if (opts.logLabel) {
          this.log({
            channel: 'lfm3-1.7b',
            level: 'success',
            title: `${opts.logLabel} (Bonsai-2 27B)`,
            detail: cleanText,
            durationMs: res.durationMs,
            tokensPerSec: res.tokensPerSec,
          });
        }
        return { text: cleanText, source: 'bonsai2', durationMs: res.durationMs };
      } catch (err: any) {
        if (settings.inferenceMode === 'strict-webgpu') throw err;
      }
    }

    if (
      (settings.inferenceMode === 'auto' || settings.inferenceMode === 'strict-webgpu') &&
      this.isTextModelReady()
    ) {
      try {
        const res = await this.generateText(messages, {
          maxNewTokens: opts.maxTokens,
          temperature: opts.temperature,
          onChunk: opts.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, opts.sanitizeName).display;
        const source: ChatMessage['source'] = settings.textModelId.toLowerCase().includes('lfm3')
          ? 'lfm3-1.7b'
          : 'webgpu-onnx';
        this.lastMetrics.avgTokensPerSec = res.tokensPerSec;
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.totalCalls += 1;
        if (opts.logLabel) {
          this.log({
            channel: 'lfm3-1.7b',
            level: 'success',
            title: opts.logLabel,
            detail: cleanText,
            durationMs: res.durationMs,
            tokensPerSec: res.tokensPerSec,
          });
        }
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

    const useLocalApi =
      settings.inferenceMode === 'local-api' ||
      (settings.inferenceMode === 'auto' && settings.localApiEnabled && Boolean(settings.localApiUrl.trim()));

    if (useLocalApi && settings.localApiModel.trim()) {
      try {
        const res = await chatWithLocalApi({
          baseUrl: settings.localApiUrl,
          model: settings.localApiModel.trim(),
          messages,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          onChunk: opts.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, opts.sanitizeName).display;
        const src: ChatMessage['source'] =
          settings.localApiProvider === 'lmstudio' ? 'lmstudio' : 'ollama';
        this.lastMetrics.lastTextLatencyMs = res.durationMs;
        this.lastMetrics.totalCalls += 1;
        if (opts.logLabel) {
          this.log({
            channel: 'local-api',
            level: 'success',
            title: `${opts.logLabel} (${src})`,
            detail: cleanText,
            durationMs: res.durationMs,
          });
        }
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

    return null;
  }

  /**
   * Direct response when the user addresses @Scribe / @Narrator.
   */
  async generateNarratorReply(params: {
    prompt: string;
    sceneContext: string;
    history: ChatMessage[];
    settings: ModelSettings;
    onChunk?: (chunk: string) => void;
  }): Promise<{ text: string; source: ChatMessage['source']; durationMs: number }> {
    const narratorName = params.settings.narratorName.trim() || 'Scribe';
    const toneHint =
      params.settings.narratorStyle === 'dungeon-master'
        ? 'inventive, suspenseful Dungeon Master crafting sensory atmosphere, subtle omens, hidden stakes, and dramatic character sparks'
        : params.settings.narratorStyle === 'chronicler'
          ? 'sharp folklore chronicler noting telling gestures, quiet rivalries, and shifting village omens'
          : 'evocative fireside storyteller revealing unseen details, mood shifts, and folklore undercurrents';

    const msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: [
          `You are ${narratorName}, the creative Dungeon Master and unseen chronicler shaping the living story of Selo.`,
          `Write 1 to 3 evocative third-person sentences (under 60 words) in the voice of a ${toneHint}.`,
          `Rules: NEVER parrot job titles or list coordinates like a status report. NEVER say generic filler like "they step close to speak". Introduce concrete sensory detail, a small complication, rumor, omen, or hidden motive that gives the villagers something rich to react to.`,
          `Never prefix your own name like "${narratorName}:" or break character. Always write strictly in English.`,
          params.sceneContext ? `Living village pulse:\n${params.sceneContext}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      ...params.history.slice(-4).map((m) => ({
        role: (m.senderId === 'narrator' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.senderId === 'narrator' ? m.text : `${m.senderName}: ${m.text}`,
      })),
      { role: 'user', content: params.prompt },
    ];

    try {
      const routed = await this.runTextBrain(msgs, params.settings, {
        maxTokens: 125,
        temperature: 0.78,
        onChunk: params.onChunk,
        logLabel: `DM (${narratorName})`,
        sanitizeName: narratorName,
        allowOmniFallback: true,
      });
      if (routed) return routed;
    } catch (err) {
      if (params.settings.inferenceMode === 'strict-webgpu' || params.settings.inferenceMode === 'local-api') {
        throw err;
      }
    }

    const started = performance.now();
    await new Promise((r) => setTimeout(r, 90));
    const reply = synthesizeStorySimNarration(params.prompt, params.sceneContext, params.settings);
    const durationMs = Math.round(performance.now() - started);
    this.log({
      channel: 'sim',
      level: 'info',
      title: `DM (${narratorName} · Story Sim)`,
      detail: reply,
      durationMs,
    });
    return { text: reply, source: 'story-sim', durationMs };
  }

  /**
   * Creative Dungeon Master scene framing for autonomous encounters (opening catalyst & closing consequence).
   */
  async generateSceneBeat(params: {
    phase: 'opening' | 'closing';
    villagerA: VillagerConfig;
    runtimeA: VillagerRuntime;
    villagerB: VillagerConfig;
    runtimeB: VillagerRuntime;
    landmarkName: string;
    history?: ChatMessage[];
    settings: ModelSettings;
  }): Promise<string> {
    const narratorName = params.settings.narratorName.trim() || 'Scribe';
    const hasActiveWebGpu =
      omniEngine.isReady() ||
      minicpmEngine.isReady() ||
      bonsaiEngine.isReady() ||
      this.isTextModelReady();

    if (
      params.settings.inferenceMode !== 'story-sim' &&
      (hasActiveWebGpu || params.settings.inferenceMode === 'local-api')
    ) {
      const snippet = (params.history ?? [])
        .filter((m) => m.kind !== 'narration')
        .slice(-2)
        .map((m) => `${m.senderName}: "${m.text}"`)
        .join(' ');
      const contextNotes = [
        `Setting: near ${params.landmarkName} in Selo`,
        `${params.villagerA.name}'s current drive: ${params.runtimeA.currentIntention || params.villagerA.plan}`,
        `${params.villagerB.name}'s current drive: ${params.runtimeB.currentIntention || params.villagerB.plan}`,
        snippet ? `What just passed between them: ${snippet}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const taskInstruction =
        params.phase === 'opening'
          ? `Set a compelling 1-to-2 sentence Dungeon Master opening beat as ${params.villagerA.name} and ${params.villagerB.name} encounter one another. Give them a sensory omen, strange object, tension, or rumor to react to right now.`
          : `Deliver a 1-sentence Dungeon Master consequence or lingering cliffhanger after that exchange—hinting at what changed or stirs next.`;

      try {
        const routed = await this.runTextBrain(
          [
            {
              role: 'system',
              content: [
                `You are ${narratorName}, creative Dungeon Master of Selo (${params.settings.narratorStyle} style).`,
                `Write crisp third-person English prose under 40 words.`,
                `FORBIDDEN clichés: NEVER list job titles like "the rushnyk weaver", NEVER say "steps close to speak", and NEVER say "part ways, carrying their thoughts".`,
              ].join('\n'),
            },
            { role: 'user', content: `${contextNotes}\n\n${taskInstruction}` },
          ],
          params.settings,
          { maxTokens: 80, temperature: 0.8, sanitizeName: narratorName, allowOmniFallback: true },
        );
        if (routed?.text) return routed.text;
      } catch {
        // Fall through to expressive DM story-sim synthesizer
      }
    }

    return synthesizeDungeonMasterBeat(params);
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
    try {
      const routed = await this.runTextBrain(msgs, params.settings, {
        maxTokens: 55,
        temperature: 0.25,
        allowOmniFallback: true,
      });
      if (routed?.text) return routed.text;
    } catch {
      // fall through
    }
    const snippet = params.transcript.split('\n').slice(-1)[0] || '';
    return `Spoke with a neighbor: ${snippet.slice(0, 72)}`;
  }

  /**
   * Westworld-style World->NPC motivation step: reads the character's ongoing
   * world session (identity, memories, perceptions) and chooses who to seek out
   * or where to go next. Uses an active LLM when ready, or instant story-driven
   * selection so idle pacing stays responsive.
   */
  async decideVillagerNextAction(params: {
    villager: VillagerConfig;
    runtime: VillagerRuntime;
    otherNames: string[];
    landmarkNames: string[];
    settings: ModelSettings;
  }): Promise<{ action: 'talk' | 'visit' | 'explore'; targetName?: string; motive: string }> {
    const { villager, runtime, otherNames, landmarkNames, settings } = params;
    const hasActiveWebGpu =
      omniEngine.isReady() ||
      minicpmEngine.isReady() ||
      bonsaiEngine.isReady() ||
      this.isTextModelReady();

    if (
      settings.inferenceMode !== 'story-sim' &&
      (hasActiveWebGpu || settings.inferenceMode === 'local-api')
    ) {
      const worldContext = [
        `Neighbors in Selo: ${otherNames.join(', ') || 'none'}`,
        `Landmarks: ${landmarkNames.join(', ') || 'Village Square'}`,
        `Current plan: ${runtime.currentIntention || villager.plan}`,
        runtime.memories.length
          ? `Latest memory: ${runtime.memories[runtime.memories.length - 1].summary}`
          : '',
        runtime.worldFeed?.length
          ? `Recent world updates:\n${runtime.worldFeed.slice(-3).map((x) => `- ${x}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      try {
        const routed = await this.runTextBrain(
          [
            {
              role: 'system',
              content: [
                `You are the inner restlessness of ${villager.name}. Keep your role implicit.`,
                `Pick a surprising or story-worthy next move driven by curiosity, a hunch, rivalry, unfinished business, or a recent rumor—avoid dull routine chore wording.`,
                `Reply in ONE line using this exact format:`,
                `ACTION: talk:<NeighborName> OR visit:<LandmarkName> | MOTIVE: <6 to 12 word dramatic motive>`,
              ].join('\n'),
            },
            { role: 'user', content: worldContext },
          ],
          settings,
          { maxTokens: 48, temperature: 0.78, allowOmniFallback: true },
        );

        if (routed?.text) {
          const line = routed.text.trim();
          const talkMatch = line.match(/talk\s*:\s*([^|\n]+)/i);
          const visitMatch = line.match(/visit\s*:\s*([^|\n]+)/i);
          const motiveMatch = line.match(/motive\s*:\s*(.+)$/i);
          const motive =
            (motiveMatch?.[1] ?? villager.plan).replace(/^["']|["']$/g, '').trim().slice(0, 90);
          if (talkMatch?.[1]) {
            const name = otherNames.find((n) =>
              talkMatch[1].toLowerCase().includes(n.toLowerCase()),
            );
            if (name) return { action: 'talk', targetName: name, motive };
          }
          if (visitMatch?.[1]) {
            const lm = landmarkNames.find((l) =>
              visitMatch[1].toLowerCase().includes(l.toLowerCase()),
            );
            if (lm) return { action: 'visit', targetName: lm, motive };
          }
          if (motive) return { action: 'explore', motive };
        }
      } catch {
        // Fall through to deterministic story motivation
      }
    }

    // Emergent story-driven fallback motives (curiosity, hunches, rumors)
    if (otherNames.length > 0 && Math.random() < 0.65) {
      const targetName = otherNames[Math.floor(Math.random() * otherNames.length)];
      const socialMotives = [
        `Testing a strange rumor with ${targetName} before dusk`,
        `Asking ${targetName} who left the unmarked parcel by the square`,
        `Settling an old wager with ${targetName}`,
        `Catching ${targetName} alone to swap news nobody else heard`,
      ];
      return {
        action: 'talk',
        targetName,
        motive: socialMotives[Math.floor(Math.random() * socialMotives.length)],
      };
    }
    if (landmarkNames.length > 0 && Math.random() < 0.68) {
      const targetName = landmarkNames[Math.floor(Math.random() * landmarkNames.length)];
      const placeMotives = [
        `Checking odd lantern reflections around ${targetName}`,
        `Following fresh footprints along ${targetName}`,
        `Listening for rumors drifting past ${targetName}`,
        `Searching ${targetName} for what vanished earlier`,
      ];
      return {
        action: 'visit',
        targetName,
        motive: placeMotives[Math.floor(Math.random() * placeMotives.length)],
      };
    }
    const wanderMotives = [
      `Watching the wind shift over Selo rooftops`,
      `Tracing a hunch nobody else seems to notice`,
      `Loitering near the lane to see who slips past next`,
    ];
    return {
      action: 'explore',
      motive: wanderMotives[Math.floor(Math.random() * wanderMotives.length)],
    };
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
    const accentCue = voice.language.toLowerCase().includes('english')
      ? voice.language
      : `English (with a subtle ${voice.language} accent, never switching written or spoken language away from English)`;
    const systemPrompt = [
      `You are ${params.villager.name}, the ${params.villager.role} in the village of Selo.`,
      params.villager.identity,
      `Always respond and speak strictly in ${accentCue} using a ${voice.gender} voice. Style: ${params.villager.voiceStyle}.`,
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

let dmBeatCursor = 0;

const DM_ENCOUNTER_OPENINGS = [
  (a: string, b: string, place: string) =>
    `A brass key tumbles from a roof eaves gutter near ${place}, chiming sharply between ${a} and ${b} as both stop short.`,
  (a: string, b: string, place: string) =>
    `Woodsmoke curls sideways across ${place}, carrying the sting of cedar pitch; ${a} spots something folded inside ${b}'s sleeve.`,
  (a: string, b: string, place: string) =>
    `For three heartbeats the distant millwheel stops creaking above ${place}, and in that sudden hush ${a} locks eyes with ${b}.`,
  (a: string, b: string, place: string) =>
    `Someone has chalked an unfamiliar tally mark onto the stones beside ${place}; ${a} arrives just as ${b} kneels to inspect it.`,
  (a: string, b: string, place: string) =>
    `A stray gust scatters dried marigold petals past ${place}, catching ${a} mid-stride while ${b} tries to hide a half-sealed note.`,
  (a: string, b: string, place: string) =>
    `Frogs along the creek bank fall dead silent near ${place}, drawing a sharp glance between ${a} and ${b} before either speaks.`,
];

const DM_ENCOUNTER_CLOSINGS = [
  (a: string, b: string, place: string) =>
    `${a} glances toward the shadows beyond ${place}, leaving ${b} with more questions than answers as the breeze picks up again.`,
  (a: string, b: string, place: string) =>
    `With a wry look neither will quite forget, ${a} pockets an unspoken pact while ${b} turns back toward ${place}.`,
  (a: string, b: string, place: string) =>
    `Just beyond ${place}, a shutter clicks softly shut—proof someone else caught the tail end of what ${a} and ${b} traded.`,
  (a: string, b: string, place: string) =>
    `The tension loosens by a single degree, though ${a} and ${b} both know the rumor around ${place} is only half-buried.`,
];

function synthesizeDungeonMasterBeat(params: {
  phase: 'opening' | 'closing';
  villagerA: VillagerConfig;
  runtimeA: VillagerRuntime;
  villagerB: VillagerConfig;
  runtimeB: VillagerRuntime;
  landmarkName: string;
}): string {
  const { phase, villagerA, villagerB, landmarkName } = params;
  const idx = dmBeatCursor++;
  if (phase === 'opening') {
    return DM_ENCOUNTER_OPENINGS[idx % DM_ENCOUNTER_OPENINGS.length](
      villagerA.name,
      villagerB.name,
      landmarkName,
    );
  }
  return DM_ENCOUNTER_CLOSINGS[idx % DM_ENCOUNTER_CLOSINGS.length](
    villagerA.name,
    villagerB.name,
    landmarkName,
  );
}

function synthesizeStorySimReply(
  villager: VillagerConfig,
  partnerName: string,
  history: ChatMessage[],
): string {
  const spokenHistory = history.filter((m) => m.kind !== 'narration');
  const dmBeat = [...history].reverse().find((m) => m.kind === 'narration')?.text.toLowerCase() ?? '';
  const last = spokenHistory[spokenHistory.length - 1];
  const turn = spokenHistory.length;

  // React directly to concrete DM scene hooks when opening
  if (!last) {
    if (dmBeat.includes('key')) {
      return `Hold on, ${partnerName}—did that brass key just drop out of nowhere, or did somebody leave it on purpose?`;
    }
    if (dmBeat.includes('tally') || dmBeat.includes('chalk')) {
      return `Tell me honestly, ${partnerName}: did you draw that mark on the stone, or is someone keeping score on us?`;
    }
    if (dmBeat.includes('note') || dmBeat.includes('sleeve')) {
      return `Don't tuck that folded paper away on my account, ${partnerName}. Who sent word without signing it?`;
    }
    if (dmBeat.includes('millwheel') || dmBeat.includes('hush') || dmBeat.includes('silent')) {
      return `Did you hear everything go dead quiet just now, ${partnerName}? Even the birds stopped mid-note.`;
    }
    if (dmBeat.includes('pitch') || dmBeat.includes('smoke')) {
      return `That's juniper smoke, not ordinary hearth pine—someone down the lane is burning something they shouldn't be, ${partnerName}.`;
    }
    return `You look like you've been dodging half the village since morning, ${partnerName}. What are you actually up to?`;
  }

  const lower = last.text.toLowerCase();
  if (lower.includes('key') || lower.includes('lock') || lower.includes('box')) {
    return `If it fits the old cellar latch by the mill, we're not telling a soul until nightfall—agreed, ${partnerName}?`;
  }
  if (lower.includes('mark') || lower.includes('rumor') || lower.includes('note') || lower.includes('secret')) {
    return `Keep your voice down, ${partnerName}. Half of Selo pretends not to watch the lanes, yet every door has ears.`;
  }
  if (lower.includes('?')) {
    const reactions = [
      `I wouldn't bet coin on the harmless answer, ${partnerName}—look closely at who's been hanging near the square since dawn.`,
      `Maybe, though I swear somebody shifted the lantern posts last night when the fog rolled in.`,
      `Ask me again after sunset, ${partnerName}. Right now I'd rather see what turns up first.`,
    ];
    return reactions[(turn + villager.name.length) % reactions.length];
  }

  const dynamicMoves = [
    `Wait—say that last part again, ${partnerName}. Because if that's true, someone lied at the fire last night.`,
    `You don't fool me for a second, ${partnerName}, though I'll play along if you watch my back near the river.`,
    `Make me a wager then: by dusk we'll know who stirred up that dust behind the windmill.`,
    `Fair enough, ${partnerName}. Meet me past the hearth before everyone else wakes up—I want a straight answer next time.`,
  ];
  return dynamicMoves[(turn + villager.name.charCodeAt(0)) % dynamicMoves.length];
}

let dmNarrationCursor = 0;

function synthesizeStorySimNarration(
  prompt: string,
  sceneContext: string,
  settings: ModelSettings,
): string {
  const cleanPrompt = prompt.replace(/@[\p{L}\p{N}_-]+/gu, '').trim();
  const lines = sceneContext.split('\n').filter(Boolean);
  const sampleActor =
    lines.length > 0 ? lines[dmNarrationCursor % lines.length].replace(/^- /, '').split(' near ')[0] : 'Someone';
  dmNarrationCursor += 1;

  if (/secret|rumor|trouble|happen|what|describe|look|scene/i.test(cleanPrompt)) {
    const twists = [
      `Under calm eaves, a loose shutter rattles without wind while ${sampleActor} lingers too long over an ordinary errand—as if waiting for a signal.`,
      `Lantern oil smells sharp along the cobbles; behind polite small talk, an unspoken bargain hangs in the air like storm static.`,
      `Fresh mud prints skirt the well without reaching any doorway, while ${sampleActor} tracks every footstep out of the corner of an eye.`,
    ];
    return twists[dmNarrationCursor % twists.length];
  }

  if (settings.narratorStyle === 'chronicler') {
    return cleanPrompt
      ? `A sudden turn in the tale ripples past Selo's fences: "${cleanPrompt.slice(0, 72)}" sets watchful glances darting down the lane.`
      : `Even quiet afternoons in Selo carry hidden tallies; two shadows cross paths just out of earshot of the hearth.`;
  }
  if (settings.narratorStyle === 'storybook') {
    return cleanPrompt
      ? `The wind turns at the prompt of "${cleanPrompt.slice(0, 68)}"—bells murmur in the rafters, nudging old truths to the surface.`
      : `Twilight brushes copper across the roofs, and a faint whistle drifts up from the creek where no boat is moored.`;
  }
  return cleanPrompt
    ? `At those words—"${cleanPrompt.slice(0, 70)}"—the village air tightens with intrigue; loose floorboards creak and motives tilt in unexpected directions.`
    : `A distant raven drops a tarnished coin onto the cobbles, daring someone nearby to claim it first.`;
}

export const brainRouter = new BrainRouter();
