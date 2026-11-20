/**
 * Driving the app the way a person does, and putting on a performance: every control (views,
 * the side panel, the camera, what is shown, play and pause), a virtual pointer that clicks
 * buttons and opens menus by name, drawings over the world and the interface, narration in
 * the Traveler's voice with a caption, scripted performances made of all of these with waits
 * between them, and recording it all to a video. Made so an agent (Spinner, or one outside
 * over MCP or WebMCP) can give a walkthrough of SeloAI, or stage a scene like a play.
 */
import { brainRouter } from '../ai/brainRouter';
import { mixerLevels, setLevel, type MixerChannel } from '../ai/mixer';
import { MOOD_IDS, isMood } from '../music/cue';
import { DANCES, type DanceId } from '../music/theory';
import { villageMusic, type MusicDirection } from '../music/villageMusic';
import { describeRule, type RuleDraft } from '../music/bandRules';
import { TONE_PRESETS } from '../music/tone';
import { SOUND_MODES, applySoundMode, findSoundMode } from '../app/soundModes';
import { addDrawings, clearDrawings, hidePointer, pointerDo, setCaption, type Anchor, type Drawing, type PointerAction } from '../app/overlay';
import { recordingState, startRecording, stopRecording, type RecordWhat } from '../app/recorder';
import { appControls, hasVillage, villageControls, type PanelMode, type ShowWhat } from '../app/uiControl';
import { findNamedCharacter } from '../engine/names';
import type { VillageSimulation } from '../engine/simulation';
import type { ModelSettings, VillageMap, VillagerConfig } from '../engine/types';
import { resolveNear } from './authoringTools';
import { exportProjectJson } from '../storage/villageStore';
import type { PerformancePayload } from '../app/player';
import { GUIDED_TOURS } from '../app/guidedTours';
import type { SeloToolDefinition } from './seloToolRegistry';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const str = (description: string) => ({ type: 'string', description });

export const UI_TOOL_DEFINITIONS: SeloToolDefinition[] = [
  {
    name: 'ui_state',
    description: 'What the app shows now: the view, the side panel, the camera (centre, zoom, who it follows, story camera), the selected character, what is shown (labels, bubbles, paths, subtitles), whether the world is paused, and any recording.',
    inputSchema: obj({}),
  },
  {
    name: 'ui_action',
    description:
      'Do what a person does with the app. action is one of: view (village, observatory, world, patterns, characters, monitor, guides), panel (storyline, spinner, style, sound, data, closed), camera (focus on a character, a place or "the whole map", or x,y; zoom 1 is usual, up to 3.5; move cut or glide; follow true/false), story_camera (on: the camera follows the story by itself), select (a character), show (what: labels, speech_bubbles, thought_bubbles, subtitles, paths, performance; on), top_bar (show), play, pause, speed (number), export_image (view or tapestry).',
    inputSchema: obj(
      {
        action: str('view, panel, camera, story_camera, select, show, top_bar, play, pause, speed or export_image.'),
        view: str('For view.'),
        panel: str('For panel: storyline, spinner, style, sound, data or closed.'),
        focus: str('For camera: a character, a place or thing ("the well"), or "the whole map".'),
        x: { type: 'number', description: 'For camera: cell x.' },
        y: { type: 'number', description: 'For camera: cell y.' },
        zoom: { description: 'For camera: 1 is usual (about 0.4 to 3.5), or "whole".' },
        move: str('For camera: cut or glide (default glide).'),
        follow: { type: 'boolean', description: 'For camera on a character: keep following them (default true).' },
        on: { type: 'boolean', description: 'For story_camera and show.' },
        what: str('For show: labels, speech_bubbles, thought_bubbles, subtitles, paths, performance. For export_image: view or tapestry.'),
        character: str('For select.'),
        show: { type: 'boolean', description: 'For top_bar.' },
        speed: { type: 'number', description: 'For speed: 1 is usual, 0 pauses, up to 8.' },
      },
      ['action'],
    ),
  },
  {
    name: 'pointer',
    description:
      'Move a visible pointer, as a person would, to a part of the interface by its name ("Style", "Zoom in", "Show speech bubbles", "Message Spinner") or to something in the world (a character, a place, "x,y"), and click it, hover over it (to show its tip), choose an option in a menu (value), type into a field (value), or press Enter. Use it to show someone how to use the app.',
    inputSchema: obj(
      {
        target: str('What to point at: an interface name, a character, a place, or "x,y".'),
        action: str('move, click, hover, choose, type or press_enter (default click).'),
        value: str('For choose: the option. For type: the text.'),
        on: str('Optional: "ui" or "world", when a name could be either.'),
        speed: str('Optional: slow, normal (default) or quick.'),
      },
      ['target'],
    ),
  },
  {
    name: 'draw',
    description:
      'Draw over the app in stitched thread: shapes is a list of { shape: arrow, ring, box, underline, dot or label; at: a character (follows them), a place, "x,y" in the world, or an interface name; from: where an arrow starts (optional); text: words beside it; colour; seconds: how long it stays (default until cleared) }. Returns ids for clear_drawings.',
    inputSchema: obj(
      {
        shapes: {
          type: 'array',
          items: obj({ shape: str('arrow, ring, box, underline, dot or label.'), at: str('What it marks.'), from: str('For an arrow: where it starts.'), text: str('Words beside it.'), colour: str('A CSS colour.'), seconds: { type: 'number' } }, ['shape', 'at']),
        },
      },
      ['shapes'],
    ),
  },
  {
    name: 'clear_drawings',
    description: 'Clear drawings: the ids given, or all of them. Also hides the pointer.',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' } } }),
  },
  {
    name: 'narrate',
    description: "Say something aloud in the Traveler's voice, with a caption on screen, as a walkthrough's narrator. Waits until it has been said (unless wait is false).",
    inputSchema: obj({ text: str('What to say.'), wait: { type: 'boolean', description: 'Wait until it is said (default true).' } }, ['text']),
  },
  {
    name: 'perform',
    description:
      'Run a whole performance from a script, start to end, in the background: steps is a list, each one of { tool: name, args: {...} } (any tool: narrate, pointer, draw, ui_action, instruct_world, change_setting…), { wait: seconds }, or { wait_for: "quiet" (no one speaking) or "line" (the next line spoken), timeout: seconds }. Shorthand: { narrate: "text" } or { ui_action: {...} }. record: "app" (the whole app; the person clicks Start) or "world" records it to a video (MP4 where the browser can). The world holds still while it runs (world: "running" to keep it going). Returns at once; follow with performance_status.',
    inputSchema: obj(
      {
        name: str('A name for the performance (used for the video file).'),
        steps: { type: 'array', items: { type: 'object' } },
        record: str('Optional: app or world.'),
        world: str('paused (default: the characters hold still and quiet, for a walkthrough) or running (they go on living, for a staged scene).'),
      },
      ['steps'],
    ),
  },
  {
    name: 'mixer',
    description:
      'The sound mixer: levels for voices (the characters), narrator (the Scribe), guide (narrate, in the Traveler\'s voice), music (the band; see the music tool) and master, from 0 to 1 (or "off", "half", "on"). fade_seconds ramps smoothly, e.g. fade the voices in after a walkthrough. mode sets a whole listening mode (e.g. ambient). With no levels, says the current ones. The Sound panel shows the same mixer.',
    inputSchema: obj({
      voices: { description: 'The characters: 0 to 1, or off, half, on.' },
      narrator: { description: 'The Scribe: 0 to 1, or off, half, on.' },
      guide: { description: 'Walkthrough narration: 0 to 1, or off, half, on.' },
      music: { description: 'The band (tapan, gaida, kaval): 0 to 1, or off, half, on.' },
      mode: str('A listening mode, setting levels and how much each part says at once: story (usual), chatty, chronicle (the Scribe leads), village (village life: little talk), ambient (only music and people at their work). Fine-tune how much characters talk and the Scribe tells with change_setting talk_density / scribe_density.'),
      master: { description: 'Everything: 0 to 1, or off, half, on.' },
      fade_seconds: { type: 'number', description: 'How long the change takes (default 0: at once).' },
    }),
  },
  {
    name: 'music',
    description:
      'The village band (tapan drum, gaida bagpipe, kaval flute), composed live and scored to the story: the Scribe\'s model reads the latest moment and names its mood (word lists fill in between and when no model is loaded), and the band picks an intensity, from a bare drone (0) through a free-rhythm kaval (0.3) and a slow dance (0.5) to a wild horo (1). Direct it like a musical director: a mood, an intensity, a dance or a lead, held for hold_seconds or until released; what you leave out still follows the story. Use it to score a scene, build tension before a reveal, or start a wedding horo. With no arguments, says what is playing and why.',
    inputSchema: obj({
      action: str('on, off, direct (default when a mood, intensity, dance or lead is given), release (let the story lead again), or status.'),
      mood: str('pastoral, lament, mystery, dread, tension, joy, festive or triumph.'),
      intensity: { type: 'number', description: '0 (a drone) to 1 (a wild dance).' },
      dance: str('free (unmetered), bavno, pravo, paidushko (5/16), lesnoto (7/8), rachenitsa (7/16), daychovo (9/16) or kopanitsa (11/16).'),
      lead: str('kaval or gaida.'),
      urgent: { type: 'boolean', description: 'Reach the intensity in a few seconds instead of easing over half a minute.' },
      hold_seconds: { type: 'number', description: 'How long the direction holds (default: until released or replaced).' },
      reason: str('Why, in a few words (shown in status).'),
      listen: str("Who reads the story for the band: scribe (the Scribe's model names the mood of the moment when one is loaded; the default) or words (word lists only)."),
      ambience: { type: 'number', description: 'How much ambience, 0 (none) to 1: the drone drifting over many bars and a soft, sparse tapan, always underneath, thinner under speech.' },
      between: { type: 'number', description: 'How much in-between, 0 (none) to 1: motifs around the lines of the story; higher comes sooner after a line, returns more often in a gap and lingers longer under the next line.' },
      song: { type: 'number', description: 'How much song, 0 (never) to 1: the band in full while no one speaks; higher starts sooner after the story falls quiet and plays longer.' },
      tone: {
        type: 'object',
        description:
          'The band\'s sound; give only what changes. gaida, kaval, tapan and drone each take level, breath (air and noise) and character (0 a clean electronic synth, 0.5 usual, 1 gritty), all 0 to 1; drone also takes voicing (tonic, fifth, octave, open), movement and beating; ambience takes reverb, room (0 a small house to 1 a gorge) and echo. Or preset: village, synthfolk, gritty or mountain.',
      },
    }),
  },
  {
    name: 'band_rules',
    description:
      "The band's standing rules, from listening: what to keep doing and what to leave out. Use it when the person points at the music (a phrase on the Loom, a moment) and says keep this, drop that, less of the drum, no trills, not that dance. keep_figure keeps the melodic figure of a phrase (by its phrase_id, phrase-<time>, given with the phrase) and plays it again in moments like it, moved into the mood's mode. add makes a rule of a kind: thin (an instrument plays less; amount 1, the default, leaves it out), no_ornaments (graces, glide, trill off the kaval or gaida), prefer_dance or avoid_dance. Every rule can be held to a mood and a part (ambience, between, song); left out, it holds everywhere. Rules last until removed and are remembered on this device. With no arguments, lists them.",
    inputSchema: obj({
      action: str('list (default), keep_figure, add, remove or clear.'),
      phrase_id: str('keep_figure: the phrase, phrase-<time>.'),
      kind: str('add: thin, no_ornaments, prefer_dance or avoid_dance.'),
      instrument: str('kaval, gaida, tapan or drone (thin); kaval or gaida (no_ornaments, keep_figure).'),
      amount: { type: 'number', description: 'thin: how much less, 0 to 1 (1 leaves it out).' },
      ornaments: str('no_ornaments: graces, glide and/or trill (default all).'),
      dance: str('prefer_dance / avoid_dance: bavno, pravo, paidushko, lesnoto, rachenitsa, daychovo or kopanitsa.'),
      mood: str('Hold the rule to a mood: pastoral, lament, mystery, dread, tension, joy, festive, triumph, or any. keep_figure defaults to the phrase\'s mood.'),
      part: str('Hold the rule to a part: ambience, between or song, or any. keep_figure defaults to the phrase\'s part.'),
      weight: { type: 'number', description: 'keep_figure: how often it comes back where it fits, 0 to 1 (default 0.5).' },
      name: str('keep_figure: a name for it, e.g. "the Lamia\'s call".'),
      reason: str("Why, in the person's words."),
      id: str('remove: the rule.'),
    }),
  },
  {
    name: 'export_performance',
    description:
      'Save a performance as one playable HTML file: the current world (place, characters, story; no keys, no conversations) and the script (same steps as perform). Opening the file shows a Play button; it plays in SeloAI online (or app_url), in a player that saves nothing. For a video instead, use perform with record.',
    inputSchema: obj(
      {
        name: str('The title of the performance.'),
        steps: { type: 'array', items: { type: 'object' } },
        world: str('paused (default) or running, as for perform.'),
        app_url: str('Where SeloAI is served (default: the published app).'),
      },
      ['name', 'steps'],
    ),
  },
  { name: 'performance_status', description: 'How the running (or last) performance is going: the step it is on and what each step did.', inputSchema: obj({}) },
  { name: 'stop_performance', description: 'Stop the running performance (and save its recording).', inputSchema: obj({}) },
  {
    name: 'guided_tour',
    description: 'Start one of the built-in narrated tours of SeloAI, for someone new: "welcome" (what SeloAI is, loading a voice and a brain, and how to use it). Runs in the background with a Stop button.',
    inputSchema: obj({ tour: str('Which tour: welcome (default).') }),
  },
  {
    name: 'start_recording',
    description: 'Record to a video: "app" (the whole app with sound; the person clicks Start on a card) or "world" (just the world, at once).',
    inputSchema: obj({ what: str('app or world.'), name: str('A name for the video file.') }, ['what']),
  },
  { name: 'stop_recording', description: 'Stop recording and save the video (it downloads).', inputSchema: obj({}) },
];

export const UI_TOOL_NAMES = new Set(UI_TOOL_DEFINITIONS.map((t) => t.name));
export const isUiTool = (name: string) => UI_TOOL_NAMES.has(name);

export interface UiHost {
  sim: VillageSimulation;
  map: () => VillageMap;
  cast: () => VillagerConfig[];
  settings: () => ModelSettings;
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WHOLE = /^(the )?(whole|entire|full)( map| world| village)?$|^(everything|everywhere|overview|all)$/i;

/** A character by name, or the Traveler. */
function characterId(name: string, host: UiHost): string | undefined {
  if (/^(me|the traveler|traveler|the player|player|you)$/i.test(name.trim())) return host.sim.player.id;
  return findNamedCharacter(name, host.cast())?.id;
}

/** What a target names: a point, a character, a place or thing, or (else) a part of the interface. */
function anchorFor(target: string, host: UiHost, prefer?: 'ui' | 'world'): Anchor {
  const t = target.trim();
  const xy = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (xy) return { world: { x: Number(xy[1]), y: Number(xy[2]) } };
  const prefixed = /^(ui|world|character|place):\s*(.+)$/i.exec(t);
  if (prefixed) {
    const [, kind, rest] = prefixed;
    if (kind.toLowerCase() === 'ui') return { ui: rest };
    return anchorFor(rest, host, 'world');
  }
  if (prefer !== 'ui') {
    const id = characterId(t, host);
    if (id) return { character: id };
    const near = resolveNear(t, { map: host.map(), cast: host.cast() }, host.sim);
    if (near) return { world: near };
    if (prefer === 'world') throw new Error(`Nothing in the world called "${target}".`);
  }
  return { ui: t };
}

/** For the pointer: a part of the interface first (it is mostly for showing the app), then the world. */
async function pointerTarget(target: string, host: UiHost, on?: string): Promise<Anchor> {
  if (on === 'world') return anchorFor(target, host, 'world');
  if (on === 'ui') return { ui: target };
  const { findUi } = await import('../app/overlay');
  try {
    findUi(target);
    return { ui: target };
  } catch (err) {
    try {
      return anchorFor(target, host, 'world');
    } catch {
      throw err;
    }
  }
}

function traveler(host: UiHost): VillagerConfig {
  const s = host.settings();
  return {
    id: host.sim.player.id,
    name: host.sim.player.name,
    role: 'Traveler',
    spritesheetId: 'custom',
    accentColor: '#3b5b8c',
    identity: '',
    plan: '',
    voiceStyle: '',
    voice: s.playerVoice,
    homeTile: { x: 0, y: 0 },
    speed: 0,
  };
}

/** Says a line in the Traveler's voice with a caption; resolves once it has been said and read. */
async function narrate(text: string, host: UiHost): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  setCaption({ speaker: host.sim.player.name || 'Traveler', text: clean });
  const started = performance.now();
  try {
    await brainRouter.speakLine(clean, traveler(host), host.settings(), undefined, { preview: true });
  } catch {
    // No voice: the caption still shows for its reading time.
  }
  // At least long enough to read it (about 3 words a second), plus a breath.
  const readMs = 900 + clean.split(/\s+/).length * 330;
  const left = readMs - (performance.now() - started);
  if (left > 0) await pausable(left);
  await pausable(350);
  if (performance.now() - started > 0) setCaption(null);
}

// ---------------------------------------------------------------------------------------------
// Performances
// ---------------------------------------------------------------------------------------------

interface StepResult {
  step: number;
  did: string;
  ok: boolean;
  note?: string;
}

interface Run {
  id: string;
  name: string;
  total: number;
  at: number;
  state: 'running' | 'done' | 'stopped' | 'failed';
  results: StepResult[];
  stop: boolean;
  /** Show a small bar with the progress and a Stop button (guided tours). */
  controls: boolean;
  recorded?: { file?: string; seconds?: number; note?: string };
}

let run: Run | null = null;

const perfListeners = new Set<() => void>();
let perfVersion = 0;
const perfChanged = () => {
  perfVersion++;
  for (const fn of perfListeners) fn();
};
export const subscribePerformance = (fn: () => void) => {
  perfListeners.add(fn);
  return () => perfListeners.delete(fn);
};
export const performanceVersion = () => perfVersion;

/** The running performance, for the overlay's progress bar. */
export function currentPerformance(): { name: string; at: number; total: number; controls: boolean } | null {
  return run?.state === 'running' && !run.stop ? { name: run.name, at: run.at, total: run.total, controls: run.controls } : null;
}

/** Stops the running performance at once: its voice, caption, drawings and pointer go too. */
export function stopCurrentPerformance(): string | null {
  if (run?.state !== 'running') return null;
  run.stop = true;
  brainRouter.flushAudioQueue();
  setCaption(null);
  clearDrawings();
  hidePointer();
  perfChanged();
  return run.name;
}

/** A wait that ends early when the running performance is stopped. */
async function pausable(ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    if (run?.stop) return;
    await sleep(Math.min(100, until - performance.now()));
  }
}

type Step = Record<string, unknown>;

/** A script step as { tool, args }, from any of the accepted shapes. */
function normalise(step: Step, known: Set<string>): { kind: 'tool'; tool: string; args: Record<string, unknown> } | { kind: 'wait'; seconds: number } | { kind: 'wait_for'; what: string; timeout: number } {
  if (typeof step.wait === 'number') return { kind: 'wait', seconds: step.wait };
  if (typeof step.wait_for === 'string') return { kind: 'wait_for', what: step.wait_for, timeout: Number(step.timeout) || 30 };
  if (typeof step.tool === 'string') return { kind: 'tool', tool: step.tool, args: (step.args as Record<string, unknown>) ?? {} };
  const keys = Object.keys(step);
  const tool = keys.find((k) => known.has(k));
  if (tool) {
    const v = step[tool];
    const args = typeof v === 'string' ? (tool === 'narrate' ? { text: v } : tool === 'instruct_world' ? { text: v } : { target: v }) : ((v as Record<string, unknown>) ?? {});
    return { kind: 'tool', tool, args };
  }
  throw new Error(`Step not understood: ${JSON.stringify(step).slice(0, 120)}. Use { tool, args }, { wait }, or { wait_for }.`);
}

/** Lines said so far (to wait for the next). */
const linesSoFar = (sim: VillageSimulation) => sim.conversations.reduce((n, c) => n + c.messages.length, 0);

async function waitFor(what: string, timeoutS: number, host: UiHost, isStopped: () => boolean): Promise<string> {
  const until = performance.now() + timeoutS * 1000;
  const startLines = linesSoFar(host.sim);
  while (performance.now() < until && !isStopped()) {
    if (what === 'line' && linesSoFar(host.sim) > startLines) return 'a line was said';
    if (what === 'quiet') {
      const speaking = brainRouter.activeSpeechInfo || [...host.sim.runtimes.values()].some((r) => r.state === 'speaking' || r.state === 'thinking');
      if (!speaking) return 'quiet';
    }
    await sleep(200);
  }
  return isStopped() ? 'stopped' : 'timed out';
}

async function perform(args: Record<string, unknown>, host: UiHost, known: Set<string>): Promise<Run> {
  if (run?.state === 'running') throw new Error(`"${run.name}" is still running (step ${run.at} of ${run.total}). stop_performance first.`);
  const steps = Array.isArray(args.steps) ? (args.steps as Step[]) : [];
  if (!steps.length) throw new Error('A performance needs steps.');
  const plan = steps.map((s) => normalise(s, known));
  for (const p of plan) if (p.kind === 'tool' && (p.tool === 'perform' || !known.has(p.tool))) throw new Error(`Unknown or not allowed in a script: "${p.tool}".`);
  const name = String(args.name ?? 'performance');
  const current: Run = { id: `perf-${Date.now().toString(36)}`, name, total: plan.length, at: 0, state: 'running', results: [], stop: false, controls: args.controls === true };
  run = current;
  perfChanged();
  const record = args.record === 'app' || args.record === 'world' ? (args.record as RecordWhat) : null;
  // A walkthrough holds the world still, so the characters do not talk over the narrator;
  // world: "running" keeps it going (for a staged scene). Restored at the end.
  const holdWorld = args.world !== 'running';
  const wasPaused = host.sim.paused;

  void (async () => {
    if (holdWorld) {
      host.sim.paused = true;
      brainRouter.flushAudioQueue();
    }
    try {
      if (record) {
        const r = await startRecording(record, name);
        current.recorded = { note: r.started ? undefined : r.note };
        // The browser's sharing prompt settles in a moment; give the film a clean first frame.
        if (r.started) await sleep(600);
      }
      for (let i = 0; i < plan.length; i++) {
        if (current.stop) break;
        current.at = i + 1;
        perfChanged();
        const p = plan[i];
        try {
          if (p.kind === 'wait') {
            await pausable(Math.max(0, Math.min(600, p.seconds)) * 1000);
            current.results.push({ step: i + 1, did: `waited ${p.seconds} s`, ok: true });
          } else if (p.kind === 'wait_for') {
            const got = await waitFor(p.what, p.timeout, host, () => current.stop);
            current.results.push({ step: i + 1, did: `waited for ${p.what}: ${got}`, ok: got !== 'timed out' });
          } else {
            const out = await host.call(p.tool, p.args);
            current.results.push({ step: i + 1, did: p.tool, ok: true, note: JSON.stringify(out)?.slice(0, 160) });
          }
        } catch (err) {
          current.results.push({ step: i + 1, did: p.kind === 'tool' ? p.tool : p.kind, ok: false, note: err instanceof Error ? err.message.slice(0, 200) : String(err) });
        }
      }
      current.state = current.stop ? 'stopped' : 'done';
    } catch (err) {
      current.state = 'failed';
      current.results.push({ step: current.at, did: 'performance', ok: false, note: err instanceof Error ? err.message : String(err) });
    } finally {
      hidePointer();
      setCaption(null);
      // Back as it was, unless the script itself set the world playing (a tour's last step).
      if (holdWorld && host.sim.paused) host.sim.paused = wasPaused;
      perfChanged();
      if (record && recordingState().recording) {
        await sleep(500);
        const saved = await stopRecording();
        current.recorded = { file: saved.file, seconds: saved.seconds };
      }
    }
  })();
  return current;
}

const runReport = (r: Run | null) =>
  r
    ? {
        name: r.name,
        state: r.state,
        step: r.at,
        of: r.total,
        failed: r.results.filter((x) => !x.ok).map((x) => `step ${x.step} (${x.did}): ${x.note}`),
        recent: r.results.slice(-5),
        ...(r.recorded ? { recording: r.recorded } : {}),
      }
    : { state: 'none' };

// ---------------------------------------------------------------------------------------------

export async function runUiTool(name: string, args: Record<string, any>, host: UiHost, known: Set<string>): Promise<any> {
  switch (name) {
    case 'ui_state': {
      const app = appControls().state();
      const village = hasVillage() ? villageControls().state() : null;
      const selected = village?.selected ? host.cast().find((c) => c.id === village.selected)?.name ?? village.selected : null;
      const following = village?.camera.following ? host.cast().find((c) => c.id === village.camera.following)?.name ?? village.camera.following : null;
      return {
        ...app,
        ...(village ? { camera: { ...village.camera, following }, selected, shown: village.shown } : { note: 'The village view is not showing, so there is no camera.' }),
        world: { paused: host.sim.paused, speed: host.sim.speedMultiplier },
        recording: recordingState(),
        mixer: Object.fromEntries(Object.entries(mixerLevels()).map(([k, v]) => [k, `${Math.round(v * 100)}%`])),
        performance: runReport(run).state,
      };
    }

    case 'ui_action': {
      const action = String(args.action ?? '').toLowerCase().replace(/\s+/g, '_');
      switch (action) {
        case 'view':
        case 'tab':
          appControls().setTab(String(args.view ?? args.tab ?? 'village'));
          return { ok: true, view: appControls().state().tab };
        case 'panel': {
          const raw = String(args.panel ?? 'closed').toLowerCase();
          const mode = (['storyline', 'spinner', 'style', 'sound', 'data', 'closed'].find((m) => raw.includes(m)) ?? (/world|data/.test(raw) ? 'data' : /mix|audio|music/.test(raw) ? 'sound' : /close|hide|none|off/.test(raw) ? 'closed' : undefined)) as PanelMode | undefined;
          if (!mode) throw new Error('panel is storyline, spinner, style, sound, data or closed.');
          appControls().setPanel(mode);
          return { ok: true, panel: mode };
        }
        case 'top_bar':
          appControls().setTopBar(args.show !== false);
          return { ok: true };
        case 'camera': {
          const v = villageControls();
          const zoom = typeof args.zoom === 'string' && WHOLE.test(args.zoom) ? 'whole' : typeof args.zoom === 'number' ? args.zoom : undefined;
          const move = args.move === 'cut' ? 'cut' : 'glide';
          const focus = typeof args.focus === 'string' ? args.focus.trim() : '';
          if (focus && WHOLE.test(focus)) {
            v.camera({ zoom: 'whole', move });
            return { ok: true, camera: 'the whole map' };
          }
          if (focus) {
            const id = characterId(focus, host);
            if (id) {
              const follow = args.follow !== false;
              const at = v.characterCell(id);
              v.camera(follow ? { follow: id, zoom: zoom ?? 2.1, move } : { x: at?.x, y: at?.y, zoom: zoom ?? 2.1, move });
              return { ok: true, camera: `${follow ? 'following' : 'on'} ${host.cast().find((c) => c.id === id)?.name ?? 'the Traveler'}` };
            }
            const near = resolveNear(focus, { map: host.map(), cast: host.cast() }, host.sim);
            if (!near) throw new Error(`Nothing called "${focus}" to look at. Name a character, a place, or "the whole map".`);
            v.camera({ x: near.x, y: near.y, zoom: zoom ?? 1.8, move, follow: null });
            return { ok: true, camera: `on ${focus}` };
          }
          if (typeof args.x === 'number' && typeof args.y === 'number') {
            v.camera({ x: args.x, y: args.y, zoom, move, follow: null });
            return { ok: true };
          }
          if (zoom !== undefined) {
            v.camera({ zoom, move });
            return { ok: true };
          }
          throw new Error('camera needs focus, x and y, or zoom.');
        }
        case 'story_camera':
          villageControls().storyCamera(args.on !== false);
          return { ok: true, storyCamera: args.on !== false };
        case 'select': {
          const id = characterId(String(args.character ?? ''), host);
          if (!id) throw new Error(`No character called "${args.character}".`);
          villageControls().select(id);
          return { ok: true };
        }
        case 'show': {
          const what = String(args.what ?? '').toLowerCase().replace(/\s+/g, '_').replace(/^(the_)?/, '');
          const map: Record<string, ShowWhat> = { labels: 'labels', names: 'labels', speech: 'speech_bubbles', speech_bubbles: 'speech_bubbles', bubbles: 'speech_bubbles', thoughts: 'thought_bubbles', thought_bubbles: 'thought_bubbles', subtitles: 'subtitles', scribe: 'subtitles', paths: 'paths', performance: 'performance', fps: 'performance' };
          const key = map[what];
          if (!key) throw new Error('show what: labels, speech_bubbles, thought_bubbles, subtitles, paths or performance.');
          villageControls().show(key, args.on !== false);
          return { ok: true, [key]: args.on !== false };
        }
        case 'play':
          host.sim.paused = false;
          return { ok: true, paused: false };
        case 'pause':
          host.sim.paused = true;
          return { ok: true, paused: true };
        case 'speed':
          return host.call('control_simulation', { speedMultiplier: Number(args.speed ?? 1) });
        case 'export_image':
          appControls().exportImage(args.what === 'tapestry' ? 'tapestry' : 'view');
          return { ok: true, note: 'The image downloads.' };
        default:
          throw new Error('action is one of: view, panel, camera, story_camera, select, show, top_bar, play, pause, speed, export_image.');
      }
    }

    case 'pointer': {
      const target = await pointerTarget(String(args.target ?? ''), host, args.on);
      const action = (['move', 'click', 'hover', 'choose', 'type', 'press_enter'].includes(String(args.action)) ? args.action : 'click') as PointerAction;
      const ms = args.speed === 'slow' ? 1100 : args.speed === 'quick' ? 300 : 650;
      const out = await pointerDo(target, action, args.value === undefined ? undefined : String(args.value), ms);
      return { ok: true, action, ...out };
    }

    case 'draw': {
      const shapes = Array.isArray(args.shapes) ? args.shapes : [];
      if (!shapes.length) throw new Error('Give shapes to draw.');
      const list: Array<Omit<Drawing, 'id'>> = shapes.map((s: Record<string, unknown>) => {
        const shape = String(s.shape ?? 'ring') as Drawing['shape'];
        if (!['arrow', 'ring', 'box', 'underline', 'dot', 'label'].includes(shape)) throw new Error(`Cannot draw "${s.shape}". Shapes: arrow, ring, box, underline, dot, label.`);
        const at = anchorFor(String(s.at ?? ''), host);
        return {
          shape,
          at,
          ...(typeof s.from === 'string' && s.from.trim() ? { from: anchorFor(s.from, host) } : {}),
          ...(typeof s.text === 'string' && s.text.trim() ? { text: s.text.trim() } : {}),
          ...(typeof s.colour === 'string' || typeof s.color === 'string' ? { colour: String(s.colour ?? s.color) } : {}),
          ...(typeof s.size === 'number' ? { size: s.size } : {}),
          ...(typeof s.seconds === 'number' ? { until: performance.now() + s.seconds * 1000 } : {}),
        };
      });
      return { ok: true, ids: addDrawings(list) };
    }

    case 'clear_drawings':
      clearDrawings(Array.isArray(args.ids) ? args.ids.map(String) : undefined);
      if (!Array.isArray(args.ids)) hidePointer();
      return { ok: true };

    case 'narrate': {
      const text = String(args.text ?? '');
      if (!text.trim()) throw new Error('Give the text to say.');
      if (args.wait === false) {
        void narrate(text, host);
        return { ok: true, speaking: true };
      }
      await narrate(text, host);
      return { ok: true, said: text };
    }

    case 'mixer': {
      const fade = Math.max(0, Math.min(30, Number(args.fade_seconds) || 0));
      const read = (v: unknown): number | undefined => {
        if (v === undefined || v === null || v === '') return undefined;
        if (typeof v === 'number') return v > 1 ? v / 100 : v;
        const t = String(v).trim().toLowerCase();
        if (/^(off|mute|muted|silent|none|0)$/.test(t)) return 0;
        if (/^(on|full|max|unmute|1)$/.test(t)) return 1;
        if (/^(half|low|quiet)$/.test(t)) return t === 'half' ? 0.5 : 0.25;
        const n = Number(t.replace('%', ''));
        if (!Number.isFinite(n)) throw new Error(`"${v}" is not a level: use 0 to 1, or off, half, on.`);
        return t.endsWith('%') || n > 1 ? n / 100 : n;
      };
      const changed: string[] = [];
      if (args.mode !== undefined) {
        const m = findSoundMode(String(args.mode));
        if (!m) throw new Error(`"${args.mode}" is not a mode: use ${SOUND_MODES.map((x) => x.id).join(', ')}.`);
        applySoundMode(m, (patch) => void host.call('change_settings', { changes: { talk_density: patch.talkDensity, scribe_density: patch.scribeDensity, story_pace: patch.storyPace } }));
        changed.push(`mode → ${m.label}: ${m.about}`);
      }
      for (const ch of ['voices', 'narrator', 'guide', 'music', 'master'] as MixerChannel[]) {
        const level = read(args[ch]);
        if (level === undefined) continue;
        setLevel(ch, level, fade);
        changed.push(`${ch} → ${Math.round(level * 100)}%`);
      }
      if (fade && changed.length) await sleep(fade * 1000);
      const now = mixerLevels();
      return { ok: true, ...(changed.length ? { changed } : {}), levels: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, `${Math.round(v * 100)}%`])) };
    }

    case 'music': {
      const music = villageMusic;
      const given = ['mood', 'intensity', 'dance', 'lead', 'urgent'].some((k) => args[k] !== undefined && args[k] !== null && args[k] !== '');
      const amounts: Record<string, number> = {};
      for (const k of ['ambience', 'between', 'song'] as const) {
        if (args[k] === undefined) continue;
        const n = Number(args[k]);
        if (!Number.isFinite(n)) throw new Error(`${k} is a number from 0 to 1.`);
        amounts[k] = n > 1 ? n / 100 : n;
      }
      if (Object.keys(amounts).length) music.setAmounts(amounts);
      if (args.tone && typeof args.tone === 'object') {
        const t = args.tone as Record<string, any>;
        if (t.preset !== undefined) {
          const p = TONE_PRESETS[String(t.preset).toLowerCase()];
          if (!p) throw new Error(`"${t.preset}" is not a preset: use ${Object.keys(TONE_PRESETS).join(', ')}.`);
          music.setTone(p.tone);
        }
        const { preset: _preset, ...rest } = t;
        void _preset;
        if (Object.keys(rest).length) music.setTone(rest);
      }
      if (args.listen !== undefined) {
        const who = String(args.listen).toLowerCase();
        if (who !== 'scribe' && who !== 'words') throw new Error('listen is scribe or words.');
        music.listenWith(who);
      }
      const action = String(args.action ?? (given ? 'direct' : 'status')).toLowerCase();
      if (action === 'on') music.setEnabled(true);
      else if (action === 'off') music.setEnabled(false);
      else if (action === 'release' || action === 'auto') music.release();
      else if (action === 'direct') {
        const d: MusicDirection = {};
        if (args.mood !== undefined) {
          const m = String(args.mood).toLowerCase();
          if (!isMood(m)) throw new Error(`"${args.mood}" is not a mood: use ${MOOD_IDS.join(', ')}.`);
          d.mood = m;
        }
        if (args.intensity !== undefined) {
          const n = Number(args.intensity);
          if (!Number.isFinite(n)) throw new Error('intensity is a number from 0 to 1.');
          d.intensity = n > 1 ? n / 100 : n;
        }
        if (args.dance !== undefined) {
          const dn = String(args.dance).toLowerCase() as DanceId;
          if (!(dn in DANCES)) throw new Error(`"${args.dance}" is not a dance: use ${Object.keys(DANCES).join(', ')}.`);
          d.dance = dn;
        }
        if (args.lead !== undefined) {
          const l = String(args.lead).toLowerCase();
          if (l !== 'kaval' && l !== 'gaida') throw new Error('lead is kaval or gaida.');
          d.lead = l;
        }
        if (args.urgent) d.urgent = true;
        if (args.reason) d.reason = String(args.reason);
        if (Number(args.hold_seconds) > 0) d.holdSeconds = Number(args.hold_seconds);
        music.direct(d);
        if (!music.enabled) music.setEnabled(true);
      } else if (action !== 'status') throw new Error('action is on, off, direct, release or status.');
      const st = music.status();
      return {
        ok: true,
        on: st.on,
        playing: st.playing ?? (st.on ? 'waiting for a click to start the sound' : 'off'),
        mood: st.cue.mood,
        intensity: { target: st.cue.intensity, now: Math.round(st.intensity * 100) / 100 },
        ...(st.cue.dance ? { dance: st.cue.dance } : {}),
        ...(st.cue.lead ? { lead: st.cue.lead } : {}),
        why: st.cue.reason,
        story_alone: `${st.heard.mood} at ${st.heard.intensity}`,
        listening: st.listening,
        speaking: st.speaking,
        ...(st.scribe ? { scribe_heard: `${st.scribe.mood} ${st.scribe.intensity}${st.scribe.reason ? ` — ${st.scribe.reason}` : ''}` } : {}),
        part: st.part,
        amounts: music.amounts,
        tone: music.tone,
        directed: st.direction ? (st.direction.until ? `for ${Math.max(0, Math.round((st.direction.until - Date.now()) / 1000))} more seconds` : 'until released') : false,
        rules: music.rules.map((r) => ({ id: r.id, rule: describeRule(r) })),
      };
    }

    case 'band_rules': {
      const music = villageMusic;
      const action = String(args.action ?? 'list').toLowerCase();
      const scope = () => {
        const when: { mood?: any; part?: any } = {};
        if (args.mood && String(args.mood) !== 'any') {
          if (!isMood(String(args.mood))) throw new Error(`mood is one of ${MOOD_IDS.join(', ')}, or any.`);
          when.mood = String(args.mood);
        }
        if (args.part && String(args.part) !== 'any') when.part = String(args.part) === 'in-between' ? 'between' : String(args.part);
        return when;
      };
      const list = () => music.rules.map((r) => ({ id: r.id, rule: describeRule(r), ...(r.reason ? { why: r.reason } : {}) }));
      if (action === 'list') return { ok: true, rules: list() };
      if (action === 'remove') {
        if (!args.id) throw new Error('id is the rule to drop (from list).');
        if (!music.removeRule(String(args.id))) throw new Error(`No rule "${args.id}".`);
        return { ok: true, rules: list() };
      }
      if (action === 'clear') {
        music.clearRules();
        return { ok: true, rules: [] };
      }
      if (action === 'keep_figure') {
        if (!args.phrase_id) throw new Error('phrase_id is the phrase whose figure to keep (from the Loom: phrase-<time>).');
        const inst = args.instrument ? String(args.instrument).toLowerCase() : undefined;
        if (inst && inst !== 'kaval' && inst !== 'gaida') throw new Error('A figure is kept on the kaval or the gaida.');
        const rule = music.keepFigure(String(args.phrase_id), {
          instrument: inst as 'kaval' | 'gaida' | undefined,
          name: args.name ? String(args.name) : undefined,
          mood: args.mood ? (String(args.mood) === 'any' ? 'any' : (scope().mood as never)) : undefined,
          part: args.part ? (String(args.part) === 'any' ? 'any' : (scope().part as never)) : undefined,
          weight: args.weight !== undefined ? Number(args.weight) : undefined,
          reason: args.reason ? String(args.reason) : undefined,
        });
        return { ok: true, added: { id: rule.id, rule: describeRule(rule) }, rules: list() };
      }
      if (action === 'add') {
        const kind = String(args.kind ?? '');
        const base = { when: scope(), reason: args.reason ? String(args.reason) : undefined };
        let draft: RuleDraft;
        if (kind === 'thin' || kind === 'omit') {
          const amount = args.amount === undefined ? 1 : Number(args.amount);
          draft = { ...base, kind: 'thin', instrument: String(args.instrument ?? '').toLowerCase() as never, amount: amount > 1 ? amount / 100 : amount };
        } else if (kind === 'no_ornaments' || kind === 'no-ornaments') {
          const orn = Array.isArray(args.ornaments) ? args.ornaments.map(String) : args.ornaments ? String(args.ornaments).split(/[,\s]+/) : [];
          draft = { ...base, kind: 'no-ornaments', instrument: String(args.instrument ?? 'kaval').toLowerCase() as never, ornaments: orn as never };
        } else if (kind === 'prefer_dance' || kind === 'avoid_dance' || kind === 'prefer-dance' || kind === 'avoid-dance') {
          draft = { ...base, kind: kind.startsWith('prefer') ? 'prefer-dance' : 'avoid-dance', dance: String(args.dance ?? '').toLowerCase() as DanceId };
        } else throw new Error('kind is thin (an instrument plays less, or not at all), no_ornaments, prefer_dance or avoid_dance; to keep a figure use action keep_figure.');
        const rule = music.addRule(draft);
        return { ok: true, added: { id: rule.id, rule: describeRule(rule) }, rules: list() };
      }
      throw new Error('action is list, add, keep_figure, remove or clear.');
    }

    case 'perform': {
      const r = await perform(args, host, known);
      return { ok: true, started: r.name, steps: r.total, note: 'Running in the background: use performance_status to follow it.' };
    }
    case 'export_performance': {
      const steps = Array.isArray(args.steps) ? (args.steps as Step[]) : [];
      if (!steps.length) throw new Error('A performance needs steps.');
      // Checked as perform would, so a broken script fails here and not in a student's browser.
      for (const st of steps) {
        const p = normalise(st, known);
        if (p.kind === 'tool' && (p.tool === 'perform' || p.tool === 'export_performance' || !known.has(p.tool))) throw new Error(`Unknown or not allowed in a script: "${p.tool}".`);
      }
      const name = String(args.name ?? 'Performance').trim() || 'Performance';
      const project = exportProjectJson({ map: host.map(), villagers: host.cast(), modelSettings: host.settings(), conversations: [], world: host.sim.world, savedAt: Date.now() });
      const payload: PerformancePayload = { format: 'seloai-performance', version: 1, name, project, steps, world: args.world === 'running' ? 'running' : 'paused' };
      const appUrl = typeof args.app_url === 'string' && args.app_url.trim() ? args.app_url.trim() : defaultAppUrl();
      const html = playerHtml(payload, appUrl);
      const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'performance'}.html`;
      if (typeof document !== 'undefined') {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = file;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      return { ok: true, file, kilobytes: Math.round(html.length / 102.4) / 10, plays_in: appUrl, ...(typeof document === 'undefined' ? { html } : {}) };
    }

    case 'performance_status':
      return runReport(run);
    case 'stop_performance':
      return { ok: true, stopping: stopCurrentPerformance() };

    case 'guided_tour': {
      const which = String(args.tour ?? 'welcome').toLowerCase();
      const tour = GUIDED_TOURS.find((t) => t.id === which || t.title.toLowerCase() === which);
      if (!tour) throw new Error(`No tour called "${which}". Tours: ${GUIDED_TOURS.map((t) => t.id).join(', ')}.`);
      if (run?.state === 'running') stopCurrentPerformance();
      // Let a stopped performance finish its last step before the tour begins.
      for (let i = 0; i < 30 && run?.state === 'running'; i++) await sleep(100);
      const steps = tour.steps({ cast: host.cast(), map: host.map() });
      const r = await perform({ name: tour.title, steps, controls: true }, host, known);
      return { ok: true, started: r.name, steps: r.total, note: 'The tour is running; the person can stop it with its Stop button or Escape.' };
    }

    case 'start_recording': {
      const what = args.what === 'world' ? 'world' : 'app';
      return startRecording(what, String(args.name ?? 'recording'));
    }
    case 'stop_recording':
      return stopRecording();

    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

/** The published app, unless this app is itself served from somewhere else that is not local. */
function defaultAppUrl(): string {
  const PUBLISHED = 'https://languel.github.io/seloai/';
  if (typeof location === 'undefined') return PUBLISHED;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return PUBLISHED;
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return new URL(base, location.origin).href;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * A playable performance as one HTML page: a Play screen (a click lets the sound play), and the
 * app in a frame in player mode, which gets the world and the script from this page.
 */
export function playerHtml(payload: PerformancePayload, appUrl: string): string {
  const url = new URL(appUrl);
  url.searchParams.set('player', '1');
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');
  const title = escapeHtml(payload.name);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · SeloAI</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; height: 100%; background: #e3d8c2; font-family: Georgia, 'Iowan Old Style', serif; color: #231f1c; }
  iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
  #cover { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgb(227 216 194 / 0.92); z-index: 2; }
  .card { text-align: center; padding: 28px 36px; border: 2px dashed #231f1c; border-radius: 14px; background: #efe7d6; max-width: 34rem; margin: 16px; }
  h1 { font-size: 26px; margin: 0 0 6px; font-weight: 600; }
  p { margin: 4px 0 18px; color: #5e554a; font-size: 15px; }
  button { font: inherit; font-size: 18px; padding: 10px 26px; border-radius: 10px; border: 2px dashed #b0241c; background: #f6efe0; color: #b0241c; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: wait; }
  #note { font-size: 13px; color: #5e554a; margin-top: 12px; min-height: 1em; }
</style>
</head>
<body>
<iframe id="app" src="${escapeHtml(url.href)}" allow="autoplay; fullscreen" title="${title}"></iframe>
<div id="cover"><div class="card">
  <h1>${title}</h1>
  <p>A performance made in SeloAI.</p>
  <button id="play" disabled>Loading…</button>
  <button id="look" style="display:none;margin-left:8px;border-color:#5e554a;color:#5e554a">Look around</button>
  <div id="note"></div>
</div></div>
<script type="application/json" id="performance">${data}</script>
<script>
(function () {
  var payload = JSON.parse(document.getElementById('performance').textContent);
  var frame = document.getElementById('app');
  var cover = document.getElementById('cover');
  var button = document.getElementById('play');
  var note = document.getElementById('note');
  var origin = new URL(frame.src).origin;
  var ready = false;
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data) return;
    if (e.data.type === 'SELOAI_PLAYER_READY') { ready = true; button.disabled = false; button.textContent = 'Play'; }
    if (e.data.type === 'SELOAI_PLAYER_STATE') {
      if (e.data.state === 'running') cover.style.display = 'none';
      if (e.data.state === 'done' || e.data.state === 'stopped') {
        cover.style.display = 'flex'; cover.style.background = 'rgb(227 216 194 / 0.6)';
        button.textContent = 'Play again'; look.style.display = 'inline-block'; note.textContent = 'The world goes on: look around, or play it again.';
      }
      if (e.data.state === 'failed') { cover.style.display = 'flex'; note.textContent = 'It could not play: ' + (e.data.error || 'unknown error'); }
    }
  });
  button.addEventListener('click', function () {
    if (!ready) return;
    button.disabled = true; note.textContent = '';
    frame.contentWindow.postMessage({ type: 'SELOAI_PLAY', payload: payload }, origin);
    setTimeout(function () { button.disabled = false; }, 1500);
  });
  var look = document.getElementById('look');
  look.addEventListener('click', function () { cover.style.display = 'none'; });
  setTimeout(function () { if (!ready) note.textContent = 'Waiting for SeloAI to load from ' + origin + ' (it needs a connection and a browser with WebGPU for the best voices).'; }, 8000);
})();
</script>
</body>
</html>
`;
}
