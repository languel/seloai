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
Subject: An Eastern European village weaver wearing an embroidered white linen vyshyvanka tunic with geometric crimson and indigo cross-stitch patterns, dark wool vest, and boots.
Layout rules:
- Row 1 (top): facing DOWN (front view), 3 walking animation frames (left foot, neutral, right foot).
- Row 2: facing LEFT, 3 walking animation frames.
- Row 3: facing RIGHT, 3 walking animation frames.
- Row 4 (bottom): facing UP (back view), 3 walking animation frames.
Style: Crisp 16-bit/32-bit pixel art, clean dark outlines, flat solid #00FF00 chroma-key or transparent background, NO grid lines, NO text labels, centered cleanly inside each cell's safe box.
```

---

## 3. Custom Map & Embroidery Tileset Specification

### Tileset Grid (`512×512` = 256 tiles of `32×32 px`)
- **Tile size**: `32×32 px` (`tileDim: 32`)
- **Seamless ground tiles** (Rows 0–2): Linen meadow grass, wild chamomile, woven earth.
- **Paths & bridges** (Rows 3–5): Cobblestone, packed dirt, wooden footbridge.
- **Water & shores** (Rows 6–7): Deep indigo brook, reed edges.
- **Cottages & roofs** (Rows 8–11): Whitewashed clay *khata* walls, thatched roofs, painted shutters.
- **Trees & fences** (Rows 12–13): Birch, rowanberry, willow, woven wattle fence.
- **Folk props & rushnyk borders** (Rows 14–15): Wooden loom, pottery, lanterns, red/black embroidered border strips.

### Prompt for Image Models (Embroidery-Inspired Tileset)
Attach `tileset-template-512x512.png` as a reference image and prompt:

```text
Create a seamless 2D top-down RPG pixel-art tileset strictly aligned to the attached 16x16 grid of 32x32 pixel tiles (512x512 px total).
Visual theme: Eastern European folk embroidery (vyshyvanka & rushnyk) blended with cozy pastoral pixel art — warm unbleached linen ground tones, madder crimson, indigo blue, golden ochre, and forest sage.
Zone layout matching the reference colors:
- Rows 1-3 (green zone): seamless meadow grass, clover, wildflower patches, embroidered border grass.
- Rows 4-6 (tan zone): cobblestone plaza tiles, dirt footpath edges, wooden bridge planks.
- Rows 7-8 (blue zone): clear creek water, shoreline edges, river reeds.
- Rows 9-12 (cream zone): whitewashed village cottage walls, thatched roofs, carved timber doors and window frames.
- Rows 13-14 (dark green zone): birch trees, rowanberry bushes, woven wattle fences.
- Rows 15-16 (crimson zone): wooden weaving loom, hearth firepit, clay jugs, folk lanterns, decorative cross-stitch rug tiles.
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
