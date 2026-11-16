/**
 * Renders interface glyphs through a look into small cached images, so a button icon is
 * inked or stitched exactly like the world behind it.
 */
import type { WorldLook } from './gameLook';
import { glyphShapes, type GlyphName } from './glyphs';
import { PALETTES, renderEmbroidery, renderLineArt, type LookOptions, type PaletteName } from './looks';

const GLYPH_BOX = 16;
const cache = new Map<string, string>();

function isThread(look: PaletteName): boolean {
  return look !== 'ink' && look !== 'night';
}

/**
 * The look a glyph is drawn in. On a dark surface every look falls back to the night
 * plate's light line; on a light surface the night plate and the classic tiles use ink.
 */
export function glyphLookFor(worldLook: WorldLook, darkSurface: boolean): PaletteName {
  if (darkSurface) return 'night';
  if (worldLook === 'tiles' || worldLook === 'night') return 'ink';
  return worldLook;
}

/** True when a CSS hex colour is light, meaning the surface under it is dark. */
export function isLightColour(colour: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return false;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const n = parseInt(hex, 16);
  const luminance = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return luminance > 150;
}

/**
 * A data URL of the glyph, `cssSize` CSS pixels square, drawn at `pixelRatio`. The ground is
 * left transparent so the glyph sits on whatever panel holds it.
 */
export function glyphDataUrl(name: GlyphName, look: PaletteName, cssSize: number, pixelRatio = 2): string {
  const px = Math.max(8, Math.round(cssSize * pixelRatio));
  const key = `${name}|${look}|${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  // Leave a margin so stitches and wobble never clip at the edge.
  const unit = px / (GLYPH_BOX + 2);
  const options: LookOptions = { unit, origin: [px / 2, px / 2], palette: PALETTES[look], seed: 7 };
  const shapes = glyphShapes(name);
  if (isThread(look)) renderEmbroidery(ctx, shapes, options);
  else renderLineArt(ctx, shapes, options);

  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
