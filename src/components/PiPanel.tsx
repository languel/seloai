import { Mic, MicOff, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { localPi, PI_LOCAL_DOWNLOAD, PI_LOCAL_MODEL_ID, type LocalLoadProgress } from '../agent/piModel';
import { piSession, type PiBrain } from '../agent/piSession';
import MiniMarkdown from './MiniMarkdown';
import { MicRecorder } from '../ai/audioPipeline';
import { omniEngine } from '../ai/omniEngine';

/** The browser's own dictation, where there is one (Chrome, Edge, Safari). */
type Dictation = { start(): void; stop(): void; abort(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null; interimResults: boolean; continuous: boolean; lang: string };
function browserDictation(): Dictation | null {
  const w = window as unknown as { SpeechRecognition?: new () => Dictation; webkitSpeechRecognition?: new () => Dictation };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** A name being typed after @ or #: where it starts in the text, and what has been typed. */
function refAt(text: string, caret: number): { sign: '@' | '#'; start: number; query: string } | null {
  if (caret < 0) return null;
  const m = /(^|\s)([@#])([^\s@#]*)$/.exec(text.slice(0, caret));
  return m ? { sign: m[2] as '@' | '#', start: caret - m[3].length - 1, query: m[3] } : null;
}

/** A running stitch being sewn: Pi at work. */
function Sewing({ className }: { className?: string }) {
  return (
    <span className={`pi-stitch ${className ?? ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

const PHASE_WORDS = { reading: 'Reading', thinking: 'Thinking', writing: 'Writing', tool: 'Working' } as const;

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
export default function PiPanel({ people = [], places = [] }: { people?: string[]; places?: string[] }) {
  useSyncExternalStore(piSession.subscribe, piSession.snapshot);
  const [local, setLocal] = useState<LocalLoadProgress>(localPi.progress);
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [refIndex, setRefIndex] = useState(0);
  const [recording, setRecording] = useState<'omni' | 'browser' | null>(null);
  const [hearing, setHearing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const dictationRef = useRef<Dictation | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => localPi.subscribe(setLocal), []);
  // While Pi works, tick the elapsed time.
  const [, setTick] = useState(0);
  const working = piSession.busy;
  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, [working]);
  const status = piSession.status;
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

  // @ and #: a menu of the characters or places that match what is typed.
  const ref = refAt(draft, caret);
  const choices = ref ? (ref.sign === '@' ? people : places).filter((n) => n.toLowerCase().includes(ref.query.toLowerCase())).slice(0, 8) : [];
  const menuOpen = Boolean(ref && choices.length);
  const chosen = choices[Math.min(refIndex, choices.length - 1)];
  const pickRef = (name: string) => {
    if (!ref) return;
    const insert = `${ref.sign}${name} `;
    setDraft(draft.slice(0, ref.start) + insert + draft.slice(caret));
    const at = ref.start + insert.length;
    setCaret(at);
    setRefIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at, at);
    });
  };
  const insertSign = (sign: '@' | '#') => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, at);
    const insert = `${before && !/\s$/.test(before) ? ' ' : ''}${sign}`;
    setDraft(before + insert + draft.slice(el?.selectionEnd ?? at));
    setCaret(at + insert.length);
    setRefIndex(0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + insert.length, at + insert.length);
    });
  };

  // Voice: the local voice model writes down what was said when it is loaded, otherwise the
  // browser's own dictation. The words go into the box, to check before sending.
  const addWords = (words: string) => {
    const clean = words.trim();
    if (!clean) return;
    setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')} ${clean}` : clean));
    setCaret(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const toggleVoice = async () => {
    setVoiceError(null);
    if (recording === 'omni' && recorderRef.current) {
      setRecording(null);
      setHearing(true);
      try {
        const { audioBuffer, duration } = await recorderRef.current.stop();
        if (duration < 0.3) throw new Error('That was too short: hold on a little longer.');
        addWords((await omniEngine.transcribeAudio(audioBuffer)).text);
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : String(err));
      } finally {
        setHearing(false);
      }
      return;
    }
    if (recording === 'browser') {
      dictationRef.current?.stop();
      return;
    }
    if (omniEngine.isReady()) {
      try {
        recorderRef.current ??= new MicRecorder();
        await recorderRef.current.start();
        setRecording('omni');
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'The microphone could not be opened.');
      }
      return;
    }
    const dictation = browserDictation();
    if (!dictation) {
      setVoiceError('Voice input needs the village voice (LFM3-Omni) loaded, or a browser with dictation.');
      return;
    }
    dictation.lang = navigator.language || 'en-US';
    dictation.interimResults = false;
    dictation.continuous = false;
    dictation.onresult = (e: any) => addWords(Array.from(e.results as ArrayLike<any>).map((r: any) => r[0]?.transcript ?? '').join(' '));
    dictation.onerror = (e: any) => setVoiceError(e?.error === 'not-allowed' ? 'The microphone is blocked for this page.' : 'Dictation stopped.');
    dictation.onend = () => setRecording(null);
    dictationRef.current = dictation;
    dictation.start();
    setRecording('browser');
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
              Pi builds and runs this world with you: places, people, what is going on. Ask in your own words, by voice, or start with one of these.
              Every change can be undone with the undo arrow, top right.
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
              <span aria-hidden className={`inline-flex w-4 shrink-0 justify-center pt-[0.45em] ${it.ok === false ? 'text-crimson' : ''}`}>
                {it.ok === undefined ? <Sewing /> : <span className="-mt-[0.45em]">{it.ok ? '✓' : '✗'}</span>}
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
        {busy && status && status.phase !== 'tool' && (
          <div className="flex items-start gap-2 pt-0.5 text-[11px] text-muted" role="status" aria-live="polite">
            <Sewing className="mt-[0.55em] shrink-0 text-ink/70" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-ink/80">{PHASE_WORDS[status.phase]}…</span>
              <span className="ml-1.5 tabular-nums">{Math.max(0, Math.floor((Date.now() - status.since) / 1000))} s</span>
              {status.phase === 'reading' && status.fraction !== undefined && (
                <div className="mt-1 h-[2px] w-full overflow-hidden rounded-full bg-ink/10">
                  <div className="h-full bg-ink/50 transition-[width] duration-200" style={{ width: `${Math.round(status.fraction * 100)}%` }} />
                </div>
              )}
              {status.phase === 'thinking' && status.detail && <p className="mt-0.5 truncate italic opacity-70">{status.detail}</p>}
            </div>
          </div>
        )}
      </div>

      {/* The same message box as the Storyline's: a stitched patch, @ and # helpers, a stitched send. */}
      <form
        className="shrink-0 space-y-1.5 border-t border-borderFolk p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        {menuOpen && (
          <ul role="listbox" aria-label={ref?.sign === '@' ? 'Characters' : 'Places'} className="stitch-panel max-h-40 overflow-y-auto py-1 text-[12px]">
            {choices.map((name) => (
              <li
                key={name}
                role="option"
                aria-selected={name === chosen}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickRef(name);
                }}
                className={`relative cursor-pointer px-3 py-0.5 ${name === chosen ? 'bg-ink/[0.08] font-semibold' : 'hover:bg-ink/[0.05]'}`}
              >
                <span className="mr-1 text-muted">{ref?.sign}</span>
                {name}
              </li>
            ))}
          </ul>
        )}
        {/* A textarea cannot carry the stitched edge (it is drawn with ::before), so a patch holds it. */}
        <div className={`stitch-panel ${canTalk ? '' : 'opacity-60'}`}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (menuOpen && !e.nativeEvent.isComposing) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setRefIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length);
                  return;
                }
                if ((e.key === 'Enter' || e.key === 'Tab') && chosen) {
                  e.preventDefault();
                  pickRef(chosen);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setCaret(-1);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={3}
            disabled={!canTalk}
            placeholder={canTalk ? 'Tell Pi what you want to make or change…' : brain === 'api' ? 'Set a Brain API in the settings first' : 'Download Pi above to start'}
            aria-label="Message Pi"
            className="thin-scroll relative block min-h-[82px] max-h-[168px] w-full resize-none bg-transparent px-3 py-2.5 text-xs leading-relaxed text-ink placeholder:text-muted focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {(['@', '#'] as const).map((sign) => (
              <button
                key={sign}
                type="button"
                disabled={!canTalk}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertSign(sign)}
                aria-label={sign === '@' ? 'Name a character with @' : 'Name a place with #'}
                title={sign === '@' ? 'Insert @ to name a character' : 'Insert # to name a place'}
                className="glyph-button relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm font-display text-sm text-ink disabled:opacity-40"
              >
                {sign}
              </button>
            ))}
            <button
              type="button"
              disabled={!canTalk || hearing}
              onClick={() => void toggleVoice()}
              aria-pressed={Boolean(recording)}
              aria-label={recording ? 'Stop and write down what I said' : 'Speak to Pi'}
              title={recording ? 'Stop recording' : hearing ? 'Writing down what you said…' : 'Speak (the words go into the box)'}
              className={`glyph-button relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm disabled:opacity-40 ${recording ? 'glyph-on stitch-thread' : 'text-ink'}`}
            >
              {recording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className={`h-3.5 w-3.5 ${hearing ? 'animate-pulse' : ''}`} />}
            </button>
            <span className="stitch-muted truncate text-[10px]">
              Type <kbd className="font-mono">@</kbd> person · <kbd className="font-mono">#</kbd> place
            </span>
          </div>
          {busy ? (
            <button
              type="button"
              onClick={() => piSession.stop()}
              aria-label="Stop Pi"
              title="Stop"
              className="glyph-button glyph-on stitch-thread relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm"
            >
              <Square className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canTalk || !draft.trim()}
              aria-label="Send to Pi"
              title="Send"
              className="glyph-button glyph-on stitch-thread relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm disabled:opacity-45"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        {voiceError && <p className="text-[10px] text-crimson">{voiceError}</p>}
      </form>
    </div>
  );
}
