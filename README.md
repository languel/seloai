# seloai

**An environment for social simulation and emergent storytelling. A village brain plays every
character, an adaptive story engine paces and shapes what happens between them, and an adaptive
music engine scores it live, all in your browser. You bring the world and the people; you watch,
study and steer what emerges.**

![The well in Zmeyovo: villagers talk, their words sewn onto the cloth around them, while the Scribe narrates along the bottom](docs/images/village.jpg)

**Try it: [languel.github.io/seloai](https://languel.github.io/seloai/)**. It runs in your browser,
nothing to install. Chrome or Edge works best.

## How it works

- **The village brain.** One AI model, running in your browser, plays every character: what
  they think, say and remember, in their own voice. It is also the Scribe, who narrates.
- **The adaptive story engine.** Paces the story on a world clock you can pause, speed up or
  rewind; decides who meets, who talks and for how long; and turns what you say into what
  characters do next.
- **The adaptive music engine.** A village band composes live to the mood of the story, steps
  back when someone speaks, and takes direction.

Seloai is a virtual village, not a game: there is nothing to win. Set up a situation, run it,
look at what happened, change something, run it again. It also makes a foundation to build on: a
game, an interactive experience, a simulation, a virtual social experiment.

## Bring your own story

Make your own place in the World Editor, your own people in Characters, and the premise as a short
story file. Spinner, the assistant in the app, can help with any of it. **Help & Guides → Make
your own story** walks you through a first one.

The **Control Room** is where you study a run: the whole history as woven cloth, a probe to look
back at any moment, and the music note by note.

## The demo

**Zmeyovo** is the default world and a full worked example: a village in drought, a serpent coiled
around its well, and six characters who each want something different from the crisis. Copy it,
take it apart, or start from one of the other worlds in the menu.

## Getting started

1. Open the app and accept the **Voice + brain** model (about 1.5 GB, downloaded once).
2. Take the guided tour in **Help & Guides**.
3. Talk to anyone: `@Stoyan meet me at #Well`.

## Privacy

Everything runs and is saved in your browser. Connecting an online model with your own key is
optional; keys never leave your browser or go into exported files.

## Run it yourself

```bash
pnpm install
```

```bash
pnpm dev
```

More: [developers](docs/DEVELOPERS.md) · [agents and MCP](docs/AGENTS.md) ·
[art direction](docs/ART_DIRECTION.md) · [handoff notes](HANDOFF.md)

## Acknowledgements

Seloai's first prototype started from [AI Town](https://github.com/a16z-infra/ai-town), itself
inspired by [*Generative Agents*](https://arxiv.org/abs/2304.03442). Seloai has since been rebuilt
as its own thing for a different purpose: designing and studying your own simulations, not visiting
a town. Models: LFM3 by Liquid AI, Kokoro by hexgrad, under their own licences.
