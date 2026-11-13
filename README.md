# SeloAI — Client-Side WebGPU AI Village

SeloAI is a 100% browser-native AI village sandbox inspired by `ai-town`, with zero backend or Convex dependencies. All worlds, characters, conversations, and memories persist locally in IndexedDB, while inference runs locally via **WebGPU** (`LFM3-1.7B`, `LFM3-Omni-2B`, `MiniCPM5-2B`, `Bonsai-2 27B`), external **Brain APIs** (`Ollama`, `LM Studio`, `Google Gemini`, `Anthropic Claude`, `OpenAI / ChatGPT`, `GitHub Models`, `OpenRouter`), **External Voice (TTS)**, **Image Generation** (`Agent`, `OpenRouter`, `OpenAI`, `Gemini`, `Local SD / ComfyUI`), or an instant **Story Sim** engine. Every human action is also exposed to AI agents via **WebMCP**, browser/iframe API (`window.seloAI`, `postMessage`), and a stdio **MCP server**.

## Agents, Tools, WebMCP & Stdio MCP

All 19 SeloAI tools are defined once in `src/api/toolSchemas.json` and executed via `src/api/seloToolRegistry.ts` so AI agents can autonomously create worlds (`create_world` with `'balkan-myth'`, `'shevitsa'`, or `'blank'` presets, `edit_world_map` including macro stamps), digitize crisp pixel art & tileset stamps (`compose_pixel_pattern`), populate casts (`create_character`, `batch_create_characters`), launch scenarios (`run_scenario`), instruct villagers (`instruct_world`, `move_actor`), switch workspace tabs (`control_simulation` including `'tapestry'`) or Worldline POV (`set_worldline_pov`), query the World DB & Psychophysical Graph (`query_world_db`), configure backends (`configure_backends`), generate image assets (`generate_image`), and export/import bundles:
- **Browser API & `postMessage`**: `window.seloAI` (`listTools`, `callTool`, `getWorldState`, `runScenario`, `instruct`, `registerImageGenerator`) and `SELOAI_TOOL_CALL` messages (`src/api/webMcpBridge.ts`).
- **WebMCP**: Automatically registers all `seloai_*` tools with `navigator.modelContext` when running in a WebMCP-enabled browser.
- **Stdio MCP Server**: Run `pnpm mcp` (`node mcp/seloai-mcp-server.mjs`). When the Vite dev server + browser tab is open, tool calls relay live into the active browser world via `/__seloai_bridge`; otherwise it runs in standalone headless state mode with parity for all core creation and composition tools.

## Workspace Views

- **Village (`VillageView`, `AestheticStudioPanel`)**: Switch worlds via the header/modal **Demo Worlds & Saved Worlds in Memory** dropdowns (`Zmeyovo: Well of the Lamia` in unified 3/4 oblique perspective with Wang-tiled brook, drought hollow, Khoro cobble roads, & village walls; `Шевици: Embroidered Bulgaria`; `SeloAI Starter Village`), experiment live via **Style** (**Appearance & Player Studio**) with world-matched UI decorations (`Balkan Shevitsa`, `Samodiva Mist`, `Carved Hearth`, `Subtitle Glass`, `Chronicle Vellum`), font presets & text scaling, frosted-glass or parchment bubble styles, de-overlapped name/POI pills & bubbles, balanced character scale, and a **procedurally generated 32×32 player sprite** synchronized to your world's aesthetic or custom attire/headgear/props. Includes signed log pace & rewind slider (`-10× .. 0 .. +10×`), eased zoom, docked **Scribe Subtitle Bar**, frameless 46px roster portraits, and `contentEditable` `@`/`#` mention composer.
- **Control Room (`ObservatoryView`)**: Westworld-style observability toolkit featuring **Worldline POV** hopping (`Scribe` or any villager listener/narrative lens), an interactive **Psychophysical Graph** linking characters and landmarks, natural-language **World DB** querying + raw tabular database view, and the **Scribe Loom** chronicle assembler.
- **Level Editor (`LevelEditorView`)**: Paint ground (`BG 0/1`) and object (`Obj 0/1`) layers, use the **Wang Auto-Tile** brush tool (4-Edge & 4-Corner solver across the 4 Balkan tileset Wang sets), edit collision masks, place animated sprites, define spawn points and landmark POIs, capture reusable multi-tile **Macro Stamps**, zoom/pan the resizable tileset palette, select multi-tile blocks, adjust brush sizes & custom tile dimensions (`16px` / `32px` / `48px` / `64px` / custom), undo/redo (`50` steps), start blank maps, and upload custom PNG tilesets.
- **Tapestry Studio (`TapestryStudioView`)**: Dedicated pixel-art pattern digitizer and output tileset composer:
  - **Create Mode**: Import reference tapestries or photos, pinch-zoom & two-finger pan, trace on an indexed pixel layer with the eyedropper **Sample** brush, strip flat backgrounds via Chroma-Key or Edge BG remover, run **AI Auto-Slicer** (`Smart Contrast`, or in-browser WebGPU/WASM `EdgeTAM`, `SAM 2.1 Tiny`, `SAM 3 Tracker`, `Grounding DINO`, `YOLOS Tiny`, `ORMBG`) or interactive **SAM Click** point-to-segment, preserve crop aspect ratios automatically, and emit clean procedural Canvas2D code.
  - **Preview Output Composer**: Compose against a Blank sheet or **Import Cur Tileset**, stage aspect-preserved sliced motifs or drag multiple items from the **Pattern Library** into non-overlapping output tile slots, move and resize each placed layer using 8-handle box controls (tile-grid snap & `Shift` aspect lock), and explicitly **Apply to Map** / **Apply & Place** without accidentally mutating the live tileset.
- **Characters (`CharacterEditorView`, `ModularCharacterCreator`)**: Author villagers or batch-generate generic fantasy residents, customize 128×128 modular pixel spritesheets with trait locking, configure voice accents & speech locales, or upload custom spritesheets with live 4-direction previews.
- **AI & Voice Monitor (`MonitorView`)**: Load/unload WebGPU brains (`LFM3-Omni-2B-GGUF` default, `LFM3-1.7B-ONNX`, `MiniCPM5-2B`, `Bonsai-2 27B`), configure Ollama / LM Studio endpoints, inspect `<think>` / `<thought>` / Scribe settings, test mic STT + 24 kHz PCM streaming TTS, and monitor live telemetry.
- **Guides & Templates (`AssetGuideView`)**: Downloadable PNG grid templates (`384×512`, `96×128`, `512×512`), JSON schemas, and prompts for image and language models.

## World, Story & Data Portability

Open the **World & Data** modal from the top bar (`Database` glyph) to:
- Switch between **Demo Worlds** (`Zmeyovo: Well of the Lamia`, `Шевици`, `Starter Village`) or manage **Saved Worlds in Memory** (save, reload, overwrite, remove, plus auto-backup).
- Start a **New Story** (clear conversations & character memories while keeping map and cast), create a **New Blank World**, or **Reset Defaults**.
- Export/Import:
  - **Whole Project (`seloai-project-v1`)**: World map, villagers, settings, conversation DB, and personal character histories.
  - **Level Only (`seloai-level-v1`)**: Map tiles, collisions, spawns, `#POI` tags, and macro stamps.
  - **Characters Only (`seloai-characters-v1`)**: Roster and sprite configs.
  - **Characters + Histories (`seloai-characters-history-v1`)**: Portable cast + personal memories/intentions to drop into another level or story.
  - **Database Only (`seloai-db-v1`)**: Conversations and character memories.

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
pnpm test
pnpm build
```

## GitHub Pages Deployment

`.github/workflows/deploy-pages.yml` automatically typechecks (`pnpm exec tsc --noEmit`), runs unit tests (`pnpm test`), builds with `VITE_BASE_PATH="/<repo>/"` (`pnpm build`), and deploys `dist/` via `actions/upload-pages-artifact` and `actions/deploy-pages` on every push to `main` (and via manual `workflow_dispatch`) to **https://languel.github.io/seloai/**. All runtime public URLs (`/assets/...`, `/vendor/...`, `/templates/...`, `/models/...`) resolve through `src/utils/assetUrl.ts` (`import.meta.env.BASE_URL`).

See [HANDOFF.md](HANDOFF.md) for architecture details and troubleshooting notes.
