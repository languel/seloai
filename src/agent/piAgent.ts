/**
 * Pi: the in-app agent. It talks with the person and builds the world with the same tools
 * an outside agent gets over MCP, in a loop: the model answers, may call tools, sees their
 * results, and goes on until it has something to say back (or a round limit is reached).
 *
 * The events follow the Pi agent's vocabulary (agent_start, turn_start, message_update,
 * tool_execution_start/end, agent_end), so a Pi-style interface can show them as they come.
 */
import { AUTHORING_TOOL_DEFINITIONS, PI_TOOL_NAMES } from '../api/authoringTools';
import type { SeloToolDefinition } from '../api/seloToolRegistry';
import type { PiActivity, PiMessage, PiModel, PiToolCall, PiToolSpec } from './piModel';

/** Kept short and stable: a small model follows it better, and it stays cached between turns. */
export const PI_INSTRUCTIONS = `You are Pi, the helper inside SeloAI, a living story world drawn as folk embroidery. You help the person make and run their own world: a place, its people, and what is going on.

How to work:
- Use the tools to make changes. Never claim you changed something without calling a tool.
- Call story_overview first to see what there is.
- Work in small steps. After a step, say in one or two sentences what you made, then ask one short question or offer the next step.
- Suggest concrete ideas the person can take or change. Keep everything original.
- To make a world: new_world (a place), set_story (place name, premise with a problem in it, opening), add_place for 3 to 6 places, add_character for 3 to 6 people whose wants pull against each other (give each a voice like "female, Greek" and a home near a place), then start_story.
- Say "near" places and things ("by the river") rather than coordinates.
- If a tool fails, read the error and try once differently; do not repeat the same call.
- Keep replies short and plain.`;

export type PiEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start'; round: number }
  | { type: 'message_update'; delta: string }
  | { type: 'activity'; activity: PiActivity }
  | { type: 'message_end'; message: Extract<PiMessage, { role: 'assistant' }> }
  | { type: 'tool_execution_start'; call: PiToolCall; label: string }
  | { type: 'tool_execution_end'; call: PiToolCall; label: string; ok: boolean; summary: string }
  | { type: 'agent_end'; reason: 'done' | 'max_rounds' | 'cancelled' | 'error' | 'silent' | 'too_long'; error?: string };

export type PiToolSet = 'small' | 'full';

/** The tool list offered to the model: the small set for local models, more for strong ones. */
export function piToolSpecs(all: SeloToolDefinition[], set: PiToolSet): PiToolSpec[] {
  const wanted = new Set<string>(
    set === 'small'
      ? PI_TOOL_NAMES
      : [...AUTHORING_TOOL_DEFINITIONS.map((t) => t.name).filter((n) => n !== 'authoring_guide'), 'instruct_world', 'remove_character', 'undo_world_edit', 'redo_world_edit', 'control_simulation'],
  );
  return all
    .filter((t) => wanted.has(t.name))
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}

/** A few words for the panel: what the call does. */
export function toolCallLabel(call: PiToolCall): string {
  const a = call.function.arguments as Record<string, unknown>;
  const what = [a.name, a.place, a.kind, a.thing, a.text].find((v) => typeof v === 'string' && v.trim());
  const nice = call.function.name.replace(/_/g, ' ');
  return what ? `${nice}: ${String(what).slice(0, 60)}` : nice;
}

/** A tool result as text for the model: compact JSON, pictures left out, long results cut. */
export function toolResultText(result: unknown, limit = 3000): string {
  const clean = JSON.stringify(result, (key, value) => (key === 'image' && typeof value === 'string' ? '[picture shown to the person]' : value));
  const text = clean ?? 'ok';
  return text.length > limit ? `${text.slice(0, limit)}… (cut; ask for less)` : text;
}

export interface PiAgentOptions {
  model: PiModel;
  tools: PiToolSpec[];
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  instructions?: string;
  maxRounds?: number;
}

export class PiAgent {
  messages: PiMessage[];
  private running = false;

  constructor(private options: PiAgentOptions) {
    this.messages = [{ role: 'system', content: options.instructions ?? PI_INSTRUCTIONS }];
  }

  get busy() {
    return this.running;
  }

  setModel(model: PiModel, tools?: PiToolSpec[]) {
    this.options = { ...this.options, model, ...(tools ? { tools } : {}) };
  }

  /** Start a new conversation (keeps the instructions). */
  clear() {
    this.messages = this.messages.slice(0, 1);
  }

  async send(text: string, onEvent: (e: PiEvent) => void, signal?: AbortSignal): Promise<void> {
    if (this.running) throw new Error('Pi is still working on the last message.');
    this.running = true;
    this.messages.push({ role: 'user', content: text });
    onEvent({ type: 'agent_start' });
    const failed = new Set<string>();
    const maxRounds = this.options.maxRounds ?? 12;
    let usedTools = false;
    let nudged = false;
    try {
      for (let round = 1; round <= maxRounds; round++) {
        if (signal?.aborted) return onEvent({ type: 'agent_end', reason: 'cancelled' });
        onEvent({ type: 'turn_start', round });
        const turn = await this.options.model.complete(this.messages, this.options.tools, { signal, onText: (delta) => onEvent({ type: 'message_update', delta }), onActivity: (activity) => onEvent({ type: 'activity', activity }) });
        this.messages.push(turn.message);
        onEvent({ type: 'message_end', message: turn.message });
        if (turn.finish === 'cancelled') return onEvent({ type: 'agent_end', reason: 'cancelled' });
        const calls = turn.message.tool_calls ?? [];
        if (turn.finish !== 'tool_calls' || calls.length === 0) {
          // Some models finish silently after tools (all in their hidden reasoning): ask once
          // for a word back, so the person always hears what was done.
          if (usedTools && !nudged && !turn.message.content.trim() && round < maxRounds) {
            nudged = true;
            this.messages.pop();
            this.messages.push({ role: 'user', content: '(Now tell me in one or two sentences what you did, and what you suggest next.)' });
            continue;
          }
          if (!turn.message.content.trim()) {
            // Never leave the person with nothing: say why there is no answer.
            this.messages.pop();
            return onEvent({ type: 'agent_end', reason: turn.finish === 'length' ? 'too_long' : 'silent' });
          }
          return onEvent({ type: 'agent_end', reason: turn.finish === 'length' ? 'too_long' : 'done' });
        }
        usedTools = true;
        for (const call of calls) {
          const label = toolCallLabel(call);
          onEvent({ type: 'tool_execution_start', call, label });
          const key = `${call.function.name}:${JSON.stringify(call.function.arguments)}`;
          let content: string;
          let ok = false;
          if (call.errors?.length) content = `Error: ${call.errors.join('; ')}`;
          else if (failed.has(key)) content = 'Error: this exact call already failed. Change the arguments or do something else.';
          else {
            try {
              content = toolResultText(await this.options.runTool(call.function.name, call.function.arguments));
              ok = true;
            } catch (err) {
              failed.add(key);
              content = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
          this.messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content });
          onEvent({ type: 'tool_execution_end', call, label, ok, summary: content.slice(0, 200) });
        }
      }
      onEvent({ type: 'agent_end', reason: 'max_rounds' });
    } catch (err) {
      if (signal?.aborted) onEvent({ type: 'agent_end', reason: 'cancelled' });
      else onEvent({ type: 'agent_end', reason: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
    }
  }
}
