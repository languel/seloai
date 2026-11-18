/**
 * A character's look from plain words: "dark skin, all black clothes, a green vest, no hat".
 * The figures are drawn from a handful of traits (skin, the threads of trousers or skirt,
 * vest, apron and hair, hat or headdress, arms, mood). This reads a description into those,
 * and says what it applied and what a figure cannot show (a cloak, boots), so an agent can
 * tell the person the truth instead of claiming a look the cloth does not have.
 */
import type { FigureTraits } from '../art/figures';
import type { VillagerConfig } from '../engine/types';

type Ink = NonNullable<FigureTraits['skirtInk']>;

/** Colour words to the thread they are worked in (the first to fifth threads of the cloth's look). */
const COLOURS: Array<[RegExp, Ink, string]> = [
  [/\b(red|crimson|scarlet|vermilion|ruby)\b/, 'primary', 'red'],
  [/\b(blue|indigo|navy|azure|cobalt)\b/, 'secondary', 'blue'],
  [/\b(green|olive|emerald|moss|sage)\b/, 'accent', 'green'],
  [/\b(pink|magenta|purple|violet|plum|rose|mauve|lilac)\b/, 'accent2', 'pink'],
  [/\b(gold|golden|yellow|orange|ochre|mustard|amber|saffron)\b/, 'gold', 'gold'],
  [/\b(black|dark|charcoal|brown|grey|gray|coal|ebony|sable)\b/, 'dark', 'black'],
  [/\b(white|cream|ivory|pale|light)\b/, 'light', 'white'],
];

/** Skin words to the five tones, lightest (0) to darkest (4). */
const SKIN: Array<[RegExp, number, string]> = [
  [/\b(very|deep|darkest|ebony|jet)\b.*\b(dark|black|brown)\b|\b(darkest|ebony)\b/, 4, 'darkest'],
  [/\b(dark|brown|bronze|bronzed|swarthy|dusky|black)\b/, 3, 'dark'],
  [/\b(olive|tan|tanned|medium|middle|golden|sun-?kissed|mediterranean|warm)\b/, 2, 'middle'],
  [/\b(fair|light|rosy|peach)\b/, 1, 'light'],
  [/\b(pale|pallid|white|porcelain|lightest|ivory|snowy)\b/, 0, 'lightest'],
];

const INK_NAMES: Record<string, string> = { primary: 'red', secondary: 'blue', accent: 'green', accent2: 'pink', gold: 'gold', dark: 'black', light: 'white' };

const MOODS: Array<[RegExp, NonNullable<FigureTraits['expression']>]> = [
  [/\b(grim|stern|severe|serious|brooding)\b/, 'grim'],
  [/\b(glad|cheerful|happy|smiling|warm|charming|charismatic|genial)\b/, 'glad'],
  [/\b(sly|cunning|wily|crafty|knowing|sardonic)\b/, 'sly'],
  [/\b(awed|wondering|amazed|dreamy)\b/, 'awed'],
  [/\b(calm|serene|placid|composed)\b/, 'calm'],
];

/** What the figures cannot show, and why: said back rather than silently dropped. */
const CANNOT: Array<[RegExp, string]> = [
  [/\b(cloak|cape|mantle|coat|robe|poncho)\b/, 'cloaks and coats'],
  [/\b(hood)\b/, 'hoods'],
  [/\b(boots?|shoes?|sandals?|footwear)\b/, 'footwear'],
  [/\b(scarf|sash|belt|jewel\w*|necklace|earrings?|glasses|spectacles|sword|staff|cane|bag|satchel|guitar|lute)\b/, 'props, belts and jewellery'],
  [/\b(tall|short|fat|thin|slim|stocky|muscular|big|small|petite|heavy)\b/, 'height and build'],
  [/\b(scar|tattoo\w*|freckles?|eye\s*colou?r|blue eyes|brown eyes|green eyes)\b/, 'scars, tattoos and eye colour'],
];

export interface LookReading {
  traits: FigureTraits;
  build?: 'skirted' | 'trousered';
  kind?: NonNullable<VillagerConfig['figure']>['kind'];
  applied: string[];
  /** Things said that a figure cannot show. */
  cannot: string[];
}

const inkIn = (clause: string): [Ink, string] | undefined => {
  for (const [re, ink, name] of COLOURS) if (re.test(clause)) return [ink, name];
  return undefined;
};

/** Reads a description of someone's look into traits. */
export function readLook(description: string): LookReading {
  const text = description.toLowerCase().replace(/[()]/g, ' ');
  const traits: FigureTraits = {};
  const applied: string[] = [];
  const cannot: string[] = [];
  let build: LookReading['build'];
  let kind: LookReading['kind'];

  const apply = (label: string) => {
    if (!applied.includes(label)) applied.push(label);
  };

  // Who: man or woman sets the build when it is said.
  if (/\b(trousers|trousered|man|male|boy|gentleman|he|his)\b/.test(text) && !/\b(skirt|skirted|woman|female|girl|lady|she|her)\b/.test(text)) build = 'trousered';
  else if (/\b(skirt|skirted|dress|woman|female|girl|lady|she|her)\b/.test(text) && !/\b(trousers|trousered|\bman\b|male|boy|gentleman)\b/.test(text)) build = 'skirted';
  for (const [re, k] of [[/\b(serpent|lamia|snake)\b/, 'serpent'], [/\b(kuker|mummer)\b/, 'kuker'], [/\b(samodiva|fairy|vila)\b/, 'samodiva']] as const) if (re.test(text)) kind = k;

  const clauses = text.split(/[,;.\n]|\band\b|\bwith\b|\bwearing\b|\bin a\b|\bhe has\b|\bshe has\b|\bnow has\b|\bhas a\b|\bhas\b/).map((c) => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    const colour = inkIn(clause);
    const noun = (re: RegExp) => re.test(clause);

    if (noun(/\b(skin|complexion)\b/)) {
      const tone = SKIN.find(([re]) => re.test(clause));
      if (tone) {
        traits.skinTone = tone[1];
        apply(`skin: ${tone[2]}`);
      }
      continue;
    }
    if (noun(/\bhair\b/) || noun(/\b(blonde?|brunette|redhead|ginger|curly|braided)\b/)) {
      if (colour) {
        traits.hairInk = colour[0];
        apply(`hair: ${colour[1]}`);
      }
      if (noun(/\b(long|falling|loose|braided)\b/)) {
        traits.hairFalls = true;
        apply('hair: long');
      } else if (noun(/\b(short|cropped|tied|tied up|bun)\b/)) {
        traits.hairFalls = false;
        apply('hair: short');
      }
      continue;
    }
    if (noun(/\b(moustache|mustache|beard|stubble|goatee|sideburns)\b/)) {
      traits.hairFalls = true;
      apply('a moustache');
      if (noun(/\b(beard|goatee|stubble)\b/)) cannot.push('beards (a moustache is the nearest)');
      continue;
    }
    const noHat = noun(/\b(no|without|minus)\s+(a\s+)?(hat|cap|headdress|headgear|head\s*covering|kerchief|veil|crown|wreath)\b|\b(hatless|bareheaded|bare-headed|bare headed|bare[- ]head)\b/);
    if (noHat) {
      // The nearest to none the figures have: bare, a flower at the ear (a sprig for a skirted build).
      traits.hat = 'wreath';
      traits.headdress = 'sprig';
      apply('no hat (bare-headed)');
      continue;
    }
    const hat = noun(/\b(hat|cap|kalpak|headdress|crown|wreath|kerchief|headscarf|veil|horns?|sokai|braids?|sprig|tiara)\b/);
    if (hat) {
      const pick = (re: RegExp) => re.test(clause);
      if (pick(/\b(kalpak|fur|crown|tiara)\b/)) Object.assign(traits, { hat: 'crown', headdress: 'crown' });
      else if (pick(/\b(flat cap|cap|kerchief|headscarf)\b/)) Object.assign(traits, { hat: 'kerchief', headdress: 'kerchief' });
      else if (pick(/\bhorns?\b/)) Object.assign(traits, { hat: 'horns', headdress: 'horns' });
      else if (pick(/\bwreath\b/)) Object.assign(traits, { hat: 'wreath', headdress: 'wreath' });
      else if (pick(/\bveil\b/)) Object.assign(traits, { headdress: 'veil' });
      else if (pick(/\bsokai\b/)) Object.assign(traits, { headdress: 'sokai' });
      else if (pick(/\bbraids?\b/)) Object.assign(traits, { headdress: 'braids' });
      else if (pick(/\bsprig\b/)) Object.assign(traits, { headdress: 'sprig' });
      else Object.assign(traits, { hat: 'kerchief', headdress: 'kerchief' });
      apply(`hat: ${clause}`);
      continue;
    }
    if (noun(/\bapron\b/) && colour) {
      traits.apronInk = colour[0];
      if (build !== 'trousered') traits.skirtStyle = 'apron';
      apply(`apron: ${colour[1]}`);
      continue;
    }
    if (noun(/\b(vest|waistcoat|bodice|jacket|top|shirt|blouse|tunic|doublet|gilet|corset)\b/)) {
      if (colour) {
        traits.bodiceInk = colour[0];
        apply(`vest: ${colour[1]}`);
      }
      continue;
    }
    if (noun(/\b(trousers|pants|breeches|skirt|dress|leggings)\b/)) {
      if (colour) {
        traits.skirtInk = colour[0];
        apply(`${noun(/\b(skirt|dress)\b/) ? 'skirt' : 'trousers'}: ${colour[1]}`);
      }
      continue;
    }
    if (noun(/\b(clothes|clothing|outfit|attire|dressed|garb|costume|all)\b/) && colour) {
      traits.skirtInk = colour[0];
      traits.bodiceInk = colour[0];
      apply(`clothes: all ${colour[1]}`);
      continue;
    }
    if (noun(/\bsleeves?\b/)) {
      traits.sleeveFilled = !noun(/\b(plain|no|bare|white|linen)\b/);
      apply(`sleeves: ${traits.sleeveFilled ? 'coloured' : 'plain'}`);
      continue;
    }
    // A short clause that is only a colour ("all black", "in green") is the whole outfit.
    if (colour && clause.split(/\s+/).length <= 3 && !noun(/\b(cloak|cape|coat|hood|boots?|shoes?|eyes?)\b/)) {
      traits.skirtInk = colour[0];
      traits.bodiceInk = colour[0];
      apply(`clothes: all ${colour[1]}`);
      continue;
    }
    if (noun(/\b(arms? raised|hands? up|dancing|raised)\b/)) {
      traits.pose = 'raised';
      apply('arms: raised');
      continue;
    }
    if (noun(/\b(hands? on (his |her )?hips|akimbo|arms? akimbo)\b/)) {
      traits.pose = 'akimbo';
      apply('arms: hands on hips');
      continue;
    }
    if (noun(/\b(offering|holding out|holds? out)\b.*\b(flower|bloom)\b|\bflower\b/)) {
      traits.pose = 'offering';
      apply('arms: offering a flower');
      continue;
    }
    if (noun(/\b(arms? (at (his |her )?sides?|resting|down)|resting)\b/)) {
      traits.pose = 'resting';
      apply('arms: resting');
      continue;
    }
  }

  // An open vest, said anywhere ("a blue vest with an open front").
  if (/\bopen\s+(front|vest|waistcoat|bodice|jacket)\b|\b(vest|waistcoat|bodice|jacket)\b[^.;]*\bopen\b/.test(text)) {
    traits.openBodice = true;
    apply('vest: open');
  }
  // Mood from anywhere in the description.
  for (const [re, mood] of MOODS) {
    if (re.test(text)) {
      traits.expression = mood;
      apply(`face: ${mood}`);
      break;
    }
  }
  for (const [re, what] of CANNOT) if (re.test(text) && !cannot.includes(what)) cannot.push(what);
  return { traits, build, kind, applied, cannot };
}

/** A figure with a reading's traits laid over what it already had. */
export function mergeLook(figure: VillagerConfig['figure'], reading: LookReading): NonNullable<VillagerConfig['figure']> {
  const next: NonNullable<VillagerConfig['figure']> = { ...(figure ?? {}) };
  if (reading.build) next.build = reading.build;
  if (reading.kind) next.kind = reading.kind;
  if (Object.keys(reading.traits).length) next.traits = { ...(figure?.traits ?? {}), ...reading.traits };
  return next;
}

/** A person's look in a few words, from their figure, for an overview. */
export function describeLook(figure: VillagerConfig['figure'], voiceGender?: 'male' | 'female'): string {
  const t = figure?.traits ?? {};
  const parts: string[] = [];
  // With no build chosen, the voice's gender decides, as the figures are drawn.
  const build = figure?.build ?? (voiceGender === 'male' ? 'trousered' : voiceGender === 'female' ? 'skirted' : undefined);
  if (figure?.kind && figure.kind !== 'human') parts.push(figure.kind);
  if (build) parts.push(build === 'trousered' ? 'in trousers' : 'in a skirt');
  if (t.skinTone !== undefined) parts.push(`${['lightest', 'light', 'middle', 'dark', 'darkest'][t.skinTone]} skin`);
  if (t.skirtInk) parts.push(`${INK_NAMES[t.skirtInk] ?? t.skirtInk} ${build === 'trousered' ? 'trousers' : 'skirt'}`);
  if (t.bodiceInk) parts.push(`${INK_NAMES[t.bodiceInk] ?? t.bodiceInk} vest`);
  if (t.hairInk) parts.push(`${INK_NAMES[t.hairInk] ?? t.hairInk} hair`);
  if (t.hat === 'wreath' && t.headdress === 'sprig') parts.push('bare-headed');
  return parts.join(', ');
}
