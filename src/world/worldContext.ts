/**
 * The setting-specific knowledge the engine needs but must not hardcode: what the place is
 * called, who the visitor is, the premise, and the scripted lines the no-model story engine
 * can draw on. A world pack supplies one; the engine falls back to a neutral default.
 */
export interface ConditionalLines {
  lines: string[];
  /** If set, the lines are offered only when the scene or last line mentions one of these words. */
  whenMentioned?: string[];
}

export interface StoryLinePools {
  /** Scene-opening beats. Placeholders: {a}, {b}, {place}. */
  openingBeats: string[];
  /** Scene-closing beats. Placeholders: {a}, {b}, {place}. */
  closingBeats: string[];
  /** Lines a specific character may say, keyed by character id. Placeholder: {partner}. */
  characterLines: Record<string, ConditionalLines>;
  /** Lines any character may say. Placeholder: {partner}. */
  sharedLines: ConditionalLines[];
}

export interface WorldContext {
  /** Proper name of the place ("Zmeyovo"). Empty when the world has none. */
  settingName: string;
  /** Common noun for the place ("village", "station", "court"). */
  settingKind: string;
  /** What the human visitor is called. */
  playerName: string;
  /** Landmark label used when the map defines none. */
  fallbackLandmark: string;
  /** One or two sentences of situation, given to models as grounding. */
  premise: string;
  /** Visual theme id for the interface, if the world declares one. */
  themeId?: string;
  storyLines: StoryLinePools;
}

export const GENERIC_WORLD_CONTEXT: WorldContext = {
  settingName: '',
  settingKind: 'village',
  playerName: 'Traveler',
  fallbackLandmark: 'the square',
  premise: '',
  storyLines: { openingBeats: [], closingBeats: [], characterLines: {}, sharedLines: [] },
};

/** "Zmeyovo" when the place is named, otherwise "the village". */
export function placeName(world: WorldContext): string {
  return world.settingName.trim() || `the ${world.settingKind}`;
}

/** "village of Zmeyovo" when named, otherwise "village". */
export function describeSetting(world: WorldContext): string {
  const name = world.settingName.trim();
  return name ? `${world.settingKind} of ${name}` : world.settingKind;
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** The lines from a conditional pool that apply to the given (lowercased) scene text. */
export function selectLines(pool: ConditionalLines | undefined, sceneTextLower: string): string[] {
  if (!pool) return [];
  if (pool.whenMentioned && !pool.whenMentioned.some((word) => sceneTextLower.includes(word))) {
    return [];
  }
  return pool.lines;
}
