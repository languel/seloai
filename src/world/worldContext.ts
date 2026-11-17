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
  /** How the story should open: guidance for the Scribe's prologue (optional). */
  opening?: string;
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

/**
 * A world context from a hand-written file (a student's story pack), with anything missing
 * filled from the neutral default, so a short file still loads.
 */
export function normalizeWorldContext(raw: unknown): WorldContext {
  const w = (raw && typeof raw === 'object' ? raw : {}) as Partial<WorldContext>;
  const lines = (w.storyLines ?? {}) as Partial<StoryLinePools>;
  const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  return {
    settingName: text(w.settingName, GENERIC_WORLD_CONTEXT.settingName),
    settingKind: text(w.settingKind, GENERIC_WORLD_CONTEXT.settingKind) || 'village',
    playerName: text(w.playerName, GENERIC_WORLD_CONTEXT.playerName) || 'Traveler',
    fallbackLandmark: text(w.fallbackLandmark, GENERIC_WORLD_CONTEXT.fallbackLandmark),
    premise: text(w.premise, ''),
    ...(typeof w.opening === 'string' && w.opening.trim() ? { opening: w.opening } : {}),
    ...(typeof w.themeId === 'string' ? { themeId: w.themeId } : {}),
    storyLines: {
      openingBeats: Array.isArray(lines.openingBeats) ? lines.openingBeats.filter((l) => typeof l === 'string') : [],
      closingBeats: Array.isArray(lines.closingBeats) ? lines.closingBeats.filter((l) => typeof l === 'string') : [],
      characterLines: lines.characterLines && typeof lines.characterLines === 'object' ? lines.characterLines : {},
      sharedLines: Array.isArray(lines.sharedLines) ? lines.sharedLines : [],
    },
  };
}

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
