# SeloAI

**An environment for social simulation and emergent storytelling. A village brain plays every
character, an adaptive story engine paces and shapes what happens between them, and an adaptive
music engine scores it live, all in your browser. You bring the world and the people; you watch,
study and steer what emerges.**

![The well in Zmeyovo: villagers talk, their words sewn onto the cloth around them, while the Scribe narrates along the bottom](docs/images/village.jpg)

**Try it: [languel.github.io/seloai](https://languel.github.io/seloai/)**. It runs in your browser,
with nothing to install. A recent Chrome or Edge works best.

## What it is

*Selo* means "village" in Bulgarian. SeloAI is a place to stage small societies: a handful of
characters, each with who they are, what they want right now and a secret they keep, put together
in a shared place. Nobody writes their lines. Three parts work together to bring them to life.

### The village brain

One AI model, running on your own computer inside the browser, plays everyone. For each
character it thinks about what they know, what they want and what was just said to them, decides
what they say and do, and speaks the line in that character's own voice. Characters remember what
happened to them and carry their intentions from one encounter to the next, so a quarrel at the
well can still be shaping what someone does ten minutes later. The same brain is the **Scribe**,
the narrator who tells the story as it happens. You can also connect a larger online model of your
own, or run the story with no model at all.

### The adaptive story engine

The story engine decides when things happen. It runs on a world clock that you can pause, slow,
speed up or wind back, and paces every line to it. It brings people together (only those near
each other talk, and a character with an errand walks over to the one they need), decides how
readily they start a conversation and how long it runs, keeps some characters to the places that
are theirs, and leaves room after a passage of the Scribe. The Scribe frames scenes and, when you
want more telling, describes the quiet life of the village between conversations. Anything you
say to a character, or to everyone, reshapes what they mean to do next. How talkative the
characters are and how much the Scribe tells are settings you turn up or down, from a chatty
village to one where people mostly go about their work.

### The adaptive music engine

A village band of three, the gaida (bagpipe), the kaval (flute) and the tapan (drum), composes
music live, note by note, to fit the story. It listens to what is being said, and the Scribe's
model tells it the mood of the moment (dread, joy, mystery, a quarrel); from that it picks a mode,
a dance in an old Balkan meter and an intensity, from a bare drone to a wild horo. It steps back
whenever someone speaks, answers lines with short motifs in the gaps, and plays a full song when
the story falls quiet. You can direct it ("darker", "a wedding dance"), set how much of each part
there is, change how it sounds, and teach it what to keep and what to leave out.

## What it is not

**It is not a game.** There is no goal, no score and nothing to win. It is closer to a rehearsal
room, a terrarium or a lab bench: you set up a situation, run it, and look closely at what comes
out of it. Then you change something and run it again.

What you do with it:

- **Set up a situation**: a place, a cast, their relationships and tensions, and how the story
  opens.
- **Run it**: pause it, slow it down, speed it up, or wind it back, and follow whoever you like.
- **Step in**: talk to any character as a visitor (the Traveler), give them directions, steer the
  story through the Scribe, or place cues ahead in time ("in one minute, a storm", "a musical
  break").
- **Study it**: the Control Room lays the whole history out as woven cloth, the Scribe's passages
  and the music's every note alongside what was said. A probe looks back at any moment to ask what
  was going on and why the music played what it did, a map shows who stands where with whom, and
  you can question the record in plain language. This is where you tune the balance of story and
  music.
- **Share it**: export a world as a file, record a narrated walkthrough, or save the history as a
  picture.

## Bring your own story

SeloAI comes with a rich demo (below), but it is meant for your own worlds and people. Everything
the demo has, you can make:

- **A world.** Build a place in the World Editor: start from a generator (a valley of hamlets, a
  patchwork village) and edit it by hand, or draw it from scratch. Name the places that matter.
- **Characters.** In Characters, write who each person is, what they want, what they hide and how
  they speak; give them a voice; and shape how they look (every figure is drawn by the program,
  and any trait can be chosen by hand).
- **A story.** Write the premise and the opening as a short Markdown file: the situation, the
  pressure on it, and where things stand when the story starts.
- **With help.** Spinner, the assistant inside the app, can build or change any of this when you
  ask it to ("add a miller who owes everyone money", "move the well to the square"). Outside
  agents can do the same through MCP (see [Driving SeloAI with an agent](docs/AGENTS.md)).

**Help & Guides → Make your own story** walks you through it, with templates and prompts to use
with a chat assistant: a first story in about 30 minutes.

## The demo: Zmeyovo

The default world is a reference point: a complete example of the kind of situation SeloAI is
for, worked out in detail, and a foundation to copy, take apart and change.

**Zmeyovo: Well of the Lamia** is a Bulgarian village in a drought. The Lamia, a serpent-woman
from Balkan folklore, has coiled around the well and will not release the water until the village
brings a rightful sacrifice. Six characters, among them the Lamia herself, an herb-wise old
woman, a masked kuker, a young blacksmith, a mountain samodiva and a weaver, each want something
different from the crisis, and the story grows from that.

What it shows:

- **A premise with pressure** that forces people to choose, bargain and take sides.
- **Characters with wants, secrets and their own voices**, who keep to their places and their
  purposes but can be moved by what others say.
- **The engines at work**: the Scribe framing the crisis as it develops, and the band moving
  from a dry drone to dread when the serpent speaks and to a dance when the village gathers.
- **A look**: the whole world is drawn as Bulgarian folk embroidery, and what people say is sewn
  onto the cloth beside them. The look can be changed, from needlework to plain line drawing.

Other worlds in the world menu (top left) show other starting points: **Шевици: Embroidered
Bulgaria**, a map of regional embroidery motifs, and two worlds generated from a seed, a
**valley** of hamlets and a **patchwork village**.

## Your first ten minutes

1. **Open the app.** You start in Zmeyovo.
2. **Give the characters a voice and a mind.** A card offers them on your first visit. We
   recommend **Voice + brain** (LFM3-Omni): one model, about 1.5 GB, that thinks up what each
   character says and speaks it in their own voice. It downloads once and stays on your computer.
   It needs a browser with WebGPU, such as a recent Chrome or Edge. The **Light voice** (about
   330 MB) is a smaller choice, and **Not now** starts the story with the browser's own voice.
3. **Take the guided tour.** Open **Help & Guides** (the book at the top right) and press **Take
   the guided tour**: a narrated four-minute walk around the app.
4. **Join in.** Type in the box under the Storyline. Write `@` and a name to speak to someone,
   and `#` and a place to send them there: `@Stoyan meet me at #Well`. Or double-click a character
   on the map to talk to them.
5. **Look back.** Open the **Control Room** (top right) to see the story so far as cloth: each
   character a thread, each line a stitch. Click the ruler to set the probe at a moment and ask the
   Scribe what was happening then.

## For teachers and students

SeloAI was made with students in mind. A story here is a situation, not a script: you learn by
setting up people who want different things and seeing what happens, then asking why.

- **Make your own story** (in Help & Guides) is written for students: a first story in 30 minutes,
  then the world, characters, story files and templates.
- **Experiment.** Run the same situation twice and compare; change one character's secret, or who
  meets whom first, and see how the story moves. The Control Room is there to read the results.
- **Walkthroughs.** Spinner (or any AI agent) can point, draw, narrate and record, so you can make
  a narrated tour of your own world as a video, or as a page students open and press Play.
- **Nothing is lost.** Every change to a world can be undone, and the story can be reset at any
  time.

## Privacy

Everything runs in your browser. The AI models download once to your computer, and your worlds,
characters and conversations are saved in this browser only. You can choose to connect an online
model (Gemini, Claude, ChatGPT, OpenRouter) with your own key; keys stay in your browser and are
never written into a file you export.

## Run it yourself

You need [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```bash
pnpm install
```

```bash
pnpm dev
```

Then open the address it prints.

## Learn more

- [For developers](docs/DEVELOPERS.md): how SeloAI is built, its data formats, tests and
  deployment.
- [Driving SeloAI with an agent](docs/AGENTS.md): MCP, WebMCP, Spinner, walkthroughs and
  performances.
- [Art direction](docs/ART_DIRECTION.md): the needlework look and where it is going.
- [Handoff notes](HANDOFF.md): the state of the work, for whoever picks it up next.

## Acknowledgements

SeloAI's first proof of concept started from [AI Town](https://github.com/a16z-infra/ai-town), the
open-source virtual town where AI characters live, chat and socialise, itself inspired by the
research paper [*Generative Agents: Interactive Simulacra of Human
Behavior*](https://arxiv.org/abs/2304.03442). We are grateful for both. SeloAI has since gone its
own way and serves a different purpose: it is an environment for designing, running and studying
social simulations and stories of your own, running entirely in the browser, rather than a town
to visit. It has been rebuilt around its own engine, worlds, art and tools, and none of AI Town's
assets or data remain.

The AI models are made by others and come under their own licences: LFM3-Omni and LFM3-1.7B by
Liquid AI, and Kokoro by hexgrad.
