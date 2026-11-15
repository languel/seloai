import type { VillageSimulation } from '../engine/simulation';

let lastStepMs = 0;

/** How long the most recent simulation step took, for the performance readout. */
export function getLastSimStepMs(): number {
  return lastStepMs;
}

/**
 * Advances the simulation once per animation frame for as long as the app is open,
 * whichever workspace tab is showing. Returns a function that stops it.
 */
export function startSimulationDriver(getSimulation: () => VillageSimulation | null): () => void {
  let rafId = 0;
  let lastTime = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.5, now - lastTime) / 1000);
    lastTime = now;
    const sim = getSimulation();
    if (sim) {
      const startedAt = performance.now();
      sim.stepFrame(dt);
      lastStepMs = performance.now() - startedAt;
    }
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafId);
}
