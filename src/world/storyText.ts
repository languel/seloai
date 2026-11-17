/**
 * Stories written by people (or agents) as Markdown: a short YAML header (front matter) for
 * the world, then ordinary Markdown sections for the characters and the story lines, so the
 * file reads well anywhere Markdown is shown. It reads into the same story pack the JSON
 * import takes, and the current story can be written back out as Markdown to start from.
 *
 * The header's keys (characters and lines may also go here, though sections read better):
 *
 *   title, description, place (the place's name), kind (village, harbour town…),
 *   traveler (what the player is called), gathering (the usual meeting place),
 *   premise, opening, focus (the character the story opens on, by name or id),
 *   characters: [ { name, id?, role, who, wants, speaks, voice, look, colour, home, says } ],
 *   lines: { opening: [...], closing: [...], anyone: [ { line, when: [...] } ] }
 *
 * In Markdown the characters and lines can also be written as sections:
 *
 *   # Characters
 *   ## Ada Bell
 *   - role: Lighthouse keeper
 *   - wants: Find out who broke the lamp before dawn.
 *   Stubborn and kind… (paragraphs are who they are)
 *   Says:
 *   - {partner}, the lamp did not break itself.
 *
 *   # Story lines
 *   ## Opening
 *   - Fog rolls in as {a} and {b} meet by {place}.
 *   ## Anyone
 *   - Did you hear a ship's bell? (when: ship, bell)
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { VillagerConfig, VillagerVoiceProfile } from '../engine/types';
import type { StoryLinePools, WorldContext } from './worldContext';
import { WORLD_PACK_FORMAT, WORLD_PACK_VERSION } from './worldPack';

export interface FriendlyCharacter {
  name?: string;
  id?: string;
  role?: string;
  who?: string;
  identity?: string;
  about?: string;
  wants?: string;
  plan?: string;
  goal?: string;
  speaks?: string;
  style?: string;
  voiceStyle?: string;
  voice?: string | Partial<VillagerVoiceProfile> & { accent?: string; locale?: string; pitch?: number };
  look?: string;
  colour?: string;
  color?: string;
  home?: string | number[] | { x: number; y: number };
  says?: string[] | string;
}

export interface FriendlyStory {
  title?: string;
  name?: string;
  description?: string;
  place?: string;
  kind?: string;
  traveler?: string;
  gathering?: string;
  premise?: string;
  opening?: string;
  focus?: string;
  characters?: FriendlyCharacter[];
  lines?: { opening?: string[]; closing?: string[]; anyone?: Array<string | { line?: string; lines?: string[]; when?: string[] | string }> };
}

const LOOK_BUILDS = new Set(['skirted', 'trousered']);
const LOOK_KINDS: Record<string, NonNullable<VillagerConfig['figure']>['kind']> = {
  serpent: 'serpent',
  lamia: 'serpent',
  kuker: 'kuker',
  mummer: 'kuker',
  samodiva: 'samodiva',
  fairy: 'samodiva',
};
const COLOURS = ['#a4502f', '#2c3e66', '#4f6c8a', '#6b7046', '#a8676a', '#b58f4a', '#5d4a7a', '#2f6a5c'];

const text = (...vs: unknown[]) => {
  for (const v of vs) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'someone';
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? [v.trim()] : [];

/** "female, Danish, -0.5" or a map, into a voice profile. */
function readVoice(raw: FriendlyCharacter['voice']): VillagerVoiceProfile | undefined {
  if (!raw) return undefined;
  const voice: VillagerVoiceProfile = { gender: 'female', language: 'American English', pitchSemitones: 0, speakingRate: 1, warmthDb: 0 };
  if (typeof raw === 'string') {
    for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
      const lower = part.toLowerCase();
      if (/^(female|woman|she)$/.test(lower)) voice.gender = 'female';
      else if (/^(male|man|he)$/.test(lower)) voice.gender = 'male';
      else if (/^[-+]?\d+(\.\d+)?$/.test(lower)) voice.pitchSemitones = Math.max(-6, Math.min(6, Number(lower)));
      else voice.language = part;
    }
    return voice;
  }
  if (raw.gender === 'male' || raw.gender === 'female') voice.gender = raw.gender;
  voice.language = text(raw.language, raw.accent, raw.locale) || voice.language;
  const pitch = raw.pitchSemitones ?? raw.pitch;
  if (typeof pitch === 'number') voice.pitchSemitones = Math.max(-6, Math.min(6, pitch));
  if (typeof raw.speakingRate === 'number') voice.speakingRate = raw.speakingRate;
  if (typeof raw.warmthDb === 'number') voice.warmthDb = raw.warmthDb;
  return voice;
}

function readHome(raw: FriendlyCharacter['home'], index: number): { x: number; y: number } {
  if (Array.isArray(raw) && raw.length >= 2) return { x: Number(raw[0]) || 0, y: Number(raw[1]) || 0 };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { x: Number(raw.x) || 0, y: Number(raw.y) || 0 };
  if (typeof raw === 'string') {
    const [x, y] = raw.split(/[,\s]+/).map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  // Spread out round the middle of a typical map; the app moves anyone into the world anyway.
  return { x: 18 + (index % 4) * 4, y: 12 + Math.floor(index / 4) * 4 };
}

/** A friendly story (from a Markdown file) as a story pack, ready for the JSON import. */
export function storyPackFromFriendly(story: FriendlyStory) {
  const cast: VillagerConfig[] = [];
  const characterLines: StoryLinePools['characterLines'] = {};
  const used = new Set<string>();
  (story.characters ?? []).forEach((c, i) => {
    const name = text(c.name) || `Someone ${i + 1}`;
    let id = text(c.id) || slug(name.split(/\s+/)[0]);
    while (used.has(id)) id = `${id}-${i + 1}`;
    used.add(id);
    const look = text(c.look).toLowerCase();
    const figure: VillagerConfig['figure'] = {};
    for (const word of look.split(/[\s,]+/).filter(Boolean)) {
      if (LOOK_BUILDS.has(word)) figure.build = word as 'skirted' | 'trousered';
      else if (LOOK_KINDS[word]) figure.kind = LOOK_KINDS[word];
    }
    const member: VillagerConfig = {
      id,
      name,
      role: text(c.role) || 'Villager',
      identity: text(c.who, c.identity, c.about),
      plan: text(c.wants, c.plan, c.goal) || 'Go about the day and see what happens.',
      voiceStyle: text(c.speaks, c.style, c.voiceStyle) || 'Natural.',
      accentColor: text(c.colour, c.color) || COLOURS[i % COLOURS.length],
      spritesheetId: 'modular',
      homeTile: readHome(c.home, i),
      speed: 0.8,
      ...(readVoice(c.voice) ? { voice: readVoice(c.voice) } : {}),
      ...(Object.keys(figure).length ? { figure } : {}),
    };
    cast.push(member);
    const says = list(c.says);
    if (says.length) characterLines[id] = { lines: says };
  });
  const anyone = (story.lines?.anyone ?? []).map((entry) =>
    typeof entry === 'string'
      ? { lines: [entry] }
      : { lines: list(entry.lines ?? entry.line), ...(list(entry.when).length ? { whenMentioned: list(entry.when).map((w) => w.toLowerCase()) } : {}) },
  );
  const focusText = text(story.focus).toLowerCase();
  const focus = cast.find((c) => c.id === focusText || c.name.toLowerCase() === focusText || c.name.toLowerCase().split(/\s+/)[0] === focusText);
  const name = text(story.title, story.name) || 'A new story';
  const context: WorldContext = {
    settingName: text(story.place),
    settingKind: text(story.kind) || 'village',
    playerName: text(story.traveler) || 'Traveler',
    fallbackLandmark: text(story.gathering) || 'the square',
    premise: text(story.premise),
    ...(text(story.opening) ? { opening: text(story.opening) } : {}),
    storyLines: {
      openingBeats: list(story.lines?.opening),
      closingBeats: list(story.lines?.closing),
      characterLines,
      sharedLines: anyone.filter((l) => l.lines.length),
    },
  };
  return {
    format: WORLD_PACK_FORMAT,
    version: WORLD_PACK_VERSION,
    id: slug(name),
    name,
    description: text(story.description),
    context,
    story: { ...(text(story.opening) ? { openingDirective: text(story.opening) } : {}), ...(focus ? { focalCharacterId: focus.id } : {}) },
    ...(cast.length ? { cast } : {}),
  };
}

/** A Markdown story (a YAML header, then # Characters and # Story lines sections) as a story pack. */
export function storyPackFromMarkdown(source: string) {
  const normalized = source.replace(/\r\n?/g, '\n');
  const header = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  const story: FriendlyStory = header ? ((parseYaml(header[1]) as FriendlyStory) ?? {}) : {};
  const body = header ? normalized.slice(header[0].length) : normalized;
  const characters: FriendlyCharacter[] = [...(story.characters ?? [])];
  const lines = { opening: [...(story.lines?.opening ?? [])], closing: [...(story.lines?.closing ?? [])], anyone: [...(story.lines?.anyone ?? [])] };

  let section: 'characters' | 'lines' | 'other' = 'other';
  let current: (FriendlyCharacter & { _who: string[]; _says: string[] }) | null = null;
  let pool: 'opening' | 'closing' | 'anyone' | null = null;
  let saying = false;
  const finish = () => {
    if (current) {
      const { _who, _says, ...rest } = current;
      characters.push({ ...rest, who: text(rest.who, _who.join(' ')), says: [...list(rest.says), ..._says] });
    }
    current = null;
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const h1 = /^#\s+(.+)$/.exec(line);
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h1) {
      finish();
      const title = h1[1].toLowerCase();
      section = /character|cast|people/.test(title) ? 'characters' : /line|beat|script/.test(title) ? 'lines' : 'other';
      pool = null;
      continue;
    }
    if (h2) {
      finish();
      saying = false;
      if (section === 'characters') current = { name: h2[1].trim(), _who: [], _says: [] };
      else if (section === 'lines') {
        const t = h2[1].toLowerCase();
        pool = /open|start|begin/.test(t) ? 'opening' : /clos|end/.test(t) ? 'closing' : 'anyone';
      }
      continue;
    }
    if (!line) continue;
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (section === 'characters' && current) {
      const c: FriendlyCharacter & { _who: string[]; _says: string[] } = current;
      if (/^says\s*:?\s*$/i.test(line)) {
        saying = true;
        continue;
      }
      const field = bullet ? /^([A-Za-z]+)\s*:\s*(.+)$/.exec(bullet[1]) : null;
      if (field && !saying) {
        const key = field[1].toLowerCase();
        const value = field[2].trim();
        if (key === 'says') c._says.push(unquote(value));
        else (c as unknown as Record<string, unknown>)[key === 'color' ? 'colour' : key] = value;
      } else if (bullet && saying) c._says.push(unquote(bullet[1]));
      else if (!bullet) c._who.push(line);
      continue;
    }
    if (section === 'lines' && pool && bullet) {
      if (pool === 'anyone') {
        const when = /\(\s*when\s*:\s*([^)]+)\)\s*$/i.exec(bullet[1]);
        const said = unquote(when ? bullet[1].slice(0, when.index).trim() : bullet[1]);
        lines.anyone.push(when ? { line: said, when: when[1].split(',').map((w) => w.trim()) } : said);
      } else lines[pool].push(unquote(bullet[1]));
    }
  }
  finish();
  return storyPackFromFriendly({ ...story, characters, lines });
}

function unquote(s: string): string {
  const t = s.trim();
  return /^".*"$|^'.*'$|^“.*”$/.test(t) ? t.slice(1, -1) : t;
}

/** The current world's story and cast written out as Markdown, the friendly form to start from. */
export function storyToMarkdown(world: WorldContext, cast: VillagerConfig[], title: string, focusId?: string): string {
  const header: Record<string, unknown> = {
    title,
    place: world.settingName || undefined,
    kind: world.settingKind,
    traveler: world.playerName,
    gathering: world.fallbackLandmark,
    premise: world.premise || undefined,
    opening: world.opening || undefined,
    focus: cast.find((c) => c.id === focusId)?.name,
  };
  for (const k of Object.keys(header)) if (header[k] === undefined || header[k] === '') delete header[k];
  const out: string[] = ['---', stringifyYaml(header, { lineWidth: 0 }).trimEnd(), '---', '', '# Characters', ''];
  for (const c of cast) {
    const v = c.voice;
    out.push(`## ${c.name}`);
    out.push(`- id: ${c.id}`);
    out.push(`- role: ${c.role}`);
    out.push(`- wants: ${c.plan}`);
    if (c.voiceStyle) out.push(`- speaks: ${c.voiceStyle}`);
    if (v) out.push(`- voice: ${v.gender}, ${v.language}${v.pitchSemitones ? `, ${v.pitchSemitones}` : ''}`);
    const look = [c.figure?.build, c.figure?.kind && c.figure.kind !== 'human' ? c.figure.kind : ''].filter(Boolean).join(' ');
    if (look) out.push(`- look: ${look}`);
    out.push(`- home: ${c.homeTile.x}, ${c.homeTile.y}`);
    out.push('');
    if (c.identity) out.push(c.identity, '');
    const says = world.storyLines.characterLines[c.id]?.lines ?? [];
    if (says.length) out.push('Says:', ...says.map((l) => `- ${l}`), '');
  }
  const { openingBeats, closingBeats, sharedLines } = world.storyLines;
  if (openingBeats.length || closingBeats.length || sharedLines.length) {
    out.push('# Story lines', '');
    if (openingBeats.length) out.push('## Opening', ...openingBeats.map((l) => `- ${l}`), '');
    if (closingBeats.length) out.push('## Closing', ...closingBeats.map((l) => `- ${l}`), '');
    if (sharedLines.length) {
      out.push('## Anyone');
      for (const pool of sharedLines) for (const l of pool.lines) out.push(`- ${l}${pool.whenMentioned?.length ? ` (when: ${pool.whenMentioned.join(', ')})` : ''}`);
      out.push('');
    }
  }
  return out.join('\n');
}
