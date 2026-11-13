import { describe, expect, it } from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { generateProceduralPlayerCustomSprite, resolvePlayerAppearance } from '../../engine/playerSpriteGenerator';
import { resolveOverlappingRects } from '../../engine/renderer';
import { VillageSimulation } from '../../engine/simulation';
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
    const sim = new VillageSimulation(
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
      detectWorldTheme({ tileSetUrl: '/assets/gentle-obj.png', name: 'Oakville' }),
    ).toBe('classic');

    const balkanTokens = resolveAestheticTokens(DEFAULT_AESTHETIC_SETTINGS, 'balkan-myth');
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
});
