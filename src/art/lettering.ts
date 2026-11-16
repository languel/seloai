/**
 * Embroidered lettering. Text becomes counted stitches on a 5 by 7 grid, the alphabet of a
 * needlework sampler, so words are drawn by the active look like everything else.
 *
 * The glyphs are original to this project. Lowercase is set as capitals, as samplers do.
 */
import type { Ink, Shape } from './shapes';

const GLYPH_W = 5;
const GLYPH_H = 7;

/** Each glyph is seven rows of five cells; '#' is a stitch. */
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '....#', '....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..#..', '.#...'],
  ':': ['.....', '..#..', '.....', '.....', '.....', '..#..', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
};

/** Letters that samplers have no stitch for are set as their plain Latin base. */
function baseCharacter(ch: string): string {
  const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return GLYPHS[plain] ? plain : ' ';
}

export interface LetteringOptions {
  /** Size of one stitch, in units. */
  cell: number;
  ink?: Ink;
  /** Empty cells between letters. */
  tracking?: number;
  /** 'left' puts the origin at the start of the baseline, 'centre' at its middle. */
  align?: 'left' | 'centre';
}

/** Width of a line of lettering in units. */
export function letteringWidth(text: string, cell: number, tracking = 1): number {
  const count = [...text].length;
  return count === 0 ? 0 : (count * (GLYPH_W + tracking) - tracking) * cell;
}

export const LETTERING_HEIGHT_CELLS = GLYPH_H;

/** Sets a line of text as counted stitches. The origin is on the top edge of the letters. */
export function lettering(text: string, options: LetteringOptions): Shape[] {
  const { cell, ink = 'dark', tracking = 1, align = 'left' } = options;
  const cells: Array<[number, number, Ink]> = [];
  [...text].forEach((ch, index) => {
    const rows = GLYPHS[baseCharacter(ch)];
    if (!rows) return;
    const x0 = index * (GLYPH_W + tracking);
    rows.forEach((row, y) => {
      for (let x = 0; x < GLYPH_W; x++) if (row[x] === '#') cells.push([x0 + x, y, ink]);
    });
  });
  if (cells.length === 0) return [];
  const shift = align === 'centre' ? -letteringWidth(text, cell, tracking) / 2 : 0;
  return [{ kind: 'counted', origin: [shift + cell / 2, cell / 2], cell, cells }];
}

/**
 * A stitched name ribbon: the words between two guide lines with a knot at each end, the
 * form used for landmark names and titles on the cloth.
 */
export function ribbon(text: string, options: LetteringOptions & { rule?: Ink }): Shape[] {
  const { cell, rule = 'primary' } = options;
  const width = letteringWidth(text, cell, options.tracking ?? 1);
  const half = width / 2 + cell * 1.5;
  const top = -cell * 1.6;
  const bottom = (GLYPH_H + 1.6) * cell;
  return [
    ...lettering(text, { ...options, align: 'centre' }),
    { kind: 'line', points: [[-half, top], [half, top]], ink: rule, weight: 0.5 },
    { kind: 'line', points: [[-half, bottom], [half, bottom]], ink: rule, weight: 0.5 },
    { kind: 'knot', at: [-half - cell * 1.2, (top + bottom) / 2], r: cell * 0.7, ink: 'gold' },
    { kind: 'knot', at: [half + cell * 1.2, (top + bottom) / 2], r: cell * 0.7, ink: 'gold' },
  ];
}
