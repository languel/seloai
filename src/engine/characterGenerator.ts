import { findNearestWalkableTile } from './pathfinding';
import {
  buildCustomSpriteFromAppearance,
  CLOTHING_PALETTES,
  EYE_COLORS,
  FOOTWEAR_PALETTES,
  HAIR_PALETTES,
  SKIN_PALETTES,
  TRIM_PALETTES,
} from './spriteGenerator';
import type {
  AccessoryId,
  BottomStyleId,
  CharacterAppearance,
  CharacterGender,
  ClothingColorId,
  ClothingStyleId,
  EyeColorId,
  FacialHairId,
  FootwearColorId,
  HairColorId,
  HairStyleId,
  SkinToneId,
  TrimColorId,
  VillageMap,
  VillagerConfig,
  VillagerVoiceProfile,
} from './types';

export interface TraitOption<T extends string> {
  id: T;
  label: string;
  hex?: string;
}

function rgbToHex(rgb: readonly [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

export const GENDER_OPTIONS: TraitOption<CharacterGender>[] = [
  { id: 'female', label: 'Feminine' },
  { id: 'male', label: 'Masculine' },
  { id: 'neutral', label: 'Neutral' },
];

export const SKIN_TONE_OPTIONS: TraitOption<SkinToneId>[] = [
  { id: 'porcelain', label: 'Porcelain', hex: rgbToHex(SKIN_PALETTES.porcelain.base) },
  { id: 'ivory', label: 'Ivory', hex: rgbToHex(SKIN_PALETTES.ivory.base) },
  { id: 'warm-peach', label: 'Warm Peach', hex: rgbToHex(SKIN_PALETTES['warm-peach'].base) },
  { id: 'olive', label: 'Olive', hex: rgbToHex(SKIN_PALETTES.olive.base) },
  { id: 'tan', label: 'Golden Tan', hex: rgbToHex(SKIN_PALETTES.tan.base) },
  { id: 'amber', label: 'Warm Amber', hex: rgbToHex(SKIN_PALETTES.amber.base) },
  { id: 'chestnut', label: 'Chestnut', hex: rgbToHex(SKIN_PALETTES.chestnut.base) },
  { id: 'deep-espresso', label: 'Deep Espresso', hex: rgbToHex(SKIN_PALETTES['deep-espresso'].base) },
];

export const EYE_COLOR_OPTIONS: TraitOption<EyeColorId>[] = [
  { id: 'brown', label: 'Warm Brown', hex: rgbToHex(EYE_COLORS.brown) },
  { id: 'blue', label: 'River Blue', hex: rgbToHex(EYE_COLORS.blue) },
  { id: 'green', label: 'Meadow Green', hex: rgbToHex(EYE_COLORS.green) },
  { id: 'hazel', label: 'Hazel', hex: rgbToHex(EYE_COLORS.hazel) },
  { id: 'amber', label: 'Honey Amber', hex: rgbToHex(EYE_COLORS.amber) },
  { id: 'charcoal', label: 'Slate Charcoal', hex: rgbToHex(EYE_COLORS.charcoal) },
  { id: 'violet', label: 'Dusk Violet', hex: rgbToHex(EYE_COLORS.violet) },
];

export const HAIR_STYLE_OPTIONS: TraitOption<HairStyleId>[] = [
  { id: 'short-crop', label: 'Short Crop' },
  { id: 'parted-bob', label: 'Parted Bob' },
  { id: 'long-wavy', label: 'Long Wavy' },
  { id: 'braids', label: 'Twin Braids' },
  { id: 'ponytail', label: 'High Ponytail' },
  { id: 'spiky', label: 'Windy Spikes' },
  { id: 'bun', label: 'Top Bun' },
  { id: 'curly-afro', label: 'Curly Afro' },
  { id: 'scholar-crown', label: 'Elder Temple' },
  { id: 'shaved', label: 'Close Buzz' },
];

export const HAIR_COLOR_OPTIONS: TraitOption<HairColorId>[] = [
  { id: 'raven', label: 'Raven Black', hex: rgbToHex(HAIR_PALETTES.raven.base) },
  { id: 'espresso', label: 'Dark Espresso', hex: rgbToHex(HAIR_PALETTES.espresso.base) },
  { id: 'chestnut', label: 'Chestnut', hex: rgbToHex(HAIR_PALETTES.chestnut.base) },
  { id: 'auburn', label: 'Copper Auburn', hex: rgbToHex(HAIR_PALETTES.auburn.base) },
  { id: 'golden-blonde', label: 'Wheat Blonde', hex: rgbToHex(HAIR_PALETTES['golden-blonde'].base) },
  { id: 'platinum-silver', label: 'Silver Frost', hex: rgbToHex(HAIR_PALETTES['platinum-silver'].base) },
  { id: 'copper-rose', label: 'Briar Rose', hex: rgbToHex(HAIR_PALETTES['copper-rose'].base) },
  { id: 'indigo-dye', label: 'Indigo Dye', hex: rgbToHex(HAIR_PALETTES['indigo-dye'].base) },
  { id: 'forest-sage', label: 'Moss Sage', hex: rgbToHex(HAIR_PALETTES['forest-sage'].base) },
];

export const FACIAL_HAIR_OPTIONS: TraitOption<FacialHairId>[] = [
  { id: 'none', label: 'Clean' },
  { id: 'stubble', label: 'Light Stubble' },
  { id: 'mustache', label: 'Handlebar Mustache' },
  { id: 'goatee', label: 'Trimmed Goatee' },
  { id: 'full-beard', label: 'Full Beard' },
];

export const CLOTHING_STYLE_OPTIONS: TraitOption<ClothingStyleId>[] = [
  { id: 'rushnyk-tunic', label: 'Rushnyk Tunic' },
  { id: 'herbalist-dress', label: 'Herbalist Dress' },
  { id: 'blacksmith-apron', label: 'Smith Apron' },
  { id: 'scholar-robe', label: 'Scholar Robe' },
  { id: 'forester-vest', label: 'Forester Vest' },
  { id: 'traveler-cloak', label: 'Traveler Cloak' },
  { id: 'overalls', label: 'Artisan Overalls' },
  { id: 'noble-coat', label: 'Tailored Coat' },
];

export const CLOTHING_COLOR_OPTIONS: TraitOption<ClothingColorId>[] = [
  { id: 'crimson', label: 'Madder Crimson', hex: rgbToHex(CLOTHING_PALETTES.crimson.base) },
  { id: 'cobalt', label: 'Cobalt Indigo', hex: rgbToHex(CLOTHING_PALETTES.cobalt.base) },
  { id: 'forest', label: 'Pine Green', hex: rgbToHex(CLOTHING_PALETTES.forest.base) },
  { id: 'ochre', label: 'Sunflower Ochre', hex: rgbToHex(CLOTHING_PALETTES.ochre.base) },
  { id: 'plum', label: 'Elderberry Plum', hex: rgbToHex(CLOTHING_PALETTES.plum.base) },
  { id: 'charcoal', label: 'Forge Charcoal', hex: rgbToHex(CLOTHING_PALETTES.charcoal.base) },
  { id: 'cream-linen', label: 'Flax Linen', hex: rgbToHex(CLOTHING_PALETTES['cream-linen'].base) },
  { id: 'teal', label: 'River Teal', hex: rgbToHex(CLOTHING_PALETTES.teal.base) },
  { id: 'rust', label: 'Terracotta Rust', hex: rgbToHex(CLOTHING_PALETTES.rust.base) },
  { id: 'burgundy', label: 'Wine Burgundy', hex: rgbToHex(CLOTHING_PALETTES.burgundy.base) },
];

export const TRIM_COLOR_OPTIONS: TraitOption<TrimColorId>[] = [
  { id: 'gold', label: 'Wheat Gold', hex: rgbToHex(TRIM_PALETTES.gold.base) },
  { id: 'crimson', label: 'Embroidery Red', hex: rgbToHex(TRIM_PALETTES.crimson.base) },
  { id: 'ivory', label: 'Bleached Ivory', hex: rgbToHex(TRIM_PALETTES.ivory.base) },
  { id: 'indigo', label: 'Woad Indigo', hex: rgbToHex(TRIM_PALETTES.indigo.base) },
  { id: 'emerald', label: 'Leaf Emerald', hex: rgbToHex(TRIM_PALETTES.emerald.base) },
  { id: 'copper', label: 'Burnished Copper', hex: rgbToHex(TRIM_PALETTES.copper.base) },
  { id: 'silver', label: 'Birch Silver', hex: rgbToHex(TRIM_PALETTES.silver.base) },
  { id: 'obsidian', label: 'Oak Ink', hex: rgbToHex(TRIM_PALETTES.obsidian.base) },
];

export const BOTTOM_STYLE_OPTIONS: TraitOption<BottomStyleId>[] = [
  { id: 'trousers', label: 'Trousers' },
  { id: 'skirt', label: 'Pleated Skirt' },
  { id: 'breeches', label: 'Cuffed Breeches' },
];

export const FOOTWEAR_COLOR_OPTIONS: TraitOption<FootwearColorId>[] = [
  { id: 'dark-leather', label: 'Dark Leather', hex: rgbToHex(FOOTWEAR_PALETTES['dark-leather'].base) },
  { id: 'russet-brown', label: 'Russet Boot', hex: rgbToHex(FOOTWEAR_PALETTES['russet-brown'].base) },
  { id: 'charcoal', label: 'Slate Sole', hex: rgbToHex(FOOTWEAR_PALETTES.charcoal.base) },
  { id: 'straw-tan', label: 'Tanned Hide', hex: rgbToHex(FOOTWEAR_PALETTES['straw-tan'].base) },
];

export const ACCESSORY_OPTIONS: TraitOption<AccessoryId>[] = [
  { id: 'none', label: 'None' },
  { id: 'glasses', label: 'Spectacles' },
  { id: 'flower-crown', label: 'Vinok Wreath' },
  { id: 'straw-hat', label: 'Harvest Hat' },
  { id: 'hood', label: 'Traveler Hood' },
  { id: 'bandana', label: 'Headband' },
  { id: 'headscarf', label: 'Khustka Scarf' },
  { id: 'feather-cap', label: 'Feather Cap' },
];

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  gender: 'female',
  skinTone: 'warm-peach',
  eyeColor: 'blue',
  hairStyle: 'braids',
  hairColor: 'chestnut',
  facialHair: 'none',
  clothingStyle: 'rushnyk-tunic',
  clothingColor: 'crimson',
  trimColor: 'crimson',
  bottomStyle: 'skirt',
  footwearColor: 'dark-leather',
  accessory: 'flower-crown',
};

export type AppearanceLocks = Partial<Record<keyof CharacterAppearance, boolean>>;

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T extends string>(list: readonly TraitOption<T>[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)].id;
}

/**
 * Generates an independent random choice for every character visual trait
 * (hair, skin, eyes, clothing, gender, facial hair, bottoms, boots, accessories),
 * respecting any locked fields or explicit overrides.
 */
export function randomizeAppearance(options?: {
  base?: CharacterAppearance;
  locks?: AppearanceLocks;
  overrides?: Partial<CharacterAppearance>;
  rng?: () => number;
}): CharacterAppearance {
  const rng = options?.rng ?? Math.random;
  const base = options?.base ?? DEFAULT_APPEARANCE;
  const locks = options?.locks ?? {};
  const ov = options?.overrides ?? {};

  const pick = <K extends keyof CharacterAppearance>(
    key: K,
    list: readonly TraitOption<CharacterAppearance[K] & string>[],
  ): CharacterAppearance[K] => {
    if (ov[key] !== undefined) return ov[key]!;
    if (locks[key]) return base[key];
    return pickRandom(list, rng) as CharacterAppearance[K];
  };

  return {
    gender: pick('gender', GENDER_OPTIONS),
    skinTone: pick('skinTone', SKIN_TONE_OPTIONS),
    eyeColor: pick('eyeColor', EYE_COLOR_OPTIONS),
    hairStyle: pick('hairStyle', HAIR_STYLE_OPTIONS),
    hairColor: pick('hairColor', HAIR_COLOR_OPTIONS),
    facialHair: pick('facialHair', FACIAL_HAIR_OPTIONS),
    clothingStyle: pick('clothingStyle', CLOTHING_STYLE_OPTIONS),
    clothingColor: pick('clothingColor', CLOTHING_COLOR_OPTIONS),
    trimColor: pick('trimColor', TRIM_COLOR_OPTIONS),
    bottomStyle: pick('bottomStyle', BOTTOM_STYLE_OPTIONS),
    footwearColor: pick('footwearColor', FOOTWEAR_COLOR_OPTIONS),
    accessory: pick('accessory', ACCESSORY_OPTIONS),
  };
}

export function randomizeSingleTrait<K extends keyof CharacterAppearance>(
  current: CharacterAppearance,
  trait: K,
  rng: () => number = Math.random,
): CharacterAppearance {
  const catalog: Record<keyof CharacterAppearance, readonly TraitOption<any>[]> = {
    gender: GENDER_OPTIONS,
    skinTone: SKIN_TONE_OPTIONS,
    eyeColor: EYE_COLOR_OPTIONS,
    hairStyle: HAIR_STYLE_OPTIONS,
    hairColor: HAIR_COLOR_OPTIONS,
    facialHair: FACIAL_HAIR_OPTIONS,
    clothingStyle: CLOTHING_STYLE_OPTIONS,
    clothingColor: CLOTHING_COLOR_OPTIONS,
    trimColor: TRIM_COLOR_OPTIONS,
    bottomStyle: BOTTOM_STYLE_OPTIONS,
    footwearColor: FOOTWEAR_COLOR_OPTIONS,
    accessory: ACCESSORY_OPTIONS,
  };
  const choices = catalog[trait];
  let nextVal = pickRandom(choices, rng);
  if (choices.length > 1 && nextVal === current[trait]) {
    const idx = choices.findIndex((c) => c.id === current[trait]);
    nextVal = choices[(idx + 1) % choices.length].id;
  }
  return { ...current, [trait]: nextVal };
}

export function describeAppearance(a: CharacterAppearance): string {
  const findLabel = <T extends string>(list: readonly TraitOption<T>[], id: T) =>
    list.find((o) => o.id === id)?.label ?? id;
  const parts = [
    findLabel(SKIN_TONE_OPTIONS, a.skinTone).toLowerCase() + ' skin',
    findLabel(HAIR_COLOR_OPTIONS, a.hairColor).toLowerCase() +
      ' ' +
      findLabel(HAIR_STYLE_OPTIONS, a.hairStyle).toLowerCase(),
    a.facialHair !== 'none' ? findLabel(FACIAL_HAIR_OPTIONS, a.facialHair).toLowerCase() : '',
    findLabel(CLOTHING_COLOR_OPTIONS, a.clothingColor).toLowerCase() +
      ' ' +
      findLabel(CLOTHING_STYLE_OPTIONS, a.clothingStyle).toLowerCase(),
    a.accessory !== 'none' ? 'wearing ' + findLabel(ACCESSORY_OPTIONS, a.accessory).toLowerCase() : '',
  ].filter(Boolean);
  return parts.join(', ');
}

const PRESET_APPEARANCE_SEEDS: Record<string, CharacterAppearance> = {
  f1: {
    gender: 'female',
    skinTone: 'warm-peach',
    eyeColor: 'blue',
    hairStyle: 'braids',
    hairColor: 'chestnut',
    facialHair: 'none',
    clothingStyle: 'rushnyk-tunic',
    clothingColor: 'cobalt',
    trimColor: 'crimson',
    bottomStyle: 'skirt',
    footwearColor: 'dark-leather',
    accessory: 'flower-crown',
  },
  f2: {
    gender: 'male',
    skinTone: 'chestnut',
    eyeColor: 'brown',
    hairStyle: 'short-crop',
    hairColor: 'raven',
    facialHair: 'stubble',
    clothingStyle: 'scholar-robe',
    clothingColor: 'teal',
    trimColor: 'gold',
    bottomStyle: 'trousers',
    footwearColor: 'dark-leather',
    accessory: 'glasses',
  },
  f3: {
    gender: 'female',
    skinTone: 'ivory',
    eyeColor: 'green',
    hairStyle: 'long-wavy',
    hairColor: 'espresso',
    facialHair: 'none',
    clothingStyle: 'herbalist-dress',
    clothingColor: 'forest',
    trimColor: 'ivory',
    bottomStyle: 'skirt',
    footwearColor: 'russet-brown',
    accessory: 'none',
  },
  f4: {
    gender: 'male',
    skinTone: 'tan',
    eyeColor: 'hazel',
    hairStyle: 'spiky',
    hairColor: 'golden-blonde',
    facialHair: 'full-beard',
    clothingStyle: 'blacksmith-apron',
    clothingColor: 'charcoal',
    trimColor: 'copper',
    bottomStyle: 'trousers',
    footwearColor: 'dark-leather',
    accessory: 'none',
  },
  f5: {
    gender: 'female',
    skinTone: 'warm-peach',
    eyeColor: 'blue',
    hairStyle: 'parted-bob',
    hairColor: 'copper-rose',
    facialHair: 'none',
    clothingStyle: 'overalls',
    clothingColor: 'cobalt',
    trimColor: 'crimson',
    bottomStyle: 'trousers',
    footwearColor: 'russet-brown',
    accessory: 'bandana',
  },
  f6: {
    gender: 'female',
    skinTone: 'olive',
    eyeColor: 'amber',
    hairStyle: 'ponytail',
    hairColor: 'auburn',
    facialHair: 'none',
    clothingStyle: 'traveler-cloak',
    clothingColor: 'plum',
    trimColor: 'gold',
    bottomStyle: 'breeches',
    footwearColor: 'russet-brown',
    accessory: 'feather-cap',
  },
  f7: {
    gender: 'male',
    skinTone: 'ivory',
    eyeColor: 'charcoal',
    hairStyle: 'scholar-crown',
    hairColor: 'platinum-silver',
    facialHair: 'full-beard',
    clothingStyle: 'noble-coat',
    clothingColor: 'ochre',
    trimColor: 'crimson',
    bottomStyle: 'trousers',
    footwearColor: 'dark-leather',
    accessory: 'glasses',
  },
  f8: {
    gender: 'neutral',
    skinTone: 'amber',
    eyeColor: 'brown',
    hairStyle: 'curly-afro',
    hairColor: 'espresso',
    facialHair: 'none',
    clothingStyle: 'forester-vest',
    clothingColor: 'rust',
    trimColor: 'emerald',
    bottomStyle: 'breeches',
    footwearColor: 'straw-tan',
    accessory: 'straw-hat',
  },
};

export function inferAppearanceFromPreset(spritesheetId: string): CharacterAppearance {
  const seed = PRESET_APPEARANCE_SEEDS[spritesheetId] ?? DEFAULT_APPEARANCE;
  return { ...seed };
}

const FEMININE_NAMES = [
  'Solomiya',
  'Zoryana',
  'Daryna',
  'Halyna',
  'Lesya',
  'Ivanka',
  'Kvitoslava',
  'Marta',
  'Oksana',
  'Roksana',
  'Svitlana',
  'Vira',
];

const MASCULINE_NAMES = [
  'Danylo',
  'Ostap',
  'Yarema',
  'Levko',
  'Maksym',
  'Stepan',
  'Petro',
  'Roman',
  'Kuzma',
  'Borys',
  'Marko',
  'Nazar',
];

const NEUTRAL_NAMES = [
  'Yar',
  'Sasha',
  'Veles',
  'Zorian',
  'Lira',
  'Slava',
  'Tymko',
  'Oris',
  'Rada',
];

const PERSONA_TEMPLATES = [
  {
    role: 'Ceramicist & Kiln Keeper',
    identity:
      'Shapes glazed Kosiv jugs and whistles by morning, listening closely to travellers for stories worthy of painting onto clay.',
    plan: 'Inspect the riverbank clay pits and glaze bowls near the square.',
    voiceStyle: 'Earthy, warm, observant.',
  },
  {
    role: 'Apiarist & Mead Brewer',
    identity:
      'Tends oak hives at the meadow edge and greets everyone with jars of buckwheat honey and cheerful folk proverbs.',
    plan: 'Check blossoms around Windmill Meadow and trade honey for baked loaves.',
    voiceStyle: 'Upbeat, bright, neighborly.',
  },
  {
    role: 'Woodcarver & Toymaker',
    identity:
      'Carves cedar owls, spoons, and spinning tops on porch steps while humming mountain tunes and quizzing friends with riddles.',
    plan: 'Whittle at Village Square and swap wooden whistles with passersby.',
    voiceStyle: 'Playful, wry, measured.',
  },
  {
    role: 'Ferryman & River Scout',
    identity:
      'Knows every bend, reed bed, and stone ford along the creek. Speaks calmly about weather fronts, trout runs, and distant hills.',
    plan: 'Walk the River Crossing bank and share news of downstream travelers.',
    voiceStyle: 'Steady, calm, crisp.',
  },
  {
    role: 'Bakery Hearth Keeper',
    identity:
      'Bakes braided kolach and sourdough loaves before dawn, pulling chilly villagers toward the fire for warm slices and gossip.',
    plan: 'Warm stones at the Hearth Fire and offer loaves to early risers.',
    voiceStyle: 'Hearty, animated, generous.',
  },
  {
    role: 'Botanical Dyer',
    identity:
      'Steeps marigold, walnut husk, and onion-skin dye baths to tint linen threads in luminous village shades.',
    plan: 'Collect bark and wild herbs and compare color palettes with weavers.',
    voiceStyle: 'Curious, gentle, vivid.',
  },
  {
    role: 'Bellfounder Apprentice',
    identity:
      'Measures bronze chimes and tests echoes across rooftops, obsessed with why certain bells carry clear across wet mist.',
    plan: 'Listen from Windmill Meadow and test copper chimes by the forge.',
    voiceStyle: 'Eager, melodic, inquisitive.',
  },
  {
    role: 'Folklore Bandurist',
    identity:
      'Collects ballads, dances, and forgotten proverbs on strings of birch and gut, stitching local gossip into verse.',
    plan: 'Gather at the Hearth Fire to hear what happened today.',
    voiceStyle: 'Lyrical, warm, teasing.',
  },
];

const VOICE_LANGUAGES = [
  'American English',
  'British English',
  'Polish',
  'German',
  'French',
  'Italian',
  'Spanish',
] as const;

function pickAccentHex(appearance: CharacterAppearance): string {
  const swatch =
    CLOTHING_COLOR_OPTIONS.find((c) => c.id === appearance.clothingColor)?.hex ??
    TRIM_COLOR_OPTIONS.find((t) => t.id === appearance.trimColor)?.hex ??
    '#b42828';
  return swatch;
}

export function createAutoGeneratedVillager(options?: {
  map?: VillageMap;
  existingVillagers?: VillagerConfig[];
  appearance?: CharacterAppearance;
  locks?: AppearanceLocks;
  rng?: () => number;
}): VillagerConfig {
  const rng = options?.rng ?? Math.random;
  const existing = options?.existingVillagers ?? [];
  const takenNames = new Set(existing.map((v) => v.name.toLowerCase()));

  const appearance =
    options?.appearance ??
    randomizeAppearance({
      locks: options?.locks,
      rng,
    });

  const namePool =
    appearance.gender === 'female'
      ? FEMININE_NAMES
      : appearance.gender === 'male'
        ? MASCULINE_NAMES
        : NEUTRAL_NAMES;
  const fallbackPool = [...FEMININE_NAMES, ...MASCULINE_NAMES, ...NEUTRAL_NAMES];

  let chosenName = namePool.find((n) => !takenNames.has(n.toLowerCase()));
  if (!chosenName) {
    chosenName = fallbackPool.find((n) => !takenNames.has(n.toLowerCase()));
  }
  if (!chosenName) {
    const baseName = namePool[Math.floor(rng() * namePool.length)];
    chosenName = `${baseName} ${existing.length + 1}`;
  }

  const persona = PERSONA_TEMPLATES[Math.floor(rng() * PERSONA_TEMPLATES.length)];
  const voiceGender: 'female' | 'male' =
    appearance.gender === 'female'
      ? 'female'
      : appearance.gender === 'male'
        ? 'male'
        : rng() < 0.5
          ? 'female'
          : 'male';

  const voice: VillagerVoiceProfile = {
    gender: voiceGender,
    language: VOICE_LANGUAGES[Math.floor(rng() * VOICE_LANGUAGES.length)],
    pitchSemitones: Math.round(((rng() * 5 - 2.5) + (voiceGender === 'female' ? 1 : -1)) * 2) / 2,
    speakingRate: Math.round((0.92 + rng() * 0.16) * 50) / 50,
    warmthDb: Math.round((rng() * 5 - 1.5) * 2) / 2,
  };

  let homeTile = { x: 22, y: 16 };
  if (options?.map) {
    const spawns = options.map.spawnPoints.length > 0
      ? options.map.spawnPoints
      : [{ id: 'center', label: 'Center', x: Math.floor(options.map.width / 2), y: Math.floor(options.map.height / 2) }];
    const anchor = spawns[Math.floor(rng() * spawns.length)];
    const jitterX = Math.round((rng() - 0.5) * 6);
    const jitterY = Math.round((rng() - 0.5) * 6);
    homeTile = findNearestWalkableTile(
      options.map,
      Math.max(1, Math.min(options.map.width - 2, anchor.x + jitterX)),
      Math.max(1, Math.min(options.map.height - 2, anchor.y + jitterY)),
    );
  }

  const appearanceSummary = describeAppearance(appearance);

  return {
    id: `v-${Date.now()}-${Math.floor(rng() * 1e6).toString(36)}`,
    name: chosenName,
    role: persona.role,
    accentColor: pickAccentHex(appearance),
    spritesheetId: 'modular',
    appearance,
    customSprite: buildCustomSpriteFromAppearance(appearance),
    identity: `${chosenName} is a ${persona.role.toLowerCase()} with ${appearanceSummary}. ${persona.identity}`,
    plan: persona.plan,
    voiceStyle: persona.voiceStyle,
    voice,
    homeTile,
    speed: Math.round((0.68 + rng() * 0.22) * 100) / 100,
  };
}

export function createAutomatedVillagerBatch(
  count: number,
  options?: {
    map?: VillageMap;
    existingVillagers?: VillagerConfig[];
    rng?: () => number;
  },
): VillagerConfig[] {
  const rng = options?.rng ?? Math.random;
  const created: VillagerConfig[] = [];
  const cumulative = [...(options?.existingVillagers ?? [])];
  for (let i = 0; i < count; i++) {
    const villager = createAutoGeneratedVillager({
      map: options?.map,
      existingVillagers: cumulative,
      rng,
    });
    created.push(villager);
    cumulative.push(villager);
  }
  return created;
}
