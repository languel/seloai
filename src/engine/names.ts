import type { VillagerConfig } from './types';

/**
 * How people are called in passing. A player (or a character) rarely says a full name: they
 * say "Stoyan", call out "Stoyane!", or "Lamio". These helpers find a character from any of
 * those, so "go to Stoyan" works as well as "go to Stoyan Yunak".
 */

/** Words in a name that say who someone is to others, not who they are: never matched alone. */
const TITLES = new Set([
  'the', 'of', 'old', 'young', 'little', 'big', 'aunt', 'uncle', 'grandma', 'grandpa', 'granny',
  'baba', 'dyado', 'bai', 'bay', 'kaka', 'lelya', 'chicho', 'pop', 'father', 'mother', 'sister', 'brother',
]);

/** Endings a name can take when it is called out or said fondly (the vocative and a few diminutives). */
const CALLED_ENDINGS = ['', 'e', 'o', 'u', 'a', 'yo', 'ie', 'ko', 'cho', 'che', 'ke'];

const VOWELS = /[aeiouy]$/;

function words(text: string): string[] {
  return text.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
}

/** Every form a character's name may be said in: each name word, and any set call names. */
export function nameForms(cfg: Pick<VillagerConfig, 'name' | 'callNames'>): string[] {
  const forms = new Set<string>();
  for (const w of words(cfg.name)) if (w.length >= 3 && !TITLES.has(w)) forms.add(w);
  for (const alt of cfg.callNames ?? []) {
    const clean = alt.trim().toLowerCase();
    if (clean) forms.add(clean);
  }
  return [...forms];
}

/** True when `word` is `form` as said aloud: as is, called out (Stoyane), or with its vowel turned (Lamio). */
function wordIsForm(word: string, form: string): boolean {
  if (word === form) return true;
  if (form.includes(' ')) return false;
  const stems = [form];
  if (VOWELS.test(form) && form.length >= 4) stems.push(form.slice(0, -1));
  return stems.some((stem) => word.startsWith(stem) && CALLED_ENDINGS.includes(word.slice(stem.length)));
}

/** Where in the text the character is first named (as a word index), or -1. */
export function nameIndexIn(text: string, cfg: Pick<VillagerConfig, 'name' | 'callNames'>): number {
  const ws = words(text);
  const lower = ` ${ws.join(' ')} `;
  let best = -1;
  for (const form of nameForms(cfg)) {
    if (form.includes(' ')) {
      const at = lower.indexOf(` ${form} `);
      if (at >= 0) {
        const idx = lower.slice(0, at).trim().split(' ').filter(Boolean).length;
        if (best < 0 || idx < best) best = idx;
      }
      continue;
    }
    const idx = ws.findIndex((w) => wordIsForm(w, form));
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
  }
  return best;
}

/** The character the text names first (other than `excludeId`), however they are called. */
export function findNamedCharacter<T extends Pick<VillagerConfig, 'id' | 'name' | 'callNames'>>(
  text: string,
  cast: Iterable<T>,
  excludeId?: string,
): T | undefined {
  let found: T | undefined;
  let foundAt = Infinity;
  for (const cfg of cast) {
    if (cfg.id === excludeId) continue;
    const at = nameIndexIn(text, cfg);
    if (at >= 0 && at < foundAt) {
      found = cfg;
      foundAt = at;
    }
  }
  return found;
}

/** The name to use in passing: a set call name, else the first name word that is not a title. */
export function shortName(cfg: Pick<VillagerConfig, 'name' | 'callNames'>): string {
  const alt = cfg.callNames?.find((n) => n.trim());
  if (alt) return alt.trim();
  const parts = cfg.name.trim().split(/\s+/);
  return parts.find((p) => p.length >= 3 && !TITLES.has(p.toLowerCase())) ?? parts[0] ?? cfg.name;
}

/**
 * The text with its @-mentions and the listener's own name taken out: "@Lamia, go to the river"
 * becomes ", go to the river", so the name is not read as a place (the Well of the Lamia).
 */
export function withoutAddress(text: string, listener: Pick<VillagerConfig, 'name' | 'callNames'>): string {
  const forms = nameForms(listener);
  return text
    .replace(/@[\p{L}\p{N}_'’-]+/gu, ' ')
    .split(/(\s+)/)
    .map((chunk) => {
      const word = chunk.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, '');
      return word && forms.some((f) => !f.includes(' ') && wordIsForm(word, f)) ? ' ' : chunk;
    })
    .join('');
}
