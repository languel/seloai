/**
 * Art lab: a development page that renders the generative motifs in each look, side by
 * side, so looks and algorithms can be judged by eye. Open /art-lab.html?seed=7.
 */
import { createSeededRng } from '../core/rng';
import { PALETTES, paintLinen, renderEmbroidery, renderLineArt, type PaletteName } from './looks';
import { cloth, figure, treeOfLife } from './motifs';
import { place, type Shape } from './shapes';

type LookName = 'line' | 'thread';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 7);
const root = document.getElementById('lab')!;

function panel(
  title: string,
  width: number,
  height: number,
  look: LookName,
  paletteName: PaletteName,
  unit: number,
  origin: [number, number],
  shapes: Shape[],
) {
  const wrap = document.createElement('figure');
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const options = { unit, origin, palette: PALETTES[paletteName], seed };
  if (look === 'thread') {
    paintLinen(ctx, width, height, options);
    renderEmbroidery(ctx, shapes, options);
  } else {
    ctx.fillStyle = options.palette.ground;
    ctx.fillRect(0, 0, width, height);
    renderLineArt(ctx, shapes, options);
  }
  const caption = document.createElement('figcaption');
  caption.textContent = title;
  wrap.append(canvas, caption);
  return wrap;
}

function row(title: string, panels: HTMLElement[]) {
  const section = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const strip = document.createElement('div');
  strip.className = 'strip';
  strip.append(...panels);
  section.append(heading, strip);
  root.append(section);
}

const LOOKS: Array<[string, LookName, PaletteName]> = [
  ['Line art', 'line', 'ink'],
  ['Line art, night plate', 'line', 'night'],
  ['Blackwork thread', 'thread', 'blackwork'],
  ['Red and black thread', 'thread', 'redBlack'],
  ['Festive thread', 'thread', 'festive'],
];

const only = params.get('only');

// One cloth, drawn once, shown in every look.
if (!only || only === 'cloth') {
  const clothShapes = cloth(createSeededRng(seed));
  row(
    `Cloth, seed ${seed}: one drawing, five looks`,
    LOOKS.map(([title, look, palette]) => panel(title, 460, 590, look, palette, 4.3, [240, 288], clothShapes)),
  );
}

// A cast: every seed is a different person.
if (!only || only === 'figures') {
  const castRng = createSeededRng(seed * 31 + 5);
  const cast: Shape[] = [];
  for (let i = 0; i < 7; i++) cast.push(...place(figure(castRng, { height: 30 }), { dx: i * 26 }));
  row(
    'Figures: a generated cast',
    (['ink', 'redBlack', 'festive'] as const).map((palette) =>
      panel(palette === 'ink' ? 'Line art' : `Thread, ${palette}`, 760, 190, palette === 'ink' ? 'line' : 'thread', palette, 4, [62, 162], cast),
    ),
  );
}

// A grove: trees of life from consecutive seeds.
if (!only || only === 'trees') {
  const groveRng = createSeededRng(seed * 17 + 3);
  const grove: Shape[] = [];
  for (let i = 0; i < 6; i++) grove.push(...place(treeOfLife(groveRng, 34), { dx: i * 30 }));
  row(
    'Trees of life',
    (['ink', 'festive'] as const).map((palette) =>
      panel(palette === 'ink' ? 'Line art' : 'Thread, festive', 760, 190, palette === 'ink' ? 'line' : 'thread', palette, 4, [62, 172], grove),
    ),
  );
}
