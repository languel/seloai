import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { localPi, PI_LOCAL_DOWNLOAD, PI_LOCAL_MODEL_ID, type LocalLoadProgress } from '../agent/piModel';
import { piSession, type PiBrain } from '../agent/piSession';
import MiniMarkdown from './MiniMarkdown';

const STARTERS = [
  'Make a new world with me',
  'What is this story about?',
  'Add a character who wants something the others do not',
  'Start the story again',
];

/**
 * Pi, the in-app agent, as a panel: talk to it and it builds and runs the world with the same
 * tools outside agents use. It thinks either on this machine (LFM3-1.7B on WebGPU, after a
 * one-time download) or with the cloud model from the Brain API settings.
 */
export default function PiPanel() {
  useSyncExternalStore(piSession.subscribe, piSession.snapshot);
  const [local, setLocal] = useState<LocalLoadProgress>(localPi.progress);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => localPi.subscribe(setLocal), []);
  const items = piSession.items;
  const busy = piSession.busy;
  const brain = piSession.brain;
  const apiOk = piSession.apiAvailable();
  const localReady = local.status === 'ready';
  const canTalk = brain === 'api' ? apiOk : localReady;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const send = (text: string) => {
    if (!text.trim() || busy || !canTalk) return;
    setDraft('');
    void piSession.send(text);
    inputRef.current?.focus();
  };

  const brainButton = (id: PiBrain, label: string, hint: string, enabled = true) => (
    <button
      type="button"
      disabled={!enabled || busy}
      onClick={() => piSession.setBrain(id)}
      title={hint}
      className={`rounded-sm px-2 py-0.5 text-[11px] disabled:opacity-40 ${brain === id ? 'bg-ink/10 font-semibold text-ink' : 'text-muted hover:text-ink'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface text-ink">
      <div className="flex shrink-0 items-center gap-1 border-b border-borderFolk px-2 py-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">Thinks with</span>
        {brainButton('local', 'This machine', `${PI_LOCAL_MODEL_ID} on WebGPU: private, no key; downloads ${PI_LOCAL_DOWNLOAD} once`)}
        {brainButton('api', 'Cloud model', apiOk ? 'The Brain API model from the settings' : 'Set a Brain API (address and model) in the settings first', apiOk)}
        <button type="button" onClick={() => piSession.newChat()} className="ml-auto rounded-sm px-1.5 py-0.5 text-[11px] text-muted hover:text-ink" title="Start a new conversation">
          New chat
        </button>
      </div>

      {brain === 'local' && !localReady && (
        <div className="m-2 shrink-0 rounded border border-dashed border-borderFolk p-2.5 text-[12px] leading-relaxed">
          <p>
            Pi can run entirely on this machine with <b>LFM3-1.7B</b> on WebGPU: nothing you write leaves the browser. The first time, it downloads{' '}
            {PI_LOCAL_DOWNLOAD} and keeps it for next time.
          </p>
          {local.status === 'loading' ? (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                <div className="h-full bg-ink/60 transition-[width]" style={{ width: `${Math.round(local.fraction * 100)}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {local.message} {local.fraction > 0 ? `${Math.round(local.fraction * 100)}%` : ''}
              </p>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => void localPi.load().catch(() => {})} className="rounded-sm border border-borderFolk bg-card px-2 py-1 text-[12px] font-semibold hover:bg-ink/5">
                Download Pi ({PI_LOCAL_DOWNLOAD})
              </button>
              {apiOk && (
                <button type="button" onClick={() => piSession.setBrain('api')} className="text-[11px] text-muted underline hover:text-ink">
                  or use the cloud model
                </button>
              )}
            </div>
          )}
          {local.status === 'error' && <p className="mt-1 text-[11px] text-crimson">{local.message}</p>}
          <p className="mt-2 text-[10px] text-muted">Model weights: Liquid AI LFM3-1.7B, under its own licence. Needs a recent Chrome or Edge with WebGPU.</p>
        </div>
      )}

      <div ref={listRef} className="thin-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 py-2 text-[12.5px] leading-relaxed">
        {items.length === 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-muted">
              Pi builds and runs this world with you: places, people, what is going on. Ask in your own words, or start with one of these.
            </p>
            <div className="flex flex-wrap gap-1">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!canTalk || busy}
                  onClick={() => send(s)}
                  className="rounded-full border border-borderFolk px-2 py-0.5 text-[11px] text-ink hover:bg-ink/5 disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((it) =>
          it.kind === 'user' ? (
            <div key={it.id} className="ml-6 rounded bg-ink/[0.06] px-2 py-1 whitespace-pre-wrap">
              {it.text}
            </div>
          ) : it.kind === 'pi' ? (
            <div key={it.id} className="mr-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Pi</div>
              <MiniMarkdown text={it.text + (it.streaming ? ' ▍' : '')} className="break-words" />
            </div>
          ) : it.kind === 'tool' ? (
            <div key={it.id} className="flex items-start gap-1 text-[11px] text-muted" title={it.detail}>
              <span aria-hidden className={it.ok === false ? 'text-crimson' : ''}>
                {it.ok === undefined ? '…' : it.ok ? '✓' : '✗'}
              </span>
              <span className="min-w-0">
                {it.label}
                {it.detail && <span className="block text-crimson/80">{it.detail}</span>}
              </span>
            </div>
          ) : (
            <div key={it.id} className={`text-[11px] ${it.error ? 'text-crimson' : 'text-muted'}`}>
              {it.text}
            </div>
          ),
        )}
      </div>

      <form
        className="shrink-0 border-t border-borderFolk p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={2}
          disabled={!canTalk}
          placeholder={canTalk ? 'Tell Pi what you want to make or change…' : brain === 'api' ? 'Set a Brain API in the settings first' : 'Download Pi above to start'}
          aria-label="Message Pi"
          className="w-full resize-none rounded border border-borderFolk bg-card px-2 py-1.5 text-[12.5px] leading-relaxed text-ink placeholder:text-muted focus:outline-none disabled:opacity-50"
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
          <span>Every change can be undone (the undo arrow, top right).</span>
          {busy ? (
            <button type="button" onClick={() => piSession.stop()} className="rounded-sm border border-borderFolk px-2 py-0.5 text-[11px] text-ink hover:bg-ink/5">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!canTalk || !draft.trim()} className="rounded-sm border border-borderFolk px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-ink/5 disabled:opacity-40">
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
