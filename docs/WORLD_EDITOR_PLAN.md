# World editor and character editor: plan

Decisions (owner, 2026-11-16): retire the Tapestry Studio and the Classic tiles look. Worlds
are authored as places, procedurally, and edited by hand on top. Characters likewise.

## The idea in one line

A world and a character are each **a recipe plus hand edits**: a generator with typed
parameters and a seed makes the thing, and the person's own edits are kept as a separate
layer on top, so rerolling the seed or changing a parameter never throws away their work.

## 1. The scene is the authored world

Today the authored thing is a tile grid (`VillageMap.bgTiles`), and the art looks read it
back into a `SceneModel` through the tile-meaning tables. Turn that round.

- `WorldScene` (new, plain data, saved on the map as `map.scene`):
  - `recipe`: `{ generator, params, seed }`.
  - `edits`: an ordered list of hand edits — paint terrain over cells, place, move or remove a
    feature, add or move a landmark or spawn point, rename. Edits address features by a
    stable id, so they survive a reroll where they still make sense and are reported where
    they do not.
- `bakeScene(scene)` runs the generator, applies the edits, adds ambience, and returns the
  `SceneModel`. Deterministic: same recipe and edits, same world.
- `mapFromScene(model)` derives everything the simulation needs: the walkability grid (water
  and walls block except at bridges; houses, wells, trees and hearths block their
  footprint; groves, fields and flowers do not), points of interest from landmarks, spawn
  points, size and name. No tiles.
- Generators live in a registry with a typed parameter schema
  (`int | float | enum | bool`, with ranges and defaults), so the editor builds its controls
  from the schema and agents get the same schema. First generators:
  - `wang-valley`: the Wang worlds (river in/out, hamlets, forest share, size).
  - `from-tiles`: an existing tile map read through its meaning table, so Zmeyovo and
    Shevitsa become scenes and keep working.
- Commands (`src/world/commands.ts`), so every edit is one undo step and the agent API works
  unchanged through `apply_world_commands`: `scene.setRecipe`, `scene.paintTerrain`,
  `scene.placeFeature`, `scene.moveFeature`, `scene.removeFeature`, `scene.upsertLandmark`,
  `scene.removeLandmark`, `scene.upsertSpawn`, `scene.removeSpawn`, `scene.clearEdits`.

First visible result: **the Wang worlds become playable** — characters walk them, talk at
their landmarks, and the art looks draw them.

## 2. The World editor (replaces Level Editor and Tapestry Studio)

One tab, in the stitched interface style (StitchPanel, glyph buttons, knot dividers).

- **Recipe panel**: generator picker, controls built from its schema, the seed with a dice
  button, "reroll keeps my edits" by default, and a count of edits that no longer apply.
- **Canvas**: the world drawn live in the current art look, pan and zoom, with optional
  overlays for walkability, the chunk grid, landmarks and spawns.
- **Tools** (glyph buttons with hover tips): select and move; paint terrain (ground, water,
  road, dry ground, wall, bridge) with a brush size; place feature (a palette of feature
  kinds drawn as small stitched thumbnails); erase; landmark; spawn point.
- **Edits list**: every hand edit, newest first, each removable, with "clear all edits".
- New, open bundled, import and export a world pack. Undo and redo through the world store.

## 3. The Character editor (procedural)

The figure today comes entirely from the seed, plus build and kind. Make every trait
visible and overridable, the same recipe-plus-edits way.

- `VillagerConfig.figure` gains `seed?` (default from the id) and `traits?`: optional
  overrides for headdress, skirt style and pattern, inks, apron, sleeves, pose, hair,
  skin tone, resting expression, carried flower, quirks. Overrides apply after the seed has
  drawn everything, so changing one never shifts another.
- The editor: a live rig preview (four directions walking, the five expressions, the
  portrait), a dice for a new seed, and a control per trait with a lock, so "reroll" keeps
  the locked traits. Persona and voice fields stay as they are.
- The bitmap `ModularCharacterCreator`, custom sprite sheets and the sprite preview go.

## 4. The director camera (story mode)

Owner request: the camera directs itself so the world unfolds like a story, and the viewer
can take over at any moment to explore another plotline. Today the camera only follows a
selected character (`followSelected` in `VillageView`) or is moved by hand; the Scribe POV
switch changes whose story is narrated, not what we see.

- **A shot planner** (pure, testable, `src/engine/director.ts`) reads the simulation each
  tick (who is speaking to whom, who arrives at a landmark, who is walking where, what the
  Scribe just narrated, the focal worldline) and scores what is worth watching.
- **Shots**, each a target rectangle the camera eases or cuts to:
  - *establishing*: wide on a landmark or the whole place, at the start and after a lull;
  - *two-shot*: framing everyone in a conversation, the speech bubbles included;
  - *close*: on the speaker for a strong line (a question, a threat, a gift);
  - *follow*: tracking someone walking to something that matters;
  - *reaction*: a short look at the listener after a line lands.
- **Grammar**: a minimum and maximum shot length; **cut** when the subject changes place,
  **ease** (pan and zoom) when it stays; no ping-pong between two shots; cut on a new line
  of dialogue rather than mid-line; return to a wide shot when nothing is happening.
- **Taking over**: any drag, zoom, click on a character or keyboard move hands the camera to
  the viewer at once. A "Story" glyph button (and a few seconds idle, if the viewer wants
  that) gives it back. Clicking a character while in story mode makes their thread the
  plotline the director favours (and moves the Scribe POV with it), so the viewer steers
  the story without driving the camera.
- **In the headless runner and agent API**: the director's shot list is a plain event
  stream, so a run can be replayed as a cut later.

## 5. The Loom: the world's psychohistory (replaces the Observatory graph)

Owner request: the interaction map should belong to the theme and be navigable in a more
intricate way, in the spirit of Hari Seldon's Prime Radiant, but where the threads are
actual threads. Today the Observatory has a graph (characters on an ellipse, places on a
larger one, straight edges), a database view and a text "loom" of beats, in the old
interface style with lucide icons.

The picture: **the whole history of the world as a piece of weaving.**

- **Warp and weft.** Time runs along the cloth. Each character is a thread in their own
  ink, running the length of it. Places are the warp: when a character is at a place, their
  thread passes through that place's band, so where people were reads as position across
  the cloth.
- **Knots and stitches for events.** When characters meet, their threads draw together and
  are knotted; a conversation is a run of cross stitches between them, its length the
  length of the talk, its pattern the tone (a promise, a threat, a gift, a lie each have a
  motif). A thought is a single seed stitch on one thread. Scribe narration is couched gold
  across the whole width.
- **Basting for what is intended.** Ahead of "now", each character's plan and motive is
  drawn as basting (the long loose stitches a tailor puts in before sewing for real), aimed
  at where they mean to go and whom they mean to see. As time moves on, basting is replaced
  by real stitches; where what happened departs from what was intended, the thread is
  marked (a red knot), so deviations from the plan stand out, the way the Prime Radiant
  marked where history left Seldon's equations.
- **Branches kept, not overwritten.** Today rewinding drops the future. Instead, rewinding
  and playing again starts a new branch: the cloth splits at that moment and both lengths
  are kept, side by side, so alternate plotlines can be compared and returned to.

Navigation, intricate on purpose:

- **Zoom through scales**: the whole cloth (every thread, the shape of the story), a day
  (meetings and places readable), a moment (a knot opens into the actual lines spoken, with
  the speakers' portraits).
- **Pull a thread**: select a character and their thread lifts, the cloth re-lays around
  them (their places and partners in order), others fade.
- **Re-lay the warp**: arrange the cloth by place, by character, or by theme (the world's
  story lines from `WorldContext`), each a different reading of the same history.
- **Scrub and jump**: a time needle along the cloth; clicking a knot jumps the village (and
  the director camera) there. From any knot: "play again from here", which makes a branch.
- **Ask**: the existing world query becomes a search that lights the matching stitches.

Built with the same shape-and-looks pipeline as everything else (threads are `line`
shapes, knots are `knot` shapes), drawn in the current art look, with the stitched
interface. The database view stays as a plain table for inspection.

## 6. The pattern studio: procedural motifs from references

Owner note: Tapestry Studio has useful lessons, but rather than digitising patterns from
sources, patterns should be generated procedurally, based on references.

- **A motif grammar** for counted thread work: a grid, a symmetry (mirror, four-fold,
  eight-fold, a running border repeat), and generators that grow a motif inside it (stepped
  diagonals, the eight-pointed star of the elbetitsa, hooked lozenges with no hooked cross,
  tree-of-life axes, rosettes, meanders, chevron friezes), each with typed parameters and a
  seed, like the world generators.
- **A reference is a described style**, not a picture to copy: a named recipe of grammar,
  symmetry, density, line habits and ink roles (for example "Shopluk elbetitsa: eight-fold,
  stepped diagonals, dense, red and black"). References live in packs, so a world brings its
  own regional styles; the Shevitsa regions are the first set. A generated motif is new each
  seed but reads as belonging to its reference.
- **Lessons kept from Tapestry Studio**: the indexed palette (inks as roles, never colours),
  a cell editor for touching up a generated motif by hand (as an edit layer on top of the
  generator, the same recipe-plus-edits idea), the pattern library, and emitting a motif as
  code/data an agent can read. Dropped: image import, segmentation and tileset packing.
- **Where motifs go**: world features (a dancing ground's star, a house's gable), garments
  (the oversized apron motif, skirt bands), the cloth border, interface frames, and the Loom.
- Open question for later: whether a user's own image may be used only to *estimate* a
  reference's parameters (symmetry, density, ink proportions), never traced.

## 7. Retiring the old paths

- Remove the Level Editor and Tapestry Studio tabs, `TapestryStudioView`, the segmentation
  client and worker and their models, the Classic tiles look and the sprite sheet paths.
- Agent tools: `create_world` gains generators and params; a new `generate_world`; scene
  edits go through `apply_world_commands`. `edit_world_map` (tile ops),
  `compose_pixel_pattern` and the tileset half of `generate_image` are retired. Tests and
  the headless host follow.
- Saved worlds with tile maps load as `from-tiles` scenes.

## Order of work

1. ~~Scene document, `bakeScene`, `mapFromScene`, generator registry, scene commands, Wang
   worlds playable (and bundled worlds as `from-tiles` scenes). Tests.~~ Done:
   `src/world/worldScene.ts` (scene, edits, bake, walkability, map derivation) and
   `src/world/sceneGenerators.ts` (`wang-valley`, `zmeyovo`, `shevitsa`, and a frozen base
   for any other tile map). Commands: `scene.create`, `scene.fromTiles`, `scene.setRecipe`,
   `scene.edit` (one command carrying any hand edit: terrain, place, move, remove,
   landmark, spawn, title), `scene.removeEdit`, `scene.clearEdits`. The valley generator
   now builds a bridge wherever the river would cut the land in two, names its hamlets
   (neighbouring house chunks are one hamlet), gathering places, bridges and the deepest
   wood, and is titled after its first hamlet. "Valley (procedural)" is a world pack. The
   bundled packs still load as tile maps until the editor opens them as scenes.
2. ~~World editor tab, replacing Level Editor and Tapestry Studio.~~ First pass done
   (`src/components/WorldEditorView.tsx`, the "World Editor" tab; the two old tabs are gone
   from the bar, their code stays until step 7). Recipe panel built from the generator's
   schema with a dice for the seed; the world drawn live in the current look with pan and
   zoom; tools to select and drag, paint ground (six terrains, three brush sizes), place a
   feature, cut away a feature, landmark or start point, name a place and add a start
   point; a walkability overlay; the list of hand edits (each removable, edits that no
   longer apply shown as such); undo and redo through the world store; "Edit this world as
   a place" for tile maps; "Make a new world". Ambient decoration now depends only on
   position, so an edit changes the decoration near it and nowhere else. Still to do:
   import and export of a world pack from the editor, rectangle and line painting, feature
   thumbnails in the place palette, and the editor's own small multiples of seeds.
3. ~~Director camera.~~ First pass done. `src/engine/director.ts` is a pure shot planner
   (same story, same cut; `Director.history` is the cut so far) with establishing,
   two-shot, close, reaction and follow shots. Grammar: a subject is held 3 to 16 seconds
   (close and reaction shots do not reset that clock), a wide shot of a quiet place is held
   7 seconds before the next place, the camera cuts when the new subject is far or a very
   different size and eases otherwise, it changes subject between lines, recently left
   subjects are passed over for 9 seconds, and a line that turns strong as it is spoken (a
   question, an exclamation, a long speech) gets one close shot, then sometimes the
   listener's reaction. The village view drives the camera from it ("Story" viewfinder
   button, on by default and remembered; the current shot is captioned beside it), frames
   only the part of the view the floating toolbar leaves visible, and hands the camera to
   the viewer on any drag, scroll, zoom, follow or keyboard move. Clicking a character in
   story mode moves the Scribe's point of view to them and the director favours their
   thread. Still to do: an optional return to story mode after the viewer has been idle,
   the shot list in the headless runner and agent API, and lead room ahead of a walker.
4. The Loom. First pass done: "The Loom" is the Control Room's first tab
   (`src/components/LoomView.tsx`). `src/engine/worldlines.ts` has a recorder, started
   with every browser simulation, that remembers which place each character was at, and a
   pure `layoutLoom` that lays out bands (places, with "On the roads" in the middle, or one
   row per character), threads, stitches (a cross for a plain line, a ring for a
   question, a star for an exclamation, a barred cross for a long speech, a seed stitch for
   a thought, couched thread to each listener, the Scribe as dashed gold across the
   cloth) and basting from now toward where a walker is heading. By character, threads
   draw together while their characters talk. Navigation: scroll to zoom through time from
   seconds to days, drag along it, "the whole cloth", keep now in view, click a thread to
   pull it out (the rest fade), click a stitch to open the moment (the whole conversation,
   and a button to go to that character in the village), search lights matching stitches,
   and close in, the words appear beside their stitches. Still to do: keep the record of
   places with the saved world (today it starts afresh when the app loads), deviations
   (red knots where what happened left what was intended), kept branches (rewinding forks
   instead of truncating), and arranging by story line.
5. ~~Character editor: trait overrides and the new editor.~~ First pass done.
   `VillagerConfig.figure` carries `seed` (default: from the id) and `traits`, hand choices
   applied after the seed and the kind (`FigureOptions.traits`, `FIGURE_TRAIT_SPECS`,
   `seededFigureTraits` in `src/art/figures.ts`): headdress (women) or hat (men), skirt
   style and pattern, the inks of skirt or trousers, bodice or vest, apron and hair, open
   bodice, coloured sleeves, long hair or moustache, arms, skin and resting face. Choosing
   a value the seed already chose changes nothing, and choosing one never changes another.
   In the art looks the Characters tab shows, under the walk preview, a full portrait, the
   five moods, a dice for a new person (chosen traits stay), "back to the original",
   "clear choices", and a control per trait showing what the seed chose (thread colours as
   swatches). The bitmap sprite tools are hidden in the art looks (removed in step 7). The
   rig, the village and every portrait follow the seed and choices. Still to do: children
   and elders (scale and proportion), more kinds, and listing the trait schema in the
   agent API.
6. Pattern studio. First pass done: `src/art/patternGrammar.ts` (seven grammars with typed
   parameters and a seed: eight-pointed star, stepped lozenge, tree of life, solar rosette,
   stepped labyrinth, wave meander band, chevron frieze band; ink roles only; rosettes keep
   at least eight rays and turn only gently unless there are many, so no sun ever reads as
   a hooked cross), `src/art/patternReferences.ts` (references as described styles with
   ranges; the eight Shevitsa regions), and the Pattern Studio tab: references, a page of
   eight motifs per reference with a dice, the chosen motif large with its settings, and
   "copy the recipe". Lab: `/art-lab.html?only=patterns`. Next: the cell editor (touch-ups
   as an edit layer), the library, and motifs on world features and garments.
7. Retire the old code, the tiles look and the old agent tools; update docs and tests.

Each step lands on its own branch and is usable on its own.
