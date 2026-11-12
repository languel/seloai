# SeloAI Custom Characters, Maps & Generative Asset Guide

This guide explains how to author custom characters, tilesets, and maps for **SeloAI**—and includes ready-to-use **reference grid templates** and **prompts** you can send to image generation models (Gemini Image, Flux, Midjourney, ComfyUI) or LLMs.

---

## 1. Reference Template Files (`public/templates/`)

All templates are also accessible directly inside the **Guides & Templates** tab of the web app:

- `character-spritesheet-template-96x128.png` — Exact `96×128 px` (`3 cols × 4 rows` of `32×32 px` frames) character walk-cycle template.
- `character-spritesheet-template-384x512.png` — `4×` upscaled (`384×512 px`) version of the same grid. **Send this one to image models** (they align much better at `384×512`), then downscale back to `96×128` using nearest-neighbor!
- `tileset-template-512x512.png` — `512×512 px` (`16×16` grid of `32×32` tiles) divided into semantic terrain/building/prop zones.
- `villager-character-template.json` — JSON schema/example for LLM-generated villagers.
- `village-map-template.json` — Minimal column-major `[x][y]` map JSON template for LLM-generated levels.

---

## 2. Custom Character Spritesheet Specification

### Exact Grid Layout (`96×128` default)
| Row (0-indexed) | Direction | Col 0 (`x=0`) | Col 1 (`x=32`) | Col 2 (`x=64`) |
|---|---|---|---|---|
| **Row 0** (`y=0`) | `down` (front) | Idle / Step L | Stand | Step R |
| **Row 1** (`y=32`) | `left` | Idle / Step L | Stand | Step R |
| **Row 2** (`y=64`) | `right` | Idle / Step L | Stand | Step R |
| **Row 3** (`y=96`) | `up` (back) | Idle / Step L | Stand | Step R |

> **Tip:** In the **Characters** tab, click **Upload Custom Sprite PNG** and adjust `Frame W`, `Frame H`, `Frames / Dir`, and `Down Row` if your sheet uses custom dimensions.

### Prompt for Image Models (Character Spritesheet)
Attach `character-spritesheet-template-384x512.png` as a reference image and prompt:

```text
Create a top-down 2D pixel-art RPG character spritesheet strictly matching the attached 3x4 grid template (384x512 px, 3 columns x 4 rows of 128x128 cells representing 32x32 pixel blocks).
Subject: A fantasy village weaver wearing a tailored linen tunic with geometric trim, dark wool vest, and leather boots.
Layout rules:
- Row 1 (top): facing DOWN (front view), 3 walking animation frames (left foot, neutral, right foot).
- Row 2: facing LEFT, 3 walking animation frames.
- Row 3: facing RIGHT, 3 walking animation frames.
- Row 4 (bottom): facing UP (back view), 3 walking animation frames.
Style: Crisp 16-bit/32-bit pixel art, clean dark outlines, flat solid #00FF00 chroma-key or transparent background, NO grid lines, NO text labels, centered cleanly inside each cell's safe box.
```

---

## 3. Custom Map & Fantasy Tileset Specification

### Tileset Grid (`512×512` = 256 tiles of `32×32 px`)
- **Tile size**: `32×32 px` (`tileDim: 32`) — also supports `16px`, `48px`, `64px`, or custom `px` in the Level Editor
- **Seamless ground tiles** (Rows 0–2): Meadow grass, clover, worn earth.
- **Paths & bridges** (Rows 3–5): Cobblestone, packed dirt, wooden footbridge.
- **Water & shores** (Rows 6–7): Deep brook water, reed edges, stone banks.
- **Cottages & roofs** (Rows 8–11): Timber and stone cottage walls, slate/thatch roofs, painted shutters.
- **Trees & fences** (Rows 12–13): Birch, pine, orchard trees, wood/stone fences.
- **Props & details** (Rows 14–15): Craft stalls, hearths, barrels, lanterns, rugs.

### Prompt for Image Models (Fantasy Village Tileset)
Attach `tileset-template-512x512.png` as a reference image and prompt:

```text
Create a seamless 2D top-down RPG pixel-art tileset strictly aligned to the attached 16x16 grid of 32x32 pixel tiles (512x512 px total).
Visual theme: Cozy medieval/fantasy pixel art — muted stone and earth ground tones, weathered timber, slate roofs, moss green, and warm lantern accents.
Zone layout matching the reference colors:
- Rows 1-3 (green zone): seamless meadow grass, clover, wildflower patches, bordered grass edges.
- Rows 4-6 (tan zone): cobblestone plaza tiles, dirt footpath edges, wooden bridge planks.
- Rows 7-8 (blue zone): clear creek water, shoreline edges, river reeds.
- Rows 9-12 (cream zone): stone and half-timbered cottage walls, slate/thatch roofs, timber doors and window frames.
- Rows 13-14 (dark green zone): oak and pine trees, berry bushes, wooden fences and stone walls.
- Rows 15-16 (crimson zone): craft tables, hearth firepit, barrels, street lanterns, woven rugs.
Rules: Orthographic top-down 3/4 RPG perspective, crisp pixel edges, NO anti-aliasing blur, NO visible black grid lines in the output, transparent background around object tiles.
```

---

## 4. Map JSON Structure (for LLMs)

SeloAI maps are column-major `[x][y]` (`width` columns, each of length `height`), indexed from `0` left-to-right, top-to-bottom across the tileset:

```ts
tileIndex = tileCol + tileRow * Math.floor(tileSetDimX / tileDim)
```

Empty cells use `-1`. When asking an LLM to generate a map, provide `village-map-template.json` and instruct it to keep all arrays `width` columns × `height` rows and mark solid walls/water as `true` in `collisionGrid`.

---

## 5. Post-Processing Checklist

1. **Downscale with Nearest-Neighbor**: If your image model output is `384×512` (4×) or `1024×1024` (2×), resize it in Photoshop/Aseprite/ImageMagick using `Nearest Neighbor` (`-filter point -resize 96x128` or `512x512`) so pixels stay razor-sharp.
2. **Make Background Transparent**: Remove the solid background color around sprites and object tiles.
3. **Upload in SeloAI**:
   - **Characters tab** → **Upload Custom Sprite PNG** (preview all 4 walk directions live!).
   - **Level Editor tab** → **Custom PNG** in the Tileset panel (paint & click **Apply to Live Village**).

---

## 6. Tapestry Studio (In-App Digitizer & Output Composer) & `compose_pixel_pattern`

Instead of preparing pixel sheets solely in external tools, you can author tiles and multi-tile **Macro Stamps** directly inside SeloAI:

1. Open the **Tapestry Studio** tab in the top bar:
   - **Create Mode**: Upload any reference illustration or textile motif, pinch-zoom & two-finger pan around details, quantize or trace onto an indexed pixel canvas, paint with the **Sample** palette brush (eyedroppers the reference image underneath into the closest palette color per pixel), remove flat backgrounds via **Chroma-Key** / edge fill, auto-slice motifs, and save patterns into your **Pattern Library** (with live procedural Canvas2D code export).
   - **Preview Output Composer**: Start from a **Blank** tileset or click **Import Cur Tileset** to inspect and extend the live map's tileset safely in a draft view. Click or drag items from the **Pattern Library** directly onto the output grid—each lands in an open non-overlapping slot and can be freely dragged and resized via its 8-handle transform box (`Shift` locks aspect ratio; grid snap aligns to `tileDim`). Click **+ Row** to expand sheet height, **Export** for PNG download, **Apply to Map** to update the map's tileset & stamps, or **Apply & Place** to paint directly onto the map.
2. **Programmatic / Agent Asset Synthesis (`compose_pixel_pattern` & `scripts/generateShevitsaTileset.mjs`)**:
   - Agents connected over WebMCP, `window.seloAI`, or stdio MCP (`pnpm mcp`) can call `compose_pixel_pattern` with either indexed `grid` + `palette` or human-readable `asciiRows` + `paletteMap`, optionally setting `outCols`/`outRows`, `targetCol`/`targetRow`, `layer` (`bg0`/`bg1`/`obj0`/`obj1`), and `placeAt` (`{ x, y }`).
   - Run `node scripts/generateShevitsaTileset.mjs` to regenerate the built-in 512×512 `public/assets/shevitsa-tileset.png` programmatically.
