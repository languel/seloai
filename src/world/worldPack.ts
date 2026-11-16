import { validateTileMeanings } from '../art/scene';
import type { VillageMap, VillagerConfig } from '../engine/types';
import type { WorldContext } from './worldContext';

export const WORLD_PACK_FORMAT = 'seloai-world-pack';
export const WORLD_PACK_VERSION = 1;

/**
 * A complete, self-describing world: the place, the people, the premise and how it opens.
 * Everything specific to one setting lives here rather than in engine code.
 */
export interface WorldPack {
  format: typeof WORLD_PACK_FORMAT;
  version: number;
  id: string;
  name: string;
  description: string;
  context: WorldContext;
  story: {
    /** Message sent into the world when it is first loaded, to set events in motion. */
    openingDirective?: string;
    /** Character whose point of view the world opens on. */
    focalCharacterId?: string;
  };
  map: VillageMap;
  /** The cast. Omitted when the pack is a place only and keeps whoever is already there. */
  cast?: VillagerConfig[];
}

/** A pack that is generated on demand (all bundled worlds are procedural). */
export interface WorldPackDefinition {
  id: string;
  name: string;
  description: string;
  build: () => WorldPack;
}

/** Returns a list of problems; an empty list means the pack is usable. */
export function validateWorldPack(pack: unknown): string[] {
  const problems: string[] = [];
  const p = pack as Partial<WorldPack> | null;
  if (!p || typeof p !== 'object') return ['Pack is not an object.'];
  if (p.format !== WORLD_PACK_FORMAT) problems.push(`format must be "${WORLD_PACK_FORMAT}".`);
  if (typeof p.version !== 'number') problems.push('version must be a number.');
  else if (p.version > WORLD_PACK_VERSION) {
    problems.push(`version ${p.version} is newer than this build supports (${WORLD_PACK_VERSION}).`);
  }
  if (!p.id || typeof p.id !== 'string') problems.push('id is required.');
  if (!p.name || typeof p.name !== 'string') problems.push('name is required.');
  if (!p.context || typeof p.context !== 'object') problems.push('context is required.');
  else {
    if (typeof p.context.settingKind !== 'string' || !p.context.settingKind) {
      problems.push('context.settingKind is required.');
    }
    if (!p.context.storyLines) problems.push('context.storyLines is required.');
  }
  const map = p.map;
  if (!map || !Array.isArray(map.bgTiles) || typeof map.width !== 'number') {
    problems.push('map is missing or malformed.');
  } else {
    if (map.bgTiles[0]?.length !== map.width) problems.push('map.bgTiles does not match map.width.');
    if (map.collisionGrid?.length !== map.width) problems.push('map.collisionGrid does not match map.width.');
    if (map.tileMeanings !== undefined) problems.push(...validateTileMeanings(map.tileMeanings).map((p) => `map.${p}`));
  }
  if (p.cast !== undefined) {
    if (!Array.isArray(p.cast)) problems.push('cast must be a list.');
    else {
      const ids = new Set<string>();
      for (const member of p.cast) {
        if (!member?.id) problems.push('every cast member needs an id.');
        else if (ids.has(member.id)) problems.push(`duplicate cast id "${member.id}".`);
        else ids.add(member.id);
      }
      const focal = p.story?.focalCharacterId;
      if (focal && !ids.has(focal)) problems.push(`story.focalCharacterId "${focal}" is not in the cast.`);
      for (const id of Object.keys(p.context?.storyLines?.characterLines ?? {})) {
        if (!ids.has(id)) problems.push(`storyLines.characterLines has unknown character "${id}".`);
      }
    }
  }
  return problems;
}
