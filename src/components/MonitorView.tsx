import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Cpu,
  Download,
  Image as ImageIcon,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Server,
  Square,
  Terminal,
  Volume2,
} from 'lucide-react';
import { bonsaiEngine } from '../ai/bonsaiEngine';
import { brainRouter } from '../ai/brainRouter';
import {
  chatWithExternalApi,
  generateImageViaApi,
  probeApiModels,
  synthesizeSpeechViaApi,
} from '../ai/localApiClient';
import { minicpmEngine } from '../ai/minicpmEngine';
import { omniEngine } from '../ai/omniEngine';
import { MicRecorder, StreamingPcmPlayer } from '../ai/audioPipeline';
import {
  API_BRAIN_PRESETS,
  DEFAULT_MODEL_SETTINGS,
  IMAGE_GEN_PRESETS,
  OMNI_SPEECH_LANGUAGES,
  VOICE_BACKEND_PRESETS,
  WEBGPU_BRAIN_PRESETS,
} from '../data/defaultData';
import type { VillageSimulation } from '../engine/simulation';
import type {
  InferenceMode,
  ModelProgress,
  ModelSettings,
  TelemetryEvent,
  TextDtype,
  VillagerConfig,
} from '../engine/types';

interface MonitorViewProps {
  sim: VillageSimulation;
  villagers: VillagerConfig[];
  settings: ModelSettings;
  onUpdateSettings: (patch: Partial<ModelSettings>) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export const MonitorView: React.FC<MonitorViewProps> = ({
  sim,
  villagers,
  settings,
  onUpdateSettings,
}) => {
  const [textStatus, setTextStatus] = useState<ModelProgress>(brainRouter.textProgress);
  const [minicpmStatus, setMinicpmStatus] = useState<ModelProgress>(minicpmEngine.progress);
  const [bonsaiStatus, setBonsaiStatus] = useState<ModelProgress>(bonsaiEngine.progress);
  const [omniStatus, setOmniStatus] = useState<ModelProgress>(omniEngine.progress);
  const [events, setEvents] = useState<TelemetryEvent[]>(brainRouter.telemetryLog);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [simTick, setSimTick] = useState(0);

  // Quick LFM3-1.7B prompt sandbox
  const [testPrompt, setTestPrompt] = useState('Describe the morning bustle of Selo village in 2 sentences.');
  const [testOutput, setTestOutput] = useState('');
  const [testingText, setTestingText] = useState(false);

  // LFM3-Omni STT + TTS voice studio
  const [studioRecording, setStudioRecording] = useState(false);
  const [studioTranscript, setStudioTranscript] = useState('');
  const [studioReply, setStudioReply] = useState('');
  const [ttsInput, setTtsInput] = useState('Welcome to Selo! Take a warm seat by the hearth.');
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);

  // External Brain / Voice / Image API state
  const [detectedLocalModels, setDetectedLocalModels] = useState<string[]>([]);
  const [localProbeStatus, setLocalProbeStatus] = useState<string>('');
  const [localTestOutput, setLocalTestOutput] = useState<string>('');
  const [voiceTestStatus, setVoiceTestStatus] = useState<string>('');
  const [imageTestPrompt, setImageTestPrompt] = useState('A glowing stone lantern beside a village mill at dusk, pixel art');
  const [imageTestStatus, setImageTestStatus] = useState<string>('');
  const [imageTestPreview, setImageTestPreview] = useState<string>('');

  useEffect(() => {
    const u1 = brainRouter.subscribeTextStatus(setTextStatus);
    const u2 = omniEngine.subscribe(setOmniStatus);
    const u5 = minicpmEngine.subscribe(setMinicpmStatus);
    const u6 = bonsaiEngine.subscribe(setBonsaiStatus);
    const u3 = brainRouter.subscribeTelemetry(() => {
      setEvents([...brainRouter.telemetryLog]);
    });
    const u4 = sim.subscribe(() => setSimTick((t) => t + 1));
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
    };
  }, [sim]);

  void simTick;

  const activeBrainStatus =
    settings.brainEngine === 'lfm3-omni'
      ? omniStatus
      : settings.brainEngine === 'minicpm5-gguf'
        ? minicpmStatus
        : settings.brainEngine === 'bonsai2-gguf'
          ? bonsaiStatus
          : textStatus;

  const handleLoadText = async () => {
    if (settings.brainEngine === 'lfm3-omni') {
      await handleLoadOmni();
      return;
    }
    if (settings.brainEngine === 'minicpm5-gguf') {
      try {
        await minicpmEngine.load(settings.textModelId.trim() || 'openbmb/MiniCPM5-2B-GGUF');
        brainRouter.log({
          channel: 'lfm3-1.7b',
          level: 'success',
          title: 'MiniCPM5-2B Ready',
          detail: `${settings.textModelId} loaded on WebGPU`,
        });
      } catch (err: any) {
        brainRouter.log({
          channel: 'lfm3-1.7b',
          level: 'error',
          title: 'MiniCPM5-2B Load Error',
          detail: err?.message || String(err),
        });
      }
      return;
    }
    if (settings.brainEngine === 'bonsai2-gguf') {
      try {
        await bonsaiEngine.load(settings.textModelId.trim() || 'prism-ml/Ternary-Bonsai-2-27B-gguf');
        brainRouter.log({
          channel: 'lfm3-1.7b',
          level: 'success',
          title: 'Ternary Bonsai-2 27B Ready',
          detail: `${settings.textModelId} loaded on WebGPU`,
        });
      } catch (err: any) {
        brainRouter.log({
          channel: 'lfm3-1.7b',
          level: 'error',
          title: 'Bonsai-2 27B Load Error',
          detail: err?.message || String(err),
        });
      }
      return;
    }
    brainRouter.loadTextModel(settings.textModelId.trim(), settings.textDtype);
  };

  const handleLoadOmni = async () => {
    setStudioError(null);
    try {
      await omniEngine.load(settings.omniModelId.trim(), settings.omniMmproj.trim() || undefined);
      brainRouter.flushAudioQueue();
      brainRouter.log({
        channel: 'lfm3-omni',
        level: 'success',
        title: 'LFM3-Omni-2B Ready',
        detail: `${settings.omniModelId} loaded on ${omniEngine.deviceLabel}`,
      });
    } catch (err: any) {
      brainRouter.log({
        channel: 'lfm3-omni',
        level: 'error',
        title: 'LFM3-Omni-2B Load Error',
        detail: err?.message || String(err),
      });
    }
  };

  const handleRunTextTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPrompt.trim() || testingText) return;
    setTestingText(true);
    setTestOutput('');
    try {
      const msgs = [
        { role: 'system' as const, content: 'You are a concise, poetic village chronicler.' },
        { role: 'user' as const, content: testPrompt.trim() },
      ];
      const res =
        settings.brainEngine === 'lfm3-omni' && omniEngine.isReady()
          ? await omniEngine.generateChatReply({
              messages: msgs,
              voice: false,
              maxNewTokens: 120,
              onTextChunk: (c) => setTestOutput((prev) => prev + c),
            })
          : settings.brainEngine === 'minicpm5-gguf' && minicpmEngine.isReady()
            ? await minicpmEngine.generateText(msgs, {
                maxNewTokens: 120,
                onChunk: (c) => setTestOutput((prev) => prev + c),
              })
            : settings.brainEngine === 'bonsai2-gguf' && bonsaiEngine.isReady()
              ? await bonsaiEngine.generateText(msgs, {
                  maxNewTokens: 120,
                  onChunk: (c) => setTestOutput((prev) => prev + c),
                })
              : await brainRouter.generateText(msgs, {
                  maxNewTokens: 120,
                  onChunk: (c) => setTestOutput((prev) => prev + c),
                });
      setTestOutput(res.text);
      brainRouter.log({
        channel: 'lfm3-1.7b',
        level: 'success',
        title: 'Prompt Sandbox',
        detail: res.text,
        durationMs: res.durationMs,
        tokensPerSec: res.tokensPerSec,
      });
    } catch (err: any) {
      setTestOutput(`Error: ${err?.message || String(err)}`);
    } finally {
      setTestingText(false);
    }
  };

  const handleStudioMicToggle = async () => {
    setStudioError(null);
    if (studioRecording && recorderRef.current) {
      setStudioRecording(false);
      setStudioBusy(true);
      try {
        const { audioBuffer } = await recorderRef.current.stop();
        const stt = await omniEngine.transcribeAudio(audioBuffer);
        setStudioTranscript(stt.text);
        brainRouter.log({
          channel: 'lfm3-omni',
          level: 'info',
          title: 'Studio STT',
          detail: stt.text,
          durationMs: stt.durationMs,
        });

        setStudioReply('');
        const player = new StreamingPcmPlayer(omniEngine.audioSampleRate);
        const omniRes = await omniEngine.respondMultimodal({
          systemPrompt: 'You are the friendly elder of Selo village. Reply warmly in 1-2 sentences.',
          audio: audioBuffer,
          voice: true,
          onTextChunk: (c) => setStudioReply((p) => p + c),
          onAudioChunk: (pcm) => player.push(pcm),
        });
        player.end();
        brainRouter.log({
          channel: 'lfm3-omni',
          level: 'success',
          title: 'Studio Voice-to-Voice',
          detail: omniRes.text,
          durationMs: omniRes.durationMs,
        });
      } catch (err: any) {
        setStudioError(err?.message || String(err));
      } finally {
        setStudioBusy(false);
      }
      return;
    }

    if (!omniEngine.isReady()) {
      setStudioError('Load LFM3-Omni-2B above first before recording.');
      return;
    }

    try {
      const rec = new MicRecorder();
      await rec.start();
      recorderRef.current = rec;
      setStudioRecording(true);
    } catch {
      setStudioError('Microphone access was denied.');
    }
  };

  const handleStudioTts = async () => {
    if (!ttsInput.trim() || studioBusy) return;
    setStudioError(null);
    setStudioBusy(true);
    try {
      const v = villagers[0] ?? {
        id: 'test',
        name: 'Mara',
        role: 'Weaver',
        accentColor: '#a82424',
        spritesheetId: 'f1',
        identity: '',
        plan: '',
        voiceStyle: 'Warm, melodic, clear.',
        homeTile: { x: 20, y: 15 },
        speed: 0.75,
      };
      await brainRouter.speakLine(ttsInput.trim(), v, settings);
    } catch (err: any) {
      setStudioError(err?.message || String(err));
    } finally {
      setStudioBusy(false);
    }
  };

  const filteredEvents =
    channelFilter === 'all' ? events : events.filter((ev) => ev.channel === channelFilter);

  const runtimes = [...sim.runtimes.values()];

  return (
    <div className="h-full overflow-y-auto bg-linen p-3 thin-scroll">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Top Metrics Bar */}
        <section aria-label="Live Telemetry Summary" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rushnyk-card rounded-sm p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Sim FPS / Ticks</div>
            <div className="mt-1 font-mono text-lg font-bold">
              {sim.fps} <span className="text-xs font-normal text-muted">/ {sim.tickCount}</span>
            </div>
          </div>
          <div className="rushnyk-card rounded-sm p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Active Brain Speed</div>
            <div className="mt-1 font-mono text-lg font-bold text-indigoFolk">
              {brainRouter.lastMetrics.avgTokensPerSec || '—'}{' '}
              <span className="text-xs font-normal text-muted">tok/s</span>
            </div>
          </div>
          <div className="rushnyk-card rounded-sm p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Omni Latency</div>
            <div className="mt-1 font-mono text-lg font-bold text-crimson">
              {brainRouter.lastMetrics.lastOmniLatencyMs
                ? `${brainRouter.lastMetrics.lastOmniLatencyMs} ms`
                : '—'}
            </div>
          </div>
          <div className="rushnyk-card rounded-sm p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Active Chats</div>
            <div className="mt-1 font-mono text-lg font-bold">
              {sim.conversations.filter((c) => c.active).length}
            </div>
          </div>
          <div className="rushnyk-card rounded-sm p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">WebGPU Device</div>
            <div className="mt-1 truncate text-xs font-semibold">{omniEngine.deviceLabel}</div>
          </div>
        </section>

        {/* Model Loaders & Local Finetune Endpoints */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-2.5" aria-label="WebGPU Model Loaders">
          {/* Village Brain Card (LFM3 / Omni / Qwen3.5 / Gemma4 / Bonsai / MiniCPM5) */}
          <div className="rushnyk-card rounded-sm p-2.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-indigoFolk" />
                <h2 className="text-sm font-bold">Village Brain (WebGPU LLM)</h2>
              </div>
              <StatusBadge status={activeBrainStatus.status} />
            </div>

            <div>
              <label htmlFor="brain-preset" className="block text-[11px] font-medium text-muted mb-1">
                Model Preset (LiquidAI · webml-community · onnx-community)
              </label>
              <select
                id="brain-preset"
                value={
                  WEBGPU_BRAIN_PRESETS.find(
                    (p) =>
                      p.engine === settings.brainEngine &&
                      (p.engine === 'lfm3-omni' || p.modelId === settings.textModelId),
                  )?.id ?? 'custom'
                }
                onChange={(e) => {
                  const preset = WEBGPU_BRAIN_PRESETS.find((p) => p.id === e.target.value);
                  if (!preset) return;
                  onUpdateSettings({
                    brainEngine: preset.engine,
                    textModelId: preset.engine === 'lfm3-omni' ? settings.textModelId : preset.modelId,
                    textDtype: preset.dtype,
                    inferenceMode:
                      preset.engine !== 'lfm3-omni' && settings.inferenceMode === 'lfm3-omni-brain'
                        ? 'auto'
                        : settings.inferenceMode,
                  });
                }}
                className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs"
              >
                {WEBGPU_BRAIN_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.sizeNote}
                  </option>
                ))}
                <option value="custom">Custom Model ID / Finetune…</option>
              </select>
              <p className="mt-1 text-[11px] text-muted">
                {WEBGPU_BRAIN_PRESETS.find(
                  (p) =>
                    p.engine === settings.brainEngine &&
                    (p.engine === 'lfm3-omni' || p.modelId === settings.textModelId),
                )?.description ?? 'Custom WebGPU ONNX / GGUF checkpoint.'}
              </p>
            </div>

            {settings.brainEngine === 'lfm3-omni' ? (
              <div className="rounded border border-borderFolk bg-surface/60 p-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-indigoFolk">First-Choice Unified Brain</span>
                  <span className="font-mono text-muted truncate">{settings.omniModelId}</span>
                </div>
                <p className="text-[11px] text-muted">
                  Uses LFM3-Omni-2B for NPC thinking, conversations, Scribe narration, reflections, and optional TTS voice synthesis.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-2">
                <div>
                  <label htmlFor="text-model-id" className="block text-[11px] font-medium text-muted mb-1">
                    {settings.brainEngine === 'minicpm5-gguf' || settings.brainEngine === 'bonsai2-gguf'
                      ? 'GGUF Repo / Local Path'
                      : 'Hugging Face ONNX Repo / Local Finetune Path'}
                  </label>
                  <input
                    id="text-model-id"
                    type="text"
                    value={settings.textModelId}
                    onChange={(e) => onUpdateSettings({ textModelId: e.target.value })}
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="text-dtype" className="block text-[11px] font-medium text-muted mb-1">
                    Quantization
                  </label>
                  <select
                    id="text-dtype"
                    value={settings.textDtype}
                    disabled={
                      settings.brainEngine === 'minicpm5-gguf' || settings.brainEngine === 'bonsai2-gguf'
                    }
                    onChange={(e) =>
                      onUpdateSettings({ textDtype: e.target.value as TextDtype })
                    }
                    className="w-full rounded border border-borderFolk bg-surface px-2 py-1.5 text-xs font-mono disabled:opacity-50"
                  >
                    <option value="q4f16">q4f16</option>
                    <option value="q4">q4</option>
                    <option value="q2f16">q2f16</option>
                    <option value="q2">q2</option>
                    <option value="q1">q1</option>
                    <option value="fp16">fp16</option>
                  </select>
                </div>
              </div>
            )}

            {activeBrainStatus.status === 'loading' && (
              <div className="space-y-1">
                <progress max={1} value={activeBrainStatus.fraction} className="w-full h-2" />
                <div className="flex justify-between text-[11px] text-muted">
                  <span className="truncate">{activeBrainStatus.message}</span>
                  <span className="font-mono">
                    {Math.round(activeBrainStatus.fraction * 100)}%{' '}
                    {activeBrainStatus.totalBytes ? `of ${formatBytes(activeBrainStatus.totalBytes)}` : ''}
                  </span>
                </div>
              </div>
            )}

            {activeBrainStatus.error && (
              <div role="alert" className="rounded border border-crimson/50 bg-crimson/10 p-2 text-xs text-crimson">
                {activeBrainStatus.error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadText}
                disabled={activeBrainStatus.status === 'loading'}
                className="inline-flex items-center gap-1.5 rounded bg-indigoFolk px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>
                  {settings.brainEngine === 'lfm3-omni'
                    ? activeBrainStatus.status === 'ready'
                      ? 'Reload LFM3-Omni Brain'
                      : 'Load LFM3-Omni-2B (All-in-One)'
                    : activeBrainStatus.status === 'ready'
                      ? 'Reload Brain Model'
                      : 'Load Brain Model'}
                </span>
              </button>
              {activeBrainStatus.status === 'ready' && (
                <button
                  type="button"
                  onClick={() =>
                    settings.brainEngine === 'lfm3-omni'
                      ? omniEngine.unload()
                      : settings.brainEngine === 'minicpm5-gguf'
                        ? minicpmEngine.unload()
                        : settings.brainEngine === 'bonsai2-gguf'
                          ? bonsaiEngine.unload()
                          : brainRouter.unloadTextModel()
                  }
                  className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs"
                >
                  <Square className="h-3 w-3" />
                  <span>Unload</span>
                </button>
              )}
            </div>

            {/* Prompt Sandbox */}
            <form onSubmit={handleRunTextTest} className="border-t border-borderFolk pt-3 space-y-2">
              <label htmlFor="sandbox-prompt" className="block text-[11px] font-medium text-muted">
                Quick Prompt Sandbox
              </label>
              <div className="flex gap-2">
                <input
                  id="sandbox-prompt"
                  type="text"
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  className="flex-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs"
                />
                <button
                  type="submit"
                  disabled={testingText || activeBrainStatus.status !== 'ready'}
                  className="inline-flex items-center gap-1 rounded border border-borderFolk bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                >
                  <Play className="h-3 w-3" />
                  <span>Run</span>
                </button>
              </div>
              {testOutput && (
                <p className="rounded bg-surface p-2 text-xs leading-relaxed border border-borderFolk">
                  {testOutput}
                </p>
              )}
            </form>
          </div>

          {/* LFM3-Omni-2B Card */}
          <div className="rushnyk-card rounded-sm p-2.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-crimson" />
                <h2 className="text-sm font-bold">LFM3-Omni-2B (STT · TTS · Multimodal WebGPU)</h2>
              </div>
              <StatusBadge status={omniStatus.status} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor="omni-model-id" className="block text-[11px] font-medium text-muted mb-1">
                  GGUF Repo / Local Finetune URL
                </label>
                <input
                  id="omni-model-id"
                  type="text"
                  value={settings.omniModelId}
                  onChange={(e) => onUpdateSettings({ omniModelId: e.target.value })}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label htmlFor="omni-mmproj" className="block text-[11px] font-medium text-muted mb-1">
                  mmproj Override (optional)
                </label>
                <input
                  id="omni-mmproj"
                  type="text"
                  value={settings.omniMmproj}
                  onChange={(e) => onUpdateSettings({ omniMmproj: e.target.value })}
                  placeholder="auto-resolved from repo"
                  className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            {omniStatus.status === 'loading' && (
              <div className="space-y-1">
                <progress max={1} value={omniStatus.fraction} className="w-full h-2" />
                <div className="flex justify-between text-[11px] text-muted">
                  <span className="truncate">{omniStatus.message}</span>
                  <span className="font-mono">
                    {Math.round(omniStatus.fraction * 100)}%{' '}
                    {omniStatus.totalBytes ? `of ${formatBytes(omniStatus.totalBytes)}` : ''}
                  </span>
                </div>
              </div>
            )}

            {omniStatus.error && (
              <div role="alert" className="rounded border border-crimson/50 bg-crimson/10 p-2 text-xs text-crimson">
                {omniStatus.error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadOmni}
                disabled={omniStatus.status === 'loading'}
                className="inline-flex items-center gap-1.5 rounded bg-crimson px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{omniStatus.status === 'ready' ? 'Reload LFM3-Omni' : 'Load LFM3-Omni-2B'}</span>
              </button>
              {omniStatus.status === 'ready' && (
                <button
                  type="button"
                  onClick={() => omniEngine.unload()}
                  className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs"
                >
                  <Square className="h-3 w-3" />
                  <span>Unload</span>
                </button>
              )}
            </div>

            {/* Omni STT + TTS Voice Studio */}
            <div className="border-t border-borderFolk pt-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Omni STT + TTS Voice Studio
                </span>
                <button
                  type="button"
                  onClick={handleStudioMicToggle}
                  disabled={studioBusy}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold text-white ${
                    studioRecording ? 'bg-crimson animate-pulse' : 'bg-indigoFolk'
                  }`}
                >
                  {studioRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  <span>{studioRecording ? 'Stop & Transcribe' : 'Test Mic STT + Voice Reply'}</span>
                </button>
              </div>

              {studioError && (
                <div role="alert" className="text-xs text-crimson">
                  {studioError}
                </div>
              )}

              {(studioTranscript || studioReply) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-borderFolk bg-surface p-2">
                    <div className="text-[10px] font-semibold uppercase text-muted">STT Heard</div>
                    <div>{studioTranscript || '…'}</div>
                  </div>
                  <div className="rounded border border-borderFolk bg-surface p-2">
                    <div className="text-[10px] font-semibold uppercase text-muted">Omni Spoke</div>
                    <div>{studioReply || '…'}</div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <label htmlFor="tts-test-input" className="visually-hidden">
                  TTS test line
                </label>
                <input
                  id="tts-test-input"
                  type="text"
                  value={ttsInput}
                  onChange={(e) => setTtsInput(e.target.value)}
                  className="flex-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={handleStudioTts}
                  disabled={studioBusy}
                  className="inline-flex items-center gap-1 rounded border border-borderFolk bg-card px-2.5 py-1 text-xs font-medium hover:bg-surface"
                >
                  <Volume2 className="h-3.5 w-3.5 text-crimson" />
                  <span>Speak TTS</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* External Brain, Voice & Image Backends */}
        <section className="rushnyk-card rounded-sm p-2.5 space-y-2.5" aria-label="External Brain, Voice and Image Backends">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-ochre" />
              <h2 className="text-sm font-bold">External Brain Backends (Ollama · LM Studio · Gemini · Claude · ChatGPT · GitHub · OpenRouter)</h2>
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={settings.localApiEnabled}
                onChange={(e) => onUpdateSettings({ localApiEnabled: e.target.checked })}
              />
              <span>Enable in Auto Mode</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {API_BRAIN_PRESETS.map((p) => (
              <button
                key={p.provider}
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    localApiProvider: p.provider,
                    localApiUrl: p.baseUrl,
                    localApiModel: p.defaultModel,
                  })
                }
                className={`rounded-sm border px-2 py-1 text-[11px] font-medium ${
                  settings.localApiProvider === p.provider
                    ? 'border-ochre bg-ochre text-white'
                    : 'border-borderFolk bg-surface hover:border-ink/40'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label htmlFor="local-api-url" className="block text-[11px] font-medium text-muted mb-0.5">
                API Base URL
              </label>
              <input
                id="local-api-url"
                type="url"
                value={settings.localApiUrl}
                onChange={(e) => onUpdateSettings({ localApiUrl: e.target.value })}
                className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
              />
            </div>
            <div>
              <label htmlFor="local-api-model" className="block text-[11px] font-medium text-muted mb-0.5">
                Model ID
              </label>
              <input
                id="local-api-model"
                type="text"
                list="detected-local-models"
                value={settings.localApiModel}
                onChange={(e) => onUpdateSettings({ localApiModel: e.target.value })}
                className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
              />
              <datalist id="detected-local-models">
                {detectedLocalModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="local-api-key" className="block text-[11px] font-medium text-muted mb-0.5">
                API Key / Token (optional for local)
              </label>
              <input
                id="local-api-key"
                type="password"
                value={settings.localApiKey ?? ''}
                onChange={(e) => onUpdateSettings({ localApiKey: e.target.value })}
                placeholder="sk-… / AIza… / ghp_…"
                className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={async () => {
                setLocalProbeStatus('Probing…');
                const res = await probeApiModels(
                  settings.localApiUrl,
                  settings.localApiProvider,
                  settings.localApiKey,
                );
                if (res.ok) {
                  setDetectedLocalModels(res.models);
                  if (res.models.length > 0 && !res.models.includes(settings.localApiModel)) {
                    onUpdateSettings({ localApiModel: res.models[0] });
                  }
                  setLocalProbeStatus(
                    res.models.length > 0
                      ? `Found ${res.models.length} model(s): ${res.models.slice(0, 5).join(', ')}`
                      : 'Endpoint reachable, no models listed.',
                  );
                } else {
                  setLocalProbeStatus(res.error || 'Endpoint unreachable');
                }
              }}
              className="inline-flex items-center gap-1 rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-medium hover:bg-card"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Detect Models</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                setLocalTestOutput('Testing…');
                try {
                  const res = await chatWithExternalApi({
                    provider: settings.localApiProvider,
                    baseUrl: settings.localApiUrl,
                    model: settings.localApiModel,
                    apiKey: settings.localApiKey,
                    messages: [{ role: 'user', content: 'Say hello from Selo village in one short sentence.' }],
                    maxTokens: 60,
                  });
                  setLocalTestOutput(`${res.text} (${res.durationMs}ms)`);
                } catch (err: any) {
                  setLocalTestOutput(`Error: ${err?.message || String(err)}`);
                }
              }}
              className="inline-flex items-center gap-1 rounded-sm bg-ochre px-2.5 py-1 text-xs font-semibold text-white hover:opacity-95"
            >
              <Play className="h-3 w-3" />
              <span>Test Brain Reply</span>
            </button>
          </div>

          {(localProbeStatus || localTestOutput) && (
            <div className="rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs space-y-1">
              {localProbeStatus && <div className="text-muted">{localProbeStatus}</div>}
              {localTestOutput && <div className="font-mono text-[11px]">{localTestOutput}</div>}
            </div>
          )}

          {/* Voice (TTS) API Backend */}
          <div className="border-t border-borderFolk pt-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <Volume2 className="h-3.5 w-3.5 text-indigoFolk" />
                <span>External Voice (TTS) Backend</span>
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(settings.voiceApiEnabled)}
                  onChange={(e) => onUpdateSettings({ voiceApiEnabled: e.target.checked })}
                />
                <span>Use External Voice API First</span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {VOICE_BACKEND_PRESETS.map((vp) => (
                <button
                  key={vp.provider}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      voiceProvider: vp.provider,
                      voiceApiUrl: vp.baseUrl,
                      voiceApiModel: vp.defaultModel,
                      voiceApiEnabled: vp.provider !== 'local-omni-webspeech',
                    })
                  }
                  className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium ${
                    (settings.voiceProvider ?? 'local-omni-webspeech') === vp.provider
                      ? 'border-indigoFolk bg-indigoFolk text-white'
                      : 'border-borderFolk bg-surface hover:border-ink/40'
                  }`}
                >
                  {vp.label}
                </button>
              ))}
            </div>
            {(settings.voiceProvider ?? 'local-omni-webspeech') !== 'local-omni-webspeech' && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                <div>
                  <label className="block text-[10px] font-medium text-muted mb-0.5">Voice API URL</label>
                  <input
                    type="url"
                    value={settings.voiceApiUrl ?? ''}
                    onChange={(e) => onUpdateSettings({ voiceApiUrl: e.target.value })}
                    className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-muted mb-0.5">Voice Model</label>
                  <input
                    type="text"
                    value={settings.voiceApiModel ?? ''}
                    onChange={(e) => onUpdateSettings({ voiceApiModel: e.target.value })}
                    className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-muted mb-0.5">Voice API Key</label>
                  <input
                    type="password"
                    value={settings.voiceApiKey ?? ''}
                    onChange={(e) => onUpdateSettings({ voiceApiKey: e.target.value })}
                    placeholder="Optional / reuse key"
                    className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setVoiceTestStatus('Synthesizing…');
                    try {
                      const res = await synthesizeSpeechViaApi({
                        provider: settings.voiceProvider ?? 'openai',
                        baseUrl: settings.voiceApiUrl ?? '',
                        model: settings.voiceApiModel ?? 'tts-1',
                        apiKey: settings.voiceApiKey || settings.localApiKey,
                        text: 'Testing external voice backend.',
                      });
                      setVoiceTestStatus(`Audio ready (${res.mimeType}, ${res.audioBuffer.byteLength} bytes, ${res.durationMs}ms)`);
                    } catch (err: any) {
                      setVoiceTestStatus(`Error: ${err?.message || String(err)}`);
                    }
                  }}
                  className="inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-borderFolk bg-surface px-2 text-xs font-medium hover:bg-card"
                >
                  <Play className="h-3 w-3" />
                  <span>Test Voice API</span>
                </button>
              </div>
            )}
            {voiceTestStatus && <div className="text-[11px] font-mono text-muted">{voiceTestStatus}</div>}
          </div>

          {/* Image Generation Models */}
          <div className="border-t border-borderFolk pt-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <ImageIcon className="h-3.5 w-3.5 text-sage" />
                <span>Image Generation Models (Agent · OpenRouter · OpenAI · Gemini · Local SD / ComfyUI)</span>
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(settings.imageGenEnabled)}
                  onChange={(e) => onUpdateSettings({ imageGenEnabled: e.target.checked })}
                />
                <span>Enable Image Gen</span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {IMAGE_GEN_PRESETS.map((ip) => (
                <button
                  key={ip.provider}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      imageGenEnabled: true,
                      imageGenProvider: ip.provider,
                      imageGenUrl: ip.baseUrl,
                      imageGenModel: ip.defaultModel,
                    })
                  }
                  className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium ${
                    (settings.imageGenProvider ?? 'agent') === ip.provider
                      ? 'border-sage bg-sage text-white'
                      : 'border-borderFolk bg-surface hover:border-ink/40'
                  }`}
                >
                  {ip.label}
                </button>
              ))}
            </div>
            {settings.imageGenEnabled && (
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-muted mb-0.5">Image API URL</label>
                    <input
                      type="url"
                      value={settings.imageGenUrl ?? ''}
                      onChange={(e) => onUpdateSettings({ imageGenUrl: e.target.value })}
                      className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-muted mb-0.5">Image Model ID</label>
                    <input
                      type="text"
                      value={settings.imageGenModel ?? ''}
                      onChange={(e) => onUpdateSettings({ imageGenModel: e.target.value })}
                      className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-muted mb-0.5">Image API Key</label>
                    <input
                      type="password"
                      value={settings.imageGenApiKey ?? ''}
                      onChange={(e) => onUpdateSettings({ imageGenApiKey: e.target.value })}
                      placeholder="Optional for agent / local"
                      className="w-full rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="text"
                    value={imageTestPrompt}
                    onChange={(e) => setImageTestPrompt(e.target.value)}
                    placeholder="Prompt to test image generation…"
                    className="flex-1 min-w-[200px] rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      setImageTestStatus('Generating…');
                      try {
                        const res = await generateImageViaApi(
                          { prompt: imageTestPrompt, kind: 'scene', width: 512, height: 512 },
                          settings,
                        );
                        setImageTestPreview(res.dataUrl);
                        setImageTestStatus(`Generated via ${res.provider} (${res.durationMs}ms)`);
                      } catch (err: any) {
                        setImageTestStatus(err?.message || String(err));
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-sm bg-sage px-2.5 py-1 text-xs font-semibold text-white hover:opacity-95"
                  >
                    <ImageIcon className="h-3 w-3" />
                    <span>Test Generate</span>
                  </button>
                </div>
                {imageTestStatus && <div className="text-[11px] font-mono text-muted">{imageTestStatus}</div>}
                {imageTestPreview && (
                  <img
                    src={imageTestPreview}
                    alt="Generated asset preview"
                    className="max-h-36 rounded-sm border border-borderFolk bg-surface"
                  />
                )}
              </div>
            )}
          </div>
        </section>

        {/* Inference Policy & Audio Routing */}
        <section className="rushnyk-card rounded-sm p-2.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted">
                Village Inference Mode
              </legend>
              <div className="space-y-1.5 text-xs">
                {(
                  [
                    ['auto', 'Auto: Active WebGPU Brain (or Omni) → Ollama/LM Studio → Story Sim'],
                    ['lfm3-omni-brain', 'LFM3-Omni-2B All-in-One (Single Model Brain + Voice)'],
                    ['local-api', 'Ollama / LM Studio HTTP Only'],
                    ['strict-webgpu', 'Strict WebGPU Only (require loaded WebGPU brain)'],
                    ['story-sim', 'Offline Story Sim (Zero VRAM, instant deterministic testing)'],
                  ] as Array<[InferenceMode, string]>
                ).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="inference-mode"
                      value={val}
                      checked={settings.inferenceMode === val}
                      onChange={() => onUpdateSettings({ inferenceMode: val })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted">
                Audio & Autonomy Controls
              </legend>
              <div className="space-y-1.5 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enableOmniTts}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (!next) brainRouter.flushAudioQueue();
                      onUpdateSettings({ enableOmniTts: next });
                    }}
                  />
                  <span>Speak villager replies via LFM3-Omni-2B TTS</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enableWebSpeechFallback}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (!next) brainRouter.flushAudioQueue();
                      onUpdateSettings({ enableWebSpeechFallback: next });
                    }}
                  />
                  <span>Use browser Web Speech TTS fallback when Omni is unloaded</span>
                </label>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => brainRouter.flushAudioQueue()}
                    className="inline-flex items-center gap-1.5 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs font-medium hover:border-crimson hover:text-crimson"
                  >
                    <span>Flush &amp; Reset Audio Queue</span>
                  </button>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoConverse}
                    onChange={(e) => onUpdateSettings({ autoConverse: e.target.checked })}
                  />
                  <span>Autonomous villager-to-villager conversations</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.eavesdropSpeech}
                    onChange={(e) => onUpdateSettings({ eavesdropSpeech: e.target.checked })}
                  />
                  <span>Hear spoken dialogue within eavesdrop radius</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.eavesdropThoughts}
                    onChange={(e) => onUpdateSettings({ eavesdropThoughts: e.target.checked })}
                  />
                  <span>Eavesdrop on villagers&apos; in-character inner thoughts</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.showReasoning}
                    onChange={(e) => onUpdateSettings({ showReasoning: e.target.checked })}
                  />
                  <span>Separate &lt;think&gt; reasoning mode (display LLM meta-thoughts)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.speakReasoning}
                    onChange={(e) => onUpdateSettings({ speakReasoning: e.target.checked })}
                  />
                  <span>Speak &lt;think&gt; reasoning aloud (off by default)</span>
                </label>
                <div className="space-y-1 pt-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="proximity-radius" className="text-muted">
                      Eavesdrop radius:{' '}
                      <span className="font-mono text-ink">
                        {settings.proximityRadiusTiles <= 0
                          ? 'Off (0 tiles)'
                          : settings.proximityRadiusTiles >= 90
                            ? 'Whole Map (all villagers)'
                            : `${settings.proximityRadiusTiles} tiles`}
                      </span>
                    </label>
                    <input
                      id="proximity-radius"
                      type="range"
                      min={0}
                      max={25}
                      step={1}
                      value={settings.proximityRadiusTiles >= 90 ? 25 : Math.min(24, Math.max(0, settings.proximityRadiusTiles))}
                      aria-valuetext={
                        settings.proximityRadiusTiles <= 0
                          ? 'Off'
                          : settings.proximityRadiusTiles >= 90
                            ? 'Whole map'
                            : `${settings.proximityRadiusTiles} tiles`
                      }
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const nextRadius = raw >= 25 ? 999 : raw;
                        if (nextRadius <= 0) {
                          brainRouter.stopSpeech();
                        }
                        onUpdateSettings({ proximityRadiusTiles: nextRadius });
                      }}
                      className="flex-1 accent-sage"
                    />
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ proximityRadiusTiles: 999 })}
                      aria-pressed={settings.proximityRadiusTiles >= 90}
                      className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                        settings.proximityRadiusTiles >= 90
                          ? 'border-sage bg-sage text-white'
                          : 'border-borderFolk bg-surface hover:bg-card'
                      }`}
                    >
                      Whole Map
                    </button>
                  </div>
                  <p className="text-[11px] text-muted">
                    Mixes villager voices by distance &amp; stereo pan (0 = Off, slide right for Whole Map).
                  </p>
                </div>
              </div>
            </fieldset>
          </div>

          {/* Narrator / Scribe (Dungeon Master) Controls */}
          <fieldset className="mt-4 border-t border-borderFolk pt-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted">
                Narrator / Scribe (Reads Non-Conversation Beats in Turn)
              </legend>
              <button
                type="button"
                onClick={() =>
                  brainRouter.speakNarration(
                    `Evening light settles over the windmill as the villagers pause to share their craft.`,
                    settings,
                  )
                }
                disabled={!settings.narratorEnabled}
                className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs font-medium hover:bg-card disabled:opacity-50"
              >
                <Volume2 className="h-3.5 w-3.5 text-ochre" />
                <span>Test {settings.narratorName || 'Scribe'} Voice</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-2.5 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.narratorEnabled}
                  onChange={(e) => onUpdateSettings({ narratorEnabled: e.target.checked })}
                />
                <span>Enable Scribe narrator voice</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.narrateEvents}
                  disabled={!settings.narratorEnabled}
                  onChange={(e) => onUpdateSettings({ narrateEvents: e.target.checked })}
                />
                <span>Narrate scene intros, stage actions &amp; closings</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <label htmlFor="narrator-name" className="block text-[11px] font-medium text-muted mb-1">
                  Narrator Name
                </label>
                <input
                  id="narrator-name"
                  type="text"
                  value={settings.narratorName}
                  onChange={(e) => onUpdateSettings({ narratorName: e.target.value })}
                  className="w-full rounded border border-borderFolk bg-surface px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="narrator-style" className="block text-[11px] font-medium text-muted mb-1">
                  Narration Tone
                </label>
                <select
                  id="narrator-style"
                  value={settings.narratorStyle}
                  onChange={(e) =>
                    onUpdateSettings({
                      narratorStyle: e.target.value as ModelSettings['narratorStyle'],
                    })
                  }
                  className="w-full rounded border border-borderFolk bg-surface px-2 py-1 text-xs"
                >
                  <option value="dungeon-master">Dungeon Master</option>
                  <option value="storybook">Fireside Storybook</option>
                  <option value="chronicler">Village Chronicler</option>
                </select>
              </div>
              <div>
                <label htmlFor="narrator-lang" className="block text-[11px] font-medium text-muted mb-1">
                  Accent / Locale
                </label>
                <select
                  id="narrator-lang"
                  value={settings.narratorVoice?.language ?? DEFAULT_MODEL_SETTINGS.narratorVoice.language}
                  onChange={(e) =>
                    onUpdateSettings({
                      narratorVoice: {
                        ...(settings.narratorVoice ?? DEFAULT_MODEL_SETTINGS.narratorVoice),
                        language: e.target.value,
                      },
                    })
                  }
                  className="w-full rounded border border-borderFolk bg-surface px-2 py-1 text-xs"
                >
                  {OMNI_SPEECH_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="narrator-gender" className="block text-[11px] font-medium text-muted mb-1">
                  Voice Register
                </label>
                <select
                  id="narrator-gender"
                  value={settings.narratorVoice?.gender ?? DEFAULT_MODEL_SETTINGS.narratorVoice.gender}
                  onChange={(e) =>
                    onUpdateSettings({
                      narratorVoice: {
                        ...(settings.narratorVoice ?? DEFAULT_MODEL_SETTINGS.narratorVoice),
                        gender: e.target.value as 'female' | 'male',
                      },
                    })
                  }
                  className="w-full rounded border border-borderFolk bg-surface px-2 py-1 text-xs"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
              <div>
                <label htmlFor="narrator-pitch" className="block text-[11px] text-muted mb-0.5">
                  Pitch:{' '}
                  <span className="font-mono text-ink tabular-nums">
                    {(settings.narratorVoice?.pitchSemitones ?? -1.5) >= 0 ? '+' : ''}
                    {(settings.narratorVoice?.pitchSemitones ?? -1.5).toFixed(1)} st
                  </span>
                </label>
                <input
                  id="narrator-pitch"
                  type="range"
                  min={-6}
                  max={6}
                  step={0.5}
                  value={settings.narratorVoice?.pitchSemitones ?? -1.5}
                  onChange={(e) =>
                    onUpdateSettings({
                      narratorVoice: {
                        ...(settings.narratorVoice ?? DEFAULT_MODEL_SETTINGS.narratorVoice),
                        pitchSemitones: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label htmlFor="narrator-rate" className="block text-[11px] text-muted mb-0.5">
                  Pacing:{' '}
                  <span className="font-mono text-ink tabular-nums">
                    {(settings.narratorVoice?.speakingRate ?? 0.94).toFixed(2)}×
                  </span>
                </label>
                <input
                  id="narrator-rate"
                  type="range"
                  min={0.75}
                  max={1.35}
                  step={0.02}
                  value={settings.narratorVoice?.speakingRate ?? 0.94}
                  onChange={(e) =>
                    onUpdateSettings({
                      narratorVoice: {
                        ...(settings.narratorVoice ?? DEFAULT_MODEL_SETTINGS.narratorVoice),
                        speakingRate: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label htmlFor="narrator-warmth" className="block text-[11px] text-muted mb-0.5">
                  Warmth:{' '}
                  <span className="font-mono text-ink tabular-nums">
                    {(settings.narratorVoice?.warmthDb ?? 2.5) >= 0 ? '+' : ''}
                    {(settings.narratorVoice?.warmthDb ?? 2.5).toFixed(1)} dB
                  </span>
                </label>
                <input
                  id="narrator-warmth"
                  type="range"
                  min={-6}
                  max={6}
                  step={0.5}
                  value={settings.narratorVoice?.warmthDb ?? 2.5}
                  onChange={(e) =>
                    onUpdateSettings({
                      narratorVoice: {
                        ...(settings.narratorVoice ?? DEFAULT_MODEL_SETTINGS.narratorVoice),
                        warmthDb: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
              </div>
            </div>
          </fieldset>
        </section>

        {/* Villager State Matrix + Live Telemetry Log */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {/* NPC Matrix */}
          <div className="rushnyk-card rounded-sm p-2.5 overflow-hidden">
            <div className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-ochre" />
              <h2 className="text-sm font-bold">Villager Runtime Matrix</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-borderFolk text-[11px] uppercase text-muted">
                    <th scope="col" className="py-1.5 pr-2">Name</th>
                    <th scope="col" className="py-1.5 pr-2">State</th>
                    <th scope="col" className="py-1.5 pr-2">Tile</th>
                    <th scope="col" className="py-1.5 pr-2">Mem</th>
                    <th scope="col" className="py-1.5">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borderFolk/50">
                  {runtimes.map((rt) => {
                    const cfg = sim.configs.get(rt.id);
                    if (!cfg) return null;
                    return (
                      <tr key={rt.id}>
                        <td className="py-1.5 pr-2 font-semibold">{cfg.name}</td>
                        <td className="py-1.5 pr-2 capitalize">{rt.state}</td>
                        <td className="py-1.5 pr-2 font-mono">
                          ({Math.round(rt.x)},{Math.round(rt.y)})
                        </td>
                        <td className="py-1.5 pr-2 font-mono">{rt.memories.length}</td>
                        <td className="py-1.5 font-mono">
                          {rt.lastLatencyMs ? `${rt.lastLatencyMs}ms` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trace Log */}
          <div className="rushnyk-card rounded-sm p-2.5 flex flex-col max-h-96">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-sage" />
                <h2 className="text-sm font-bold">Inference & Event Trace</h2>
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                {['all', 'lfm3-1.7b', 'lfm3-omni', 'local-api', 'sim', 'audio'].map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannelFilter(ch)}
                    className={`rounded px-2 py-0.5 font-mono ${
                      channelFilter === ch ? 'bg-indigoFolk text-white' : 'bg-surface'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    brainRouter.telemetryLog = [];
                    setEvents([]);
                  }}
                  aria-label="Clear trace log"
                  className="rounded p-1 hover:bg-surface"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
            </div>

            <ul className="flex-1 overflow-y-auto space-y-1.5 thin-scroll pr-1">
              {filteredEvents.length === 0 ? (
                <li className="py-8 text-center text-xs text-muted">
                  No events logged yet. Start chatting or load a WebGPU model.
                </li>
              ) : (
                filteredEvents.map((ev) => (
                  <li
                    key={ev.id}
                    className="rounded border border-borderFolk/70 bg-surface px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
                      <span className="font-mono font-semibold text-ink">
                        [{ev.channel}] {ev.title}
                      </span>
                      <span className="font-mono">
                        {ev.durationMs ? `${ev.durationMs}ms` : ''}{' '}
                        {ev.tokensPerSec ? `· ${ev.tokensPerSec} tok/s` : ''}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink/90 break-words">{ev.detail}</p>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status: ModelProgress['status'] }> = ({ status }) => {
  const styles: Record<ModelProgress['status'], string> = {
    unloaded: 'border-borderFolk bg-surface text-muted',
    loading: 'border-ochre bg-ochre/15 text-ochre',
    ready: 'border-sage bg-sage/15 text-sage',
    error: 'border-crimson bg-crimson/15 text-crimson',
  };
  return (
    <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase ${styles[status]}`}>
      {status}
    </span>
  );
};
