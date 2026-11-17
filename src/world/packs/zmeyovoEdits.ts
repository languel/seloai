/**
 * The owner's hand edits that make the demo Zmeyovo (2026-11-17): the herb house turned to
 * face its lane, a few trees cleared from the top so the middle stays open, a flower and
 * sunflower garden by the southern lane, and a grove in the corner. They are applied on top
 * of the authored tile map, frozen into a place, so the map itself stays in code.
 */
import type { SceneEdit } from '../worldScene';

const flower = (n: number, x: number, y: number): SceneEdit => ({ op: 'place', feature: { id: `my-flowers-${n}`, kind: 'flowers', x, y, w: 1, h: 1 } });
const sunflower = (n: number, x: number, y: number): SceneEdit => ({ op: 'place', feature: { id: `my-sunflower-${n}`, kind: 'sunflower', x, y, w: 1, h: 1 } });

export const ZMEYOVO_EDITS: SceneEdit[] = [
  { op: 'rotate', id: 'house-7-17', angle: -Math.PI / 2 },
  { op: 'remove', id: 'amb-grove-22-2' },
  { op: 'remove', id: 'pine-24-2' },
  flower(1, 25, 27),
  flower(2, 28, 27),
  flower(3, 31, 27),
  flower(4, 29, 25),
  flower(5, 27, 25),
  flower(6, 30, 27),
  flower(7, 31, 25),
  flower(8, 33, 26),
  sunflower(1, 27, 27),
  sunflower(2, 28, 26),
  sunflower(3, 29, 27),
  sunflower(4, 26, 27),
  sunflower(5, 30, 25),
  sunflower(6, 32, 27),
  sunflower(7, 32, 25),
  sunflower(8, 31, 26),
  { op: 'remove', id: 'amb-sapling-26-4' },
  { op: 'remove', id: 'amb-sapling-25-3' },
  { op: 'remove', id: 'amb-sapling-22-5' },
  { op: 'remove', id: 'amb-sapling-21-4' },
  { op: 'remove', id: 'amb-grove-24-3' },
  { op: 'remove', id: 'pine-30-2' },
  { op: 'remove', id: 'tree-44-30' },
  { op: 'place', feature: { id: 'my-grove-1', kind: 'grove', x: 42, y: 31, w: 1, h: 2 } },
];
