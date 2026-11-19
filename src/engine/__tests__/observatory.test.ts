import { createBrowserSimulation } from '../../app/browserSimulation';
import { describe, expect, it } from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { buildWorldDatabase, queryWorldDatabase } from '../observatory';
import { buildPsychohistory } from '../psychohistory';

describe('Observatory', () => {
  it('supports worldline POV hopping, psychophysical graph building, and natural-language world DB queries', async () => {
    const map = createDefaultMap();
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      proximityRadiusTiles: 10,
      enableWebSpeechFallback: false,
    });

    const mara = DEFAULT_VILLAGERS[0];
    const bram = DEFAULT_VILLAGERS[1];
    const maraRt = sim.runtimes.get(mara.id)!;
    const bramRt = sim.runtimes.get(bram.id)!;
    const now = Date.now();

    sim.conversations.push({
      id: 'conv-artifact-1',
      participantIds: [mara.id, bram.id],
      startedAt: now - 3600_000,
      updatedAt: now - 3500_000,
      active: false,
      messages: [
        {
          id: 'm1',
          senderId: mara.id,
          senderName: mara.name,
          text: 'Have you seen the glowing artifact near #Plaza?',
          timestamp: now - 3550_000,
          kind: 'speech',
          source: 'story-sim',
        },
        {
          id: 'm2',
          senderId: bram.id,
          senderName: bram.name,
          text: 'The artifact hums like clockwork — I think it is a relic.',
          timestamp: now - 3500_000,
          kind: 'speech',
          source: 'story-sim',
        },
      ],
    });
    bramRt.memories.push({
      id: 'mem-art',
      timestamp: now - 3400_000,
      importance: 8,
      kind: 'reflection',
      summary: 'Believes the artifact beneath #Plaza is an ancient clockwork beacon.',
    });

    // 1. Worldline POV hopping shifts audio listener & Scribe focus
    sim.setFocalWorldline(mara.id);
    expect(sim.getListenerPosition()).toEqual({
      x: maraRt.x,
      y: maraRt.y,
      label: mara.name,
      villagerId: mara.id,
    });

    // 2. Psychohistory ties Mara and Bram by their talk
    const graph = buildPsychohistory(sim);
    expect(graph.nodes.some((n) => n.id === mara.id && n.kind === 'character')).toBe(true);
    expect(graph.links.some((l) => l.kind === 'talked' && [l.source, l.target].includes(mara.id) && [l.source, l.target].includes(bram.id))).toBe(true);

    // 3. Natural-language query finds Mara's partners & thoughts on the artifact in past day
    const allRows = buildWorldDatabase(sim);
    expect(allRows.length).toBeGreaterThanOrEqual(3);

    const res = queryWorldDatabase(
      sim,
      `who has ${mara.name} talked to in the past day and what do they think about the artifact?`,
      now,
    );
    expect(res.subjectVillager?.id).toBe(mara.id);
    expect(res.partners.some((p) => p.id === bram.id)).toBe(true);
    expect(res.matchingRecords.some((r) => r.text.toLowerCase().includes('artifact'))).toBe(true);
    expect(res.answerSummary).toContain(bram.name);
  });
});
