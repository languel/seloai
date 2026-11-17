/**
 * Textile layouts: a small world laid out the way a cloth is laid out, written in the
 * lexicon's signs with the composition operators. Two readings of the same village:
 *
 * - the carpet: a frame with designed corners, the square as a central medallion, streets
 *   as guide lines through it, the households, water and orchard mirrored about the axis;
 * - the sampler: registers from top to bottom between guide lines (sky, the row of houses,
 *   the street, the river, the fields, the hem), with bare linen between.
 *
 * Both keep to one thread grid, three scales (one medallion, bands, small signs), whole
 * repeats, and a stitch budget: most of the cloth is left unworked. A layout also reports
 * the signs it placed, so a world can be built on the cloth (see `src/world/textileVillage.ts`).
 */
import { createSeededRng } from '../core/rng';
import type { Ink } from './shapes';
import type { MotifGrid } from './patternGrammar';
import { beside, blankGrid, clear, coverage, frame, mirrorX, post, recolor, repeat, rule, stamp } from './compose';
import { bird, birdPair, bridge, comb, eye, hem, house, man, sofra, star, tree, water, wheat, woman } from './textileLexicon';

/** What a layout is asked to say. Counts, not positions: the cloth decides where. */
export interface VillageBrief {
  name: string;
  households: number;
  /** Villagers worked into the cloth as signs. 0 for a world, where the people are alive. */
  people: number;
  river: boolean;
  orchard: number;
  fields: number;
  /** Width of a house in stitches (default 13; a world wants them larger). */
  houseWidth?: number;
}

export type SignKind = 'frame' | 'band' | 'house' | 'tree' | 'wheat' | 'water' | 'bridge' | 'square';

/** A sign placed on the cloth: what it is and the stitches it covers. */
export interface Sign {
  kind: SignKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextileCloth {
  grid: MotifGrid;
  /** Where the name is lettered: centre x and top y, in stitches. */
  title: { cx: number; y: number };
  /** Worked share of the cloth, 0 to 1. */
  coverage: number;
  /** What was written where, for a legend. */
  reading: string[];
  signs: Sign[];
}

export type TextileLayout = 'carpet' | 'sampler';

const ALT: Partial<Record<Ink, Ink>> = { primary: 'secondary', secondary: 'primary' };

type Item = [SignKind, MotifGrid];

function households(count: number, rng: () => number, width = 13): MotifGrid[] {
  return Array.from({ length: count }, (_, i) => {
    const big = rng() < 0.4;
    const w = width + (big ? 2 : 0);
    return house(w, Math.round(w * 0.47), { roof: i % 2 ? 'secondary' : 'primary', sign: i % 2 ? 'primary' : 'secondary' });
  });
}

function dancers(count: number): MotifGrid {
  return beside(
    Array.from({ length: count }, (_, i) => (i % 2 ? man(i % 4 === 1 ? 'secondary' : 'primary') : woman(i % 4 === 2 ? 'secondary' : 'primary'))),
    0,
  );
}

const rowWidth = (items: readonly Item[], gap: number) => items.reduce((n, [, g]) => n + g.w, 0) + gap * Math.max(0, items.length - 1);
const rowHeight = (items: readonly Item[]) => Math.max(0, ...items.map(([, g]) => g.h));

/** Works a row of signs on one ground line (their feet at `foot`), starting at x, and records them. */
function layRow(grid: MotifGrid, signs: Sign[], items: readonly Item[], gap: number, x: number, foot: number) {
  for (const [kind, g] of items) {
    stamp(grid, g, x, foot - g.h);
    signs.push({ kind, x, y: foot - g.h, w: g.w, h: g.h });
    x += g.w + gap;
  }
}

/** The same row mirrored about the cloth's upright axis, optionally in exchanged threads. */
function layMirrored(grid: MotifGrid, signs: Sign[], items: readonly Item[], gap: number, x: number, foot: number, exchange = false) {
  const flipped = [...items].reverse().map(([kind, g]): Item => [kind, exchange ? recolor(mirrorX(g), ALT) : mirrorX(g)]);
  layRow(grid, signs, flipped, gap, grid.w - x - rowWidth(items, gap), foot);
}

function centre(dst: MotifGrid, g: MotifGrid, cx: number, y: number) {
  stamp(dst, g, cx - Math.floor(g.w / 2), y);
}

const grove = (count: number): Item[] =>
  Array.from({ length: count }, (_, i): Item => ['tree', tree(3, i % 2 ? 2 : 3, i % 2 ? { bough: 'secondary', bud: 'primary' } : {})]);
const corn = (count: number): Item[] => Array.from({ length: count }, (_, i): Item => ['wheat', wheat(3 + (i % 2))]);

/** The village as a sampler: registers read from the sky down to the hem. */
export function samplerCloth(brief: VillageBrief, seed: number): TextileCloth {
  const rng = createSeededRng(seed * 7919 + 13);
  const margin = 6;
  const homes = households(brief.households, rng, brief.houseWidth);
  const street: Item[] = [];
  homes.forEach((h, i) => {
    if (i) street.push(['tree', tree(2, 2)]);
    street.push(['house', h]);
  });
  const fieldSide = corn(Math.max(1, Math.floor(brief.fields / 2)));
  const far: Item[] = [...fieldSide, ...grove(brief.orchard), ...[...fieldSide].reverse().map(([k, g]): Item => [k, mirrorX(g)])];

  const need = Math.max(rowWidth(street, 4), rowWidth(far, 4), 100) + 24;
  const W = margin * 2 + need + ((margin * 2 + need) % 2 ? 0 : 1);
  const cx = Math.floor(W / 2);
  const inner = W - margin * 2;
  const grid = blankGrid(W, 400);
  const signs: Sign[] = [];
  const reading: string[] = [];
  const line = (y: number) => rule(grid, y, margin, W - margin - 1, 'dark', 2);
  let y = margin;

  const top = repeat([eye('primary', 'dark'), comb(3)], inner, { gap: 4, align: 'centre' });
  stamp(grid, top, margin, y);
  signs.push({ kind: 'band', x: margin, y, w: inner, h: top.h });
  y += top.h;
  line(y++);
  reading.push('Top band: eyes and combs, to ward the cloth');
  y += 3;
  const titleY = y;
  y += 7 + 4;
  centre(grid, birdPair(), cx, y);
  y += 7 + 5;
  reading.push('Sky: the name and a pair of birds');

  y += rowHeight(street);
  layRow(grid, signs, street, 4, cx - Math.floor(rowWidth(street, 4) / 2), y);
  line(y++);
  reading.push(`The row: ${brief.households} households, a tree between each`);

  // The street: bare cloth between two guide lines, the square's star at its heart.
  const heart = star(brief.people ? 2 : 3, 'primary', 'dark');
  const side = brief.people ? dancers(Math.max(1, Math.floor(brief.people / 2))) : undefined;
  y += Math.max(heart.h, side?.h ?? 0) + 4;
  centre(grid, heart, cx, y - heart.h);
  signs.push({ kind: 'square', x: cx - Math.floor(heart.w / 2), y: y - heart.h, w: heart.w, h: heart.h });
  if (side) {
    stamp(grid, side, cx - Math.floor(heart.w / 2) - 3 - side.w, y - side.h);
    stamp(grid, mirrorX(side), cx + Math.floor(heart.w / 2) + 4, y - side.h);
  }
  line(y++);
  reading.push(brief.people ? `The street: ${brief.people} villagers dancing either side of the square's star` : "The street: bare cloth to walk, the square's star at its heart");

  if (brief.river) {
    y += 3;
    const river = water(inner, 2);
    stamp(grid, river, margin, y);
    signs.push({ kind: 'water', x: margin, y, w: inner, h: river.h });
    clear(grid, cx - 5, y - 1, 11, river.h + 2);
    centre(grid, bridge(river.h, 7), cx, y - 1);
    signs.push({ kind: 'bridge', x: cx - 3, y: y - 1, w: 7, h: river.h + 2 });
    y += river.h + 4;
    reading.push('The river, with a plank bridge on the axis');
  }

  y += rowHeight(far) + (brief.river ? 0 : 4);
  layRow(grid, signs, far, 4, cx - Math.floor(rowWidth(far, 4) / 2), y);
  line(y++);
  reading.push(`Fields and orchard: ${brief.orchard} trees between the wheat`);
  y += 4;
  const foot = hem(inner, 4);
  stamp(grid, foot, margin, y);
  signs.push({ kind: 'band', x: margin, y, w: inner, h: foot.h });
  y += foot.h + margin;
  reading.push('The hem: standing triangles, the weight at the foot');

  const cut = { w: W, h: y, cells: grid.cells.slice(0, y) };
  return { grid: cut, title: { cx, y: titleY }, coverage: coverage(cut), reading, signs };
}

/** The village as a carpet: a frame, a medallion for the square, mirrored about the axis. */
export function carpetCloth(brief: VillageBrief, seed: number): TextileCloth {
  const rng = createSeededRng(seed * 104729 + 5);
  const t = 7;
  const f0 = t + 2;
  // Build the parts first, so the cloth is cut to what it has to hold.
  const homes = households(Math.max(1, Math.ceil(brief.households / 2)), rng, brief.houseWidth).map((g): Item => ['house', g]);
  const far: Item[] = [...corn(Math.max(1, Math.floor(brief.fields / 2))), ...grove(Math.max(1, Math.floor(brief.orchard / 2)))];
  const table = sofra(21);
  const span = 6;
  const sideW = Math.max(rowWidth(homes, 4), rowWidth(far, 4), 45) + 8;
  const W = 2 * (f0 + 4 + sideW) + 5;
  const cx = Math.floor(W / 2);
  const sideX = (items: readonly Item[]) => f0 + 4 + Math.floor((sideW - rowWidth(items, 4)) / 2);

  const titleY = f0 + 5;
  const homesFoot = titleY + 12 + rowHeight(homes);
  const tableY = homesFoot + 7;
  const cy = tableY + Math.floor(table.h / 2);
  const riverY = tableY + table.h + 6;
  const farFoot = (brief.river ? riverY + span + 7 : riverY) + rowHeight(far);
  const H = farFoot + 6 + f0;

  const grid = frame(W, H, [eye('primary', 'dark'), comb(3)], { corner: star(2, 'primary', 'dark'), gap: 4 });
  const signs: Sign[] = [
    // The frame and its inner guide line, with a little room so no one stands on the border.
    { kind: 'frame', x: 0, y: 0, w: W, h: f0 + 3 },
    { kind: 'frame', x: 0, y: H - f0 - 3, w: W, h: f0 + 3 },
    { kind: 'frame', x: 0, y: 0, w: f0 + 3, h: H },
    { kind: 'frame', x: W - f0 - 3, y: 0, w: f0 + 3, h: H },
  ];
  // An inner guide line, a stitch inside the frame.
  rule(grid, f0, f0, W - 1 - f0, 'dark', 2);
  rule(grid, H - 1 - f0, f0, W - 1 - f0, 'dark', 2);
  post(grid, f0, f0, H - 1 - f0, 'dark', 2);
  post(grid, W - 1 - f0, f0, H - 1 - f0, 'dark', 2);

  // Households: half each side of the axis, the right side the mirror of the left in exchanged threads.
  layRow(grid, signs, homes, 4, sideX(homes), homesFoot);
  layMirrored(grid, signs, homes, 4, sideX(homes), homesFoot, true);

  // The square: the table everyone comes to, on the crossing of the two streets.
  rule(grid, cy, f0 + 2, W - 3 - f0, 'dark', 3);
  post(grid, cx, homesFoot + 2, H - f0 - 3, 'dark', 3);
  clear(grid, cx - Math.floor(table.w / 2) - 1, tableY - 1, table.w + 2, table.h + 2);
  centre(grid, table, cx, tableY);
  signs.push({ kind: 'square', x: cx - Math.floor(table.w / 2), y: tableY, w: table.w, h: table.h });

  // Villagers worked as signs stand on the street either side of the square, facing it.
  const perSide = Math.floor(brief.people / 2);
  if (perSide > 0) {
    const line = dancers(perSide);
    stamp(grid, line, cx - Math.floor(table.w / 2) - 6 - line.w, cy - line.h - 1);
    stamp(grid, mirrorX(line), cx + Math.floor(table.w / 2) + 7, cy - line.h - 1);
  }

  // Birds above the square, a pair across the axis.
  const b = bird();
  stamp(grid, b, cx - 5 - b.w, tableY - 3);
  stamp(grid, mirrorX(b), cx + 6, tableY - 3);

  if (brief.river) {
    // A whole number of waves, so the band mirrors about the axis.
    const river = water(W - 2 * f0 - 6 - ((W - 2 * f0 - 7) % 4), 2);
    const rx = Math.floor((W - river.w) / 2);
    stamp(grid, river, rx, riverY);
    signs.push({ kind: 'water', x: rx, y: riverY, w: river.w, h: river.h });
    clear(grid, cx - 5, riverY - 1, 11, span + 2);
    centre(grid, bridge(span, 7), cx, riverY - 1);
    signs.push({ kind: 'bridge', x: cx - 3, y: riverY - 1, w: 7, h: span + 2 });
    // An eye each side of the bridge: an opening is where harm could enter.
    for (const ex of [cx - 13, cx + 9]) {
      clear(grid, ex - 1, riverY - 1, 7, span + 2);
      stamp(grid, eye(), ex, riverY);
    }
  }

  // Far bank: wheat and orchard, mirrored about the axis.
  layRow(grid, signs, far, 4, sideX(far), farFoot);
  layMirrored(grid, signs, far, 4, sideX(far), farFoot);

  return {
    grid,
    title: { cx, y: titleY },
    coverage: coverage(grid),
    signs,
    reading: [
      'Frame: eyes and combs, a star turning each corner',
      'Medallion: the sofra, the square, on the crossing of the two streets',
      `Households: ${homes.length * 2}, mirrored about the axis in exchanged threads`,
      perSide > 0 ? `Villagers: ${perSide * 2}, either side of the square` : '',
      brief.river ? 'River: a water band, the bridge on the axis with an eye each side' : '',
      'Far bank: wheat and orchard, mirrored',
    ].filter(Boolean),
  };
}

export function textileCloth(layout: TextileLayout, brief: VillageBrief, seed: number): TextileCloth {
  return layout === 'sampler' ? samplerCloth(brief, seed) : carpetCloth(brief, seed);
}
