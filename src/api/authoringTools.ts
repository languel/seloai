/**
 * Authoring tools: a small, plain-language vocabulary for building a whole world, its story
 * and its people, made for agents (Claude Code over MCP, a browser agent over WebMCP, or the
 * in-app agent Pi on a small local model). Each tool does one thing a person would say
 * ("add a character", "put a mill by the river", "start the story") and goes through the
 * world store, so every step can be undone. The lower-level tools stay for fine work.
 */
import { createSeededRng, ensureVillagerSprite } from '../engine/characterGenerator';
import { findNamedCharacter } from '../engine/names';
import { findNearestWalkableTile, isTileWalkable } from '../engine/pathfinding';
import { nearestThing, thingSenseFor } from '../engine/things';
import type { ChatMessage, PointOfInterest, VillageMap, VillagerConfig } from '../engine/types';
import type { VillageSimulation } from '../engine/simulation';
import type { FeatureKind } from '../art/scene';
import type { WorldCommand } from '../world/commands';
import { SCENE_GENERATORS } from '../world/sceneGenerators';
import { storyPackFromFriendly, storyPackFromMarkdown, storyToMarkdown, type FriendlyCharacter } from '../world/storyText';
import { normalizeWorldContext, type WorldContext } from '../world/worldContext';
import type { PlacedFeature } from '../world/worldScene';
import { bakeScene } from '../world/worldScene';
import type { WorldStore } from '../world/worldStore';
import type { SeloToolDefinition } from './seloToolRegistry';

/** The steps of making a new world with someone, for an agent to follow. */
export const AUTHORING_GUIDE = `# Making a new world with someone

You are helping a person make an interactive story world: a place, the people who live there,
and what is going on. The world runs as a living simulation: characters walk, talk to each
other and to the player (the Traveler), and a narrator (the Scribe) tells what happens.

Work in short steps and show your work. After each step, say in a sentence what you made and
ask one question at a time. Suggest, do not interrogate: offer a concrete idea the person can
take or change. Keep everything procedural and original.

1. **The idea.** Ask what kind of story they want (or offer two or three ideas). Agree on a
   place, a situation with a tension in it, and a mood.
2. **The place.** \`list_world_kinds\` shows the generators. \`new_world\` makes one (it keeps
   the cast). Then \`set_story\` with the place's name, kind, the premise (one or two sentences
   with a problem in it), and who the player is.
3. **Landmarks.** \`add_place\` for the three to six places the story happens in (a well, a
   mill, a shrine). Give each a short description. Use \`near\` ("by the river", "next to the
   well") rather than coordinates.
4. **The people.** \`add_character\` three to six times. Each needs a role, who they are (two or
   three sentences, with a secret or a want), what they want now, how they speak, and a voice
   (gender, then an accent/language such as "female, Greek"). Give them a home near a place.
   Make their wants pull against each other: that is what makes the story.
5. **The opening.** \`set_story\` with \`opening\`: how the narrator should open the story (what
   the player sees first, who is where). Optionally a few lines with \`add_story_lines\`.
6. **Run it.** \`start_story\` begins from the top. \`read_story_log\` shows what people said;
   \`look\` shows the view (in the app). Tweak and run again.

At any point: \`story_overview\` shows what there is and what is missing, \`read_story_markdown\`
gives the whole story as one Markdown file (the person can keep or edit it), and
\`write_story_markdown\` loads one. \`undo_world_edit\` undoes the last change.
`;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });

const CHARACTER_FIELDS = {
  name: str('Full name, e.g. "Ada Bell".'),
  role: str('What they are in the place, e.g. "Lighthouse keeper".'),
  who: str('Who they are: two or three sentences, with something hidden or wanted.'),
  wants: str('What they want right now; drives what they do.'),
  speaks: str('How they speak, e.g. "Short, dry, never says please".'),
  voice: str('Voice as "gender, accent", optionally a pitch: "female, Greek", "male, Irish, -1".'),
  look: str('Optional figure words: skirted or trousered; serpent, kuker or samodiva for special beings.'),
  colour: str('Optional thread colour, e.g. "#2c3e66".'),
  home: str('Where they start: a place name, a thing ("by the river") or "x,y".'),
  called: str('Other names they go by, comma-separated, e.g. "Adie, Old Bell".'),
  says: { type: 'array', items: { type: 'string' }, description: 'A few lines they might say. {partner} is replaced by who they talk to.' },
};

export const AUTHORING_TOOL_DEFINITIONS: SeloToolDefinition[] = [
  {
    name: 'authoring_guide',
    description: 'How to make a new world, story and characters with a person, step by step. Read this first when asked to create a world or story.',
    inputSchema: obj({}),
  },
  {
    name: 'story_overview',
    description: 'A short summary of the current world: place, premise, opening, places, characters, and what is still missing.',
    inputSchema: obj({}),
  },
  {
    name: 'list_world_kinds',
    description: 'The kinds of world new_world can make, with their settings.',
    inputSchema: obj({}),
  },
  {
    name: 'new_world',
    description: 'Make a new place from a generator (see list_world_kinds). Starts fresh: no characters and no story yet. Set keep_people to keep the current characters and story.',
    inputSchema: obj(
      {
        kind: str('Generator id, e.g. "patchwork", "textile", "wang-valley", "blank".'),
        keep_people: { type: 'boolean', description: 'Keep the current characters and story text (moved into the new place).' },
        name: str('The place name stitched on the cloth.'),
        seed: num('A number: the same seed makes the same place.'),
        settings: { type: 'object', description: 'Generator settings by key (see list_world_kinds), e.g. { "stream": true }.' },
      },
      ['kind'],
    ),
  },
  {
    name: 'set_story',
    description: 'Set the story text: the place name and kind, the premise, the opening, who the player is, the usual meeting place. Only the fields given change.',
    inputSchema: obj({
      place: str('Name of the place, e.g. "Saltmere".'),
      kind: str('What sort of place: village, harbour town, monastery...'),
      premise: str('One or two sentences: the situation and the trouble in it.'),
      opening: str('How the narrator should open the story: what the player sees first.'),
      traveler: str('What the player is called, e.g. "the Stranger".'),
      gathering: str('The usual meeting place, e.g. "the harbour steps".'),
      title: str('The world title shown in menus (defaults to the place name).'),
    }),
  },
  {
    name: 'add_place',
    description: 'Add or update a named place (landmark) people can go to and talk about, with #tag. Give near (a thing or place) or x,y.',
    inputSchema: obj(
      {
        name: str('The place name, e.g. "The Old Mill".'),
        description: str('A sentence about it, for the story.'),
        near: str('Where: "by the river", "next to the well", "near Ada\'s house". Ignored if x,y given.'),
        x: num('Cell x.'),
        y: num('Cell y.'),
        tag: str('Optional #tag without the #; made from the name if left out.'),
      },
      ['name'],
    ),
  },
  {
    name: 'add_things',
    description: 'Put things on the cloth: tree, pine, house, well, hearth, flowers, wheat, pool, haystack, woodpile, sunflower, hen, duck, reeds. Only in generated worlds.',
    inputSchema: obj(
      {
        thing: str('What: tree, pine, house, well, hearth, flowers, wheat, pool, haystack, woodpile, sunflower, hen, duck, reeds.'),
        count: num('How many (1 to 30). Default 1.'),
        near: str('Where: a place, a thing or a character ("by the river", "around the well"). Ignored if x,y given.'),
        x: num('Cell x.'),
        y: num('Cell y.'),
      },
      ['thing'],
    ),
  },
  {
    name: 'add_character',
    description: 'Add a character, or update one with the same name. Fields left out keep their value on an update.',
    inputSchema: obj(CHARACTER_FIELDS, ['name']),
  },
  {
    name: 'add_story_lines',
    description: 'Add lines the story can use without a model: scene openings and closings ({a}, {b}, {place}) and lines anyone may say ({partner}).',
    inputSchema: obj({
      openings: { type: 'array', items: { type: 'string' } },
      closings: { type: 'array', items: { type: 'string' } },
      anyone: { type: 'array', items: { type: 'string' } },
    }),
  },
  {
    name: 'start_story',
    description: 'Start the story from the beginning: clears what was said, sends everyone home, runs the opening. Use after setting up or changing the world.',
    inputSchema: obj({ paused: { type: 'boolean', description: 'Set up but leave paused.' } }),
  },
  {
    name: 'read_story_log',
    description: 'What has been said and narrated, oldest first. Pass the returned cursor next time to get only new lines.',
    inputSchema: obj({ cursor: num('From a previous call: only lines after this.'), limit: num('At most this many lines (default 30).') }),
  },
  {
    name: 'read_story_markdown',
    description: 'The whole story (place, premise, opening, characters, lines) as one Markdown file with a YAML header.',
    inputSchema: obj({}),
  },
  {
    name: 'write_story_markdown',
    description: 'Load a story written as Markdown (as read_story_markdown gives). Replaces the story text and the characters; keeps the place.',
    inputSchema: obj({ markdown: str('The Markdown story file.') }, ['markdown']),
  },
  {
    name: 'look',
    description: 'A picture of what the view shows now (in the app only).',
    inputSchema: obj({}),
  },
];

/** The tools a small local model gets: just enough to make and run a world. */
export const PI_TOOL_NAMES = [
  'story_overview',
  'list_world_kinds',
  'new_world',
  'set_story',
  'add_place',
  'add_things',
  'add_character',
  'remove_character',
  'start_story',
  'read_story_log',
  'instruct_world',
  'undo_world_edit',
] as const;

export const AUTHORING_TOOL_NAMES = new Set(AUTHORING_TOOL_DEFINITIONS.map((t) => t.name));

export interface AuthoringHost {
  store: WorldStore;
  sim: VillageSimulation;
  /** A PNG data URL of the current view, where there is one. */
  captureView?: () => Promise<string | null>;
  persist?: () => void;
}

const THING_SIZES: Partial<Record<FeatureKind, [number, number]>> = {
  house: [3, 3],
  well: [3, 3],
  hearth: [2, 2],
  pool: [2, 2],
  tree: [1, 2],
  pine: [1, 2],
  sapling: [1, 1],
  flowers: [1, 1],
  wheat: [1, 1],
  haystack: [1, 1],
  woodpile: [1, 1],
  sunflower: [1, 1],
  hen: [1, 1],
  duck: [1, 1],
  reeds: [1, 1],
};

const tagOf = (name: string) =>
  name
    .replace(/^the\s+/i, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
    .slice(0, 32) || 'Place';

const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'someone';

/** Where "near X" is: a place, a character, a character's home, or a kind of thing. */
function resolveNear(near: string, doc: { map: VillageMap; cast: VillagerConfig[] }, sim: VillageSimulation): { x: number; y: number } | undefined {
  const text = near.trim();
  if (!text) return undefined;
  const xy = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if (xy) return { x: Math.round(Number(xy[1])), y: Math.round(Number(xy[2])) };
  const lower = text.toLowerCase().replace(/^#/, '');
  const pois = doc.map.pointsOfInterest ?? [];
  const poi =
    pois.find((p) => p.tag.toLowerCase() === lower || p.label.toLowerCase() === lower) ??
    pois.find((p) => lower.includes(p.label.toLowerCase()) || lower.includes(`#${p.tag.toLowerCase()}`)) ??
    pois.find((p) => p.label.toLowerCase().split(/\s+/).some((w) => w.length > 3 && lower.includes(w)));
  if (poi) return { x: poi.x, y: poi.y };
  const who = findNamedCharacter(text, doc.cast);
  if (who) {
    if (/\b(house|home|door|yard)\b/i.test(text)) return { ...who.homeTile };
    const rt = sim.runtimes.get(who.id);
    return rt ? { x: Math.round(rt.x), y: Math.round(rt.y) } : { ...who.homeTile };
  }
  const sense = thingSenseFor(text);
  const scene = doc.map.scene ? bakeScene(doc.map.scene).model : undefined;
  if (sense && scene) {
    const from = { x: doc.map.width / 2, y: doc.map.height / 2 };
    const thing = nearestThing(scene, sense, from);
    if (thing) return { x: Math.round(thing.centre.x), y: Math.round(thing.centre.y) };
  }
  return undefined;
}

/** A free spot of open ground near `at` (or anywhere fairly central), away from other places. */
function openSpot(map: VillageMap, at: { x: number; y: number } | undefined, seed: number, avoid: Array<{ x: number; y: number }> = []): { x: number; y: number } {
  const rng = createSeededRng(seed);
  const centre = at ?? { x: Math.round(map.width / 2), y: Math.round(map.height / 2) };
  const radius = at ? 3 : Math.min(map.width, map.height) * 0.35;
  for (let tries = 0; tries < 200; tries++) {
    const a = rng() * Math.PI * 2;
    const r = (at ? 1.5 : 0) + rng() * radius * (1 + tries / 100);
    const x = Math.round(centre.x + Math.cos(a) * r);
    const y = Math.round(centre.y + Math.sin(a) * r);
    if (x < 1 || y < 1 || x >= map.width - 1 || y >= map.height - 1) continue;
    if (!isTileWalkable(map, x, y)) continue;
    if (avoid.some((p) => Math.hypot(p.x - x, p.y - y) < (at ? 1.5 : 5))) continue;
    return { x, y };
  }
  return findNearestWalkableTile(map, centre.x, centre.y);
}

function missingParts(doc: { map: VillageMap; cast: VillagerConfig[]; context: WorldContext }): string[] {
  const out: string[] = [];
  if (!doc.context.settingName.trim()) out.push('the place has no name (set_story place)');
  if (!doc.context.premise.trim()) out.push('no premise: what is going on and what is wrong (set_story premise)');
  if (!doc.context.opening?.trim()) out.push('no opening for the narrator (set_story opening)');
  if ((doc.map.pointsOfInterest ?? []).length < 2) out.push('fewer than two named places (add_place)');
  if (doc.cast.length < 2) out.push('fewer than two characters (add_character)');
  for (const c of doc.cast) if (!c.voice) out.push(`${c.name} has no voice (add_character with voice)`);
  return out;
}

function logLines(sim: VillageSimulation): Array<{ t: number; who: string; kind: string; text: string; to?: string }> {
  const lines: Array<{ t: number; who: string; kind: string; text: string; to?: string; key: string }> = [];
  const seen = new Set<string>();
  for (const conv of sim.conversations) {
    const names = conv.participantIds.map((id) => (id === sim.player.id ? sim.player.name : sim.configs.get(id)?.name ?? id));
    for (const m of conv.messages as ChatMessage[]) {
      if (!m.text?.trim() || seen.has(m.id)) continue;
      seen.add(m.id);
      const to = m.kind === 'narration' ? undefined : names.filter((n) => n !== m.senderName).join(', ') || undefined;
      lines.push({ t: m.timestamp, who: m.senderName, kind: m.kind ?? 'speech', text: m.text.trim(), to, key: m.id });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.map(({ key: _key, ...rest }) => rest);
}

export function isAuthoringTool(name: string): boolean {
  return AUTHORING_TOOL_NAMES.has(name);
}

export async function runAuthoringTool(name: string, args: Record<string, any>, host: AuthoringHost): Promise<any> {
  const { store, sim } = host;
  const doc = () => store.document;
  const dispatch = (commands: WorldCommand[], label: string) => {
    const next = store.dispatchAll(commands, label);
    host.persist?.();
    return next;
  };

  switch (name) {
    case 'authoring_guide':
      return { guide: AUTHORING_GUIDE };

    case 'story_overview': {
      const d = doc();
      return {
        title: d.map.name,
        place: d.context.settingName,
        kind: d.context.settingKind,
        traveler: d.context.playerName,
        gathering: d.context.fallbackLandmark,
        premise: d.context.premise,
        opening: d.context.opening ?? '',
        world: { size: `${d.map.width}x${d.map.height}`, generator: d.map.scene?.recipe?.generator ?? (d.map.scene ? 'authored' : 'tiles') },
        places: (d.map.pointsOfInterest ?? []).map((p) => ({ name: p.label, tag: `#${p.tag}`, x: p.x, y: p.y, about: p.description ?? '' })),
        characters: d.cast.map((c) => ({
          name: c.name,
          id: c.id,
          role: c.role,
          wants: c.plan,
          voice: c.voice ? `${c.voice.gender}, ${c.voice.language}` : '',
          home: `${c.homeTile.x},${c.homeTile.y}`,
          called: c.callNames ?? [],
        })),
        storyRunning: sim.storySet,
        missing: missingParts(d),
      };
    }

    case 'list_world_kinds':
      return {
        kinds: SCENE_GENERATORS.filter((g) => g.id !== 'zmeyovo' && g.id !== 'shevitsa').map((g) => ({
          kind: g.id,
          name: g.name,
          about: g.description,
          settings: g.params.map((p) =>
            p.type === 'enum'
              ? { key: p.key, about: p.hint ?? p.label, options: p.options, default: p.default }
              : p.type === 'bool'
                ? { key: p.key, about: p.hint ?? p.label, type: 'yes/no', default: p.default }
                : { key: p.key, about: p.hint ?? p.label, min: p.min, max: p.max, default: p.default },
          ),
        })),
      };

    case 'new_world': {
      const kind = String(args.kind ?? '').trim();
      if (!SCENE_GENERATORS.some((g) => g.id === kind)) throw new Error(`Unknown world kind "${kind}". Use list_world_kinds.`);
      const seed = Number.isFinite(Number(args.seed)) ? Math.round(Number(args.seed)) : Math.floor(Math.random() * 1e6);
      const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined;
      const fresh = args.keep_people !== true;
      const commands: WorldCommand[] = [{ type: 'scene.create', generator: kind, params: args.settings ?? {}, seed, name }];
      if (fresh) {
        commands.push({ type: 'cast.replace', cast: [] });
        commands.push({
          type: 'context.update',
          patch: { ...normalizeWorldContext({}), settingName: name ?? '', themeId: undefined },
        });
      }
      const next = dispatch(commands, `New world: ${name ?? kind}`);
      // Everyone gets a home inside the new place.
      const homes = next.cast.map((c, i) => {
        const inside = c.homeTile.x < next.map.width && c.homeTile.y < next.map.height && isTileWalkable(next.map, c.homeTile.x, c.homeTile.y);
        return inside ? c : { ...c, homeTile: openSpot(next.map, undefined, seed + i * 31) };
      });
      const moved = homes.filter((c, i) => c !== next.cast[i]);
      if (moved.length) dispatch(moved.map((m) => ({ type: 'cast.update', id: m.id, patch: { homeTile: m.homeTile } })), 'Move everyone into the new world');
      const d = doc();
      return {
        ok: true,
        world: { name: d.map.name, size: `${d.map.width}x${d.map.height}`, seed },
        places: (d.map.pointsOfInterest ?? []).map((p) => p.label),
        characters: next.cast.length,
        note: fresh
          ? 'A fresh world. Next: set_story (place name, premise, opening), then add_place for the places the story needs, then add_character.'
          : 'The characters came along. Next: set_story, then add_place for the places the story needs.',
      };
    }

    case 'set_story': {
      const d = doc();
      const patch: Partial<WorldContext> = {};
      if (typeof args.place === 'string') patch.settingName = args.place.trim();
      if (typeof args.kind === 'string' && args.kind.trim()) patch.settingKind = args.kind.trim();
      if (typeof args.premise === 'string') patch.premise = args.premise.trim();
      if (typeof args.opening === 'string') patch.opening = args.opening.trim();
      if (typeof args.traveler === 'string' && args.traveler.trim()) patch.playerName = args.traveler.trim();
      if (typeof args.gathering === 'string' && args.gathering.trim()) patch.fallbackLandmark = args.gathering.trim();
      const commands: WorldCommand[] = [];
      if (Object.keys(patch).length) commands.push({ type: 'context.update', patch });
      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : patch.settingName;
      if (title && title !== d.map.name) commands.push({ type: 'map.rename', name: title });
      if (!commands.length) throw new Error('Give at least one of place, kind, premise, opening, traveler, gathering, title.');
      dispatch(commands, 'Story text');
      const next = doc();
      return { ok: true, place: next.context.settingName, premise: next.context.premise, opening: next.context.opening ?? '', missing: missingParts(next) };
    }

    case 'add_place': {
      const label = String(args.name ?? '').trim();
      if (!label) throw new Error('A place needs a name.');
      const d = doc();
      const existing = (d.map.pointsOfInterest ?? []).find((p) => p.label.toLowerCase() === label.toLowerCase());
      let at: { x: number; y: number } | undefined;
      if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) at = { x: Math.round(Number(args.x)), y: Math.round(Number(args.y)) };
      let note: string | undefined;
      if (at) {
        // as given
      } else if (typeof args.near === 'string' && args.near.trim()) {
        const near = resolveNear(args.near, d, sim);
        if (!near) note = `There is no "${args.near}" in this world yet, so it went on open ground. Places to be near: ${(d.map.pointsOfInterest ?? []).map((p) => p.label).join(', ') || 'none yet'}; things: the river, a tree, a house, the well.`;
        at = openSpot(d.map, near, label.length * 97, (d.map.pointsOfInterest ?? []).filter((p) => p !== existing));
      } else if (existing) at = { x: existing.x, y: existing.y };
      else at = openSpot(d.map, undefined, label.length * 131, d.map.pointsOfInterest ?? []);
      const poi: PointOfInterest = {
        id: existing?.id ?? `poi-${slugOf(label)}`,
        tag: typeof args.tag === 'string' && args.tag.trim() ? args.tag.trim().replace(/^#/, '') : existing?.tag ?? tagOf(label),
        label,
        x: at.x,
        y: at.y,
        description: typeof args.description === 'string' ? args.description.trim() : existing?.description,
      };
      dispatch([d.map.scene ? { type: 'scene.edit', edit: { op: 'landmark', landmark: poi } } : { type: 'map.upsertPoi', poi }], `Place: ${label}`);
      return { ok: true, place: { name: poi.label, tag: `#${poi.tag}`, x: poi.x, y: poi.y }, updated: Boolean(existing), ...(note ? { note } : {}) };
    }

    case 'add_things': {
      const d = doc();
      if (!d.map.scene) throw new Error('This world is a tile map; things can only be added to generated worlds (new_world).');
      const word = String(args.thing ?? '').trim().toLowerCase().replace(/s$/, '');
      const kind = (Object.keys(THING_SIZES) as FeatureKind[]).find((k) => k === word) ?? (thingSenseFor(word)?.features?.[0] as FeatureKind | undefined);
      const size = kind ? THING_SIZES[kind] : undefined;
      if (!kind || !size) throw new Error(`Cannot place "${args.thing}". Try: ${Object.keys(THING_SIZES).join(', ')}.`);
      const count = Math.max(1, Math.min(30, Math.round(Number(args.count) || 1)));
      let at: { x: number; y: number } | undefined;
      if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) at = { x: Math.round(Number(args.x)), y: Math.round(Number(args.y)) };
      else if (typeof args.near === 'string' && args.near.trim()) at = resolveNear(args.near, d, sim);
      const rng = createSeededRng(Math.round((at?.x ?? 7) * 131 + (at?.y ?? 3) * 17 + count));
      const features: PlacedFeature[] = [];
      const taken: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < count; i++) {
        const spot = openSpot(d.map, at ?? { x: Math.round(d.map.width * (0.2 + rng() * 0.6)), y: Math.round(d.map.height * (0.2 + rng() * 0.6)) }, Math.floor(rng() * 1e6), taken);
        taken.push(spot);
        features.push({ id: `${kind}-agent-${Date.now().toString(36)}-${i}`, kind, x: spot.x, y: spot.y, w: size[0], h: size[1] });
      }
      dispatch([{ type: 'scene.edit', edit: features.length === 1 ? { op: 'place', feature: features[0] } : { op: 'scatter', features } }], `Add ${count} ${kind}`);
      return { ok: true, placed: features.map((f) => ({ thing: f.kind, x: f.x, y: f.y })) };
    }

    case 'add_character': {
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('A character needs a name.');
      const d = doc();
      const existing = d.cast.find((c) => c.name.toLowerCase() === name.toLowerCase() || c.id === args.id) ?? findNamedCharacter(name, d.cast);
      const friendly: FriendlyCharacter = {
        name,
        id: existing?.id,
        role: args.role ?? existing?.role,
        who: args.who ?? existing?.identity,
        wants: args.wants ?? existing?.plan,
        speaks: args.speaks ?? existing?.voiceStyle,
        voice: args.voice,
        look: args.look,
        colour: args.colour ?? args.color ?? existing?.accentColor,
        called: args.called,
      };
      const pack = storyPackFromFriendly({ characters: [friendly] });
      let member = (pack.cast ?? [])[0] as VillagerConfig;
      // Keep what an update does not mention.
      if (existing) {
        member = {
          ...existing,
          ...member,
          id: existing.id,
          voice: args.voice ? member.voice : existing.voice,
          figure: args.look ? member.figure : existing.figure,
          callNames: args.called ? member.callNames : existing.callNames,
          homeTile: existing.homeTile,
          appearance: existing.appearance,
          customSprite: existing.customSprite,
          spritesheetId: existing.spritesheetId,
        };
      } else {
        const ids = new Set(d.cast.map((c) => c.id));
        let id = member.id;
        for (let i = 2; ids.has(id); i++) id = `${member.id}-${i}`;
        member = { ...member, id };
      }
      let note: string | undefined;
      if (typeof args.home === 'string' && args.home.trim()) {
        const near = resolveNear(args.home, d, sim);
        if (!near) note = `No "${args.home}" yet, so ${name} lives on open ground. Add it with add_place, then update the home.`;
        member.homeTile = openSpot(d.map, near, name.length * 53, d.cast.filter((c) => c.id !== member.id).map((c) => c.homeTile));
      } else if (!existing) {
        member.homeTile = openSpot(d.map, undefined, name.length * 71 + d.cast.length, d.cast.map((c) => c.homeTile));
      }
      member = ensureVillagerSprite(member);
      const commands: WorldCommand[] = [{ type: 'cast.upsert', member }];
      const says = Array.isArray(args.says) ? args.says.map(String).filter((s: string) => s.trim()) : [];
      if (says.length) {
        const lines = d.context.storyLines;
        commands.push({
          type: 'context.update',
          patch: { storyLines: { ...lines, characterLines: { ...lines.characterLines, [member.id]: { lines: [...(lines.characterLines[member.id]?.lines ?? []), ...says] } } } },
        });
      }
      dispatch(commands, `${existing ? 'Update' : 'Add'} ${name}`);
      return {
        ok: true,
        updated: Boolean(existing),
        character: { id: member.id, name: member.name, role: member.role, voice: member.voice ? `${member.voice.gender}, ${member.voice.language}` : 'default', home: member.homeTile },
        ...(note ? { note } : {}),
      };
    }

    case 'add_story_lines': {
      const d = doc();
      const lines = d.context.storyLines;
      const take = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : []);
      const openings = take(args.openings);
      const closings = take(args.closings);
      const anyone = take(args.anyone);
      if (!openings.length && !closings.length && !anyone.length) throw new Error('Give openings, closings or anyone lines.');
      dispatch(
        [
          {
            type: 'context.update',
            patch: {
              storyLines: {
                ...lines,
                openingBeats: [...lines.openingBeats, ...openings],
                closingBeats: [...lines.closingBeats, ...closings],
                sharedLines: anyone.length ? [...lines.sharedLines, { lines: anyone }] : lines.sharedLines,
              },
            },
          },
        ],
        'Story lines',
      );
      return { ok: true, added: openings.length + closings.length + anyone.length };
    }

    case 'start_story': {
      sim.resetStory();
      sim.paused = Boolean(args.paused);
      host.persist?.();
      return { ok: true, paused: sim.paused, note: 'The narrator opens the story shortly. Use read_story_log to follow it.' };
    }

    case 'read_story_log': {
      const all = logLines(sim);
      const cursor = Number.isFinite(Number(args.cursor)) ? Number(args.cursor) : -Infinity;
      const limit = Math.max(1, Math.min(200, Math.round(Number(args.limit) || 30)));
      const fresh = all.filter((l) => l.t > cursor);
      const lines = fresh.slice(-limit);
      return { lines, cursor: all.length ? all[all.length - 1].t : cursor === -Infinity ? 0 : cursor, more: fresh.length > lines.length };
    }

    case 'read_story_markdown': {
      const d = doc();
      return { markdown: storyToMarkdown(d.context, d.cast, d.map.name, sim.focalWorldlineId && sim.focalWorldlineId !== 'traveler' ? sim.focalWorldlineId : undefined) };
    }

    case 'write_story_markdown': {
      const pack = storyPackFromMarkdown(String(args.markdown ?? ''));
      const world = normalizeWorldContext(pack.context);
      if (typeof pack.story?.openingDirective === 'string' && pack.story.openingDirective.trim() && !world.opening) world.opening = pack.story.openingDirective;
      const d = doc();
      const cast = ((pack.cast ?? []) as VillagerConfig[]).map((c, i) => {
        const inside = c.homeTile.x < d.map.width && c.homeTile.y < d.map.height && isTileWalkable(d.map, c.homeTile.x, c.homeTile.y);
        return ensureVillagerSprite(inside ? c : { ...c, homeTile: openSpot(d.map, undefined, i * 37 + 5) });
      });
      const commands: WorldCommand[] = [{ type: 'context.update', patch: world }];
      if (cast.length) commands.push({ type: 'cast.replace', cast });
      const title = typeof pack.name === 'string' && pack.name.trim() ? pack.name.trim() : world.settingName;
      if (title && title !== d.map.name) commands.push({ type: 'map.rename', name: title });
      dispatch(commands, 'Load story');
      return { ok: true, place: world.settingName, characters: cast.map((c) => c.name), missing: missingParts(doc()) };
    }

    case 'look': {
      const png = (await host.captureView?.()) ?? null;
      if (!png) return { ok: false, note: 'No view to look at here (the world runs without a screen). Use story_overview and read_story_log.' };
      return { ok: true, image: png };
    }

    default:
      throw new Error(`Unknown authoring tool "${name}".`);
  }
}

/** Prompts an MCP host can offer its user: starting points that load the guide for the agent. */
export const AUTHORING_PROMPTS = [
  {
    name: 'create_world',
    description: 'Make a new story world together: the place, its people and what is going on, step by step.',
    arguments: [{ name: 'idea', description: 'Optional: a first idea, e.g. "a fishing village where the tide stopped".', required: false }],
  },
  {
    name: 'improve_story',
    description: 'Look at the current world and story, and suggest and make improvements with the person.',
    arguments: [],
  },
] as const;

export function authoringPromptMessages(name: string, args: Record<string, string | undefined> = {}): Array<{ role: 'user'; content: { type: 'text'; text: string } }> {
  const idea = args.idea?.trim();
  const ask =
    name === 'improve_story'
      ? 'Call story_overview and read_story_log, tell me in a few lines what works and what is thin, then suggest one improvement at a time and make the ones I agree to.'
      : idea
        ? `I want to make a new story world. My idea: ${idea}. Start by offering a place, a situation and a mood built on it, then build it with me step by step.`
        : 'I want to make a new story world. Start by offering me two or three ideas, then build the one I pick with me step by step.';
  return [{ role: 'user', content: { type: 'text', text: `${AUTHORING_GUIDE}\n---\n\n${ask}` } }];
}

/**
 * A tool result as MCP content: an image result (from `look`) becomes an image part, the rest
 * stays JSON text.
 */
export function toolResultContent(output: unknown): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
  if (output && typeof output === 'object' && typeof (output as { image?: unknown }).image === 'string') {
    const { image, ...rest } = output as { image: string };
    const m = /^data:([^;]+);base64,(.*)$/.exec(image);
    if (m) return [{ type: 'image', data: m[2], mimeType: m[1] }, { type: 'text', text: JSON.stringify(rest) }];
  }
  return [{ type: 'text', text: JSON.stringify(output, null, 2) }];
}
