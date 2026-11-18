import { describe, expect, it } from 'vitest';
import { describeLook, mergeLook, readLook } from '../appearance';

describe('a look from plain words', () => {
  it("reads Inigo's description from the chat", () => {
    const r = readLook('dark skin, all dark clothes, cloak and hood, no hat or headdress, green vest');
    expect(r.traits).toMatchObject({ skinTone: 3, skirtInk: 'dark', bodiceInk: 'accent', hat: 'wreath' });
    expect(r.cannot).toEqual(expect.arrayContaining(['cloaks and coats', 'hoods']));
    expect(r.applied).toEqual(expect.arrayContaining(['skin: dark', 'vest: green', 'no hat (bare-headed)']));
  });

  it('reads colours for each garment, hair, hats and mood', () => {
    const r = readLook('a tall man in red trousers and a blue vest with an open front, long black hair, a fur kalpak, grim');
    expect(r.build).toBe('trousered');
    expect(r.traits).toMatchObject({ skirtInk: 'primary', bodiceInk: 'secondary', openBodice: true, hairInk: 'dark', hairFalls: true, hat: 'crown', expression: 'grim' });
    expect(r.cannot).toContain('height and build');
  });

  it('reads a woman in a skirt with a pink apron and a veil', () => {
    const r = readLook('she wears a green skirt, a pink apron and an embroidered veil, very dark skin');
    expect(r.build).toBe('skirted');
    expect(r.traits).toMatchObject({ skirtInk: 'accent', apronInk: 'accent2', skirtStyle: 'apron', headdress: 'veil', skinTone: 4 });
  });

  it('treats a bare colour as the whole outfit, and says what it did not understand', () => {
    expect(readLook('dressed in all black').traits).toMatchObject({ skirtInk: 'dark', bodiceInk: 'dark' });
    expect(readLook('wearing gold').traits).toMatchObject({ skirtInk: 'gold', bodiceInk: 'gold' });
    const none = readLook('mysterious and charming');
    expect(none.traits.expression).toBe('glad');
    expect(readLook('with a guitar and a scar').cannot).toEqual(expect.arrayContaining(['props, belts and jewellery', 'scars, tattoos and eye colour']));
  });

  it('lays a reading over what the figure already had, and describes it', () => {
    const before = { build: 'trousered' as const, seed: 7, traits: { skinTone: 1, hairInk: 'dark' as const } };
    const after = mergeLook(before, readLook('green vest, dark skin'));
    expect(after).toEqual({ build: 'trousered', seed: 7, traits: { skinTone: 3, hairInk: 'dark', bodiceInk: 'accent' } });
    expect(describeLook(after)).toBe('in trousers, dark skin, green vest, black hair');
  });
});
