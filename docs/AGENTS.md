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

## Spinner, the in-app agent

The **Spinner** tab of the side panel is an agent inside the app (`src/agent/`; the code calls it Pi, after the Pi agent whose event vocabulary it follows). Write `@Spinner …` in the Storyline chat or in the field that `/` opens on the world, and the message goes to Spinner instead of a character: its tab opens and it answers there. If Spinner is not ready yet (the model is not downloaded), the message waits in its box.

It thinks either:

- **on this machine**: LiquidAI LFM3-1.7B (GGUF) on WebGPU, through the vendored runtime
  `public/vendor/Lfm3ForCausalLM.js` (from the `webml-community/LFM3-1.7B-WebGPU-Pi` Space,
  Apache-2.0). The weights (about 1.1 GB) download once, only when the person clicks
  "Download Spinner". Nothing leaves the browser.
- **with a cloud model**: the Brain API in the settings (OpenAI-compatible with tools:
  OpenAI, OpenRouter, Ollama, LM Studio, GitHub Models; or Anthropic). Gemini is not supported
  for tools yet.

Small models get a small tool set; strong ones more. The loop and its events follow the Pi
agent's vocabulary (`agent_start`, `turn_start`, `message_update`, `tool_execution_start/end`,
`agent_end`).

To try Spinner against a real model from the command line:

```bash
PI_LIVE_MODEL=qwen3:8b PI_LIVE_URL=http://localhost:11434/v1 pnpm exec vitest run src/agent/__tests__/piLive.test.ts
```

## Driving the app, walkthroughs and performances

Everything a person does with the interface is a tool too (`src/api/uiTools.ts`,
`src/app/uiControl.ts`, `src/app/overlay.ts`), so an agent can run the app completely:

| Tool | What it does |
|---|---|
| `ui_state` | The view, the side panel, the camera, the selected character, what is shown, paused or not |
| `ui_action` | `view`, `panel` (storyline, spinner, style, data, closed), `camera` (focus on a character, a place or the whole map; zoom; cut or glide; follow), `story_camera`, `select`, `show` (labels, bubbles, paths, subtitles), `top_bar`, `play`, `pause`, `speed`, `export_image` |
| `pointer` | A visible pointer moves to a button, tab or menu by its name ("Style", "Zoom in", "Message Spinner") or to something in the world, and clicks, hovers (its tip shows), chooses an option, types, or presses Enter |
| `draw` / `clear_drawings` | Arrows, rings, boxes, underlines, dots and labels in a running stitch, on a character (follows them), a place, a point, or a part of the interface |
| `narrate` | Says a line in the Traveler's voice with a caption, and waits until it is said |
| `perform` | Runs a whole script of these with waits in between, in the background; the world holds still while it runs (`world: "running"` to keep it going); `performance_status`, `stop_performance` |
| `guided_tour` | Starts a built-in narrated tour (`welcome`: what SeloAI is, loading a voice and a brain, how to use it), with a Stop button and Escape. Tours live in `src/app/guidedTours.ts` and never change the world or a setting |
| `mixer` | Levels for the characters' voices, the narrator, the guide (walkthrough narration), the music and master, 0 to 1 or off/half/on, with `fade_seconds`; `mode` sets a whole listening mode: story, chatty, chronicle, village (village life) or ambient (only music and people at their work). The Sound panel shows the same mixer |
| `music` | The village band (tapan, gaida, kaval), scored live to the story. With no arguments, what is playing and why. Direct it with `mood` (pastoral, lament, mystery, dread, tension, joy, festive, triumph), `intensity` (0 a drone, 0.3 a free-rhythm kaval, 0.5 a slow dance, 1 a wild horo), `dance` (free, bavno, pravo, paidushko, lesnoto, rachenitsa, daychovo, kopanitsa), `lead` (kaval, gaida), `urgent`, `hold_seconds`; what you leave out still follows the story. `action`: on, off, release (the story leads again); `listen`: scribe (default: the Scribe's model names the mood of the moment when one is loaded) or words (word lists only); `density` (how much music, 0 sparse to 1 continuous); `tone` (the band's sound: per instrument `level`, `breath`, `character` from 0 synth to 1 gritty; the drone's `voicing`, `movement`, `beating`; `ambience` reverb, room, echo; or `preset`: village, synth, gritty, mountain) |
| `export_performance` | Saves one playable HTML file: the world (no keys, no conversations) and the script. It opens SeloAI online in player mode (`?player`, which saves nothing) behind a Play card; `app_url` points it elsewhere |
| `start_recording` / `stop_recording` | Records to a video, MP4 where the browser records it natively (WebM elsewhere): `world` (the canvas, at once) or `app` (the whole tab with panels, pointer and sound; the person clicks Start on a card, which the browser requires) |

A walkthrough, for example:

```json
{ "name": "Tour of SeloAI", "record": "app", "steps": [
  { "narrate": "Welcome to Zmeyovo. Let me show you around." },
  { "ui_action": { "action": "camera", "focus": "the whole map" } },
  { "draw": { "shapes": [{ "shape": "arrow", "at": "Lamia", "text": "The Lamia guards the well", "seconds": 6 }] } },
  { "narrate": "The Lamia has coiled around the well and wants a sacrifice." },
  { "pointer": { "target": "Style", "action": "click" } },
  { "draw": { "shapes": [{ "shape": "ring", "at": "Night plate", "text": "Try another look", "seconds": 4 }] } },
  { "wait": 2 },
  { "pointer": { "target": "Night plate", "action": "click" } },
  { "wait_for": "quiet", "timeout": 10 }
] }
```

Not yet: recording a live session (a person's own clicks and drags) as a script to replay.

## Not done yet

- Spinner as a separate, embeddable script for other pages (the agent and the runtime are ready to
  be packaged; the page integration is not).
- MCP over HTTP (for hosted agents): stdio only for now.
