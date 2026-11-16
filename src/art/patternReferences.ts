/**
 * Pattern references: a reference is a described style, not a picture. It names a grammar,
 * the range each of its parameters may take, and fixed choices such as which threads to use,
 * so every seed gives a new motif that still reads as belonging to that style. References
 * are data; a world pack can bring its own. The first set follows the regions of the
 * Shevitsa map.
 */
import { createSeededRng } from '../core/rng';
import { findGrammar, growMotif, resolveMotifParams, type MotifGrid, type MotifParamValue, type MotifRecipe } from './patternGrammar';

/** A parameter is fixed, an inclusive [min, max] range, or a list to choose from. */
export type ReferenceValue = MotifParamValue | [number, number] | MotifParamValue[];

export interface PatternReference {
  id: string;
  label: string;
  /** Where the style is from, for people reading the pack. */
  region: string;
  /** A sentence on what makes the style itself. */
  description: string;
  grammar: string;
  params: Record<string, ReferenceValue>;
}

export const SHEVITSA_REFERENCES: readonly PatternReference[] = [
  {
    id: 'shopluk-elbetitsa',
    label: 'Shopluk elbetitsa',
    region: 'Shopluk (west)',
    description: 'A dense eight-pointed star in red and black, stepped arms, a lozenge at the heart.',
    grammar: 'star',
    params: { radius: [8, 12], arm: [2, 3.25], diagonal: [0.7, 1], bands: [2, 3], centre: ['lozenge', 'cross'], outline: 'dark', fill: 'primary', accent: ['dark', 'gold'] },
  },
  {
    id: 'central-balkan-tree',
    label: 'Tree of life with birds',
    region: 'Central Balkan',
    description: 'A tall tree on one axis, paired branches ending in flowers, in red and green.',
    grammar: 'tree',
    params: { height: [17, 25], levels: [3, 4], flower: 'mixed', leaves: true, trunk: 'dark', bloom: 'primary', second: ['accent2', 'gold'], leaf: 'accent' },
  },
  {
    id: 'pirin-labyrinth',
    label: 'Pirin stepped labyrinth',
    region: 'Pirin (south-west)',
    description: 'Stepped meanders in pink and blue, each ring opened by a turning gap.',
    grammar: 'labyrinth',
    params: { radius: [6, 11], turn: [1, 3], diamond: [true, false], wall: 'accent2', second: 'secondary' },
  },
  {
    id: 'rhodope-rosette',
    label: 'Rhodope solar rosette',
    region: 'Rhodopes (south)',
    description: 'A many-rayed sun turning round a dark heart, gold rays inside red rings.',
    grammar: 'rosette',
    params: { radius: [7, 12], rays: [8, 14], twist: [0.06, 0.22], rings: [1, 2], ray: 'gold', ring: 'primary', core: 'dark' },
  },
  {
    id: 'chiprovtsi-kilim',
    label: 'Chiprovtsi kilim lozenge',
    region: 'Chiprovtsi (north-west)',
    description: 'A woven lozenge in nested rings with a sawtooth edge and spurs, as on a kilim.',
    grammar: 'lozenge',
    params: { radius: [7, 12], rings: [2, 4], teeth: true, spurs: [1, 3], solid: [true, false], outline: 'dark', fill: ['primary', 'secondary'], accent: ['gold', 'accent'] },
  },
  {
    id: 'dobrudzha-chevron',
    label: 'Dobrudzha harvest chevrons',
    region: 'Dobrudzha (north-east)',
    description: 'Bands of nested chevrons in gold and red, like rows of wheat.',
    grammar: 'chevron',
    params: { height: [4, 7], period: [3, 5], repeats: [8, 12], thickness: [1, 2], first: 'gold', second: ['primary', 'dark'] },
  },
  {
    id: 'danube-wave',
    label: 'Danube wave meander',
    region: 'Danube (north)',
    description: 'A blue wave rising and falling between dark edge lines.',
    grammar: 'meander',
    params: { height: [4, 7], period: [6, 10], repeats: [4, 6], stepped: true, edges: true, wave: 'secondary', edge: 'dark' },
  },
  {
    id: 'strandzha-sun',
    label: 'Strandzha sea sun',
    region: 'Strandzha (south-east)',
    description: 'A lighter sun of broad, nearly straight rays, blue rings for the sea.',
    grammar: 'rosette',
    params: { radius: [6, 10], rays: [8, 10], twist: [-0.08, 0.08], rings: [1, 3], ray: ['gold', 'primary'], ring: 'secondary', core: 'gold' },
  },
];

/** Chooses each parameter of a reference for one seed: a recipe to grow. */
export function recipeFromReference(ref: PatternReference, seed: number): MotifRecipe {
  const grammar = findGrammar(ref.grammar);
  if (!grammar) throw new Error(`Reference "${ref.id}" uses unknown grammar "${ref.grammar}".`);
  const rng = createSeededRng(seed * 97 + 13);
  const params: Record<string, MotifParamValue> = {};
  for (const spec of grammar.params) {
    const value = ref.params[spec.key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number' && spec.type !== 'enum' && spec.type !== 'ink') {
        const [a, b] = value as [number, number];
        const v = a + rng() * (b - a);
        params[spec.key] = spec.type === 'int' ? Math.round(v) : Math.round(v * 100) / 100;
      } else {
        params[spec.key] = (value as MotifParamValue[])[Math.floor(rng() * value.length)];
      }
    } else params[spec.key] = value;
  }
  return { grammar: grammar.id, params: resolveMotifParams(grammar, params), seed };
}

export function motifFromReference(ref: PatternReference, seed: number): MotifGrid {
  return growMotif(recipeFromReference(ref, seed));
}
