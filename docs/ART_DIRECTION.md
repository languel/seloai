# SeloAI art direction and implementation guide

This is the working brief for whoever continues the visual overhaul. It records what the
owner asked for in their own terms, the decisions already made, how the art system is
built, what is finished, what is weak, and the order to tackle the rest. Read it fully
before changing anything under `src/art/`.

Status on 2026-11-16: the art system exists and drives the live village view. The owner's
verdict on the current state: "looks great", with two named gaps: the animation "could use
more charm and refinement", and the interface must be refined "to match the now beautiful
world and chars".

---

## 1. What the owner wants

These are requirements, in the owner's words where quoted.

1. **Artistic and expressive**, not tidy or generic. "We want artistic and expressive vibes."
2. **Generative, not textured.** The museum and folklore references exist to inspire
   algorithms. "Rather than use these for textures, we want to develop generative
   algorithms inspired by the historic context." Never trace, sample or embed a reference
   image.
3. **Everything procedural and swappable.** "A few simple looks. One is clean simple line
   art and then the more complicated authentic looking but simulated embroidery/needlework.
   If we work procedurally we should be able to swap things out relatively easy without
   having to regenerate pixel assets."
4. **Characters with life.** Different skin-tone threads; a face with "barely suggested
   eyes, mouth, nose" so expressions read; "outlines and fills for more variety"; "a bit
   less stick figure and more outsider folk art".
5. **Thread as a mechanic**, eventually, "as well as decor".
6. **Not 2D forever.** The 2D work should later serve as the minimap of a 3D world (the
   owner mentioned generative voxel or gaussian-splat scenes). `~/dev/vale` is their example
   of the pipeline they like: build the scene once in 3D, project to 2D plates, finish with
   a print-look shader graph.
7. **A clean break from ai-town** and from any third-party bitmap art.
8. **A general engine.** The Balkan village is one demo. Nothing setting-specific belongs
   in engine or art-system code; it belongs in a world pack.

9. **Wang tiles for maps.** "We also want to look into Wang tiles for the maps so we have
   more flexibility in creating rich and diverse worlds."
10. **Ambient density.** "In general we also want the environment to have more ambient
    density, e.g. forest groves rather than sparse trees, villages instead of sparse houses."

11. **Embroidered text.** "It would be amazing if the text can look like embroidery too."
    The owner recalled single-stroke vector fonts; the best known are the Hershey fonts.
12. **No solid slabs.** Of the dark label, bubble and menu backgrounds: "the solid
    backgrounds don't look great now that our visual style is so nice", and "same for menus".
14. **Bubbles must not cover characters, heads above all.** "Be careful for the bubbles not
    to obscure the characters esp heads", "make some dynamic layout relative to positions",
    "or you can have text dynamically wrap around chars if needed".
13. **Glyph buttons.** "In general use glyphs where possible for buttons with hover tips if
    needed."

The owner's overall verdict on the direction: "as a whole though I love this direction."

Near-term target the owner set earlier: a black-and-white game and editor on Balkan folklore
with fully procedural maps, characters and storylines in a needlework aesthetic.

### References

- National History Museum, embroidery collection:
  `https://historymuseum.org/колекция-шевици/`
- Hidden symbols in Bulgarian embroidery: `https://www.foreigner.bg/skritite-simvoli-v-bulgarskite-shevitsi/`
- `https://www.lifebites.bg/balgarskite-shevici/` (not yet studied)
- Vibe reference for the eventual 3D look: `https://patch.gg/blendi/oil-paint` (not yet studied)
- Local pipeline reference: `~/dev/vale` (read its `README.md`)

What the museum pieces actually look like, which the current work is modelled on:

- Coarse undyed linen ground with visible weave.
- **Free embroidery**, not only counted cross-stitch: curving stems, spiral tendrils,
  flower heads, eight-pointed stars, chevron-striped leaves, hooked comb forms.
- A central cartouche or medallion with sprigs radiating in four-fold symmetry.
- A **counted geometric band** of stepped diamonds along a hem, between guide lines.
- A fringe or zigzag edge finished with sequins, and a stitched selvedge of small crosses.
- Rows of dots (running stitch or knots) used as frames and fillers.
- Colour: red dominant; deep blue, green, magenta, metallic gold; black for outline.
- Dense. A maker fills gaps rather than leave bare cloth.

Symbol vocabulary from the folklore source, for motif grammars: the Tree of Life (three
tiers: crown for the heavens, trunk for the earth, roots for the underworld), the
mother-goddess figure (a birthing woman flanked by sun and moon), the kanatitsa (a rhombus
with wing triangles, the family sign), the elbetitsa (eight directions around a centre).
Colour meanings: red for the mother's blood and protection from the evil eye, green for
eternal life and the Tree of Life, yellow for sun and fire, white for purity. Embroidery was
placed at the openings of a garment (neck, cuffs, hem) because that is where harm could
enter. These meanings are usable as mechanics later (section 9).

**Do not generate the hooked cross.** The folklore source lists a "broken cross" sun sign.
It is a swastika form and must not appear. Avoid any four-fold rotational arrangement of
hooked arms. Use the eight-pointed star, and give hooks mirror symmetry, never rotational.

---

## 2. The central idea

**Generators output shapes. Looks draw shapes. Nothing in between is a pixel.**

```
world pack ─▶ semantic scene ─▶ shapes ─▶ look ─▶ canvas
                (what is where)  (what to    (how it
                                  draw)       appears)
```

- A **shape** carries geometry and an **ink role**, never a colour.
- A **look** maps roles to colours and decides the mark-making (ink contour, laid thread).
- Switching look regenerates nothing. The owner's "swap things out easily" requirement is
  satisfied by keeping this boundary intact. Any code that bakes a colour or a stitch
  texture into a generator breaks it.
- The same shapes are what a future 3D look would extrude or project. Keep generators free
  of canvas calls so that remains possible.

This replaced an earlier plan to make an indexed pixel grid the universal primitive. The
references are mostly free embroidery, so vector shapes are the primitive and counted work
is one shape kind among four.

---

## 3. File map

| File | Role |
| --- | --- |
| `src/art/shapes.ts` | The shape vocabulary, transforms (`place`, `mirrored`) and geometry helpers (`quadCurve`, `circle`, `cartouche`, `petal`, `curl`, `bounds`). No canvas. |
| `src/art/motifs.ts` | Generative motif grammars. No canvas. |
| `src/art/looks.ts` | Palettes and the two renderers (`renderLineArt`, `renderEmbroidery`, `paintLinen`). The only art file that draws. |
| `src/art/scene.ts` | The view-independent reading of a map: `SceneModel` (terrain kinds and placed features), `buildSceneModel`, the `TileSemantics` type. |
| `src/art/sceneArt.ts` | `SceneModel` to shapes (`sceneShapes`). Houses, pines, the well, the hearth, terrain marks. `UNITS_PER_TILE = 8`. |
| `src/art/gameLook.ts` | Glue for the running game: `WorldLook`, `WORLD_LOOK_OPTIONS`, `renderWorldLayer`, `getFigureSprite`, `paintFigure`. |
| `src/art/lettering.ts` | Embroidered text: a 5 by 7 counted-stitch sampler alphabet (`lettering`, `ribbon`, `letteringWidth`). |
| `src/art/lab.ts` + `art-lab.html` | The art lab page for judging motifs and looks by eye. |
| `src/world/packs/balkanSemantics.ts` | What each tile of the Balkan tileset means. |
| `src/world/packs/index.ts` | `tileSemanticsForMap(map)`. |
| `src/engine/renderer.ts` | `BodyPainter` hook in `drawVillager` and `drawPlayer`. |
| `src/components/VillageView.tsx` | Chooses the art layer or the tile layer per `aestheticSettings.worldLook`. |
| `src/utils/aestheticThemes.ts` | `AestheticSettings.worldLook`, default `'festive'`. |
| `src/components/AestheticStudioPanel.tsx` | The World Look selector (Style panel). |
| `src/art/__tests__/art.test.ts` | Tests for determinism, symmetry, palettes and scene reading. |

---

## 4. The shape vocabulary (`src/art/shapes.ts`)

Units are abstract: **1 unit is about one thread width**. Up is negative y. A figure is
30 units tall; a map cell is 8 units.

```ts
type Ink = 'primary' | 'secondary' | 'accent' | 'accent2' | 'gold' | 'dark' | 'skin';

type Shape =
  | { kind: 'area'; points: Pt[]; ink: Ink; grain: number; tone?: number }
  | { kind: 'line'; points: Pt[]; ink: Ink; weight: number; closed?: boolean }
  | { kind: 'knot'; at: Pt; r: number; ink: Ink }
  | { kind: 'counted'; origin: Pt; cell: number; cells: Array<[number, number, Ink]> };
```

- `area`: a filled polygon. `grain` (radians) is the direction threads or hatching run.
  Set it deliberately: along a petal, vertical on a skirt, horizontal on a bodice. Grain is
  most of what makes the thread look read as stitched. `tone` picks a variant of a role;
  today only `skin` uses it.
- `line`: a stroke. `weight` roughly 0.25 (a brow) to 1 (a belt). `closed` for outlines.
- `knot`: a dot. French knots, sequins, eyes, berries.
- `counted`: cross-stitch cells on a square grid. Stays axis-aligned under `place`.

Role conventions, so that looks stay interchangeable:

| Role | Meaning | Typical use |
| --- | --- | --- |
| `primary` | the dominant thread (red) | main fills, mouths |
| `secondary` | the cool counterweight (blue or black) | alternating petals, water |
| `accent` | green | leaves, pines, meadow tufts |
| `accent2` | magenta or a second warm | variation |
| `gold` | metallic highlight | centres, cuff bands, roads |
| `dark` | outline thread | stems, outlines, eyes, boots |
| `skin` | flesh, with `tone` | faces, necks, hands |

Rules:

- Compose with `place(shapes, { dx, dy, rot, scale, mirrorX })`. It returns copies and
  corrects `grain` under rotation and mirroring. Never mutate shape arrays.
- Use `mirrored(shapes)` for bilateral symmetry. Draw one side, mirror it.
- A generator takes an `Rng` (from `createSeededRng` in `src/core/rng.ts`) and must use only
  that for randomness. Never `Math.random`. Same seed must give byte-identical shapes; the
  tests check this.
- Adding a role or shape kind means updating **every** palette and **both** renderers in
  the same change. `Record<Ink, string>` and the exhaustive switches enforce it.

---

## 5. The looks, pinned

Two renderers, five palettes. All are in `PALETTES` in `src/art/looks.ts`. These values are
the agreed starting point; adjust them in that one table, not at call sites.

### 5.1 Line art (`renderLineArt`)

Clean contour with a slight hand. Tone comes from three treatments rather than colour:

| Role | Treatment |
| --- | --- |
| `primary`, `dark` | solid fill |
| `secondary`, `accent2` | hatched along `grain` |
| `accent`, `gold`, `skin` | open: paper fill, outlined |

- Stroke width is `0.3 × unit`, minimum 1px. Round caps and joins.
- Every point gets a small seeded wobble (0.12 units for areas, 0.08 for lines). This is
  the "hand". Keep it; do not make the line mechanically perfect.
- Open areas are filled with the ground colour first so they hide what is behind them.
  This is what lets a face sit on top of a neck.
- Skin outlines are drawn in `dark`.

Palettes:

- **`ink`**: ground `#f6f3ec`, all roles `#141312`. Black on paper. This is the
  black-and-white look the owner named as the near-term target.
- **`night`**: ground `#121110`, all roles `#f2eee4`. The same drawing as a white-line plate.

### 5.2 Simulated embroidery (`renderEmbroidery` over `paintLinen`)

Every mark is a thread.

- **Ground**: `paintLinen` lays horizontal warp shadows and vertical weft highlights at a
  pitch of `0.5 × unit`, plus occasional slubs (thicker threads, horizontal or vertical
  only).
- **Areas (satin stitch)**: a soft drop shadow offset by the `lift`, then parallel thread
  strokes swept across the shape at `grain`, clipped to the polygon. Each thread varies in
  lightness (0.82 to 1.12 of the role colour) and carries a thin sheen line. The polygon
  edge is jittered 0.22 units because a hand never follows the drawn edge exactly.
- **Lines (stem stitch)**: short slanted stitches overlapping along the path. Stitch length
  and width scale with `weight`, so a mouth takes fine short stitches and a stem takes long
  bold ones. Do not undo this; a fixed stitch length turned mouths into red slashes.
- **Knots**: a shaded disc with a radial highlight and a shadow.
- **Counted cells**: two crossed thread strokes with a shadow.
- Thread width is `0.5 × unit`, minimum 1.4px. Lift is `0.16 × unit`.

Palettes:

| Name | Ground | primary | secondary | accent | accent2 | gold | dark |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `blackwork` | `#e4dac6` | `#1c1a18` | `#2b2826` | `#1c1a18` | `#34302c` | `#3a352f` | `#141210` |
| `redBlack` | `#e6dcc8` | `#a8201a` | `#1d1a18` | `#7c1712` | `#c0392b` | `#b08a3c` | `#1d1a18` |
| `festive` | `#e3d8c2` | `#b0241c` | `#27407f` | `#2f6a3c` | `#a82e63` | `#b8923a` | `#231f1c` |

Skin tones: `redBlack` and `festive` share five warm tones, light to dark:
`#e8c9a4`, `#d2a679`, `#b07f52`, `#7f5536`, `#553623`. `blackwork` uses four neutral greys
(`#d8cdb8`, `#bfb39c`, `#a2957e`, `#7d7160`). The line-art palettes use the ground colour.

`blackwork` is the black-and-white needlework look. `redBlack` is the traditional
two-thread register. `festive` is the full museum palette and the current default.

### 5.3 Adding a look

A third renderer (woodcut, risograph, a 3D pass) implements the same signature,
`(ctx, shapes, LookOptions)`, and handles all four shape kinds and all seven roles. Then add
it to `WORLD_LOOK_OPTIONS` and to `isThread` or its successor in `gameLook.ts`. If a look
needs more than Canvas2D (the vale-style print pipeline needs a shader pass), render shapes
to a plate canvas first and post-process that, as vale does.

---

## 6. Motif grammars (`src/art/motifs.ts`)

Each is a small rule system, not a drawing.

- **Heads** (`star`, `blossom`, `tulip`, `comb`, `chevronLeaf`): the terminals that end a
  stem. `head(kind, size, rng)` picks warm and cool inks. Drawn pointing up from the origin
  so a caller can rotate them to face along a branch.
- **`treeOfLife(rng, height)`**: a mound and two root curls, a trunk, two or three mirrored
  branch pairs each ending in a head, optional tendrils and knots, and a crown.
- **`medallion(rng, radius)`**: a cartouche with four inset lozenges and a centre, four
  axial sprigs and four diagonal sprigs (square symmetry), inside a frame of knots.
- **`countedBand(rng, cells, cell)`**: stepped diamonds in cycling inks between two guide
  lines, with a zigzag fringe ending in sequins.
- **`figure(rng, options)`**: see section 7.
- **`cloth(rng)`**: a composition of the above with a stitched selvedge. Use it as the
  model for title cards, loading screens and panel decoration.

When adding motifs:

- Start from a structural rule in the references (an axis, a symmetry group, a register),
  then vary proportion, count and head choice from the seed.
- Be bold. The first pass had small heads on long stems and looked timid; heads were
  enlarged about 1.6 times. When in doubt, make the motif larger and the cloth denser.
- Fill gaps with knots or small sprigs, as a maker would.
- Missing and worth adding: the kanatitsa, the mother-goddess with sun and moon, birds,
  a vine border that turns corners, a proper Lamia (serpent) and other creature forms.

### 6.1 Lettering (`src/art/lettering.ts`)

Text is drawn by the looks like everything else.

- `lettering(text, { cell, ink, tracking, align })` sets a line as a `counted` shape on a
  5 by 7 grid: capitals, digits and `. , : ! ? ' - &`. Lowercase is set as capitals, as on
  a sampler, and accented letters fall back to their plain base. Unknown characters become
  a space. The glyph table is original to this project.
- `ribbon(text, options)` adds guide lines above and below and a knot at each end. The
  world layer uses it to stitch the place name at the top of the cloth
  (`SceneModel.title`, taken from the map name before any colon).
- A stitch needs about 3 screen pixels to read in the thread looks. Below that, use real
  text.

Next steps for lettering:

1. **Cyrillic.** The setting is Bulgarian; add the Cyrillic capitals to the glyph table.
2. **A stroke alphabet** for stem-stitch script: glyphs as polylines (`line` shapes), which
   reads as hand embroidery and scales to any size. The Hershey fonts are the classic
   single-stroke vector fonts and are public domain, but they are third-party data. Either
   author an original stroke alphabet, or ask the owner before importing Hershey data,
   since the project rule is no third-party assets.
3. **Use it in the interface** for headings, tab names and the title screen. Body text and
   chat stay as real text for legibility.

---

## 7. Characters

`figure(rng, { height, expression?, skinTone? })` builds a standing figure from a seed.
In the game, `getFigureSprite(id, look, heightPx)` seeds it from `hashString(id)`, so a
character looks the same in every look and every session.

What exists:

- Bell skirt in one of three treatments: solid; outlined with a stitched pattern (dots,
  stripes or diamonds); solid under a contrasting apron.
- Bodice, solid or open with a placket of knots. A gold belt.
- Sleeves with volume: either the white chemise sleeve (outline plus cuff bands) or a filled
  sleeve. Four arm poses: raised, offering (holding a sprig), akimbo, resting. Hands in skin.
- Neck, head, hair cap in one of several inks, optional hair falls.
- A face: eyes, brows, nose stroke, mouth. Five expressions in `EXPRESSIONS`: `calm`,
  `glad`, `grim`, `awed`, `sly`. Brow tilt and mouth curve carry the mood.
- Four headdresses: crown of knots, kerchief, horns, wreath.
- Boots, hem knots, and a slight lean so no two stand alike.

Done since the first pass:

- **Parts and joints.** `figureParts(rng, options)` returns legs, skirt, torso, head and two
  arms with pivots (waist, neck, both shoulders), the person's lean and their resting
  expression. `figure()` flattens it. The seed fixes the person; changing `expression`
  changes only the face (the generator always draws the seeded values first so the rest of
  the figure cannot shift).
- **The rig.** `getFigureRig(id, look, heightPx, expression)` renders each part to its own
  cached canvas; only the head is re-rendered per expression. `paintRig` poses the parts
  every frame with eased motion: walking blends in and out over about 0.2 s, a step bobs
  and squashes at foot contact, the skirt swings late, arms swing opposite, the head lags,
  the body leans into travel, turning round squashes the figure through its edge, idle
  figures breathe and sway, talking nods and gestures with the right arm, thinking tilts
  the head. Per-character easing state lives in `motionMemory`.
- **Expressions from the simulation.** `expressionFor(state, line)` maps thinking to `sly`,
  listening and conversing to `calm`, and speaking to `grim`, `awed` or `glad` from a small
  word list and a trailing question mark. Otherwise the resting expression shows.
- **Lab.** `/art-lab.html?seed=11&only=motion` animates walk, idle, two kinds of speech,
  thinking and listening in line art and thread.

What is wrong and needs doing, in priority order:

1. ~~Expression is fixed by the seed.~~ Done as above; the sentiment rule is crude. Feed it
   the conversation's tone from the model, or a per-line mood tag, when one exists.
2. **More charm still.** The rig is a good base, not a finished performance. Next: an
   anticipation dip before the first step, a small overshoot settle on stopping, blinks,
   headdress and hair lag (split them off the head), a skirt hem that ripples rather than
   rotates rigidly, and per-character gait (some brisk, some shuffling) from the seed.
   Judge every change in the motion lab row first.
3. **Former item 1, kept for its detail.** Expression was fixed by the seed. It should follow the simulation. Map
   `VillagerRuntime.state` and the tone of the last line to an expression (thinking to
   `sly` or `calm`, speaking to `glad` or `grim` by sentiment, listening to `awed`). The
   sprite cache key in `getFigureSprite` must then include the expression. Five expressions
   per character per look is cheap.
4. **Former item 2, now largely done; kept for its notes.** Animation lacked charm (the owner's explicit note). Today walking is a rotation and a
   bob of one cached image (`paintFigure`). Wanted: squash and stretch on each step, a skirt
   that swings out of phase with the body, arms that swing, a head that leads the turn, a
   small settle when stopping, idle breathing, a gesture when speaking, an anticipation lean
   before moving. Because figures are shapes, animate **parameters** (arm path, skirt hem
   offsets, head tilt) and regenerate, or split the figure into separately cached parts
   (skirt, torso, head, each arm) and transform those. The second is cheaper per frame and
   is the recommended route. Ease everything; nothing should move linearly.
5. **Figures ignore who the character is.** Lamia Zmeitsa is a serpent but is drawn as a
   villager. Add figure "kinds" selected by the world pack per cast member (human, serpent,
   masked kuker, samodiva), and let `VillagerConfig` traits steer skirt, headdress and inks.
   Put the mapping in the pack, not in `figure`.
6. **More outsider folk art.** The owner's note was "a bit less stick figure". Sleeves and
   boots helped. Push further: uneven hems, hands of different sizes, heads off-centre,
   patterns that do not quite line up, bolder oversized motifs on aprons, occasional
   profile figures. Asymmetry is the point.
7. **Legibility at game size.** Faces and garment patterns vanish in the thread looks at
   normal zoom. Options: simplify detail by size (a level-of-detail switch in `figure`),
   enlarge heads further at small sizes, or thicken face marks relative to thread width.
8. Men, children and elders. Every figure is currently a skirted adult.

---

## 8. The world and tile maps

The world is drawn from **meaning**, not from tile images.

1. `buildSceneModel(map, semantics)` reads every layer of a `VillageMap` and produces a
   `SceneModel`: a `Terrain` per cell (`ground`, `water`, `road`, `dry`, `wall`, `bridge`)
   and a list of features (`house`, `tree`, `pine`, `well`, `hearth`, `star`, `pool`,
   `wheat`, `flowers`, `prop`) with footprint and a stable seed.
2. `sceneShapes(model)` turns that into shapes.
3. `renderWorldLayer(map, look, semantics)` draws it once into a map-sized canvas, which
   `VillageView` caches by map identity and look.

`TileSemantics` is a function from tile id to `{ terrain?, feature? }`. A multi-tile object
is recognised by the tile at its top-left cell. For Zmeyovo the model finds 161 water
cells, 95 road, 96 dry, 17 wall, 8 bridge, and 47 features including 3 houses, 22 trees,
the well and the hearth.

**Maps with no semantics** (Shevitsa, anything imported or hand-painted) fall back to
collision as `wall` plus a `star` at each point of interest. That is legible but plain.

Current terrain marks: water is two running wave lines per cell with phase tied to world x
so cells join; roads are a diagonal pair of gold cross-stitches per cell; walls are a dense
two-colour counted block; dry ground is scattered knots and the odd crack; bridges are plank
lines; meadow is a sparse tuft in about 8% of cells.

To generalise properly, in order:

1. **Move tile meanings into the world pack.** Add an optional `tileSemantics` (or a data
   table that builds one) to `WorldPack`, and stop matching on the tileset URL in
   `tileSemanticsForMap`. Write the table for Shevitsa.
2. **Make the semantic scene the authored thing.** The long-term shape of a world is the
   `SceneModel`, with tile grids derived from it for the classic look, not the reverse.
   New world generators should emit terrain and features directly. Extend `WorldDocument`
   and the commands in `src/world/commands.ts` with scene-level edits (place a house, paint
   water) so editors and agents work in meaning.
3. **Better terrain drawing.** Roads should read as a couched band with stitched edges and
   turn corners; water needs banks and should thicken where it is wide; walls should be a
   real counted border pattern; the meadow could carry a faint all-over diaper pattern.
   Use neighbour lookups (already available as `is(x, y, kind)` in `terrainShapes`) for
   edges and corners.
4. **A cloth border for the map.** Frame the whole world with a counted band, selvedge and
   fringe so the map is visibly one embroidered cloth.
5. **Depth.** Features are sorted by their bottom edge but are all baked into one static
   layer, so characters never pass behind a house or tree. Split tall features into a
   second layer drawn after characters, or y-sort features with characters.
6. **Scale.** The world layer is rendered at one pixel per map pixel and is scaled by the
   camera, so it blurs when zoomed in. Render at the device pixel ratio times the current
   zoom band, or re-render on zoom settle.
7. **Performance.** `renderWorldLayer` runs once per map and look. For big maps render in
   chunks. `figureCache` is cleared wholesale past 160 entries; make it an LRU.

### 8.1 Wang tiles for rich, varied worlds (owner request, not started)

The engine already has a Wang tile solver in `src/engine/wangTiling.ts`, used today only on
tile images:

- `applyWangEdgeMask`, `applyWangCornerVertices`, `paintWangEdgeCell`,
  `paintWangCornerCell`: turn a boolean mask into the right one of 16 tiles per cell.
- `solveEdgeColoredWangGrid` with pinned edges and `pickNonRepeatingVariant`: fill a grid
  with edge-coloured tiles so that neighbours always match and no pattern visibly repeats.

Use the same idea one level up, on meaning instead of images:

1. **Define Wang chunks of scene.** A chunk is a small patch of `SceneModel` (say 6×6
   cells) with a label on each of its four edges describing what crosses it: `meadow`,
   `road`, `water`, `forest`, `village`. A chunk with `road` on its west and east edges
   carries a road across; one with `forest` on all four is deep grove.
2. **Generate chunks procedurally**, several variants per edge signature, from a seed. A
   variant is a small generator, not a stored grid.
3. **Solve the chunk grid** with the existing edge-coloured solver, pinning edges where the
   world needs something specific (a river entering at the north, a road to the well).
4. **Stamp chunks into one `SceneModel`.** Because neighbours agree on their shared edge,
   roads and rivers run continuously and biomes blend.

This gives worlds that are coherent at the large scale and varied at the small scale, from a
seed, with no repeated screen. It also suits agents: "a river valley with two villages and
a forest between" becomes a set of pinned edges. Keep the classic Wang tile images working
for the `tiles` look; they are a separate, older use of the same solver.

Within a cell, the art system can also use Wang logic for terrain marks: choose the road or
water drawing for a cell from which of its four neighbours share its terrain, exactly as
`paintWangEdgeCell` does, so bands turn corners and end cleanly.

### 8.2 Ambient density (owner request, not started)

The current world is sparse: 22 trees and 3 houses on a 48×36 map. The owner wants groves
and villages. Density should come from **clusters with structure**, not from raising a
scatter probability:

- **Groves.** Grow trees from a few grove centres with density falling off with distance,
  spaced by Poisson-disc sampling so they pack without overlapping. Mix sizes and species
  within a grove; put undergrowth (ferns, mushrooms, flowers, fallen logs) between trunks
  and a ragged edge of shrubs. A grove is a `Wang chunk` kind and also a feature in itself.
- **Villages.** Houses belong along roads, facing them, in a row or around a square, each
  with a yard: a fence, a garden plot, a well, a woodpile, a haystack, washing on a line.
  Generate the lot first, then the house in it. Vary house size and roof.
- **Fields and commons.** Strips of wheat, vines on trellises, orchards in rows, a
  threshing floor, beehives, a graveyard, a roadside shrine.
- **Water life.** Reeds, stepping stones, a mill, washing stones, ducks.
- **Ground cover.** The meadow should carry an all-over pattern of small motifs (as a
  maker fills a ground) that thins near paths and thickens at the edges.

Rules for density: keep walkable routes and every point of interest reachable (use
`findPath` in `src/engine/pathfinding.ts` to check), mark collision for anything solid, and
keep characters legible by leaving the ground quieter along roads and in squares. Dense
features must be depth-sorted with characters (section 8, item 5) or the village will look
like a flat sticker sheet.

---

## 9. Thread as a mechanic

The owner wants thread to be part of play, not only decoration. Nothing is built. Ideas
that fit the engine as it stands, cheapest first:

- **Conversation threads.** While two characters talk, draw a stitched line between them
  that grows stitch by stitch with each turn. `VillagerRuntime.activeConversationId` gives
  the pairs.
- **Relationship threads.** The Control Room already derives a graph of who has spoken to
  whom (`src/engine/observatory.ts`). Draw those as threads on the cloth: thickness for
  frequency, role colour for sentiment, frayed when a relationship sours.
- **The story as a cloth.** Each completed scene adds a motif to a growing band at the
  edge of the map, so the session leaves an embroidered record. This suits the Scribe.
- **Following a thread.** The player picks up a thread to follow one storyline across
  characters, which also answers the owner's complaint that the stream is overwhelming.
- **Protection and openings.** In the source tradition embroidery guards the openings of a
  garment. A character's embroidered pattern could be a readable stat: what they are
  guarded against, what they are open to.

Draw mechanic threads as ordinary `line` shapes through the active look so they match the
world in every look.

---

## 10. The interface (started)

The owner's instruction: refine the UI "to match the now beautiful world and chars". The
HUD, speech bubbles, name pills, sidebar and panels predate the art system and now clash
with it.

Where the current styling lives:

- Shell tokens: CSS variables in `src/index.css`, mapped in `tailwind.config.js`.
- HUD and canvas overlays: `src/utils/aestheticThemes.ts` (five hardcoded presets resolved
  to inline styles and a `CanvasThemeConfig`).
- Bubbles and name pills are drawn on the canvas in `src/engine/renderer.ts`.
- The views are very large single files with no shared primitives: `VillageView.tsx`,
  `MonitorView.tsx`, `TapestryStudioView.tsx`, `LevelEditorView.tsx`, `App.tsx`.

Done so far, as a first pass only:

- In an art look, canvas labels and bubbles are patches of the ground colour with
  running-stitch borders and ink text (`clothOverlayColours` in `src/art/gameLook.ts`,
  `CanvasThemeConfig.stitched`). The dark slabs are gone from the world view.
- The in-world HUD takes the light `parchment-chronicle` styling on cloth looks and
  `frosted-obsidian` on the night plate (`resolveAestheticTokens`).
- With the theme set to System, the app shell goes light beside cloth and paper looks and
  dark beside the night plate (`App.tsx`).

- Bubbles anchor above the real head height of the taller art figures
  (`bodyHeightScale`, `FIGURE_HEIGHT_SCALE`), and every character's body is reserved as a
  top-priority rectangle in the label layout (`reserveBodySpace` feeding
  `resolveOverlappingRects` in `src/engine/renderer.ts`), so other characters' bubbles and
  labels are placed around bodies instead of over them.

This removes the clash but is recolouring, not design. Everything below is still to do.

**Bubble layout, next steps.** The layout is a greedy rectangle de-overlapper: it moves
whole bubbles. The owner also suggested text that wraps around characters. Options, in
order of effort: (a) choose the bubble's side (above, left, right) from where neighbours
and the screen edge are, with the tail drawn to match; (b) shape the bubble's width to the
free space before wrapping the text; (c) flow lines of text around body rectangles, using
the reserved body rects as exclusion zones per line. Whatever is done, a head must never
be covered, and a bubble must stay visibly attached to its speaker.

Direction:

0. **Glyph buttons** (owner request). Prefer an icon to a text label wherever the meaning
   is clear, with a hover tip. The toolbar still spells out Pause, Paths, Labels, Speech,
   Thoughts, Subtitles, Follow, Scatter and Eavesdrop. Draw the glyphs with the art system
   (a small `Shape[]` per icon rendered through the active look) so they match the cloth,
   rather than using the `lucide-react` set.
1. **One source of truth.** Derive interface colours from the active look's palette, so
   switching World Look restyles the whole app. The line-art looks give a paper-and-ink UI;
   the thread looks give linen panels with stitched borders.
2. **Draw chrome with the art system.** Panel borders as a counted band or running stitch,
   dividers as a row of knots, buttons as stitched outlines, a selected state as a filled
   satin block. Render these to small cached canvases or CSS `border-image` sources.
3. **Bubbles and labels through the look.** A speech bubble as a stitched outline patch on
   the cloth; a thought as a looser dotted outline; name labels as small embroidered
   ribbons. Keep text itself as crisp real text for legibility.
4. **Typography.** Choose a face that sits with hand-made work and reads at small sizes.
   The two bundled pixel fonts (`upheaval_pro.ttf`, `vcr_osd_mono.ttf`) came from ai-town;
   the owner wants a clean break, so replace them and delete the files.
5. **Quiet the HUD.** The world is now the picture. Reduce chrome, lower contrast of
   controls at rest, and let the cloth run to the edges.
6. **Build shared primitives first** (button, panel, tab, slider, tooltip) before
   restyling the big views, or the work will be done five times.
7. Remove the old preset system in `aestheticThemes.ts` once the look-driven tokens cover
   it, and the Balkan-named options in generic settings along with it.

Check both a line-art look and a thread look at every step; a restyle that only works in
one has missed the point.

---

## 11. Working method

- **Show, do not describe.** This is visual work and the owner steers by seeing it. After
  any visual change, open it in the browser pane and look at it yourself before reporting.
  The owner reacts to what is on screen; several rounds of this got the figures right.
- **Use the lab.** `pnpm dev`, then `/art-lab.html?seed=7`. Add `&only=cloth`, `figures` or
  `trees` to isolate a row. Change the seed to see variety. Extend `src/art/lab.ts` with a
  row for anything new (animation frames, UI chrome, a new motif) so it can be judged in
  isolation and in every look at once.
- **Judge at game size too.** Things that look good at 120px can be mush at 50px. The
  village view is the real test.
- **Iterate in small visible steps** and say plainly what is still weak. The owner has
  responded well to honest lists of weaknesses.
- **Checks before reporting done:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, and a look
  at the running app. `pnpm build` before anything is merged to `main`, because pushing
  `main` deploys the public site.
- **Reproducibility.** `pnpm sim:headless --seed 7 --seconds 120` must keep giving the same
  digest for the same seed. The art system is separate from the simulation, but anything
  that feeds art back into the simulation must use the seeded sources.

### Rules

- No reference image, museum photograph or third-party bitmap in the repository or the
  output. Algorithms only.
- No hooked cross (section 1).
- No setting-specific strings or motifs in `src/art/shapes.ts`, `src/art/looks.ts`,
  `src/art/scene.ts` or the engine. Balkan-specific forms may live in `motifs.ts` for now
  but should move into a pack-level motif set once a second setting exists.
- No `Math.random` or `Date.now` in generators.
- No colours in generators. Roles only.
- Do not reintroduce ai-town assets or formats.
- Git: commit only when asked; branch before committing; do not push `main` without the
  owner's say-so.

---

## 12. Suggested order of work

1. ~~Animation charm, first pass~~ and ~~expressions from the simulation~~: done (section 7).
   Continue with the "more charm still" list there.
2. **Glyph toolbar** (section 10, item 0). Small and the owner asked for it.
3. **Interface restyle** (section 10). The owner named it. Primitives first, then bubbles
   and labels, then the HUD, then panels.
4. **Cast-specific figures** (section 7, item 3), starting with Lamia.
5. **Ambient density**: groves, villages with yards, fields (section 8.2), with depth
   sorting so characters walk among them. The owner named it.
6. **Wang chunks** for coherent, varied, seeded worlds (section 8.1). The owner named it.
7. **World polish**: map border, better roads and water (section 8).
8. **Tile meanings in packs** and a Shevitsa table (section 8).
9. **Conversation threads** as the first thread mechanic (section 9).
10. **Folk-art push and legibility at size** (section 7, items 4 and 5).
11. **Scene-level world authoring** and procedural world generators (section 8, item 2).
12. **A print-pipeline look** in the manner of vale, then the first 3D experiment.

## 13. Related documents

- `HANDOFF.md`: architecture of the whole app, commands for running and testing.
- `README.md`: features, world packs, commands and the headless runner.
- Engine state this art work sits on: the simulation is headless and reproducible, worlds
  are packs (`src/world/`), and every edit to the authored world is a command through
  `WorldStore`. Art work should use those, not bypass them.
