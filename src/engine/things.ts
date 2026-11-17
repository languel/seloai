import type { FeatureKind, SceneModel, Terrain } from '../art/scene';

/**
 * Everyday words for the things on the cloth: "go to the river", "sit under a tree", "wait by
 * the flowers". Each word names feature kinds or a kind of ground; the nearest one is meant.
 */
interface ThingSense {
  label: string;
  features?: FeatureKind[];
  terrain?: Terrain[];
}

const SENSES: Array<[RegExp, ThingSense]> = [
  [/^(house|houses|home|cottage|hut|hovel|cabin)$/, { label: 'a house', features: ['house'] }],
  [/^(forest|woods?|grove|thicket|copse)$/, { label: 'the trees', features: ['grove', 'pine', 'tree'] }],
  [/^(trees?|oak|oaks|birch|willow|pines?|sapling|shade)$/, { label: 'a tree', features: ['tree', 'pine', 'grove', 'sapling'] }],
  [/^(well|wellspring)$/, { label: 'the well', features: ['well'] }],
  [/^(hearth|fire|fireplace|bonfire|forge)$/, { label: 'the hearth', features: ['hearth'] }],
  [/^(square|plaza|dance|dancing|khoro|horo|green)$/, { label: 'the square', features: ['star'] }],
  [/^(pond|pool|lake|spring)$/, { label: 'the pond', features: ['pool'] }],
  [/^(fields?|wheat|crops?|meadow|barley|rye)$/, { label: 'the fields', features: ['wheat', 'field'] }],
  [/^(flowers?|garden|blooms?|roses?|poppies|poppy)$/, { label: 'the flowers', features: ['flowers', 'sunflower', 'rosette'] }],
  [/^(sunflowers?)$/, { label: 'the sunflowers', features: ['sunflower'] }],
  [/^(fences?|gate)$/, { label: 'the fence', features: ['fence'] }],
  [/^(haystacks?|hay|stack)$/, { label: 'the haystack', features: ['haystack'] }],
  [/^(woodpile|firewood|logs?)$/, { label: 'the woodpile', features: ['woodpile'] }],
  [/^(hens?|chickens?|hen-?house|coop)$/, { label: 'the hens', features: ['hen'] }],
  [/^(vineyard|vines?|grapes?)$/, { label: 'the vineyard', features: ['vineyard'] }],
  [/^(reeds?|rushes)$/, { label: 'the reeds', features: ['reeds'] }],
  [/^(ducks?|geese|goose)$/, { label: 'the ducks', features: ['duck'] }],
  [/^(river|stream|brook|creek|water|riverbank|bank|shore|ford)$/, { label: 'the river', terrain: ['water'] }],
  [/^(road|path|street|lane|track)$/, { label: 'the road', terrain: ['road'] }],
  [/^(bridge)$/, { label: 'the bridge', terrain: ['bridge'] }],
];

/** The thing a text names, by the first word that names one. */
export function thingSenseFor(text: string): ThingSense | undefined {
  for (const word of text.toLowerCase().split(/[^a-z-]+/)) {
    if (!word) continue;
    const hit = SENSES.find(([re]) => re.test(word));
    if (hit) return hit[1];
  }
  return undefined;
}

/**
 * Where the nearest such thing is, as the cells it covers (a feature's footprint, or matching
 * ground), nearest to `from` first. Undefined when the world has none.
 */
export function nearestThing(
  scene: SceneModel,
  sense: ThingSense,
  from: { x: number; y: number },
): { cells: Array<{ x: number; y: number }>; centre: { x: number; y: number } } | undefined {
  let best: { cells: Array<{ x: number; y: number }>; centre: { x: number; y: number }; d: number } | undefined;
  if (sense.features?.length) {
    const kinds = new Set(sense.features);
    // Earlier kinds in the list are what the word means first; later ones only stand in.
    for (const kind of sense.features) {
      for (const f of scene.features) {
        if (f.kind !== kind || !kinds.has(f.kind)) continue;
        const centre = { x: f.x + f.w / 2 - 0.5, y: f.y + f.h / 2 - 0.5 };
        const d = Math.hypot(centre.x - from.x, centre.y - from.y);
        if (!best || d < best.d) {
          const cells: Array<{ x: number; y: number }> = [];
          for (let dx = 0; dx < Math.max(1, Math.round(f.w)); dx++)
            for (let dy = 0; dy < Math.max(1, Math.round(f.h)); dy++) cells.push({ x: Math.floor(f.x) + dx, y: Math.floor(f.y) + dy });
          best = { cells, centre, d };
        }
      }
      if (best) break;
    }
  }
  if (!best && sense.terrain?.length) {
    const kinds = new Set(sense.terrain);
    for (let x = 0; x < scene.width; x++) {
      for (let y = 0; y < scene.height; y++) {
        if (!kinds.has(scene.terrain[x]?.[y])) continue;
        const d = Math.hypot(x - from.x, y - from.y);
        if (!best || d < best.d) best = { cells: [{ x, y }], centre: { x, y }, d };
      }
    }
  }
  return best ? { cells: best.cells, centre: best.centre } : undefined;
}
