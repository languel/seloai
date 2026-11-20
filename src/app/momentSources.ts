/** Gathers the app's records into the sources `momentAt` reads (see `engine/moment.ts`). */
import { piSession } from '../agent/piSession';
import type { MomentLine, MomentSources } from '../engine/moment';
import type { VillageSimulation } from '../engine/simulation';
import { worldlineRecorderFor } from '../engine/worldlines';
import { villageMusic } from '../music/villageMusic';

export function linesOf(sim: VillageSimulation): MomentLine[] {
  const narrator = sim.modelSettings.narratorName || 'Scribe';
  const nameOf = (id: string) => (id === 'narrator' ? narrator : id === sim.player.id ? sim.player.name : sim.configs.get(id)?.name ?? id);
  const lines: MomentLine[] = [];
  for (const conv of sim.conversations) {
    for (const m of conv.messages) {
      const kind = m.kind === 'thought' ? 'thought' : m.kind === 'narration' || m.senderId === 'narrator' ? 'narration' : 'speech';
      lines.push({ t: m.timestamp, from: m.senderId, fromName: m.senderName || nameOf(m.senderId), kind, text: m.text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

export function spinnerRecord(): Array<{ t: number; kind: string; text: string }> {
  return piSession.items.map((it) => ({
    t: it.at,
    kind: it.kind,
    text: it.kind === 'tool' ? `${it.label}${it.ok === false ? ' (failed)' : ''}` : it.text,
  }));
}

export function momentSourcesFor(sim: VillageSimulation): MomentSources {
  const recorder = worldlineRecorderFor(sim);
  const { phrases, events } = villageMusic.score();
  return {
    characters: [...sim.configs.values()].map((c) => ({ id: c.id, name: c.name })),
    places: (sim.map.pointsOfInterest ?? []).map((p) => ({ id: p.id, label: p.label || p.tag, x: p.x, y: p.y })),
    lines: linesOf(sim),
    frames: recorder.frames,
    phrases,
    musicEvents: events,
    spinner: spinnerRecord(),
  };
}
