/**
 * Places as they are said in a sentence. Most landmarks are named like things ("Well",
 * "Samodiva Glade", "Kukeri Fire Hearth") and take "the": "go to the Well". Proper names of
 * settlements and regions ("Zmeyovo", "Pirin"), possessives ("Baba Rada's house") and names
 * that already have an article are left alone. Labels stay as they are on the map; this is
 * only how they are spoken of.
 */

/** Words that make a place name a thing rather than a proper name, when they end it. */
const THING_WORDS = new Set(
  [
    'well', 'spring', 'springs', 'river', 'stream', 'creek', 'brook', 'ford', 'bridge', 'pond', 'lake', 'shore', 'coast',
    'orchard', 'field', 'fields', 'meadow', 'meadows', 'plain', 'plains', 'garden', 'gardens', 'grove', 'glade', 'forest', 'wood', 'woods',
    'hill', 'hills', 'ridge', 'cliff', 'cave', 'gorge', 'pass', 'peak', 'mountain', 'valley',
    'square', 'plaza', 'market', 'crossroads', 'gate', 'road', 'path', 'lane', 'street', 'wall',
    'house', 'houses', 'hut', 'porch', 'yard', 'barn', 'mill', 'forge', 'smithy', 'hearth', 'oven', 'loom', 'cardak', 'tavern', 'inn',
    'church', 'chapel', 'monastery', 'shrine', 'altar', 'cemetery', 'graveyard', 'tower', 'ring', 'circle', 'labyrinth', 'stone', 'stones',
    'oak', 'tree', 'middle', 'centre', 'center', 'start', 'hamlet', 'hamlets', 'households', 'village',
  ],
);

/** The place as said mid-sentence: "the Well", "the Samodiva Glade", but "Zmeyovo". */
export function placeRef(label: string): string {
  const name = label.trim();
  if (!name) return name;
  if (/^(the|a|an)\s/i.test(name)) return name.replace(/^The\s/, 'the ');
  if (/['’]s\b/.test(name)) return name;
  // The last word before any bracketed note ("Spiral Labyrinth (Pirin)") decides.
  const words = name.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/\s+/);
  const last = words[words.length - 1]?.toLowerCase().replace(/[^a-z]/g, '');
  return last && THING_WORDS.has(last) ? `the ${name}` : name;
}

/** A place name with any leading article taken off, for matching what someone said to a label. */
export function placeKey(text: string): string {
  return text.trim().replace(/^#/, '').replace(/^(the|a|an)\s+/i, '').toLowerCase();
}
