# SeloAI Project Handoff

## 1. Architecture Overview

| Layer | Location | Responsibility |
|---|---|---|
| **App Shell & State** | `src/App.tsx` | Workspace navigation (`Village`, `Level Editor`, `Characters`, `AI & Voice Monitor`, `Guides & Templates`), IndexedDB persistence, JSON import/export, reset `<dialog>`, theme switcher |
| **Simulation Engine** | `src/engine/simulation.ts`, `pathfinding.ts`, `renderer.ts`, `types.ts` | Grid A* pathfinding, fixed-step autonomous villager loop, human chat/voice turns, Canvas2D pixel renderer |
| **LFM3-1.7B Worker** | `src/workers/lfm3TextWorker.ts` | `@huggingface/transformers` WebGPU text-generation worker; probes `/models/` locally first, then Hugging Face |
| **LFM3-Omni-2B Runtime** | `src/ai/omniEngine.ts`, `public/vendor/Lfm3OmniForConditionalGeneration.js` | WebGPU GGUF + `mmproj` STT, 24 kHz PCM TTS, and interleaved multimodal voice-to-voice; probes local `/models/` (both `.gguf` & `mmproj`) before Hugging Face |
| **Local API Fallback** | `src/ai/localApiClient.ts` | OpenAI-compatible + Ollama `/api/tags` probe and streaming `/chat/completions` client |
| **AI Router & Audio** | `src/ai/brainRouter.ts`, `src/ai/audioPipeline.ts` | Inference routing (`WebGPU → Ollama/LM Studio → Story Sim`), mic capture, streaming PCM playback, telemetry bus |
| **Storage** | `src/storage/villageStore.ts` | IndexedDB (`seloai-db`) persistence and JSON bundle serialization |
| **Templates & Docs** | `public/templates/`, `docs/CUSTOM_ASSETS_GUIDE.md` | Pixel-grid reference PNGs (`96×128`, `384×512`, `512×512`), JSON schemas, image-gen & LLM prompts |

## 2. Local Model Weights (`public/models/`, gitignored)

Both default models have been downloaded locally so testing does not depend on Hugging Face bandwidth:
- `public/models/onnx-community/LFM3-1.7B-ONNX/` (`model_q4f16.onnx`, `model_q4f16.onnx_data`, tokenizer & config files)
- `public/models/LiquidAI/LFM3-Omni-2B-GGUF/` (`LFM3-Omni-2B-Q4_K_M.gguf`, `mmproj-LFM3-Omni-2B-Q8_0.gguf`)

To swap in custom finetunes:
- **In-browser WebGPU**: Enter a Hugging Face repo ID or `/models/<custom-folder>` path in **AI & Voice Monitor**.
- **Ollama / LM Studio**: Start your local server with CORS enabled (e.g., `OLLAMA_ORIGINS="*"` for Ollama, or toggle CORS in LM Studio Developer Server), select the preset in **AI & Voice Monitor**, and click **Detect Models**.

## 3. Running & Verifying

- **Dev server**: `pnpm dev -- --port 5173` (currently running at `http://localhost:5173/`)
- **Tests**: `pnpm test` (`vitest run` — 3/3 passing in `src/engine/__tests__/simulation.test.ts`)
- **Typecheck & Build**: `pnpm build` (`tsc -b && vite build`)

## 4. Recommended Next Steps

1. **Custom Embroidery Art Replacement**: Use the PNG grid templates in `public/templates/` with image models to generate *vyshyvanka* / *rushnyk* character spritesheets and tilesets, then upload via **Characters** and **Level Editor** (or replace `public/assets/`).
2. **Finetune Integration**: Export your custom `LFM3-1.7B` ONNX (`q4f16`) and `LFM3-Omni-2B` GGUF + `mmproj` checkpoints into `public/models/<name>/` and set them as defaults in `src/data/defaultData.ts`.
3. **Browser Smoke Test**: Open `http://localhost:5173/` in Chrome/Edge (with WebGPU enabled), load both models in **AI & Voice Monitor**, and verify live mic STT + 24 kHz TTS playback.
