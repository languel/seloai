/**
 * The moment probe: a second playhead a person places on the Loom to look back at one moment
 * (what the band played, where everyone was, how they seemed) and ask the Scribe or Spinner
 * about it. Shared, so Psychohistory shows the same moment the Loom is probing. Separate from
 * the live needle: the world can keep running while the probe stays put.
 */
type Listener = () => void;

let probeT: number | null = null;
const listeners = new Set<Listener>();

/** The probed moment (ms, the story's clock), or null when there is no probe. */
export function probeTime(): number | null {
  return probeT;
}

export function setProbe(t: number | null) {
  const next = t === null || !Number.isFinite(t) ? null : Math.round(t);
  if (next === probeT) return;
  probeT = next;
  for (const fn of listeners) fn();
}

export function subscribeProbe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
