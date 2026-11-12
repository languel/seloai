# SeloAI Project Handoff

## 1. Architecture Overview

| Layer | Location | Responsibility |
|---|---|---|
| **App Shell & State** | `src/App.tsx` | Compact glyph top bar with hover labels, 6 workspace tabs, IndexedDB hydration/persistence, **World & Data** modal (New Story, New Blank World, Whole Project / Level / Cast / Cast+History / DB export & auto-detect import), theme switcher |
| **Live Simulation View** | `src/components/VillageView.tsx` | Canvas2D world viewport, label toggle, spatial mix audio controls, draggable-width collapsible inspector sidebar, card/compact villager roster, **Now Hearing** banner, `Live Audio` / `Thread` / `World Script` feeds with kind/actor/text filters, `@` and `#` autocomplete composer |
| **Control Room (Westworld Toolkit)** | `src/components/ObservatoryView.tsx`, `src/engine/observatory.ts` | Worldline POV switcher (`scribe` or any villager), interactive SVG Psychophysical Graph (character-to-character & character-to-POI edges), raw + natural-language queryable World DB, Scribe Loom narrative view |
| **Level & Character Editors** | `src/components/LevelEditorView.tsx`, `src/components/CharacterEditorView.tsx`, `src/components/ModularCharacterCreator.tsx`, `src/engine/spriteGenerator.ts`, `src/engine/characterGenerator.ts` | Tileset zoom/pan, resizable palette, multi-tile selection, brush sizes, custom `tileDim`, 50-step undo/redo, `#POI` tags, macro stamps, modular 128×128 spritesheet generator & batch villager generator |
| **Simulation Engine** | `src/engine/simulation.ts`, `src/engine/pathfinding.ts`, `src/engine/renderer.ts`, `src/engine/types.ts` | Grid A* pathfinding, perp-sidestepping & `scatterVillagers()`, player-villager collision radius, focal worldline POV, anti-loop guard helpers (`clearDatabase`, `exportCharacterHistories`, `applyCharacterHistories`) |
| **WebGPU & External APIs** | `src/workers/lfm3TextWorker.ts`, `src/ai/omniEngine.ts`, `src/ai/minicpmEngine.ts`, `src/ai/bonsaiEngine.ts`, `src/ai/localApiClient.ts` | `@huggingface/transformers` WebGPU worker (`LFM3-1.7B`), GGUF WebGPU runtimes (`LFM3-Omni-2B`, `MiniCPM5-2B`, `Bonsai-2 27B`), Brain/Voice/Image APIs (`Ollama`, `LM Studio`, `Gemini`, `Claude`, `OpenAI`, `GitHub`, `OpenRouter`, `ElevenLabs`, `Local SD / ComfyUI`) |
| **Tools, WebMCP & MCP** | `src/api/toolSchemas.json`, `src/api/seloToolRegistry.ts`, `src/api/webMcpBridge.ts`, `mcp/seloai-mcp-server.mjs` | 18 shared tool schemas exposing all world/character/scenario/DB/backend/bundle actions to `window.seloAI`, `postMessage`, `navigator.modelContext` (WebMCP), Vite dev bridge (`/__seloai_bridge`), and stdio MCP (`pnpm mcp`) |
| **AI Router, Audio & Anti-Loop** | `src/ai/brainRouter.ts`, `src/ai/audioPipeline.ts` | Inference routing, serialized speech queue with `flushAudioQueue()` & `subscribeSpeechState`, spatial attenuation & stereo pan, `<think>`/`<thought>` parsing, `isTextTooSimilar()` anti-repetition guard across motives, narration beats, and dialogue |
| **Storage & Subpath Assets** | `src/storage/villageStore.ts`, `src/utils/assetUrl.ts` | IndexedDB (`seloai-db`) persistence, granular bundle export/import (`seloai-project-v1`, `seloai-level-v1`, `seloai-characters-v1`, `seloai-characters-history-v1`, `seloai-db-v1`), `BASE_URL`-aware asset resolution for GitHub Pages |

## 2. Local Model Weights (`public/models/`, gitignored)

Optional local model checkpoints in `public/models/` are probed first at runtime before falling back to Hugging Face:
- `public/models/onnx-community/LFM3-1.7B-ONNX/`
- `public/models/LiquidAI/LFM3-Omni-2B-GGUF/`

Note: GitHub Pages deploys without `public/models/` so WebGPU engines fetch remote weights from Hugging Face (cached in browser Cache Storage).

## 3. Running, Testing & Deploying

- **Dev server**: `pnpm dev -- --port 5173`
- **Unit tests**: `pnpm test` (`vitest run` — 25 tests in `src/engine/__tests__/simulation.test.ts`)
- **Typecheck & build**: `pnpm build` (`tsc -b && vite build`)
- **GitHub Pages CI**: `.github/workflows/deploy-pages.yml` builds with `VITE_BASE_PATH="/<repo>/"` and deploys `dist/` via `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`.
  - Repository **Settings → Pages → Source** must be set to **GitHub Actions**.
  - On a **private** repository, GitHub Pages requires GitHub Pro, Team, or Enterprise.

## 4. Browser Verification Checklist

1. Open the app in WebGPU-capable Chrome/Edge (`localhost:5173` or deployed GitHub Pages URL).
2. In **Village**, verify spritesheets/tilesets render, drag the inspector sidebar handle, toggle collapsible panels & filters, and hop Worldline POV in **Control Room**.
3. In **AI & Voice Monitor**, optionally load a WebGPU model or connect Ollama/LM Studio, test mic STT + 24 kHz TTS, and verify **Flush Audio** cancels queued speech cleanly.
4. In **World & Data** (`Database` icon), verify **Whole Project**, **Level Only**, **Characters Only**, **Characters + Histories**, and **Database Only** export/import round-trips.
