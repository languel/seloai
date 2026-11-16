import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../../core/rng';
import { findWorldPack, tileSemanticsForMap } from '../../world/packs';
import { GLYPH_NAMES, glyphShapes } from '../glyphs';
import { lettering, letteringWidth } from '../lettering';
import { PALETTES } from '../looks';
import { bubbleTail } from '../overlayChrome';
import { EXPRESSIONS, figure, figureParts } from '../figures';
import { cloth, treeOfLife } from '../motifs';
import { buildSceneModel } from '../scene';
import { sceneShapes } from '../sceneArt';
import { bounds, mirrored, place, type Shape } from '../shapes';

describe('Generative art', () => {
  it('grows the same motif from the same seed and a different one from another', () => {
    const a = JSON.stringify(cloth(createSeededRng(7)));
    expect(JSON.stringify(cloth(createSeededRng(7)))).toBe(a);
    expect(JSON.stringify(cloth(createSeededRng(8)))).not.toBe(a);
  });

  it('keeps trees mirror-symmetric about their axis', () => {
    const box = bounds(treeOfLife(createSeededRng(3), 30));
    expect(Math.abs(box.minX + box.maxX)).toBeLessThan(0.01);
    expect(box.maxY).toBeLessThanOrEqual(0.01);
  });

  it('gives every figure a skin tone and the expression asked for', () => {
    for (const expression of EXPRESSIONS) {
      const shapes = figure(createSeededRng(5), { height: 30, expression, skinTone: 2 });
      const skin = shapes.filter((s) => s.kind === 'area' && s.ink === 'skin');
      expect(skin.length).toBeGreaterThan(0);
      expect(skin.every((s) => s.kind === 'area' && s.tone === 2)).toBe(true);
    }
    const calm = JSON.stringify(figure(createSeededRng(5), { height: 30, expression: 'calm' }));
    const grim = JSON.stringify(figure(createSeededRng(5), { height: 30, expression: 'grim' }));
    expect(calm).not.toBe(grim);
  });

  it('transforms shapes without touching the originals', () => {
    const shape: Shape = { kind: 'area', points: [[1, 0], [2, 0], [2, 1]], ink: 'primary', grain: 0 };
    const moved = place([shape], { dx: 10, mirrorX: true });
    expect(shape.points[0]).toEqual([1, 0]);
    expect(moved[0].kind === 'area' && moved[0].points[0]).toEqual([9, 0]);
    expect(mirrored([shape])).toHaveLength(2);
  });

  it('defines every ink role and at least one skin tone in every palette', () => {
    for (const palette of Object.values(PALETTES)) {
      for (const role of ['primary', 'secondary', 'accent', 'accent2', 'gold', 'dark', 'skin'] as const) {
        expect(palette.inks[role]).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(palette.skinTones.length).toBeGreaterThan(0);
    }
  });

  it('sets text as counted stitches, capitals for lowercase and plain letters for accents', () => {
    const upper = lettering('WELL', { cell: 1 });
    expect(JSON.stringify(lettering('well', { cell: 1 }))).toBe(JSON.stringify(upper));
    expect(JSON.stringify(lettering('wéll', { cell: 1 }))).toBe(JSON.stringify(upper));
    expect(upper[0].kind).toBe('counted');
    expect(letteringWidth('AB', 2)).toBe((5 + 1 + 5) * 2);
    expect(lettering('', { cell: 1 })).toEqual([]);
    const centred = bounds(lettering('ABC', { cell: 1, align: 'centre' }));
    expect(Math.abs(centred.minX + centred.maxX)).toBeLessThan(1.01);
  });

  it('reads a world for what is there, with or without tile meanings', () => {
    const zmeyovo = findWorldPack('balkan-myth')!.build().map;
    const model = buildSceneModel(zmeyovo, tileSemanticsForMap(zmeyovo));
    const kinds = new Set(model.features.map((f) => f.kind));
    expect(kinds.has('house') && kinds.has('well') && kinds.has('tree')).toBe(true);
    expect(model.terrain.flat().filter((t) => t === 'water').length).toBeGreaterThan(50);
    expect(sceneShapes(model).length).toBeGreaterThan(500);

    const shevitsa = findWorldPack('shevitsa')!.build().map;
    const plain = buildSceneModel({ ...shevitsa, tileMeanings: undefined });
    expect(tileSemanticsForMap({ ...shevitsa, tileMeanings: undefined })).toBeUndefined();
    expect(plain.features.length).toBe(shevitsa.pointsOfInterest?.length ?? 0);
    expect(plain.features.every((f) => f.kind === 'star')).toBe(true);
    expect(plain.terrain.flat().some((t) => t === 'wall')).toBe(true);
  });
});

describe('interface glyphs', () => {
  it('draws every glyph inside its 16-unit box', () => {
    expect(GLYPH_NAMES.length).toBeGreaterThan(20);
    for (const name of GLYPH_NAMES) {
      const shapes = glyphShapes(name);
      expect(shapes.length, name).toBeGreaterThan(0);
      const b = bounds(shapes);
      expect(Math.max(-b.minX, -b.minY, b.maxX, b.maxY), name).toBeLessThanOrEqual(9);
    }
  });
});

describe('bubble tails', () => {
  const box = { x: 100, y: 50, w: 120, h: 40 };
  it('points down from the bottom edge to a head below the bubble', () => {
    const tail = bubbleTail(box, [160, 110]);
    expect(tail.side).toBe('bottom');
    expect(tail.base[0][1]).toBe(90);
    expect(tail.tip[1]).toBeGreaterThan(90);
    expect(tail.tip[1]).toBeLessThan(110);
  });
  it('leaves from the side that faces a head beside the bubble', () => {
    expect(bubbleTail(box, [60, 70]).side).toBe('left');
    expect(bubbleTail(box, [270, 72]).side).toBe('right');
    expect(bubbleTail(box, [160, 10]).side).toBe('top');
    const right = bubbleTail(box, [270, 72]);
    expect(right.base[0][0]).toBe(220);
    expect(right.tip[0]).toBeGreaterThan(220);
  });
  it('keeps the tail base on the box edge even when the head is far off to one side', () => {
    const tail = bubbleTail(box, [400, 200]);
    for (const [x, y] of tail.base) {
      expect(x).toBeGreaterThanOrEqual(box.x);
      expect(x).toBeLessThanOrEqual(box.x + box.w);
      expect(y).toBeGreaterThanOrEqual(box.y);
      expect(y).toBeLessThanOrEqual(box.y + box.h);
    }
  });
});

describe('figures in builds and views', () => {
  // Pinned output of the skirted front figure. Five seeds were rebaselined when the newer
  // headdresses arrived; only their head part changed (checked when the change was made).
  it('draws the skirted front figure exactly as pinned', async () => {
    const { createHash } = await import('node:crypto');
    const expected: Record<number, string> = {
      1: '7d62e79a064e18cb',
      5: '3b6f576ae0aa8ed4',
      7: '56f290af71ce5b1c',
      11: 'ffea56eb5627446e',
      42: 'f7aa6037cd8f62e2',
      99: '7b0805b331380eb4',
      1234: 'b89ad5db2cc322e9',
      98765: '42fb7597c39121a6',
    };
    for (const [seed, hash] of Object.entries(expected)) {
      const json = JSON.stringify(figure(createSeededRng(Number(seed)), { height: 30 }));
      expect(createHash('sha1').update(json).digest('hex').slice(0, 16), `seed ${seed}`).toBe(hash);
    }
  });

  it('keeps a person the same across views: same lean, resting mood and skin tone', () => {
    for (const build of ['skirted', 'trousered'] as const) {
      const front = figureParts(createSeededRng(21), { height: 30, build });
      for (const view of ['side', 'back'] as const) {
        const other = figureParts(createSeededRng(21), { height: 30, build, view });
        expect(other.lean).toBe(front.lean);
        expect(other.restingExpression).toBe(front.restingExpression);
        const tones = (parts: typeof front) =>
          new Set(parts.head.filter((s) => s.kind === 'area' && s.ink === 'skin').map((s) => (s.kind === 'area' ? s.tone : -1)));
        expect([...tones(other)]).toEqual([...tones(front)]);
      }
    }
  });

  it('shows a face from the front and side, and none from the back', () => {
    const eyes = (view: 'front' | 'side' | 'back') =>
      figureParts(createSeededRng(3), { height: 30, view, expression: 'calm' }).head.filter((s) => s.kind === 'knot' && s.ink === 'dark').length;
    expect(eyes('front')).toBe(2);
    expect(eyes('side')).toBe(1);
    expect(eyes('back')).toBe(0);
  });

  it('gives a trousered figure two long legs and hides the far arm side-on', () => {
    const man = figureParts(createSeededRng(8), { height: 30, build: 'trousered' });
    const legTop = Math.min(...man.legLeft.flatMap((s) => (s.kind === 'area' ? s.points.map((p) => p[1]) : [])));
    expect(legTop).toBeLessThan(-30 * 0.3);
    const side = figureParts(createSeededRng(8), { height: 30, build: 'trousered', view: 'side' });
    expect(side.armLeft.length).toBe(0);
    expect(side.armRight.length).toBeGreaterThan(0);
  });
});

describe('figure kinds', () => {
  it('draws a lamia on a serpent tail, a masked kuker and a long-haired samodiva', () => {
    const lamia = figureParts(createSeededRng(4), { height: 30, kind: 'serpent' });
    expect(lamia.legLeft).toHaveLength(0);
    expect(lamia.legRight).toHaveLength(0);
    expect(bounds(lamia.skirt).maxX).toBeGreaterThan(30 * 0.25);

    const kuker = figureParts(createSeededRng(4), { height: 30, kind: 'kuker' });
    expect(kuker.head.some((s) => s.kind === 'area' && s.ink === 'accent2')).toBe(true);
    expect(kuker.legLeft.length).toBeGreaterThan(0);

    const samodiva = figureParts(createSeededRng(4), { height: 30, kind: 'samodiva' });
    const plain = figureParts(createSeededRng(4), { height: 30 });
    expect(bounds(samodiva.head).maxY).toBeGreaterThan(bounds(plain.head).maxY);
  });

  it('keeps every kind and view inside a sensible box', () => {
    for (const kind of ['human', 'serpent', 'kuker', 'samodiva'] as const) {
      for (const view of ['front', 'side', 'back'] as const) {
        const b = bounds(figure(createSeededRng(9), { height: 30, kind, view }));
        expect(b.maxY, `${kind} ${view}`).toBeLessThan(3);
        expect(b.minY, `${kind} ${view}`).toBeGreaterThan(-45);
        expect(b.maxX - b.minX, `${kind} ${view}`).toBeLessThan(40);
      }
    }
  });
});

describe("the maker's quirks", () => {
  it('leave the body and legs alone, are seeded, and change hem, head and hands', () => {
    for (const seed of [3, 11, 99, 1234]) {
      const neat = figureParts(createSeededRng(seed), { height: 30 });
      const quirky = figureParts(createSeededRng(seed), { height: 30, quirks: true });
      const again = figureParts(createSeededRng(seed), { height: 30, quirks: true });
      expect(JSON.stringify(quirky)).toBe(JSON.stringify(again));
      expect(JSON.stringify(quirky.torso)).toBe(JSON.stringify(neat.torso));
      expect(JSON.stringify(quirky.legLeft)).toBe(JSON.stringify(neat.legLeft));
      expect(JSON.stringify(quirky.head)).not.toBe(JSON.stringify(neat.head));
      expect(JSON.stringify(quirky.skirt)).not.toBe(JSON.stringify(neat.skirt));
      const arms = (p: typeof neat) => JSON.stringify([p.armLeft, p.armRight]);
      expect(arms(quirky)).not.toBe(arms(neat));
    }
  });
});

describe('figures seen small', () => {
  it('bold detail changes only the head, which grows from the neck', () => {
    for (const seed of [3, 11, 99]) {
      const full = figureParts(createSeededRng(seed), { height: 30, expression: 'grim' });
      const bold = figureParts(createSeededRng(seed), { height: 30, expression: 'grim', detail: 'bold' });
      for (const part of ['legLeft', 'legRight', 'skirt', 'torso', 'armLeft', 'armRight'] as const) {
        expect(JSON.stringify(bold[part])).toBe(JSON.stringify(full[part]));
      }
      const a = bounds(full.head);
      const b = bounds(bold.head);
      expect(b.maxX - b.minX).toBeGreaterThan(a.maxX - a.minX);
      // No nose stroke: fewer marks, and those left are heavier.
      expect(bold.head.length).toBeLessThan(full.head.length);
    }
  });

  it('picks bold below the on-screen height threshold', async () => {
    const { figureDetailFor } = await import('../gameLook');
    expect(figureDetailFor(56, 1.15)).toBe('bold');
    expect(figureDetailFor(56, 2)).toBe('full');
  });
});

describe('tile meanings in world packs', () => {
  it('reads Shevitsa from the table its map carries', () => {
    const shevitsa = findWorldPack('shevitsa')!.build().map;
    expect(shevitsa.tileMeanings?.length).toBeGreaterThan(0);
    const model = buildSceneModel(shevitsa, tileSemanticsForMap(shevitsa));
    const count = (t: string) => model.terrain.flat().filter((k) => k === t).length;
    expect(count('water')).toBeGreaterThan(100);
    expect(count('road')).toBeGreaterThan(100);
    expect(count('bridge')).toBeGreaterThan(0);
    const kinds = model.features.map((f) => f.kind);
    expect(kinds.filter((k) => k === 'star').length).toBe(5);
    expect(kinds).toContain('tree');
    expect(kinds).toContain('well');
    expect(kinds).toContain('hearth');
    // The Balkan ridge is stone where it can be crossed and a wall where it cannot.
    expect(model.terrain[15][18]).toBe('dry');
    expect(model.terrain[16][18]).toBe('wall');
  });

  it('builds semantics from plain data, later entries adding to earlier ones', async () => {
    const { semanticsFromTable, validateTileMeanings } = await import('../scene');
    const s = semanticsFromTable([
      { tiles: [1, 2], terrain: 'water' },
      { tiles: [2], feature: { kind: 'duck', w: 1, h: 1 } },
    ]);
    expect(s(1)).toEqual({ terrain: 'water' });
    expect(s(2)).toEqual({ terrain: 'water', feature: { kind: 'duck', w: 1, h: 1 } });
    expect(s(3)).toBeUndefined();
    expect(validateTileMeanings([{ tiles: [1], terrain: 'water' }])).toEqual([]);
    expect(validateTileMeanings([{ tiles: ['x'], terrain: 'lava' }]).length).toBe(2);
    expect(validateTileMeanings({})).toEqual(['tileMeanings must be a list.']);
  });

  it('gives maps saved before tables existed the bundled table for their tileset', async () => {
    const { withBundledTileMeanings } = await import('../../world/packs');
    const old = { ...findWorldPack('balkan-myth')!.build().map, tileMeanings: undefined };
    expect(withBundledTileMeanings(old).tileMeanings?.length).toBeGreaterThan(0);
    const custom = { ...old, tileSetUrl: '/assets/mine.png' };
    expect(withBundledTileMeanings(custom).tileMeanings).toBeUndefined();
    const own = { ...old, tileMeanings: [{ tiles: [0], terrain: 'water' as const }] };
    expect(withBundledTileMeanings(own)).toBe(own);
  });
});

describe('ambient density', () => {
  it('adds groves, yards and fields only on open ground, deterministically, without moving world features', async () => {
    const { withAmbience } = await import('../ambient');
    const pack = findWorldPack('balkan-myth');
    expect(pack).toBeDefined();
    const map = pack!.build().map;
    const model = buildSceneModel(map, tileSemanticsForMap(map));
    const a = withAmbience(model, 7);
    const b = withAmbience(model, 7);
    expect(JSON.stringify(a.features)).toBe(JSON.stringify(b.features));
    const original = new Set(model.features.map((f) => `${f.kind}:${f.x}:${f.y}`));
    const added = a.features.filter((f) => !original.has(`${f.kind}:${f.x}:${f.y}`));
    expect(added.length).toBeGreaterThan(20);
    expect(a.features.filter((f) => original.has(`${f.kind}:${f.x}:${f.y}`)).length).toBe(model.features.length);
    const kinds = new Set(added.map((f) => f.kind));
    for (const k of ['rosette', 'grove'] as const) expect(kinds.has(k), k).toBe(true);
    for (const f of added) {
      if (f.kind === 'duck') {
        expect(model.terrain[f.x][f.y]).toBe('water');
        continue;
      }
      for (let x = f.x; x < f.x + f.w; x++) for (let y = f.y; y < f.y + f.h; y++) expect(model.terrain[x][y], `${f.kind} at ${x},${y}`).toBe('ground');
    }
  });
});

describe('Wang worlds', () => {
  it('assembles chunks whose shared edges agree, with a river that runs from entry to exit', async () => {
    const { planChunks, generateWangScene, CHUNK } = await import('../wangWorld');
    for (const seed of [3, 11, 27]) {
      const options = { cols: 6, rows: 4, seed, riverIn: 1, riverOut: 4 };
      const plan = planChunks(options);
      for (let x = 0; x < options.cols; x++) {
        for (let y = 0; y < options.rows; y++) {
          const sig = plan.signatures[x][y];
          if (x + 1 < options.cols) expect(sig.east, `seed ${seed} ${x},${y} east`).toBe(plan.signatures[x + 1][y].west);
          if (y + 1 < options.rows) expect(sig.south, `seed ${seed} ${x},${y} south`).toBe(plan.signatures[x][y + 1].north);
        }
      }
      expect(plan.signatures[1][0].north).toBe('water');
      expect(plan.signatures[4][options.rows - 1].south).toBe('water');
      // The river is connected: flood from the entry through water and bridges reaches the bottom.
      const scene = generateWangScene(options);
      const wet = (x: number, y: number) => scene.terrain[x]?.[y] === 'water' || scene.terrain[x]?.[y] === 'bridge';
      const start: Array<[number, number]> = [];
      for (let x = 0; x < scene.width; x++) if (wet(x, 0)) start.push([x, 0]);
      expect(start.length).toBeGreaterThan(0);
      const seen = new Set(start.map(([x, y]) => `${x},${y}`));
      const queue = [...start];
      while (queue.length) {
        const [x, y] = queue.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (wet(nx, ny) && !seen.has(`${nx},${ny}`)) {
            seen.add(`${nx},${ny}`);
            queue.push([nx, ny]);
          }
        }
      }
      expect([...seen].some((c) => Number(c.split(',')[1]) === options.rows * CHUNK - 1), `seed ${seed}`).toBe(true);
      expect(scene.features.some((f) => f.kind === 'house')).toBe(true);
    }
  });
});

describe('conversation threads', () => {
  it('joins everyone in a conversation to its speaker, and sags below the straight line', async () => {
    const { threadPairs, threadPoint } = await import('../threads');
    const pairs = threadPairs([
      { id: 'a', x: 0, y: 0, speaking: false, conversationId: 'c1' },
      { id: 'b', x: 100, y: 0, speaking: true, conversationId: 'c1' },
      { id: 'c', x: 50, y: 50, speaking: false, conversationId: 'c1' },
      { id: 'd', x: 300, y: 0, speaking: false, conversationId: 'c2' },
    ]);
    expect(pairs.map(([s, l]) => `${s.id}-${l.id}`)).toEqual(['b-a', 'b-c']);
    const [, midY] = threadPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    expect(midY).toBeGreaterThan(0);
  });
});

describe('headdress variety', () => {
  it('makes horns rare and gives every newer headdress a fair share', async () => {
    const { headdressFor } = await import('../figures');
    const counts: Record<string, number> = {};
    const n = 2000;
    for (let seed = 1; seed <= n; seed++) {
      const h = headdressFor(createSeededRng(seed));
      counts[h] = (counts[h] ?? 0) + 1;
    }
    expect(counts.horns ?? 0).toBeLessThan(n * 0.05);
    for (const h of ['crown', 'kerchief', 'wreath', 'sokai', 'coins', 'sprig', 'veil', 'braids']) {
      expect(counts[h] ?? 0, h).toBeGreaterThan(n * 0.05);
    }
  });
});
