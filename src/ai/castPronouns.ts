/**
 * Who's who in a scene, with pronouns taken from the character sheets, so the story models
 * stop guessing (and misgendering) characters when they speak of one another.
 */
export interface CastEntry {
  name: string;
  /** From the character sheet; anything else, or none, gives they/them. */
  gender?: string;
}

export function pronounsFor(gender?: string): string {
  if (gender === 'female') return 'she/her';
  if (gender === 'male') return 'he/him';
  return 'they/them';
}

/** One prompt line naming each character with their pronouns; empty when there is no cast. */
export function castPronounLine(cast: readonly CastEntry[] | undefined, limit = 14): string {
  const seen = new Set<string>();
  const entries = (cast ?? []).filter((c) => {
    const key = c.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!entries.length) return '';
  const list = entries
    .slice(0, limit)
    .map((c) => `${c.name.trim()} (${pronounsFor(c.gender)})`)
    .join(', ');
  return `Who's who (always use these pronouns for them): ${list}.`;
}
