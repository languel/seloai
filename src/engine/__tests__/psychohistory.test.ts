import { describe, expect, it } from 'vitest';
import { findWorldPack } from '../../world/packs';
import { buildPsychohistory } from '../psychohistory';
import { createLayout, stepLayout, syncLayout } from '../psychohistoryLayout';

const village = async () => {
  const { VillageSimulation } = await import('../simulation');
  const { createSilentMind } = await import('../../headless/silentMind');
  const { createSeededRng } = await import('../../core/rng');
  const { DEFAULT_MODEL_SETTINGS } = await import('../../data/defaultData');
  const pack = findWorldPack('balkan-myth')!.build();
  return new VillageSimulation(structuredClone(pack.map), structuredClone(pack.cast!), [], { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim' }, { mind: createSilentMind(), world: pack.context, rng: createSeededRng(2), timers: 'sim' });
};

describe('Psychohistory: the world as it stands', () => {
  it('has a node for every person and place, and ties them by where they are and what they keep to', async () => {
    const sim = await village();
    const web = buildPsychohistory(sim);
    expect(web.nodes.filter((n) => n.kind === 'character').length).toBe(sim.configs.size);
    expect(web.nodes.filter((n) => n.kind === 'place').length).toBe(sim.map.pointsOfInterest!.length);
    // The Lamia keeps to her well.
    const keeps = web.links.find((l) => l.kind === 'keeps' && l.source === 'lamia');
    expect(keeps?.note).toMatch(/keeps to the Well/);
    // Everyone near a place is tied to it.
    expect(web.links.some((l) => l.kind === 'at')).toBe(true);
    // Every thread joins two nodes that exist.
    const ids = new Set(web.nodes.map((n) => n.id));
    for (const l of web.links) expect(ids.has(l.source) && ids.has(l.target)).toBe(true);
  });

  it('puts on a character’s mind the people and places in what they mean to do', async () => {
    const sim = await village();
    const rt = sim.runtimes.get('baba-rada')!;
    rt.currentIntention = 'Take honey to Stoyan Yunak at the Kukeri Fire Hearth';
    const web = buildPsychohistory(sim);
    const minded = web.links.filter((l) => l.kind === 'thinks' && l.source === 'baba-rada').map((l) => l.target);
    expect(minded).toContain('stoyan');
    expect(minded.some((t) => t.startsWith('place:'))).toBe(true);
  });

  it('settles: threads draw what they join together, places stay near the map, pinned nodes stay put', async () => {
    const sim = await village();
    const web = buildPsychohistory(sim);
    const layout = createLayout();
    syncLayout(layout, web.nodes);
    const pinnedId = web.nodes[0].id;
    const pinned = layout.bodies.get(pinnedId)!;
    pinned.x += 20;
    pinned.pinned = true;
    const at = { x: pinned.x, y: pinned.y };
    for (let i = 0; i < 400; i++) stepLayout(layout, web.nodes, web.links);
    expect(layout.bodies.get(pinnedId)!.x).toBe(at.x);
    // Places stay near the map, except those tied to the node dragged away (they follow a little).
    const tied = new Set(web.links.filter((l) => l.source === pinnedId || l.target === pinnedId).flatMap((l) => [l.source, l.target]));
    for (const n of web.nodes.filter((n) => n.kind === 'place' && !tied.has(n.id))) {
      const b = layout.bodies.get(n.id)!;
      expect(Math.hypot(b.x - n.mapX, b.y - n.mapY)).toBeLessThan(12);
    }
    for (const l of web.links.filter((l) => l.kind === 'at' && l.source !== pinnedId)) {
      const a = layout.bodies.get(l.source)!;
      const b = layout.bodies.get(l.target)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(8);
    }
    for (const b of layout.bodies.values()) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
  });
});

describe('Psychohistory looking back', () => {
  it('as of a moment: where people were then, and only the talk that had happened by then', async () => {
    const sim = await village();
    const well = sim.map.pointsOfInterest!.find((p) => /well/i.test(p.label))!;
    const far = sim.map.pointsOfInterest!.find((p) => Math.hypot(p.x - well.x, p.y - well.y) > 8)!;
    const frames = new Map([
      [
        'baba-rada',
        [
          { t: 1_000, x: well.x, y: well.y, state: 'idle', intention: 'Wait by the well', errand: null, goal: null },
          { t: 9_000, x: far.x, y: far.y, state: 'walking', intention: 'Go home', errand: null, goal: null },
        ],
      ],
    ]);
    sim.conversations = [
      {
        id: 'c1',
        participantIds: ['baba-rada', 'stoyan'],
        startedAt: 5_000,
        updatedAt: 6_000,
        active: false,
        messages: [
          { id: 'm1', senderId: 'baba-rada', senderName: 'Baba Rada', text: 'Good morning.', timestamp: 5_000 },
          { id: 'm2', senderId: 'stoyan', senderName: 'Stoyan', text: 'And to you.', timestamp: 6_000 },
        ],
      },
    ] as never;
    const before = buildPsychohistory(sim, Date.now(), { t: 3_000, frames });
    expect(before.at).toBe(3_000);
    expect(before.links.some((l) => l.kind === 'talked')).toBe(false);
    expect(before.links.find((l) => l.kind === 'at' && l.source === 'baba-rada')?.target).toBe(`place:${well.id}`);
    expect(before.nodes.find((n) => n.id === 'baba-rada')).toMatchObject({ state: 'idle', intention: 'Wait by the well' });
    const after = buildPsychohistory(sim, Date.now(), { t: 7_000, frames });
    expect(after.links.find((l) => l.kind === 'talked')?.note).toMatch(/2 lines/);
    const later = buildPsychohistory(sim, Date.now(), { t: 10_000, frames });
    expect(later.links.find((l) => l.kind === 'at' && l.source === 'baba-rada')?.target).not.toBe(`place:${well.id}`);
  });
});
