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

## 6. Retiring the old paths

- Remove the Level Editor and Tapestry Studio tabs, `TapestryStudioView`, the segmentation
  client and worker and their models, the Classic tiles look and the sprite sheet paths.
- Agent tools: `create_world` gains generators and params; a new `generate_world`; scene
  edits go through `apply_world_commands`. `edit_world_map` (tile ops),
  `compose_pixel_pattern` and the tileset half of `generate_image` are retired. Tests and
  the headless host follow.
- Saved worlds with tile maps load as `from-tiles` scenes.

## Order of work

1. Scene document, `bakeScene`, `mapFromScene`, generator registry, scene commands, Wang
   worlds playable (and bundled worlds as `from-tiles` scenes). Tests.
2. World editor tab, replacing Level Editor and Tapestry Studio.
3. Director camera. Independent of the editors (it touches the village view and the
   simulation, not the world document), so it can also run alongside steps 1 and 2.
4. The Loom: first the cloth and its navigation from the records the simulation already
   keeps, then basting and deviations, then kept branches (a simulation change: rewinding
   forks instead of truncating). Also independent of the editors.
5. Character editor: trait overrides and the new editor.
6. Retire the old code, the tiles look and the old agent tools; update docs and tests.

Each step lands on its own branch and is usable on its own.
