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
