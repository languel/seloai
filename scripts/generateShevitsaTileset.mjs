import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function crc32(buf) {
  let table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function makePng(width, height, rgbaBuffer) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcVal = crc32(Buffer.concat([t, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, t, data, crcBuf]);
  }

  const scanlineLength = width * 4;
  const filtered = Buffer.alloc(height * (scanlineLength + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (scanlineLength + 1)] = 0;
    rgbaBuffer.copy(filtered, y * (scanlineLength + 1) + 1, y * scanlineLength, (y + 1) * scanlineLength);
  }

  const idatData = zlib.deflateSync(filtered);
  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', idatData);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

const TILE_DIM = 32;
const COLS = 16;
const ROWS = 16;
const WIDTH = COLS * TILE_DIM;   // 512
const HEIGHT = ROWS * TILE_DIM; // 512
const rgba = Buffer.alloc(WIDTH * HEIGHT * 4, 0);

function hexToRgba(hex, alpha = 255) {
  const c = hex.replace('#', '');
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255, alpha];
}

const PALETTE = {
  linenBase: hexToRgba('#f6f2e9'),
  linenDark: hexToRgba('#ece5d8'),
  linenLight: hexToRgba('#fdfbf7'),
  meadowGreen: hexToRgba('#4f8c54'),
  meadowGreenDark: hexToRgba('#3e7042'),
  mountainRock: hexToRgba('#6b717b'),
  mountainDark: hexToRgba('#4f535a'),
  mountainSnow: hexToRgba('#f0f4f8'),
  waterDeep: hexToRgba('#1c5f87'),
  waterWave: hexToRgba('#4292c2'),
  waterFoam: hexToRgba('#a2d4f2'),
  pathDirt: hexToRgba('#c29b62'),
  pathDark: hexToRgba('#a8824b'),
  pathStone: hexToRgba('#b5b0a3'),
  // Shevitsa Embroidery Threads
  red: hexToRgba('#be1e2d'),
  redHi: hexToRgba('#e03646'),
  redDark: hexToRgba('#8a111c'),
  black: hexToRgba('#1b1b22'),
  blackHi: hexToRgba('#353542'),
  white: hexToRgba('#ffffff'),
  gold: hexToRgba('#e6a117'),
  goldHi: hexToRgba('#ffc83b'),
  green: hexToRgba('#22773c'),
  greenHi: hexToRgba('#359e53'),
  pirinPink: hexToRgba('#e3789b'),
  pirinPinkHi: hexToRgba('#f7a3bc'),
  pirinBlue: hexToRgba('#569cd6'),
  pirinBlueHi: hexToRgba('#84beee'),
  amber: hexToRgba('#df5c16'),
  amberHi: hexToRgba('#fa8140'),
  wood: hexToRgba('#6f4827'),
  woodDark: hexToRgba('#4d2f14'),
};

function setPixel(px, py, col) {
  if (px < 0 || px >= WIDTH || py < 0 || py >= HEIGHT) return;
  const idx = (py * WIDTH + px) * 4;
  rgba[idx] = col[0];
  rgba[idx + 1] = col[1];
  rgba[idx + 2] = col[2];
  rgba[idx + 3] = col[3] ?? 255;
}

function fillTileRect(tileIdx, x0, y0, w, h, col) {
  const tx = (tileIdx % COLS) * TILE_DIM;
  const ty = Math.floor(tileIdx / COLS) * TILE_DIM;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      setPixel(tx + x0 + x, ty + y0 + y, col);
    }
  }
}

function drawCrossStitch(tileIdx, sx, sy, col, hiCol) {
  // sx, sy in stitch units [0..15] within 32x32 tile (each stitch 2x2 px)
  const tx = (tileIdx % COLS) * TILE_DIM + sx * 2;
  const ty = Math.floor(tileIdx / COLS) * TILE_DIM + sy * 2;
  setPixel(tx, ty, hiCol || col);
  setPixel(tx + 1, ty, col);
  setPixel(tx, ty + 1, col);
  setPixel(tx + 1, ty + 1, hiCol || col);
}

// 1. Fill ground tiles (Row 0: 0..15)
// Tile 0: Natural Ecru Linen
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const isWarp = x % 4 === 0;
    const isWeft = y % 4 === 0;
    const c = isWarp && isWeft ? PALETTE.linenLight : isWarp || isWeft ? PALETTE.linenDark : PALETTE.linenBase;
    const tx = 0 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 1: Meadow Grass with subtle linen stitch
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const isStitch = (x + y) % 6 === 0;
    const c = isStitch ? PALETTE.meadowGreenDark : PALETTE.meadowGreen;
    const tx = 1 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 2: Deep Mountain Pine Meadow
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const isStitch = (x * 3 + y) % 7 === 0;
    const c = isStitch ? PALETTE.green : PALETTE.meadowGreenDark;
    const tx = 2 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 3: Dirt Path (Golden Ochre)
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const c = (x % 3 === 0 && y % 3 === 0) ? PALETTE.pathDark : PALETTE.pathDirt;
    const tx = 3 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 4: Cobblestone Walkway
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const isBorder = (x % 8 === 0) || (y % 8 === 0);
    const c = isBorder ? PALETTE.pathDark : PALETTE.pathStone;
    const tx = 4 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 5: Danube / Black Sea Blue Water
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const wave = Math.sin(x * 0.4 + y * 0.2) > 0.4;
    const c = wave ? PALETTE.waterWave : PALETTE.waterDeep;
    const tx = 5 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 6: Shallow Water Coast / Danube Shore
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const wave = (x + y) % 5 === 0;
    const c = wave ? PALETTE.waterFoam : PALETTE.waterWave;
    const tx = 6 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 7: Mountain Ridge Stone (Balkan / Pirin / Rhodope)
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const crag = (x % 6 === 0 || y % 6 === 0) && ((x + y) % 4 === 0);
    const c = crag ? PALETTE.mountainDark : PALETTE.mountainRock;
    const tx = 7 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 8: Snow Peak (Rila / Pirin)
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const shadow = y > x + 4;
    const c = shadow ? PALETTE.mountainRock : PALETTE.mountainSnow;
    const tx = 8 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 9: Golden Wheat Field (Dobrudzha)
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const stalk = (x % 4 === 0 && y % 2 === 0);
    const c = stalk ? PALETTE.goldHi : PALETTE.gold;
    const tx = 9 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 10: Crimson Woven Carpet Ground (Chiprovtsi Runner)
for (let x = 0; x < TILE_DIM; x++) {
  for (let y = 0; y < TILE_DIM; y++) {
    const pattern = ((x + y) % 4 === 0);
    const c = pattern ? PALETTE.redHi : PALETTE.red;
    const tx = 10 * TILE_DIM + x;
    const ty = 0 * TILE_DIM + y;
    setPixel(tx, ty, c);
  }
}

// Tile 11: National Outline Border Contour (Black cross-stitch border line)
fillTileRect(11, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i++) {
  drawCrossStitch(11, i, 7, PALETTE.black, PALETTE.blackHi);
  drawCrossStitch(11, i, 8, PALETTE.black, PALETTE.blackHi);
}

// Tile 12: National Outline Border Vertical
fillTileRect(12, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i++) {
  drawCrossStitch(12, 7, i, PALETTE.black, PALETTE.blackHi);
  drawCrossStitch(12, 8, i, PALETTE.black, PALETTE.blackHi);
}

// Tile 13: National Outline Border Corner
fillTileRect(13, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 8; i++) {
  drawCrossStitch(13, 7, i, PALETTE.black, PALETTE.blackHi);
  drawCrossStitch(13, 8, i, PALETTE.black, PALETTE.blackHi);
}
for (let i = 7; i < 16; i++) {
  drawCrossStitch(13, i, 7, PALETTE.black, PALETTE.blackHi);
  drawCrossStitch(13, i, 8, PALETTE.black, PALETTE.blackHi);
}

// Tile 14: Dark Forest Tree Top
fillTileRect(14, 0, 0, TILE_DIM, TILE_DIM, PALETTE.meadowGreen);
for (let y = 2; y < 14; y++) {
  const span = Math.min(y, 14 - y);
  for (let x = 8 - span; x <= 8 + span; x++) {
    drawCrossStitch(14, x, y, PALETTE.green, PALETTE.greenHi);
  }
}

// Tile 15: Golden Solar Sparkle on Linen
fillTileRect(15, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
drawCrossStitch(15, 8, 8, PALETTE.goldHi, PALETTE.white);
drawCrossStitch(15, 7, 8, PALETTE.gold, PALETTE.goldHi);
drawCrossStitch(15, 9, 8, PALETTE.gold, PALETTE.goldHi);
drawCrossStitch(15, 8, 7, PALETTE.gold, PALETTE.goldHi);
drawCrossStitch(15, 8, 9, PALETTE.gold, PALETTE.goldHi);

// 2. Row 1 (Tiles 16-31): Embroidered Borders & Ribbons (Кантове)
// Tile 16: Horizontal Red & Black Shevitsa Ribbon
fillTileRect(16, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i++) {
  drawCrossStitch(16, i, 4, PALETTE.black, PALETTE.blackHi);
  drawCrossStitch(16, i, 5, i % 2 === 0 ? PALETTE.red : PALETTE.white, PALETTE.redHi);
  drawCrossStitch(16, i, 6, i % 2 === 1 ? PALETTE.red : PALETTE.gold, PALETTE.redHi);
  drawCrossStitch(16, i, 7, i % 2 === 0 ? PALETTE.red : PALETTE.white, PALETTE.redHi);
  drawCrossStitch(16, i, 8, PALETTE.black, PALETTE.blackHi);
}

// Tile 17: Vertical Red & Black Ribbon
fillTileRect(17, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i++) {
  drawCrossStitch(17, 4, i, PALETTE.black, PALETTE.blackHi);
  drawCrossStitch(17, 5, i, i % 2 === 0 ? PALETTE.red : PALETTE.white, PALETTE.redHi);
  drawCrossStitch(17, 6, i, i % 2 === 1 ? PALETTE.red : PALETTE.gold, PALETTE.redHi);
  drawCrossStitch(17, 7, i, i % 2 === 0 ? PALETTE.red : PALETTE.white, PALETTE.redHi);
  drawCrossStitch(17, 8, i, PALETTE.black, PALETTE.blackHi);
}

// Tile 18: Corner Ribbon Top-Left
fillTileRect(18, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 6; i < 16; i++) {
  drawCrossStitch(18, i, 6, PALETTE.red, PALETTE.redHi);
  drawCrossStitch(18, 6, i, PALETTE.red, PALETTE.redHi);
  drawCrossStitch(18, i, 7, PALETTE.gold, PALETTE.goldHi);
  drawCrossStitch(18, 7, i, PALETTE.gold, PALETTE.goldHi);
}
drawCrossStitch(18, 6, 6, PALETTE.black, PALETTE.blackHi);

// Tile 19: Corner Ribbon Top-Right
fillTileRect(19, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i <= 9; i++) {
  drawCrossStitch(19, i, 6, PALETTE.red, PALETTE.redHi);
  drawCrossStitch(19, 9, 6 + i, PALETTE.red, PALETTE.redHi);
  drawCrossStitch(19, i, 7, PALETTE.gold, PALETTE.goldHi);
  drawCrossStitch(19, 8, 7 + i, PALETTE.gold, PALETTE.goldHi);
}
drawCrossStitch(19, 9, 6, PALETTE.black, PALETTE.blackHi);

// Tile 20: Danube Wave Meander Ribbon (Blue & White)
fillTileRect(20, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i++) {
  const waveY = 6 + Math.round(Math.sin((i / 16) * Math.PI * 2) * 3);
  drawCrossStitch(20, i, waveY, PALETTE.pirinBlue, PALETTE.pirinBlueHi);
  drawCrossStitch(20, i, waveY + 1, PALETTE.white, PALETTE.white);
}

// Tile 21: Dobrudzha Golden Diamond Chain
fillTileRect(21, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i += 4) {
  drawCrossStitch(21, i + 1, 7, PALETTE.red, PALETTE.redHi);
  drawCrossStitch(21, i + 2, 6, PALETTE.gold, PALETTE.goldHi);
  drawCrossStitch(21, i + 2, 8, PALETTE.gold, PALETTE.goldHi);
  drawCrossStitch(21, i + 3, 7, PALETTE.green, PALETTE.greenHi);
}

// Tile 22: Chiprovtsi Stepped Triangle Border
fillTileRect(22, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i++) {
  const step = i % 4;
  for (let s = 0; s <= step; s++) {
    drawCrossStitch(22, i, 8 - s, PALETTE.red, PALETTE.redHi);
    drawCrossStitch(22, i, 9 + s, PALETTE.black, PALETTE.blackHi);
  }
}

// Tile 23: Shopluk Braided Black & White Chevron
fillTileRect(23, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i++) {
  const diag = (i % 4);
  drawCrossStitch(23, i, 6 + diag, PALETTE.black, PALETTE.blackHi);
  drawCrossStitch(23, i, 7 + diag, PALETTE.white, PALETTE.white);
  drawCrossStitch(23, i, 8 + diag, PALETTE.red, PALETTE.redHi);
}

// Tile 24: Pirin Pastel Stepped Meander (Pink & Blue)
fillTileRect(24, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let i = 0; i < 16; i++) {
  const step = (i % 4) < 2 ? 6 : 9;
  drawCrossStitch(24, i, step, PALETTE.pirinPink, PALETTE.pirinPinkHi);
  drawCrossStitch(24, i, step + 1, PALETTE.pirinBlue, PALETTE.pirinBlueHi);
}

// Tile 25..31: Additional Borders and Decorative Dividers
for (let t = 25; t <= 31; t++) {
  fillTileRect(t, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
  for (let i = 0; i < 16; i++) {
    drawCrossStitch(t, i, 7, (t % 2 === 0) ? PALETTE.gold : PALETTE.red, PALETTE.white);
  }
}

// 3. Rows 2-3 (Tiles 32..63): Shopluk Elbetitsa (8-Pointed Solar Star)
// We draw a full 4x4 set of tiles (Tiles 32,33,34,35 / 48,49,50,51 etc) forming the large Elbetitsa
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const tileIdx = 32 + row * 8 + col;
    fillTileRect(tileIdx, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
    // Global stitch coordinates in the 64x64 stitch Elbetitsa pattern
    const globalX = col * 16;
    const globalY = row * 16;
    for (let lx = 0; lx < 16; lx++) {
      for (let ly = 0; ly < 16; ly++) {
        const gx = globalX + lx - 32;
        const gy = globalY + ly - 32;
        const dist = Math.hypot(gx, gy);
        const absX = Math.abs(gx);
        const absY = Math.abs(gy);

        // Center hub
        if (dist <= 6) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.gold, PALETTE.goldHi);
        } else if (dist <= 10 && (absX === 0 || absY === 0 || absX === absY)) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.black, PALETTE.blackHi);
        }
        // 4 Cardinal Rays (North, South, East, West)
        else if ((absX <= 3 && absY <= 26) || (absY <= 3 && absX <= 26)) {
          const color = ((absX + absY) % 3 === 0) ? PALETTE.red : ((absX + absY) % 3 === 1) ? PALETTE.redHi : PALETTE.white;
          drawCrossStitch(tileIdx, lx, ly, color, PALETTE.white);
        }
        // 4 Diagonal Solar Wings (Elbetitsa diamonds)
        else if (Math.abs(absX - absY) <= 3 && dist <= 28) {
          const color = ((gx * gy) > 0) ? PALETTE.green : PALETTE.gold;
          drawCrossStitch(tileIdx, lx, ly, color, PALETTE.white);
        }
        // Corner Diamond Floral Buds
        else if (absX >= 18 && absX <= 26 && absY >= 18 && absY <= 26) {
          if (absX + absY >= 38 && absX + absY <= 46) {
            drawCrossStitch(tileIdx, lx, ly, PALETTE.red, PALETTE.redHi);
          }
        }
      }
    }
  }
}

// 4. Rows 4-5 (Tiles 64..95): Central Balkan Tree of Life & Paired Guardian Birds
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const tileIdx = 64 + row * 8 + col;
    fillTileRect(tileIdx, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
    const gx = col * 16;
    const gy = row * 16;
    for (let lx = 0; lx < 16; lx++) {
      for (let ly = 0; ly < 16; ly++) {
        const x = gx + lx;
        const y = gy + ly;

        // Central blooming tree trunk (x=30..33)
        if (x >= 30 && x <= 33) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.red, PALETTE.redHi);
        }
        // Top Tree Blossom
        else if (y <= 16 && Math.hypot(x - 32, y - 10) <= 8) {
          const c = (x + y) % 2 === 0 ? PALETTE.gold : PALETTE.red;
          drawCrossStitch(tileIdx, lx, ly, c, PALETTE.goldHi);
        }
        // Left Guardian Bird (x ~ 14, y ~ 28)
        else if (x >= 8 && x <= 24 && y >= 20 && y <= 48) {
          // Bird crest & head
          if (Math.hypot(x - 20, y - 24) <= 4) {
            drawCrossStitch(tileIdx, lx, ly, PALETTE.red, PALETTE.redHi);
          }
          // Bird beak facing center
          else if (x >= 23 && x <= 25 && y === 24) {
            drawCrossStitch(tileIdx, lx, ly, PALETTE.gold, PALETTE.goldHi);
          }
          // Bird body & wing
          else if (Math.hypot(x - 16, y - 34) <= 7) {
            const c = (x % 2 === 0) ? PALETTE.pirinBlue : PALETTE.red;
            drawCrossStitch(tileIdx, lx, ly, c, PALETTE.pirinBlueHi);
          }
          // Crowned tail feathers
          else if (x <= 12 && y >= 32 && y <= 44) {
            drawCrossStitch(tileIdx, lx, ly, PALETTE.green, PALETTE.greenHi);
          }
        }
        // Right Guardian Bird (x ~ 50, y ~ 28)
        else if (x >= 40 && x <= 56 && y >= 20 && y <= 48) {
          // Bird head
          if (Math.hypot(x - 44, y - 24) <= 4) {
            drawCrossStitch(tileIdx, lx, ly, PALETTE.red, PALETTE.redHi);
          }
          // Beak facing center
          else if (x >= 39 && x <= 41 && y === 24) {
            drawCrossStitch(tileIdx, lx, ly, PALETTE.gold, PALETTE.goldHi);
          }
          // Body & wing
          else if (Math.hypot(x - 48, y - 34) <= 7) {
            const c = (x % 2 === 0) ? PALETTE.pirinBlue : PALETTE.red;
            drawCrossStitch(tileIdx, lx, ly, c, PALETTE.pirinBlueHi);
          }
          // Tail feathers
          else if (x >= 52 && y >= 32 && y <= 44) {
            drawCrossStitch(tileIdx, lx, ly, PALETTE.green, PALETTE.greenHi);
          }
        }
        // Base pot / roots
        else if (y >= 52 && x >= 24 && x <= 40) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.woodDark, PALETTE.wood);
        }
      }
    }
  }
}

// 5. Rows 6-7 (Tiles 96..127): Pirin Pastel Labyrinth / Stepped Spirals
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const tileIdx = 96 + row * 8 + col;
    fillTileRect(tileIdx, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
    const gx = col * 16;
    const gy = row * 16;
    for (let lx = 0; lx < 16; lx++) {
      for (let ly = 0; ly < 16; ly++) {
        const x = (gx + lx) % 32;
        const y = (gy + ly) % 32;
        const ring = Math.min(Math.min(x, 31 - x), Math.min(y, 31 - y));
        if (ring % 3 === 0) {
          const colStitch = (ring % 6 === 0) ? PALETTE.pirinPink : PALETTE.pirinBlue;
          const hiStitch = (ring % 6 === 0) ? PALETTE.pirinPinkHi : PALETTE.pirinBlueHi;
          drawCrossStitch(tileIdx, lx, ly, colStitch, hiStitch);
        }
      }
    }
  }
}

// 6. Rows 8-9 (Tiles 128..159): Rhodope Solar Rosette & Strandzha Amber Emblem
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const tileIdx = 128 + row * 8 + col;
    fillTileRect(tileIdx, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
    const gx = col * 16;
    const gy = row * 16;
    for (let lx = 0; lx < 16; lx++) {
      for (let ly = 0; ly < 16; ly++) {
        const dx = gx + lx - 32;
        const dy = gy + ly - 32;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const petal = Math.cos(angle * 8);

        if (dist <= 6) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.goldHi, PALETTE.white);
        } else if (dist <= 14) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.amber, PALETTE.amberHi);
        } else if (dist <= 24 && petal > 0) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.red, PALETTE.redHi);
        } else if (dist <= 30 && petal > 0.4) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.green, PALETTE.greenHi);
        }
      }
    }
  }
}

// 7. Rows 10-11 (Tiles 160..191): Northwest Chiprovtsi Kilim Diamond Loom & Dobrudzha Frieze
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const tileIdx = 160 + row * 8 + col;
    fillTileRect(tileIdx, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
    const gx = (col * 16 + 8) % 32;
    const gy = (row * 16 + 8) % 32;
    for (let lx = 0; lx < 16; lx++) {
      for (let ly = 0; ly < 16; ly++) {
        const mx = Math.abs((gx + lx) % 32 - 16);
        const my = Math.abs((gy + ly) % 32 - 16);
        const diamond = mx + my;
        if (diamond <= 4) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.gold, PALETTE.goldHi);
        } else if (diamond <= 8) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.red, PALETTE.redHi);
        } else if (diamond <= 12) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.green, PALETTE.greenHi);
        } else if (diamond <= 15) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.black, PALETTE.blackHi);
        }
      }
    }
  }
}

// 8. Rows 12-13 (Tiles 192..223): Thracian Floral Sprigs (Carnations & Tulips)
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const tileIdx = 192 + row * 8 + col;
    fillTileRect(tileIdx, 0, 0, TILE_DIM, TILE_DIM, PALETTE.meadowGreen);
    for (let lx = 0; lx < 16; lx++) {
      for (let ly = 0; ly < 16; ly++) {
        const dx = lx - 8;
        const dy = ly - 8;
        const d = Math.hypot(dx, dy);
        if (d <= 3) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.redHi, PALETTE.white);
        } else if (d <= 5) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.red, PALETTE.redHi);
        } else if (ly >= 9 && lx >= 6 && lx <= 10) {
          drawCrossStitch(tileIdx, lx, ly, PALETTE.green, PALETTE.greenHi);
        }
      }
    }
  }
}

// 9. Rows 14-15 (Tiles 224..255): Interactive Village Objects (Stone Well, Wooden Loom, Hearth)
// Tile 224: Stone Fountain / Well (Чешма)
fillTileRect(224, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let lx = 3; lx < 13; lx++) {
  for (let ly = 3; ly < 13; ly++) {
    const isWater = Math.hypot(lx - 8, ly - 8) <= 3;
    const c = isWater ? PALETTE.waterWave : PALETTE.pathStone;
    drawCrossStitch(224, lx, ly, c, PALETTE.white);
  }
}

// Tile 225: Wooden Loom (Тъкачен стан)
fillTileRect(225, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let lx = 2; lx < 14; lx++) {
  drawCrossStitch(225, lx, 3, PALETTE.woodDark, PALETTE.wood);
  drawCrossStitch(225, lx, 12, PALETTE.woodDark, PALETTE.wood);
}
for (let ly = 3; ly < 13; ly++) {
  drawCrossStitch(225, 2, ly, PALETTE.woodDark, PALETTE.wood);
  drawCrossStitch(225, 13, ly, PALETTE.woodDark, PALETTE.wood);
}
// Threads on loom
for (let lx = 4; lx < 12; lx++) {
  const c = lx % 3 === 0 ? PALETTE.red : lx % 3 === 1 ? PALETTE.gold : PALETTE.green;
  for (let ly = 4; ly < 12; ly++) {
    drawCrossStitch(225, lx, ly, c, PALETTE.white);
  }
}

// Tile 226: Solar Firepit / Hearth (Огнище)
fillTileRect(226, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let lx = 2; lx < 14; lx++) {
  for (let ly = 2; ly < 14; ly++) {
    const d = Math.hypot(lx - 8, ly - 8);
    if (d <= 3) {
      drawCrossStitch(226, lx, ly, PALETTE.goldHi, PALETTE.white);
    } else if (d <= 5) {
      drawCrossStitch(226, lx, ly, PALETTE.amber, PALETTE.amberHi);
    } else if (d <= 6) {
      drawCrossStitch(226, lx, ly, PALETTE.mountainDark, PALETTE.mountainRock);
    }
  }
}

// Tile 227: Carved Boundary Stone Marker (Свещен камък)
fillTileRect(227, 0, 0, TILE_DIM, TILE_DIM, PALETTE.linenBase);
for (let lx = 4; lx < 12; lx++) {
  for (let ly = 3; ly < 13; ly++) {
    const isSymbol = (lx === 8 || ly === 7);
    const c = isSymbol ? PALETTE.red : PALETTE.mountainRock;
    drawCrossStitch(227, lx, ly, c, PALETTE.mountainSnow);
  }
}

const outPath = path.resolve(__dirname, '../public/assets/shevitsa-tileset.png');
const pngData = makePng(WIDTH, HEIGHT, rgba);
fs.writeFileSync(outPath, pngData);
console.log(`Successfully generated Shevitsa Tileset at: ${outPath} (${pngData.length} bytes)`);
