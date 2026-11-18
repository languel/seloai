import { afterAll, describe, expect, it } from 'vitest';
import { startHeadlessHost } from '../../headless/headlessHost';
import { seloToolHost, SELO_TOOL_DEFINITIONS } from '../seloToolRegistry';
import { AUTHORING_TOOL_DEFINITIONS, PI_TOOL_NAMES } from '../authoringTools';

const host = startHeadlessHost({ tickMs: 100 });
afterAll(() => host.stop());
const call = (name: string, args: Record<string, unknown> = {}) => seloToolHost.callTool(name, args);

describe('authoring tools', () => {
  it('are listed first, and every tool Pi uses exists', () => {
    expect(SELO_TOOL_DEFINITIONS.slice(0, AUTHORING_TOOL_DEFINITIONS.length).map((t) => t.name)).toEqual(AUTHORING_TOOL_DEFINITIONS.map((t) => t.name));
    const names = new Set(SELO_TOOL_DEFINITIONS.map((t) => t.name));
    for (const n of PI_TOOL_NAMES) expect(names.has(n)).toBe(true);
    // Schemas are plain JSON Schema objects.
    for (const t of SELO_TOOL_DEFINITIONS) expect(t.inputSchema.type).toBe('object');
  });

  it('make a whole new world, story and cast from plain steps, and run it', async () => {
    const guide = await call('authoring_guide');
    expect(guide.guide).toMatch(/add_character/);

    const kinds = await call('list_world_kinds');
    expect(kinds.kinds.map((k: { kind: string }) => k.kind)).toContain('patchwork');

    const world = await call('new_world', { kind: 'patchwork', name: 'Saltmere', seed: 7, settings: { stream: true } });
    expect(world.ok).toBe(true);
    expect(host.store.document.map.name).toBe('Saltmere');

    const story = await call('set_story', {
      place: 'Saltmere',
      kind: 'fishing village',
      premise: 'The tide has not come back for three days, and the boats lie on the mud.',
      opening: 'Dawn on the dry harbour; the Traveler arrives as the bell starts ringing on its own.',
      traveler: 'the Stranger',
      gathering: 'the harbour steps',
    });
    expect(story.place).toBe('Saltmere');

    const mill = await call('add_place', { name: 'The Old Mill', description: 'A tide mill with a stuck wheel.', near: 'by the river' });
    expect(mill.ok).toBe(true);
    const bell = await call('add_place', { name: 'Bell Tower', description: 'Where the bell rings by itself.', x: 10, y: 10 });
    expect(bell.place.tag).toBe('#BellTower');

    const things = await call('add_things', { thing: 'trees', count: 3, near: 'The Old Mill' });
    expect(things.placed.length).toBe(3);

    const ada = await call('add_character', {
      name: 'Ada Bell',
      role: 'Bell ringer',
      who: 'Rings the harbour bell. Keeps a key nobody knows about.',
      wants: 'Find out who has been ringing the bell at night.',
      speaks: 'Short and dry.',
      voice: 'female, Greek',
      home: 'Bell Tower',
      called: 'Adie',
      says: ['{partner}, the bell rang again. I was asleep.'],
    });
    expect(ada.ok).toBe(true);
    expect(ada.character.voice).toBe('female, Greek');
    const tom = await call('add_character', { name: 'Tom Reed', role: 'Miller', wants: 'Free the mill wheel before the tide returns.', voice: 'male, Irish', home: 'near the Old Mill' });
    expect(tom.ok).toBe(true);

    // An update keeps what it does not mention.
    const again = await call('add_character', { name: 'Ada Bell', wants: 'Catch the night ringer.' });
    expect(again.updated).toBe(true);
    const adaNow = host.store.document.cast.find((c) => c.name === 'Ada Bell')!;
    expect(adaNow.plan).toBe('Catch the night ringer.');
    expect(adaNow.voice?.language).toBe('Greek');
    expect(adaNow.callNames).toEqual(['Adie']);
    expect(host.store.document.context.storyLines.characterLines[adaNow.id].lines.length).toBe(1);

    const overview = await call('story_overview');
    expect(overview.places.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['The Old Mill', 'Bell Tower']));
    expect(overview.characters.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Ada Bell', 'Tom Reed']));
    expect(overview.missing.join(' ')).not.toMatch(/premise|opening|named places/);

    // The story as Markdown, and back.
    const md = await call('read_story_markdown');
    expect(md.markdown).toMatch(/Saltmere/);
    expect(md.markdown).toMatch(/Ada Bell/);
    const loaded = await call('write_story_markdown', { markdown: md.markdown });
    expect(loaded.characters).toEqual(expect.arrayContaining(['Ada Bell', 'Tom Reed']));
    expect(host.store.document.context.premise).toMatch(/tide/);

    // Undo goes back one step.
    const before = host.store.document.cast.length;
    await call('add_character', { name: 'Brief Visitor' });
    expect(host.store.document.cast.length).toBe(before + 1);
    await call('undo_world_edit');
    expect(host.store.document.cast.length).toBe(before);

    const started = await call('start_story');
    expect(started.ok).toBe(true);
    for (let i = 0; i < 40; i++) host.sim.stepFrame(0.1);
    const log = await call('read_story_log', { limit: 5 });
    expect(Array.isArray(log.lines)).toBe(true);
    expect(typeof log.cursor).toBe('number');

    const look = await call('look');
    expect(look.ok).toBe(false);
  });

  it('is forgiving where a small model guesses, and explains what it cannot do', async () => {
    // An unknown "near" still places the thing, and says where it could have gone.
    const placed = await call('add_place', { name: 'Fire Hill', near: 'the purple volcano' });
    expect(placed.ok).toBe(true);
    expect(placed.note).toMatch(/no "the purple volcano"/);
    const someone = await call('add_character', { name: 'Odd Visitor', home: 'the lighthouse' });
    expect(someone.ok).toBe(true);
    expect(someone.note).toMatch(/open ground/);
    await expect(call('new_world', { kind: 'moon' })).rejects.toThrow(/list_world_kinds/);
    await expect(call('add_things', { thing: 'dragon' })).rejects.toThrow(/Cannot place/);
  });

  it('starts a new world fresh unless asked to keep the people', async () => {
    await call('add_character', { name: 'Stays Maybe' });
    const fresh = await call('new_world', { kind: 'blank', name: 'Empty Field', seed: 1 });
    expect(fresh.characters).toBe(0);
    expect(host.store.document.context.premise).toBe('');
    await call('add_character', { name: 'Keeper' });
    const kept = await call('new_world', { kind: 'textile', seed: 2, keep_people: true });
    expect(kept.characters).toBe(1);
  });
});

describe('character looks', () => {
  it('sets a look from plain words, keeps the rest, and says what cannot be shown', async () => {
    await call('add_character', { name: 'Inigo', role: 'Wanderer', voice: 'male, Spanish', look: 'dark skin, all dark clothes, cloak and hood, no hat' });
    let inigo = host.store.document.cast.find((c) => c.name === 'Inigo')!;
    expect(inigo.figure?.traits).toMatchObject({ skinTone: 3, skirtInk: 'dark', bodiceInk: 'dark', hat: 'wreath' });

    const r = await call('set_appearance', { name: 'inigo', look: 'a green vest and a guitar' });
    expect(r.applied).toEqual(['vest: green']);
    expect(r.couldNotShow).toContain('props, belts and jewellery');
    expect(r.now).toMatch(/dark skin, black trousers, green vest/);
    inigo = host.store.document.cast.find((c) => c.name === 'Inigo')!;
    expect(inigo.figure?.traits).toMatchObject({ skinTone: 3, skirtInk: 'dark', bodiceInk: 'accent' });

    // An update through add_character keeps the traits already set.
    await call('add_character', { name: 'Inigo', wants: 'Find the way out.' });
    expect(host.store.document.cast.find((c) => c.name === 'Inigo')!.figure?.traits).toMatchObject({ skinTone: 3, bodiceInk: 'accent' });

    // The overview shows the look, so an agent can tell what is really there.
    const overview = await call('story_overview');
    expect(overview.characters.find((c: { name: string }) => c.name === 'Inigo').looks).toMatch(/green vest/);

    await expect(call('set_appearance', { name: 'inigo', look: 'a mysterious aura' })).rejects.toThrow(/Nothing in/);
    await expect(call('set_appearance', { name: 'nobody', look: 'green vest' })).rejects.toThrow(/No character called/);
  });
});
