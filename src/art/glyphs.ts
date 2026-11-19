/**
 * Interface glyphs: small drawings for buttons, made of the same shapes as the world so
 * they are stitched or inked by whichever look is active. Each glyph lives in a 16 x 16
 * unit box centred on the origin; "up" is negative y. No colours here, only ink roles.
 */
import { circle, curl, quadCurve, type Ink, type Pt, type Shape } from './shapes';

export type GlyphName =
  | 'play'
  | 'pause'
  | 'zoomIn'
  | 'zoomOut'
  | 'paths'
  | 'labels'
  | 'speech'
  | 'thoughts'
  | 'subtitles'
  | 'follow'
  | 'perf'
  | 'scatter'
  | 'eavesdrop'
  | 'wholeMap'
  | 'flush'
  | 'undo'
  | 'redo'
  | 'data'
  | 'exportFile'
  | 'importFile'
  | 'reset'
  | 'panel'
  | 'style'
  | 'village'
  | 'observatory'
  | 'level'
  | 'tapestry'
  | 'characters'
  | 'monitor'
  | 'guides'
  | 'close'
  | 'world'
  | 'select'
  | 'paint'
  | 'place'
  | 'erase'
  | 'landmark'
  | 'spawn'
  | 'dice'
  | 'walkable'
  | 'story'
  | 'music'
  | 'rotate'
  | 'layers'
  | 'eye'
  | 'lock'
  | 'patternBrush';

const W = 1.1; // the usual stroke weight
const line = (points: Pt[], ink: Ink = 'dark', weight = W, closed = false): Shape => ({ kind: 'line', points, ink, weight, closed });
const ring = (c: Pt, r: number, ink: Ink = 'dark', weight = W): Shape => line(circle(c, r, 20), ink, weight, true);
const knot = (at: Pt, r = 1, ink: Ink = 'primary'): Shape => ({ kind: 'knot', at, r, ink });
const area = (points: Pt[], ink: Ink = 'primary', grain = Math.PI / 4): Shape => ({ kind: 'area', points, ink, grain });
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** An arrowhead at `tip`, pointing along `angle` (radians, 0 = right). */
function arrowHead(tip: Pt, angle: number, size = 2.6, ink: Ink = 'dark'): Shape {
  const back = (a: number): Pt => [tip[0] - Math.cos(angle + a) * size, tip[1] - Math.sin(angle + a) * size];
  return line([back(0.6), tip, back(-0.6)], ink, W);
}

/** An arc of a circle from angle a0 to a1 (radians, 0 = right, clockwise on screen). */
function arc(c: Pt, r: number, a0: number, a1: number, steps = 16): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i): Pt => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
  });
}

function magnifier(plus: boolean): Shape[] {
  const shapes = [ring([-1.5, -1.5], 4.6), line([[1.8, 1.8], [6, 6]], 'dark', 1.6), line([[-4, -1.5], [1, -1.5]], 'primary')];
  if (plus) shapes.push(line([[-1.5, -4], [-1.5, 1]], 'primary'));
  return shapes;
}

function curvedArrow(direction: 1 | -1): Shape[] {
  const d = direction;
  const path = quadCurve([5 * d, 4], [5 * d, -4], [-1 * d, -4]).concat(quadCurve([-1 * d, -4], [-4 * d, -4], [-5 * d, -1], 6).slice(1));
  return [line(path), arrowHead([-5 * d, -1], d > 0 ? Math.PI * 0.6 : Math.PI * 0.4, 2.8)];
}

function tray(): Shape {
  return line([[-6, 2], [-6, 6], [6, 6], [6, 2]]);
}

const GLYPHS: Record<GlyphName, () => Shape[]> = {
  play: () => [area([[-4, -6], [6, 0], [-4, 6]], 'accent', 0)],
  pause: () => [area(rect(-5, -6, -1.6, 6), 'primary', Math.PI / 2), area(rect(1.6, -6, 5, 6), 'primary', Math.PI / 2)],
  zoomIn: () => magnifier(true),
  zoomOut: () => magnifier(false),
  // A winding running-stitch path, a knot at each end.
  paths: () => {
    const path = quadCurve([-6, 5], [-6, -2], [0, 0]).concat(quadCurve([0, 0], [6, 2], [6, -5]).slice(1));
    const dashes: Shape[] = [];
    for (let i = 0; i + 2 < path.length; i += 4) dashes.push(line(path.slice(i, i + 3), 'secondary', W));
    return [...dashes, knot([-6, 5], 1.2, 'primary'), knot([6, -5], 1.2, 'primary')];
  },
  // A hanging tag with its eyelet.
  labels: () => [line([[-6, -3], [1, -3], [6, 0], [1, 3], [-6, 3]], 'dark', W, true), knot([2, 0], 0.9, 'primary')],
  speech: () => [
    line([[-6, -5], [6, -5], [6, 2], [-1, 2], [-4, 6], [-3, 2], [-6, 2]], 'dark', W, true),
    knot([-3, -1.5], 0.8, 'primary'),
    knot([0, -1.5], 0.8, 'primary'),
    knot([3, -1.5], 0.8, 'primary'),
  ],
  // A cloud of looped scallops trailing two beads.
  thoughts: () => {
    const scallops: Pt[] = [];
    const bumps = 7;
    for (let i = 0; i < bumps; i++) {
      const a0 = (i / bumps) * Math.PI * 2;
      const a1 = ((i + 1) / bumps) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      const p0: Pt = [Math.cos(a0) * 5.4, -1.6 + Math.sin(a0) * 3.6];
      const p1: Pt = [Math.cos(a1) * 5.4, -1.6 + Math.sin(a1) * 3.6];
      const control: Pt = [Math.cos(mid) * 7.6, -1.6 + Math.sin(mid) * 5.4];
      scallops.push(...quadCurve(p0, control, p1, 6).slice(i === 0 ? 0 : 1));
    }
    return [line(scallops, 'secondary', W, true), knot([-4, 4.6], 1, 'secondary'), knot([-6, 6.6], 0.7, 'secondary')];
  },
  subtitles: () => [
    line(rect(-7, -5, 7, 5), 'dark', W, true),
    line([[-4.5, 0.5], [4.5, 0.5]], 'primary'),
    line([[-3, 3], [3, 3]], 'primary'),
  ],
  // An almond eye: the camera keeps watch.
  follow: () => [
    line(quadCurve([-7, 0], [0, -7.5], [7, 0]).concat(quadCurve([7, 0], [0, 7.5], [-7, 0]).slice(1)), 'dark', W, true),
    ring([0, 0], 2.4, 'secondary'),
    knot([0, 0], 1.1, 'primary'),
  ],
  perf: () => [
    line(arc([0, 3], 6.5, Math.PI, Math.PI * 2), 'dark'),
    line([[0, 3], [3.8, -1.8]], 'primary', 1.4),
    knot([0, 3], 1.1, 'dark'),
    line([[-6.5, 3], [6.5, 3]], 'dark', 0.8),
  ],
  // Seeds flung from a hand: a centre knot, five flying outward.
  scatter: () => {
    const out: Shape[] = [knot([0, 0], 1.3, 'primary')];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      out.push(line([[Math.cos(a) * 2.6, Math.sin(a) * 2.6], [Math.cos(a) * 4.4, Math.sin(a) * 4.4]], 'dark', 0.8));
      out.push(knot([Math.cos(a) * 6, Math.sin(a) * 6], 0.95, i % 2 ? 'accent' : 'gold'));
    }
    return out;
  },
  // A listener's ear: rings of sound reaching a knot.
  eavesdrop: () => [
    knot([-5, 0], 1.3, 'primary'),
    line(arc([-5, 0], 4, -0.8, 0.8, 8), 'dark'),
    line(arc([-5, 0], 7.5, -0.7, 0.7, 10), 'dark'),
    line(arc([-5, 0], 11, -0.55, 0.55, 12), 'secondary'),
  ],
  wholeMap: () => [
    line(rect(-6.5, -6.5, 6.5, 6.5), 'dark', W, true),
    line([[-6.5, 0], [6.5, 0]], 'secondary', 0.7),
    line([[0, -6.5], [0, 6.5]], 'secondary', 0.7),
    knot([-3, -3], 0.8, 'primary'),
    knot([3.5, 2.5], 0.8, 'accent'),
  ],
  // Thread unwinding from a loose spiral.
  flush: () => [line(curl([6, 2], 5, 1.5, -1, 0), 'primary'), line([[6, 2], [6, 6], [-6, 6]], 'dark', 0.9)],
  undo: () => curvedArrow(1),
  redo: () => curvedArrow(-1),
  // A chest of folded cloth: three stacked bolts.
  data: () => [
    line(rect(-6, -6, 6, -2.2), 'dark', W, true),
    line(rect(-6, -1.9, 6, 1.9), 'dark', W, true),
    line(rect(-6, 2.2, 6, 6), 'dark', W, true),
    knot([3.6, -4.1], 0.7, 'primary'),
    knot([3.6, 0], 0.7, 'accent'),
    knot([3.6, 4.1], 0.7, 'secondary'),
  ],
  exportFile: () => [tray(), line([[0, -6], [0, 3]], 'primary'), arrowHead([0, 3], Math.PI / 2, 3, 'primary')],
  importFile: () => [tray(), line([[0, 3], [0, -6]], 'primary'), arrowHead([0, -6], -Math.PI / 2, 3, 'primary')],
  reset: () => [line(arc([0, 0], 5.6, -Math.PI * 0.35, Math.PI * 1.45, 24)), arrowHead(arc([0, 0], 5.6, Math.PI * 1.45, Math.PI * 1.45, 1)[0], Math.PI * 1.95, 2.8)],
  panel: () => [line(rect(-7, -6, 7, 6), 'dark', W, true), area(rect(2, -6, 7, 6), 'secondary', Math.PI / 2)],
  // A needle trailing its thread.
  style: () => [
    line([[-6, 6], [5, -5]], 'dark', 1.3),
    line(circle([4.2, -4.2], 0.9, 8), 'dark', 0.7, true),
    line(quadCurve([4.5, -4.5], [7, 2], [1, 3]).concat(quadCurve([1, 3], [-4, 4], [-3, -1], 8).slice(1)), 'primary'),
  ],
  village: () => [
    area([[-6, 0], [0, -6], [6, 0]], 'primary', 0),
    line(rect(-4.5, 0, 4.5, 6), 'dark', W, true),
    area(rect(-1.2, 2.5, 1.2, 6), 'dark', Math.PI / 2),
  ],
  // Stars joined by threads: the web of who knows whom.
  observatory: () => {
    const pts: Pt[] = [[-5, -4], [4, -5], [6, 3], [-2, 5], [0, -0.5]];
    return [
      line([pts[0], pts[4], pts[1]], 'secondary', 0.7),
      line([pts[2], pts[4], pts[3]], 'secondary', 0.7),
      line([pts[0], pts[3]], 'secondary', 0.7),
      ...pts.map((p, i) => knot(p, i === 4 ? 1.4 : 1, i === 4 ? 'primary' : 'dark')),
    ];
  },
  level: () => [
    line([[-7, -5], [-2.3, -6.5], [2.3, -5], [7, -6.5], [7, 5], [2.3, 6.5], [-2.3, 5], [-7, 6.5]], 'dark', W, true),
    line([[-2.3, -6.5], [-2.3, 5]], 'dark', 0.7),
    line([[2.3, -5], [2.3, 6.5]], 'dark', 0.7),
    knot([4.6, -0.5], 0.9, 'primary'),
  ],
  tapestry: () => {
    const cells: Array<[number, number, Ink]> = [];
    const pattern = ['..#..', '.#*#.', '#*#*#', '.#*#.', '..#..'];
    pattern.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === '#') cells.push([x, y, 'primary']);
        if (c === '*') cells.push([x, y, 'dark']);
      }),
    );
    return [{ kind: 'counted', origin: [-6, -6], cell: 3, cells }];
  },
  characters: () => [
    ring([-3, -2.5], 2.4, 'dark'),
    line(quadCurve([-7.5, 6], [-3, -1], [1.5, 6]), 'primary'),
    ring([4, -3.5], 2, 'dark'),
    line(quadCurve([1.5, 2.5], [4, -2], [7.5, 5]), 'secondary'),
  ],
  monitor: () => [
    line([[-7, 0], [-4.5, 0], [-3, -5], [-1, 5], [1, -3], [2.5, 2], [4, 0], [7, 0]], 'primary', W),
  ],
  guides: () => [
    line([[0, -4], [-7, -5.5], [-7, 5], [0, 6.5], [7, 5], [7, -5.5], [0, -4]], 'dark', W, true),
    line([[0, -4], [0, 6.5]], 'dark', 0.8),
    line([[-5, -2], [-2, -1.4]], 'primary', 0.6),
    line([[-5, 1], [-2, 1.6]], 'primary', 0.6),
    line([[2, -1.4], [5, -2]], 'primary', 0.6),
  ],
  close: () => [line([[-5, -5], [5, 5]], 'dark', 1.3), line([[5, -5], [-5, 5]], 'dark', 1.3)],
  // A little world: a hill, a river winding past a house.
  world: () => [
    line(quadCurve([-7, 1], [-2, -7], [3, 1]), 'secondary'),
    line(quadCurve([-6, 6.5], [0, 2], [7, 4.5]), 'accent', 1.2),
    area([[2, -1.5], [4.5, -4.5], [7, -1.5]], 'primary', 0),
    line(rect(2.6, -1.5, 6.4, 1.5), 'dark', 0.8, true),
  ],
  // A pointer.
  select: () => [line([[-4, -6.5], [-4, 4.5], [-1, 1.8], [1.4, 6.5], [3.2, 5.6], [0.8, 1], [4.6, 0.6], [-4, -6.5]], 'dark', W, true)],
  // A stroke of running stitch laid by a needle.
  paint: () => [
    { kind: 'line', points: quadCurve([-7, 5], [-1, -2], [3, 4], 10), ink: 'primary', weight: 1.4, closed: false },
    line([[2, 2], [6.5, -6]], 'dark', 1.2),
    line(circle([6, -5.2], 0.7, 8), 'dark', 0.6, true),
  ],
  // A house with a plus.
  place: () => [
    area([[-6.5, -1], [-2, -5.5], [2.5, -1]], 'primary', 0),
    line(rect(-5.2, -1, 1.2, 5), 'dark', W, true),
    line([[5, -6], [5, 0]], 'accent', 1.2),
    line([[2, -3], [8, -3]], 'accent', 1.2),
  ],
  // Scissors.
  erase: () => [
    ring([-4, 4], 2.2, 'dark'),
    ring([4, 4], 2.2, 'dark'),
    line([[-2.6, 2.4], [4.5, -6.5]], 'dark', 1.1),
    line([[2.6, 2.4], [-4.5, -6.5]], 'dark', 1.1),
    knot([0, -0.6], 0.8, 'primary'),
  ],
  // A pin flag on a pole.
  landmark: () => [line([[-3, 7], [-3, -6.5]], 'dark', 1.2), area([[-3, -6.5], [6, -4], [-3, -1.5]], 'primary', 0)],
  // Two footprints.
  spawn: () => [
    line(circle([-2.8, 2.5], 1.8, 12).map(([x, y]): Pt => [x, y * 1.5]), 'dark', 0.9, true),
    line(circle([2.8, -2.5], 1.8, 12).map(([x, y]): Pt => [x, y * 1.5]), 'dark', 0.9, true),
    knot([-2.8, -1.4], 0.6, 'primary'),
    knot([2.8, -6.4], 0.6, 'primary'),
  ],
  // A die showing five.
  dice: () => [line(rect(-6, -6, 6, 6), 'dark', W, true), ...([[-3, -3], [3, -3], [0, 0], [-3, 3], [3, 3]] as Pt[]).map((p) => knot(p, 0.9, 'primary'))],
  // A viewfinder: four corner brackets around a knot, the camera that follows the story.
  story: () => [
    line([[-7, -3], [-7, -6], [-4, -6]], 'dark', 1.1),
    line([[4, -6], [7, -6], [7, -3]], 'dark', 1.1),
    line([[7, 3], [7, 6], [4, 6]], 'dark', 1.1),
    line([[-4, 6], [-7, 6], [-7, 3]], 'dark', 1.1),
    knot([-1.5, 0], 1.3, 'primary'),
    knot([2, 0.5], 1, 'accent'),
    line(quadCurve([-1.5, 0], [0.2, -2], [2, 0.5], 5), 'secondary', 0.6),
  ],
  // A kaval: a long flute held aslant, its finger holes stitched as knots, a curl of song.
  music: () => [
    line([[-6.5, 6.5], [4.5, -4.5]], 'dark', 1.7),
    line([[4.5, -4.5], [5.6, -5.6]], 'secondary', 1.2),
    knot([-3.4, 3.4], 0.75, 'primary'),
    knot([-1.4, 1.4], 0.75, 'primary'),
    knot([0.6, -0.6], 0.75, 'primary'),
    line(arc([4, 1.5], 2.2, -Math.PI * 0.35, Math.PI * 0.35, 8), 'accent', 0.8),
    line(arc([4, 1.5], 3.9, -Math.PI * 0.3, Math.PI * 0.3, 10), 'gold', 0.8),
  ],
  // A square turning about its centre, with an arrow round it.
  rotate: () => [
    line([[-2.6, -3.6], [3.6, -2.6], [2.6, 3.6], [-3.6, 2.6]], 'primary', 0.9, true),
    line(arc([0, 0], 6.4, Math.PI * 1.15, Math.PI * 1.85, 14)),
    arrowHead(arc([0, 0], 6.4, Math.PI * 1.85, Math.PI * 1.85, 1)[0], Math.PI * 0.35, 2.4),
  ],
  // Three cloths stacked, the top one stitched.
  layers: () => [
    line([[-6.5, 3], [0, 6], [6.5, 3]], 'dark', 0.9),
    line([[-6.5, 0], [0, 3], [6.5, 0]], 'dark', 0.9),
    area([[-6.5, -3], [0, -6], [6.5, -3], [0, 0]], 'primary', 0),
    line([[-6.5, -3], [0, -6], [6.5, -3], [0, 0]], 'dark', 0.9, true),
  ],
  eye: () => [
    line([...arc([0, 4], 8.5, Math.PI * 1.22, Math.PI * 1.78, 12), ...arc([0, -4], 8.5, Math.PI * 0.22, Math.PI * 0.78, 12)], 'dark', 1, true),
    knot([0, 0], 1.9, 'primary'),
  ],
  // A needle drawing a line of small crosses behind it.
  patternBrush: () => [
    line([[2, -7], [6.5, -2.5]], 'dark', 1.2),
    knot([2.6, -6.4], 0.6, 'gold'),
    ...([[-6, 5], [-3, 2], [0, -1]] as Pt[]).flatMap(([x, y]) => [line([[x - 1.3, y - 1.3], [x + 1.3, y + 1.3]], 'primary', 0.9), line([[x + 1.3, y - 1.3], [x - 1.3, y + 1.3]], 'primary', 0.9)]),
    line(quadCurve([0.5, -1.5], [3, -2], [4.2, -4.2], 5), 'secondary', 0.6),
  ],
  lock: () => [line(rect(-4.5, -0.5, 4.5, 6), 'dark', 1.1, true), line(arc([0, -0.5], 3.2, Math.PI, Math.PI * 2, 10), 'dark', 1.1), knot([0, 2.8], 0.9, 'primary')],
  // A grid with crossed-out cells: where one can and cannot walk.
  walkable: () => [
    line(rect(-6.5, -6.5, 6.5, 6.5), 'dark', 0.8, true),
    line([[-6.5, 0], [6.5, 0]], 'dark', 0.6),
    line([[0, -6.5], [0, 6.5]], 'dark', 0.6),
    line([[1.5, 1.5], [5, 5]], 'primary', 1),
    line([[5, 1.5], [1.5, 5]], 'primary', 1),
    line([[-5, -5], [-1.5, -1.5]], 'primary', 1),
    line([[-1.5, -5], [-5, -1.5]], 'primary', 1),
  ],
};

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

/** The glyph's shapes in its 16-unit box. */
export function glyphShapes(name: GlyphName): Shape[] {
  return GLYPHS[name]();
}
