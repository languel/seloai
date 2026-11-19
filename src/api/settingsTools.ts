/**
 * Settings tools: look and change how the app looks and behaves, in plain words, the same
 * controls as the Style panel and the sound and narrator settings: "night plate", "woven
 * text in script", "the narrator's voice warmer", "hear the whole map". Each setting has a
 * plain key, a sentence about it, and its choices or range; values are matched forgivingly
 * ("night view" finds Night plate) and anything out of range is clamped and said so.
 *
 * Keys, addresses and model choices for the AI backends are NOT here on purpose: an agent
 * must not be able to redirect where a person's keys or messages go.
 */
import { EAVESDROP_WHOLE_MAP_RADIUS } from '../ai/audioPipeline';
import { WORLD_LOOK_OPTIONS } from '../art/gameLook';
import type { ModelSettings } from '../engine/types';
import { BUBBLE_STYLE_OPTIONS, clampAestheticSettings, FONT_PRESET_OPTIONS, UI_DECORATION_OPTIONS, type AestheticSettings } from '../utils/aestheticThemes';
import type { SeloToolDefinition } from './seloToolRegistry';

type Area = 'look' | 'text' | 'narrator' | 'sound' | 'story';
type Layer = 'style' | 'theme' | 'model';
type Option = { id: string; label: string };

interface Spec {
  key: string;
  area: Area;
  layer: Layer;
  about: string;
  kind: 'choice' | 'bool' | 'number' | 'text';
  /** The property in the settings object (for the narrator's voice, a path like narratorVoice.pitchSemitones). */
  field: string;
  options?: readonly Option[];
  min?: number;
  max?: number;
  maxLength?: number;
}

const choice = (key: string, area: Area, layer: Layer, field: string, about: string, options: readonly Option[]): Spec => ({ key, area, layer, field, about, kind: 'choice', options });
const bool = (key: string, area: Area, layer: Layer, field: string, about: string): Spec => ({ key, area, layer, field, about, kind: 'bool' });
const num = (key: string, area: Area, layer: Layer, field: string, about: string, min: number, max: number): Spec => ({ key, area, layer, field, about, kind: 'number', min, max });
const text = (key: string, area: Area, layer: Layer, field: string, about: string, maxLength = 60): Spec => ({ key, area, layer, field, about, kind: 'text', maxLength });

const opts = (list: ReadonlyArray<{ id: string; label: string }>): Option[] => list.map((o) => ({ id: o.id, label: o.label }));

const SPECS: readonly Spec[] = [
  // How the world is drawn
  choice('look', 'look', 'style', 'worldLook', "How the world and its people are drawn: line art, night plate, blackwork, red and black, festive, or classic tiles.", opts(WORLD_LOOK_OPTIONS)),
  choice('app_theme', 'look', 'theme', 'theme', 'The app around the world: light, dark, or follow the system.', [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ]),
  bool('walking_figures_turn', 'look', 'style', 'figureTurns', 'Figures turn as they walk (side-on and from behind), not only face us.'),
  bool('makers_hand', 'look', 'style', 'figureQuirks', "Figures drawn with the maker's quirks: uneven hems, a tipped head, big motifs."),
  bool('figures_solid', 'look', 'style', 'figureSolid', "Figures hide the cloth behind them (on), or the stitches show through (off)."),
  num('character_size', 'look', 'style', 'characterScale', 'How big characters are drawn (1 is usual).', 0.85, 1.35),
  bool('ornaments', 'look', 'style', 'showDecorations', 'Ornaments on the menus and the world.'),
  bool('hide_top_bar', 'look', 'style', 'topBarAutoHide', 'Tuck the top bar away until the pointer reaches the top edge (the ` key brings it out).'),
  choice('panel_style', 'look', 'style', 'uiDecoration', 'The style of the side panels and menus.', opts(UI_DECORATION_OPTIONS)),
  num('panel_glass', 'look', 'style', 'hudGlassOpacity', 'How solid the panels are (low is more see-through).', 0.72, 0.96),
  // Speech and thoughts on the cloth
  choice('speech_style', 'text', 'style', 'speechStyle', 'How speech and thoughts show: in bubbles, or embroidered onto the cloth as woven text.', [
    { id: 'bubbles', label: 'Bubbles' },
    { id: 'woven', label: 'Woven text' },
  ]),
  choice('woven_hand', 'text', 'style', 'wovenHand', 'The hand woven letters are worked in: satin, script, hand-sewn (ductus), or counted.', [
    { id: 'satin', label: 'Satin' },
    { id: 'script', label: 'Script' },
    { id: 'ductus', label: 'Hand-sewn' },
    { id: 'counted', label: 'Counted' },
  ]),
  num('woven_size', 'text', 'style', 'wovenSize', 'Size of woven letters (1 is usual).', 0.4, 2),
  num('woven_thickness', 'text', 'style', 'wovenWeight', 'Thread thickness of hand-sewn letters.', 0.02, 0.2),
  num('woven_slant', 'text', 'style', 'wovenSlant', 'Forward lean of hand-sewn letters (negative leans back).', -0.3, 0.6),
  num('woven_wobble', 'text', 'style', 'wovenWobble', 'How much hand-sewn letters wobble, as if written by hand.', 0, 1.5),
  choice('woven_stitch', 'text', 'style', 'wovenStitch', 'The stitch hand-sewn letters use.', [
    { id: 'back', label: 'Back stitch' },
    { id: 'running', label: 'Running stitch' },
    { id: 'stem', label: 'Stem stitch' },
    { id: 'chain', label: 'Chain stitch' },
  ]),
  num('words_stay_seconds', 'text', 'style', 'wovenHoldSec', 'Seconds woven words stay at full strength before fading.', 2, 300),
  num('words_fade_seconds', 'text', 'style', 'wovenFadeSec', 'Seconds woven words take to fade away.', 0.5, 60),
  choice('font', 'text', 'style', 'fontPreset', 'The typeface of the interface.', opts(FONT_PRESET_OPTIONS)),
  num('text_size', 'text', 'style', 'fontScale', 'Size of the interface text (1 is usual).', 0.85, 1.35),
  choice('bubble_style', 'text', 'style', 'bubbleStyle', 'The look of speech bubbles (when speech is in bubbles).', opts(BUBBLE_STYLE_OPTIONS)),
  num('bubble_opacity', 'text', 'style', 'bubbleOpacity', 'How solid speech bubbles are.', 0.72, 0.98),
  bool('bubbles_behind_characters', 'text', 'style', 'bubblesBehindCharacters', 'Speech bubbles drawn behind the characters.'),
  bool('avoid_label_overlap', 'text', 'style', 'deoverlapLabels', 'Move name labels and bubbles apart when they overlap.'),
  // The narrator
  bool('narrator_on', 'narrator', 'model', 'narratorEnabled', 'The narrator (the Scribe) speaks.'),
  text('narrator_name', 'narrator', 'model', 'narratorName', 'What the narrator is called.', 40),
  choice('narrator_style', 'narrator', 'model', 'narratorStyle', 'How the narrator tells the story.', [
    { id: 'dungeon-master', label: 'Dungeon master' },
    { id: 'storybook', label: 'Storybook' },
    { id: 'chronicler', label: 'Chronicler' },
  ]),
  bool('narrator_tells_events', 'narrator', 'model', 'narrateEvents', 'The narrator also tells scenes as they open and close.'),
  num('scribe_density', 'narrator', 'model', 'scribeDensity', 'How much the narrator tells, 0 to 1 (0.5 is usual): lower frames fewer scenes; higher also tells quiet moments of village life between conversations; 0 is silent.', 0, 1),
  choice('narrator_voice_gender', 'narrator', 'model', 'narratorVoice.gender', "The narrator's voice: male or female.", [
    { id: 'male', label: 'Male' },
    { id: 'female', label: 'Female' },
  ]),
  text('narrator_voice_accent', 'narrator', 'model', 'narratorVoice.language', "The accent the narrator's voice is read with, as a language: Greek, Irish, Polish, British English…", 40),
  num('narrator_voice_pitch', 'narrator', 'model', 'narratorVoice.pitchSemitones', "The narrator's pitch in semitones (negative is lower).", -6, 6),
  num('narrator_voice_speed', 'narrator', 'model', 'narratorVoice.speakingRate', "How fast the narrator speaks (1 is usual).", 0.8, 1.25),
  num('narrator_voice_warmth', 'narrator', 'model', 'narratorVoice.warmthDb', "How warm the narrator's voice sounds (dB, higher is warmer).", -6, 6),
  // Hearing and sound
  { key: 'hearing_range', area: 'sound', layer: 'model', field: 'proximityRadiusTiles', about: 'How far you can hear: a number of cells around you (1 to 24), "all" for the whole map, or 0 / "off".', kind: 'number', min: 0, max: 24 },
  bool('hear_speech', 'sound', 'model', 'eavesdropSpeech', 'Hear characters speak aloud within hearing range.'),
  bool('hear_thoughts', 'sound', 'model', 'eavesdropThoughts', "Hear characters' thoughts within hearing range."),
  bool('ambient_sound', 'sound', 'model', 'ambientAudioEnabled', 'Ambient sound of the place.'),
  bool('speak_my_lines', 'sound', 'model', 'speakPlayerLines', "Speak the Traveler's typed lines aloud before the reply."),
  bool('show_thinking', 'sound', 'model', 'showReasoning', "Show models' raw thinking (<think> blocks) in the log."),
  bool('speak_thinking', 'sound', 'model', 'speakReasoning', 'Speak that thinking aloud (off is usual).'),
  // The story and who is in it
  bool('characters_talk', 'story', 'model', 'autoConverse', 'Characters strike up conversations with each other on their own.'),
  num('story_pace', 'story', 'model', 'storyPace', "The story's tempo, 0 (slow, lingering) to 1 (brisk); 0.5 is usual: the breath between lines, the rest between conversations and the Scribe's quiet moments.", 0, 1),
  num('talk_density', 'story', 'model', 'talkDensity', 'How much the characters talk among themselves, 0 to 1 (0.5 is usual): how soon and how readily they start a conversation, and how long it runs; 0 and they go about their business.', 0, 1),
  text('my_name', 'story', 'model', 'playerName', "What the Traveler (you) are called; empty keeps the world's own name.", 40),
  text('story_language', 'story', 'model', 'worldLanguage', 'The language every line is written and spoken in (English, Greek…).', 30),
];

const AREA_NAMES: Record<Area, string> = {
  look: 'How the world is drawn',
  text: 'Speech and text',
  narrator: 'The narrator',
  sound: 'Hearing and sound',
  story: 'The story and its people',
};

export interface SettingsHost {
  getModel: () => ModelSettings;
  updateModel: (patch: Partial<ModelSettings>) => void;
  /** The style panel's settings and the app theme, where there is an app to show them. */
  style?: {
    get: () => AestheticSettings;
    update: (next: AestheticSettings) => void;
    getTheme: () => 'system' | 'light' | 'dark';
    setTheme: (theme: 'system' | 'light' | 'dark') => void;
  };
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

export const SETTINGS_TOOL_DEFINITIONS: SeloToolDefinition[] = [
  {
    name: 'list_settings',
    description:
      'The settings you can change, with their current values and choices: how the world is drawn (look, theme, figures), speech and text (woven text, fonts, bubbles), the narrator (on or off, name, style, voice), hearing and sound, and the story (characters talking to each other, language). Use this for anything about the look or behaviour of the app; never instruct_world for that.',
    inputSchema: obj({ area: { type: 'string', description: 'Optional: look, text, narrator, sound or story. Default: all.' } }),
  },
  {
    name: 'change_setting',
    description: 'Change one setting by its key from list_settings, e.g. setting "look" to "night plate", "narrator_voice_warmth" to 4, "hearing_range" to "all", "speech_style" to "woven". Values are matched forgivingly and clamped to range; the reply says what changed.',
    inputSchema: obj(
      {
        setting: { type: 'string', description: 'The setting key, e.g. "look".' },
        value: { description: 'The new value: a choice name, true/false, a number, or text.' },
      },
      ['setting', 'value'],
    ),
  },
  {
    name: 'change_settings',
    description: 'Change several settings at once: changes is an object of key: value, e.g. {"look": "night plate", "speech_style": "woven", "woven_hand": "script"}.',
    inputSchema: obj({ changes: { type: 'object', description: 'Setting keys and their new values.' } }, ['changes']),
  },
];

export const SETTINGS_TOOL_NAMES = new Set(SETTINGS_TOOL_DEFINITIONS.map((t) => t.name));
export const isSettingsTool = (name: string) => SETTINGS_TOOL_NAMES.has(name);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Words in a key, so "narrator speed" can find narrator_voice_speed. */
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['the', 'set', 'setting', 'change'].includes(w));

/** The setting a name means: the exact key, or the one whose words contain all of the name's words. */
function findSpec(name: string): { spec?: Spec; ambiguous?: Spec[] } {
  const n = norm(name);
  const exact = SPECS.find((s) => norm(s.key) === n);
  if (exact) return { spec: exact };
  const want = words(name);
  if (!want.length) return {};
  const hits = SPECS.filter((s) => {
    const have = words(s.key);
    return want.every((w) => have.some((h) => h === w || h.startsWith(w) || w.startsWith(h)));
  });
  if (hits.length === 1) return { spec: hits[0] };
  return hits.length ? { ambiguous: hits.slice(0, 5) } : {};
}

function current(spec: Spec, host: SettingsHost): unknown {
  if (spec.layer === 'theme') return host.style?.getTheme();
  if (spec.layer === 'style') return host.style ? getPath(host.style.get(), spec.field) : undefined;
  const model = host.getModel();
  if (spec.key === 'hearing_range') return model.proximityRadiusTiles >= 90 ? 'all' : model.proximityRadiusTiles === 0 ? 'off' : model.proximityRadiusTiles;
  return getPath(model, spec.field);
}

const shown = (spec: Spec, value: unknown): unknown => {
  if (spec.kind === 'choice' && typeof value === 'string') return spec.options?.find((o) => o.id === value)?.label ?? value;
  return value;
};

/** The value as the setting wants it, or an error that says what is allowed. */
function coerce(spec: Spec, raw: unknown): { value: unknown; note?: string } | { error: string } {
  if (spec.kind === 'bool') {
    if (typeof raw === 'boolean') return { value: raw };
    const t = norm(String(raw));
    if (['true', 'on', 'yes', 'show', 'enable', 'enabled', '1'].includes(t)) return { value: true };
    if (['false', 'off', 'no', 'hide', 'disable', 'disabled', '0'].includes(t)) return { value: false };
    return { error: `${spec.key} is on or off (true or false).` };
  }
  if (spec.kind === 'text') {
    const t = String(raw ?? '').trim().slice(0, spec.maxLength ?? 60);
    return { value: t };
  }
  if (spec.kind === 'number') {
    if (spec.key === 'hearing_range') {
      const t = norm(String(raw));
      if (['all', 'whole', 'wholemap', 'everywhere', 'map'].includes(t)) return { value: EAVESDROP_WHOLE_MAP_RADIUS };
      if (['off', 'none', 'no', 'mute', 'muted'].includes(t)) return { value: 0 };
    }
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9.+-]/g, ''));
    if (!Number.isFinite(n) || String(raw).trim() === '') return { error: `${spec.key} is a number from ${spec.min} to ${spec.max}.` };
    const clamped = Math.min(spec.max!, Math.max(spec.min!, n));
    return { value: clamped, ...(clamped !== n ? { note: `${n} is out of range (${spec.min} to ${spec.max}); used ${clamped}.` } : {}) };
  }
  // choice
  const options = spec.options!;
  const q = norm(String(raw));
  const exact = options.find((o) => norm(o.id) === q || norm(o.label) === q);
  if (exact) return { value: exact.id };
  const tokens = String(raw).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !['view', 'mode', 'style', 'look', 'theme', 'plate'].includes(t));
  const close = options.filter((o) => (q.length >= 3 && (norm(o.label).includes(q) || norm(o.id).includes(q))) || tokens.some((t) => norm(o.label).includes(t) || norm(o.id).includes(t)));
  if (close.length === 1) return { value: close[0].id };
  return { error: `${spec.key} is one of: ${options.map((o) => `"${o.label}"`).join(', ')}.` };
}

function apply(spec: Spec, value: unknown, host: SettingsHost): void {
  if (spec.layer === 'theme') return host.style!.setTheme(value as 'system' | 'light' | 'dark');
  if (spec.layer === 'style') {
    const next = { ...host.style!.get() } as Record<string, unknown>;
    next[spec.field] = value;
    return host.style!.update(clampAestheticSettings(next as Partial<AestheticSettings>));
  }
  if (spec.field.startsWith('narratorVoice.')) {
    const key = spec.field.split('.')[1];
    return host.updateModel({ narratorVoice: { ...host.getModel().narratorVoice, [key]: value } });
  }
  host.updateModel({ [spec.field]: value } as Partial<ModelSettings>);
}

export async function runSettingsTool(name: string, args: Record<string, any>, host: SettingsHost): Promise<any> {
  if (name === 'list_settings') {
    const wanted = typeof args.area === 'string' && args.area.trim() ? (Object.keys(AREA_NAMES) as Area[]).find((a) => norm(a) === norm(args.area)) : undefined;
    if (typeof args.area === 'string' && args.area.trim() && !wanted) throw new Error(`Unknown area "${args.area}". Areas: ${Object.keys(AREA_NAMES).join(', ')}.`);
    const groups = (Object.keys(AREA_NAMES) as Area[])
      .filter((a) => !wanted || a === wanted)
      .map((a) => ({
        area: a,
        about: AREA_NAMES[a],
        settings: SPECS.filter((s) => s.area === a).map((s) => {
          const value = current(s, host);
          return {
            setting: s.key,
            about: s.about,
            value: value === undefined ? '(needs the open app)' : shown(s, value),
            ...(s.kind === 'choice' ? { choices: s.options!.map((o) => o.label) } : {}),
            ...(s.kind === 'number' ? { range: s.key === 'hearing_range' ? '0 (off), 1 to 24, or "all"' : `${s.min} to ${s.max}` } : {}),
            ...(s.kind === 'bool' ? { choices: ['on', 'off'] } : {}),
          };
        }),
      }));
    return { groups, note: 'API keys, addresses and model downloads are not changed from here.' };
  }

  if (name === 'change_setting' || name === 'change_settings') {
    const entries: Array<[string, unknown]> =
      name === 'change_setting'
        ? [[String(args.setting ?? ''), args.value]]
        : args.changes && typeof args.changes === 'object' && !Array.isArray(args.changes)
          ? Object.entries(args.changes as Record<string, unknown>)
          : [];
    if (!entries.length) throw new Error(name === 'change_setting' ? 'Give a setting and a value.' : 'changes must be an object of setting: value.');
    const changed: Array<{ setting: string; from: unknown; to: unknown; note?: string }> = [];
    const rejected: Array<{ setting: string; reason: string }> = [];
    for (const [key, raw] of entries) {
      const { spec, ambiguous } = findSpec(key);
      if (!spec) {
        rejected.push({
          setting: key,
          reason: ambiguous
            ? `"${key}" could mean ${ambiguous.map((a) => a.key).join(', ')}: use one of those keys.`
            : `No setting called "${key}". Call list_settings to see them (keys, addresses and model choices cannot be changed here).`,
        });
        continue;
      }
      if ((spec.layer === 'style' || spec.layer === 'theme') && !host.style) {
        rejected.push({ setting: spec.key, reason: 'Style settings need the app open in a browser tab.' });
        continue;
      }
      const got = coerce(spec, raw);
      if ('error' in got) {
        rejected.push({ setting: spec.key, reason: got.error });
        continue;
      }
      const from = current(spec, host);
      apply(spec, got.value, host);
      const to = current(spec, host);
      changed.push({ setting: spec.key, from: shown(spec, from), to: shown(spec, to), ...(got.note ? { note: got.note } : {}) });
    }
    if (!changed.length) throw new Error(rejected.map((r) => `${r.setting}: ${r.reason}`).join(' '));
    return {
      ok: !rejected.length,
      changed,
      ...(rejected.length
        ? {
            notChanged: rejected,
            warning: `NOT CHANGED: ${rejected.map((r) => r.setting).join(', ')}. Say so plainly, and fix and retry them with the right keys; do not say they were changed.`,
          }
        : {}),
    };
  }
  throw new Error(`Unknown settings tool "${name}".`);
}
