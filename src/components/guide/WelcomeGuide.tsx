/**
 * Help, part one: SeloAI for someone who has never seen it. What it is, how to give it a voice
 * and a brain (first, since nothing comes alive without them), what is on the screen, how to
 * watch and take part, Spinner, and saving. Starts with a narrated guided tour of the app.
 * Making a story of your own is the next part (AssetGuideView).
 */
import { useEffect, useState } from 'react';
import { Compass, Play } from 'lucide-react';
import { omniEngine } from '../../ai/omniEngine';
import { kokoroEngine } from '../../ai/kokoroEngine';
import { brainRouter } from '../../ai/brainRouter';
import { seloToolHost } from '../../api/seloToolRegistry';
import { appControls } from '../../app/uiControl';
import { GUIDED_TOURS } from '../../app/guidedTours';
import type { ModelProgress } from '../../engine/types';
import { GuideNav, GuideSection } from './GuideSection';

const SECTIONS: Array<[string, string]> = [
  ['what', 'What SeloAI is'],
  ['voice-brain', 'First: a voice and a brain'],
  ['screen', 'Finding your way'],
  ['watch', 'Watching the story'],
  ['take-part', 'Taking part'],
  ['spinner', 'Spinner, your helper'],
  ['views', 'The other views'],
  ['save', 'Worlds, saving and undo'],
  ['keys', 'Keys and mouse'],
  ['trouble', 'If something is not working'],
];

function useProgress(subscribe: (fn: (p: ModelProgress) => void) => () => void, initial: () => ModelProgress) {
  const [p, setP] = useState<ModelProgress>(initial);
  useEffect(() => subscribe(setP), [subscribe]);
  return p;
}

const subscribeOmni = (fn: (p: ModelProgress) => void) => omniEngine.subscribe(fn);
const subscribeKokoro = (fn: (p: ModelProgress) => void) => kokoroEngine.subscribe(fn);

function StatusPill({ label, p }: { label: string; p: ModelProgress }) {
  const ready = p.status === 'ready';
  const loading = p.status === 'loading';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-borderFolk bg-surface px-2 py-0.5 text-[12px]">
      <span className={`h-2 w-2 rounded-full ${ready ? 'bg-sage' : loading ? 'animate-pulse bg-ochre' : 'bg-borderFolk'}`} />
      {label}: {ready ? 'ready' : loading ? `loading ${Math.round((p.fraction ?? 0) * 100)}%` : 'not loaded'}
    </span>
  );
}

export function WelcomeGuide({ onNext }: { onNext: () => void }) {
  const omni = useProgress(subscribeOmni, () => omniEngine.progress);
  const light = useProgress(subscribeKokoro, () => kokoroEngine.getProgress());
  const [tourError, setTourError] = useState('');
  const tour = GUIDED_TOURS[0];
  const otherBrain = omni.status !== 'ready' && brainRouter.isTextModelReady();

  const startTour = async () => {
    setTourError('');
    try {
      await seloToolHost.callTool('guided_tour', { tour: tour.id });
    } catch (err) {
      setTourError(err instanceof Error ? err.message : String(err));
    }
  };
  const openMonitor = () => appControls().setTab('monitor');

  return (
    <div className="space-y-4">
      <header className="border-b border-borderFolk pb-3">
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5 text-crimson" />
          <h1 className="text-lg font-bold">Welcome to SeloAI</h1>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          A village stitched like folk embroidery, where characters played by AI live, talk to each other and talk to you. This part
          shows what SeloAI is and how to use it. When you know your way around, the next part shows you how to make a story of your
          own.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void startTour()}
            className="inline-flex items-center gap-1.5 rounded-sm bg-crimson px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-95"
          >
            <Play className="h-4 w-4" />
            Take the guided tour
          </button>
          <span className="text-[12px] text-muted">
            About {tour.minutes} minutes, narrated. The village holds still while it runs; press <kbd>Esc</kbd> or <em>Stop tour</em> to
            leave it.
          </span>
        </div>
        {tourError && <p className="mt-1 text-[12px] text-crimson">{tourError}</p>}
        <GuideNav label="Welcome sections" sections={SECTIONS} />
      </header>

      <GuideSection id="what" title="What SeloAI is">
        <p>
          SeloAI (<em>selo</em> is &ldquo;village&rdquo; in Bulgarian) is a small living world. A handful of characters walk around
          a village, meet, argue, gossip and change their minds. Nobody writes their lines: each one is played by an AI model that
          knows who they are, what they want right now, and a secret they keep.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>The village</strong> is drawn as needlework: houses, roads, rivers and people are all stitched, and what people
            say is sewn onto the cloth beside them.
          </li>
          <li>
            <strong>The characters</strong> each have a story, a goal that gets in someone else&apos;s way, a look and a voice.
          </li>
          <li>
            <strong>The Scribe</strong> narrates. Its words are sewn in gold along the bottom of the village.
          </li>
          <li>
            <strong>You are the Traveler</strong>, a visitor. You can watch, or talk to anyone, and what you say changes the story.
          </li>
          <li>
            <strong>Everything runs in your browser.</strong> The AI models download once and stay on your computer; your worlds are
            saved in this browser.
          </li>
        </ul>
        <p>
          A story starts quietly: people wander and greet each other. Then the Scribe tells a short prologue, and from there each
          character follows what they want. No two runs are the same.
        </p>
      </GuideSection>

      <GuideSection id="voice-brain" title="First: give the village a voice and a brain">
        <p>
          Without a model, the characters can only use lines written for the story, read by the browser&apos;s own voice. Load a
          model first: it is what makes them think and speak.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill label="Voice + brain" p={omni} />
          <StatusPill label="Light voice" p={light} />
          {otherBrain && <span className="rounded-sm border border-borderFolk bg-surface px-2 py-0.5 text-[12px]">Another brain is loaded</span>}
        </div>
        <p className="rounded-sm border border-crimson/40 bg-crimson/5 px-2.5 py-2">
          <strong>Recommended: Voice + brain (LFM3-Omni).</strong> One model, about 1.5 GB, that is both the brain and the voice:
          it thinks up what each character says and speaks it in their own voice, and it listens to your microphone. Choose it on
          the first-visit card, or load it in the AI &amp; Voice Monitor.
        </p>
        <p>On your first visit a card offers three choices:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Voice + brain</strong> (LFM3-Omni, about 1.5 GB, recommended). The full experience: the characters think up what they say and
            speak it, each in their own voice, and you can talk to them with your microphone. Needs a browser with{' '}
            <strong>WebGPU</strong> (a recent Chrome or Edge) and a reasonably recent computer.
          </li>
          <li>
            <strong>Light voice only</strong> (Kokoro, about 330 MB). The characters speak with real voices, but say lines written
            for the story instead of thinking up their own.
          </li>
          <li>
            <strong>Not now</strong>: the story starts with the browser&apos;s built-in voice and the written lines.
          </li>
        </ul>
        <p>
          The download happens once (it can take a few minutes) and you can look around while it loads. After that the model loads
          from your computer in seconds, and nothing you say is sent anywhere.
        </p>
        <p>
          <strong>To load, change or check a model later</strong>, open the <em>AI &amp; Voice Monitor</em> (top right; its two
          small dots turn green when a brain and a voice are ready). There you can also choose other models that run in the
          browser, or connect a brain that runs elsewhere: Ollama or LM Studio on your own computer, or an online model (Gemini,
          Claude, ChatGPT, OpenRouter) with your own key. Keys stay in this browser and are never put in a file you export.
        </p>
        <button
          type="button"
          onClick={openMonitor}
          className="inline-flex items-center gap-1 rounded-sm border border-borderFolk bg-surface px-2.5 py-1 text-[12px] font-medium hover:border-ink/40"
        >
          Open the AI &amp; Voice Monitor
        </button>
      </GuideSection>

      <GuideSection id="screen" title="Finding your way">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>The village</strong> fills most of the screen. Drag to look around, scroll or pinch to zoom.
          </li>
          <li>
            <strong>The top bar</strong>, from the left: the village button (back here from anywhere), the world menu (which world
            is open), then the village&apos;s own controls (play and pause, speed, zoom, what is shown, story mode, reset). On the
            right: the other views, undo and redo, and the side panel button.
          </li>
          <li>
            <strong>The side panel</strong> on the right has four tabs: <em>Storyline</em> (the people and everything said),{' '}
            <em>Spinner</em> (your helper), <em>Style</em> (how the world is stitched) and <em>World &amp; Data</em> (worlds, saving
            and files). Press <kbd>\</kbd> to hide or show it.
          </li>
          <li>Hover over any button to see what it does.</li>
        </ul>
      </GuideSection>

      <GuideSection id="watch" title="Watching the story">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Play, pause and speed</strong> are at the start of the village controls. Speed goes faster, slower, or backwards
            to rewind.
          </li>
          <li>
            <strong>Story mode</strong> (the viewfinder) lets the camera follow the story on its own, cutting between whoever is
            talking. Any drag or zoom of your own takes the camera back.
          </li>
          <li>
            <strong>What is shown</strong>: names, speech, thoughts, walking paths and the Scribe&apos;s words each have a button.
            The <em>Aa</em> button changes the letters used for sewn speech.
          </li>
          <li>
            <strong>Hearing range</strong> sets whose voices you hear: only people near you, or everyone in the village.
          </li>
          <li>
            <strong>The Storyline</strong> keeps everything said, with who said it. Click a person in it to see them; double-click
            to look at them on the map.
          </li>
          <li>
            <strong>Reset the story</strong> (the circular arrow) starts again in the same world with the same people. The old
            story is kept as a backup.
          </li>
        </ul>
      </GuideSection>

      <GuideSection id="take-part" title="Taking part">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Type in the box</strong> under the Storyline. You speak to the village, or to whoever you chose in the Storyline; write{' '}
            <code>@</code> and a name to speak to someone (<code>@Baba Rada, where is the key?</code>).
          </li>
          <li>
            <strong>Send people places</strong> with <code>#</code> and a place: <code>@Stoyan meet me at #Well</code>.
          </li>
          <li>
            <strong>Speak instead of typing</strong>: press the microphone (it listens with Voice + brain, so load that first).
          </li>
          <li>
            <strong>On the map</strong>: double-click a character to talk to them; hold <kbd>Shift</kbd> and double-click to follow
            them. Press <kbd>/</kbd> anywhere to say something without the side panel.
          </li>
          <li>
            <strong>Tell the Scribe</strong> to steer the story (choose the Scribe in the Storyline, then type): &ldquo;a storm
            comes in from the hills&rdquo;.
          </li>
        </ul>
      </GuideSection>

      <GuideSection id="spinner" title="Spinner, your helper">
        <p>
          Spinner is an assistant that knows SeloAI and can work it for you. Ask it in plain words, in the <em>Spinner</em> tab or by
          writing <code>@Spinner</code> anywhere you can type:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>&ldquo;How do I make the village quieter?&rdquo; &ldquo;What is Baba Rada up to?&rdquo;</li>
          <li>&ldquo;Add a baker who owes everyone money.&rdquo; &ldquo;Make Stoyan wear a red vest.&rdquo;</li>
          <li>&ldquo;Switch to the night look.&rdquo; &ldquo;Give me the guided tour.&rdquo;</li>
        </ul>
        <p>
          Spinner has its own brain, separate from the village&apos;s. It can run on your computer (LFM3-1.7B, about 1.1 GB,
          downloaded in the Spinner tab) or use a brain from elsewhere (Ollama, LM Studio or an online model) set up in the AI &amp; Voice Monitor. Every change it makes to the world
          can be undone.
        </p>
      </GuideSection>

      <GuideSection id="views" title="The other views">
        <p>The buttons at the top right open the other views; the village button (top left) brings you back.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Control Room</strong>: the history of the story woven as cloth (each character a thread, each line a stitch), a
            map of who talks to whom, and a place to ask questions about what happened.
          </li>
          <li>
            <strong>World Editor</strong>: build and change places: ground, houses, trees, wells, named places.
          </li>
          <li>
            <strong>Pattern Studio</strong>: the stitched motifs the world is drawn with.
          </li>
          <li>
            <strong>Characters</strong>: who everyone is, what they want, how they look and how they sound.
          </li>
          <li>
            <strong>AI &amp; Voice Monitor</strong>: load and choose models, test voices, and see what the AI is doing.
          </li>
          <li>
            <strong>Help &amp; Guides</strong>: this guide.
          </li>
        </ul>
      </GuideSection>

      <GuideSection id="save" title="Worlds, saving and undo">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>The world menu</strong> (top left, next to the village button) switches between the demo worlds and the ones
            you have saved. Each demo world is its own story.
          </li>
          <li>
            <strong>Your work is kept in this browser</strong> as you go. <em>World &amp; Data</em> saves a world under a name,
            exports it as a file to share or keep, and imports files from others.
          </li>
          <li>
            <strong>Undo and redo</strong> (top right) take back any change to the world, whoever made it, you or Spinner.
          </li>
          <li>
            Pictures: <em>World &amp; Data</em> saves what is on screen, or the whole world as a print-size tapestry.
          </li>
        </ul>
      </GuideSection>

      <GuideSection id="keys" title="Keys and mouse">
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {(
              [
                ['Drag / scroll or pinch', 'Look around / zoom'],
                ['Double-click a character', 'Talk to them'],
                ['Shift + double-click a character', 'Follow them'],
                ['Double-click a highlighted name or place', 'Look there'],
                ['/', 'Say something, wherever you are'],
                ['\\', 'Hide or show the side panel'],
                ['@Name, #Place', 'Speak to someone, send them somewhere'],
                ['@Spinner', 'Ask your helper'],
                ['Esc', 'Stop a guided tour'],
              ] as const
            ).map(([k, v]) => (
              <tr key={k} className="border-b border-borderFolk/60">
                <td className="py-1 pr-3 font-medium">{k}</td>
                <td className="py-1 text-muted">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GuideSection>

      <GuideSection id="trouble" title="If something is not working">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Nobody is talking</strong>: the story waits for a voice. Load one (above), or choose <em>Not now</em> on the
            card. Check that the village is not paused, and that the hearing range is not off.
          </li>
          <li>
            <strong>The model will not load</strong>: it needs WebGPU. Use a recent Chrome or Edge; the AI &amp; Voice Monitor shows
            whether WebGPU was found. Light voice works without it.
          </li>
          <li>
            <strong>It is slow</strong>: a big model on a modest computer can be. Try a smaller brain in the AI &amp; Voice Monitor,
            or slow the story down.
          </li>
          <li>
            <strong>Something went wrong in the world</strong>: undo it, or reset the story.
          </li>
        </ul>
      </GuideSection>

      <div className="rushnyk-card flex flex-wrap items-center justify-between gap-2 rounded-sm p-3">
        <p className="text-[13px]">
          <strong>Ready to make your own?</strong> The next part shows how to build a world, make characters and write a story.
        </p>
        <button
          type="button"
          onClick={onNext}
          className="rounded-sm border border-borderFolk bg-surface px-3 py-1.5 text-[12px] font-semibold hover:border-ink/40"
        >
          Make your own story →
        </button>
      </div>
    </div>
  );
}
