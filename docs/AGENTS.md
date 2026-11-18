# Driving SeloAI with an agent

SeloAI can be built and run entirely by an agent: a new place, its people, what is going on,
and then the story itself. The same tools are offered three ways.

## The tools

The authoring tools come first in every list and are the plain way in
(`src/api/authoringTools.ts`):

| Tool | What it does |
|---|---|
| `authoring_guide` | How to make a world with a person, step by step |
| `story_overview` | The place, premise, opening, places, characters, and what is missing |
| `list_world_kinds` / `new_world` | Generators and their settings; a new place (fresh unless `keep_people`) |
| `set_story` | Place name and kind, premise, opening, who the player is, the meeting place |
| `add_place` | A named landmark, placed `near` a place, a person or a thing ("by the river") |
| `add_things` | Trees, houses, a well, flowers, hens… on the cloth |
| `add_character` | A character (or an update to one): role, who, wants, speech, voice, home, other names, lines |
| `add_story_lines` | Lines the story can use without a model |
| `start_story` | Start from the beginning |
| `read_story_log` | What was said and narrated, with a cursor for only the new lines |
| `read_story_markdown` / `write_story_markdown` | The whole story as one Markdown file, and back |
| `look` | A picture of the view (in the app) |

Every change goes through the world store, so `undo_world_edit` undoes it. The older, finer
tools (`apply_world_commands`, `instruct_world`, `control_simulation`, …) follow.

The tools forgive guesses: a `near` or `home` that does not exist yet still places the thing
on open ground and says what exists, so a small model is not stuck.

## Claude Code (or any MCP client) — stdio

```bash
claude mcp add seloai -- node /path/to/seloai/mcp/seloai-mcp-server.mjs
```

With the dev server running (`pnpm dev`, port 5183 or 5173) and the app open in a tab, tool
calls drive that tab: you see every change happen. With no tab, the server runs the same engine
headless. `SELOAI_BRIDGE_URL` points it at another address (`off` forces headless).

The server also offers two prompts, `create_world` (with an optional idea) and
`improve_story`, and resources `seloai://guide`, `seloai://story`, `seloai://state` and
`seloai://tools`. `look` comes back as an image.

## In the browser — WebMCP and `window.seloAI`

The app registers every tool with `navigator.modelContext` (as `seloai_<tool>`) where the
browser supports WebMCP, and as `window.seloAI.callTool(name, args)` for scripts. Pages on
other origins can call tools over `postMessage` only if their origin is listed in
`VITE_SELOAI_ALLOWED_ORIGINS`.

## Pi, the in-app agent

The **Pi** tab of the side panel is an agent inside the app (`src/agent/`). It thinks either:

- **on this machine**: LiquidAI LFM3-1.7B (GGUF) on WebGPU, through the vendored runtime
  `public/vendor/Lfm3ForCausalLM.js` (from the `webml-community/LFM3-1.7B-WebGPU-Pi` Space,
  Apache-2.0). The weights (about 1.1 GB) download once, only when the person clicks
  "Download Pi". Nothing leaves the browser.
- **with a cloud model**: the Brain API in the settings (OpenAI-compatible with tools:
  OpenAI, OpenRouter, Ollama, LM Studio, GitHub Models; or Anthropic). Gemini is not supported
  for tools yet.

Small models get a small tool set; strong ones more. The loop and its events follow the Pi
agent's vocabulary (`agent_start`, `turn_start`, `message_update`, `tool_execution_start/end`,
`agent_end`).

To try Pi against a real model from the command line:

```bash
PI_LIVE_MODEL=qwen3:8b PI_LIVE_URL=http://localhost:11434/v1 pnpm exec vitest run src/agent/__tests__/piLive.test.ts
```

## Not done yet

- Pi as a separate, embeddable script for other pages (the agent and the runtime are ready to
  be packaged; the page integration is not).
- The local model has only been wired, not yet tried in a browser on a full download.
- MCP over HTTP (for hosted agents): stdio only for now.
