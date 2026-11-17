import { describe, expect, it } from 'vitest';
import { castPronounLine, pronounsFor } from '../castPronouns';

describe('castPronounLine', () => {
  it('names each character with the pronouns from their sheet', () => {
    expect(
      castPronounLine([
        { name: 'Lamia Zmeitsa', gender: 'female' },
        { name: 'Kuker Marin', gender: 'male' },
        { name: 'Traveler' },
      ]),
    ).toBe("Who's who (always use these pronouns for them): Lamia Zmeitsa (she/her), Kuker Marin (he/him), Traveler (they/them).");
  });
  it('drops duplicates and blank names, and is empty without a cast', () => {
    expect(castPronounLine([{ name: 'Baba Rada', gender: 'female' }, { name: 'baba rada', gender: 'male' }, { name: ' ' }])).toBe(
      "Who's who (always use these pronouns for them): Baba Rada (she/her).",
    );
    expect(castPronounLine(undefined)).toBe('');
  });
  it('uses they/them for any gender it does not know', () => {
    expect(pronounsFor('nonbinary')).toBe('they/them');
  });
});
