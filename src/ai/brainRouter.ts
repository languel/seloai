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
import { chatWithExternalApi, synthesizeSpeechViaApi } from './localApiClient';
import {
  StreamingPcmPlayer,
  cancelActiveWebSpeech,
  speakWebSpeechAsync,
  type SpatialMix,
} from './audioPipeline';

export interface ParsedDialogue {
  spoken: string;
  narration: string[];
  thoughts: string[];
  reasoning: string[];
  display: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Detects whether a candidate motive, narration beat, or spoken line is a near-duplicate
 * of recent text so LLM/story-sim characters cannot get stuck repeating the same phrase.
 */
export function isTextTooSimilar(
  candidate: string,
  recentList: string[],
  threshold = 0.55,
): boolean {
  const cleanCand = candidate.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleanCand) return false;
  const candTokens = normalizeTokens(cleanCand);
  const candSet = new Set(candTokens);

  for (const prevRaw of recentList) {
    const prev = prevRaw?.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!prev) continue;
    if (cleanCand === prev) return true;
    if (cleanCand.length >= 16 && prev.length >= 16 && (prev.includes(cleanCand) || cleanCand.includes(prev))) {
      return true;
    }
    const prevTokens = normalizeTokens(prev);
    if (candTokens.length === 0 || prevTokens.length === 0) continue;
    const prevSet = new Set(prevTokens);
    let intersection = 0;
    for (const t of candSet) {
      if (prevSet.has(t)) intersection++;
    }
    const union = candSet.size + prevSet.size - intersection;
    if (union > 0 && intersection / union >= threshold) {
      return true;
    }
    // Catch repeated 3+ word lead-in stems like "chase the brass key..."
    if (
      candTokens.length >= 4 &&
      prevTokens.length >= 4 &&
      candTokens.slice(0, 3).join(' ') === prevTokens.slice(0, 3).join(' ')
    ) {
      return true;
    }
  }
  return false;
}

function pushRing(arr: string[] | undefined, value: string, max = 6): string[] {
  const clean = value.trim();
  if (!clean) return arr ?? [];
  const next = [...(arr ?? []), clean];
  return next.slice(-max);
}

function pickFreshCandidate(candidates: string[], avoid: string[], cursorSeed = 0): string {
  if (candidates.length === 0) return '';
  const start = Math.abs(cursorSeed) % candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[(start + i) % candidates.length]!;
    if (!isTextTooSimilar(c, avoid, 0.52)) return c;
  }
  return candidates[start]!;
}

/**
 * Separates LLM meta <think>...</think> reasoning, optional <thought>...</thought>
 * inner monologue, inline narrative actions (*looks out*, [waves]), and pure
 * spoken dialogue without accidental self-name prefixes ("Olena: Hello").
 */
export function parseDialogueAndNarration(
  rawText: string,
  speakerName?: string,
): ParsedDialogue {
  const reasoning: string[] = [];
  const thoughts: string[] = [];

  let cleaned = (rawText ?? '')
    .replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, (_full, body) => {
      const trace = String(body ?? '').trim();
      if (trace) reasoning.push(trace);
      return '';
    })
    .replace(/<thought>([\s\S]*?)(?:<\/thought>|$)/gi, (_full, body) => {
      const inner = String(body ?? '').trim();
      if (inner) thoughts.push(inner);
      return '';
    })
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
    .trim()
    .replace(prefixRegex, '')
    .trim();

  return {
    spoken,
    narration,
    thoughts,
    reasoning,
    display: spoken || narration.join(' ') || thoughts.join(' ') || cleaned,
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
  public activeSpeechInfo: {
    speakerId: string;
    speakerName: string;
    text: string;
    engine: 'omni' | 'api-tts' | 'webspeech';
    startedAt: number;
  } | null = null;
  private speechListeners = new Set<(info: BrainRouter['activeSpeechInfo']) => void>();

  subscribeSpeechState(fn: (info: BrainRouter['activeSpeechInfo']) => void): () => void {
    this.speechListeners.add(fn);
    fn(this.activeSpeechInfo);
    return () => this.speechListeners.delete(fn);
  }

  private setActiveSpeech(info: BrainRouter['activeSpeechInfo']) {
    this.activeSpeechInfo = info;
    for (const fn of this.speechListeners) fn(info);
  }
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
    const recentSelfLines = [
      ...spokenHistory.filter((m) => m.senderId === villager.id).map((m) => m.text),
      ...(runtime.recentUtterances ?? []),
    ].slice(-6);
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
      recentSelfLines.length
        ? `Already said recently (NEVER repeat, rephrase, or harp on these lines/objects again):\n${recentSelfLines.slice(-3).map((l) => `- ${l}`).join('\n')}`
        : '',
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

    // 1. LFM3-Omni-2B as All-in-One Village Brain (first-choice when selected or when it's the only WebGPU model loaded)
    const preferOmniBrain =
      settings.inferenceMode === 'lfm3-omni-brain' ||
      ((settings.inferenceMode === 'auto' || settings.inferenceMode === 'strict-webgpu') &&
        settings.brainEngine === 'lfm3-omni') ||
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
        if (omniResult) {
          if (isTextTooSimilar(omniResult.text, recentSelfLines, 0.58)) {
            const fresh = synthesizeStorySimReply(villager, partnerName, history, recentSelfLines);
            runtime.recentUtterances = pushRing(runtime.recentUtterances, fresh);
            return { ...omniResult, text: fresh };
          }
          runtime.recentUtterances = pushRing(runtime.recentUtterances, omniResult.text);
          return omniResult;
        }
      } else if (
        settings.inferenceMode === 'lfm3-omni-brain' ||
        (settings.inferenceMode === 'strict-webgpu' && settings.brainEngine === 'lfm3-omni')
      ) {
        throw new Error('LFM3-Omni Brain mode selected, but LFM3-Omni-2B is not loaded yet.');
      }
    }

    // Shared fallback chain across WebGPU GGUF/ONNX and local Ollama/LM Studio
    let routed = await this.runTextBrain(chatMessages, settings, {
      maxTokens: 125,
      temperature: 0.78,
      onChunk: params.onChunk,
      logLabel: `${villager.name} → ${partnerName}`,
      sanitizeName: villager.name,
      allowOmniFallback: false,
    });
    if (routed) {
      if (isTextTooSimilar(routed.text, recentSelfLines, 0.58)) {
        const retryMessages = [
          ...chatMessages,
          {
            role: 'user' as const,
            content: `STOP repeating yourself. You already said "${routed.text}". Pivot immediately to a completely new observation, question, or next step with ${partnerName} in under 35 words.`,
          },
        ];
        const retry = await this.runTextBrain(retryMessages, settings, {
          maxTokens: 125,
          temperature: 0.92,
          logLabel: `${villager.name} → ${partnerName} (Pivot)`,
          sanitizeName: villager.name,
          allowOmniFallback: false,
        }).catch(() => null);
        if (retry && !isTextTooSimilar(retry.text, recentSelfLines, 0.58)) {
          routed = retry;
        } else {
          const fresh = synthesizeStorySimReply(villager, partnerName, history, recentSelfLines);
          runtime.recentUtterances = pushRing(runtime.recentUtterances, fresh);
          return { ...routed, text: fresh };
        }
      }
      runtime.recentUtterances = pushRing(runtime.recentUtterances, routed.text);
      return routed;
    }

    // Story-Sim deterministic persona fallback (instant, zero VRAM)
    const started = performance.now();
    await new Promise((r) => setTimeout(r, 180));
    const reply = synthesizeStorySimReply(villager, partnerName, history, recentSelfLines);
    runtime.recentUtterances = pushRing(runtime.recentUtterances, reply);
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
      opts.allowOmniFallback !== false &&
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
        if (opts.logLabel) {
          this.log({
            channel: 'lfm3-omni',
            level: 'success',
            title: `${opts.logLabel} (Omni Brain)`,
            detail: cleanText,
            durationMs: res.durationMs,
            tokensPerSec: res.tokensPerSec,
          });
        }
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
      const provider = settings.localApiProvider ?? 'ollama';
      try {
        const res = await chatWithExternalApi({
          provider,
          baseUrl: settings.localApiUrl,
          model: settings.localApiModel.trim(),
          apiKey: settings.localApiKey,
          messages,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          onChunk: opts.onChunk,
        });
        const cleanText = parseDialogueAndNarration(res.text, opts.sanitizeName).display;
        const sourceMap: Record<string, ChatMessage['source']> = {
          ollama: 'ollama',
          lmstudio: 'lmstudio',
          openai: 'openai',
          anthropic: 'anthropic',
          gemini: 'gemini',
          github: 'github',
          openrouter: 'openrouter',
          custom: 'custom-api',
        };
        const src: ChatMessage['source'] = sourceMap[provider] ?? 'custom-api';
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
          title: `${provider.toUpperCase()} API unavailable`,
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
          `You are ${narratorName}, the unseen storyteller weaving the nearby narrative text and local situation of Selo into a living story.`,
          `Write 1 to 3 evocative third-person sentences (under 65 words) in the voice of a ${toneHint}.`,
          `Default focus: stay grounded in the focal location, nearby characters, and the recent nearby narrative flow—unless the user explicitly instructs you to zoom out, look elsewhere, or shift scenes.`,
          `Rules: NEVER output <think> tags or meta-commentary. NEVER parrot job titles, dump coordinates, or use filler like "they step close to speak". Weave sensory atmosphere, unspoken tension, or story momentum directly from what is unfolding nearby.`,
          `Never prefix your own name like "${narratorName}:" or break character. Always write strictly in English.`,
          params.sceneContext ? `Nearby context & narrative flow:\n${params.sceneContext}` : '',
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
      const recentAvoidNote = recentDmBeats.length
        ? `Recent scene hooks already used (DO NOT repeat these props or motifs): ${recentDmBeats.slice(-4).join(' | ')}`
        : '';

      const contextNotes = [
        `Setting: near ${params.landmarkName} in Selo`,
        `${params.villagerA.name}'s current drive: ${params.runtimeA.currentIntention || params.villagerA.plan}`,
        `${params.villagerB.name}'s current drive: ${params.runtimeB.currentIntention || params.villagerB.plan}`,
        recentAvoidNote,
        snippet ? `What just passed between them: ${snippet}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const taskInstruction =
        params.phase === 'opening'
          ? `Set a compelling 1-to-2 sentence Dungeon Master opening beat as ${params.villagerA.name} and ${params.villagerB.name} encounter one another. Give them a fresh sensory detail, changing weather, overheard remark, or unresolved tension—NEVER recycle previous props like a brass key if already used.`
          : `Deliver a 1-sentence Dungeon Master consequence or lingering cliffhanger after that exchange—hinting at what changed or stirs next.`;

      try {
        const routed = await this.runTextBrain(
          [
            {
              role: 'system',
              content: [
                `You are ${narratorName}, creative Dungeon Master of Selo (${params.settings.narratorStyle} style).`,
                `Write crisp third-person English prose under 40 words.`,
                `FORBIDDEN clichés: NEVER list job titles like "the tapestry weaver", NEVER say "steps close to speak", NEVER say "part ways, carrying their thoughts", and NEVER repeat a recently used omen/prop.`,
              ].join('\n'),
            },
            { role: 'user', content: `${contextNotes}\n\n${taskInstruction}` },
          ],
          params.settings,
          { maxTokens: 80, temperature: 0.88, sanitizeName: narratorName, allowOmniFallback: true },
        );
        if (routed?.text && !isTextTooSimilar(routed.text, recentDmBeats, 0.5)) {
          recentDmBeats.push(routed.text);
          if (recentDmBeats.length > 8) recentDmBeats.shift();
          return routed.text;
        }
      } catch {
        // Fall through to expressive DM story-sim synthesizer
      }
    }

    const beat = synthesizeDungeonMasterBeat(params);
    recentDmBeats.push(beat);
    if (recentDmBeats.length > 8) recentDmBeats.shift();
    return beat;
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
    const avoidMotives = [
      ...(runtime.recentMotives ?? []),
      ...(runtime.worldFeed ?? []).slice(-4),
      runtime.currentIntention ?? '',
    ].filter(Boolean);
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
        avoidMotives.length
          ? `Already pursued recently (DO NOT repeat, rephrase, or continue chasing the exact same object—advance to a new thread or resolution):\n${avoidMotives.slice(-4).map((m) => `- ${m}`).join('\n')}`
          : `Opening plan: ${villager.plan}`,
        runtime.memories.length
          ? `Latest memory: ${runtime.memories[runtime.memories.length - 1].summary}`
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
                `Pick a genuinely NEW next move—pivot topics, test a different neighbor, settle a matter, or explore a new corner. NEVER repeat any motive listed under "Already pursued recently".`,
                `Reply in ONE line using this exact format:`,
                `ACTION: talk:<NeighborName> OR visit:<LandmarkName> | MOTIVE: <6 to 12 word dramatic motive>`,
              ].join('\n'),
            },
            { role: 'user', content: worldContext },
          ],
          settings,
          { maxTokens: 52, temperature: 0.88, allowOmniFallback: true },
        );

        if (routed?.text) {
          const line = routed.text.trim();
          const talkMatch = line.match(/talk\s*:\s*([^|\n]+)/i);
          const visitMatch = line.match(/visit\s*:\s*([^|\n]+)/i);
          const motiveMatch = line.match(/motive\s*:\s*(.+)$/i);
          const candidateMotive =
            (motiveMatch?.[1] ?? '').replace(/^["']|["']$/g, '').trim().slice(0, 90);
          const motiveIsFresh =
            Boolean(candidateMotive) && !isTextTooSimilar(candidateMotive, avoidMotives, 0.5);

          if (talkMatch?.[1]) {
            const name = otherNames.find((n) =>
              talkMatch[1].toLowerCase().includes(n.toLowerCase()),
            );
            if (name && motiveIsFresh) {
              runtime.recentMotives = pushRing(runtime.recentMotives, candidateMotive);
              return { action: 'talk', targetName: name, motive: candidateMotive };
            }
          }
          if (visitMatch?.[1]) {
            const lm = landmarkNames.find((l) =>
              visitMatch[1].toLowerCase().includes(l.toLowerCase()),
            );
            if (lm && motiveIsFresh) {
              runtime.recentMotives = pushRing(runtime.recentMotives, candidateMotive);
              return { action: 'visit', targetName: lm, motive: candidateMotive };
            }
          }
          if (motiveIsFresh) {
            runtime.recentMotives = pushRing(runtime.recentMotives, candidateMotive);
            return { action: 'explore', motive: candidateMotive };
          }
        }
      } catch {
        // Fall through to deterministic story motivation
      }
    }

    // Emergent story-driven fallback motives (curiosity, hunches, rumors), filtered against recent loops
    const seed = Date.now() + villager.name.charCodeAt(0) + (runtime.recentMotives?.length ?? 0);
    if (otherNames.length > 0 && Math.random() < 0.65) {
      const targetName = otherNames[Math.floor(Math.random() * otherNames.length)];
      const socialMotives = [
        `Testing a new theory with ${targetName} before dusk`,
        `Asking ${targetName} what shifted near the outer gate`,
        `Settling an unspoken disagreement with ${targetName}`,
        `Comparing notes with ${targetName} after the latest tremor`,
        `Checking whether ${targetName} noticed someone slipping past early`,
        `Proposing a quiet pact to ${targetName} near the square`,
      ];
      const motive = pickFreshCandidate(socialMotives, avoidMotives, seed);
      runtime.recentMotives = pushRing(runtime.recentMotives, motive);
      return { action: 'talk', targetName, motive };
    }
    if (landmarkNames.length > 0 && Math.random() < 0.68) {
      const targetName = landmarkNames[Math.floor(Math.random() * landmarkNames.length)];
      const placeMotives = [
        `Checking odd lantern reflections around ${targetName}`,
        `Following fresh footprints leading past ${targetName}`,
        `Listening for rumors drifting through ${targetName}`,
        `Inspecting the stone markers around ${targetName}`,
        `Watching who approaches ${targetName} from the far ridge`,
        `Leaving a counter-sign beside ${targetName}`,
      ];
      const motive = pickFreshCandidate(placeMotives, avoidMotives, seed);
      runtime.recentMotives = pushRing(runtime.recentMotives, motive);
      return { action: 'visit', targetName, motive };
    }
    const wanderMotives = [
      `Watching the wind shift over Selo rooftops`,
      `Tracing a fresh hunch nobody else has voiced yet`,
      `Loitering along the side lane to gauge who hurries by`,
      `Counting lit shutters before the mist settles in`,
      `Taking the long loop around the perimeter wall`,
    ];
    const motive = pickFreshCandidate(wanderMotives, avoidMotives, seed);
    runtime.recentMotives = pushRing(runtime.recentMotives, motive);
    return { action: 'explore', motive };
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

      if (
        settings.voiceApiEnabled &&
        settings.voiceProvider &&
        settings.voiceProvider !== 'local-omni-webspeech' &&
        settings.voiceApiUrl?.trim()
      ) {
        this.setActiveSpeech({
          speakerId: villager.id,
          speakerName: villager.name,
          text: cleanSpeech,
          engine: 'api-tts',
          startedAt: Date.now(),
        });
        try {
          const synth = await synthesizeSpeechViaApi({
            provider: settings.voiceProvider,
            baseUrl: settings.voiceApiUrl,
            model: settings.voiceApiModel || 'tts-1',
            apiKey: settings.voiceApiKey,
            text: cleanSpeech,
            gender: voice.gender,
          });
          if (typeof AudioContext !== 'undefined') {
            const ctx = new AudioContext();
            try {
              const decoded = await ctx.decodeAudioData(synth.audioBuffer.slice(0));
              const src = ctx.createBufferSource();
              src.buffer = decoded;
              const gainNode = ctx.createGain();
              gainNode.gain.value = initialMix.gain;
              const panner = ctx.createStereoPanner();
              panner.pan.value = initialMix.pan;
              src.connect(gainNode);
              gainNode.connect(panner);
              panner.connect(ctx.destination);
              await new Promise<void>((resolve) => {
                src.onended = () => resolve();
                src.start();
              });
            } finally {
              await ctx.close().catch(() => undefined);
            }
          }
          this.log({
            channel: 'voice-api',
            level: 'success',
            title: `Voice API (${settings.voiceProvider} · ${villager.name})`,
            detail: cleanSpeech,
            durationMs: synth.durationMs,
          });
          if (this.activeSpeechInfo?.speakerId === villager.id && this.activeSpeechInfo?.text === cleanSpeech) {
            this.setActiveSpeech(null);
          }
          return;
        } catch (err: any) {
          this.setActiveSpeech(null);
          this.log({
            channel: 'voice-api',
            level: 'warn',
            title: `Voice API fallback (${settings.voiceProvider})`,
            detail: err?.message || String(err),
          });
        }
      }

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
        this.setActiveSpeech({
          speakerId: villager.id,
          speakerName: villager.name,
          text: cleanSpeech,
          engine: 'omni',
          startedAt: Date.now(),
        });
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
          if (this.activeSpeechInfo?.speakerId === villager.id && this.activeSpeechInfo?.text === cleanSpeech) {
            this.setActiveSpeech(null);
          }
          return;
        } catch (err: any) {
          player.stop();
          if (this.activePlayer === player) {
            this.activePlayer = null;
            this.activeSpatialResolver = null;
          }
          this.setActiveSpeech(null);
          this.log({
            channel: 'lfm3-omni',
            level: 'warn',
            title: 'Omni TTS failed',
            detail: err?.message || String(err),
          });
        }
      }

      if (settings.enableWebSpeechFallback) {
        this.setActiveSpeech({
          speakerId: villager.id,
          speakerName: villager.name,
          text: cleanSpeech,
          engine: 'webspeech',
          startedAt: Date.now(),
        });
        this.log({
          channel: 'audio',
          level: 'info',
          title: `Web Speech Fallback (${villager.name})`,
          detail: `${cleanSpeech} [vol ${Math.round(initialMix.gain * 100)}%]`,
        });
        try {
          await speakWebSpeechAsync(cleanSpeech, initialMix.gain, voice);
        } finally {
          if (this.activeSpeechInfo?.speakerId === villager.id && this.activeSpeechInfo?.text === cleanSpeech) {
            this.setActiveSpeech(null);
          }
        }
      }
    });
  }

  /**
   * Speaks an eavesdropped in-character inner thought softly in turn.
   */
  async speakThought(
    text: string,
    villager: VillagerConfig,
    settings: ModelSettings,
    spatialResolver?: () => SpatialMix,
  ): Promise<void> {
    if (!settings.eavesdropThoughts) return;
    const clean = parseDialogueAndNarration(text, villager.name).display.trim();
    if (!clean) return;
    const softResolver = spatialResolver
      ? () => {
          const mix = spatialResolver();
          return { ...mix, gain: mix.inRange ? Math.max(0.18, mix.gain * 0.65) : 0 };
        }
      : undefined;
    await this.speakLine(clean, villager, settings, softResolver);
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

  flushAudioQueue() {
    this.speechEpoch += 1;
    this.speechQueue = Promise.resolve();
    this.activePlayer?.stop();
    this.activePlayer = null;
    this.activeSpatialResolver = null;
    this.setActiveSpeech(null);
    cancelActiveWebSpeech();
    this.log({
      channel: 'audio',
      level: 'info',
      title: 'Audio queue flushed & reset',
      detail: 'Cleared pending speech turns and reset browser/Omni playback.',
    });
  }

  stopSpeech() {
    this.flushAudioQueue();
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

const recentDmBeats: string[] = [];
let dmBeatCursor = Math.floor(Math.random() * 6);

const DM_ENCOUNTER_OPENINGS = [
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
  (a: string, b: string, place: string) =>
    `A brass key tumbles from a roof eaves gutter near ${place}, chiming sharply between ${a} and ${b} as both stop short.`,
  (a: string, b: string, place: string) =>
    `A bell rope sways once without a breeze above ${place}; ${a} halts beside ${b} as cool mist drifts across the cobbles.`,
  (a: string, b: string, place: string) =>
    `Muddy bootprints lead right up to the steps of ${place} and vanish—${a} catches ${b} measuring the stride length.`,
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

const BALKAN_DM_OPENINGS = [
  (a: string, b: string, place: string) =>
    `Dry wind hisses up from the stone mouth near ${place}; ${a} eyes the empty water pitchers between them as ${b} fingers a silver coin.`,
  (a: string, b: string, place: string) =>
    `A bronze kuker bell chimes once in the dusty air around ${place}, drawing ${a} and ${b} toward the Lamia's warning ribbon.`,
  (a: string, b: string, place: string) =>
    `Emerald mist coils over the cracked mortar beside ${place}; ${a} whispers of the well's sacrifice demand while ${b} grips a bundle of basil.`,
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
  const combinedLore = `${villagerA.identity} ${villagerB.identity} ${landmarkName}`.toLowerCase();
  const isBalkanMyth = /lamia|zmeyovo|kuker|samodiva|shevitsa|well/.test(combinedLore);
  const pool =
    phase === 'opening'
      ? isBalkanMyth
        ? [...BALKAN_DM_OPENINGS, ...DM_ENCOUNTER_OPENINGS]
        : DM_ENCOUNTER_OPENINGS
      : DM_ENCOUNTER_CLOSINGS;
  const rendered = pool.map((fn) => fn(villagerA.name, villagerB.name, landmarkName));
  return pickFreshCandidate(rendered, recentDmBeats, idx);
}

function buildPersonaLoreCandidates(
  villager: VillagerConfig,
  partnerName: string,
  dmBeat: string,
  lastTextLower: string,
): string[] {
  const persona = `${villager.role} ${villager.identity} ${villager.plan}`.toLowerCase();
  const lines: string[] = [];

  if (persona.includes('lamia') || lastTextLower.includes('lamia') || lastTextLower.includes('well')) {
    if (persona.includes('lamia') || villager.id === 'lamia') {
      lines.push(
        `Come no closer with hollow jugs, ${partnerName}. The springs stay chained in darkness until Zmeyovo lays true tribute on my altar stone.`,
        `Gold rings hollow and steel breaks against river-stone, ${partnerName}. Bring honeyed wheat, silver obols, or an oath worth my thirst.`,
        `I taste the Samodiva brook upon your boots, ${partnerName}. Would you bargain for rain, or test how deep my coils reach?`,
      );
    } else if (persona.includes('kuker') || persona.includes('bell')) {
      lines.push(
        `Let the Lamia hiss from the shaft, ${partnerName}—three chimes of bronze chanove bells at #KukeriHearth will rattle every stone around #LamiaWell!`,
        `My mask is carved to frighten winter spirits, ${partnerName}, yet even I heard brass groan down #LamiaWell before dawn.`,
      );
    } else if (persona.includes('znaharka') || persona.includes('herb')) {
      lines.push(
        `Hush your iron boasting, ${partnerName}. Our grandmothers appeased the Lamia with sweet kolivo, basil, and braided martenitsa wool—never drawn knives.`,
        `Every gourd along #BabaHerbhouse stays parched, ${partnerName}, until someone sets an honest offering on #LamiaWell's threshold.`,
      );
    } else if (persona.includes('samodiva') || persona.includes('vila')) {
      lines.push(
        `Only the birch-ringed basin at #SamodivaSpring still sings sweet and clear, ${partnerName}—never cross my glade with angry steel.`,
        `The Lamia fears living water freely shared, ${partnerName}. Leave scarlet thread by the moss stone and draw what you need.`,
      );
    } else if (persona.includes('weaver') || persona.includes('shevitsa')) {
      lines.push(
        `Look at the Elbetitsa stars in #KhoroStar, ${partnerName}—eight directions stitched in red thread will turn the Lamia's drought into autumn rain.`,
        `I am finishing the covenant border at #WeaverCardak, ${partnerName}; will you stand witness with me at #LamiaWell?`,
      );
    } else if (persona.includes('blacksmith') || persona.includes('yunak')) {
      lines.push(
        `My forge quench-trough is bone dry, ${partnerName}. Whether by iron hook or honest riddle at #LamiaWell, water runs for Zmeyovo before dusk.`,
        `Cross #YunakBridge with me, ${partnerName}—we either trade with Samodiva Raina or settle terms with the serpent herself.`,
      );
    }
  }

  if (lastTextLower.includes('sacrifice') || lastTextLower.includes('tribute') || lastTextLower.includes('offering') || dmBeat.includes('coin')) {
    lines.push(
      `Look at the silver coins and honey jar left before #LamiaWell, ${partnerName}—half the village thinks appeasement works, the other half wants to break the chains.`,
    );
  }
  return lines;
}

function synthesizeStorySimReply(
  villager: VillagerConfig,
  partnerName: string,
  history: ChatMessage[],
  avoidLines: string[] = [],
): string {
  const spokenHistory = history.filter((m) => m.kind !== 'narration');
  const dmBeat = [...history].reverse().find((m) => m.kind === 'narration')?.text.toLowerCase() ?? '';
  const last = spokenHistory[spokenHistory.length - 1];
  const turn = spokenHistory.length;
  const seed = turn + villager.name.charCodeAt(0) + avoidLines.length;
  const lastTextLower = last?.text.toLowerCase() ?? '';
  const personaLines = buildPersonaLoreCandidates(villager, partnerName, dmBeat, lastTextLower);

  // React directly to concrete DM scene hooks when opening (unless we've already used that reaction)
  if (!last) {
    const openers: string[] = [...personaLines];
    if (dmBeat.includes('key')) {
      openers.push(`Hold on, ${partnerName}—did that brass key just drop out of nowhere, or did somebody leave it on purpose?`);
    }
    if (dmBeat.includes('tally') || dmBeat.includes('chalk')) {
      openers.push(`Tell me honestly, ${partnerName}: did you draw that mark on the stone, or is someone keeping score on us?`);
    }
    if (dmBeat.includes('note') || dmBeat.includes('sleeve')) {
      openers.push(`Don't tuck that folded paper away on my account, ${partnerName}. Who sent word without signing it?`);
    }
    if (dmBeat.includes('millwheel') || dmBeat.includes('hush') || dmBeat.includes('silent')) {
      openers.push(`Did you hear everything go dead quiet just now, ${partnerName}? Even the birds stopped mid-note.`);
    }
    if (dmBeat.includes('pitch') || dmBeat.includes('smoke')) {
      openers.push(`That's juniper smoke, not ordinary hearth pine—someone down the lane is burning something they shouldn't be, ${partnerName}.`);
    }
    openers.push(
      `You look like you've been dodging half the village since morning, ${partnerName}. What are you actually up to?`,
      `Never mind the weather, ${partnerName}—have you noticed how quiet the far gate gets after midday?`,
      `Good timing, ${partnerName}. Let's settle this before half the square tries to guess what we're arguing about.`,
    );
    return pickFreshCandidate(openers, avoidLines, seed);
  }

  const lower = lastTextLower;
  const candidates: string[] = [...personaLines];
  if (lower.includes('key') || lower.includes('lock') || lower.includes('box')) {
    candidates.push(`If it fits the old cellar latch by the mill, we're not telling a soul until nightfall—agreed, ${partnerName}?`);
  }
  if (lower.includes('mark') || lower.includes('rumor') || lower.includes('note') || lower.includes('secret')) {
    candidates.push(`Keep your voice down, ${partnerName}. Half of Selo pretends not to watch the lanes, yet every door has ears.`);
  }
  if (lower.includes('?')) {
    candidates.push(
      `I wouldn't bet coin on the harmless answer, ${partnerName}—look closely at who's been hanging near the square since dawn.`,
      `Maybe, though I swear somebody shifted the lantern posts last night when the fog rolled in.`,
      `Ask me again after sunset, ${partnerName}. Right now I'd rather see what turns up first.`,
    );
  }
  candidates.push(
    `Wait—say that last part again, ${partnerName}. Because if that's true, someone lied at the fire last night.`,
    `You don't fool me for a second, ${partnerName}, though I'll play along if you watch my back near the river.`,
    `Make me a wager then: by dusk we'll know who stirred up that dust behind the windmill.`,
    `Fair enough, ${partnerName}. Meet me past the hearth before everyone else wakes up—I want a straight answer next time.`,
    `Let's drop the guesswork, ${partnerName}—walk with me past the creek and see for yourself.`,
  );
  return pickFreshCandidate(candidates, avoidLines, seed);
}

let dmNarrationCursor = 0;

function synthesizeStorySimNarration(
  prompt: string,
  sceneContext: string,
  settings: ModelSettings,
): string {
  const cleanPrompt = prompt.replace(/@[\p{L}\p{N}_-]+/gu, '').trim();
  const lines = sceneContext.split('\n').filter(Boolean);
  const locationLine = lines.find((l) => l.startsWith('Focal location:'));
  const focalPlace = locationLine ? locationLine.replace('Focal location:', '').trim() : 'Village Square';
  const nearbyActors = lines
    .filter((l) => l.startsWith('- '))
    .map((l) => l.replace(/^- /, '').split(' (')[0].trim())
    .filter(Boolean);
  const flowLines = lines
    .filter((l) => l.startsWith('> '))
    .map((l) => l.replace(/^> /, '').trim())
    .filter(Boolean);

  const actorA = nearbyActors[dmNarrationCursor % Math.max(1, nearbyActors.length)] ?? 'Someone';
  const actorB =
    nearbyActors.length > 1
      ? nearbyActors[(dmNarrationCursor + 1) % nearbyActors.length]
      : undefined;
  const recentEcho = flowLines[flowLines.length - 1];
  dmNarrationCursor += 1;

  if (/secret|rumor|trouble|happen|what|describe|look|scene|where|who/i.test(cleanPrompt)) {
    const twists = [
      `Around ${focalPlace}, a loose shutter rattles without wind while ${actorA} lingers over an ordinary errand${actorB ? `—watching ${actorB} out of the corner of an eye` : ''}.`,
      `Lantern oil hangs sharp in the air near ${focalPlace}; ${recentEcho ? `after "${recentEcho.slice(0, 56)}", ` : ''}an unspoken bargain hums beneath polite small talk.`,
      `Fresh mud prints skirt ${focalPlace} without reaching any doorway, and ${actorA} pauses as if counting footsteps.`,
    ];
    return twists[dmNarrationCursor % twists.length];
  }

  if (settings.narratorStyle === 'chronicler') {
    return cleanPrompt
      ? `Near ${focalPlace}, word of "${cleanPrompt.slice(0, 68)}" ripples past the fences, drawing sharp glances from ${actorA}${actorB ? ` toward ${actorB}` : ''}.`
      : `Around ${focalPlace}, two shadows cross paths just out of earshot while ${actorA} keeps an unspoken tally.`;
  }
  if (settings.narratorStyle === 'storybook') {
    return cleanPrompt
      ? `The wind turns across ${focalPlace} at "${cleanPrompt.slice(0, 64)}"—rafter bells murmur as ${actorA} catches the shift in the air.`
      : `Twilight brushes copper across the roofs of ${focalPlace}, carrying a faint whistle where no boat is moored.`;
  }
  return cleanPrompt
    ? `At those words near ${focalPlace}—"${cleanPrompt.slice(0, 64)}"—the air tightens with intrigue, and ${actorA}${actorB ? ` and ${actorB}` : ''} tilt toward an unspoken turn.`
    : `Above ${focalPlace}, a tarnished coin clinks onto the cobbles beside ${actorA}, daring someone nearby to claim it first.`;
}

export const brainRouter = new BrainRouter();
