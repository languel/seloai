import { useState, useSyncExternalStore } from 'react';
import { brainRouter } from '../../ai/brainRouter';
import { piSession } from '../../agent/piSession';
import type { ModelSettings } from '../../engine/types';

/**
 * A question about what is in view (a probed moment, a phrase of music), put to the Scribe
 * (who answers here, without it entering the story) or to Spinner (who answers in its own
 * chat, and here as it does). `context` is the moment or phrase in words.
 */
export function AskBox({
  context,
  settings,
  placeholder,
  scribeLabel = 'Ask the Scribe',
  spinnerPreface,
}: {
  context: () => string;
  settings: ModelSettings;
  placeholder: string;
  scribeLabel?: string;
  /** How the message to Spinner begins, before the context. */
  spinnerPreface: string;
}) {
  const [question, setQuestion] = useState('');
  const [scribe, setScribe] = useState<{ q: string; a: string | null; error?: string } | null>(null);
  const [spinner, setSpinner] = useState<{ q: string; afterId: number; drafted: boolean } | null>(null);
  useSyncExternalStore(piSession.subscribe, piSession.snapshot);

  const askScribe = async () => {
    const q = question.trim();
    if (!q) return;
    setScribe({ q, a: null });
    try {
      const res = await brainRouter.generateNarratorReply({
        prompt: `${context()}\n\nA question about this, from the person running the story: ${q}\nAnswer about this moment only, plainly and briefly; you are looking back, not telling the story on.`,
        sceneContext: 'Looking back on a moment of the story from the Control Room',
        history: [],
        settings,
      });
      setScribe({ q, a: res.text });
    } catch (err) {
      setScribe({ q, a: null, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const askSpinner = () => {
    const q = question.trim();
    if (!q) return;
    const lastId = piSession.items[piSession.items.length - 1]?.id ?? 0;
    const how = piSession.ask(`${spinnerPreface}\n\n${context()}\n\nMy question: ${q}`);
    setSpinner({ q, afterId: lastId, drafted: how === 'drafted' });
  };

  const replies = spinner && !spinner.drafted ? piSession.items.filter((it) => it.id > spinner.afterId && (it.kind === 'pi' || it.kind === 'tool' || it.kind === 'note')) : [];

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        aria-label="Your question"
        placeholder={placeholder}
        className="w-full resize-y rounded-sm border border-borderFolk bg-transparent px-1.5 py-1"
      />
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={!question.trim() || (scribe !== null && scribe.a === null && !scribe.error)} onClick={() => void askScribe()} className="stitch-panel px-2 py-1 font-semibold disabled:opacity-40">
          {scribeLabel}
        </button>
        <button type="button" disabled={!question.trim()} onClick={askSpinner} className="stitch-panel px-2 py-1 font-semibold disabled:opacity-40">
          Ask Spinner
        </button>
      </div>
      {scribe && (
        <div className="leading-snug">
          <span className="stitch-muted">The Scribe: </span>
          {scribe.error ? <span className="stitch-thread">{scribe.error}</span> : scribe.a ?? <span className="stitch-muted italic">thinking…</span>}
        </div>
      )}
      {spinner && (
        <div className="leading-snug">
          <span className="stitch-muted">Spinner: </span>
          {spinner.drafted ? (
            <span className="stitch-muted">not ready yet; the question waits in Spinner's message box.</span>
          ) : replies.length === 0 ? (
            <span className="stitch-muted italic">{piSession.busy ? 'thinking…' : 'no answer yet'}</span>
          ) : (
            replies.map((it) => (
              <div key={it.id} className={it.kind === 'pi' ? '' : 'stitch-muted text-[10px]'}>
                {it.kind === 'tool' ? `↳ ${it.label}` : it.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
