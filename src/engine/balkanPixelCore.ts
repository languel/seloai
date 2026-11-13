export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Rgba = readonly [number, number, number, number];

/** Cohesive Balkan folk-embroidery (shevitsa) & folklore pigment palette. */
export const BALKAN_PAL = {
  clear: [0, 0, 0, 0] as Rgba,
  ink: [28, 20, 20, 255] as Rgba,
  inkSoft: [54, 37, 34, 255] as Rgba,

  // Unbleached linen weave
  linenHi: [242, 231, 209, 255] as Rgba,
  linenMid: [224, 209, 180, 255] as Rgba,
  linenShade: [198, 179, 145, 255] as Rgba,

  // Madder crimson & carmine wool threads
  crimson: [184, 31, 40, 255] as Rgba,
  crimsonHi: [224, 54, 62, 255] as Rgba,
  crimsonDark: [120, 18, 26, 255] as Rgba,

  // Saffron ochre & harvest gold
  ochre: [217, 146, 38, 255] as Rgba,
  gold: [244, 198, 78, 255] as Rgba,
  ochreDark: [158, 96, 22, 255] as Rgba,

  // Balkan mountain greens & serpentine lamia scales
  emerald: [32, 107, 68, 255] as Rgba,
  emeraldDark: [20, 68, 44, 255] as Rgba,
  jade: [60, 163, 106, 255] as Rgba,
  mintGlow: [134, 232, 174, 255] as Rgba,

  // Danube indigo & Pirin sky blues
  indigo: [36, 62, 109, 255] as Rgba,
  indigoDark: [22, 38, 72, 255] as Rgba,
  periwinkle: [108, 146, 214, 255] as Rgba,
  skyWater: [76, 148, 196, 255] as Rgba,
  waterDeep: [43, 102, 148, 255] as Rgba,
  waterFoam: [214, 238, 248, 255] as Rgba,
  murkWater: [74, 102, 72, 255] as Rgba,
  murkRim: [110, 146, 94, 255] as Rgba,

  // Pirin rose & plum
  rose: [217, 107, 136, 255] as Rgba,
  rosePale: [242, 178, 196, 255] as Rgba,
  plum: [118, 42, 84, 255] as Rgba,

  // Meadow, drought clay, river cobble & carved timber
  meadow: [92, 140, 69, 255] as Rgba,
  meadowHi: [122, 172, 90, 255] as Rgba,
  meadowDark: [64, 106, 48, 255] as Rgba,
  dryEarth: [170, 138, 90, 255] as Rgba,
  dryEarthHi: [198, 168, 118, 255] as Rgba,
  dryEarthDark: [120, 90, 52, 255] as Rgba,
  cobble: [168, 152, 128, 255] as Rgba,
  cobbleHi: [198, 184, 160, 255] as Rgba,
  cobbleDark: [114, 101, 86, 255] as Rgba,
  slate: [110, 107, 104, 255] as Rgba,
  slateHi: [148, 144, 138, 255] as Rgba,
  slateDark: [72, 70, 68, 255] as Rgba,
  wood: [142, 88, 50, 255] as Rgba,
  woodHi: [178, 118, 72, 255] as Rgba,
  woodDark: [92, 54, 30, 255] as Rgba,
  terracotta: [181, 73, 46, 255] as Rgba,
  terracottaHi: [214, 102, 66, 255] as Rgba,
  terracottaDark: [134, 46, 28, 255] as Rgba,
  silver: [204, 212, 222, 255] as Rgba,
  silverHi: [238, 242, 248, 255] as Rgba,

  // Skins & fleece
  skinWarm: [230, 184, 146, 255] as Rgba,
  skinShade: [194, 144, 108, 255] as Rgba,
  skinPale: [238, 214, 198, 255] as Rgba,
  skinSpirit: [206, 232, 214, 255] as Rgba,
  skinSpiritShade: [150, 194, 168, 255] as Rgba,
  fleece: [232, 222, 200, 255] as Rgba,
  fleeceDark: [164, 148, 122, 255] as Rgba,
  auburn: [164, 74, 38, 255] as Rgba,
  auburnHi: [204, 106, 56, 255] as Rgba,
} as const;

export function createPixelBuffer(width: number, height: number): PixelBuffer {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

export function setPx(buf: PixelBuffer, x: number, y: number, color: Rgba): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= buf.width || iy >= buf.height) return;
  const idx = (iy * buf.width + ix) * 4;
  if (color[3] === 0) {
    buf.data[idx] = 0;
    buf.data[idx + 1] = 0;
    buf.data[idx + 2] = 0;
    buf.data[idx + 3] = 0;
    return;
  }
  buf.data[idx] = color[0];
  buf.data[idx + 1] = color[1];
  buf.data[idx + 2] = color[2];
  buf.data[idx + 3] = color[3];
}

export function getPxAlpha(buf: PixelBuffer, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return 0;
  return buf.data[(y * buf.width + x) * 4 + 3];
}

export function fillRect(buf: PixelBuffer, x: number, y: number, w: number, h: number, color: Rgba): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPx(buf, x + dx, y + dy, color);
    }
  }
}

export function drawEllipse(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: Rgba,
): void {
  if (rx <= 0 || ry <= 0) return;
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      const nx = dx / rx;
      const ny = dy / ry;
      if (nx * nx + ny * ny <= 1.0) {
        setPx(buf, cx + dx, cy + dy, color);
      }
    }
  }
}

export function drawLine(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba,
): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const sx = ax < bx ? 1 : -1;
  const dy = -Math.abs(by - ay);
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(buf, ax, ay, color);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

/** Paint a tiny tactile 2x2 or 3x3 cross-stitch X onto linen or fabric. */
export function drawCrossStitch(
  buf: PixelBuffer,
  x: number,
  y: number,
  hiColor: Rgba,
  shadowColor: Rgba = hiColor,
  size: 2 | 3 = 3,
): void {
  if (size === 2) {
    setPx(buf, x, y, hiColor);
    setPx(buf, x + 1, y + 1, hiColor);
    setPx(buf, x + 1, y, shadowColor);
    setPx(buf, x, y + 1, shadowColor);
    return;
  }
  setPx(buf, x, y, hiColor);
  setPx(buf, x + 2, y, shadowColor);
  setPx(buf, x + 1, y + 1, hiColor);
  setPx(buf, x, y + 2, shadowColor);
  setPx(buf, x + 2, y + 2, hiColor);
}

/** Subtle linen weave background used under embroidered carpets & cloth panels. */
export function fillLinenWeave(buf: PixelBuffer, x0: number, y0: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const checker = ((dx + dy) & 1) === 0;
      const rib = dx % 4 === 0 || dy % 4 === 0;
      const color = rib
        ? BALKAN_PAL.linenShade
        : checker
          ? BALKAN_PAL.linenHi
          : BALKAN_PAL.linenMid;
      setPx(buf, x0 + dx, y0 + dy, color);
    }
  }
}

/** Mirror a quarter/octant or arbitrary stamp region cleanly with optional 4-way mirror. */
export function drawSymmetryPoint(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  color: Rgba,
  fourWay = true,
): void {
  setPx(buf, cx + dx, cy + dy, color);
  setPx(buf, cx - dx - 1, cy + dy, color);
  if (fourWay) {
    setPx(buf, cx + dx, cy - dy - 1, color);
    setPx(buf, cx - dx - 1, cy - dy - 1, color);
  }
}

/** Add a crisp 1px dark contour outline around opaque pixels of a standalone frame/sprite. */
export function applyContourOutline(
  buf: PixelBuffer,
  outlineColor: Rgba = BALKAN_PAL.ink,
): void {
  const copy = new Uint8ClampedArray(buf.data);
  const alphaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return 0;
    return copy[(y * buf.width + x) * 4 + 3];
  };
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      if (alphaAt(x, y) > 0) continue;
      if (
        alphaAt(x - 1, y) > 0 ||
        alphaAt(x + 1, y) > 0 ||
        alphaAt(x, y - 1) > 0 ||
        alphaAt(x, y + 1) > 0
      ) {
        setPx(buf, x, y, outlineColor);
      }
    }
  }
}

/** Deterministic integer hash in [0, 1) for crisp organic pebble/tuft texture. */
export function hash2d(x: number, y: number, seed = 17): number {
  let n = Math.imul(x + 37, 374761393) + Math.imul(y + 101, 668265263) + Math.imul(seed, 1274126177);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export type StitchMode =
  | 'cross'
  | 'cross-fine'
  | 'tent'
  | 'twill-h'
  | 'twill-v'
  | 'linen'
  | 'satin';

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/** Shift RGB brightness of a palette color while preserving alpha. */
export function shiftRgba(color: Rgba, delta: number): Rgba {
  if (color[3] === 0) return color;
  return [
    clampByte(color[0] + delta),
    clampByte(color[1] + delta),
    clampByte(color[2] + delta),
    color[3],
  ];
}

/** Linearly blend two RGBA colors (`t` in [0, 1]). */
export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    clampByte(a[0] + (b[0] - a[0]) * k),
    clampByte(a[1] + (b[1] - a[1]) * k),
    clampByte(a[2] + (b[2] - a[2]) * k),
    clampByte(a[3] + (b[3] - a[3]) * k),
  ];
}

/**
 * Period-4 phase-locked needlework relief modulation.
 * Every period (`2` or `4`) evenly divides 32px tile dimensions so yarn ribs
 * and cross-stitch cells continue unbroken across every Wang tile seam.
 */
export function getStitchDelta(x: number, y: number, mode: StitchMode): number {
  const ix = Math.round(x);
  const iy = Math.round(y);
  const sx = ix & 3;
  const sy = iy & 3;

  switch (mode) {
    case 'cross': {
      if (sx === sy) return sx === 1 || sx === 2 ? 17 : 12;
      if (sx + sy === 3) return 4;
      return -17;
    }
    case 'cross-fine': {
      const fx = ix & 1;
      const fy = iy & 1;
      const cellWave = ((ix & 2) ^ (iy & 2)) === 0 ? 3 : -3;
      return (fx === fy ? 10 : -11) + cellWave;
    }
    case 'tent': {
      const d = (ix + iy) & 3;
      if (d === 0) return 14;
      if (d === 1) return 3;
      if (d === 2) return -14;
      return -4;
    }
    case 'twill-h': {
      const ridge = (sx + ((iy & 1) << 1)) & 3;
      const rowAlt = (iy & 1) === 0 ? 4 : -4;
      const val = ridge === 0 ? 11 : ridge === 1 ? 3 : ridge === 2 ? -10 : -3;
      return val + rowAlt;
    }
    case 'twill-v': {
      const ridge = (sy + ((ix & 1) << 1)) & 3;
      const colAlt = (ix & 1) === 0 ? 4 : -4;
      const val = ridge === 0 ? 11 : ridge === 1 ? 3 : ridge === 2 ? -10 : -3;
      return val + colAlt;
    }
    case 'linen': {
      if (sx === 0 && sy === 0) return -15;
      if (sx === 2 && sy === 2) return 9;
      if (sx === 2 || sy === 2) return 4;
      return ((sx ^ sy) & 1) === 0 ? 1 : -5;
    }
    case 'satin': {
      const band = (ix + iy * 2) & 3;
      if (band === 0) return 13;
      if (band === 1) return 5;
      if (band === 2) return -8;
      return -2;
    }
  }
}

/** Paint a single pixel with phase-locked stitch sheen & recessed Aida grain. */
export function setStitchPixel(
  buf: PixelBuffer,
  x: number,
  y: number,
  baseColor: Rgba,
  mode: StitchMode = 'cross',
  dyeShift = 0,
): void {
  if (baseColor[3] === 0) {
    setPx(buf, x, y, baseColor);
    return;
  }
  const delta = getStitchDelta(x, y, mode) + dyeShift;
  setPx(buf, x, y, shiftRgba(baseColor, delta));
}

export function fillStitchedRect(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  baseColor: Rgba,
  mode: StitchMode = 'cross',
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setStitchPixel(buf, x + dx, y + dy, baseColor, mode);
    }
  }
}

export function fillStitchedEllipse(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  baseColor: Rgba,
  mode: StitchMode = 'cross',
): void {
  if (rx <= 0 || ry <= 0) return;
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      const nx = dx / rx;
      const ny = dy / ry;
      if (nx * nx + ny * ny <= 1.0) {
        setStitchPixel(buf, cx + dx, cy + dy, baseColor, mode);
      }
    }
  }
}

/**
 * Draw an open 4x4 cross-stitch X at `(x, y)` leaving the 8 outer woven substrate
 * pixels visible underneath — authentic counted cross-stitch over linen or meadow.
 */
export function drawCellCrossStitch(
  buf: PixelBuffer,
  x: number,
  y: number,
  topThread: Rgba,
  underThread: Rgba = shiftRgba(topThread, -26),
): void {
  const hi = shiftRgba(topThread, 14);
  // Top arm (\) over bottom arm (/)
  setPx(buf, x + 3, y, underThread);
  setPx(buf, x + 2, y + 1, underThread);
  setPx(buf, x + 1, y + 2, underThread);
  setPx(buf, x, y + 3, underThread);

  setPx(buf, x, y, topThread);
  setPx(buf, x + 1, y + 1, hi);
  setPx(buf, x + 2, y + 2, hi);
  setPx(buf, x + 3, y + 3, topThread);
}

/** Hand-sewn backstitch contour line with subtle needle-hole tuck along every Nth step. */
export function drawBackstitchLine(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba,
  stitchLen = 3,
): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const sx = ax < bx ? 1 : -1;
  const dy = -Math.abs(by - ay);
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let step = 0;
  const tuck = shiftRgba(color, -18);
  const crown = shiftRgba(color, 10);
  for (;;) {
    const m = stitchLen > 1 ? step % stitchLen : 1;
    setPx(buf, ax, ay, m === 0 ? tuck : m === 1 ? crown : color);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
    step += 1;
  }
}
