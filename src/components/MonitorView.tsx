import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Cpu,
  Download,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Server,
  Square,
  Terminal,
  Volume2,
} from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';
import { chatWithLocalApi, probeLocalApiModels } from '../ai/localApiClient';
import { omniEngine } from '../ai/omniEngine';
import { MicRecorder, StreamingPcmPlayer } from '../ai/audioPipeline';
import type { VillageSimulation } from '../engine/simulation';
import type {
  InferenceMode,
  ModelProgress,
  ModelSettings,
  TelemetryEvent,
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

  // Ollama / LM Studio fallback state
  const [detectedLocalModels, setDetectedLocalModels] = useState<string[]>([]);
  const [localProbeStatus, setLocalProbeStatus] = useState<string>('');
  const [localTestOutput, setLocalTestOutput] = useState<string>('');

  useEffect(() => {
    const u1 = brainRouter.subscribeTextStatus(setTextStatus);
    const u2 = omniEngine.subscribe(setOmniStatus);
    const u3 = brainRouter.subscribeTelemetry(() => {
      setEvents([...brainRouter.telemetryLog]);
    });
    const u4 = sim.subscribe(() => setSimTick((t) => t + 1));
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [sim]);

  void simTick;

  const handleLoadText = () => {
    brainRouter.loadTextModel(settings.textModelId.trim(), settings.textDtype);
  };

  const handleLoadOmni = async () => {
    setStudioError(null);
    try {
      await omniEngine.load(settings.omniModelId.trim(), settings.omniMmproj.trim() || undefined);
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
      const res = await brainRouter.generateText(
        [
          { role: 'system', content: 'You are a concise, poetic village chronicler.' },
          { role: 'user', content: testPrompt.trim() },
        ],
        {
          maxNewTokens: 120,
          onChunk: (c) => setTestOutput((prev) => prev + c),
        },
      );
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
        name: 'Olena',
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
    <div className="h-full overflow-y-auto bg-linen p-5 thin-scroll">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Top Metrics Bar */}
        <section aria-label="Live Telemetry Summary" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rushnyk-card rounded-lg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Sim FPS / Ticks</div>
            <div className="mt-1 font-mono text-lg font-bold">
              {sim.fps} <span className="text-xs font-normal text-muted">/ {sim.tickCount}</span>
            </div>
          </div>
          <div className="rushnyk-card rounded-lg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">LFM3-1.7B Speed</div>
            <div className="mt-1 font-mono text-lg font-bold text-indigoFolk">
              {brainRouter.lastMetrics.avgTokensPerSec || '—'}{' '}
              <span className="text-xs font-normal text-muted">tok/s</span>
            </div>
          </div>
          <div className="rushnyk-card rounded-lg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Omni Latency</div>
            <div className="mt-1 font-mono text-lg font-bold text-crimson">
              {brainRouter.lastMetrics.lastOmniLatencyMs
                ? `${brainRouter.lastMetrics.lastOmniLatencyMs} ms`
                : '—'}
            </div>
          </div>
          <div className="rushnyk-card rounded-lg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Active Chats</div>
            <div className="mt-1 font-mono text-lg font-bold">
              {sim.conversations.filter((c) => c.active).length}
            </div>
          </div>
          <div className="rushnyk-card rounded-lg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">WebGPU Device</div>
            <div className="mt-1 truncate text-xs font-semibold">{omniEngine.deviceLabel}</div>
          </div>
        </section>

        {/* Model Loaders & Local Finetune Endpoints */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-label="WebGPU Model Loaders">
          {/* LFM3-1.7B Card */}
          <div className="rushnyk-card rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-indigoFolk" />
                <h2 className="text-sm font-bold">LFM3-1.7B (Village Brain · Transformers.js WebGPU)</h2>
              </div>
              <StatusBadge status={textStatus.status} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-2">
              <div>
                <label htmlFor="text-model-id" className="block text-[11px] font-medium text-muted mb-1">
                  Hugging Face ONNX Repo / Local Finetune Path
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
                  onChange={(e) =>
                    onUpdateSettings({ textDtype: e.target.value as ModelSettings['textDtype'] })
                  }
                  className="w-full rounded border border-borderFolk bg-surface px-2 py-1.5 text-xs font-mono"
                >
                  <option value="q4f16">q4f16</option>
                  <option value="q4">q4</option>
                  <option value="fp16">fp16</option>
                </select>
              </div>
            </div>

            {textStatus.status === 'loading' && (
              <div className="space-y-1">
                <progress max={1} value={textStatus.fraction} className="w-full h-2" />
                <div className="flex justify-between text-[11px] text-muted">
                  <span className="truncate">{textStatus.message}</span>
                  <span className="font-mono">
                    {Math.round(textStatus.fraction * 100)}%{' '}
                    {textStatus.totalBytes ? `of ${formatBytes(textStatus.totalBytes)}` : ''}
                  </span>
                </div>
              </div>
            )}

            {textStatus.error && (
              <div role="alert" className="rounded border border-crimson/50 bg-crimson/10 p-2 text-xs text-crimson">
                {textStatus.error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadText}
                disabled={textStatus.status === 'loading'}
                className="inline-flex items-center gap-1.5 rounded bg-indigoFolk px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{textStatus.status === 'ready' ? 'Reload LFM3-1.7B' : 'Load LFM3-1.7B'}</span>
              </button>
              {textStatus.status === 'ready' && (
                <button
                  type="button"
                  onClick={() => brainRouter.unloadTextModel()}
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
                  disabled={testingText || textStatus.status !== 'ready'}
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
          <div className="rushnyk-card rounded-lg p-4 space-y-3">
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

        {/* Ollama / LM Studio Local API Fallback */}
        <section className="rushnyk-card rounded-lg p-4 space-y-3" aria-label="Ollama and LM Studio Fallback">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-ochre" />
              <h2 className="text-sm font-bold">Ollama / LM Studio Local Fallback</h2>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    localApiProvider: 'ollama',
                    localApiUrl: 'http://localhost:11434/v1',
                  })
                }
                className={`rounded border px-2.5 py-1 text-xs font-medium ${
                  settings.localApiProvider === 'ollama'
                    ? 'border-ochre bg-ochre text-white'
                    : 'border-borderFolk bg-surface'
                }`}
              >
                Ollama (11434)
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    localApiProvider: 'lmstudio',
                    localApiUrl: 'http://localhost:1234/v1',
                  })
                }
                className={`rounded border px-2.5 py-1 text-xs font-medium ${
                  settings.localApiProvider === 'lmstudio'
                    ? 'border-ochre bg-ochre text-white'
                    : 'border-borderFolk bg-surface'
                }`}
              >
                LM Studio (1234)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_240px] gap-2">
            <div>
              <label htmlFor="local-api-url" className="block text-[11px] font-medium text-muted mb-1">
                OpenAI-Compatible Base URL
              </label>
              <input
                id="local-api-url"
                type="url"
                value={settings.localApiUrl}
                onChange={(e) => onUpdateSettings({ localApiUrl: e.target.value })}
                className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label htmlFor="local-api-model" className="block text-[11px] font-medium text-muted mb-1">
                Model Name
              </label>
              <input
                id="local-api-model"
                type="text"
                list="detected-local-models"
                value={settings.localApiModel}
                onChange={(e) => onUpdateSettings({ localApiModel: e.target.value })}
                className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs font-mono"
              />
              <datalist id="detected-local-models">
                {detectedLocalModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                setLocalProbeStatus('Probing…');
                const res = await probeLocalApiModels(settings.localApiUrl);
                if (res.ok) {
                  setDetectedLocalModels(res.models);
                  if (res.models.length > 0 && !res.models.includes(settings.localApiModel)) {
                    onUpdateSettings({ localApiModel: res.models[0] });
                  }
                  setLocalProbeStatus(
                    res.models.length > 0
                      ? `Found ${res.models.length} model(s): ${res.models.slice(0, 4).join(', ')}`
                      : 'Server reachable, no models loaded yet.',
                  );
                } else {
                  setLocalProbeStatus(res.error || 'Server unreachable');
                }
              }}
              className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs font-medium hover:bg-card"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Detect Models</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                setLocalTestOutput('Testing…');
                try {
                  const res = await chatWithLocalApi({
                    baseUrl: settings.localApiUrl,
                    model: settings.localApiModel,
                    messages: [{ role: 'user', content: 'Say hello from Selo village in one short sentence.' }],
                    maxTokens: 60,
                  });
                  setLocalTestOutput(`${res.text} (${res.durationMs}ms)`);
                } catch (err: any) {
                  setLocalTestOutput(`Error: ${err?.message || String(err)}`);
                }
              }}
              className="inline-flex items-center gap-1 rounded bg-ochre px-2.5 py-1 text-xs font-semibold text-white hover:opacity-95"
            >
              <Play className="h-3 w-3" />
              <span>Test Reply</span>
            </button>

            <label className="ml-auto inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={settings.localApiEnabled}
                onChange={(e) => onUpdateSettings({ localApiEnabled: e.target.checked })}
              />
              <span>Enable as Auto Fallback</span>
            </label>
          </div>

          {(localProbeStatus || localTestOutput) && (
            <div className="rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs space-y-1">
              {localProbeStatus && <div className="text-muted">{localProbeStatus}</div>}
              {localTestOutput && <div className="font-mono text-[11px]">{localTestOutput}</div>}
            </div>
          )}
        </section>

        {/* Inference Policy & Audio Routing */}
        <section className="rushnyk-card rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted">
                Village Inference Mode
              </legend>
              <div className="space-y-1.5 text-xs">
                {(
                  [
                    ['auto', 'Auto: WebGPU → Ollama/LM Studio fallback → Story Sim'],
                    ['local-api', 'Ollama / LM Studio HTTP Only'],
                    ['strict-webgpu', 'Strict WebGPU Only (require loaded LFM3 models)'],
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
                    onChange={(e) => onUpdateSettings({ enableOmniTts: e.target.checked })}
                  />
                  <span>Speak villager replies via LFM3-Omni-2B TTS</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enableWebSpeechFallback}
                    onChange={(e) => onUpdateSettings({ enableWebSpeechFallback: e.target.checked })}
                  />
                  <span>Use browser Web Speech TTS fallback when Omni is unloaded</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoConverse}
                    onChange={(e) => onUpdateSettings({ autoConverse: e.target.checked })}
                  />
                  <span>Autonomous villager-to-villager conversations</span>
                </label>
              </div>
            </fieldset>
          </div>
        </section>

        {/* Villager State Matrix + Live Telemetry Log */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* NPC Matrix */}
          <div className="rushnyk-card rounded-lg p-4 overflow-hidden">
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
          <div className="rushnyk-card rounded-lg p-4 flex flex-col max-h-96">
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
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${styles[status]}`}>
      {status}
    </span>
  );
};
