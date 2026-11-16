import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../../core/rng';
import { findWorldPack, tileSemanticsForMap } from '../../world/packs';
import { GLYPH_NAMES, glyphShapes } from '../glyphs';
import { lettering, letteringWidth } from '../lettering';
import { PALETTES } from '../looks';
import { EXPRESSIONS, cloth, figure, treeOfLife } from '../motifs';
import { buildSceneModel } from '../scene';
import { sceneShapes } from '../sceneArt';
import { bounds, mirrored, place, type Shape } from '../shapes';

describe('Generative art', () => {
  it('grows the same motif from the same seed and a different one from another', () => {
    const a = JSON.stringify(cloth(createSeededRng(7)));
    expect(JSON.stringify(cloth(createSeededRng(7)))).toBe(a);
    expect(JSON.stringify(cloth(createSeededRng(8)))).not.toBe(a);
  });

  it('keeps trees mirror-symmetric about their axis', () => {
    const box = bounds(treeOfLife(createSeededRng(3), 30));
    expect(Math.abs(box.minX + box.maxX)).toBeLessThan(0.01);
    expect(box.maxY).toBeLessThanOrEqual(0.01);
  });

  it('gives every figure a skin tone and the expression asked for', () => {
    for (const expression of EXPRESSIONS) {
      const shapes = figure(createSeededRng(5), { height: 30, expression, skinTone: 2 });
      const skin = shapes.filter((s) => s.kind === 'area' && s.ink === 'skin');
      expect(skin.length).toBeGreaterThan(0);
      expect(skin.every((s) => s.kind === 'area' && s.tone === 2)).toBe(true);
    }
    const calm = JSON.stringify(figure(createSeededRng(5), { height: 30, expression: 'calm' }));
    const grim = JSON.stringify(figure(createSeededRng(5), { height: 30, expression: 'grim' }));
    expect(calm).not.toBe(grim);
  });

  it('transforms shapes without touching the originals', () => {
    const shape: Shape = { kind: 'area', points: [[1, 0], [2, 0], [2, 1]], ink: 'primary', grain: 0 };
    const moved = place([shape], { dx: 10, mirrorX: true });
    expect(shape.points[0]).toEqual([1, 0]);
    expect(moved[0].kind === 'area' && moved[0].points[0]).toEqual([9, 0]);
    expect(mirrored([shape])).toHaveLength(2);
  });

  it('defines every ink role and at least one skin tone in every palette', () => {
    for (const palette of Object.values(PALETTES)) {
      for (const role of ['primary', 'secondary', 'accent', 'accent2', 'gold', 'dark', 'skin'] as const) {
        expect(palette.inks[role]).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(palette.skinTones.length).toBeGreaterThan(0);
    }
  });

  it('sets text as counted stitches, capitals for lowercase and plain letters for accents', () => {
    const upper = lettering('WELL', { cell: 1 });
    expect(JSON.stringify(lettering('well', { cell: 1 }))).toBe(JSON.stringify(upper));
    expect(JSON.stringify(lettering('wéll', { cell: 1 }))).toBe(JSON.stringify(upper));
    expect(upper[0].kind).toBe('counted');
    expect(letteringWidth('AB', 2)).toBe((5 + 1 + 5) * 2);
    expect(lettering('', { cell: 1 })).toEqual([]);
    const centred = bounds(lettering('ABC', { cell: 1, align: 'centre' }));
    expect(Math.abs(centred.minX + centred.maxX)).toBeLessThan(1.01);
  });

  it('reads a world for what is there, with or without tile meanings', () => {
    const zmeyovo = findWorldPack('balkan-myth')!.build().map;
    const model = buildSceneModel(zmeyovo, tileSemanticsForMap(zmeyovo));
    const kinds = new Set(model.features.map((f) => f.kind));
    expect(kinds.has('house') && kinds.has('well') && kinds.has('tree')).toBe(true);
    expect(model.terrain.flat().filter((t) => t === 'water').length).toBeGreaterThan(50);
    expect(sceneShapes(model).length).toBeGreaterThan(500);

    const shevitsa = findWorldPack('shevitsa')!.build().map;
    expect(tileSemanticsForMap(shevitsa)).toBeUndefined();
    const plain = buildSceneModel(shevitsa);
    expect(plain.features.length).toBe(shevitsa.pointsOfInterest?.length ?? 0);
    expect(plain.features.every((f) => f.kind === 'star')).toBe(true);
    expect(plain.terrain.flat().some((t) => t === 'wall')).toBe(true);
  });
});

describe('interface glyphs', () => {
  it('draws every glyph inside its 16-unit box', () => {
    expect(GLYPH_NAMES.length).toBeGreaterThan(20);
    for (const name of GLYPH_NAMES) {
      const shapes = glyphShapes(name);
      expect(shapes.length, name).toBeGreaterThan(0);
      const b = bounds(shapes);
      expect(Math.max(-b.minX, -b.minY, b.maxX, b.maxY), name).toBeLessThanOrEqual(9);
    }
  });
});
