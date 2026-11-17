import { describe, expect, it } from 'vitest';
import { createBrowserSimulation } from '../../app/browserSimulation';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { findNamedCharacter, nameForms, shortName } from '../names';

const cast = [
  { id: 'stoyan', name: 'Stoyan Yunak' },
  { id: 'lamia', name: 'Lamia Zmeitsa' },
  { id: 'rada', name: 'Baba Rada' },
  { id: 'marin', name: 'Kuker Marin', callNames: ['Marincho'] },
];

describe('names said in passing', () => {
  it('finds a character by first name, a called-out form, or a fond one', () => {
    expect(findNamedCharacter('go to Stoyan', cast)?.id).toBe('stoyan');
    expect(findNamedCharacter('Stoyane, come here!', cast)?.id).toBe('stoyan');
    expect(findNamedCharacter('find Lamio by the well', cast)?.id).toBe('lamia');
    expect(findNamedCharacter('ask Rada about it', cast)?.id).toBe('rada');
    expect(findNamedCharacter('where is Marincho', cast)?.id).toBe('marin');
    expect(findNamedCharacter('go to Stoyan Yunak', cast)?.id).toBe('stoyan');
  });

  it('does not match titles alone, ordinary words, or the speaker', () => {
    expect(findNamedCharacter('go see baba', cast)).toBeUndefined();
    expect(findNamedCharacter('the stone is cold', cast)).toBeUndefined();
    expect(findNamedCharacter('go to Stoyan', cast, 'stoyan')).toBeUndefined();
    expect(nameForms({ name: 'Baba Rada' })).toEqual(['rada']);
  });

  it('picks the first character named', () => {
    expect(findNamedCharacter('take Lamia to Stoyan', cast)?.id).toBe('lamia');
  });

  it('gives the short name people use', () => {
    expect(shortName({ name: 'Stoyan Yunak' })).toBe('Stoyan');
    expect(shortName({ name: 'Baba Rada' })).toBe('Rada');
    expect(shortName({ name: 'Kuker Marin', callNames: ['Marincho'] })).toBe('Marincho');
  });
});

describe('sending a character to someone', () => {
  it('walks them to the person named by first name, then has them talk', async () => {
    const sim = createBrowserSimulation(createDefaultMap(), DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
      enableWebSpeechFallback: false,
      proximityRadiusTiles: 0,
    });
    const [a, b] = DEFAULT_VILLAGERS;
    const first = b.name.split(/\s+/).find((w) => w.length >= 3 && !/^(baba|dyado|bai)$/i.test(w))!;
    const rtA = sim.runtimes.get(a.id)!;
    const rtB = sim.runtimes.get(b.id)!;
    const startDist = Math.hypot(rtA.x - rtB.x, rtA.y - rtB.y);
    expect(startDist).toBeGreaterThan(2);

    const reply = sim.sendUserTextToVillager(a.id, `go to ${first}`, false);
    await new Promise((r) => setTimeout(r, 0));
    expect(rtA.errand?.targetId).toBe(b.id);
    expect(rtA.path.length).toBeGreaterThan(0);
    // They set off while still answering.
    const before = { x: rtA.x, y: rtA.y };
    for (let i = 0; i < 10; i++) sim.stepFrame(0.05);
    expect(Math.hypot(rtA.x - before.x, rtA.y - before.y)).toBeGreaterThan(0);
    await reply;

    for (let i = 0; i < 1200 && Math.hypot(rtA.x - rtB.x, rtA.y - rtB.y) > 1.7; i++) sim.stepFrame(0.05);
    expect(Math.hypot(rtA.x - rtB.x, rtA.y - rtB.y)).toBeLessThanOrEqual(2.2);
  });
});

describe('sending a character to a thing or a place', () => {
  it('goes to the nearest river, tree or house named in plain words', async () => {
    const { createZmeyovoDemoMap } = await import('../../world/packs/zmeyovo');
    const { bakeScene } = await import('../../world/worldScene');
    const map = createZmeyovoDemoMap();
    const model = bakeScene(map.scene!).model;
    const sim = createBrowserSimulation(map, DEFAULT_VILLAGERS, [], {
      ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', enableWebSpeechFallback: false, proximityRadiusTiles: 0, autoConverse: false,
    });
    const a = DEFAULT_VILLAGERS[0];
    const rt = sim.runtimes.get(a.id)!;
    for (const [said, near] of [
      ['go to the river', (x: number, y: number) => [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => model.terrain[x + dx]?.[y + dy] === 'water')],
      ['walk over to a tree', (x: number, y: number) => model.features.some((f) => ['tree', 'pine', 'grove', 'sapling'].includes(f.kind) && x >= f.x - 1.5 && x <= f.x + f.w + 0.5 && y >= f.y - 1.5 && y <= f.y + f.h + 0.5)],
    ] as const) {
      const reply = sim.sendUserTextToVillager(a.id, said, false);
      await new Promise((r) => setTimeout(r, 0));
      expect(rt.path.length).toBeGreaterThan(0);
      const end = rt.path[rt.path.length - 1];
      expect(near(end.x, end.y)).toBe(true);
      await reply;
      rt.path = [];
    }
    const other = DEFAULT_VILLAGERS[1];
    const first = other.name.split(/\s+/).find((w) => w.length >= 3 && !/^(baba|dyado|bai)$/i.test(w))!;
    const reply = sim.sendUserTextToVillager(a.id, `go to ${first}'s house`, false);
    await new Promise((r) => setTimeout(r, 0));
    const end = rt.path[rt.path.length - 1];
    expect(Math.hypot(end.x - other.homeTile.x, end.y - other.homeTile.y)).toBeLessThan(3);
    expect(rt.errand).toBeUndefined();
    await reply;
  });
});

describe('the listener is not the destination', () => {
  it('drops @-mentions and the listener\'s own name from an order', async () => {
    const { withoutAddress } = await import('../names');
    expect(withoutAddress('@Lamia go to the river', { name: 'Lamia Zmeitsa' }).trim()).toBe('go to the river');
    expect(withoutAddress('Lamio, go to Stoyan', { name: 'Lamia Zmeitsa' })).not.toMatch(/lami/i);
    expect(withoutAddress('Lamio, go to Stoyan', { name: 'Lamia Zmeitsa' })).toMatch(/Stoyan/);
  });
});
