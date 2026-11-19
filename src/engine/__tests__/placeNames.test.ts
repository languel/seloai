import { describe, expect, it } from 'vitest';
import { placeKey, placeRef } from '../placeNames';

describe('place names in a sentence', () => {
  it('gives things an article and leaves proper names alone', () => {
    expect(placeRef('Well')).toBe('the Well');
    expect(placeRef('Samodiva Glade')).toBe('the Samodiva Glade');
    expect(placeRef('Spiral Labyrinth (Pirin)')).toBe('the Spiral Labyrinth (Pirin)');
    expect(placeRef('the Well')).toBe('the Well');
    expect(placeRef('The Well')).toBe('the Well');
    expect(placeRef('Zmeyovo')).toBe('Zmeyovo');
    expect(placeRef("Baba Rada's house")).toBe("Baba Rada's house");
  });

  it('matches what someone said to a label with or without the article', () => {
    expect(placeKey('the Well')).toBe(placeKey('Well'));
    expect(placeKey('#Well')).toBe('well');
  });
});
