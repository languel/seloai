import type { TileMeaningTable } from '../art/scene';

/**
 * What the tiles of the Shevitsa map mean. The map is a regional embroidery chart of
 * Bulgaria: linen outside the border, meadow, mountains and water inside, ribbon paths
 * between the regions, and a large motif at the heart of each region.
 */
export const SHEVITSA_TILE_MEANINGS: TileMeaningTable = [
  { note: 'Danube and Black Sea', tiles: [5], terrain: 'water' },
  { note: 'shallow Danube ford and coastal pier', tiles: [4, 6], terrain: 'bridge' },
  { note: 'ochre ribbon paths between the regions', tiles: [3], terrain: 'road' },
  // Stara Planina is stone with a pass every few cells, so only the impassable cells read as a ridge.
  { note: 'Balkan ridge stone', tiles: [7], terrain: 'dry', blockedTerrain: 'wall' },
  { note: 'Rila and Pirin snow peaks, drawn as stone (they still block)', tiles: [8], terrain: 'dry' },
  { note: 'black cross-stitch border around the realm', tiles: [11], terrain: 'wall' },
  { note: 'Rhodope pine', tiles: [14], feature: { kind: 'pine', w: 1, h: 1 } },
  { note: 'Shopluk elbetitsa', tiles: [32], feature: { kind: 'star', w: 4, h: 4 } },
  { note: 'Tree of Life with paired birds', tiles: [64], feature: { kind: 'tree', w: 4, h: 4 } },
  { note: 'Pirin stepped labyrinth', tiles: [96], feature: { kind: 'star', w: 4, h: 4 } },
  { note: 'Rhodope and Strandzha solar rosette', tiles: [128], feature: { kind: 'star', w: 4, h: 4 } },
  { note: 'Chiprovtsi kilim diamond', tiles: [160], feature: { kind: 'star', w: 4, h: 4 } },
  { note: 'stone fountain (cheshma)', tiles: [224], feature: { kind: 'well', w: 1, h: 1 } },
  { note: 'carved wooden loom', tiles: [225], feature: { kind: 'prop', w: 1, h: 1 } },
  { note: 'solar hearth', tiles: [226], feature: { kind: 'hearth', w: 1, h: 1 } },
  { note: 'sacred boundary marker', tiles: [227], feature: { kind: 'prop', w: 1, h: 1 } },
];
