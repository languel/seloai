import { findNamedCharacter } from './names';
import { inferSentiment } from './observatory';
import { placeKey, placeRef } from './placeNames';
import type { VillageSimulation } from './simulation';

/**
 * Psychohistory: the world at this moment as a web of who and where. Where the Loom keeps the
 * record of time, this is the present state of things and how they stand to one another:
 * characters and places as nodes, and their relations as threads. Who has talked with whom and
 * in what tone, who is where, who is heading where, who keeps to a place, and whom and what
 * each has on their mind. Pure: read from the simulation, nothing written back.
 */

export type PsychoNodeKind = 'character' | 'place';

export interface PsychoNode {
  id: string;
  kind: PsychoNodeKind;
  label: string;
  /** A role for a character, a description for a place. */
  about: string;
  color: string;
  /** Where it is on the map, in cells. */
  mapX: number;
  mapY: number;
  /** A character's state now (walking, speaking, …). */
  state?: string;
  intention?: string;
  /** The tone of a character's own recent lines. */
  mood?: Tone;
  /** For a character who kept to a place and was released: why. */
  released?: string;
  /** How stirred a character is, 0 to 1 (speaking is the most). */
  activity: number;
  /** How many relations it has: the busier, the larger it is drawn. */
  degree: number;
}

export type Tone = 'warm' | 'tense' | 'curious' | 'neutral';

/**
 * - `talked`: two characters have talked (weight: how much; tone: how it went).
 * - `at`: a character is at a place now.
 * - `keeps`: a character keeps to a place (the Lamia and her well).
 * - `heading`: a character is on the way to a place or to someone.
 * - `thinks`: someone or somewhere is on a character's mind (in what they mean to do,
 *   remember or have said).
 */
export type RelationKind = 'talked' | 'at' | 'keeps' | 'heading' | 'thinks';
export const RELATION_KINDS: readonly RelationKind[] = ['talked', 'at', 'keeps', 'heading', 'thinks'];

export interface PsychoLink {
  id: string;
  kind: RelationKind;
  source: string;
  target: string;
  /** How strong, 0 to 1. */
  weight: number;
  tone?: Tone;
  /** When it last held or happened (ms). */
  lastAt: number;
  /** The relation in a sentence, for the inspector. */
  note: string;
}

export interface Psychohistory {
  at: number;
  nodes: PsychoNode[];
  links: PsychoLink[];
}

const AT_REACH = 4;
const PLACE_COLOR = '#c98a3b';

/** Builds the web of the world as it stands now. */
export function buildPsychohistory(sim: VillageSimulation, now = Date.now()): Psychohistory {
  const nodes: PsychoNode[] = [];
  const links = new Map<string, PsychoLink>();
  const places = (sim.map.pointsOfInterest ?? []).map((p) => ({ id: `place:${p.id}`, label: p.label || p.tag, tag: p.tag, x: p.x, y: p.y, about: p.description ?? '' }));
  const cast = [...sim.configs.values()];
  const nameOf = (id: string) => sim.configs.get(id)?.name ?? id;

  const add = (l: Omit<PsychoLink, 'id'>) => {
    const id = `${l.kind}:${l.source}:${l.target}`;
    const prev = links.get(id);
    if (prev) {
      prev.weight = Math.min(1, prev.weight + l.weight);
      prev.lastAt = Math.max(prev.lastAt, l.lastAt);
    } else links.set(id, { ...l, id });
  };

  const nearestPlace = (x: number, y: number, reach: number) => {
    let best: (typeof places)[number] | null = null;
    let bestD = reach;
    for (const p of places) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  const placeIn = (text: string) => {
    const t = text.toLowerCase();
    return places.filter((p) => (p.tag && t.includes(`#${p.tag.toLowerCase()}`)) || (placeKey(p.label).length > 3 && t.includes(placeKey(p.label))));
  };

  // Who has talked with whom, how much and in what tone.
  for (const conv of sim.conversations) {
    const people = conv.participantIds.filter((id) => sim.configs.has(id)).sort();
    if (people.length < 2) continue;
    const said = conv.messages.filter((m) => m.kind !== 'narration' && m.kind !== 'thought');
    if (!said.length) continue;
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const [a, b] = [people[i], people[j]];
        const id = `talked:${a}:${b}`;
        const prev = links.get(id);
        const texts = said.slice(-4).map((m) => m.text);
        const turns = (prev ? Math.round(prev.weight * 20) : 0) + said.length;
        const last = said[said.length - 1];
        links.set(id, {
          id,
          kind: 'talked',
          source: a,
          target: b,
          weight: Math.min(1, turns / 20),
          tone: inferSentiment([...(prev ? [prev.note] : []), ...texts]),
          lastAt: Math.max(prev?.lastAt ?? 0, conv.updatedAt),
          note: `${nameOf(a)} and ${nameOf(b)} have talked (${turns} line${turns === 1 ? '' : 's'}); last: "${last.text.slice(0, 90)}"`,
        });
      }
    }
  }

  for (const cfg of cast) {
    const rt = sim.runtimes.get(cfg.id);
    if (!rt) continue;
    const intention = rt.currentIntention || cfg.plan;
    const ownLines = sim.conversations.flatMap((c) => c.messages.filter((m) => m.senderId === cfg.id && m.kind === 'speech')).slice(-3);
    nodes.push({
      id: cfg.id,
      kind: 'character',
      label: cfg.name,
      about: cfg.role,
      color: cfg.accentColor,
      mapX: rt.x,
      mapY: rt.y,
      state: rt.state,
      intention,
      released: sim.releasedFrom(cfg.id) ?? undefined,
      mood: ownLines.length ? inferSentiment(ownLines.map((m) => m.text)) : undefined,
      activity: rt.state === 'speaking' ? 1 : rt.state === 'thinking' || rt.state === 'conversing' || rt.state === 'listening' ? 0.75 : rt.state === 'walking' ? 0.5 : 0.25,
      degree: 0,
    });

    // Where they are.
    const here = nearestPlace(rt.x, rt.y, AT_REACH);
    if (here) add({ kind: 'at', source: cfg.id, target: here.id, weight: 1, lastAt: now, note: `${cfg.name} is at ${placeRef(here.label)}` });

    // The place they keep to.
    const keeps = sim.keepsTo(cfg.id);
    const kept = keeps ? nearestPlace(keeps.x, keeps.y, 1.5) : null;
    if (kept) add({ kind: 'keeps', source: cfg.id, target: kept.id, weight: 1, lastAt: now, note: `${cfg.name} keeps to ${placeRef(kept.label)}` });

    // Where they are going: to someone, or to a place at the end of their path.
    if (rt.errand) {
      const target = sim.configs.get(rt.errand.targetId);
      if (target) add({ kind: 'heading', source: cfg.id, target: target.id, weight: 0.8, lastAt: now, note: `${cfg.name} is going to ${target.name}` });
    } else if (rt.path.length > 0) {
      const goal = rt.path[rt.path.length - 1];
      const to = nearestPlace(goal.x, goal.y, 3.5);
      if (to && to.id !== here?.id) add({ kind: 'heading', source: cfg.id, target: to.id, weight: 0.8, lastAt: now, note: `${cfg.name} is heading to ${placeRef(to.label)}` });
    }

    // Who and what is on their mind: what they mean to do, remember, and have said lately.
    const minded = [
      { text: intention, weight: 0.5, from: 'means to' },
      ...rt.memories.slice(-5).map((m) => ({ text: m.summary, weight: 0.2, from: 'remembers' })),
      ...ownLines.map((m) => ({ text: m.text, weight: 0.25, from: 'said' })),
    ];
    for (const { text, weight, from } of minded) {
      if (!text) continue;
      for (const p of placeIn(text)) {
        if (p.id === here?.id || p.id === kept?.id) continue;
        add({ kind: 'thinks', source: cfg.id, target: p.id, weight, lastAt: now, note: `${placeRef(p.label)} is on ${cfg.name}'s mind (${from}: "${text.slice(0, 80)}")` });
      }
      const other = findNamedCharacter(text, cast, cfg.id);
      if (other) add({ kind: 'thinks', source: cfg.id, target: other.id, weight, lastAt: now, note: `${other.name} is on ${cfg.name}'s mind (${from}: "${text.slice(0, 80)}")` });
    }
  }

  for (const p of places) {
    nodes.push({ id: p.id, kind: 'place', label: p.label, about: p.about, color: PLACE_COLOR, mapX: p.x, mapY: p.y, activity: 0, degree: 0 });
  }

  const list = [...links.values()];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const l of list) {
    const a = byId.get(l.source);
    const b = byId.get(l.target);
    if (a) a.degree++;
    if (b) b.degree++;
  }
  // A place is busy when people are there or bound for it.
  for (const n of nodes) if (n.kind === 'place') n.activity = Math.min(1, n.degree / 6);
  return { at: now, nodes, links: list.filter((l) => byId.has(l.source) && byId.has(l.target)) };
}
