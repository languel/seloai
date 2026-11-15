import type { PointOfInterest, SpawnPoint, TileGrid, TileMacroStamp, VillageMap } from '../engine/types';

export const SHEVITSA_TILESET_URL = '/assets/shevitsa-tileset.png';
export const SHEVITSA_TILESET_DIM = 512;
export const SHEVITSA_TILE_SIZE = 32;

/**
 * Procedurally generates the playable "Embroidered Bulgaria" realm map (Шевици),
 * shaped according to the geographic silhouette of Bulgaria and embedding the 7
 * ethnographic regional embroidery motifs shown in the regional shevitsa map.
 */
export function createBulgarianShevitsaMap(width = 64, height = 48): VillageMap {
  const bg0: TileGrid = Array.from({ length: width }, () => Array(height).fill(0)); // Ecru linen base
  const bg1: TileGrid = Array.from({ length: width }, () => Array(height).fill(-1)); // Motifs & overlays
  const obj0: TileGrid = Array.from({ length: width }, () => Array(height).fill(-1)); // Objects & markers
  const obj1: TileGrid = Array.from({ length: width }, () => Array(height).fill(-1));
  const collision: boolean[][] = Array.from({ length: width }, () => Array(height).fill(false));

  // 1. Establish the Bulgaria Realm Boundary & Biomes
  // Inside the national silhouette, set lush green meadow or regional terrain
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      // Silhouette test for Bulgaria:
      // West: x ~ 8..18
      // Central: x ~ 18..44
      // East (Dobrudzha & Black Sea): x ~ 44..58
      // North (Danube): y ~ 6..14
      // South (Rhodopes/Pirin): y ~ 30..42
      const inBulgaria = isInsideBulgariaContour(x, y);

      if (inBulgaria) {
        // Biomes inside Bulgaria:
        // Danube river along northern boundary:
        if (isDanubeRiver(x, y)) {
          bg0[x][y] = 5; // Blue water
          collision[x][y] = true; // River blocks movement except at fords
        }
        // Black Sea on eastern coast:
        else if (isBlackSea(x, y)) {
          bg0[x][y] = 5; // Blue water
          collision[x][y] = true; // Sea blocks movement
        }
        // Dobrudzha Golden Granary (northeast):
        else if (x >= 42 && x <= 56 && y >= 7 && y <= 18) {
          bg0[x][y] = 9; // Golden wheat field
        }
        // Balkan Mountain Range (Stara Planina - central ridge across x: 10..42, y: 18..20):
        else if (isBalkanRidge(x, y)) {
          bg0[x][y] = 7; // Mountain stone
          collision[x][y] = (x % 5 !== 0); // Leave mountain passes open every 5 tiles
        }
        // Rila & Pirin alpine peaks (southwest):
        else if (x >= 14 && x <= 22 && y >= 28 && y <= 34 && (x + y) % 3 === 0) {
          bg0[x][y] = 8; // Snow mountain peak
          collision[x][y] = true;
        }
        // Rhodope Mountain Forest (south-central):
        else if (x >= 24 && x <= 40 && y >= 34 && y <= 42) {
          bg0[x][y] = 2; // Deep mountain meadow
          if ((x * 7 + y * 3) % 11 === 0 && !isNearPOI(x, y)) {
            obj0[x][y] = 14; // Pine tree
            collision[x][y] = true;
          }
        }
        // Standard lush meadow for plains of Thrace & Danube:
        else {
          bg0[x][y] = 1; // Meadow grass
        }
      } else {
        // Outside Bulgaria: Ecru woven linen fabric
        bg0[x][y] = 0;
        // Natural boundary contour (black cross-stitch border contour around the realm)
        if (isBoundaryEdge(x, y, width, height)) {
          bg1[x][y] = 11; // Black border cross-stitch
          collision[x][y] = !isBorderGate(x, y); // Open at gates
        }
      }
    }
  }

  // 2. Open walkable Danube River Ford at x: 26, y: 8
  for (let dy = 6; dy <= 9; dy++) {
    bg0[26][dy] = 6; // Shallow ford
    collision[26][dy] = false; // Walkable
  }
  // Black Sea pier / coastal walkway at x: 48..54, y: 32
  for (let dx = 48; dx <= 54; dx++) {
    bg0[dx][32] = 4; // Stone coastal pier
    collision[dx][32] = false;
  }

  // 3. Connect the 7 Regions with Embroidered Ribbon Pathways (Шевични пътеки)
  connectWithRibbonPath(bg0, collision, 14, 24, 30, 24); // Shopluk -> Central Balkan Tree of Life
  connectWithRibbonPath(bg0, collision, 30, 24, 46, 12); // Balkan -> Dobrudzha
  connectWithRibbonPath(bg0, collision, 30, 24, 30, 36); // Balkan -> Rhodope Hearth
  connectWithRibbonPath(bg0, collision, 14, 24, 14, 36); // Shopluk -> Pirin Labyrinth
  connectWithRibbonPath(bg0, collision, 14, 24, 12, 12); // Shopluk -> Chiprovtsi Loom
  connectWithRibbonPath(bg0, collision, 12, 12, 26, 8);  // Chiprovtsi -> Danube Ford
  connectWithRibbonPath(bg0, collision, 26, 8, 46, 12);  // Danube -> Dobrudzha
  connectWithRibbonPath(bg0, collision, 30, 36, 46, 32); // Rhodopes -> Strandzha Coast
  connectWithRibbonPath(bg0, collision, 46, 12, 46, 32); // Dobrudzha -> Strandzha Coast
  connectWithRibbonPath(bg0, collision, 14, 36, 30, 36); // Pirin -> Rhodopes

  // 4. Place the 7 Authentic Shevitsa Regional Motifs on Layer bg1
  // Motif 1: Shopluk Elbetitsa (4x4 tiles: 32..35, 40..43, 48..51, 56..59) at x: 12..15, y: 22..25
  stampPattern(bg1, collision, 12, 22, 4, 4, [
    32, 33, 34, 35,
    40, 41, 42, 43,
    48, 49, 50, 51,
    56, 57, 58, 59,
  ]);
  // Stone fountain in Shopluk plaza center
  obj0[14][21] = 224;
  collision[14][21] = true;

  // Motif 2: Central Balkan Tree of Life & Paired Birds (4x4 tiles: 64..67, 72..75, 80..83, 88..91) at x: 28..31, y: 22..25
  stampPattern(bg1, collision, 28, 22, 4, 4, [
    64, 65, 66, 67,
    72, 73, 74, 75,
    80, 81, 82, 83,
    88, 89, 90, 91,
  ]);
  // Sacred boundary marker beside the Tree of Life
  obj0[30][21] = 227;
  collision[30][21] = true;

  // Motif 3: Pirin Stepped Labyrinth (4x4 tiles: 96..99, 104..107, 112..115, 120..123) at x: 12..15, y: 34..37
  stampPattern(bg1, collision, 12, 34, 4, 4, [
    96, 97, 98, 99,
    104, 105, 106, 107,
    112, 113, 114, 115,
    120, 121, 122, 123,
  ]);
  obj0[14][33] = 227;
  collision[14][33] = true;

  // Motif 4: Rhodope Solar Rosette (4x4 tiles: 128..131, 136..139, 144..147, 152..155) at x: 28..31, y: 34..37
  stampPattern(bg1, collision, 28, 34, 4, 4, [
    128, 129, 130, 131,
    136, 137, 138, 139,
    144, 145, 146, 147,
    152, 153, 154, 155,
  ]);
  // Warm solar hearth firepit in the Rhodope sanctuary
  obj0[30][33] = 226;
  collision[30][33] = true;

  // Motif 5: Northwest Chiprovtsi Kilim Diamond Loom at x: 10..13, y: 10..13
  stampPattern(bg1, collision, 10, 10, 4, 4, [
    160, 161, 162, 163,
    168, 169, 170, 171,
    176, 177, 178, 179,
    184, 185, 186, 187,
  ]);
  // Wooden loom beside the workshop
  obj0[12][9] = 225;
  collision[12][9] = true;

  // Motif 6: Dobrudzha Golden Harvest Ribbon Friezes at x: 43..49, y: 10..14
  for (let dx = 43; dx <= 49; dx++) {
    bg1[dx][11] = 21; // Dobrudzha diamond chevron
    bg1[dx][13] = 21;
  }

  // Motif 7: Strandzha Coastal Solar Gateway at x: 44..47, y: 30..33
  stampPattern(bg1, collision, 44, 30, 4, 4, [
    128, 129, 130, 131,
    136, 137, 138, 139,
    144, 145, 146, 147,
    152, 153, 154, 155,
  ]);
  obj0[46][29] = 227;
  collision[46][29] = true;

  // Ensure all regional hearts are clear of collision for walkable exploration
  ensureWalkableArea(collision, 14, 24, 2);
  ensureWalkableArea(collision, 30, 24, 2);
  ensureWalkableArea(collision, 14, 36, 2);
  ensureWalkableArea(collision, 30, 36, 2);
  ensureWalkableArea(collision, 12, 12, 2);
  ensureWalkableArea(collision, 46, 12, 2);
  ensureWalkableArea(collision, 46, 32, 2);
  ensureWalkableArea(collision, 26, 8, 2);

  // 5. Points of Interest (POIs) with rich Bulgarian Shevitsa Lore
  const pointsOfInterest: PointOfInterest[] = [
    {
      id: 'poi-elbetitsa',
      tag: 'Elbetitsa',
      label: 'Elbetitsa Star Plaza (Shopluk)',
      x: 14,
      y: 24,
      description: 'The ancient eight-directional compass star representing cosmic harmony, vitality, and seasonal cycles.',
    },
    {
      id: 'poi-treeoflife',
      tag: 'TreeOfLife',
      label: 'Tree of Life (Central Balkan)',
      x: 30,
      y: 24,
      description: 'Crowned guardian cockerels flanking the sacred flowering cosmic tree, safeguarding village health and posterity.',
    },
    {
      id: 'poi-pirin',
      tag: 'PirinLabyrinth',
      label: 'Pirin Spiral Labyrinth (Southwest)',
      x: 14,
      y: 36,
      description: 'Stepped meanders in pastel pink and glacial blue, echoing Bansko and Pirin mountain legends.',
    },
    {
      id: 'poi-rhodope',
      tag: 'RhodopeRosette',
      label: 'Rhodope Solar Hearth (South)',
      x: 30,
      y: 36,
      description: 'Multi-ringed sunburst rosette radiating warmth across mountain stone, honoring eternal daylight.',
    },
    {
      id: 'poi-chiprovtsi',
      tag: 'ChiprovtsiLoom',
      label: 'Chiprovtsi Kilim Loom (Northwest)',
      x: 12,
      y: 12,
      description: 'Geometric diamond kilim looms where master weavers encode protective folklore into woven linen.',
    },
    {
      id: 'poi-dobrudzha',
      tag: 'DobrudzhaPlains',
      label: 'Golden Dobrudzha Plains (Northeast)',
      x: 46,
      y: 12,
      description: 'Endless granary meadows bordered by traditional harvest chevrons, stretching toward the sea.',
    },
    {
      id: 'poi-strandzha',
      tag: 'StrandzhaGate',
      label: 'Strandzha Amber Coast (Southeast)',
      x: 46,
      y: 32,
      description: 'Ancient solar oak symbols and sea wind where mystical Strandzha hills meet the Black Sea surf.',
    },
    {
      id: 'poi-danube',
      tag: 'DanubeFord',
      label: 'Danube River Ford (North)',
      x: 26,
      y: 8,
      description: 'A clear river crossing adorned with wave meanders connecting the northern trade ways.',
    },
  ];

  // 6. Spawn Points across the 7 Regions
  const spawnPoints: SpawnPoint[] = [
    { id: 'spawn-elbetitsa', label: 'Elbetitsa Plaza (Shopluk)', x: 14, y: 24 },
    { id: 'spawn-treeoflife', label: 'Tree of Life (Balkan)', x: 30, y: 24 },
    { id: 'spawn-rhodope', label: 'Solar Hearth (Rhodopes)', x: 30, y: 36 },
    { id: 'spawn-pirin', label: 'Spiral Labyrinth (Pirin)', x: 14, y: 36 },
    { id: 'spawn-chiprovtsi', label: 'Weaver Loom (Northwest)', x: 12, y: 12 },
    { id: 'spawn-dobrudzha', label: 'Golden Plains (Dobrudzha)', x: 46, y: 12 },
    { id: 'spawn-strandzha', label: 'Amber Coast (Strandzha)', x: 46, y: 32 },
  ];

  // 7. Built-in Tile Macro Stamps for the Level Editor
  const stamps: TileMacroStamp[] = [
    {
      id: 'stamp-elbetitsa',
      name: 'Shopluk Elbetitsa (8-Fold Star)',
      width: 4,
      height: 4,
      tiles: [
        32, 33, 34, 35,
        40, 41, 42, 43,
        48, 49, 50, 51,
        56, 57, 58, 59,
      ],
      layer: 'bg1',
      blocksMovement: false,
    },
    {
      id: 'stamp-tree-of-life',
      name: 'Tree of Life & Paired Birds',
      width: 4,
      height: 4,
      tiles: [
        64, 65, 66, 67,
        72, 73, 74, 75,
        80, 81, 82, 83,
        88, 89, 90, 91,
      ],
      layer: 'bg1',
      blocksMovement: false,
    },
    {
      id: 'stamp-pirin-labyrinth',
      name: 'Pirin Stepped Labyrinth (Pink & Blue)',
      width: 4,
      height: 4,
      tiles: [
        96, 97, 98, 99,
        104, 105, 106, 107,
        112, 113, 114, 115,
        120, 121, 122, 123,
      ],
      layer: 'bg1',
      blocksMovement: false,
    },
    {
      id: 'stamp-rhodope-rosette',
      name: 'Rhodope Sunburst Rosette',
      width: 4,
      height: 4,
      tiles: [
        128, 129, 130, 131,
        136, 137, 138, 139,
        144, 145, 146, 147,
        152, 153, 154, 155,
      ],
      layer: 'bg1',
      blocksMovement: false,
    },
    {
      id: 'stamp-chiprovtsi-diamond',
      name: 'Chiprovtsi Kilim Diamond Loom',
      width: 4,
      height: 4,
      tiles: [
        160, 161, 162, 163,
        168, 169, 170, 171,
        176, 177, 178, 179,
        184, 185, 186, 187,
      ],
      layer: 'bg1',
      blocksMovement: false,
    },
    {
      id: 'stamp-dobrudzha-ribbon',
      name: 'Dobrudzha Harvest Chevron Ribbon',
      width: 6,
      height: 1,
      tiles: [21, 21, 21, 21, 21, 21],
      layer: 'bg1',
      blocksMovement: false,
    },
    {
      id: 'stamp-danube-wave',
      name: 'Danube Blue Wave Meander',
      width: 6,
      height: 1,
      tiles: [20, 20, 20, 20, 20, 20],
      layer: 'bg1',
      blocksMovement: false,
    },
    {
      id: 'stamp-wooden-loom',
      name: 'Carved Wooden Loom',
      width: 1,
      height: 1,
      tiles: [225],
      layer: 'obj0',
      blocksMovement: true,
    },
    {
      id: 'stamp-stone-well',
      name: 'Stone Village Fountain (Чешма)',
      width: 1,
      height: 1,
      tiles: [224],
      layer: 'obj0',
      blocksMovement: true,
    },
  ];

  return {
    name: 'Шевици: The Embroidered Realm of Bulgaria',
    tileDim: SHEVITSA_TILE_SIZE,
    width,
    height,
    tileSetUrl: SHEVITSA_TILESET_URL,
    tileSetDimX: SHEVITSA_TILESET_DIM,
    tileSetDimY: SHEVITSA_TILESET_DIM,
    bgTiles: [bg0, bg1],
    objectTiles: [obj0, obj1],
    collisionGrid: collision,
    animatedSprites: [],
    spawnPoints,
    pointsOfInterest,
    stamps,
  };
}

// ---------------------------------------------------------------------------
// Geographic Silhouette & Geometry Helpers
// ---------------------------------------------------------------------------

function isInsideBulgariaContour(x: number, y: number): boolean {
  // Rough geographic bounds for Bulgaria on a 64x48 grid:
  // Northwest (Vidin): x: 6..16, y: 7..16
  // North-Central (Danube line): x: 16..46, y: 6..12
  // Northeast (Dobrudzha corner): x: 44..56, y: 6..16
  // Central Thrace / Balkan: x: 10..52, y: 12..30
  // Southwest (Pirin/Rila): x: 8..22, y: 26..42
  // South (Rhodopes border): x: 22..42, y: 30..43
  // Southeast (Strandzha): x: 42..54, y: 28..39
  // East (Black Sea coast): x: 50..58, y: 14..36

  // Hard outside cutoffs:
  if (x < 6 || x > 58 || y < 5 || y > 43) return false;

  // Northwest indent (Serbia/Romania border curvature)
  if (x < 10 && y < 7) return false;
  if (x < 7 && y > 16 && y < 24) return false;

  // Southwest border corner (Macedonia/Greece)
  if (x < 8 && y > 38) return false;

  // Southeast corner (Turkey/Black sea border curvature)
  if (x > 54 && y > 36) return false;

  // Northeast Black Sea curvature
  if (x > 56 && y < 14) return false;
  if (x > 58) return false;

  // South indent between Pirin and Rhodopes
  if (x >= 20 && x <= 24 && y > 42) return false;

  // North Danube contour
  if (y < 6 && (x < 14 || x > 44)) return false;

  return true;
}

function isBoundaryEdge(x: number, y: number, width: number, height: number): boolean {
  if (isInsideBulgariaContour(x, y)) return false;
  // If not inside, check if an immediate neighbor is inside
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && isInsideBulgariaContour(nx, ny)) {
        return true;
      }
    }
  }
  return false;
}

function isBorderGate(x: number, y: number): boolean {
  // Gateways allowing entry into the embroidered realm
  if (x === 26 && y === 5) return true; // Danube Gate
  if (x === 54 && y === 32) return true; // Black Sea Port
  if (x === 7 && y === 24) return true;  // Western Gate
  if (x === 30 && y === 43) return true; // Southern Mountain Gate
  return false;
}

function isDanubeRiver(x: number, y: number): boolean {
  // Northern border river flowing across northern edge x: 8..46, y: 5..8
  if (x >= 8 && x <= 46 && y >= 5 && y <= 7) return true;
  return false;
}

function isBlackSea(x: number, y: number): boolean {
  // Eastern coastline x: 53..58, y: 13..38
  if (x >= 54 && x <= 58 && y >= 12 && y <= 38) return true;
  return false;
}

function isBalkanRidge(x: number, y: number): boolean {
  // Central east-west spine
  if (x >= 12 && x <= 42 && (y === 18 || y === 19)) return true;
  return false;
}

function isNearPOI(x: number, y: number): boolean {
  const centers = [
    [14, 24], [30, 24], [14, 36], [30, 36],
    [12, 12], [46, 12], [46, 32], [26, 8],
  ];
  return centers.some(([cx, cy]) => Math.hypot(x - cx, y - cy) <= 5);
}

function ensureWalkableArea(collision: boolean[][], cx: number, cy: number, radius = 2) {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < collision.length && y >= 0 && y < collision[0].length) {
        collision[x][y] = false;
      }
    }
  }
}

function connectWithRibbonPath(
  bg: TileGrid,
  collision: boolean[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  // Bresenham-style line with 2-tile thickness
  let curX = x1;
  let curY = y1;
  while (curX !== x2 || curY !== y2) {
    if (curX < x2) curX++;
    else if (curX > x2) curX--;

    if (curY < y2) curY++;
    else if (curY > y2) curY--;

    for (let ox = 0; ox <= 1; ox++) {
      for (let oy = 0; oy <= 1; oy++) {
        const px = curX + ox;
        const py = curY + oy;
        if (px >= 0 && px < bg.length && py >= 0 && py < bg[0].length) {
          bg[px][py] = 3; // Dirt / golden ochre road
          collision[px][py] = false; // Always walkable
        }
      }
    }
  }
}

function stampPattern(
  grid: TileGrid,
  collision: boolean[][],
  x0: number,
  y0: number,
  w: number,
  h: number,
  pattern: number[],
) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = pattern[dy * w + dx];
      const px = x0 + dx;
      const py = y0 + dy;
      if (px >= 0 && px < grid.length && py >= 0 && py < grid[0].length) {
        grid[px][py] = tile;
        // Patterns on bg1 are walkable decorative carpets
        collision[px][py] = false;
      }
    }
  }
}
