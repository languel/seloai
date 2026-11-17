/**
 * A lexicon of counted motifs with meanings: the stock a textile layout writes a world in.
 * In woven and embroidered work a river is not pictured, it is written as the water band; a
 * household is a gabled house sign; protection is an eye or a comb at an opening. The forms
 * here are the common stock named in studies of kilims and in nineteenth century pattern
 * albums (water, tree, eye, comb, the table or sofra, birds, rows of dancers, ears of
 * wheat), grown from parameters and drawn afresh, never copied from a plate.
 *
 * First pass, for the art lab. The meanings belong in a world pack once worlds use them.
 * No hooked cross, by rule: hooks here are mirrored, never turned about a centre.
 */
import type { Ink } from './shapes';
import type { MotifGrid } from './patternGrammar';
import { blankGrid, fromRows, nest, stack } from './compose';

function set(g: MotifGrid, x: number, y: number, ink: Ink) {
  if (y >= 0 && y < g.h && x >= 0 && x < g.w) g.cells[y][x] = ink;
}

/** A stepped lozenge outline of radius r; `teeth` adds the sawtooth edge of woven work. */
export function lozenge(r: number, ink: Ink = 'primary', options: { teeth?: boolean; thickness?: number; centre?: Ink } = {}): MotifGrid {
  const { teeth = false, thickness = 1, centre } = options;
  const R = r + (teeth ? 2 : 0);
  const g = blankGrid(R * 2 + 1, R * 2 + 1);
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const d = Math.abs(x) + Math.abs(y);
      if (d <= r && d > r - thickness) set(g, x + R, y + R, ink);
      else if (teeth && d === r + 2 && Math.abs(x) % 2 === 0 && Math.abs(y) % 2 === 0) set(g, x + R, y + R, ink);
    }
  }
  if (centre) set(g, R, R, centre);
  return g;
}

/** The eye: a small lozenge with a pupil. Wards an opening. */
export function eye(ink: Ink = 'primary', pupil: Ink = 'dark'): MotifGrid {
  return lozenge(2, ink, { centre: pupil });
}

/** The comb: a bar with teeth. Protection, and the weaver's own tool. */
export function comb(teeth = 4, ink: Ink = 'dark'): MotifGrid {
  const w = teeth * 2 - 1;
  const g = blankGrid(w, 3);
  for (let x = 0; x < w; x++) {
    set(g, x, 0, ink);
    if (x % 2 === 0) {
      set(g, x, 1, ink);
      set(g, x, 2, ink);
    }
  }
  return g;
}

/** The eight-pointed star: a square and a diamond laid over each other, open at the heart. */
export function star(a: number, ink: Ink = 'primary', heart: Ink = 'dark'): MotifGrid {
  const b = Math.round(a * 1.45);
  const g = blankGrid(b * 2 + 1, b * 2 + 1);
  for (let y = -b; y <= b; y++) {
    for (let x = -b; x <= b; x++) {
      const ax = Math.abs(x);
      const ay = Math.abs(y);
      const inside = (ax <= a && ay <= a) || ax + ay <= b;
      const hollow = ax + ay < a - 1;
      if (inside && !hollow && (ax !== ay || ax + ay <= b - 1 || a < 3)) set(g, x + b, y + b, ink);
    }
  }
  set(g, b, b, heart);
  return g;
}

/** Running water: stepped waves between two banks, `lines` deep. */
export function water(length: number, lines = 2, ink: Ink = 'secondary'): MotifGrid {
  const amp = 2;
  const h = amp + 1 + (lines - 1) * 3;
  const g = blankGrid(length, h);
  const period = amp * 2;
  for (let x = 0; x < length; x++) {
    const p = x % period;
    const y = p <= amp ? p : period - p;
    for (let l = 0; l < lines; l++) set(g, x, y + l * 3, ink);
  }
  return g;
}

/**
 * The tree of life as a stack along an axis: a crown, tiers of paired boughs that rise from
 * the trunk and end in a bud, and a rooted foot.
 */
export function tree(tiers = 3, span = 3, options: { trunk?: Ink; bough?: Ink; bud?: Ink } = {}): MotifGrid {
  const { trunk = 'dark', bough = 'primary', bud = 'secondary' } = options;
  const w = span * 2 + 3;
  const c = span + 1;
  const tier = () => {
    const g = blankGrid(w, span + 1);
    for (let k = 0; k <= span; k++) {
      set(g, c, k, trunk);
      if (k > 0) {
        set(g, c - k, span - k + 1 - 1, bough);
        set(g, c + k, span - k + 1 - 1, bough);
      }
    }
    set(g, c - span - 1, 0, bud);
    set(g, c + span + 1, 0, bud);
    return g;
  };
  const crown = blankGrid(w, 3);
  set(crown, c, 0, bud);
  for (const dx of [-1, 0, 1]) set(crown, c + dx, 1, bough);
  set(crown, c, 2, trunk);
  const foot = blankGrid(w, 2);
  set(foot, c, 0, trunk);
  for (const dx of [-2, -1, 0, 1, 2]) set(foot, c + dx, 1, trunk);
  return stack([crown, ...Array.from({ length: tiers }, tier), foot]);
}

/** An ear of wheat: a stalk with grains set left and right. The harvest. */
export function wheat(grains = 4, options: { stalk?: Ink; grain?: Ink } = {}): MotifGrid {
  const { stalk = 'dark', grain = 'primary' } = options;
  const h = grains * 2 + 5;
  const g = blankGrid(5, h);
  set(g, 2, 0, grain);
  for (let y = 1; y < h; y++) set(g, 2, y, y < grains * 2 + 1 ? grain : stalk);
  for (let i = 0; i < grains; i++) {
    const y = 1 + i * 2;
    set(g, 1, y + 1, grain);
    set(g, 0, y, grain);
    set(g, 3, y + 1, grain);
    set(g, 4, y, grain);
  }
  return g;
}

/**
 * A house: a stepped gable over outlined walls, a door, and a sign in the gable that names
 * the household. Outline, not fill, so a row of houses leaves the cloth open.
 */
export function house(width = 13, wall = 6, options: { roof?: Ink; walls?: Ink; sign?: Ink; window?: boolean } = {}): MotifGrid {
  const { roof = 'primary', walls = 'dark', sign = 'secondary', window = true } = options;
  const w = width % 2 ? width : width + 1;
  const c = (w - 1) / 2;
  const roofH = c + 1;
  const g = blankGrid(w, roofH + wall);
  for (let y = 0; y < roofH; y++) {
    set(g, c - y, y, roof);
    set(g, c + y, y, roof);
    if (y > 0) {
      set(g, c - y + 1, y, roof);
      set(g, c + y - 1, y, roof);
    }
  }
  for (let x = 0; x < w; x++) set(g, x, roofH - 1, roof);
  // The household's sign, alone in the gable.
  if (roofH >= 7) for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) set(g, c + dx, roofH - 4 + dy, sign);
  else if (roofH >= 5) set(g, c, roofH - 3, sign);
  for (let y = roofH; y < roofH + wall; y++) {
    set(g, 1, y, walls);
    set(g, w - 2, y, walls);
  }
  for (let x = 1; x < w - 1; x++) set(g, x, roofH + wall - 1, walls);
  // The door: an opening about as tall as a person.
  const door = Math.max(4, Math.round(wall * 0.6));
  for (let y = roofH + wall - door; y < roofH + wall; y++) for (const dx of [-1, 0, 1]) if (dx !== 0 || y === roofH + wall - door) set(g, c + dx, y, walls);
  if (window && w >= 13) {
    set(g, 3, roofH + 2, sign);
    set(g, w - 4, roofH + 2, sign);
  }
  return g;
}

/** A plank bridge: two rails and rungs, as long as the water is deep. */
export function bridge(span: number, width = 7, ink: Ink = 'dark'): MotifGrid {
  const g = blankGrid(width, span + 2);
  for (let y = 0; y < span + 2; y++) {
    set(g, 0, y, ink);
    set(g, width - 1, y, ink);
    if (y % 2 === 0) for (let x = 1; x < width - 1; x++) set(g, x, y, ink);
  }
  return g;
}

/** A woman of the dance, arms out to her neighbours. */
export function woman(dress: Ink = 'primary'): MotifGrid {
  return fromRows(['..xxx..', '..xxx..', '...#...', '#######', '..###..', '..###..', '.#####.', '.#####.', '#######', '..x.x..'], { '#': dress, x: 'dark' });
}

/** A man of the dance. */
export function man(coat: Ink = 'primary'): MotifGrid {
  return fromRows(['..xxx..', '..xxx..', '...#...', '#######', '..###..', '..###..', '..###..', '..#.#..', '..#.#..', '.xx.xx.'], { '#': coat, x: 'dark' });
}

/**
 * A person as a small sign, for a figure seen from afar: seven stitches tall. `step` moves
 * the feet, so a walking sign treads; `crowned` adds a stitch of gold above the head.
 */
export function personSign(build: 'skirted' | 'trousered', garment: Ink = 'primary', step = false, crowned = false): MotifGrid {
  const body = build === 'skirted' ? ['.xxx.', '.xxx.', '#####', '.###.', '.###.', '#####'] : ['.xxx.', '.xxx.', '#####', '.###.', '.###.', '.#.#.'];
  const feet = step ? 'x...x' : '.x.x.';
  return fromRows([crowned ? '..g..' : '.....', ...body, feet], { '#': garment, x: 'dark', g: 'gold' });
}

/** A bird, facing right; mirror it for a pair that face each other. */
export function bird(body: Ink = 'primary', wing: Ink = 'dark'): MotifGrid {
  return fromRows(['......##.', '#....###x', '##..####.', '.##xxx##.', '..#####..', '...x.x...', '..xx.xx..'], { '#': body, x: wing });
}

/** Two birds facing each other across a small star: a pair, a meeting. */
export function birdPair(body: Ink = 'primary', wing: Ink = 'dark'): MotifGrid {
  const b = bird(body, wing);
  const g = blankGrid(b.w * 2 + 9, b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    g.cells[y][x] = b.cells[y][x];
    g.cells[y][g.w - 1 - x] = b.cells[y][x];
  }
  const s = eye(body, wing);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.cells[y][x]) g.cells[y + 1][b.w + 2 + x] = s.cells[y][x];
  return g;
}

/**
 * The sofra, the low round table a household gathers at: a toothed lozenge holding a star.
 * The village square, the place everyone comes to.
 */
export function sofra(r = 13, options: { rim?: Ink; ring?: Ink; heart?: Ink } = {}): MotifGrid {
  const { rim = 'primary', ring = 'dark', heart = 'primary' } = options;
  const inner = nest(lozenge(r - 4, ring), star(Math.max(2, Math.floor(r / 4)), heart, ring));
  return nest(lozenge(r, rim, { teeth: true, thickness: 2 }), inner);
}

/** A hem of standing triangles: the weight at the foot of a cloth. */
export function hem(length: number, size = 4, inks: readonly Ink[] = ['primary', 'dark']): MotifGrid {
  const g = blankGrid(length, size + 1);
  const period = size * 2;
  const count = Math.floor(length / period);
  const x0 = Math.floor((length - count * period) / 2);
  for (let i = 0; i < count; i++) {
    for (let y = 0; y < size; y++) for (let x = size - 1 - y; x <= size - 1 + y; x++) set(g, x0 + i * period + x, y, inks[i % inks.length]);
  }
  for (let x = x0; x < x0 + count * period - 1; x++) set(g, x, size, inks[inks.length - 1]);
  return g;
}

/** The lexicon as a table: what each sign is called and what it says. */
export const LEXICON: ReadonlyArray<{ id: string; name: string; says: string; grow: () => MotifGrid }> = [
  { id: 'water', name: 'Water', says: 'a river, a spring; it runs as a band', grow: () => water(25) },
  { id: 'tree', name: 'Tree of life', says: 'an orchard, a grove; a stack on an axis', grow: () => tree(3, 3) },
  { id: 'house', name: 'House', says: 'a household; the sign in the gable is the family', grow: () => house(13, 6) },
  { id: 'sofra', name: 'Sofra (the table)', says: 'the square, where everyone gathers', grow: () => sofra(11) },
  { id: 'eye', name: 'Eye', says: 'wards an opening: a gate, a door, a bridge', grow: () => eye() },
  { id: 'comb', name: 'Comb', says: 'protection; the weaver herself', grow: () => comb() },
  { id: 'star', name: 'Star', says: 'the eight directions; a holy or festive place', grow: () => star(3) },
  { id: 'wheat', name: 'Wheat', says: 'a field, the harvest', grow: () => wheat() },
  { id: 'bird', name: 'Birds', says: 'a pair, news, a meeting', grow: () => birdPair() },
  { id: 'woman', name: 'Woman', says: 'a villager; in a row, the dance', grow: () => woman() },
  { id: 'man', name: 'Man', says: 'a villager', grow: () => man() },
  { id: 'bridge', name: 'Bridge', says: 'a crossing', grow: () => bridge(5) },
];
