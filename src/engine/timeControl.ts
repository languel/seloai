/**
 * Pause and pace, shared by every place that offers them (the village toolbar, the Loom), so
 * they all move the same world clock and agree on what "resume" goes back to.
 */
import type { VillageSimulation } from './simulation';

const lastSpeed = new WeakMap<VillageSimulation, number>();

/** Whether the world is holding still (paused, or paced at zero). */
export function isStopped(sim: VillageSimulation): boolean {
  return sim.paused || Math.abs(sim.speedMultiplier) < 0.001;
}

/** The pace as a person reads it: 0 while paused. */
export function effectiveSpeed(sim: VillageSimulation): number {
  return sim.paused ? 0 : sim.speedMultiplier;
}

/** Pauses, or resumes at the last pace it ran at. */
export function togglePause(sim: VillageSimulation) {
  if (sim.paused) {
    if (Math.abs(sim.speedMultiplier) < 0.001) sim.speedMultiplier = lastSpeed.get(sim) || 1;
    sim.paused = false;
  } else {
    sim.paused = true;
  }
}

/** Sets the pace: negative winds back, 0 pauses. */
export function setSpeed(sim: VillageSimulation, speed: number) {
  if (Math.abs(speed) < 0.001) {
    sim.speedMultiplier = 0;
    sim.paused = true;
  } else {
    lastSpeed.set(sim, speed);
    sim.speedMultiplier = speed;
    sim.paused = false;
  }
}
