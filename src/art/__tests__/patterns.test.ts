import { describe, expect, it } from 'vitest';
import { MOTIF_GRAMMARS, growMotif, resolveMotifParams, type MotifGrid } from '../patternGrammar';
import { SHEVITSA_REFERENCES, motifFromReference, recipeFromReference } from '../patternReferences';

const filled = (g: MotifGrid) => g.cells.flat().filter(Boolean).length;
const mirrorX = (g: MotifGrid) => g.cells.every((row) => row.every((c, x) => c === row[g.w - 1 - x]));
const mirrorY = (g: MotifGrid) => g.cells.every((row, y) => row.every((c, x) => c === g.cells[g.h - 1 - y][x]));

describe('the motif grammar', () => {
  it('every grammar grows a non-empty motif from its defaults, the same every time', () => {
    for (const g of MOTIF_GRAMMARS) {
      const recipe = { grammar: g.id, params: resolveMotifParams(g, {}), seed: 3 };
      const a = growMotif(recipe);
      expect(filled(a)).toBeGreaterThan(8);
      expect(JSON.stringify(growMotif(recipe))).toBe(JSON.stringify(a));
      expect(a.cells.length).toBe(a.h);
      expect(a.cells[0].length).toBe(a.w);
    }
  });

  it('stars and lozenges are mirror-symmetric both ways; trees left to right', () => {
    for (let seed = 1; seed < 8; seed++) {
      for (const id of ['star', 'lozenge']) {
        const g = growMotif({ grammar: id, params: {}, seed });
        expect(mirrorX(g) && mirrorY(g)).toBe(true);
      }
      expect(mirrorX(growMotif({ grammar: 'tree', params: {}, seed }))).toBe(true);
    }
  });

  it('never draws a sun of few, strongly turning rays', () => {
    const g = growMotif({ grammar: 'rosette', params: { rays: 4, twist: 0.4 }, seed: 1 });
    const loose = growMotif({ grammar: 'rosette', params: { rays: 8, twist: 0.3 }, seed: 1 });
    // Asking for four strongly turning rays gives eight rays turning no more than gently.
    expect(JSON.stringify(g)).toBe(JSON.stringify(loose));
  });
});

describe('pattern references', () => {
  it('each Shevitsa reference grows varied motifs within its ranges', () => {
    for (const ref of SHEVITSA_REFERENCES) {
      const motifs = [1, 2, 3, 4].map((s) => JSON.stringify(motifFromReference(ref, s)));
      expect(new Set(motifs).size).toBeGreaterThan(1);
      const recipe = recipeFromReference(ref, 5);
      expect(recipe.grammar).toBe(ref.grammar);
      for (const [key, value] of Object.entries(ref.params)) {
        const v = recipe.params[key];
        if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof v === 'number') {
          expect(v).toBeGreaterThanOrEqual(Math.min(value[0] as number, value[1] as number) - 1e-9);
          expect(v).toBeLessThanOrEqual(Math.max(value[0] as number, value[1] as number) + 1e-9);
        } else if (!Array.isArray(value)) expect(v).toBe(value);
      }
    }
  });
});

describe('motifs in the world', () => {
  it('bands repeat seamlessly to any length; medallions can be held to a size', async () => {
    const { worldBand, worldMedallion, transposed, worldReferences } = await import('../worldMotifs');
    const refs = worldReferences();
    const band = worldBand(7, refs, 101, 5);
    expect(band.w).toBe(101);
    expect(band.h).toBe(5);
    const up = transposed(band);
    expect(up.w).toBe(5);
    expect(up.h).toBe(101);
    expect(up.cells[10][2]).toBe(band.cells[2][10]);
    const small = worldMedallion(3, refs, 3);
    // Held as small as its grammar allows: never larger than the same motif unheld.
    expect(Math.max(small.w, small.h)).toBeLessThanOrEqual(Math.max(worldMedallion(3, refs).w, worldMedallion(3, refs).h));
    expect(JSON.stringify(worldMedallion(3, refs, 3))).toBe(JSON.stringify(small));
    // A world that names its references only wears those.
    const elbetitsa = worldMedallion(1, worldReferences(['shopluk-elbetitsa']));
    expect(elbetitsa.w).toBe(elbetitsa.h);
  });

  it('a dancing ground, houses and the border are stitched as counted work', async () => {
    const { sceneShapes } = await import('../sceneArt');
    const terrain = Array.from({ length: 20 }, () => Array(14).fill('ground'));
    const model = {
      width: 20,
      height: 14,
      terrain,
      features: [
        { id: 's', kind: 'star' as const, x: 4, y: 4, w: 2, h: 2, seed: 11 },
        { id: 'h', kind: 'house' as const, x: 10, y: 5, w: 2, h: 2, seed: 12 },
      ],
      landmarks: [],
      title: 'Test',
    };
    const counted = sceneShapes(model).filter((s) => s.kind === 'counted');
    // The dancing ground, the gable, the eaves band, four border bands and four corners.
    expect(counted.length).toBeGreaterThanOrEqual(11);
  });
});
