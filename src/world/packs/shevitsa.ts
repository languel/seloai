import { createBulgarianShevitsaMap } from '../../data/shevitsaMap';
import { GENERIC_WORLD_CONTEXT, type WorldContext } from '../worldContext';
import { WORLD_PACK_FORMAT, WORLD_PACK_VERSION, type WorldPackDefinition } from '../worldPack';

export const SHEVITSA_CONTEXT: WorldContext = {
  ...GENERIC_WORLD_CONTEXT,
  settingName: 'Shevitsa',
  settingKind: 'embroidered realm',
  fallbackLandmark: 'the Elbetitsa crossing',
  premise: 'A map of Bulgaria stitched in regional embroidery, where each region keeps its own motif.',
  themeId: 'shevitsa',
};

/** A place only: it keeps whichever cast is already in the world. */
export const shevitsaPack: WorldPackDefinition = {
  id: 'shevitsa',
  name: 'Шевици: Embroidered Bulgaria',
  description: '64×48 regional Shevitsa motifs (Elbetitsa, Kanatitsa, Tree of Life) & POIs',
  build: () => ({
    format: WORLD_PACK_FORMAT,
    version: WORLD_PACK_VERSION,
    id: 'shevitsa',
    name: 'Шевици: Embroidered Bulgaria',
    description: 'The embroidered realm of Bulgaria, region by region.',
    context: structuredClone(SHEVITSA_CONTEXT),
    story: {},
    map: createBulgarianShevitsaMap(),
  }),
};
