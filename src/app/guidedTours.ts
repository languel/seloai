/**
 * The built-in guided tours: narrated walkthroughs of SeloAI, run as performances (see `perform`
 * in uiTools.ts) with the pointer, stitched drawings and the Traveler's voice. A tour holds the
 * village still while it runs and can be stopped at any time (its Stop button, or Escape).
 *
 * Steps are made for the world that is open, so the tour can point at a real character and a
 * real place whatever world someone has loaded. Every step only shows or opens things: a tour
 * never changes the world, the cast or a setting. It ends with the village playing in story mode.
 */
import type { VillageMap, VillagerConfig } from '../engine/types';

export interface TourContext {
  cast: VillagerConfig[];
  map: VillageMap;
}

export interface GuidedTour {
  id: string;
  title: string;
  /** About how long it takes, for the Help page. */
  minutes: number;
  steps: (ctx: TourContext) => Record<string, unknown>[];
}

const ring = (at: string, text: string, seconds = 7) => ({ draw: { shapes: [{ shape: 'ring', at, text, seconds }] } });
const arrow = (at: string, text: string, seconds = 8) => ({ draw: { shapes: [{ shape: 'arrow', at, text, seconds }] } });
const hover = (target: string) => ({ pointer: { target, action: 'hover', on: 'ui' } });
const click = (target: string) => ({ pointer: { target, action: 'click', on: 'ui' } });
const view = (v: string) => ({ ui_action: { action: 'view', view: v } });
const panel = (p: string) => ({ ui_action: { action: 'panel', panel: p } });

/** Opens a view with its button, says what it is for, and comes back to the village. */
const visit = (button: string, lines: string[]) => [
  click(button),
  { wait: 0.6 },
  ...lines.map((narrate) => ({ narrate })),
  click('Village'),
  { wait: 0.4 },
];

/** Someone to introduce: a villager, not the Scribe or the Traveler. */
function aVillager(cast: VillagerConfig[]): VillagerConfig | undefined {
  return cast.find((c) => c.id !== 'narrator' && c.role !== 'Traveler' && c.id !== 'player');
}

/** What SeloAI is, giving it a voice and a brain, and how to use it: for someone new. */
const welcome: GuidedTour = {
  id: 'welcome',
  title: 'Welcome to SeloAI',
  minutes: 4,
  steps: ({ cast, map }) => {
    const someone = aVillager(cast);
    const place = map.pointsOfInterest?.find((p) => p.label)?.label;
    return [
      view('village'),
      panel('storyline'),
      { ui_action: { action: 'camera', focus: 'the whole map', move: 'glide' } },
      { narrate: 'Welcome to SeloAI. This is a village stitched like folk embroidery, where characters played by AI live their own lives.' },
      { narrate: 'They walk, meet, argue and talk to each other. You are a visitor, the Traveler, and you can talk to any of them.' },
      ...(someone
        ? [
            { ui_action: { action: 'camera', focus: someone.name, zoom: 2.2, follow: false } },
            arrow(someone.name, `${someone.name}${someone.role ? `, ${someone.role}` : ''}`, 9),
            { narrate: `This is ${someone.name}. Each character has who they are, what they want right now, and a secret. Nothing they say is written in advance.` },
          ]
        : []),
      ...(place
        ? [
            { ui_action: { action: 'camera', focus: place, zoom: 1.6, follow: false } },
            ring(place, place, 6),
            { narrate: `Named places, like ${place}, are where the story happens. Characters go there to meet and talk.` },
          ]
        : []),
      { ui_action: { action: 'camera', focus: 'the whole map', move: 'glide' } },
      ring("Show the Scribe's subtitles", "The Scribe's words", 7),
      { narrate: 'The Scribe is the narrator. Its words are sewn in gold along the bottom of the village, and this button shows or hides them.' },

      // Voice and brain, early: nothing really comes alive without them.
      ring('AI & Voice Monitor', 'Voice and brain', 6),
      { narrate: 'First, give the village a voice and a brain. On your first visit, a card offers them.' },
      ...visit('AI & Voice Monitor', [
        'We recommend Voice and brain: LFM3 Omni, one model that is both the brain and the voice. It is about one and a half gigabytes, downloaded once, and needs a browser with WebGPU, such as Chrome.',
        'With it, the characters think up what they say and speak it, each in their own voice, and they can hear you through the microphone.',
        'Light voice is smaller. The characters speak, but use lines written for the story. Not now uses the browser’s own voice.',
        'You can load or change them any time here, in the AI and Voice Monitor. The two dots on its button turn green when the brain and the voice are ready.',
      ]),

      // Watching.
      hover('Simulation speed'),
      ring('Simulation speed', 'Pause and speed', 6),
      { narrate: 'Up here you pause the story, or make it faster or slower.' },
      hover('Story mode'),
      ring('Story mode', 'Story mode', 6),
      { narrate: 'Story mode lets the camera follow the story by itself, like a film.' },
      hover('Show speech bubbles'),
      { narrate: 'These buttons show or hide names, speech, thoughts and the Scribe’s words.' },
      hover('Reset the story'),
      ring('Reset the story', 'Start again', 6),
      { narrate: 'This starts the story again, in the same world, with everyone back in their places.' },

      // The side panel.
      click('Storyline'),
      ring('Storyline', 'The story so far', 7),
      { narrate: 'The side panel opens on the Storyline: the people of the village, and everything that has been said.' },
      hover('Send message'),
      ring('Address a character with @', 'Talk here', 10),
      { narrate: 'Type here to join in. Write @ and a name to speak to someone, and # and a place to send them there. The microphone lets you speak instead.' },
      { narrate: 'On the map, double-click a character to talk to them, or hold Shift and double-click to follow them. The slash key opens a quick box anywhere, and backslash hides this panel.' },
      click('Spinner'),
      ring('Spinner', 'Your helper', 8),
      { narrate: 'Spinner is your helper. Ask it how things work, or ask it to change the world, add a character, or give a tour like this one. It has its own small brain to download here, or it can use an online model.' },
      click('Style'),
      { narrate: 'Style changes how the world is stitched: the look, the threads, the letters.' },
      click('World & Data'),
      { narrate: 'World and Data loads the other worlds, saves yours in this browser, and exports files to share.' },
      click('Storyline'),

      // Other worlds, and a look into each of the other views.
      hover('Switch demo or saved world'),
      ring('Switch demo or saved world', 'Other worlds', 6),
      { narrate: 'Here you switch worlds. Each demo world is a different story.' },
      ...visit('Control Room', ['The Control Room weaves the history of the story into cloth: each character a thread, each line a stitch. You can also ask it questions about what happened.']),
      ...visit('World Editor', ['The World Editor is where places are built: ground, houses, trees, wells, and the named places where the story happens.']),
      ...visit('Pattern Studio', ['The Pattern Studio holds the stitched motifs the world is drawn with.']),
      ...visit('Characters', ['Characters is where people are made: who they are, what they want, how they look, and how they sound.']),
      hover('Undo world edit'),
      { narrate: 'Every change to the world can be undone here.' },
      ...visit('Help & Guides', ['And Help brings you back to this guide. When you are ready, its next part shows you how to make a story of your own.']),

      // Off you go: the village plays on, with the camera following the story.
      { clear_drawings: {} },
      { narrate: 'Now the story plays on, and story mode will follow it for you. Enjoy the village.' },
      { ui_action: { action: 'story_camera', on: true } },
      { ui_action: { action: 'play' } },
      { clear_drawings: {} },
    ];
  },
};

export const GUIDED_TOURS: GuidedTour[] = [welcome];
