import { createBrowserSimulation } from '../../app/browserSimulation';
import { describe, expect, it } from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { seloToolHost } from '../../api/seloToolRegistry';
import { findPath, isTileWalkable } from '../pathfinding';
import {
  applyWangCornerVertices,
  applyWangEdgeMask,
  createVertexMaskFromTileMask,
  paintWangCornerCell,
  paintWangEdgeCell,
  pickNonRepeatingVariant,
  resolveWangCornerIndex,
  resolveWangEdgeIndex,
  solveEdgeColoredWangGrid,
  verifyEdgeColoredWangGrid,
} from '../wangTiling';
import {
  BALKAN_BROOK_VARIANTS,
  BALKAN_DROUGHT_VARIANTS,
  BALKAN_PLAZA_VARIANTS,
  BALKAN_ROAD_H_VARIANTS,
  BALKAN_ROAD_V_VARIANTS,
  BALKAN_TILES,
  BALKAN_WANG_MEADOW_TILES,
} from '../balkanTileset';
import {
  createBalkanMythWorld,
  createBulgarianShevitsaMap,
  exportLevelJson,
  parseImportedVillageJson,
} from '../../storage/villageStore';
import { BALKAN_CHARACTER_SPRITE_IDS, renderBalkanCharacterSheetPixels } from '../balkanSprites';
import { BALKAN_TILESET_COLS, renderBalkanTilesetPixels } from '../balkanTileset';

describe('Worlds and tilesets', () => {
  it('builds a walkable tile map based on the 7 regional Bulgarian Shevitsa embroidery patterns', async () => {
    const shevitsaMap = createBulgarianShevitsaMap();
    expect(shevitsaMap.width).toBe(64);
    expect(shevitsaMap.height).toBe(48);
    expect(shevitsaMap.tileSetUrl).toContain('shevitsa-tileset.png');

    const tags = (shevitsaMap.pointsOfInterest ?? []).map((p) => p.tag);
    expect(tags).toContain('Elbetitsa');
    expect(tags).toContain('TreeOfLife');
    expect(tags).toContain('PirinLabyrinth');
    expect(tags).toContain('RhodopeRosette');
    expect(tags).toContain('ChiprovtsiLoom');
    expect(tags).toContain('DobrudzhaPlains');
    expect(tags).toContain('StrandzhaGate');
    expect(tags).toContain('DanubeFord');

    // Verify all POIs are walkable
    for (const poi of shevitsaMap.pointsOfInterest ?? []) {
      expect(isTileWalkable(shevitsaMap, poi.x, poi.y)).toBe(true);
    }

    // Pathfinding across the regional embroidery hubs
    const elbetitsa = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'Elbetitsa')!;
    const treeOfLife = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'TreeOfLife')!;
    const pirin = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'PirinLabyrinth')!;
    const rhodope = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'RhodopeRosette')!;
    const dobrudzha = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'DobrudzhaPlains')!;
    const chiprovtsi = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'ChiprovtsiLoom')!;
    const danube = shevitsaMap.pointsOfInterest!.find((p) => p.tag === 'DanubeFord')!;

    const pathToTree = findPath(shevitsaMap, elbetitsa, treeOfLife);
    expect(pathToTree.length).toBeGreaterThan(0);

    const pathToPirin = findPath(shevitsaMap, elbetitsa, pirin);
    expect(pathToPirin.length).toBeGreaterThan(0);

    const pathToRhodope = findPath(shevitsaMap, treeOfLife, rhodope);
    expect(pathToRhodope.length).toBeGreaterThan(0);

    const pathToDobrudzha = findPath(shevitsaMap, treeOfLife, dobrudzha);
    expect(pathToDobrudzha.length).toBeGreaterThan(0);

    const pathToChiprovtsi = findPath(shevitsaMap, elbetitsa, chiprovtsi);
    expect(pathToChiprovtsi.length).toBeGreaterThan(0);

    const pathToDanube = findPath(shevitsaMap, chiprovtsi, danube);
    expect(pathToDanube.length).toBeGreaterThan(0);

    // Verify Tile Macro Stamps for the Level Editor
    const stampNames = (shevitsaMap.stamps ?? []).map((s) => s.name);
    expect(stampNames).toContain('Shopluk Elbetitsa (8-Fold Star)');
    expect(stampNames).toContain('Tree of Life & Paired Birds');
    expect(stampNames).toContain('Pirin Stepped Labyrinth (Pink & Blue)');
    expect(stampNames).toContain('Rhodope Sunburst Rosette');
    expect(stampNames).toContain('Chiprovtsi Kilim Diamond Loom');

    // Round-trip level export
    const json = exportLevelJson(shevitsaMap);
    const parsed = parseImportedVillageJson(json);
    expect(parsed.map?.name).toBe(shevitsaMap.name);
    expect(parsed.map?.pointsOfInterest?.length).toBe(shevitsaMap.pointsOfInterest?.length);
    expect(parsed.map?.stamps?.length).toBe(shevitsaMap.stamps?.length);

    // Verify tool execution via seloToolHost with preset: 'shevitsa'
    let toolMap = createDefaultMap();
    let toolVillagers = structuredClone(DEFAULT_VILLAGERS);
    const toolSim = createBrowserSimulation(toolMap, toolVillagers, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
    });
    seloToolHost.setHooks({
      getSimulation: () => toolSim,
      getMap: () => toolMap,
      getVillagers: () => toolVillagers,
      getSettings: () => toolSim.modelSettings,
      applyMap: (next) => {
        toolMap = next;
        toolSim.updateMap(next);
      },
      applyVillagers: (next) => {
        toolVillagers = next;
        toolSim.syncVillagers(next);
      },
      updateSettings: (patch) => {
        toolSim.updateSettings({ ...toolSim.modelSettings, ...patch });
      },
    });
    const toolRes = await seloToolHost.callTool('create_world', { preset: 'shevitsa' });
    expect(toolRes.ok).toBe(true);
    expect(toolRes.map.name).toContain('Шевици');
  });

  it('builds Zmeyovo Balkan Myth Village with scratch-generated embroidered sprites, tileset, walkable well POIs, and Lamia sacrifice lore', async () => {
    const world = createBalkanMythWorld();
    expect(world.map.name).toBe('Zmeyovo: Well of the Lamia');
    expect(world.map.width).toBe(48);
    expect(world.map.height).toBe(36);
    expect(world.map.tileSetUrl).toBe('/assets/balkan-myth-tileset.png');
    expect(world.villagers).toHaveLength(6);

    const tileset = renderBalkanTilesetPixels();
    expect(tileset.width).toBe(512);
    expect(tileset.height).toBe(512);

    // Every tile index placed anywhere on the Balkan map must correspond to painted non-empty pixels in the tileset
    const tileHasOpaquePixels = (tileIndex: number): boolean => {
      const sx = (tileIndex % BALKAN_TILESET_COLS) * 32;
      const sy = Math.floor(tileIndex / BALKAN_TILESET_COLS) * 32;
      for (let py = 0; py < 32; py++) {
        for (let px = 0; px < 32; px++) {
          const alpha = tileset.data[((sy + py) * tileset.width + (sx + px)) * 4 + 3];
          if (alpha > 0) return true;
        }
      }
      return false;
    };

    for (const layer of [...world.map.bgTiles, ...world.map.objectTiles]) {
      for (let x = 0; x < world.map.width; x++) {
        for (let y = 0; y < world.map.height; y++) {
          const idx = layer[x][y];
          if (idx >= 0) {
            expect(tileHasOpaquePixels(idx)).toBe(true);
          }
        }
      }
    }

    // All 6 bespoke character spritesheets must contain distinct 4x4 animated 32x32 frames
    for (const id of BALKAN_CHARACTER_SPRITE_IDS) {
      const sheet = renderBalkanCharacterSheetPixels(id);
      expect(sheet.width).toBe(128);
      expect(sheet.height).toBe(128);
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          let opaque = 0;
          for (let py = 0; py < 32; py++) {
            for (let px = 0; px < 32; px++) {
              if (sheet.data[((row * 32 + py) * 128 + (col * 32 + px)) * 4 + 3] > 200) opaque++;
            }
          }
          expect(opaque).toBeGreaterThan(80);
        }
      }
    }

    // Centerpiece Lamia well shaft blocks movement while South Sacrifice Altar apron & every POI are walkable + connected
    expect(isTileWalkable(world.map, 23, 14)).toBe(false);
    expect(isTileWalkable(world.map, 23, 15)).toBe(true);

    const pois = world.map.pointsOfInterest ?? [];
    expect(pois.map((p) => p.tag)).toEqual(
      expect.arrayContaining([
        'LamiaWell',
        'KhoroStar',
        'KukeriHearth',
        'BabaHerbhouse',
        'WeaverCardak',
        'YunakBridge',
        'SamodivaSpring',
      ]),
    );
    const wellPoi = pois.find((p) => p.tag === 'LamiaWell')!;
    for (const poi of pois) {
      expect(isTileWalkable(world.map, poi.x, poi.y)).toBe(true);
      if (poi.tag !== 'LamiaWell') {
        expect(findPath(world.map, wellPoi, poi).length).toBeGreaterThan(0);
      }
    }

    // Verify every villager spawns on a walkable tile and Story-Sim agent tooling loads preset: 'balkan-myth'
    for (const v of world.villagers) {
      expect(isTileWalkable(world.map, v.homeTile.x, v.homeTile.y)).toBe(true);
      expect(v.customSprite?.textureUrl).toContain(`/assets/spritesheets/balkan/${v.id}.png`);
    }

    let appliedMap = createDefaultMap();
    let appliedVillagers = structuredClone(DEFAULT_VILLAGERS);
    const sim = createBrowserSimulation(appliedMap, appliedVillagers, [], {
      ...DEFAULT_MODEL_SETTINGS,
      inferenceMode: 'story-sim',
    });
    seloToolHost.setHooks({
      getSimulation: () => sim,
      getMap: () => appliedMap,
      getVillagers: () => appliedVillagers,
      getSettings: () => sim.modelSettings,
      getTab: () => 'village',
      setTab: () => {},
      applyMap: (next) => {
        appliedMap = next;
        sim.updateMap(next);
      },
      applyVillagers: (next) => {
        appliedVillagers = next;
        sim.syncVillagers(next);
      },
      updateSettings: (patch) => {
        sim.updateSettings({ ...sim.modelSettings, ...patch });
      },
    });

    const loadRes = await seloToolHost.callTool('create_world', {
      preset: 'balkan-myth',
      clearDatabase: true,
    });
    expect(loadRes.ok).toBe(true);
    expect(loadRes.preset).toBe('balkan-myth');
    expect(appliedVillagers.map((v) => v.id)).toContain('lamia');

    // Run a dialogue with Lamia Zmeitsa at the well under Story-Sim mode
    await sim.sendUserAddressedMessage(
      'lamia',
      'We brought silver obols and honeycomb to #LamiaWell. Will you release the water?',
      false,
    );
    const conv = sim.conversations[0];
    expect(conv).toBeDefined();
    expect(conv.messages.some((m) => m.senderName === 'Lamia Zmeitsa')).toBe(true);
    const lamiaLine = conv.messages.find((m) => m.senderName === 'Lamia Zmeitsa')!.text.toLowerCase();
    expect(/well|tribute|obols|water|zmeyovo|spring|coil/.test(lamiaLine)).toBe(true);
  });

  it('solves 4-Edge & 4-Corner Wang tiling seamlessly and wires rows 12..15 into Balkan Myth tileset + map', () => {
    expect(resolveWangEdgeIndex(true, false, true, false)).toBe(5);
    expect(resolveWangCornerIndex(false, true, true, false)).toBe(6);

    // Paint 4-edge road strip & verify neighbor propagation
    const roadGrid = Array.from({ length: 5 }, () => Array(5).fill(BALKAN_TILES.GRASS_MEADOW));
    const mask = Array.from({ length: 5 }, () => Array(5).fill(false));
    mask[1][2] = true;
    mask[2][2] = true;
    mask[3][2] = true;
    applyWangEdgeMask(roadGrid, mask, BALKAN_TILES.WANG_ROAD_BASE, 5, 5);
    expect(roadGrid[1][2]).toBe(BALKAN_TILES.WANG_ROAD_BASE + 2); // E only
    expect(roadGrid[2][2]).toBe(BALKAN_TILES.WANG_ROAD_BASE + 10); // E + W
    expect(roadGrid[3][2]).toBe(BALKAN_TILES.WANG_ROAD_BASE + 8); // W only

    // Extend turn interactively upward from (2,2) -> (2,1)
    paintWangEdgeCell(roadGrid, 2, 1, true, BALKAN_TILES.WANG_ROAD_BASE, BALKAN_TILES.GRASS_MEADOW);
    expect(roadGrid[2][2]).toBe(BALKAN_TILES.WANG_ROAD_BASE + 11); // N + E + W tee!
    expect(roadGrid[2][1]).toBe(BALKAN_TILES.WANG_ROAD_BASE + 4); // S only end cap

    // Paint 4-corner terrain cell and verify surrounding shared vertices
    const cornerGrid = Array.from({ length: 5 }, () => Array(5).fill(BALKAN_TILES.GRASS_MEADOW));
    const tileMask = Array.from({ length: 5 }, () => Array(5).fill(false));
    tileMask[2][2] = true;
    applyWangCornerVertices(
      cornerGrid,
      createVertexMaskFromTileMask(tileMask, 5, 5),
      BALKAN_TILES.WANG_DROUGHT_BASE,
      5,
      5,
    );
    expect(cornerGrid[2][2]).toBe(BALKAN_TILES.WANG_DROUGHT_BASE + 15);
    expect(cornerGrid[1][2]).toBe(BALKAN_TILES.WANG_DROUGHT_BASE + 6); // NE + SE
    paintWangCornerCell(
      cornerGrid,
      2,
      2,
      false,
      BALKAN_TILES.WANG_DROUGHT_BASE,
      BALKAN_TILES.GRASS_MEADOW,
    );
    expect(cornerGrid[2][2]).toBe(BALKAN_TILES.GRASS_MEADOW);

    // Check regenerated Balkan Myth tileset rows 12..15 & Wang usage on Balkan map
    const buf = renderBalkanTilesetPixels();
    for (let row = 12; row <= 15; row++) {
      for (let col = 0; col < 16; col++) {
        let opaqueCount = 0;
        for (let py = 0; py < 32; py++) {
          for (let px = 0; px < 32; px++) {
            if (buf.data[((row * 32 + py) * buf.width + (col * 32 + px)) * 4 + 3] > 0) {
              opaqueCount++;
            }
          }
        }
        expect(opaqueCount).toBeGreaterThan(20);
      }
    }

    const balkan = createBalkanMythWorld();
    const flatBg = balkan.map.bgTiles[0].flat();
    const flatObj = balkan.map.objectTiles[0].flat();
    expect(flatBg.some((t) => t >= BALKAN_TILES.WANG_ROAD_BASE && t < BALKAN_TILES.WANG_ROAD_BASE + 16)).toBe(true);
    expect(flatBg.some((t) => t >= BALKAN_TILES.WANG_DROUGHT_BASE && t < BALKAN_TILES.WANG_DROUGHT_BASE + 16)).toBe(true);
    expect(flatBg.some((t) => t >= BALKAN_TILES.WANG_BROOK_BASE && t < BALKAN_TILES.WANG_BROOK_BASE + 16)).toBe(true);
    expect(flatObj.some((t) => t >= BALKAN_TILES.WANG_WALL_BASE && t < BALKAN_TILES.WANG_WALL_BASE + 16)).toBe(true);
  });

  it('solves non-repeating Edge-Colored Wang needlework meadows with valid seams and road/brook/plaza variants', () => {
    const solved = solveEdgeColoredWangGrid(16, 12, BALKAN_WANG_MEADOW_TILES, {
      seed: 2026,
      pinEdge: (x, y, dir) => {
        if (x === 0 && dir === 'west') return 0;
        if (x === 15 && dir === 'east') return 0;
        if (y === 0 && dir === 'north') return 0;
        if (y === 11 && dir === 'south') return 0;
        return undefined;
      },
    });
    expect(verifyEdgeColoredWangGrid(solved, BALKAN_WANG_MEADOW_TILES)).toEqual({
      valid: true,
      mismatches: 0,
    });
    const usedMeadowIds = new Set(solved.flat());
    expect(usedMeadowIds.size).toBeGreaterThanOrEqual(14);

    // pickNonRepeatingVariant avoids consecutive repeats along straight runners
    const lineGrid = Array.from({ length: 10 }, () => [-1]);
    for (let x = 0; x < 10; x++) {
      lineGrid[x][0] = pickNonRepeatingVariant(lineGrid, BALKAN_ROAD_H_VARIANTS, x, 0, 131);
      if (x > 0) {
        expect(lineGrid[x][0]).not.toBe(lineGrid[x - 1][0]);
      }
    }

    // Verify rendered needlework Wang meadow tiles have 100% opaque 32x32 stitch pixels and seamless border parity
    const buf = renderBalkanTilesetPixels();
    for (const def of BALKAN_WANG_MEADOW_TILES) {
      const ox = (def.tileId % BALKAN_TILESET_COLS) * 32;
      const oy = Math.floor(def.tileId / BALKAN_TILESET_COLS) * 32;
      for (let py = 0; py < 32; py++) {
        for (let px = 0; px < 32; px++) {
          expect(buf.data[((oy + py) * buf.width + (ox + px)) * 4 + 3]).toBe(255);
        }
      }
    }

    // Verify generated Balkan Myth map obeys Wang Edge-Colored meadow contracts & non-repeating interior variants
    const balkan = createBalkanMythWorld();
    const bg0 = balkan.map.bgTiles[0];
    expect(verifyEdgeColoredWangGrid(bg0, BALKAN_WANG_MEADOW_TILES)).toEqual({
      valid: true,
      mismatches: 0,
    });

    const meadowIds = new Set(BALKAN_WANG_MEADOW_TILES.map((t) => t.tileId));
    const mapMeadowUsed = new Set(bg0.flat().filter((t) => meadowIds.has(t)));
    expect(mapMeadowUsed.size).toBeGreaterThanOrEqual(16);

    const flatBg = bg0.flat();
    expect(new Set(flatBg.filter((t) => BALKAN_ROAD_H_VARIANTS.includes(t as never))).size).toBeGreaterThanOrEqual(3);
    expect(new Set(flatBg.filter((t) => BALKAN_ROAD_V_VARIANTS.includes(t as never))).size).toBeGreaterThanOrEqual(3);
    expect(new Set(flatBg.filter((t) => BALKAN_BROOK_VARIANTS.includes(t as never))).size).toBeGreaterThanOrEqual(3);
    expect(new Set(flatBg.filter((t) => BALKAN_DROUGHT_VARIANTS.includes(t as never))).size).toBeGreaterThanOrEqual(3);
    expect(new Set(flatBg.filter((t) => BALKAN_PLAZA_VARIANTS.includes(t as never))).size).toBeGreaterThanOrEqual(3);
  });
});
