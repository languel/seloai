# SeloAI — Clean-Slate In-Browser WebGPU AI Village

SeloAI is a 100% client-side, browser-native AI village inspired by `ai-town`, with zero Convex or backend database dependencies. All village state persists locally in IndexedDB, and AI inference runs locally via **WebGPU** (`LFM3-1.7B` + `LFM3-Omni-2B`) with optional **Ollama / LM Studio** HTTP fallback and an instant **Story Sim** fallback.

## Features

- **In-Browser Simulation**: Fixed-step Canvas2D world renderer, A* pathfinding, autonomous villager schedules, spontaneous villager-to-villager conversations, memory reflection, floating speech bubbles, and a walkable visitor avatar (`WASD`/Arrows or click-to-move).
- **LFM3-1.7B WebGPU Brain** (`src/workers/lfm3TextWorker.ts`): Runs `onnx-community/LFM3-1.7B-ONNX` (or custom Hugging Face / local ONNX finetunes) in a dedicated Web Worker via `@huggingface/transformers`. Prefers locally hosted files in `public/models/`.
- **LFM3-Omni-2B WebGPU STT + TTS** (`src/ai/omniEngine.ts`): Uses `Lfm3OmniForConditionalGeneration` (`LiquidAI/LFM3-Omni-2B-GGUF` or custom GGUF finetune + `mmproj`) for microphone STT, 24 kHz PCM streaming TTS, and multimodal voice-to-voice turns.
- **Ollama / LM Studio Fallback** (`src/ai/localApiClient.ts`): Connect to `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio) with model auto-detection and streaming responses.
- **Built-in Level Editor** (`src/components/LevelEditorView.tsx`): Paint ground/object layers, edit collision masks, place animated props (`campfire`, `windmill`, `waterfall`), manage spawn landmarks, upload custom tilesets, and apply changes live.
- **Built-in Character Editor** (`src/components/CharacterEditorView.tsx`): Create/edit/duplicate villagers, tune identity/plan/voice prompts, choose preset sprites or upload custom spritesheets with live 4-direction walk previews.
- **AI & Voice Monitor** (`src/components/MonitorView.tsx`): Load/unload WebGPU models, swap in custom finetune endpoints, test STT/TTS in the Omni Voice Studio, configure Ollama/LM Studio fallback, inspect villager memory matrices, and stream live telemetry logs.
- **Guides & Templates** (`src/components/AssetGuideView.tsx`, `docs/CUSTOM_ASSETS_GUIDE.md`): Downloadable PNG grid templates (`384×512` / `96×128` character spritesheets, `512×512` tileset), JSON schemas, and copy-paste prompts for image and LLM models.

## Local Models Setup

Model weights are stored (and gitignored) in `public/models/`:
- `public/models/onnx-community/LFM3-1.7B-ONNX/` (`q4f16` ONNX + tokenizer/config files)
- `public/models/LiquidAI/LFM3-Omni-2B-GGUF/` (`LFM3-Omni-2B-Q4_K_M.gguf` + `mmproj-LFM3-Omni-2B-Q8_0.gguf`)

A custom Vite middleware in `vite.config.ts` ensures missing optional paths under `/models/` return `404` rather than the SPA HTML fallback.

## Placeholder Assets & Future Embroidery Art

Placeholder pixel-art tilesets and spritesheets (`gentle-obj.png`, `32x32folk.png`, `player.png`, animated props) live in `public/assets/`. See `docs/CUSTOM_ASSETS_GUIDE.md` (or the in-app **Guides & Templates** tab) for specs and reference templates to generate custom Eastern European embroidery (*vyshyvanka* / *rushnyk*) art.

## Development

```bash
pnpm install
pnpm dev
```

Tests & production build:

```bash
pnpm test
pnpm build
```

See `HANDOFF.md` for architecture notes, known caveats, and next steps.
