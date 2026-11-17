/**
 * A village on a textile: the layout's cloth becomes the ground of a world. The signs the
 * layout placed say where people cannot walk (the frame, houses, tree trunks, water but not
 * its bridge), and name the places (the square, the bridge, each household's door, the
 * orchard and the fields). Bare linen is open ground, so the streets are simply the cloth
 * the maker left unworked.
 */
import { textileCloth, type Sign, type TextileLayout } from '../art/textileLayouts';
import type { SceneModel, Terrain } from '../art/scene';
import type { PointOfInterest, SpawnPoint } from '../engine/types';
import type { GeneratedWorld } from './sceneGenerators';

/**
 * Stitches to one cell of the world by default: a door is about a cell and a half, a house
 * four cells. Fewer stitches to a cell make every ornament larger against the people.
 */
export const TEXTILE_STITCHES_PER_CELL = 4;

export interface TextileVillageOptions {
  layout: TextileLayout;
  name: string;
  households: number;
  river: boolean;
  orchard: number;
  fields: number;
  seed: number;
  /** Stitches to one cell: the scale of the ornament against the people (default 4). */
  stitchesPerCell?: number;
}

export function generateTextileVillage(options: TextileVillageOptions): GeneratedWorld {
  const S = Math.max(2, Math.min(8, Math.round(options.stitchesPerCell ?? TEXTILE_STITCHES_PER_CELL)));
  const cloth = textileCloth(options.layout, { ...options, people: 0, houseWidth: 17 }, options.seed);
  const width = Math.ceil(cloth.grid.w / S);
  const height = Math.ceil(cloth.grid.h / S);
  const ox = Math.floor((width * S - cloth.grid.w) / 2);
  const oy = Math.floor((height * S - cloth.grid.h) / 2);

  // The stitches of a sign that stop a walker; flat signs (the square, wheat, bands) stop no one.
  const solid = (s: Sign): Sign | undefined => {
    if (s.kind === 'frame' || s.kind === 'water') return s;
    // A house: its walls, not the gable above them, so people pass behind a roof.
    if (s.kind === 'house') return { ...s, y: s.y + Math.floor(s.h / 2), h: Math.ceil(s.h / 2) };
    // A tree: its trunk.
    if (s.kind === 'tree') return { ...s, x: s.x + Math.floor(s.w / 2) - 1, w: 3, y: s.y + Math.floor(s.h / 2), h: Math.ceil(s.h / 2) };
    return undefined;
  };
  const solids = cloth.signs.map(solid).filter((s): s is Sign => Boolean(s));
  const bridges = cloth.signs.filter((s) => s.kind === 'bridge');
  const within = (s: Sign, x: number, y: number, pad = 0) => x >= s.x - pad && x < s.x + s.w + pad && y >= s.y - pad && y < s.y + s.h + pad;
  /** The stitch at the centre of a cell, in the cloth's own stitches. */
  const mid = (c: number, o: number) => c * S + S / 2 - o;

  const terrain: Terrain[][] = Array.from({ length: width }, () => Array<Terrain>(height).fill('ground'));
  const blocked: boolean[][] = Array.from({ length: width }, () => Array<boolean>(height).fill(false));
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const sx = mid(x, ox);
      const sy = mid(y, oy);
      if (bridges.some((b) => within(b, sx, sy, 2))) {
        terrain[x][y] = 'bridge';
        continue;
      }
      const hit = solids.find((s) => within(s, sx, sy));
      if (!hit) continue;
      blocked[x][y] = true;
      if (hit.kind === 'water') terrain[x][y] = 'water';
    }
  }

  const cellOf = (sx: number, sy: number): [number, number] => [
    Math.max(0, Math.min(width - 1, Math.floor((sx + ox) / S))),
    Math.max(0, Math.min(height - 1, Math.floor((sy + oy) / S))),
  ];
  const landmarks: PointOfInterest[] = [];
  const add = (id: string, label: string, at: [number, number], description: string) =>
    landmarks.push({ id: `poi-${id}`, tag: label.replace(/[^A-Za-z0-9]+/g, ''), label, x: at[0], y: at[1], description });
  const centreOf = (s: Sign) => cellOf(s.x + s.w / 2, s.y + s.h / 2);
  const below = (s: Sign) => cellOf(s.x + s.w / 2, s.y + s.h + S / 2);

  const square = cloth.signs.find((s) => s.kind === 'square');
  if (square) add('square', `${options.name} square`, centreOf(square), 'The table everyone comes to: the heart of the village, where the khoro is danced.');
  bridges.forEach((b, i) => add(`bridge-${i}`, 'The plank bridge', centreOf(b), 'The one crossing of the river, an eye stitched each side to ward it.'));
  const houses = cloth.signs.filter((s) => s.kind === 'house').sort((a, b) => a.x - b.x);
  const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
  houses.forEach((h, i) => add(`house-${i}`, `${ORDINALS[i] ?? `House ${i + 1}`} house`, below(h), 'A household, its sign worked in the gable.'));
  const mean = (list: Sign[]): [number, number] => cellOf(list.reduce((n, s) => n + s.x + s.w / 2, 0) / list.length, Math.max(...list.map((s) => s.y + s.h)) + S / 2);
  const trees = cloth.signs.filter((s) => s.kind === 'tree' && (!houses.length || s.y > houses[0].y + houses[0].h));
  if (trees.length) add('orchard', 'The orchard', mean(trees), 'Trees of life in a row on the far bank.');
  const wheat = cloth.signs.filter((s) => s.kind === 'wheat');
  if (wheat.length) add('fields', 'The wheat field', mean(wheat), 'Ears of wheat, the harvest of the village.');

  const spawns: SpawnPoint[] = landmarks.filter((l) => l.id.startsWith('poi-house')).map((l) => ({ id: `spawn-${l.id}`, label: l.label, x: l.x, y: l.y }));

  const model: SceneModel = {
    width,
    height,
    terrain,
    features: [],
    landmarks,
    title: options.name,
    textile: { cells: cloth.grid.cells, stitchesPerCell: S, offset: [ox, oy], title: cloth.title },
    stitch: 'cross',
  };
  return { model, spawns, blocked };
}
