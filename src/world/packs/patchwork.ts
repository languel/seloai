import { GENERIC_WORLD_CONTEXT, type WorldContext } from '../worldContext';
import { WORLD_PACK_FORMAT, WORLD_PACK_VERSION, type WorldPackDefinition } from '../worldPack';
import { patchworkVillage } from '../sceneGenerators';
import { mapFromScene } from '../worldScene';

export const PATCHWORK_CONTEXT: WorldContext = {
  ...GENERIC_WORLD_CONTEXT,
  settingName: 'the village',
  settingKind: 'patchwork village',
  fallbackLandmark: 'the square',
  premise: 'A close village of houses, gardens and strip fields round a square, cut through by a stream.',
};

/** A procedural village in the manner of a Klee patchwork. A place only; the cast stays. */
export const patchworkPack: WorldPackDefinition = {
  id: 'patchwork',
  name: 'Patchwork village (procedural)',
  description: 'Houses, gardens, fields and orchards on an irregular grid round a square, like a Klee village',
  build: () => {
    const map = mapFromScene({ recipe: { generator: patchworkVillage.id, params: patchworkVillage.resolveParams({}), seed: 3 }, edits: [] });
    return {
      format: WORLD_PACK_FORMAT,
      version: WORLD_PACK_VERSION,
      id: 'patchwork',
      name: map.name,
      description: 'A procedural patchwork village.',
      context: { ...structuredClone(PATCHWORK_CONTEXT), settingName: map.name },
      story: {},
      map,
    };
  },
};
