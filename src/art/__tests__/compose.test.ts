import { describe, expect, it } from 'vitest';
import { coverage, frame, mirrorX, mirrorY, nest, repeat, turn } from '../compose';
import { comb, eye, lozenge, star } from '../textileLexicon';
import { carpetCloth, samplerCloth, type VillageBrief } from '../textileLayouts';

const worked = (g: { cells: unknown[][] }) => g.cells.flat().filter(Boolean).length;
const brief: VillageBrief = { name: 'MALKO BRDO', households: 4, people: 6, river: true, orchard: 3, fields: 4 };

describe('composition operators', () => {
  it('repeats motifs whole and never cuts one', () => {
    const unit = eye();
    for (const length of [5, 6, 11, 12, 13, 40]) {
      const band = repeat([unit], length, { gap: 2 });
      expect(band.w).toBe(length);
      expect(worked(band) % worked(unit)).toBe(0);
    }
  });

  it('ends an alternating band on the motif it began with, so the band mirrors', () => {
    const band = repeat([eye(), comb(3)], 61, { gap: 3, align: 'centre' });
    expect(mirrorX(band).cells).toEqual(band.cells);
  });

  it('keeps every stitch through mirrors and quarter turns', () => {
    const g = comb(4);
    expect(worked(mirrorX(g))).toBe(worked(g));
    expect(worked(turn(g))).toBe(worked(g));
    expect(turn(turn(g)).cells).toEqual(g.cells);
  });

  it('frames a cloth with both mirror symmetries', () => {
    const f = frame(57, 45, [eye(), comb(3)], { corner: star(2), gap: 4 });
    expect(mirrorX(f).cells).toEqual(f.cells);
    expect(mirrorY(f).cells).toEqual(f.cells);
  });

  it('nests without unpicking the outer motif', () => {
    const outer = lozenge(9, 'primary', { thickness: 2 });
    expect(worked(nest(outer, star(2)))).toBe(worked(outer) + worked(star(2)));
  });
});

describe('textile layouts', () => {
  it('keep to the stitch budget: most of the cloth is bare', () => {
    for (const seed of [1, 7, 42]) {
      expect(coverage(carpetCloth(brief, seed).grid)).toBeLessThan(0.2);
      expect(coverage(samplerCloth(brief, seed).grid)).toBeLessThan(0.2);
    }
  });

  it('are the same cloth for the same seed', () => {
    expect(carpetCloth(brief, 7).grid.cells).toEqual(carpetCloth(brief, 7).grid.cells);
    expect(samplerCloth(brief, 7).grid.cells).toEqual(samplerCloth(brief, 7).grid.cells);
  });

  it('lay the carpet mirrored in form about its upright axis', () => {
    const { grid } = carpetCloth(brief, 7);
    const shape = (g: typeof grid) => g.cells.map((r) => r.map(Boolean));
    expect(shape(mirrorX(grid))).toEqual(shape(grid));
  });
});
