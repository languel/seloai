/**
 * Motifs in the world: grown patterns put to work on the cloth, chosen from the world's
 * pattern references (the Shevitsa regions unless the world names its own). A dancing
 * ground carries a medallion, a house a small one in its gable and a band under its eaves,
 * the cloth a border band round its edge with medallions in the corners, and aprons a small
 * counted motif. Every choice comes from a seed, so a world always wears the same patterns.
 */
import { createSeededRng } from '../core/rng';
import { findGrammar, growMotif, resolveMotifParams, type MotifGrid } from './patternGrammar';
import { SHEVITSA_REFERENCES, recipeFromReference, type PatternReference } from './patternReferences';

const MEDALLION_GRAMMARS = new Set(['star', 'lozenge', 'rosette', 'labyrinth']);
const BAND_GRAMMARS = new Set(['chevron', 'meander']);

/** The world's references, by id; all the Shevitsa ones when none are named. */
export function worldReferences(ids?: readonly string[]): PatternReference[] {
  if (!ids || ids.length === 0) return [...SHEVITSA_REFERENCES];
  const chosen = SHEVITSA_REFERENCES.filter((r) => ids.includes(r.id));
  return chosen.length ? chosen : [...SHEVITSA_REFERENCES];
}

function pick<T>(items: T[], seed: number): T {
  return items[Math.abs(Math.floor(seed)) % items.length];
}

/**
 * A medallion from the world's references, optionally held to a size (its radius in
 * stitches) so it fits where it goes.
 */
export function worldMedallion(seed: number, refs: PatternReference[], radius?: number): MotifGrid {
  const pool = refs.filter((r) => MEDALLION_GRAMMARS.has(r.grammar));
  const ref = pick(pool.length ? pool : SHEVITSA_REFERENCES.filter((r) => MEDALLION_GRAMMARS.has(r.grammar)), seed);
  const recipe = recipeFromReference(ref, seed);
  if (radius !== undefined) {
    const grammar = findGrammar(recipe.grammar)!;
    recipe.params = resolveMotifParams(grammar, { ...recipe.params, radius, rings: Math.min(Number(recipe.params.rings ?? 2), Math.max(1, Math.floor(radius / 2))) });
  }
  return growMotif(recipe);
}

/** A border band from the world's references, repeated to `length` stitches. */
export function worldBand(seed: number, refs: PatternReference[], length: number, height?: number): MotifGrid {
  const pool = refs.filter((r) => BAND_GRAMMARS.has(r.grammar));
  const ref = pick(pool.length ? pool : SHEVITSA_REFERENCES.filter((r) => BAND_GRAMMARS.has(r.grammar)), seed);
  const recipe = recipeFromReference(ref, seed);
  if (height !== undefined) {
    const grammar = findGrammar(recipe.grammar)!;
    recipe.params = resolveMotifParams(grammar, { ...recipe.params, height, edges: height >= 6 ? recipe.params.edges : false });
  }
  const unit = growMotif(recipe);
  // Bands repeat whole: tile the generated stretch to the length needed.
  const w = Math.max(1, Math.round(length));
  return { w, h: unit.h, cells: unit.cells.map((row) => Array.from({ length: w }, (_, x) => row[x % unit.w])) };
}

/** The same motif turned a quarter, for the upright sides of a border. */
export function transposed(grid: MotifGrid): MotifGrid {
  return { w: grid.h, h: grid.w, cells: Array.from({ length: grid.w }, (_, y) => Array.from({ length: grid.h }, (_, x) => grid.cells[x][y])) };
}

/** A stable seed from a name, for a world's own border. */
export function seedOf(text: string): number {
  const rng = createSeededRng([...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  return Math.floor(rng() * 1e6);
}
