/**
 * Help & Guides, in parts: Welcome (what SeloAI is and how to use it, with a guided tour; see
 * guide/WelcomeGuide.tsx) and Make your own story: how to make an interactive story in SeloAI (a
 * world, a cast and a story), written for students, with templates to copy or download and
 * prompts for a chat assistant to help draft them.
 */
import React, { useState } from 'react';
import { WelcomeGuide } from './guide/WelcomeGuide';
import { GuideNav, GuideSection as Section } from './guide/GuideSection';
import { BookOpen, Check, Copy, Download, Sparkles } from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';
import { omniEngine } from '../ai/omniEngine';

/**
 * A story as Markdown: a short YAML header for the world, then readable sections for the
 * characters and the story lines. The friendliest way to write one, by hand or with an agent.
 */
const MARKDOWN_TEMPLATE = `---
title: The Dark Lamp
place: Gullrock
kind: harbour town
traveler: Traveler
gathering: the quay
premise: The lighthouse lamp went dark last night and the supply ship is due at dawn. Someone in Gullrock broke it, and everyone has a reason to want the ship to stay away.
opening: Open at dusk on the quay, the lamp cold and the fog coming in.
focus: Ada Bell
---

# Characters

## Ada Bell
- role: Lighthouse keeper
- wants: Find out who broke the lamp before dawn.
- speaks: Low and salty, few words.
- voice: female, Danish, -0.5
- look: skirted

Stubborn and kind, she has kept the #Lighthouse for thirty years and blames herself for every wreck. She saw someone on the stairs last night and has told no one.

Says:
- {partner}, the lamp did not break itself.
- I trimmed that wick myself at sunset.

## Tobin Reed
- role: Net mender
- wants: Keep everyone talking about anything but the lamp.
- speaks: Quick, warm, a little too friendly.
- voice: male, Italian
- look: trousered

Charming and deep in debt: the ship carries the man he owes money to. He is never far from the #Quay.

Says:
- Fine evening for it, {partner}. Fish are running.

# Story lines

## Opening
- Fog rolls in off the water as {a} and {b} meet by {place}.

## Closing
- {a} glances back at the dark tower as the talk with {b} ends.

## Anyone
- Did you hear a ship's bell out there? (when: ship, bell)
`;

/** A story pack: the premise, the opening and the cast, imported onto a world you built. */
const STORY_PACK_TEMPLATE = `{
  "format": "seloai-world-pack",
  "version": 1,
  "id": "the-dark-lamp",
  "name": "The Dark Lamp",
  "description": "A harbour town whose lighthouse has gone dark on the night a ship is due.",
  "context": {
    "settingName": "Gullrock",
    "settingKind": "harbour town",
    "playerName": "Traveler",
    "fallbackLandmark": "the quay",
    "premise": "The lighthouse lamp went dark last night and the supply ship is due at dawn. Someone in Gullrock broke it, and everyone has a reason to want the ship to stay away.",
    "storyLines": {
      "openingBeats": ["Fog rolls in off the water as {a} and {b} meet by {place}."],
      "closingBeats": ["{a} glances back at the dark tower as the talk with {b} ends."],
      "characterLines": {
        "keeper": { "lines": ["{partner}, the lamp did not break itself.", "I trimmed that wick myself at sunset."] }
      },
      "sharedLines": [
        { "lines": ["Did you hear a ship's bell out there?"], "whenMentioned": ["ship", "bell"] }
      ]
    }
  },
  "story": {
    "openingDirective": "Open at dusk on the quay, the lamp cold and the fog coming in.",
    "focalCharacterId": "keeper"
  },
  "cast": [
    {
      "id": "keeper",
      "name": "Ada Bell",
      "role": "Lighthouse keeper",
      "identity": "Stubborn and kind, she has kept the #Lighthouse for thirty years and blames herself for every wreck.",
      "plan": "Find out who broke the lamp before dawn.",
      "voiceStyle": "Low and salty, few words.",
      "voice": { "gender": "female", "language": "Danish", "pitchSemitones": -0.5, "speakingRate": 0.95, "warmthDb": 1 },
      "figure": { "build": "skirted" },
      "accentColor": "#2f5d7a",
      "spritesheetId": "modular",
      "homeTile": { "x": 20, "y": 14 },
      "speed": 0.8
    },
    {
      "id": "smuggler",
      "name": "Tobin Reed",
      "role": "Net mender",
      "identity": "Charming and in debt; the ship carries the man he owes money to. He is never far from the #Quay.",
      "plan": "Keep everyone talking about anything but the lamp.",
      "voiceStyle": "Quick, warm, a little too friendly.",
      "voice": { "gender": "male", "language": "Italian", "pitchSemitones": 0, "speakingRate": 1.02, "warmthDb": 2 },
      "figure": { "build": "trousered" },
      "accentColor": "#8a4b2a",
      "spritesheetId": "modular",
      "homeTile": { "x": 26, "y": 18 },
      "speed": 0.85
    }
  ]
}`;

/** One character, as the roster keeps it. */
const CHARACTER_TEMPLATE = `{
  "id": "baker",
  "name": "Mira Holt",
  "role": "Village baker",
  "identity": "Up before everyone, she hears every secret told at the #Bakery door and keeps most of them.",
  "plan": "Trade a secret for the recipe her mother never wrote down.",
  "voiceStyle": "Bright, quick, teasing.",
  "voice": { "gender": "female", "language": "French", "pitchSemitones": 0.5, "speakingRate": 1.0, "warmthDb": 1.5 },
  "figure": { "build": "skirted", "kind": "human" },
  "accentColor": "#b0573a",
  "spritesheetId": "modular",
  "homeTile": { "x": 18, "y": 12 },
  "speed": 0.8
}`;

interface AssistantPrompt {
  id: string;
  title: string;
  when: string;
  prompt: string;
}

/** Prompts for a chat assistant (any capable model) to help draft the files. */
const ASSISTANT_PROMPTS: AssistantPrompt[] = [
  {
    id: 'story-pack',
    title: 'Turn my idea into a story',
    when: 'Start here. Paste the Markdown story template after the prompt.',
    prompt: `You are helping me write a story for SeloAI, an app where AI characters live in a small embroidered world and talk to each other and to me.

My story idea: [describe your idea in two or three sentences]

Write a complete story as a Markdown file, following the template I paste below exactly: the YAML header between --- lines (title, place, kind, traveler, gathering, premise, opening, focus), then "# Characters" with one "## Name" section each (bullets for role, wants, speaks, voice, look; a paragraph for who they are; "Says:" with a few lines), then "# Story lines" with "## Opening", "## Closing" and "## Anyone" bullets. Rules:
- 3 to 5 characters. Give each one a goal ("plan") that clashes with at least one other character's goal, and a secret or fear in their "identity".
- Write "premise" as two sentences: the trouble, and why it matters tonight.
- Mention the important places in identities and plans as #Tags (one word each, like #Bakery or #OldBridge). I will create places with those names in the World Editor.
- voice is "female" or "male", then an accent (like Danish or Greek), then optionally a pitch from -1 to 1. Pick varied accents.
- look is "skirted" or "trousered".
- Give each character 2 to 4 "Says:" lines (used when no AI model is loaded); {partner} is the person they talk to. In "## Anyone" lines, add "(when: word, word)" to tie a line to a topic.
- Return only the Markdown.

Template:`,
  },
  {
    id: 'cast',
    title: 'Design a cast with clashing goals',
    when: 'When your characters agree too much and nothing happens.',
    prompt: `Here are the characters of my SeloAI story (JSON below). They agree too much and nothing happens.
Rewrite only their "identity" and "plan" fields so that:
- every character wants something another one is trying to stop;
- each has one secret that someone else half-knows;
- at least two of them would cooperate if they talked honestly.
Keep names, ids and voices. Return the same JSON array.

Characters:`,
  },
  {
    id: 'lines',
    title: 'Write scripted lines for no-model mode',
    when: 'So the story still works on computers without an AI model.',
    prompt: `Write storyLines for my SeloAI story pack (JSON below), in this shape:
"storyLines": { "openingBeats": [...], "closingBeats": [...], "characterLines": { "<id>": { "lines": [...] } }, "sharedLines": [ { "lines": [...], "whenMentioned": ["word"] } ] }
- openingBeats and closingBeats are one sentence each, in the narrator's voice; use {a}, {b} and {place}.
- characterLines: 4 lines per character, in their own voice; {partner} is who they talk to. No line may give the whole secret away.
- sharedLines: 6 lines anyone could say, each tied to a word with whenMentioned.
Return only the storyLines JSON.

Story pack:`,
  },
];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SECTIONS: Array<[string, string]> = [
  ['how', 'How a story runs'],
  ['first', 'Your first story in 30 minutes'],
  ['world', 'Build the world'],
  ['characters', 'Make the characters'],
  ['story', 'Write the story'],
  ['voices', 'Voices and AI models'],
  ['share', 'Save and share'],
  ['templates', 'Templates'],
  ['assistant', 'Prompts for a chat assistant'],
  ['draft', 'Draft a character here'],
];

const MakeStoryGuide: React.FC = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [genConcept, setGenConcept] = useState('A ferryman who has not spoken since the flood, but writes everything down');
  const [genOutput, setGenOutput] = useState('');
  const [generating, setGenerating] = useState(false);

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const CopyButton = ({ id, text }: { id: string; text: string }) => (
    <button
      type="button"
      onClick={() => void copy(id, text)}
      className="inline-flex items-center gap-1 rounded-sm border border-borderFolk bg-surface px-2 py-1 text-[11px] font-medium hover:border-ink/40"
    >
      {copiedId === id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copiedId === id ? 'Copied' : 'Copy'}
    </button>
  );

  const draftCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genConcept.trim() || generating) return;
    setGenerating(true);
    setGenOutput('');
    const system =
      'Return ONLY one valid JSON object for a SeloAI character with fields: id (lowercase, no spaces), name, role, identity (two vivid sentences with one secret), plan (one goal that could clash with someone), voiceStyle, voice {gender: "female" or "male", language (an accent such as Greek or Italian), pitchSemitones (-1 to 1)}, figure {build: "skirted" or "trousered"}.';
    const user = `Character idea: ${genConcept.trim()}`;
    try {
      if (omniEngine.isReady()) {
        const res = await omniEngine.generateChatReply({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          voice: false,
          maxNewTokens: 260,
          onTextChunk: (c) => setGenOutput((p) => p + c),
        });
        setGenOutput(res.text);
      } else if (brainRouter.isTextModelReady()) {
        const res = await brainRouter.generateText(
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          { maxNewTokens: 260, temperature: 0.6, onChunk: (c) => setGenOutput((p) => p + c) },
        );
        setGenOutput(res.text);
      } else {
        setGenOutput('No AI model is loaded. Load one from the voice card or the AI & Voice Monitor, or use the character template and a chat assistant instead.');
      }
    } catch (err: any) {
      setGenOutput(`Error: ${err?.message || String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
      <div className="space-y-4">
        <header className="border-b border-borderFolk pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-crimson" />
            <h1 className="text-lg font-bold">Make your own interactive story</h1>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            In SeloAI a small cast of AI characters lives in a world you build, talks to each other, and answers you. You set
            the place, the people and the trouble; the story grows from what they want and what you do. This guide walks you
            from an empty cloth to a story you can share.
          </p>
          <GuideNav label="Guide sections" sections={SECTIONS} />
        </header>

        <Section id="how" title="How a story runs">
          <p>A story in SeloAI has three parts, each with its own place in the app:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>The world</strong> (World Editor): the place, its houses, river, roads and named places like a well or a
              bridge.
            </li>
            <li>
              <strong>The characters</strong> (Characters): who they are, what they want, how they look and sound. Two are
              special: <em>the Scribe</em>, who narrates, and <em>the Traveler</em>, who is you.
            </li>
            <li>
              <strong>The story</strong> (a story file you import, Markdown or JSON): the premise, how it opens, and lines to
              use without an AI model.
            </li>
          </ul>
          <p>When the village starts:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>The story waits until a voice is loaded (or you choose &ldquo;Not now&rdquo;).</li>
            <li>Characters wander and only greet each other: the story has not begun.</li>
            <li>The Scribe tells a short prologue that sets the scene. From then on, each character follows their goal.</li>
            <li>
              You can talk to anyone: type in the chat box, use <code>@Name</code> to address someone and <code>#Place</code>{' '}
              to send them somewhere. You are part of the story; what you say changes it.
            </li>
          </ol>
          <p>
            Useful controls: the play/pause and speed menu in the village toolbar; <em>Story mode</em> (the camera follows the
            story); double-click a character on the map to talk to them, Shift + double-click to follow them; double-click a
            highlighted name or place to look there; <kbd>/</kbd> to say something, <kbd>\</kbd> to show or hide the side
            panel; <em>Reset story</em> (the circular arrow) to start again in the same world.
          </p>
        </Section>

        <Section id="first" title="Your first story in 30 minutes">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              <strong>Idea (5 min).</strong> Write two sentences: a place, a trouble, and why it matters tonight. Example:
              &ldquo;A harbour town whose lighthouse went dark the night a ship is due. Someone broke it.&rdquo;
            </li>
            <li>
              <strong>World (10 min).</strong> Open the World Editor. Under <em>New world</em> pick <em>Patchwork village</em>{' '}
              (or <em>Blank cloth</em> to draw everything yourself) and press <em>Make a new world</em>. Use{' '}
              <em>Name a place</em> to name 3 or 4 places that matter to your story (the Lighthouse, the Quay).
            </li>
            <li>
              <strong>Story (10 min).</strong> Write your story in the Markdown template below, by hand or with a chat
              assistant (paste the &ldquo;Turn my idea into a story&rdquo; prompt, your idea and the template). Save it as a{' '}
              <code>.md</code> file.
            </li>
            <li>
              <strong>Import (1 min).</strong> Open <em>World &amp; Data</em> (a tab at the top of the side panel; the panel button, top right, shows it) and under{' '}
              <em>Import</em> choose your file. The cast and premise go onto your world and the story starts fresh.
            </li>
            <li>
              <strong>Play and adjust (rest).</strong> Watch the greetings and the prologue, talk to the characters, and fix
              what does not work in Characters (goals, voices, looks). Reset story to try again.
            </li>
          </ol>
        </Section>

        <Section id="world" title="Build the world">
          <p>The World Editor makes the place. Everything is stitched: you choose what is there, the app draws it as needlework.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>New world</strong>: pick a maker (Blank cloth, Valley, Patchwork village, Textile village, Zmeyovo,
              Shevitsa), set its options and seed, and press <em>Make a new world</em>. Change a setting later and your hand
              edits are kept.
            </li>
            <li>
              <strong>Tools</strong> (top of the editor): select and move; paint ground (road, water, field); place a house,
              tree, well and more; scatter many at once; the pattern brush; erase; <em>Name a place</em>;{' '}
              <em>Add a start point</em>. Shift-drag or two fingers to pan, pinch or scroll to zoom, double-click to frame.
            </li>
            <li>
              <strong>Places and start points</strong>: places (red pins) are where characters go and what they talk about;
              start points (blue diamonds) are where people appear. Drag pins to move them; the list in the sidebar finds
              them.
            </li>
            <li>
              <strong>Name places the way your story does.</strong> A character whose plan mentions <code>#Bakery</code> walks
              to the place called &ldquo;Bakery&rdquo; (or one sharing a word with it, like &ldquo;The old bakery&rdquo;).
            </li>
            <li>
              <strong>Looks</strong>: threads (pick a palette, click a swatch to dye a thread), stitch family, thread weight,
              house size and style. The Style tab of the side panel sets how the whole world and its text are drawn.
            </li>
            <li>
              <strong>A well</strong> can be dry or flowing (select it, then <em>Water</em>). If a character or the Scribe says
              plainly that the water came back, the well starts flowing in the story too.
            </li>
            <li>Every change is an edit you can undo, and the list of your edits is in the sidebar.</li>
          </ul>
        </Section>

        <Section id="characters" title="Make the characters">
          <p>Open Characters. The roster lists the Scribe, the Traveler and everyone in the village.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Add people</strong> with <em>Random</em>, <em>+3</em> or <em>+5</em>, or duplicate someone and change
              them.
            </li>
            <li>
              <strong>Identity</strong> is who they are: personality, history and one secret. Two or three sentences work
              best. The AI uses it as hidden background, so write it the way you would brief an actor.
            </li>
            <li>
              <strong>Plan</strong> is what they want right now. This drives the story: make goals clash (one wants the ship
              to come, another wants it gone).
            </li>
            <li>
              <strong>The figure</strong>: build, kind and garment threads, hair and headdress, with a preview of moods.
            </li>
            <li>
              <strong>Voice</strong>: female or male, a locale (it gives an accent, not a language), pitch, speed and warmth.
              Press <em>Test Voice</em>. Keep pitch within about one semitone unless a character really needs more.
            </li>
            <li>
              <strong>The Scribe</strong> narrates: name, storytelling style and voice. <strong>The Traveler</strong> is you:
              your figure, name and voice (and whether your typed lines are spoken).
            </li>
            <li>
              Press <em>Apply Roster to Village</em> to send changes to the village. Characters use each other&apos;s pronouns
              from their sheets (the voice&apos;s gender).
            </li>
          </ul>
        </Section>

        <Section id="story" title="Write the story">
          <p>A good interactive story is a situation, not a script. Set up people who want different things and let them meet.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Premise</strong>: two sentences the AI always knows: the trouble and why now. Keep it concrete
              (&ldquo;the lamp went dark&rdquo;, not &ldquo;mysterious events happen&rdquo;).
            </li>
            <li>
              <strong>Opening</strong> (<code>story.openingDirective</code>): how the Scribe should open (the time, the mood,
              the first image). The Scribe&apos;s prologue starts the story after the greetings.
            </li>
            <li>
              <strong>Goals that clash</strong>, <strong>secrets that leak</strong>: every character&apos;s plan should get in
              someone&apos;s way, and every secret should be half-known by someone else.
            </li>
            <li>
              <strong>Places carry the story</strong>: mention <code>#Places</code> in identities and plans, and name places
              on the map to match. Characters gather there and the camera follows.
            </li>
            <li>
              <strong>You are a character</strong>: plan what the Traveler can do (bring news, take sides, make a promise). Use{' '}
              <code>@Name</code> to talk to someone and <code>#Place</code> to send them.
            </li>
            <li>
              <strong>Scripted lines</strong> (<code>context.storyLines</code>) are used when no AI model is loaded: opening
              and closing beats (with <code>{'{a}'}</code>, <code>{'{b}'}</code>, <code>{'{place}'}</code>), lines per
              character (with <code>{'{partner}'}</code>), and shared lines tied to words with <code>whenMentioned</code>.
            </li>
            <li>
              <strong>Test and tune</strong>: watch a few scenes, then adjust plans and identities. Reset story to replay from
              the start.
            </li>
          </ul>
        </Section>

        <Section id="voices" title="Voices and AI models">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              On first start a card offers <strong>Voice + brain</strong> (LFM3-Omni, about 1.5 GB, needs WebGPU: it writes and
              speaks) or a <strong>Light voice</strong> (Kokoro, about 330 MB). Both download once and stay on the computer.
            </li>
            <li>
              Without a model the story still runs from your scripted lines, in the browser&apos;s voice. The AI &amp; Voice
              Monitor shows what is loaded and lets you load others or connect a local or online model.
            </li>
            <li>
              The <strong>voice instruction</strong> (in the Scribe or Traveler panel) is the one sentence the voice model reads
              each line with. Keep it short; long instructions make it lose the line.
            </li>
          </ul>
        </Section>

        <Section id="share" title="Save and share">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>World &amp; Data</strong> (a tab at the top of the side panel; the panel button, top right, shows it): load the demo worlds, save worlds in the
              browser, reset the story or everything, export and import files, and save pictures.
            </li>
            <li>
              <strong>Export → Whole Project</strong> saves the whole thing (world, characters, conversations). Share that
              file and anyone can import it to see your story as it is.
            </li>
            <li>
              <strong>A story file</strong> is the shareable recipe: premise, opening, cast and lines. Write it in Markdown (the
              friendliest) or JSON, and import it onto any world. <em>Export → Story (.md)</em> writes the story you have now
              as Markdown, a good place to start from. A JSON story pack can also carry its own <code>map</code>.
            </li>
            <li>Characters can be exported on their own and imported into another world.</li>
            <li>
              <strong>Images</strong>: <em>This view</em> saves what is on screen (people included); <em>Whole tapestry</em>{' '}
              saves the whole world, sharp, at print size, for posters and portfolios.
            </li>
          </ul>
        </Section>

        <Section id="templates" title="Templates">
          <div className="space-y-3">
            {(
              [
                ['story-md', 'Story (Markdown)', 'my-story.story.md', MARKDOWN_TEMPLATE, 'The easiest way to write a story: a short header for the world, then the characters and lines as plain sections. Reads well anywhere; import it onto a world you built.'],
                ['story-pack', 'Story pack (JSON)', 'story-pack-template.json', STORY_PACK_TEMPLATE, 'The same story as JSON, for tools and programs. It can also carry its own map.'],
                ['character', 'One character', 'character-template.json', CHARACTER_TEMPLATE, 'A single character as the roster keeps it. Put several in a list (or in a story pack) to import a cast.'],
              ] as const
            ).map(([id, title, file, text, note]) => (
              <div key={id} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">{title}</h3>
                    <p className="text-[12px] text-muted">{note}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <CopyButton id={id} text={text} />
                    <button
                      type="button"
                      onClick={() => download(file, text)}
                      className="inline-flex items-center gap-1 rounded-sm border border-borderFolk bg-surface px-2 py-1 text-[11px] font-medium hover:border-ink/40"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {file}
                    </button>
                  </div>
                </div>
                <pre className="max-h-64 overflow-auto rounded-sm border border-borderFolk bg-surface p-2 text-[11px] leading-snug thin-scroll">{text}</pre>
              </div>
            ))}
          </div>
        </Section>

        <Section id="assistant" title="Prompts for a chat assistant">
          <p>
            Any capable chat assistant can draft these files with you. Copy a prompt, add your material after it, and always read
            the result: you are the author.
          </p>
          <div className="space-y-3">
            {ASSISTANT_PROMPTS.map((p) => (
              <div key={p.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">{p.title}</h3>
                    <p className="text-[12px] text-muted">{p.when}</p>
                  </div>
                  <CopyButton id={`prompt-${p.id}`} text={p.prompt} />
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-sm border border-borderFolk bg-surface p-2 text-[11px] leading-snug thin-scroll">{p.prompt}</pre>
              </div>
            ))}
          </div>
        </Section>

        <Section id="draft" title="Draft a character here">
          <p>With an AI model loaded, describe a character in a sentence and get a draft to paste into your story pack.</p>
          <form onSubmit={draftCharacter} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={genConcept}
              onChange={(e) => setGenConcept(e.target.value)}
              aria-label="Character idea"
              className="flex-1 rounded-sm border border-borderFolk bg-surface px-2.5 py-1.5 text-[13px]"
            />
            <button
              type="submit"
              disabled={generating}
              className="inline-flex items-center justify-center gap-1.5 rounded-sm bg-crimson px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {generating ? 'Drafting…' : 'Draft'}
            </button>
          </form>
          {genOutput && (
            <div className="space-y-1.5">
              <div className="flex justify-end">
                <CopyButton id="draft" text={genOutput} />
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm border border-borderFolk bg-surface p-2 text-[11px] leading-snug thin-scroll">{genOutput}</pre>
            </div>
          )}
        </Section>

        <p className="pb-4 text-[11px] text-muted">
          For teachers and advanced users: the app exposes tools for AI agents (create worlds and characters, run scenarios,
          query the story database) through <code>window.seloAI</code> in the browser and an MCP server (<code>npm run mcp</code>
          ), and stories can run headless for experiments (<code>scripts/headless-run.ts</code>).
        </p>
      </div>
  );
};

const PARTS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'make', title: 'Make your own story' },
] as const;
type PartId = (typeof PARTS)[number]['id'];
const PART_KEY = 'seloai:help-part';

/** Help & Guides: the parts as tabs, Welcome first. */
export const AssetGuideView: React.FC = () => {
  const [part, setPartState] = useState<PartId>(() => {
    try {
      return localStorage.getItem(PART_KEY) === 'make' ? 'make' : 'welcome';
    } catch {
      return 'welcome';
    }
  });
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const setPart = (p: PartId) => {
    setPartState(p);
    scrollRef.current?.scrollTo({ top: 0 });
    try {
      localStorage.setItem(PART_KEY, p);
    } catch {
      // ignore
    }
  };
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-linen p-3 thin-scroll">
      <div className="mx-auto max-w-4xl space-y-3">
        <div role="tablist" aria-label="Help parts" className="flex gap-1 border-b border-borderFolk">
          {PARTS.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={part === p.id}
              onClick={() => setPart(p.id)}
              className={`-mb-px rounded-t-sm border px-3 py-1.5 text-[13px] font-semibold ${
                part === p.id ? 'border-borderFolk border-b-transparent bg-linen text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {i + 1}. {p.title}
            </button>
          ))}
        </div>
        {part === 'welcome' ? <WelcomeGuide onNext={() => setPart('make')} /> : <MakeStoryGuide />}
      </div>
    </div>
  );
};

export default AssetGuideView;
