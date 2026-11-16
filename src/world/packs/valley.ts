import { GENERIC_WORLD_CONTEXT, type WorldContext } from '../worldContext';
import { WORLD_PACK_FORMAT, WORLD_PACK_VERSION, type WorldPackDefinition } from '../worldPack';
import { wangValley } from '../sceneGenerators';
import { mapFromScene } from '../worldScene';

export const VALLEY_CONTEXT: WorldContext = {
  ...GENERIC_WORLD_CONTEXT,
  settingName: 'the valley',
  settingKind: 'valley of hamlets',
  fallbackLandmark: 'the crossroads',
  premise: 'A river valley of small hamlets joined by dirt roads, with old woods on the slopes.',
};

export const VALLEY_SEED = 7;

/** A procedural world: generated from a recipe, with no tiles. A place only; the cast stays. */
export const valleyPack: WorldPackDefinition = {
  id: 'valley',
  name: 'Valley (procedural)',
  description: 'Hamlets, roads, a river and woods, generated from a seed and editable as a place',
  build: () => {
    const map = mapFromScene({ recipe: { generator: wangValley.id, params: wangValley.resolveParams({}), seed: VALLEY_SEED }, edits: [] });
    return {
      format: WORLD_PACK_FORMAT,
      version: WORLD_PACK_VERSION,
      id: 'valley',
      name: map.name,
      description: 'A procedural valley of hamlets.',
      context: { ...structuredClone(VALLEY_CONTEXT), settingName: map.name },
      story: {},
      map,
    };
  },
};
