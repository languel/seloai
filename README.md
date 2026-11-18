# SeloAI

**A village stitched like folk embroidery, where characters played by AI live, talk to each other, and talk to you.**

![The well in Zmeyovo: villagers talk, their words sewn onto the cloth around them, while the Scribe narrates along the bottom](docs/images/village.jpg)

**Try it: [languel.github.io/seloai](https://languel.github.io/seloai/)**. It runs in your browser,
with nothing to install. A recent Chrome or Edge works best.

## What it is

*Selo* means "village" in Bulgarian. In SeloAI a handful of characters walk around a small world,
meet, argue, gossip and change their minds. Nobody writes their lines: each one is played by an AI
model that knows who they are, what they want right now, and a secret they keep.

- **The village** is drawn as needlework. Houses, rivers, roads and people are all stitched, and
  what people say is sewn onto the cloth beside them.
- **The Scribe** narrates the story in gold thread along the bottom.
- **You are the Traveler**, a visitor. Watch, or talk to anyone: what you say changes the story.
- **No two runs are the same.** The story grows from what the characters want and what you do.

## Your first ten minutes

1. **Open the app.** You start in Zmeyovo, a village whose well has run dry since a serpent-woman,
   the Lamia, coiled around it.
2. **Give the village a voice and a brain.** A card offers them on your first visit. We
   recommend **Voice + brain** (LFM3-Omni): one model, about 1.5 GB, that thinks up what each
   character says and speaks it in their own voice. It downloads once and stays on your computer.
   It needs a browser with WebGPU, such as a recent Chrome or Edge. The **Light voice** (about
   330 MB) is a smaller choice, and **Not now** starts the story with the browser's own voice.
3. **Take the guided tour.** Open **Help & Guides** (the book at the top right) and press **Take
   the guided tour**: a narrated four-minute walk around the app.
4. **Join in.** Type in the box under the Storyline. Write `@` and a name to speak to someone,
   and `#` and a place to send them there: `@Stoyan meet me at #Well`. Or double-click a character
   on the map to talk to them.

## What you can do

- **Watch a story unfold.** Pause, speed it up, or turn on **story mode** and let the camera follow
  it like a film.
- **Talk to the characters**, by typing or with your microphone, and steer the story through the
  Scribe.
- **Ask Spinner, your helper.** Spinner is an assistant inside the app: ask how things work, or ask
  it to add a character, change someone's clothes, switch the look of the world, or give a tour.
- **Explore other worlds** from the world menu at the top left. Each demo world is its own story.
- **Make your own story.** Build a place in the World Editor, make characters in Characters (who
  they are, what they want, how they look and sound), and write the story as a short Markdown
  file. The second part of Help & Guides walks you through it, with templates and prompts for a
  chat assistant.
- **Share it.** Export a world as a file anyone can open in SeloAI, save pictures of the village
  or the whole tapestry, record a walkthrough as a video, or export it as a web page that plays
  it back.

## For teachers

SeloAI was made with students in mind: a story is a situation, not a script, so students learn
by setting up people who want different things and seeing what happens.

- **Help & Guides → Make your own story** is written for students: a first story in 30 minutes,
  then the world, characters, story files and templates.
- **Walkthroughs**: Spinner (or any AI agent) can point, draw, narrate and record, so you can make a
  narrated tour of your own world as a video, or as a page students open and press Play.
- **Every change can be undone**, and the story can be reset at any time.

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

The AI models are made by others and come under their own licences: LFM3-Omni and LFM3-1.7B by
Liquid AI, and Kokoro by hexgrad.
