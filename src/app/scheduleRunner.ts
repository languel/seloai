/**
 * Fires the cues people place ahead of now on the Loom (see `engine/worldSchedule.ts`) when
 * the world clock reaches them, for as long as the app is open, whichever view is showing.
 * A message goes the way a person's message goes; a musical break gives the band the floor.
 */
import type { VillageSimulation } from '../engine/simulation';
import { scheduleFor, type ScheduledCue } from '../engine/worldSchedule';
import { villageMusic } from '../music/villageMusic';

/** Delivers one cue. Exported for the agent tools and for tests. */
export async function deliverCue(sim: VillageSimulation, cue: ScheduledCue): Promise<void> {
  if (cue.kind === 'note') return;
  if (cue.kind === 'music') {
    const hold = cue.holdSeconds ?? 30;
    if (!villageMusic.status().on) villageMusic.setEnabled(true);
    villageMusic.direct({ intensity: 0.85, urgent: true, holdSeconds: hold, reason: cue.text || 'a musical break' });
    // The story holds back while the band plays, then goes on (unless something else held it).
    if (!sim.holdStory) {
      sim.holdStory = true;
      const release = () => {
        sim.holdStory = false;
        sim.notify(true);
      };
      setTimeout(release, hold * 1000);
    }
    return;
  }
  const text = cue.text.trim();
  if (!text) return;
  if (cue.to === 'all') {
    await sim.sendUserAddressedMessage(undefined, /@(all|everyone|world|village)\b/i.test(text) ? text : `@all ${text}`);
  } else {
    await sim.sendUserAddressedMessage(cue.to || 'narrator', text);
  }
}

/** Starts watching the world clock; returns a function that stops it. */
export function startScheduleRunner(getSimulation: () => VillageSimulation | null, deliver = deliverCue): () => void {
  let seen: { sim: VillageSimulation; epoch: number; simMs: number } | null = null;
  const check = () => {
    const sim = getSimulation();
    if (!sim) return;
    const schedule = scheduleFor(sim);
    if (seen && seen.sim === sim && seen.epoch !== sim.clockEpoch) {
      // The clock started again: cues still to come keep the time they had left.
      schedule.rebase(seen.simMs, sim.simTimeMs);
    }
    seen = { sim, epoch: sim.clockEpoch, simMs: sim.simTimeMs };
    // Only while the world moves forward: winding back never sets a cue off.
    if (sim.paused || sim.speedMultiplier <= 0) return;
    for (const cue of schedule.takeDue(sim.simTimeMs)) {
      void deliver(sim, cue).catch((err) => console.warn('[schedule] could not deliver a cue', err));
    }
  };
  const timer = setInterval(check, 200);
  return () => clearInterval(timer);
}
