import { BALKAN_CHARACTER_SPRITE_IDS, getBalkanCustomSpriteSpec } from '../engine/balkanSprites.ts';
import {
  BALKAN_TILES,
  BALKAN_TILE_DIM,
  BALKAN_TILESET_HEIGHT,
  BALKAN_TILESET_WIDTH,
  tileIdx,
} from '../engine/balkanTileset.ts';
import {
  applyWangCornerVertices,
  applyWangEdgeMask,
  createVertexMaskFromTileMask,
} from '../engine/wangTiling.ts';
import type {
  PointOfInterest,
  TileGrid,
  TileMacroStamp,
  VillageMap,
  VillagerConfig,
} from '../engine/types.ts';

export const BALKAN_MYTH_TILESET_URL = '/assets/balkan-myth-tileset.png';

export const BALKAN_MYTH_OPENING_DIRECTIVE =
  'Drought grips Zmeyovo: the central stone well stands choked under Lamia Zmeitsa’s emerald coils, and she demands a sacrifice before releasing the water. Gather near #LamiaWell, debate at #KhoroStar, or seek pure spring water at #SamodivaSpring.';

function createEmptyGrid(width: number, height: number, fill = -1): TileGrid {
  return Array.from({ length: width }, () => Array.from({ length: height }, () => fill));
}

function createCollisionGrid(width: number, height: number, fill = false): boolean[][] {
  return Array.from({ length: width }, () => Array.from({ length: height }, () => fill));
}

function setGridCell(grid: TileGrid, x: number, y: number, tile: number): void {
  if (x >= 0 && x < grid.length && y >= 0 && y < grid[0].length) {
    grid[x][y] = tile;
  }
}

function setBlockedCell(colGrid: boolean[][], x: number, y: number, blocked: boolean): void {
  if (x >= 0 && x < colGrid.length && y >= 0 && y < colGrid[0].length) {
    colGrid[x][y] = blocked;
  }
}

interface StampOrigin {
  col: number;
  row: number;
  w: number;
  h: number;
}

function makeMacroTiles(origin: StampOrigin): number[] {
  const tiles: number[] = [];
  for (let dy = 0; dy < origin.h; dy++) {
    for (let dx = 0; dx < origin.w; dx++) {
      tiles.push(tileIdx(origin.col + dx, origin.row + dy));
    }
  }
  return tiles;
}

function stampRegionOnMap(
  grid: TileGrid,
  colGrid: boolean[][],
  mapX: number,
  mapY: number,
  origin: StampOrigin,
  blocked: boolean | ((dx: number, dy: number) => boolean) = false,
): void {
  for (let dy = 0; dy < origin.h; dy++) {
    for (let dx = 0; dx < origin.w; dx++) {
      const gx = mapX + dx;
      const gy = mapY + dy;
      setGridCell(grid, gx, gy, tileIdx(origin.col + dx, origin.row + dy));
      const isCellBlocked = typeof blocked === 'function' ? blocked(dx, dy) : blocked;
      if (isCellBlocked) {
        setBlockedCell(colGrid, gx, gy, true);
      }
    }
  }
}

function createBalkanStamps(): TileMacroStamp[] {
  const buildStamp = (
    id: string,
    name: string,
    origin: StampOrigin,
    layer: TileMacroStamp['layer'],
    blocksMovement: boolean,
  ): TileMacroStamp => ({
    id,
    name,
    width: origin.w,
    height: origin.h,
    tiles: makeMacroTiles(origin),
    layer,
    blocksMovement,
  });

  return [
    buildStamp('balkan-lamia-well', 'Well of the Lamia (3x3)', BALKAN_TILES.LAMIA_WELL_ORIGIN, 'obj0', true),
    buildStamp('balkan-elbetitsa', 'Elbetitsa Khoro Star (4x4)', BALKAN_TILES.ELBETITSA_ORIGIN, 'bg1', false),
    buildStamp('balkan-tree-life', 'Tree of Life Carpet (3x3)', BALKAN_TILES.TREE_OF_LIFE_ORIGIN, 'bg1', false),
    buildStamp('balkan-samodiva-glade', 'Pirin Samodiva Glade (3x3)', BALKAN_TILES.SAMODIVA_GLADE_ORIGIN, 'bg1', false),
    buildStamp('balkan-kukeri-hearth', 'Kukeri Fire Hearth (3x3)', BALKAN_TILES.KUKERI_HEARTH_ORIGIN, 'bg1', false),
    buildStamp('balkan-revival-house', 'Revival Timber House (3x3)', BALKAN_TILES.REVIVAL_HOUSE_ORIGIN, 'obj0', true),
    buildStamp('balkan-herb-house', 'Znaharka Herb House (3x3)', BALKAN_TILES.HERB_HOUSE_ORIGIN, 'obj0', true),
    buildStamp('balkan-forge-cardak', 'Yunak Forge & Cardak (3x3)', BALKAN_TILES.FORGE_CARDAK_ORIGIN, 'obj0', true),
    buildStamp('balkan-martenitsa-oak', 'Martenitsa Sacred Oak (2x2)', BALKAN_TILES.MARTENITSA_OAK_ORIGIN, 'obj0', true),
    buildStamp('balkan-spring-pool', 'Samodiva Spring Pool (2x2)', BALKAN_TILES.SPRING_POOL_ORIGIN, 'obj0', true),
    buildStamp('balkan-rosette', 'Rhodope Rosette Carpet (2x2)', BALKAN_TILES.RHODOPE_ROSETTE_ORIGIN, 'bg1', false),
    buildStamp('balkan-wheat', 'Golden Wheat Field (2x2)', BALKAN_TILES.GOLDEN_WHEAT_ORIGIN, 'bg1', false),
  ];
}

export function createBalkanMythMap(width = 48, height = 36): VillageMap {
  const safeW = Math.max(48, Math.min(80, width));
  const safeH = Math.max(36, Math.min(64, height));

  const bg0 = createEmptyGrid(safeW, safeH, BALKAN_TILES.GRASS_MEADOW);
  const bg1 = createEmptyGrid(safeW, safeH, -1);
  const obj0 = createEmptyGrid(safeW, safeH, -1);
  const obj1 = createEmptyGrid(safeW, safeH, -1);
  const collisionGrid = createCollisionGrid(safeW, safeH, false);

  // 1. Woven Balkan meadow floor (wildflowers in west, clover near spring, scorched clay in center)
  for (let x = 0; x < safeW; x++) {
    for (let y = 0; y < safeH; y++) {
      const n = (x * 13 + y * 29 + x * y) % 19;
      if (x < 12 && y < 14) {
        bg0[x][y] = n < 6 ? BALKAN_TILES.GRASS_WILDFLOWER : BALKAN_TILES.GRASS_CLOVER;
      } else if (n === 0 || n === 5) {
        bg0[x][y] = BALKAN_TILES.GRASS_WILDFLOWER;
      } else if (n === 2 || n === 11) {
        bg0[x][y] = BALKAN_TILES.GRASS_CLOVER;
      }
    }
  }

  // 2. Central Drought Hollow around #LamiaWell painted via 4-Corner Wang autotiling
  const droughtMask = Array.from({ length: safeW }, () => Array(safeH).fill(false));
  for (let x = 17; x <= 30; x++) {
    for (let y = 9; y <= 20; y++) {
      const dx = (x - 23.5) / 5.4;
      const dy = (y - 14.5) / 4.2;
      if (dx * dx + dy * dy <= 0.92) {
        droughtMask[x][y] = true;
      }
    }
  }
  const droughtVertices = createVertexMaskFromTileMask(droughtMask, safeW, safeH);
  applyWangCornerVertices(bg0, droughtVertices, BALKAN_TILES.WANG_DROUGHT_BASE, safeW, safeH);
  for (let x = 20; x <= 27; x++) {
    for (let y = 12; y <= 17; y++) {
      const dx = (x - 23.5) / 3.3;
      const dy = (y - 14.5) / 2.4;
      if (dx * dx + dy * dy <= 0.78) {
        setGridCell(bg0, x, y, BALKAN_TILES.SCORCHED_COBBLE);
      }
    }
  }

  // 3. Winding Samodiva Brook painted via 4-Corner 3/4 Oblique Wang autotiling
  const brookMask = Array.from({ length: safeW }, () => Array(safeH).fill(false));
  for (let y = 0; y < safeH; y++) {
    // Anchor gently at bridge latitudes (y = 10 & y = 23) so oak bridges span x = 13..14 squarely
    const pinch10 = 1 - Math.exp(-((y - 10) * (y - 10)) / 9);
    const pinch23 = 1 - Math.exp(-((y - 23) * (y - 23)) / 9);
    const shift = Math.sin(y * 0.24) * 1.45 * pinch10 * pinch23;
    const cx = 13.5 + shift;
    const xLeft = Math.floor(cx);
    const xRight = Math.ceil(cx + 0.35);
    for (let x = Math.max(11, xLeft); x <= Math.min(16, xRight); x++) {
      brookMask[x][y] = true;
    }
  }
  const brookVertices = createVertexMaskFromTileMask(brookMask, safeW, safeH);
  applyWangCornerVertices(bg0, brookVertices, BALKAN_TILES.WANG_BROOK_BASE, safeW, safeH);
  for (let x = 11; x <= 17; x++) {
    for (let y = 0; y < safeH; y++) {
      if (
        bg0[x]?.[y] >= BALKAN_TILES.WANG_BROOK_BASE &&
        bg0[x]?.[y] < BALKAN_TILES.WANG_BROOK_BASE + 16
      ) {
        setBlockedCell(collisionGrid, x, y, true);
      }
    }
  }

  // Stone plaza apron under central Khoro square (cleanly framing 4x4 Elbetitsa)
  for (let x = 20; x <= 25; x++) {
    for (let y = 20; y <= 25; y++) {
      setGridCell(bg0, x, y, BALKAN_TILES.PLAZA_LINEN_STONE);
    }
  }

  // 4. Connected Embroidered Khoro Roads via 4-Edge Wang autotiling + Oak Plank Bridges
  const roadMask = Array.from({ length: safeW }, () => Array(safeH).fill(false));
  const layH = (y: number, xStart: number, xEnd: number) => {
    for (let x = Math.min(xStart, xEnd); x <= Math.max(xStart, xEnd); x++) {
      if (x >= 0 && x < safeW && y >= 0 && y < safeH) {
        roadMask[x][y] = true;
        setBlockedCell(collisionGrid, x, y, false);
      }
    }
  };
  const layV = (x: number, yStart: number, yEnd: number) => {
    for (let y = Math.min(yStart, yEnd); y <= Math.max(yStart, yEnd); y++) {
      if (x >= 0 && x < safeW && y >= 0 && y < safeH) {
        roadMask[x][y] = true;
        setBlockedCell(collisionGrid, x, y, false);
      }
    }
  };

  // East-West Khoro Grand Lane (y = 23) from Herb House across Yunak Bridge & Khoro Plaza to Kukeri Hearth
  layH(23, 8, 34);
  // North-South Central Processional Avenue (x = 23) from Upper Lane to #LamiaWell altar & top of Khoro Plaza
  layV(23, 16, 21);
  // House doorway spurs -> Baba Herb House (8, 20..22) & Weaver Cardak (35, 9..10)
  layV(8, 20, 22);
  layV(35, 9, 10);
  // Upper East-West Village Ridge Road (y = 10) connecting Samodiva Glade edge -> Well North -> Weaver Cardak
  layH(10, 10, 35);
  // East Connector North-South Lane (x = 34) connecting Weaver Cardak (y = 10) down to Kukeri Hearth (y = 23)
  layV(34, 10, 23);
  // Apply 4-edge Wang auto-tiling for seamless turns, tees, dead ends & crossings
  applyWangEdgeMask(bg0, roadMask, BALKAN_TILES.WANG_ROAD_BASE, safeW, safeH);

  // Two horizontal Oak Plank Bridges over Samodiva Brook (y = 23 & y = 10) kept cleanly above Wang stream tiles
  for (const bridgeY of [10, 23]) {
    for (const bx of [12, 13, 14, 15]) {
      setGridCell(bg0, bx, bridgeY, BALKAN_TILES.BRIDGE_OAK_H);
      setBlockedCell(collisionGrid, bx, bridgeY, false);
    }
  }

  // 5. Folk Embroidery Motifs on bg1 (walkable woven plazas & glades)
  // Grand 4x4 Elbetitsa Star in Plaza (x = 21..24, y = 21..24)
  stampRegionOnMap(bg1, collisionGrid, 21, 21, BALKAN_TILES.ELBETITSA_ORIGIN, false);

  // 3x3 Samodiva Pirin Rose & Periwinkle Glade (x = 7..9, y = 8..10)
  stampRegionOnMap(bg1, collisionGrid, 7, 8, BALKAN_TILES.SAMODIVA_GLADE_ORIGIN, false);

  // 3x3 Weaver Tree of Life Courtyard (x = 34..36, y = 11..13)
  stampRegionOnMap(bg1, collisionGrid, 34, 11, BALKAN_TILES.TREE_OF_LIFE_ORIGIN, false);

  // 2x2 Rhodope Rosette beside Baba Herb House (x = 10..11, y = 21..22)
  stampRegionOnMap(bg1, collisionGrid, 10, 21, BALKAN_TILES.RHODOPE_ROSETTE_ORIGIN, false);

  // 2x2 Golden Wheat Harvest Patch near East Valley (x = 39..40, y = 8..9)
  stampRegionOnMap(bg1, collisionGrid, 39, 8, BALKAN_TILES.GOLDEN_WHEAT_ORIGIN, false);

  // 6. Structures, Sacred Well, Trees & Folklore Props
  // CENTERPIECE: 3x3 Cursed Well of the Lamia at (22, 13) -> rows 13..14 block, row 15 altar stays walkable!
  for (let dx = 0; dx < 3; dx++) {
    setGridCell(obj0, 22 + dx, 13, tileIdx(BALKAN_TILES.LAMIA_WELL_ORIGIN.col + dx, BALKAN_TILES.LAMIA_WELL_ORIGIN.row));
    setBlockedCell(collisionGrid, 22 + dx, 13, true);
    setGridCell(obj0, 22 + dx, 14, tileIdx(BALKAN_TILES.LAMIA_WELL_ORIGIN.col + dx, BALKAN_TILES.LAMIA_WELL_ORIGIN.row + 1));
    setBlockedCell(collisionGrid, 22 + dx, 14, true);
    // South Sacrifice Altar apron on bg1 so villagers step directly onto the stone offering slab!
    setGridCell(bg1, 22 + dx, 15, tileIdx(BALKAN_TILES.LAMIA_WELL_ORIGIN.col + dx, BALKAN_TILES.LAMIA_WELL_ORIGIN.row + 2));
    setBlockedCell(collisionGrid, 22 + dx, 15, false);
  }
  // Offerings, empty clay jugs, Edict Noticeboard & Braziers framing #LamiaWell
  setGridCell(obj0, 21, 15, BALKAN_TILES.SACRIFICE_OFFERING);
  setBlockedCell(collisionGrid, 21, 15, true);
  setGridCell(obj0, 25, 15, BALKAN_TILES.BROKEN_AMPHORAE);
  setBlockedCell(collisionGrid, 25, 15, true);
  setGridCell(obj0, 21, 12, BALKAN_TILES.DRY_PITCHERS_SMALL);
  setBlockedCell(collisionGrid, 21, 12, true);
  setGridCell(obj0, 25, 12, BALKAN_TILES.VILLAGE_EDICT_BOARD);
  setBlockedCell(collisionGrid, 25, 12, true);
  setGridCell(obj0, 20, 14, BALKAN_TILES.BRAZIER_POST);
  setBlockedCell(collisionGrid, 20, 14, true);
  setGridCell(obj0, 26, 14, BALKAN_TILES.BRAZIER_POST);
  setBlockedCell(collisionGrid, 26, 14, true);

  // Enchanted Samodiva Spring Pool (2x2 at x = 4..5, y = 7..8) + Silver Birches
  stampRegionOnMap(obj0, collisionGrid, 4, 7, BALKAN_TILES.SPRING_POOL_ORIGIN, true);
  stampRegionOnMap(obj0, collisionGrid, 3, 5, BALKAN_TILES.SAMODIVA_BIRCH_ORIGIN, (_dx, dy) => dy === 1);
  stampRegionOnMap(obj0, collisionGrid, 10, 5, BALKAN_TILES.SAMODIVA_BIRCH_ORIGIN, (_dx, dy) => dy === 1);

  // Baba Rada's Znaharka Herb House (3x3 at x = 7..9, y = 17..19) + Geranium & Votive Cross
  stampRegionOnMap(obj0, collisionGrid, 7, 17, BALKAN_TILES.HERB_HOUSE_ORIGIN, (_dx, dy) => dy >= 1);
  setGridCell(bg1, 8, 20, BALKAN_TILES.CHIPROVTSI_RUG);
  setGridCell(obj0, 6, 19, BALKAN_TILES.POPPY_BUSH);
  setBlockedCell(collisionGrid, 6, 19, true);
  setGridCell(obj0, 10, 19, BALKAN_TILES.SUNFLOWERS);
  setBlockedCell(collisionGrid, 10, 19, true);
  setGridCell(obj0, 11, 20, BALKAN_TILES.OBROK_CROSS);
  setBlockedCell(collisionGrid, 11, 20, true);

  // Tsveta's Revival Timber House & Cardak (3x3 at x = 34..36, y = 5..7) + Upright Loom
  stampRegionOnMap(obj0, collisionGrid, 34, 5, BALKAN_TILES.REVIVAL_HOUSE_ORIGIN, (_dx, dy) => dy >= 1);
  setGridCell(bg1, 35, 8, BALKAN_TILES.CHIPROVTSI_RUG);
  setGridCell(obj0, 38, 11, BALKAN_TILES.UPRIGHT_LOOM);
  setBlockedCell(collisionGrid, 38, 11, true);
  setGridCell(obj0, 33, 8, BALKAN_TILES.GERANIUM_BOX);
  setBlockedCell(collisionGrid, 33, 8, true);

  // Stoyan's Forge & Cardak (3x3 at x = 35..37, y = 16..18) + Anvil & Barrel
  stampRegionOnMap(obj0, collisionGrid, 35, 16, BALKAN_TILES.FORGE_CARDAK_ORIGIN, (_dx, dy) => dy >= 1);
  setGridCell(obj0, 34, 19, BALKAN_TILES.BLACKSMITH_ANVIL);
  setBlockedCell(collisionGrid, 34, 19, true);
  setGridCell(obj0, 38, 19, BALKAN_TILES.WINE_BARREL);
  setBlockedCell(collisionGrid, 38, 19, true);

  // Kukeri Fire Hearth Ring (3x3 at x = 35..37, y = 21..23): center tile (36, 22) blocks, perimeter 8 tiles walkable!
  stampRegionOnMap(
    bg1,
    collisionGrid,
    35,
    21,
    BALKAN_TILES.KUKERI_HEARTH_ORIGIN,
    (dx, dy) => dx === 1 && dy === 1,
  );
  setGridCell(obj0, 39, 23, BALKAN_TILES.BRAZIER_POST);
  setBlockedCell(collisionGrid, 39, 23, true);

  // Ancient Martenitsa Sacred Oaks (2x2) & Village Benches around Plaza / Well
  stampRegionOnMap(obj0, collisionGrid, 28, 6, BALKAN_TILES.MARTENITSA_OAK_ORIGIN, (_dx, dy) => dy === 1);
  stampRegionOnMap(obj0, collisionGrid, 16, 26, BALKAN_TILES.MARTENITSA_OAK_ORIGIN, (_dx, dy) => dy === 1);
  setGridCell(obj0, 20, 21, BALKAN_TILES.OAK_BENCH);
  setBlockedCell(collisionGrid, 20, 21, true);
  setGridCell(obj0, 25, 21, BALKAN_TILES.OAK_BENCH);
  setBlockedCell(collisionGrid, 25, 21, true);
  setGridCell(obj0, 20, 25, BALKAN_TILES.OBROK_CROSS);
  setBlockedCell(collisionGrid, 20, 25, true);
  setGridCell(obj0, 25, 25, BALKAN_TILES.SUNFLOWERS);
  setBlockedCell(collisionGrid, 25, 25, true);
  setGridCell(obj0, 7, 24, BALKAN_TILES.POPPY_BUSH);
  setBlockedCell(collisionGrid, 7, 24, true);
  setGridCell(obj0, 9, 24, BALKAN_TILES.SUNFLOWERS);
  setBlockedCell(collisionGrid, 9, 24, true);

  // Balkan Pine Forest Valley Border (keeps outer rim framed naturally with open passable lanes)
  const pineCoords: Array<[number, number]> = [
    [2, 2], [6, 2], [11, 2], [18, 2], [24, 2], [30, 2], [39, 2], [43, 3],
    [2, 13], [4, 29], [9, 30], [19, 31], [29, 30], [38, 30], [43, 25], [44, 14],
  ];
  for (const [px, py] of pineCoords) {
    stampRegionOnMap(obj0, collisionGrid, px, py, BALKAN_TILES.BALKAN_PINE_ORIGIN, (_dx, dy) => dy === 1);
  }

  // Carved 3/4 Stone & Terracotta Courtyard Walls painted via 4-Edge Wang tiling
  const wallMask = createCollisionGrid(safeW, safeH, false);
  // L-shaped herb-garden low wall south & west of Baba Rada's garden (leaving wide Khoro gate)
  for (let wx = 5; wx <= 11; wx++) {
    wallMask[wx][26] = true;
  }
  wallMask[5][25] = true;
  wallMask[5][24] = true;
  // Protective shrine enclosure along south & east of Dobrudzha Golden Wheat field
  for (let wx = 38; wx <= 42; wx++) {
    wallMask[wx][11] = true;
  }
  wallMask[42][8] = true;
  wallMask[42][9] = true;
  wallMask[42][10] = true;
  const wallLayer = createEmptyGrid(safeW, safeH, -1);
  applyWangEdgeMask(wallLayer, wallMask, BALKAN_TILES.WANG_WALL_BASE, safeW, safeH);
  for (let wx = 0; wx < safeW; wx++) {
    for (let wy = 0; wy < safeH; wy++) {
      if (wallLayer[wx][wy] >= 0) {
        setGridCell(obj0, wx, wy, wallLayer[wx][wy]);
        setBlockedCell(collisionGrid, wx, wy, true);
      }
    }
  }

  // 7. Guaranteed Open Khoro Spawn & POI Walkability Verification Guards
  const pointsOfInterest: PointOfInterest[] = [
    {
      id: 'poi-balkan-well',
      tag: 'LamiaWell',
      label: 'Well of the Lamia',
      x: 23,
      y: 16,
      description: 'Octagonal drought-parched stone well bound under Lamia Zmeitsa’s emerald coils, fronted by the offering altar.',
    },
    {
      id: 'poi-balkan-khoro',
      tag: 'KhoroStar',
      label: 'Elbetitsa Khoro Square',
      x: 23,
      y: 23,
      description: 'Central embroidered 8-fold Elbetitsa star plaza where villagers assemble before confronting the well spirit.',
    },
    {
      id: 'poi-balkan-hearth',
      tag: 'KukeriHearth',
      label: 'Kukeri Fire Hearth',
      x: 34,
      y: 23,
      description: 'Smoldering bronze-bell fire ring beside Stoyan’s smithy where Kuker Marin readies his winter mask.',
    },
    {
      id: 'poi-balkan-herbs',
      tag: 'BabaHerbhouse',
      label: 'Znaharka Herb House',
      x: 8,
      y: 23,
      description: 'Baba Rada’s herb-draped cottage piled with yarrow, basil, and Rhodope offering aprons.',
    },
    {
      id: 'poi-balkan-cardak',
      tag: 'WeaverCardak',
      label: 'Tree-of-Life Weaver Cardak',
      x: 35,
      y: 11,
      description: 'Tsveta’s upland Revival house and courtyard tapestry where Zmeyovo’s balance of threads is woven.',
    },
    {
      id: 'poi-balkan-bridge',
      tag: 'YunakBridge',
      label: 'Yunak Oak Bridge',
      x: 15,
      y: 23,
      description: 'Carved timber bridge spanning the Samodiva brook between Baba Rada’s glade and Khoro Square.',
    },
    {
      id: 'poi-balkan-spring',
      tag: 'SamodivaSpring',
      label: 'Samodiva Pure Spring',
      x: 8,
      y: 10,
      description: 'Hidden silver-birch glade woven in Pirin pink and periwinkle around the last uncursed spring pool.',
    },
  ];

  for (const poi of pointsOfInterest) {
    setBlockedCell(collisionGrid, poi.x, poi.y, false);
  }

  return {
    name: 'Zmeyovo: Well of the Lamia',
    tileDim: BALKAN_TILE_DIM,
    width: safeW,
    height: safeH,
    tileSetUrl: BALKAN_MYTH_TILESET_URL,
    tileSetDimX: BALKAN_TILESET_WIDTH,
    tileSetDimY: BALKAN_TILESET_HEIGHT,
    bgTiles: [bg0, bg1],
    objectTiles: [obj0, obj1],
    collisionGrid,
    animatedSprites: [],
    spawnPoints: [
      { id: 'sp-khoro', label: 'Elbetitsa Khoro Plaza', x: 23, y: 23 },
      { id: 'sp-well', label: 'Altar of the Lamia', x: 23, y: 16 },
      { id: 'sp-spring', label: 'Samodiva Glade', x: 8, y: 10 },
      { id: 'sp-herbs', label: 'Znaharka Porch', x: 8, y: 23 },
      { id: 'sp-hearth', label: 'Kukeri Forge Ring', x: 34, y: 23 },
    ],
    pointsOfInterest,
    stamps: createBalkanStamps(),
  };
}

export function createBalkanMythVillagers(): VillagerConfig[] {
  const spriteMap = Object.fromEntries(
    BALKAN_CHARACTER_SPRITE_IDS.map((id) => [id, getBalkanCustomSpriteSpec(id)]),
  ) as Record<(typeof BALKAN_CHARACTER_SPRITE_IDS)[number], ReturnType<typeof getBalkanCustomSpriteSpec>>;

  return [
    {
      id: 'lamia',
      name: 'Lamia Zmeitsa',
      role: 'Serpent Keeper of the Well',
      accentColor: '#2e8b57',
      spritesheetId: 'folk-1',
      customSprite: spriteMap.lamia,
      identity:
        'Ancient serpentine Lamia coiled around #LamiaWell in Zmeyovo. You locked the limestone springs until the village brings rightful sacrifice—golden wheat, raw honey, silver obols, or an oath kept true. Speak with icy pride and ancient hunger.',
      plan: 'Coiled beside #LamiaWell altar demanding tribute before releasing a single drop of water.',
      voiceStyle: 'sibilant, resonant, ancient dragon-spirit',
      voice: {
        gender: 'female',
        language: 'American English',
        pitchSemitones: -3,
        speakingRate: 0.92,
        warmthDb: 3,
      },
      homeTile: { x: 24, y: 16 },
      speed: 1.55,
    },
    {
      id: 'baba-rada',
      name: 'Baba Rada',
      role: 'Znaharka Herb-Keeper',
      accentColor: '#b81f28',
      spritesheetId: 'folk-2',
      customSprite: spriteMap['baba-rada'],
      identity:
        'Elder Balkan herbalist and omen-reader from #BabaHerbhouse wrapped in crimson Rhodope aprons. You know the Lamia accepts braided martenitsa wool, honeyed kolivo wheat, and unbroken promises—never reckless bloodshed.',
      plan: 'Gather basil and yarrow at #BabaHerbhouse, counsel neighbors on #KhoroStar, and negotiate at #LamiaWell.',
      voiceStyle: 'raspy, knowing, grandmotherly',
      voice: {
        gender: 'female',
        language: 'American English',
        pitchSemitones: -1,
        speakingRate: 0.9,
        warmthDb: 4,
      },
      homeTile: { x: 8, y: 22 },
      speed: 1.35,
    },
    {
      id: 'kuker-marin',
      name: 'Kuker Marin',
      role: 'Masked Bell Guardian',
      accentColor: '#d99226',
      spritesheetId: 'folk-3',
      customSprite: spriteMap['kuker-marin'],
      identity:
        'Master Kuker mummer in horned wooden mask, goatskin coat, and heavy bronze chanove waist-bells. You swear loud bronze chimes scatter curses, though secretly you worry the Lamia may demand something closer to the heart than iron noise.',
      plan: 'Rally bravery around #KukeriHearth, parade the bronze bells across #KhoroStar, and face #LamiaWell.',
      voiceStyle: 'booming, jovial, bell-rattling bravado',
      voice: {
        gender: 'male',
        language: 'American English',
        pitchSemitones: -2,
        speakingRate: 1.02,
        warmthDb: 4,
      },
      homeTile: { x: 34, y: 22 },
      speed: 1.65,
    },
    {
      id: 'stoyan',
      name: 'Stoyan Yunak',
      role: 'Blacksmith & Village Hero',
      accentColor: '#243e6d',
      spritesheetId: 'folk-4',
      customSprite: spriteMap.stoyan,
      identity:
        'Broad-shouldered blacksmith in a black kalpak and scarlet waist-sash. Empty pitchers line #KhoroStar and your quench-trough is bone dry; you itch to haul water by force yet heed Baba Rada’s warning about the Lamia’s storm-breath.',
      plan: 'March from #KukeriHearth across #YunakBridge to check #BabaHerbhouse and #SamodivaSpring before daring #LamiaWell.',
      voiceStyle: 'steady, gallant, stubborn baritone',
      voice: {
        gender: 'male',
        language: 'American English',
        pitchSemitones: -1,
        speakingRate: 0.98,
        warmthDb: 2,
      },
      homeTile: { x: 32, y: 23 },
      speed: 1.75,
    },
    {
      id: 'samodiva-raina',
      name: 'Samodiva Raina',
      role: 'Vila of the Hidden Spring',
      accentColor: '#6b8fd6',
      spritesheetId: 'folk-5',
      customSprite: spriteMap['samodiva-raina'],
      identity:
        'Forest Samodiva crowned with wild poppies and bluebells at #SamodivaSpring. Only your birch-shaded basin remains sweet; you trade clear spring water solely to mortals who leave song or scarlet thread and never spill steel inside the glade.',
      plan: 'Dance along the Pirin rose ring at #SamodivaSpring and watch travelers crossing the northern bridge.',
      voiceStyle: 'musical, elusive, woodland whisper',
      voice: {
        gender: 'female',
        language: 'American English',
        pitchSemitones: 2,
        speakingRate: 0.96,
        warmthDb: 1,
      },
      homeTile: { x: 9, y: 10 },
      speed: 1.7,
    },
    {
      id: 'tsveta',
      name: 'Tsveta Vezachka',
      role: 'Shevitsa Loom Weaver',
      accentColor: '#a23c6c',
      spritesheetId: 'folk-1',
      customSprite: spriteMap.tsveta,
      identity:
        'Master weaver at #WeaverCardak with double silver pafti clasps, stitching Zmeyovo’s ancient covenant into an eight-pointed Elbetitsa banner. You believe repeating the lost spring-rite pattern at #LamiaWell can turn the serpent’s hunger into rain.',
      plan: 'Finish weaving the scarlet Elbetitsa cloth at #WeaverCardak, meet at #KhoroStar, and present it at #LamiaWell.',
      voiceStyle: 'clear, lyrical, observant needleworker',
      voice: {
        gender: 'female',
        language: 'American English',
        pitchSemitones: 1,
        speakingRate: 1.0,
        warmthDb: 2,
      },
      homeTile: { x: 35, y: 12 },
      speed: 1.6,
    },
  ];
}

export function createBalkanMythWorld(width = 48, height = 36): {
  map: VillageMap;
  villagers: VillagerConfig[];
  openingDirective: string;
} {
  return {
    map: createBalkanMythMap(width, height),
    villagers: createBalkanMythVillagers(),
    openingDirective: BALKAN_MYTH_OPENING_DIRECTIVE,
  };
}
