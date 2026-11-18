/**
 * A first-visit card: until a voice is loaded, the village speaks with the browser's thin
 * built-in voice. It offers the full voice and brain (LFM3-Omni, which writes and speaks the
 * story) or the light voice (Kokoro-82M) on its own, and stays away once either is chosen or
 * the card is dismissed.
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';
import { omniEngine } from '../ai/omniEngine';
import { kokoroEngine } from '../ai/kokoroEngine';
import type { ModelProgress, ModelSettings } from '../engine/types';

export const VOICE_NUDGE_DISMISSED_KEY = 'seloai:voice-nudge-dismissed-v1';

export function voiceNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(VOICE_NUDGE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

interface VoiceNudgeProps {
  settings: ModelSettings;
  onClose: () => void;
}

export function VoiceNudge({ settings, onClose }: VoiceNudgeProps) {
  const [omni, setOmni] = useState<ModelProgress>(() => omniEngine.progress);
  const [light, setLight] = useState<ModelProgress>(() => kokoroEngine.getProgress());
  const [error, setError] = useState('');

  useEffect(() => omniEngine.subscribe(setOmni), []);
  useEffect(() => kokoroEngine.subscribe(setLight), []);
  useEffect(() => {
    if (omni.status === 'ready' || light.status === 'ready') {
      const t = setTimeout(onClose, 1200);
      return () => clearTimeout(t);
    }
  }, [omni.status, light.status, onClose]);

  const dismiss = () => {
    try {
      localStorage.setItem(VOICE_NUDGE_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
    onClose();
  };

  const loadFull = () => {
    setError('');
    brainRouter
      .loadConfiguredBrain({ brainEngine: 'lfm3-omni', modelId: settings.omniModelId || 'LiquidAI/LFM3-Omni-2B-GGUF', omniMmproj: settings.omniMmproj || undefined })
      .catch((err) => setError(err?.message || String(err)));
  };
  const loadLight = () => {
    setError('');
    kokoroEngine.load().catch((err) => setError(err?.message || String(err)));
  };

  const busy = omni.status === 'loading' || light.status === 'loading';
  const status = omni.status === 'loading' || omni.status === 'ready' ? omni : light.status !== 'unloaded' ? light : null;

  return (
    // A modal over the village, out of the page flow so nothing moves under it. While the person
    // chooses, a light scrim holds the village; once a model is downloading it lifts, so they can
    // look around while it loads.
    <div className={`fixed inset-0 z-50 flex items-start justify-center px-4 pt-20 ${busy ? 'pointer-events-none' : 'bg-ink/15'}`}>
    <div
      role="dialog"
      aria-modal={!busy}
      aria-labelledby="voice-nudge-title"
      style={{ position: 'relative' }}
      className="rushnyk-card pointer-events-auto w-[min(92vw,30rem)] rounded-sm bg-card p-3 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id="voice-nudge-title" className="text-sm font-semibold">Give the village a voice</h2>
        <button type="button" onClick={dismiss} aria-label="Not now" title="Not now" className="text-muted hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        The story begins once a voice is ready. Both models download once and stay on this machine; &ldquo;Not now&rdquo;
        starts it with the browser&apos;s built-in voice.
      </p>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={loadFull}
          disabled={busy}
          className="rounded bg-crimson px-3 py-2 text-left text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
        >
          <span className="flex items-center justify-between gap-2">
            Voice + brain
            <span className="rounded-sm bg-white/20 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">Recommended</span>
          </span>
          <span className="block font-normal opacity-90">LFM3-Omni: one model that thinks and speaks · about 1.5 GB · WebGPU</span>
        </button>
        <button
          type="button"
          onClick={loadLight}
          disabled={busy}
          className="rounded border border-borderFolk bg-surface px-3 py-2 text-left text-xs font-semibold hover:border-crimson/50 disabled:opacity-50"
        >
          <span className="block">Light voice only</span>
          <span className="block font-normal text-muted">Kokoro-82M · about 330 MB</span>
        </button>
      </div>
      {status ? (
        <div className="mt-2.5">
          <div className="h-1.5 w-full overflow-hidden rounded bg-surface">
            <div className="h-full bg-crimson transition-all" style={{ width: `${Math.round((status.fraction ?? 0) * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted">{status.message}</p>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-crimson">{error}</p> : null}
    </div>
    </div>
  );
}
