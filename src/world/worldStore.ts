import { applyCommand, type WorldCommand } from './commands';
import type { WorldDocument } from './document';

export type WorldChangeReason = 'command' | 'undo' | 'redo' | 'reset';
export type WorldListener = (doc: WorldDocument, previous: WorldDocument | null, reason: WorldChangeReason) => void;

interface HistoryEntry {
  before: WorldDocument;
  after: WorldDocument;
  label: string;
}

const MAX_HISTORY = 100;

/**
 * Holds the authored world and is the single path for changing it. Because commands
 * return new documents that share unchanged parts, history is a list of document
 * references rather than deep copies.
 */
export class WorldStore {
  private doc: WorldDocument | null = null;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<WorldListener>();

  get document(): WorldDocument {
    if (!this.doc) throw new Error('The world has not been loaded yet.');
    return this.doc;
  }

  get isLoaded(): boolean {
    return this.doc !== null;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Labels of the changes that can be undone, most recent last. */
  get history(): string[] {
    return this.undoStack.map((entry) => entry.label);
  }

  subscribe(listener: WorldListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Loads a different world. Clears history: there is nothing to undo back into. */
  reset(doc: WorldDocument) {
    const previous = this.doc;
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.emit(previous, 'reset');
  }

  /** Applies one command as one undoable step. Throws WorldCommandError if it is invalid. */
  dispatch(command: WorldCommand, label?: string): WorldDocument {
    return this.dispatchAll([command], label ?? command.type);
  }

  /** Applies several commands as a single undoable step; if any is invalid, none is applied. */
  dispatchAll(commands: WorldCommand[], label = 'Edit'): WorldDocument {
    const before = this.document;
    let after = before;
    for (const command of commands) after = applyCommand(after, command);
    if (after === before) return before;
    this.doc = after;
    this.undoStack.push({ before, after, label });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.emit(before, 'command');
    return after;
  }

  undo(): string | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const previous = this.doc;
    this.doc = entry.before;
    this.redoStack.push(entry);
    this.emit(previous, 'undo');
    return entry.label;
  }

  redo(): string | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const previous = this.doc;
    this.doc = entry.after;
    this.undoStack.push(entry);
    this.emit(previous, 'redo');
    return entry.label;
  }

  private emit(previous: WorldDocument | null, reason: WorldChangeReason) {
    for (const listener of this.listeners) listener(this.doc!, previous, reason);
  }
}
