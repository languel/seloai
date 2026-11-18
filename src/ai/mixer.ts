/**
 * A small mixer for everything the app says aloud, so a person or an agent can turn parts down,
 * mute them or fade them in: the characters' voices, the narrator (the Scribe), and the guide
 * (a walkthrough's narration in the Traveler's voice), each with its own level, under a master.
 * Every playback connects to its bus instead of the speakers; a level change ramps smoothly on
 * every audio context in use. The browser's built-in voice cannot be routed, so it takes the
 * level when a line starts.
 */

export type Bus = 'voices' | 'narrator' | 'guide';
export type MixerChannel = Bus | 'master';

const levels: Record<MixerChannel, number> = { voices: 1, narrator: 1, guide: 1, master: 1 };

interface ContextNodes {
  master: GainNode;
  buses: Partial<Record<Bus, GainNode>>;
}
const contexts = new Map<AudioContext, ContextNodes>();

const listeners = new Set<() => void>();
let version = 0;
export const subscribeMixer = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const mixerVersion = () => version;

/** Which bus a speaker belongs on: the narrator, the Traveler (the guide), or a character. */
export function busFor(speaker: { id: string; role?: string }): Bus {
  if (speaker.id === 'narrator') return 'narrator';
  if (speaker.role === 'Traveler') return 'guide';
  return 'voices';
}

function nodesFor(ctx: AudioContext): ContextNodes {
  for (const [c] of contexts) if (c.state === 'closed') contexts.delete(c);
  let nodes = contexts.get(ctx);
  if (!nodes) {
    const master = ctx.createGain();
    master.gain.value = levels.master;
    master.connect(ctx.destination);
    nodes = { master, buses: {} };
    contexts.set(ctx, nodes);
  }
  return nodes;
}

/** Where a playback on `ctx` should connect for `bus` (in place of the speakers). */
export function busInput(ctx: AudioContext, bus: Bus): AudioNode {
  const nodes = nodesFor(ctx);
  let gain = nodes.buses[bus];
  if (!gain) {
    gain = ctx.createGain();
    gain.gain.value = levels[bus];
    gain.connect(nodes.master);
    nodes.buses[bus] = gain;
  }
  return gain;
}

/** The level a line on `bus` plays at, master included (for the browser's own voice). */
export function effectiveLevel(bus: Bus): number {
  return levels[bus] * levels.master;
}

export function mixerLevels(): Record<MixerChannel, number> {
  return { ...levels };
}

/** Sets a channel's level (0 to 1), ramping over `fadeSeconds` (0: at once). */
export function setLevel(channel: MixerChannel, level: number, fadeSeconds = 0) {
  const value = Math.max(0, Math.min(1, level));
  levels[channel] = value;
  for (const [ctx, nodes] of contexts) {
    if (ctx.state === 'closed') continue;
    const node = channel === 'master' ? nodes.master : nodes.buses[channel];
    if (!node) continue;
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    if (fadeSeconds > 0) node.gain.linearRampToValueAtTime(value, now + fadeSeconds);
    else node.gain.setValueAtTime(value, now);
  }
  version++;
  for (const fn of listeners) fn();
}
