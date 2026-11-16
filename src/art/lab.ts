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
import { figure, type FigureView } from './figures';
import { cloth, treeOfLife } from './motifs';
import { withAmbience } from './ambient';
import { UNITS_PER_TILE, sceneShapes } from './sceneArt';
import { CHUNK, generateWangScene } from './wangWorld';
import { place, type Shape } from './shapes';
import { WovenText, type WovenSpeaker } from './wovenText';
import { stitchedGlyph, type WovenHand } from './wovenGlyphs';

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

// Woven text: three people talking (one walks off), their words sewn onto the cloth, live.
if (only === 'woven') {
  const panels = (['festive', 'ink'] as const).map((look) => {
    const wrap = document.createElement('figure');
    const canvas = document.createElement('canvas');
    const W = 900;
    const H = 560;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    const palette = PALETTES[look];
    const lineLook = look === 'ink';
    const ground = document.createElement('canvas');
    ground.width = W;
    ground.height = H;
    const g = ground.getContext('2d')!;
    if (lineLook) {
      g.fillStyle = palette.ground;
      g.fillRect(0, 0, W, H);
    } else paintLinen(g, W, H, { unit: 6, origin: [0, 0], palette, seed: 3 });
    const td = 32;
    const hand = (params.get('hand') as WovenHand) || 'satin';
    const cast = [
      { id: 'a', build: 'skirted' as const, colour: lineLook ? palette.inks.dark : palette.inks.primary, lines: ['The Lamia fears living water freely shared. Leave scarlet thread by the well.', 'And according to what I have seen, one day they wake up and decide to do something really strange!'] },
      { id: 'b', build: 'trousered' as const, colour: lineLook ? palette.inks.dark : palette.inks.secondary, lines: ['Who told you that? The forge was cold all night.', 'Then someone lied at the fire, and the whole square heard it.'] },
      { id: 'c', build: 'skirted' as const, colour: lineLook ? palette.inks.dark : palette.inks.accent2, lines: ['Hush. Listen to the bells on the ridge.', 'Bring honeyed wheat, silver obols, or an oath kept true.'] },
    ];
    const woven = new WovenText();
    const opts = { size: td * 0.46, holdSec: 16, fadeSec: 5, charsPerSec: 16, bounds: { w: W, h: H } };
    const start = performance.now();
    const where = (id: string, t: number): [number, number] => {
      if (id === 'a') return [300 + Math.min(1, Math.max(0, ((t % 40) - 12) / 8)) * 330, 280];
      if (id === 'b') return [430, 330];
      return [560, 250];
    };
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      const speakers: WovenSpeaker[] = [];
      cast.forEach((c, i) => {
        const period = 8;
        const phase = t + i * 2.7;
        const k = Math.floor(phase / period);
        const into = phase % period;
        const [x, y] = where(c.id, t);
        if (into < period * 0.75) {
          const text = c.lines[k % c.lines.length];
          speakers.push({ id: c.id, x: x + td / 2, y: y - td * 1.2, text: text.slice(0, Math.floor(into * 18)), lineId: `${c.id}${k}`, kind: 'speech', colour: c.colour });
        }
      });
      if (t % 40 > 5 && t % 40 < 10) {
        const [x, y] = where('b', t);
        speakers.push({ id: 'b', x: x + td / 2, y: y - td * 1.2, text: 'I should not have said it so plainly...'.slice(0, Math.floor(((t % 40) - 5) * 14)), lineId: `th${Math.floor(t / 40)}`, kind: 'thought', colour: cast[1].colour });
      }
      const obstacles = cast.map((c) => {
        const [x, y] = where(c.id, t);
        return { x: x + td / 2 - 14, y: y - td * 1.9, w: 28, h: td * 1.9 + 4 };
      });
      woven.update(t, speakers, obstacles, opts);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(ground, 0, 0);
      for (const l of woven.letters) {
        const glyph = stitchedGlyph(l.ch, l.colour, l.size * dpr, hand, l.kind === 'thought', lineLook);
        if (!glyph) continue;
        const w = glyph.width / dpr;
        ctx.save();
        ctx.globalAlpha = WovenText.alpha(l, t, opts) * (l.kind === 'thought' ? 0.72 : 1);
        ctx.translate(l.x, l.y);
        ctx.rotate(l.angle);
        ctx.drawImage(glyph, -w / 2, -w / 2, w, w);
        ctx.restore();
      }
      for (const [id, tail] of woven.tails(t, 5)) {
        const [x, y] = where(id, t);
        const fx = x + td / 2;
        const fy = y - td * 0.9;
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = tail.colour;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.quadraticCurveTo((fx + tail.x) / 2, (fy + tail.y) / 2 + 18, tail.x, tail.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      cast.forEach((c) => {
        const [x, y] = where(c.id, t);
        const rig = getFigureRig(`woven-${c.id}`, look, td * 1.75, undefined, { build: c.build, view: 'front' });
        paintRig(ctx, rig, x, y - td, td, { id: `wv-${look}-${c.id}`, facing: 'down', moving: c.id === 'a' && t % 40 > 12 && t % 40 < 20, animFrame: t * 5, state: 'idle', time: t });
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const caption = document.createElement('figcaption');
    caption.textContent = look === 'ink' ? 'Line art' : 'Thread, festive';
    wrap.append(canvas, caption);
    return wrap;
  });
  row('Woven text: speech and thoughts sewn onto the cloth (add &hand=counted for sampler letters)', panels);
}

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

// Motion: women and men walking toward us, side-on and away, then idling, talking and
// thinking, animated live in two looks.
if (!only || only === 'motion') {
  type Cell = { label: string; state: string; facing: 'down' | 'left' | 'right' | 'up'; moving: boolean; line?: string; view: FigureView };
  const cells: Cell[] = [
    { label: 'walk toward', state: 'walking', facing: 'down', moving: true, view: 'front' },
    { label: 'walk side-on', state: 'walking', facing: 'right', moving: true, view: 'side' },
    { label: 'walk away', state: 'walking', facing: 'up', moving: true, view: 'back' },
    { label: 'idle', state: 'idle', facing: 'down', moving: false, view: 'front' },
    { label: 'speaking', state: 'speaking', facing: 'down', moving: false, line: 'Welcome, friend, the rain is coming!', view: 'front' },
    { label: 'thinking', state: 'thinking', facing: 'down', moving: false, view: 'front' },
  ];
  const panels = (['ink', 'festive'] as const).map((look) => {
    const wrap = document.createElement('figure');
    const canvas = document.createElement('canvas');
    const width = 760;
    const height = 380;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;
    const tile = 64;
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
      stride += dt * 6;
      (['skirted', 'trousered'] as const).forEach((build, row) => {
        cells.forEach((cell, i) => {
          const id = `lab-${seed}-${build}-${i}`;
          const rig = getFigureRig(`lab-${seed + row * 3}`, look, tile * 1.75, expressionFor(cell.state, cell.line), { build, view: cell.view });
          const x = 50 + i * 120;
          const y = 92 + row * 180;
          paintRig(ctx, rig, x, y, tile, {
            id: `${id}-${look}`,
            facing: cell.facing,
            moving: cell.moving,
            animFrame: cell.moving ? stride : 0,
            state: cell.state,
            time: nowMs / 1000,
          });
          ctx.fillStyle = look === 'festive' ? '#3a2e24' : '#6b655c';
          ctx.font = '11px ui-sans-serif, system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(cell.label, x + tile / 2, y + 96);
        });
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const caption = document.createElement('figcaption');
    caption.textContent = look === 'ink' ? 'Line art' : 'Thread, festive';
    wrap.append(canvas, caption);
    return wrap;
  });
  row('Motion: a woman and a man, toward us, side-on and away, idle, talking, thinking', panels);
}

// Wang worlds: whole worlds assembled from edge-matched chunks of meaning.
if (!only || only === 'wang') {
  const worlds = [seed, seed + 1].map((s) =>
    sceneShapes(withAmbience(generateWangScene({ cols: 6, rows: 4, seed: s, riverIn: 1 + (s % 3), riverOut: 2 + (s % 3), title: `Seed ${s}` }), s)),
  );
  row(
    'Wang worlds: chunks whose edges always agree, then ambience',
    [
      panel('Festive, first seed', 760, 520, 'thread', 'festive', 760 / (6 * CHUNK * UNITS_PER_TILE), [0, 0], worlds[0]),
      panel('Line art, next seed', 760, 520, 'line', 'ink', 760 / (6 * CHUNK * UNITS_PER_TILE), [0, 0], worlds[1]),
    ],
  );
}

// Kinds: the special cast a world pack can ask for, from the front, side-on and behind.
if (!only || only === 'kinds') {
  const kindShapes: Shape[] = [];
  const kinds = ['serpent', 'kuker', 'samodiva'] as const;
  kinds.forEach((kind, k) => {
    (['front', 'side', 'back'] as const).forEach((view, v) => {
      kindShapes.push(...place(figure(createSeededRng(seed + k * 7), { height: 30, kind, view }), { dx: (k * 3 + v) * 22 }));
    });
  });
  row(
    'Kinds: lamia, kuker and samodiva, front, side and back',
    (['ink', 'festive'] as const).map((palette) =>
      panel(palette === 'ink' ? 'Line art' : 'Thread, festive', 860, 200, palette === 'ink' ? 'line' : 'thread', palette, 4, [44, 168], kindShapes),
    ),
  );
}

// Women: a run of seeds, to judge the mix of headdresses.
if (!only || only === 'women') {
  const women: Shape[] = [];
  for (let i = 0; i < 12; i++) women.push(...place(figure(createSeededRng(seed * 100 + i), { height: 30 }), { dx: (i % 6) * 24, dy: Math.floor(i / 6) * 44 }));
  row(
    'Women: twelve seeds, for the mix of headdresses',
    (['ink', 'festive'] as const).map((palette) =>
      panel(palette === 'ink' ? 'Line art' : 'Thread, festive', 760, 470, palette === 'ink' ? 'line' : 'thread', palette, 5.2, [70, 205], women),
    ),
  );
}

// The maker's quirks: the same six people neat (top) and with the maker's hand (bottom).
if (!only || only === 'quirks') {
  const pairs: Shape[] = [];
  for (let i = 0; i < 6; i++) {
    const options = { height: 30, build: i % 3 === 2 ? ('trousered' as const) : ('skirted' as const) };
    pairs.push(...place(figure(createSeededRng(seed * 100 + i), options), { dx: i * 24 }));
    pairs.push(...place(figure(createSeededRng(seed * 100 + i), { ...options, quirks: true }), { dx: i * 24, dy: 44 }));
  }
  row(
    "Maker's quirks: neat above, the maker's hand below",
    (['ink', 'festive'] as const).map((palette) =>
      panel(palette === 'ink' ? 'Line art' : 'Thread, festive', 760, 470, palette === 'ink' ? 'line' : 'thread', palette, 5.2, [70, 205], pairs),
    ),
  );
}

// A cast: every seed is a different person.
if (!only || only === 'figures') {
  const castRng = createSeededRng(seed * 31 + 5);
  const cast: Shape[] = [];
  for (let i = 0; i < 7; i++) cast.push(...place(figure(castRng, { height: 30, build: i % 2 ? 'trousered' : 'skirted' }), { dx: i * 26 }));
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
