import { createBrowserSimulation } from '../../app/browserSimulation';
import { describe, expect, it } from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { generateProceduralPlayerCustomSprite, resolvePlayerAppearance } from '../../engine/playerSpriteGenerator';
import {
  createOverlayCollector,
  renderOverlayBatch,
  resolveOverlayBatch,
  resolveOverlappingRects,
} from '../../engine/renderer';
import {
  computeCoveredByteSpan,
  getLastLoadedModel,
  matchesTransformersCacheEntries,
  saveLastLoadedModel,
  clearLastLoadedModel,
} from '../../ai/modelCache';
import {
  DEFAULT_AESTHETIC_SETTINGS,
  DEFAULT_PLAYER_APPEARANCE,
  clampAestheticSettings,
  detectWorldTheme,
  resolveAestheticTokens,
} from '../aestheticThemes';
import { abbreviatePersonName, abbreviateWorldName, formatRichPlainText, tokenizeRichText } from '../formatNames';
import {
  SPEED_LOG_MARKS,
  formatSpeedLabel,
  sliderPosToSpeed,
  speedToSliderPos,
} from '../speedSlider';

describe('formatNames & rich label helpers', () => {
  it('abbreviates long world and person names cleanly on word boundaries', () => {
    expect(abbreviateWorldName('Zmeyovo: Well of the Lamia', 20)).toBe('Zmeyovo');
    expect(abbreviateWorldName('Шевици: The Embroidered Realm of Bulgaria', 20)).toBe('Шевици');
    expect(abbreviateWorldName('Selo Horyzont (Placeholder)', 20)).toBe('Selo Horyzont');
    expect(abbreviateWorldName('Auto-Backup: Zmeyovo: Well of the Lamia', 20)).toBe('Backup: Zmeyovo');

    expect(abbreviatePersonName('Lamia Zmeitsa', 11)).toBe('Lamia Z.');
    expect(abbreviatePersonName('Stoyan Yunak', 11)).toBe('Stoyan Y.');
    expect(abbreviatePersonName('Scribe', 11)).toBe('Scribe');
    });

  it('replaces #Tag and #Tag (Label) with bold readable object labels and strips #/@ markers', () => {
    const pois = [
      { id: 'h', tag: 'KukeriHearth', label: 'Kukeri Fire Hearth', x: 5, y: 5 },
      { id: 'w', tag: 'LamiaWell', label: 'Well of the Lamia', x: 10, y: 10 },
    ];
    const text = 'Gather with @Stoyan Yunak at #KukeriHearth (Kukeri Fire Hearth) before visiting #LamiaWell.';
    expect(formatRichPlainText(text, pois, ['Stoyan Yunak'])).toBe(
      'Gather with Stoyan Yunak at Kukeri Fire Hearth before visiting Well of the Lamia.',
    );

    const segs = tokenizeRichText(text, pois, ['Stoyan Yunak']);
    expect(segs.some((s) => s.kind === 'poi' && s.text === 'Kukeri Fire Hearth')).toBe(true);
    expect(segs.some((s) => s.kind === 'poi' && s.text === 'Well of the Lamia')).toBe(true);
    expect(segs.some((s) => s.kind === 'actor' && s.text === 'Stoyan Yunak')).toBe(true);
    expect(segs.every((s) => !s.text.includes('#'))).toBe(true);
    });
  });

describe('signed logarithmic speed & rewind slider helpers', () => {
  it('maps center to 0× pause and preserves every signed log detent mark', () => {
    expect(sliderPosToSpeed(0)).toBe(0);
    expect(sliderPosToSpeed(15)).toBe(0);
    expect(sliderPosToSpeed(-15)).toBe(0);
    expect(formatSpeedLabel(0)).toBe('0×');
    expect(formatSpeedLabel(0.25)).toBe('¼×');
    expect(formatSpeedLabel(-0.5)).toBe('-½×');

    for (const mark of SPEED_LOG_MARKS) {
      const pos = speedToSliderPos(mark.value);
      expect(sliderPosToSpeed(pos)).toBeCloseTo(mark.value, 5);
    }
    });
  });

describe('VillageSimulation timeline rewind and slow/paused bubble scaling', () => {
  it('records movement & events and rewinds smoothly under negative speedMultiplier', () => {
    const map = createDefaultMap();
    map.collisionGrid = Array.from({ length: map.width }, () => Array(map.height).fill(false));
    map.objectTiles = [];
    const soleVillager = { ...structuredClone(DEFAULT_VILLAGERS[0]), homeTile: { x: 4, y: 4 } };
    const sim = createBrowserSimulation(
      map,
      [soleVillager],
      [],
      { ...DEFAULT_MODEL_SETTINGS, autoConverse: false },
    );
    const v0 = [...sim.runtimes.values()][0]!;
    const startX = v0.x;
    const startY = v0.y;

    // Walk forward 2.0s of simulation time along an open corridor
    v0.path = [
      { x: Math.round(startX) + 1, y: Math.round(startY) },
      { x: Math.round(startX) + 2, y: Math.round(startY) },
      { x: Math.round(startX) + 3, y: Math.round(startY) },
    ];
    for (let i = 0; i < 40; i++) {
      sim.stepFrame(0.05);
    }
    const midX = v0.x;
    expect(midX).toBeGreaterThan(startX + 1.0);

    // Emit a bubble and conversation message, then advance another 1.0s
    const startWall = Date.now();
    v0.currentBubble = {
      text: 'Remember #KukeriHearth!',
      startedAt: startWall,
      expiresAt: startWall + 8000,
    };
    sim.conversations.push({
      id: 'conv-rewind-test',
      participantIds: [v0.id],
      active: true,
      startedAt: startWall,
      updatedAt: startWall,
      messages: [
        {
          id: 'm1',
          senderId: v0.id,
          senderName: soleVillager.name,
          text: 'Past line',
          timestamp: startWall,
          kind: 'speech',
          source: 'story-sim',
        },
      ],
      });
    for (let i = 0; i < 20; i++) {
      sim.stepFrame(0.05);
    }
    expect(sim.conversations.length).toBe(1);
    const forwardSimMs = sim.simTimeMs;

    // Verify slow-mo/pause extends bubble lifetime proportionally (0× freezes bubble clock)
    const beforePauseExp = v0.currentBubble!.expiresAt;
    sim.speedMultiplier = 0;
    sim.stepFrame(0.05);
    expect(v0.currentBubble!.expiresAt).toBeGreaterThan(beforePauseExp);

    // Rewind at -2× past the conversation creation back toward start
    sim.speedMultiplier = -2;
    for (let i = 0; i < 26; i++) {
      sim.stepFrame(0.05);
    }
    expect(sim.simTimeMs).toBeLessThan(forwardSimMs);
    expect(sim.getRewindInfo().behindPresentSec).toBeGreaterThan(1.0);
    expect(v0.x).toBeLessThan(midX);
    expect(sim.conversations.length).toBe(0);
    });
  });

describe('aesthetic themes, overlay de-overlap & procedural world-matched player sprites', () => {
  it('detects world themes and computes legible smoked-glass vs parchment tokens', () => {
    expect(
      detectWorldTheme({ tileSetUrl: '/assets/balkan-myth-tileset.png', name: 'Zmeyovo: Well of the Lamia' }),
    ).toBe('balkan-myth');
    expect(
      detectWorldTheme({ tileSetUrl: '/assets/shevitsa-tileset.png', name: 'Шевици Square' }),
    ).toBe('shevitsa');
    expect(
      detectWorldTheme({ tileSetUrl: '/assets/custom-tileset.png', name: 'Oakville' }),
    ).toBe('classic');

    // With the classic tile look the HUD decoration follows the world theme...
    const balkanTokens = resolveAestheticTokens(
      { ...DEFAULT_AESTHETIC_SETTINGS, worldLook: 'tiles' },
      'balkan-myth',
    );
    // ...and on a cloth look it is parchment, or dark for the night plate.
    expect(resolveAestheticTokens(DEFAULT_AESTHETIC_SETTINGS, 'balkan-myth').resolvedDecoration).toBe(
      'parchment-chronicle',
    );
    expect(
      resolveAestheticTokens({ ...DEFAULT_AESTHETIC_SETTINGS, worldLook: 'night' }, 'balkan-myth')
        .resolvedDecoration,
    ).toBe('frosted-obsidian');
    expect(balkanTokens.resolvedDecoration).toBe('balkan-shevitsa');
    expect(balkanTokens.isLightSurface).toBe(false);
    expect(balkanTokens.canvasTheme.speechText).toBe('#faf6ee');

    const parchment = resolveAestheticTokens(
      clampAestheticSettings({
        uiDecoration: 'parchment-chronicle',
        bubbleStyle: 'parchment-scroll',
        hudGlassOpacity: 2,
        characterScale: 2,
      }),
      'classic',
    );
    expect(parchment.isLightSurface).toBe(true);
    expect(parchment.canvasTheme.speechText).toBe('#1e1915');
    expect(parchment.canvasTheme.characterScale).toBe(1.35);
    });

  it('procedurally adapts player spritesheet to active world theme and explicit customization', () => {
    const balkanAuto = resolvePlayerAppearance(DEFAULT_PLAYER_APPEARANCE, 'balkan-myth');
    expect(balkanAuto.attire).toBe('balkan-yunak');
    expect(balkanAuto.headgear).toBe('kalpak');
    expect(balkanAuto.propItem).toBe('lantern');

    const shevitsaAuto = resolvePlayerAppearance(DEFAULT_PLAYER_APPEARANCE, 'shevitsa');
    expect(shevitsaAuto.attire).toBe('shevitsa-embroiderer');
    expect(shevitsaAuto.headgear).toBe('kerchief');

    const classicAuto = resolvePlayerAppearance(DEFAULT_PLAYER_APPEARANCE, 'classic');
    expect(classicAuto.attire).toBe('classic-traveler');
    expect(classicAuto.headgear).toBe('traveler-hood');

    const sprite = generateProceduralPlayerCustomSprite(
      { ...DEFAULT_PLAYER_APPEARANCE, attire: 'balkan-weaver', accentColor: '#243e6d' },
      'balkan-myth',
    );
    expect(sprite.frameWidth).toBe(32);
    expect(sprite.frameHeight).toBe(32);
    expect(sprite.framesPerDirection).toBe(4);
    expect(sprite.textureUrl.startsWith('data:image/png;base64,')).toBe(true);
    });

  it('separates overlapping labels and speech bubbles deterministically', () => {
    const resolved = resolveOverlappingRects(
      [
        { id: 'speech:a', x: 100, y: 100, w: 120, h: 42, anchorX: 160, anchorY: 148, priority: 40, preferAbove: true },
        { id: 'speech:b', x: 112, y: 106, w: 120, h: 42, anchorX: 172, anchorY: 152, priority: 35, preferAbove: true },
        { id: 'name:a', x: 105, y: 180, w: 80, h: 16, anchorX: 145, anchorY: 178, priority: 20 },
        { id: 'name:b', x: 125, y: 182, w: 84, h: 16, anchorX: 167, anchorY: 180, priority: 18 },
      ],
      4,
    );
    const list = [...resolved.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const overlaps =
          a.x < b.x + b.w + 3.9 &&
          a.x + a.w + 3.9 > b.x &&
          a.y < b.y + b.h + 3.9 &&
          a.y + a.h + 3.9 > b.y;
        expect(overlaps).toBe(false);
      }
    }
    // Highest priority bubble keeps its anchor position
    expect(resolved.get('speech:a')?.x).toBe(100);
    expect(resolved.get('speech:a')?.y).toBe(100);
    });

  it('keeps a visible speaker\'s bubble in view and beside a fixed body, never over it', () => {
    const view = { x: 0, y: 0, w: 400, h: 300 };
    const resolved = resolveOverlappingRects(
      [
        // A body near the top edge: its bubble would sit above the view.
        { id: 'body-a', x: 190, y: 10, w: 20, h: 40, anchorX: 200, anchorY: 10, priority: 1000, fixed: true },
        { id: 'speech:a', x: 140, y: -40, w: 100, h: 40, anchorX: 200, anchorY: 10, priority: 40, preferAbove: true },
        // A speaker outside the view keeps its ideal position.
        { id: 'speech:off', x: 600, y: -40, w: 100, h: 40, anchorX: 650, anchorY: 10, priority: 30, preferAbove: true },
      ],
      4,
      view,
    );
    const body = resolved.get('body-a')!;
    expect(body.x).toBe(190);
    const a = resolved.get('speech:a')!;
    expect(a.y).toBeGreaterThanOrEqual(4);
    expect(a.x).toBeGreaterThanOrEqual(4);
    expect(a.x + a.w).toBeLessThanOrEqual(396);
    const overlapsBody = a.x < body.x + body.w && a.x + a.w > body.x && a.y < body.y + body.h && a.y + a.h > body.y;
    expect(overlapsBody).toBe(false);
    expect(resolved.get('speech:off')?.x).toBe(600);
    expect(resolved.get('speech:off')?.y).toBe(-40);
    });

  it('splits overlay rendering into pills before characters and configurable bubbles layer', () => {
    const collector = createOverlayCollector();
    const calls: string[] = [];
    collector.items.push(
      {
        rect: { id: 'speech:1', x: 10, y: 10, w: 60, h: 24, anchorX: 40, anchorY: 36, priority: 40 },
        layerOrder: 2,
        layerGroup: 'bubbles',
        render: () => calls.push('speech'),
      },
      {
        rect: { id: 'name:1', x: 10, y: 80, w: 50, h: 16, anchorX: 35, anchorY: 78, priority: 20 },
        layerOrder: 0,
        layerGroup: 'pills',
        render: () => calls.push('name'),
      },
      {
        rect: { id: 'poi:1', x: 120, y: 40, w: 70, h: 16, anchorX: 155, anchorY: 38, priority: 15 },
        layerOrder: 0,
        layerGroup: 'pills',
        render: () => calls.push('poi'),
      },
      {
        rect: { id: 'thought:1', x: 10, y: -18, w: 60, h: 20, anchorX: 40, anchorY: 6, priority: 34 },
        layerOrder: 1,
        layerGroup: 'bubbles',
        render: () => calls.push('thought'),
      },
    );

    const mockCtx = { save() {}, restore() {} } as unknown as CanvasRenderingContext2D;
    const batch = resolveOverlayBatch(collector, true);

    renderOverlayBatch(mockCtx, batch, 'pills');
    calls.push('CHARACTER');
    renderOverlayBatch(mockCtx, batch, 'bubbles');
    expect(calls).toEqual(['name', 'poi', 'CHARACTER', 'thought', 'speech']);

    calls.length = 0;
    renderOverlayBatch(mockCtx, batch, 'pills');
    renderOverlayBatch(mockCtx, batch, 'bubbles');
    calls.push('CHARACTER');
    expect(calls).toEqual(['name', 'poi', 'thought', 'speech', 'CHARACTER']);

    expect(DEFAULT_AESTHETIC_SETTINGS.bubblesBehindCharacters).toBe(false);
    expect(clampAestheticSettings({ bubblesBehindCharacters: true }).bubblesBehindCharacters).toBe(true);
  });

  it('keeps stationary location labels fixed when characters overlap them and renders behind characters', () => {
    const collector = createOverlayCollector();
    const calls: string[] = [];
    collector.items.push(
      {
        rect: { id: 'poi:herb', x: 100, y: 100, w: 90, h: 16, anchorX: 145, anchorY: 120, priority: 15 },
        layerOrder: 0,
        layerGroup: 'locations',
        render: () => calls.push('poi'),
      },
      {
        rect: { id: 'name:1', x: 105, y: 102, w: 70, h: 16, anchorX: 140, anchorY: 96, priority: 28 },
        layerOrder: 0,
        layerGroup: 'pills',
        render: () => calls.push('name'),
      },
      {
        rect: { id: 'speech:1', x: 102, y: 98, w: 80, h: 24, anchorX: 142, anchorY: 122, priority: 45 },
        layerOrder: 2,
        layerGroup: 'bubbles',
        render: () => calls.push('speech'),
      },
    );

    const batch = resolveOverlayBatch(collector, true);
    expect(batch.resolved?.get('poi:herb')?.x).toBe(100);
    expect(batch.resolved?.get('poi:herb')?.y).toBe(100);

    const mockCtx = { save() {}, restore() {} } as unknown as CanvasRenderingContext2D;
    renderOverlayBatch(mockCtx, batch, 'locations');
    renderOverlayBatch(mockCtx, batch, 'pills');
    calls.push('CHARACTER');
    renderOverlayBatch(mockCtx, batch, 'bubbles');
    expect(calls).toEqual(['poi', 'name', 'CHARACTER', 'speech']);
  });
});

describe('cached model detection & last-used persistence', () => {
  it('matches cached ONNX artifacts by modelId and dtype without false positives', () => {
    const cachedUrls = [
      'https://huggingface.co/onnx-community/Qwen3.5-0.8B-Text-ONNX/resolve/main/config.json',
      'https://huggingface.co/onnx-community/Qwen3.5-0.8B-Text-ONNX/resolve/main/onnx/model_q4f16.onnx',
      'https://huggingface.co/onnx-community/Qwen3.5-0.8B-Text-ONNX/resolve/main/onnx/model_q4f16.onnx_data',
    ];
    expect(matchesTransformersCacheEntries(cachedUrls, 'onnx-community/Qwen3.5-0.8B-Text-ONNX', 'q4f16')).toBe(true);
    expect(matchesTransformersCacheEntries(cachedUrls, 'onnx-community/Qwen3.5-0.8B-Text-ONNX', 'q4')).toBe(false);
    expect(matchesTransformersCacheEntries(cachedUrls, 'onnx-community/LFM3-1.7B-ONNX', 'q4f16')).toBe(false);
    });

  it('merges overlapping GGUF byte chunk spans accurately', () => {
    const covered = computeCoveredByteSpan([
      [0, 1000],
      [500, 2000],
      [3000, 4500],
    ]);
    expect(covered).toBe(3500);
    });

  it('persists and retrieves last successfully loaded model descriptor when storage exists', () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    clearLastLoadedModel();
    expect(getLastLoadedModel()).toBeNull();
    saveLastLoadedModel({
      brainEngine: 'lfm3-omni',
      modelId: 'LiquidAI/LFM3-Omni-2B-GGUF',
      textDtype: 'q4f16',
      });
    const rec = getLastLoadedModel();
    expect(rec?.brainEngine).toBe('lfm3-omni');
    expect(rec?.modelId).toBe('LiquidAI/LFM3-Omni-2B-GGUF');
    clearLastLoadedModel();
    });
  });
