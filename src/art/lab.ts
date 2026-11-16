/**
 * Art lab: a development page that renders the generative motifs in each look, side by
 * side, so looks and algorithms can be judged by eye. Open /art-lab.html?seed=7.
 */
import { createSeededRng } from '../core/rng';
import { expressionFor, getFigureRig, paintRig } from './gameLook';
import { PALETTES, paintLinen, renderEmbroidery, renderLineArt, type PaletteName } from './looks';
import { lettering, ribbon } from './lettering';
import { GLYPH_NAMES } from './glyphs';
import { glyphDataUrl } from './glyphRender';
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

// Interface glyphs: each look's ground, every glyph at button size and enlarged.
if (!only || only === 'glyphs') {
  const panels = (['ink', 'night', 'blackwork', 'redBlack', 'festive'] as const).map((palette) => {
    const wrap = document.createElement('figure');
    const sheet = document.createElement('div');
    sheet.style.cssText = `background:${PALETTES[palette].ground};padding:8px;display:grid;grid-template-columns:repeat(8, 52px);gap:6px;width:${8 * 58}px`;
    for (const name of GLYPH_NAMES) {
      const cell = document.createElement('div');
      cell.title = name;
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px';
      const big = new Image(36, 36);
      big.src = glyphDataUrl(name, palette, 36);
      const small = new Image(16, 16);
      small.src = glyphDataUrl(name, palette, 16);
      cell.append(big, small);
      sheet.append(cell);
    }
    const caption = document.createElement('figcaption');
    caption.textContent = palette;
    wrap.append(sheet, caption);
    return wrap;
  });
  row('Glyphs: interface icons through each look', panels);
}

// One cloth, drawn once, shown in every look.
if (!only || only === 'cloth') {
  const clothShapes = cloth(createSeededRng(seed));
  row(
    `Cloth, seed ${seed}: one drawing, five looks`,
    LOOKS.map(([title, look, palette]) => panel(title, 460, 590, look, palette, 4.3, [240, 288], clothShapes)),
  );
}

// Lettering: words set as counted stitches, in every look.
if (!only || only === 'lettering') {
  const words: Shape[] = [
    ...place(ribbon('Zmeyovo', { cell: 1.6, ink: 'primary', rule: 'dark' }), { dx: 60, dy: 4 }),
    ...place(ribbon('Well of the Lamia', { cell: 0.9, ink: 'dark' }), { dx: 60, dy: 26 }),
    ...place(lettering('The quick brown fox, 1234567890!?', { cell: 0.7, ink: 'secondary', align: 'centre' }), { dx: 60, dy: 42 }),
  ];
  row(
    'Lettering: a sampler alphabet',
    (['ink', 'night', 'redBlack', 'festive'] as const).map((palette) =>
      panel(palette, 520, 210, palette === 'ink' || palette === 'night' ? 'line' : 'thread', palette, 4.2, [8, 26], words),
    ),
  );
}

// Motion: the rig walking, idling, talking and thinking, in two looks, animated live.
if (!only || only === 'motion') {
  const states = [
    { label: 'walking', state: 'walking', moving: true },
    { label: 'idle', state: 'idle', moving: false },
    { label: 'speaking', state: 'speaking', moving: false, line: 'Welcome, friend, the rain is coming!' },
    { label: 'speaking, grim', state: 'speaking', moving: false, line: 'Never cross the well after dark.' },
    { label: 'thinking', state: 'thinking', moving: false },
    { label: 'listening', state: 'listening', moving: false },
  ];
  const panels = (['ink', 'festive'] as const).map((look) => {
    const wrap = document.createElement('figure');
    const canvas = document.createElement('canvas');
    const width = 760;
    const height = 200;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;
    const tile = 64;
    let walkX = 0;
    let walkDir = 1;
    let stride = 0;
    let last = performance.now();
    const tick = (nowMs: number) => {
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const options = { unit: 4, origin: [0, 0] as [number, number], palette: PALETTES[look], seed };
      if (look === 'festive') paintLinen(ctx, width, height, options);
      else {
        ctx.fillStyle = PALETTES[look].ground;
        ctx.fillRect(0, 0, width, height);
      }
      walkX += walkDir * dt * 40;
      stride += dt * 6;
      if (walkX > 50 || walkX < -50) walkDir *= -1;
      states.forEach((entry, i) => {
        const id = `lab-${seed}-${i}`;
        const rig = getFigureRig(id, look, tile * 1.75, expressionFor(entry.state, entry.line));
        const x = 50 + i * 120 + (entry.moving ? walkX : 0);
        paintRig(ctx, rig, x, 92, tile, {
          id: `${id}-${look}`,
          facing: entry.moving ? (walkDir > 0 ? 'right' : 'left') : 'down',
          moving: entry.moving,
          animFrame: entry.moving ? stride : 0,
          state: entry.state,
          time: nowMs / 1000,
        });
        ctx.fillStyle = look === 'festive' ? '#3a2e24' : '#6b655c';
        ctx.font = '11px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(entry.label, 50 + i * 120 + tile / 2, 188);
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const caption = document.createElement('figcaption');
    caption.textContent = look === 'ink' ? 'Line art' : 'Thread, festive';
    wrap.append(canvas, caption);
    return wrap;
  });
  row('Motion: walk, idle, talk and think', panels);
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
