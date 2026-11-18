# SeloAI for developers

How SeloAI is built: the models it runs, the tools agents use, the views and their code, data
formats, the engine, the art system, and how to run, test and deploy it. For what SeloAI is and
how to use it, start with the [README](../README.md); for driving it with an agent, see
[AGENTS.md](AGENTS.md); for the state of the work and where to pick it up, see
[HANDOFF.md](../HANDOFF.md).

## Overview

SeloAI is a 100% browser-native AI village sandbox with no backend. All bundled art is generated procedurally by the project itself. All worlds, characters, conversations, and memories persist locally in IndexedDB, while inference runs locally via **WebGPU** (`LFM3-1.7B`, `LFM3-Omni-2B`, `MiniCPM5-2B`, `Bonsai-2 27B`), external **Brain APIs** (`Ollama`, `LM Studio`, `Google Gemini`, `Anthropic Claude`, `OpenAI / ChatGPT`, `GitHub Models`, `OpenRouter`), **External Voice (TTS)**, **Image Generation** (`Agent`, `OpenRouter`, `OpenAI`, `Gemini`, `Local SD / ComfyUI`), or an instant **Story Sim** engine. A core set of world, cast, scenario and data actions is also exposed to AI agents via **WebMCP**, browser/iframe API (`window.seloAI`, `postMessage`), and a stdio **MCP server**.

## Agents, Tools, WebMCP & Stdio MCP

Every tool runs through one host, `src/api/seloToolRegistry.ts`: the authoring tools (`src/api/authoringTools.ts`), the settings tools (`src/api/settingsTools.ts`), the interface and performance tools (`src/api/uiTools.ts`), and the original core tools defined in `src/api/toolSchemas.json`. [AGENTS.md](AGENTS.md) lists them all. With the core tools, AI agents can autonomously create worlds (`create_world` with `'balkan-myth'`, `'shevitsa'`, or `'blank'` presets, `edit_world_map` including macro stamps), digitize crisp pixel art & tileset stamps (`compose_pixel_pattern`), populate casts (`create_character`, `batch_create_characters`), launch scenarios (`run_scenario`), instruct villagers (`instruct_world`, `move_actor`), switch workspace tabs (`control_simulation` including `'tapestry'`) or Worldline POV (`set_worldline_pov`), query the World DB & Psychophysical Graph (`query_world_db`), configure backends (`configure_backends`), generate image assets (`generate_image`), and export/import bundles:
- **Browser API & `postMessage`**: `window.seloAI` (`listTools`, `callTool`, `getWorldState`, `runScenario`, `instruct`, `registerImageGenerator`) and `SELOAI_TOOL_CALL` messages (`src/api/webMcpBridge.ts`). `postMessage` tool calls are accepted only from the page's own origin, plus any origins listed in the build-time `VITE_SELOAI_ALLOWED_ORIGINS` variable.
- **WebMCP**: Automatically registers all `seloai_*` tools with `navigator.modelContext` when running in a WebMCP-enabled browser.
- **Stdio MCP Server**: Run `pnpm mcp` (`node mcp/seloai-mcp-server.mjs`). When the Vite dev server + browser tab is open, tool calls relay live into the active browser world via `/__seloai_bridge`; otherwise it runs the real engine in its own process (`mcp/server.ts` via `src/headless/headlessHost.ts`): the same simulation, world store and tool implementations as the app, without rendering or audio. Set `SELOAI_BRIDGE_URL=off` to always use the in-process engine.

## Workspace Views

- **Village (`VillageView`, `AestheticStudioPanel`)**: the living world. Switch worlds from the header (`Zmeyovo: Well of the Lamia`, `Шевици: Embroidered Bulgaria`, the procedural `Valley`). **Story mode** (viewfinder button) lets a director camera (`src/engine/director.ts`) cut and ease between establishing shots, two-shots, close-ups on strong lines, reactions and walkers; any pan, scroll or zoom takes over. Speech and thoughts are shown as **woven text** (`src/art/wovenText.ts`): each line is sewn letter by letter onto the cloth around its speaker in that character's colour, settling in a small packing simulation, then fixed until it fades; the **Aa** button switches between script, hand-sewn (the single-stroke ductus hand, `src/art/ductus.ts`), satin and counted letters, and **Style → Speech and thoughts** sets size, stitch, weight, slant, wobble and timing (or returns to bubbles). The Scribe's narration is sewn in gold along the bottom of the view. Includes signed log pace and rewind, eased zoom, roster portraits drawn from the same figures, and the `@`/`#` mention composer.
- **Control Room (`ObservatoryView`, `LoomView`)**: opens on **the Loom**, the world's history woven as cloth: characters are threads through bands of places (or one row each, drawn together while they talk), what was said are stitches whose motif is the kind of line, the Scribe is gold across the cloth, and basting points to where walkers are heading. Zoom through time, pull a thread, open a moment, search. Also the Psychophysical Graph, natural-language World DB querying and the Scribe Loom chronicle.
- **World Editor (`WorldEditorView`)**: worlds are authored as places, not tile grids: a generator recipe (settings from its schema, a seed with a dice) plus hand edits kept on top, so a reroll keeps your work. Paint ground, place, move and cut features, name places and start points, see where people cannot walk, undo and redo. Tile maps can be turned into places. Replaces the old Level Editor and Tapestry Studio.
- **Characters (`CharacterEditorView`, `FigureAppearance`)**: persona, voice and the procedural figure: a seed draws every trait, any trait can be chosen by hand (headdress or hat, skirt and pattern, thread colours, sleeves, hair, arms, skin, resting face), and a new seed keeps your choices; a full portrait and the five moods preview it.
- **AI & Voice Monitor (`MonitorView`)**: Load/unload WebGPU brains (`LFM3-Omni-2B-GGUF` default, `LFM3-1.7B-ONNX`, `MiniCPM5-2B`, `Bonsai-2 27B`), configure Ollama / LM Studio endpoints, inspect `<think>` / `<thought>` / Scribe settings, test mic STT + 24 kHz PCM streaming TTS, and monitor live telemetry.
- **Help & Guides (`AssetGuideView`, `WelcomeGuide`)**: a Welcome part for someone new (what SeloAI is, loading a voice and a brain, the screen, taking part, Spinner, saving; with a narrated guided tour) and Make your own story (world, characters, story files, templates, assistant prompts).

## World, Story & Data Portability

Open **World & Data**, a tab of the side panel, to:
- Switch between **Demo Worlds** (`Zmeyovo: Well of the Lamia`, `Шевици`) or manage **Saved Worlds in Memory** (save, reload, overwrite, remove, plus auto-backup).
- Start a **New Story** (clear conversations & character memories while keeping map and cast), create a **New Blank World**, or **Reset Defaults**.
- Export/Import:
  - **Whole Project (`seloai-project-v1`)**: World map, villagers, settings, conversation DB, and personal character histories. API keys are never written to an export and are ignored on import.
  - **Level Only (`seloai-level-v1`)**: Map tiles, collisions, spawns, `#POI` tags, and macro stamps.
  - **Characters Only (`seloai-characters-v1`)**: Roster and sprite configs.
  - **Characters + Histories (`seloai-characters-history-v1`)**: Portable cast + personal memories/intentions to drop into another level or story.
  - **Database Only (`seloai-db-v1`)**: Conversations and character memories.

## Engine Layout, World Packs & Headless Runs

- **Kernel (`src/engine/simulation.ts`, `src/engine/ports.ts`, `src/core/rng.ts`)**: the simulation receives its mind and voice, randomness, timestamps and timers as injected ports and has no runtime dependency on the model router, audio or React. `src/app/browserSimulation.ts` is the one place that wires it to the in-browser model router.
- **World packs (`src/world/`)**: a pack (`seloai-world-pack`, version 1) bundles a map, an optional cast, how the story opens, and a `WorldContext` (setting name, premise, visual theme id, and the scripted lines the no-model story engine may use, keyed by character id). Bundled packs are registered in `src/world/packs/index.ts`; adding a world means adding a pack there, not editing engine code. The context is saved with the world and included in project exports.
- **Commands and undo (`src/world/commands.ts`, `src/world/worldStore.ts`)**: every change to the authored world (map tiles, collision, Wang auto-tiling, stamps, landmarks, cast, setting) is a plain serialisable command applied by one pure function. The app shell and agent tools both go through the same store, so edits from either are undoable (header Undo/Redo, or the `undo_world_edit` / `redo_world_edit` tools). Agents send commands with `apply_world_commands`; a batch is one undo step and is rejected whole if any command is invalid. The Level Editor and Tapestry Studio still edit a private draft and hand over the result as a single map replacement.
- **World clock, pause and the time slider**: the app advances the simulation on every tab (`src/app/simulationDriver.ts`). Waits and the pacing of conversation follow the world clock, and each line of speech or narration occupies world time in proportion to its length, so slowing the time slider slows the whole stream of events rather than only movement. Pause holds movement, new conversation turns and speech playback mid-utterance; a direct message to a character while paused still gets a text reply, with its voice held until resume.
- **Headless, reproducible runs (`src/headless/runHeadless.ts`)**: runs a pack with no browser, models or audio. The same seed always produces the same transcript and digest.

```bash
pnpm sim:headless --seed 7 --seconds 120            # default pack
pnpm sim:headless --seed 3 --seconds 60 --world shevitsa --out run.json
```

## Generative Art & World Looks

The world and its characters are drawn by a generative art system (`src/art/`) inspired by Bulgarian shevitsa embroidery. Motif generators (tree of life, medallion, counted band, folk figures with faces and expressions) output look-independent shapes; interchangeable looks draw them as **line art** (`ink`, `night`) or **simulated embroidery** on woven linen (`blackwork`, `redBlack`, `festive`). Switch in **Style → World Look**; `Classic tiles` keeps the original tileset renderer. Nothing is a stored image, so changing look regenerates no assets. Judge motifs in isolation at `/art-lab.html?seed=7` while `pnpm dev` is running (rows such as `?only=woven`, `?only=quirks`, `?only=motion`). The full brief and roadmap is [ART_DIRECTION.md](ART_DIRECTION.md).

## Local Models & Development

Model weights are optional and gitignored under `public/models/` (remote Hugging Face download is used automatically if local files are absent):
- `public/models/onnx-community/LFM3-1.7B-ONNX/`
- `public/models/LiquidAI/LFM3-Omni-2B-GGUF/`

```bash
pnpm install
pnpm dev
```

Tests and production build:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## GitHub Pages Deployment

`.github/workflows/deploy-pages.yml` automatically typechecks (`pnpm exec tsc --noEmit`), lints (`pnpm lint`), runs unit tests (`pnpm test`), builds with `VITE_BASE_PATH="/<repo>/"` (`pnpm build`), and deploys `dist/` via `actions/upload-pages-artifact` and `actions/deploy-pages` on every push to `main` (and via manual `workflow_dispatch`) to **https://languel.github.io/seloai/**. All runtime public URLs (`/assets/...`, `/vendor/...`, `/templates/...`, `/models/...`) resolve through `src/utils/assetUrl.ts` (`import.meta.env.BASE_URL`).

## More

- [AGENTS.md](AGENTS.md): every agent tool, MCP and WebMCP setup, Spinner, walkthroughs and performances.
- [ART_DIRECTION.md](ART_DIRECTION.md): the needlework look, its motifs and roadmap.
- [WORLD_EDITOR_PLAN.md](WORLD_EDITOR_PLAN.md): how worlds are authored as places.
- [CUSTOM_ASSETS_GUIDE.md](CUSTOM_ASSETS_GUIDE.md): templates and custom assets.
- [HANDOFF.md](../HANDOFF.md): architecture notes, recent work and troubleshooting.
