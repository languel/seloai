import {
  BALKAN_PAL,
  applyContourOutline,
  createPixelBuffer,
  drawCrossStitch,
  drawEllipse,
  drawLine,
  fillRect,
  setPx,
} from './balkanPixelCore.ts';
import type { PixelBuffer, Rgba } from './balkanPixelCore.ts';
import type { CustomSpriteSheet, Direction } from './types.ts';

export type BalkanSpriteId =
  | 'lamia'
  | 'baba-rada'
  | 'kuker-marin'
  | 'stoyan'
  | 'samodiva-raina'
  | 'tsveta';

export const BALKAN_CHARACTER_SPRITE_IDS: readonly BalkanSpriteId[] = [
  'lamia',
  'baba-rada',
  'kuker-marin',
  'stoyan',
  'samodiva-raina',
  'tsveta',
] as const;

const DIRECTIONS: readonly Direction[] = ['down', 'left', 'right', 'up'];

export function getBalkanCustomSpriteSpec(id: BalkanSpriteId): CustomSpriteSheet {
  return {
    textureUrl: `/assets/spritesheets/balkan/${id}.png`,
    frameWidth: 32,
    frameHeight: 32,
    cols: 4,
    rows: 4,
    framesPerDirection: 4,
    rowMap: { down: 0, left: 1, right: 2, up: 3 },
  };
}

function blitFrame(sheet: PixelBuffer, frame: PixelBuffer, col: number, row: number): void {
  const ox = col * 32;
  const oy = row * 32;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const si = (y * 32 + x) * 4;
      const di = ((oy + y) * sheet.width + (ox + x)) * 4;
      sheet.data[di] = frame.data[si];
      sheet.data[di + 1] = frame.data[si + 1];
      sheet.data[di + 2] = frame.data[si + 2];
      sheet.data[di + 3] = frame.data[si + 3];
    }
  }
}

function drawGroundShadow(buf: PixelBuffer, cx = 16, rx = 6, color: Rgba = [20, 14, 14, 72]): void {
  const ry = 2;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1.0) continue;
      const px = Math.round(cx + dx);
      const py = Math.round(29 + dy);
      if (px < 0 || py < 0 || px >= buf.width || py >= buf.height) continue;
      const idx = (py * buf.width + px) * 4;
      if (buf.data[idx + 3] === 0) {
        buf.data[idx] = color[0];
        buf.data[idx + 1] = color[1];
        buf.data[idx + 2] = color[2];
        buf.data[idx + 3] = color[3];
      }
    }
  }
}

function renderLamiaFrame(dir: Direction, stepIdx: number): PixelBuffer {
  const f = createPixelBuffer(32, 32);
  const phase = stepIdx === 1 ? -1 : stepIdx === 3 ? 1 : 0;
  const bob = stepIdx === 1 || stepIdx === 3 ? -1 : 0;
  const sideFlip = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;

  // Coiling serpentine lower tail & scales (sinusoidal whip on walk frames)
  const tailShift = phase * 2 - sideFlip * 2;
  // Back coil loop
  drawEllipse(f, 16 + tailShift, 25, 7, 3, BALKAN_PAL.emeraldDark);
  drawEllipse(f, 16 + tailShift, 25, 5, 2, BALKAN_PAL.emerald);
  // Sweeping tail tip
  drawLine(f, 16 + tailShift, 26, 22 + tailShift + phase, 23, BALKAN_PAL.jade);
  setPx(f, 23 + tailShift + phase, 22, BALKAN_PAL.mintGlow);

  // Foreground primary coil
  drawEllipse(f, 16 - phase, 23, 6, 3, BALKAN_PAL.emerald);
  fillRect(f, 12 - phase, 21, 8, 3, BALKAN_PAL.jade);
  // Belly scale chevron stitches in crimson & gold
  for (let x = 13; x <= 18; x += 2) {
    setPx(f, x - phase, 22, BALKAN_PAL.gold);
    setPx(f, x + 1 - phase, 23, BALKAN_PAL.crimson);
  }

  // Rising serpentine waist into mist-pale maiden torso
  const torsoX = 16 + (sideFlip !== 0 ? sideFlip : 0);
  const torsoY = 14 + bob;
  fillRect(f, torsoX - 4, torsoY, 8, 8, BALKAN_PAL.emeraldDark);
  fillRect(f, torsoX - 3, torsoY + 1, 6, 6, BALKAN_PAL.emerald);
  // Embroidered golden-scarlet scale breastplate (shevitsa V-motif)
  setPx(f, torsoX, torsoY + 2, BALKAN_PAL.gold);
  setPx(f, torsoX - 1, torsoY + 1, BALKAN_PAL.crimsonHi);
  setPx(f, torsoX + 1, torsoY + 1, BALKAN_PAL.crimsonHi);
  setPx(f, torsoX - 2, torsoY + 3, BALKAN_PAL.mintGlow);
  setPx(f, torsoX + 2, torsoY + 3, BALKAN_PAL.mintGlow);

  // Flanking dragon-serpent fin crests behind shoulders (multi-aspect myth silhouette)
  drawLine(f, torsoX - 5, torsoY - 1, torsoX - 8, torsoY - 5 - phase, BALKAN_PAL.jade);
  setPx(f, torsoX - 8, torsoY - 5 - phase, BALKAN_PAL.gold);
  drawLine(f, torsoX + 4, torsoY - 1, torsoX + 7, torsoY - 5 + phase, BALKAN_PAL.jade);
  setPx(f, torsoX + 7, torsoY - 5 + phase, BALKAN_PAL.gold);

  // Slender clawed arms holding mist/offering challenge
  const armWave = stepIdx === 1 ? -1 : stepIdx === 3 ? 1 : 0;
  fillRect(f, torsoX - 5, torsoY + 1 + armWave, 2, 5, BALKAN_PAL.skinSpirit);
  fillRect(f, torsoX + 3, torsoY + 1 - armWave, 2, 5, BALKAN_PAL.skinSpirit);
  setPx(f, torsoX - 5, torsoY + 6 + armWave, BALKAN_PAL.mintGlow);
  setPx(f, torsoX + 4, torsoY + 6 - armWave, BALKAN_PAL.mintGlow);

  // Head & Twin Golden-Green Dragon Horns
  const hx = torsoX;
  const hy = 6 + bob;
  drawEllipse(f, hx, hy + 3, 4, 4, BALKAN_PAL.skinSpirit);
  // Emerald/midnight braided serpent tresses
  fillRect(f, hx - 4, hy, 8, 3, BALKAN_PAL.indigoDark);
  if (dir === 'up') {
    fillRect(f, hx - 4, hy + 1, 8, 6, BALKAN_PAL.indigoDark);
    drawCrossStitch(f, hx - 1, hy + 2, BALKAN_PAL.gold, BALKAN_PAL.jade, 3);
  } else if (dir === 'left' || dir === 'right') {
    const faceDir = dir === 'left' ? -1 : 1;
    fillRect(f, hx - faceDir * 2, hy + 2, 3, 5, BALKAN_PAL.indigoDark);
    setPx(f, hx + faceDir * 2, hy + 3, BALKAN_PAL.gold);
    setPx(f, hx + faceDir * 3, hy + 4, BALKAN_PAL.crimsonHi); // forked spark
  } else {
    setPx(f, hx - 2, hy + 3, BALKAN_PAL.gold);
    setPx(f, hx + 1, hy + 3, BALKAN_PAL.gold);
    setPx(f, hx, hy + 5, BALKAN_PAL.crimsonHi);
  }

  // Crown & Twin Horns
  drawLine(f, hx - 3, hy, hx - 5, hy - 3, BALKAN_PAL.gold);
  drawLine(f, hx + 2, hy, hx + 4, hy - 3, BALKAN_PAL.gold);
  setPx(f, hx, hy - 1, BALKAN_PAL.crimsonHi);
  setPx(f, hx - 1, hy, BALKAN_PAL.mintGlow);
  setPx(f, hx + 1, hy, BALKAN_PAL.mintGlow);

  applyContourOutline(f, BALKAN_PAL.ink);
  drawGroundShadow(f, 16, 8, [16, 48, 32, 92]);
  return f;
}

function renderFolkHumanFrame(
  config: {
    skin: Rgba;
    hatColor: Rgba;
    hatTrim: Rgba;
    tunic: Rgba;
    apronOrBelt: Rgba;
    trim: Rgba;
    skirt: boolean;
    pantsColor: Rgba;
    special: 'herbs' | 'kuker' | 'yunak' | 'samodiva' | 'weaver';
  },
  dir: Direction,
  stepIdx: number,
): PixelBuffer {
  const f = createPixelBuffer(32, 32);
  const legOffset = stepIdx === 1 ? -1 : stepIdx === 3 ? 1 : 0;
  const bob = stepIdx === 1 || stepIdx === 3 ? -1 : 0;
  const sideFlip = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const cx = 16;

  // Samodiva shimmering wing mist behind shoulders before drawing torso
  if (config.special === 'samodiva') {
    const flap = stepIdx === 1 ? -1 : stepIdx === 3 ? 1 : 0;
    drawEllipse(f, cx - 6, 16 + bob + flap, 3, 5, BALKAN_PAL.periwinkle);
    drawEllipse(f, cx + 6, 16 + bob - flap, 3, 5, BALKAN_PAL.periwinkle);
    setPx(f, cx - 7, 13 + bob + flap, BALKAN_PAL.waterFoam);
    setPx(f, cx + 6, 13 + bob - flap, BALKAN_PAL.waterFoam);
  }

  // Legs / Skirt / Footwear
  if (config.skirt) {
    fillRect(f, cx - 5, 20 + bob, 10, 7, config.pantsColor);
    // Stitched skirt hem border
    for (let x = cx - 4; x <= cx + 4; x += 2) {
      setPx(f, x, 25 + bob, config.trim);
      setPx(f, x + 1, 26 + bob, BALKAN_PAL.crimson);
    }
    // Peeking embroidered leather boots/barefeet
    fillRect(f, cx - 3 + legOffset, 27, 2, 2, BALKAN_PAL.woodDark);
    fillRect(f, cx + 1 - legOffset, 27, 2, 2, BALKAN_PAL.woodDark);
  } else {
    // Breeches & tsarvuli shoes
    fillRect(f, cx - 4, 21 + bob, 8, 4, config.pantsColor);
    fillRect(f, cx - 4 + legOffset, 24, 3, 4, config.pantsColor);
    fillRect(f, cx + 1 - legOffset, 24, 3, 4, config.pantsColor);
    fillRect(f, cx - 4 + legOffset, 27, 3, 2, BALKAN_PAL.woodDark);
    fillRect(f, cx + 1 - legOffset, 27, 3, 2, BALKAN_PAL.woodDark);
  }

  // Torso tunic / fleece coat
  const ty = 13 + bob;
  fillRect(f, cx - 5, ty, 10, 9, config.tunic);
  if (config.special === 'kuker') {
    // Shaggy goatskin kozhuh tuft texture
    for (let y = ty; y < ty + 8; y += 2) {
      for (let x = cx - 4; x <= cx + 3; x += 2) {
        setPx(f, x + ((y >> 1) & 1), y, BALKAN_PAL.fleeceDark);
      }
    }
  } else if (config.special === 'yunak') {
    // Crisp dark indigo braided elek vest leaving white sleeves/center riza plastron
    fillRect(f, cx - 3, ty, 2, 7, BALKAN_PAL.indigoDark);
    fillRect(f, cx + 1, ty, 2, 7, BALKAN_PAL.indigoDark);
    setPx(f, cx - 1, ty + 2, BALKAN_PAL.crimson);
    setPx(f, cx, ty + 2, BALKAN_PAL.crimson);
    setPx(f, cx - 1, ty + 4, BALKAN_PAL.gold);
    setPx(f, cx, ty + 4, BALKAN_PAL.crimson);
  } else if (config.special === 'weaver') {
    // Cross-stitched shoulder sleeves
    drawCrossStitch(f, cx - 5, ty + 1, BALKAN_PAL.crimsonHi, BALKAN_PAL.emerald, 2);
    drawCrossStitch(f, cx + 3, ty + 1, BALKAN_PAL.crimsonHi, BALKAN_PAL.emerald, 2);
  }

  // Waist Sash / Apron / Kuker Bronze Bells / Pafti Buckle
  fillRect(f, cx - 4, ty + 6, 8, 2, config.apronOrBelt);
  if (config.special === 'kuker') {
    // Three gleaming chanove bronze bells hanging along the waist belt
    const bellSwing = legOffset;
    for (const bx of [cx - 3, cx, cx + 3]) {
      fillRect(f, bx + bellSwing - 1, ty + 7, 2, 3, BALKAN_PAL.ochre);
      setPx(f, bx + bellSwing, ty + 7, BALKAN_PAL.gold);
    }
  } else if (config.special === 'weaver') {
    // Silver circular double pafti waist clasp
    setPx(f, cx - 1, ty + 6, BALKAN_PAL.silverHi);
    setPx(f, cx + 1, ty + 6, BALKAN_PAL.silverHi);
    setPx(f, cx, ty + 7, BALKAN_PAL.crimsonHi);
  } else if (config.special === 'herbs') {
    // Long Rhodope embroidered apron with Tree of Life
    fillRect(f, cx - 3, ty + 6, 6, 6, BALKAN_PAL.crimson);
    setPx(f, cx, ty + 7, BALKAN_PAL.gold);
    setPx(f, cx - 1, ty + 9, BALKAN_PAL.emerald);
    setPx(f, cx + 1, ty + 9, BALKAN_PAL.emerald);
    setPx(f, cx, ty + 10, BALKAN_PAL.gold);
  }

  // Arms & iconic handheld attribute
  const armY = ty + 2 + legOffset;
  fillRect(f, cx - 6, armY, 2, 5, config.tunic);
  fillRect(f, cx + 4, ty + 2 - legOffset, 2, 5, config.tunic);
  setPx(f, cx - 6, armY + 4, config.skin);
  setPx(f, cx + 5, ty + 6 - legOffset, config.skin);

  if (config.special === 'herbs') {
    // Gnarled wooden staff + emerald herb bundle
    drawLine(f, cx + 6, 10 + bob, cx + 6, 28, BALKAN_PAL.woodDark);
    setPx(f, cx + 6, 9 + bob, BALKAN_PAL.jade);
    setPx(f, cx + 7, 10 + bob, BALKAN_PAL.emerald);
  } else if (config.special === 'yunak') {
    // Iron bucket hook / silvered dagger hilt at sash
    drawLine(f, cx - 6, 17 + bob, cx - 7, 22 + bob, BALKAN_PAL.silver);
    setPx(f, cx - 7, 16 + bob, BALKAN_PAL.gold);
  } else if (config.special === 'weaver') {
    // Scarlet embroidery thread shuttle in left hand
    setPx(f, cx - 7, armY + 3, BALKAN_PAL.crimsonHi);
    setPx(f, cx - 7, armY + 4, BALKAN_PAL.gold);
  }

  // Head & Face / Hair / Folk Headgear
  const hx = cx + sideFlip;
  const hy = 5 + bob;
  drawEllipse(f, hx, hy + 4, 4, 4, config.skin);

  // Back/side hair or headscarf drape
  if (dir === 'up') {
    fillRect(f, hx - 4, hy + 1, 8, 7, config.hatColor);
    drawCrossStitch(f, hx - 1, hy + 4, config.hatTrim, BALKAN_PAL.crimson, 2);
  } else {
    const exOffset = sideFlip;
    if (sideFlip === 0) {
      setPx(f, hx - 2, hy + 4, BALKAN_PAL.ink);
      setPx(f, hx + 1, hy + 4, BALKAN_PAL.ink);
    } else {
      setPx(f, hx + exOffset * 2, hy + 4, BALKAN_PAL.ink);
    }
  }

  // Bespoke folk hats / masks / crowns
  if (config.special === 'kuker') {
    // Tall crimson-black painted wooden Kuker mask with white tooth stitch & curved horns!
    fillRect(f, hx - 4, hy + 1, 8, 6, BALKAN_PAL.crimsonDark);
    fillRect(f, hx - 3, hy + 2, 6, 2, BALKAN_PAL.gold);
    setPx(f, hx - 2, hy + 3, BALKAN_PAL.ink);
    setPx(f, hx + 1, hy + 3, BALKAN_PAL.ink);
    // White jagged mask teeth
    setPx(f, hx - 2, hy + 6, BALKAN_PAL.linenHi);
    setPx(f, hx, hy + 6, BALKAN_PAL.linenHi);
    setPx(f, hx + 2, hy + 6, BALKAN_PAL.linenHi);
    // Curved horns & crimson tassel plume
    drawLine(f, hx - 3, hy + 1, hx - 5, hy - 3, BALKAN_PAL.ink);
    drawLine(f, hx + 3, hy + 1, hx + 5, hy - 3, BALKAN_PAL.ink);
    setPx(f, hx - 5, hy - 3, BALKAN_PAL.crimsonHi);
    setPx(f, hx + 5, hy - 3, BALKAN_PAL.crimsonHi);
    fillRect(f, hx - 1, hy - 2, 2, 3, BALKAN_PAL.gold);
  } else if (config.special === 'yunak') {
    // Tall curly sheep-wool black kalpak with crimson ribbon & pine sprig
    fillRect(f, hx - 4, hy - 1, 8, 4, BALKAN_PAL.inkSoft);
    fillRect(f, hx - 3, hy - 2, 6, 2, BALKAN_PAL.ink);
    setPx(f, hx - 2, hy + 1, BALKAN_PAL.crimsonHi);
    setPx(f, hx + 2, hy, BALKAN_PAL.jade);
  } else if (config.special === 'samodiva') {
    // Long flowing golden-auburn hair & colorful flower venets crown
    fillRect(f, hx - 5, hy + 1, 2, 7, BALKAN_PAL.auburn);
    fillRect(f, hx + 3, hy + 1, 2, 7, BALKAN_PAL.auburn);
    fillRect(f, hx - 4, hy, 8, 2, BALKAN_PAL.auburnHi);
    setPx(f, hx - 3, hy, BALKAN_PAL.crimsonHi);
    setPx(f, hx - 1, hy - 1, BALKAN_PAL.gold);
    setPx(f, hx + 1, hy - 1, BALKAN_PAL.periwinkle);
    setPx(f, hx + 3, hy, BALKAN_PAL.rose);
  } else if (config.special === 'herbs') {
    // Crisp white linen kerchief with crimson embroidered border
    fillRect(f, hx - 4, hy, 8, 3, BALKAN_PAL.linenHi);
    drawLine(f, hx - 4, hy + 2, hx - 3, hy + 7, BALKAN_PAL.linenMid);
    drawLine(f, hx + 3, hy + 2, hx + 2, hy + 7, BALKAN_PAL.linenMid);
    setPx(f, hx, hy + 1, BALKAN_PAL.crimson);
  } else if (config.special === 'weaver') {
    // Braided dark hair crown adorned with crimson geraniums & gold coin braid
    fillRect(f, hx - 4, hy, 8, 3, BALKAN_PAL.inkSoft);
    setPx(f, hx - 3, hy + 1, BALKAN_PAL.crimsonHi);
    setPx(f, hx + 2, hy + 1, BALKAN_PAL.crimsonHi);
    setPx(f, hx, hy, BALKAN_PAL.gold);
  }

  applyContourOutline(f, BALKAN_PAL.ink);
  drawGroundShadow(f, cx, 6);
  return f;
}

export function renderBalkanCharacterSheetPixels(id: BalkanSpriteId): PixelBuffer {
  const sheet = createPixelBuffer(128, 128);
  for (let row = 0; row < DIRECTIONS.length; row++) {
    const dir = DIRECTIONS[row];
    for (let col = 0; col < 4; col++) {
      let frame: PixelBuffer;
      if (id === 'lamia') {
        frame = renderLamiaFrame(dir, col);
      } else if (id === 'baba-rada') {
        frame = renderFolkHumanFrame(
          {
            skin: BALKAN_PAL.skinPale,
            hatColor: BALKAN_PAL.linenHi,
            hatTrim: BALKAN_PAL.crimson,
            tunic: BALKAN_PAL.linenMid,
            apronOrBelt: BALKAN_PAL.crimson,
            trim: BALKAN_PAL.gold,
            skirt: true,
            pantsColor: BALKAN_PAL.indigoDark,
            special: 'herbs',
          },
          dir,
          col,
        );
      } else if (id === 'kuker-marin') {
        frame = renderFolkHumanFrame(
          {
            skin: BALKAN_PAL.skinWarm,
            hatColor: BALKAN_PAL.crimsonDark,
            hatTrim: BALKAN_PAL.gold,
            tunic: BALKAN_PAL.fleece,
            apronOrBelt: BALKAN_PAL.crimson,
            trim: BALKAN_PAL.gold,
            skirt: false,
            pantsColor: BALKAN_PAL.inkSoft,
            special: 'kuker',
          },
          dir,
          col,
        );
      } else if (id === 'stoyan') {
        frame = renderFolkHumanFrame(
          {
            skin: BALKAN_PAL.skinWarm,
            hatColor: BALKAN_PAL.inkSoft,
            hatTrim: BALKAN_PAL.crimsonHi,
            tunic: BALKAN_PAL.linenHi,
            apronOrBelt: BALKAN_PAL.crimson,
            trim: BALKAN_PAL.gold,
            skirt: false,
            pantsColor: BALKAN_PAL.indigoDark,
            special: 'yunak',
          },
          dir,
          col,
        );
      } else if (id === 'samodiva-raina') {
        frame = renderFolkHumanFrame(
          {
            skin: BALKAN_PAL.skinPale,
            hatColor: BALKAN_PAL.auburn,
            hatTrim: BALKAN_PAL.rose,
            tunic: BALKAN_PAL.linenHi,
            apronOrBelt: BALKAN_PAL.periwinkle,
            trim: BALKAN_PAL.rosePale,
            skirt: true,
            pantsColor: BALKAN_PAL.linenMid,
            special: 'samodiva',
          },
          dir,
          col,
        );
      } else {
        frame = renderFolkHumanFrame(
          {
            skin: BALKAN_PAL.skinWarm,
            hatColor: BALKAN_PAL.inkSoft,
            hatTrim: BALKAN_PAL.crimsonHi,
            tunic: BALKAN_PAL.linenHi,
            apronOrBelt: BALKAN_PAL.crimsonDark,
            trim: BALKAN_PAL.silverHi,
            skirt: true,
            pantsColor: BALKAN_PAL.crimsonDark,
            special: 'weaver',
          },
          dir,
          col,
        );
      }
      blitFrame(sheet, frame, col, row);
    }
  }
  return sheet;
}
