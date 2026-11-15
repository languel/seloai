#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createBalkanMythWorld } from '../src/data/balkanMythMap.ts';
import {
  BALKAN_CHARACTER_SPRITE_IDS,
  renderBalkanCharacterSheetPixels,
} from '../src/engine/balkanSprites.ts';
import {
  BALKAN_TILESET_COLS,
  BALKAN_TILE_DIM,
  renderBalkanTilesetPixels,
} from '../src/engine/balkanTileset.ts';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePngRgba(width, height, rgbaData) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0
    Buffer.from(rgbaData.buffer, rgbaData.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function alphaBlit(dst, dstW, dstH, src, srcW, sx, sy, sw, sh, dx, dy) {
  for (let py = 0; py < sh; py++) {
    const ty = dy + py;
    if (ty < 0 || ty >= dstH) continue;
    for (let px = 0; px < sw; px++) {
      const tx = dx + px;
      if (tx < 0 || tx >= dstW) continue;
      const si = ((sy + py) * srcW + (sx + px)) * 4;
      const a = src[si + 3];
      if (a === 0) continue;
      const di = (ty * dstW + tx) * 4;
      if (a === 255) {
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = 255;
      } else {
        const inv = 255 - a;
        dst[di] = Math.round((src[si] * a + dst[di] * inv) / 255);
        dst[di + 1] = Math.round((src[si + 1] * a + dst[di + 1] * inv) / 255);
        dst[di + 2] = Math.round((src[si + 2] * a + dst[di + 2] * inv) / 255);
        dst[di + 3] = 255;
      }
    }
  }
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const publicAssetsDir = path.join(repoRoot, 'public', 'assets');
const spritesDir = path.join(publicAssetsDir, 'spritesheets', 'balkan');
fs.mkdirSync(spritesDir, { recursive: true });

// 1. Generate & write Balkan Myth Tileset (512x512)
const tilesetBuf = renderBalkanTilesetPixels();
const tilesetPath = path.join(publicAssetsDir, 'balkan-myth-tileset.png');
fs.writeFileSync(tilesetPath, encodePngRgba(tilesetBuf.width, tilesetBuf.height, tilesetBuf.data));
console.log(`Generated tileset: ${tilesetPath} (${tilesetBuf.width}x${tilesetBuf.height})`);

// 2. Generate & write all 6 Balkan character spritesheets (128x128)
const spriteBuffers = {};
for (const id of BALKAN_CHARACTER_SPRITE_IDS) {
  const sheet = renderBalkanCharacterSheetPixels(id);
  spriteBuffers[id] = sheet;
  const outPath = path.join(spritesDir, `${id}.png`);
  fs.writeFileSync(outPath, encodePngRgba(sheet.width, sheet.height, sheet.data));
  console.log(`Generated character spritesheet: ${outPath} (${sheet.width}x${sheet.height})`);
}

// 3. Optionally render a composed inspection preview: set SELOAI_PREVIEW_DIR to enable.
const scratchDir = process.env.SELOAI_PREVIEW_DIR ? path.resolve(process.env.SELOAI_PREVIEW_DIR) : '';
if (scratchDir) try {
  fs.mkdirSync(scratchDir, { recursive: true });
  const world = createBalkanMythWorld();
  const mapW = world.map.width * BALKAN_TILE_DIM;
  const mapH = world.map.height * BALKAN_TILE_DIM;
  const preview = new Uint8ClampedArray(mapW * mapH * 4);
  for (let i = 0; i < preview.length; i += 4) {
    preview[i] = 24;
    preview[i + 1] = 33;
    preview[i + 2] = 27;
    preview[i + 3] = 255;
  }

  for (const layer of [...world.map.bgTiles, ...world.map.objectTiles]) {
    for (let x = 0; x < world.map.width; x++) {
      for (let y = 0; y < world.map.height; y++) {
        const idx = layer[x]?.[y] ?? -1;
        if (idx < 0) continue;
        const sx = (idx % BALKAN_TILESET_COLS) * BALKAN_TILE_DIM;
        const sy = Math.floor(idx / BALKAN_TILESET_COLS) * BALKAN_TILE_DIM;
        alphaBlit(
          preview,
          mapW,
          mapH,
          tilesetBuf.data,
          tilesetBuf.width,
          sx,
          sy,
          BALKAN_TILE_DIM,
          BALKAN_TILE_DIM,
          x * BALKAN_TILE_DIM,
          y * BALKAN_TILE_DIM,
        );
      }
    }
  }

  for (const v of world.villagers) {
    const sheet = spriteBuffers[v.id];
    if (!sheet) continue;
    alphaBlit(
      preview,
      mapW,
      mapH,
      sheet.data,
      sheet.width,
      0,
      0,
      32,
      32,
      v.homeTile.x * BALKAN_TILE_DIM,
      v.homeTile.y * BALKAN_TILE_DIM,
    );
  }

  const previewPath = path.join(scratchDir, 'balkan-myth-preview.png');
  fs.writeFileSync(previewPath, encodePngRgba(mapW, mapH, preview));
  console.log(`Generated composed map preview: ${previewPath} (${mapW}x${mapH})`);
} catch (err) {
  console.warn('Skipped scratch preview render:', err);
}
