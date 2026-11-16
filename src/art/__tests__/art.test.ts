import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../../core/rng';
import { findWorldPack, tileSemanticsForMap } from '../../world/packs';
import { GLYPH_NAMES, glyphShapes } from '../glyphs';
import { lettering, letteringWidth } from '../lettering';
import { PALETTES } from '../looks';
import { bubbleTail } from '../overlayChrome';
import { EXPRESSIONS, figure, figureParts } from '../figures';
import { cloth, treeOfLife } from '../motifs';
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

describe('bubble tails', () => {
  const box = { x: 100, y: 50, w: 120, h: 40 };
  it('points down from the bottom edge to a head below the bubble', () => {
    const tail = bubbleTail(box, [160, 110]);
    expect(tail.side).toBe('bottom');
    expect(tail.base[0][1]).toBe(90);
    expect(tail.tip[1]).toBeGreaterThan(90);
    expect(tail.tip[1]).toBeLessThan(110);
  });
  it('leaves from the side that faces a head beside the bubble', () => {
    expect(bubbleTail(box, [60, 70]).side).toBe('left');
    expect(bubbleTail(box, [270, 72]).side).toBe('right');
    expect(bubbleTail(box, [160, 10]).side).toBe('top');
    const right = bubbleTail(box, [270, 72]);
    expect(right.base[0][0]).toBe(220);
    expect(right.tip[0]).toBeGreaterThan(220);
  });
  it('keeps the tail base on the box edge even when the head is far off to one side', () => {
    const tail = bubbleTail(box, [400, 200]);
    for (const [x, y] of tail.base) {
      expect(x).toBeGreaterThanOrEqual(box.x);
      expect(x).toBeLessThanOrEqual(box.x + box.w);
      expect(y).toBeGreaterThanOrEqual(box.y);
      expect(y).toBeLessThanOrEqual(box.y + box.h);
    }
  });
});

describe('figures in builds and views', () => {
  it('draws the skirted front figure exactly as before the views were added', async () => {
    const { createHash } = await import('node:crypto');
    const expected: Record<number, string> = {
      1: '66930031b79e8c30',
      5: '3b6f576ae0aa8ed4',
      7: '56f290af71ce5b1c',
      11: '99beb35f3e49ddbe',
      42: 'f7aa6037cd8f62e2',
      99: '45881695e86b3e43',
      1234: 'ad116a7a58650d5d',
      98765: '497964fb04a2ea0b',
    };
    for (const [seed, hash] of Object.entries(expected)) {
      const json = JSON.stringify(figure(createSeededRng(Number(seed)), { height: 30 }));
      expect(createHash('sha1').update(json).digest('hex').slice(0, 16), `seed ${seed}`).toBe(hash);
    }
  });

  it('keeps a person the same across views: same lean, resting mood and skin tone', () => {
    for (const build of ['skirted', 'trousered'] as const) {
      const front = figureParts(createSeededRng(21), { height: 30, build });
      for (const view of ['side', 'back'] as const) {
        const other = figureParts(createSeededRng(21), { height: 30, build, view });
        expect(other.lean).toBe(front.lean);
        expect(other.restingExpression).toBe(front.restingExpression);
        const tones = (parts: typeof front) =>
          new Set(parts.head.filter((s) => s.kind === 'area' && s.ink === 'skin').map((s) => (s.kind === 'area' ? s.tone : -1)));
        expect([...tones(other)]).toEqual([...tones(front)]);
      }
    }
  });

  it('shows a face from the front and side, and none from the back', () => {
    const eyes = (view: 'front' | 'side' | 'back') =>
      figureParts(createSeededRng(3), { height: 30, view, expression: 'calm' }).head.filter((s) => s.kind === 'knot' && s.ink === 'dark').length;
    expect(eyes('front')).toBe(2);
    expect(eyes('side')).toBe(1);
    expect(eyes('back')).toBe(0);
  });

  it('gives a trousered figure two long legs and hides the far arm side-on', () => {
    const man = figureParts(createSeededRng(8), { height: 30, build: 'trousered' });
    const legTop = Math.min(...man.legLeft.flatMap((s) => (s.kind === 'area' ? s.points.map((p) => p[1]) : [])));
    expect(legTop).toBeLessThan(-30 * 0.3);
    const side = figureParts(createSeededRng(8), { height: 30, build: 'trousered', view: 'side' });
    expect(side.armLeft.length).toBe(0);
    expect(side.armRight.length).toBeGreaterThan(0);
  });
});
