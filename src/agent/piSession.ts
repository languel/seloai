/**
 * Pi's conversation in the app: one session that outlives the panel (closing the panel or
 * switching tabs keeps the chat), with the transcript the panel shows.
 */
import { SELO_TOOL_DEFINITIONS, seloToolHost } from '../api/seloToolRegistry';
import type { ModelSettings } from '../engine/types';
import { PiAgent, piToolSpecs, type PiEvent } from './piAgent';
import { apiPiModel, localPiModel, type PiModel } from './piModel';

export type PiItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'pi'; text: string; streaming?: boolean }
  | { id: number; kind: 'tool'; label: string; ok?: boolean; detail?: string }
  | { id: number; kind: 'note'; text: string; error?: boolean };

/** An item before it has an id (Omit spread over each kind). */
type NewItem = PiItem extends infer T ? (T extends PiItem ? Omit<T, 'id'> : never) : never;

export type PiBrain = 'local' | 'api';
const BRAIN_KEY = 'seloai:pi-brain';

class PiSession {
  items: PiItem[] = [];
  busy = false;
  brain: PiBrain;
  private nextId = 1;
  private listeners = new Set<() => void>();
  private agent: PiAgent;
  private abort: AbortController | null = null;
  private getSettings: () => ModelSettings = () => {
    throw new Error('Pi is not connected to the app yet.');
  };
  private version = 0;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(BRAIN_KEY);
    } catch {
      // storage unavailable
    }
    this.brain = saved === 'api' ? 'api' : 'local';
    this.agent = new PiAgent({ model: this.model(), tools: this.tools(), runTool: (name, args) => seloToolHost.callTool(name, args) });
  }

  connect(getSettings: () => ModelSettings) {
    this.getSettings = getSettings;
  }

  /** Whether the settings name a cloud model Pi could use. */
  apiAvailable(): boolean {
    try {
      const s = this.getSettings();
      return Boolean(s.localApiUrl && s.localApiModel && s.localApiProvider !== 'gemini');
    } catch {
      return false;
    }
  }

  private model(): PiModel {
    return this.brain === 'api' ? apiPiModel(() => this.getSettings()) : localPiModel;
  }

  private tools() {
    return piToolSpecs(SELO_TOOL_DEFINITIONS, this.brain === 'api' ? 'full' : 'small');
  }

  setBrain(brain: PiBrain) {
    if (brain === this.brain || this.busy) return;
    this.brain = brain;
    try {
      localStorage.setItem(BRAIN_KEY, brain);
    } catch {
      // storage unavailable
    }
    this.agent.setModel(this.model(), this.tools());
    this.changed();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** For useSyncExternalStore: changes whenever anything shown changes. */
  snapshot = () => this.version;

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private push(item: NewItem) {
    this.items = [...this.items, { ...item, id: this.nextId++ } as PiItem];
    this.changed();
  }

  private patchLast(kind: PiItem['kind'], patch: (item: PiItem) => PiItem) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].kind === kind) {
        const next = [...this.items];
        next[i] = patch(next[i]);
        this.items = next;
        this.changed();
        return;
      }
    }
  }

  newChat() {
    if (this.busy) this.stop();
    this.agent.clear();
    this.items = [];
    this.changed();
  }

  stop() {
    this.abort?.abort();
  }

  async send(text: string) {
    const clean = text.trim();
    if (!clean || this.busy) return;
    this.busy = true;
    this.abort = new AbortController();
    this.push({ kind: 'user', text: clean });
    let streaming = false;
    const onEvent = (e: PiEvent) => {
      switch (e.type) {
        case 'turn_start':
          streaming = false;
          break;
        case 'message_update':
          if (!streaming) {
            streaming = true;
            this.push({ kind: 'pi', text: e.delta, streaming: true });
          } else this.patchLast('pi', (it) => (it.kind === 'pi' ? { ...it, text: it.text + e.delta } : it));
          break;
        case 'message_end': {
          const content = e.message.content.trim();
          if (streaming) this.patchLast('pi', (it) => (it.kind === 'pi' ? { ...it, text: content || it.text, streaming: false } : it));
          else if (content) this.push({ kind: 'pi', text: content });
          streaming = false;
          break;
        }
        case 'tool_execution_start':
          this.push({ kind: 'tool', label: e.label });
          break;
        case 'tool_execution_end':
          this.patchLast('tool', (it) => (it.kind === 'tool' ? { ...it, ok: e.ok, detail: e.ok ? undefined : e.summary.replace(/^Error:\s*/, '') } : it));
          break;
        case 'agent_end':
          if (e.reason === 'error') this.push({ kind: 'note', text: e.error ?? 'Something went wrong.', error: true });
          else if (e.reason === 'max_rounds') this.push({ kind: 'note', text: 'Pi stopped after many steps. Say "go on" to continue.' });
          else if (e.reason === 'cancelled') this.push({ kind: 'note', text: 'Stopped.' });
          else if (e.reason === 'too_long') this.push({ kind: 'note', text: 'Pi ran out of room for that answer. Ask for less at once (say, one part at a time).' });
          else if (e.reason === 'silent') this.push({ kind: 'note', text: 'Pi did not put an answer into words. Ask again, perhaps more simply.' });
          break;
        default:
          break;
      }
    };
    try {
      await this.agent.send(clean, onEvent, this.abort.signal);
    } finally {
      this.busy = false;
      this.abort = null;
      this.changed();
    }
  }
}

export const piSession = new PiSession();
