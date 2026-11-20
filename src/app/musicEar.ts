/**
 * The band's ear on the story, for as long as the app is open, whichever view is showing (it
 * used to listen only while the village view was open, so in the Control Room the music lost
 * the story). About once a second it reads the band the scene; every 150 ms it tells it whether
 * a line is being said, so it steps back under speech and answers each line; and it gives the
 * story the pause after a passage of the Scribe that the band asks for.
 */
import { getAudioDebugStats } from '../ai/audioPipeline';
import { brainRouter } from '../ai/brainRouter';
import { isDancing } from '../engine/dancing';
import { estimateLineDurationMs, type VillageSimulation } from '../engine/simulation';
import type { StoryLine } from '../music/listener';
import { villageMusic } from '../music/villageMusic';

export function startMusicEar(getSimulation: () => VillageSimulation | null): () => void {
  let wired: VillageSimulation | null = null;
  const wire = (sim: VillageSimulation | null) => {
    if (sim === wired) return;
    wired?.setMusicPause(null);
    wired = sim;
    if (!sim) {
      villageMusic.setScorer(null);
      return;
    }
    // The Scribe's model is the band's ear when one is loaded: it names the mood of the moment.
    // It never asks while the model is wanted for the story itself (someone thinking or speaking,
    // a voice playing): the story's lines and voices come first.
    villageMusic.setScorer((lines) => {
      const busy = Boolean(brainRouter.activeSpeechInfo) || [...sim.runtimes.values()].some((rt) => rt.state === 'thinking' || rt.state === 'speaking');
      return busy ? Promise.resolve(null) : brainRouter.scoreMusic({ lines, world: sim.world, settings: sim.modelSettings });
    });
    // After a passage of the Scribe the story pauses for the band's answer, as in a sung story.
    sim.setMusicPause((after) => villageMusic.answerPauseMs(after));
  };

  const timer = window.setInterval(() => {
    const sim = getSimulation();
    wire(sim);
    if (!sim || !villageMusic.enabled) return;
    const cutoff = Date.now() - 180_000;
    const lines: StoryLine[] = [];
    for (const conv of sim.conversations) {
      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const m = conv.messages[i];
        if (m.timestamp < cutoff) break;
        lines.push({ text: m.text, kind: m.kind ?? 'speech', speaker: m.senderName, at: m.timestamp / 1000 });
      }
    }
    let speaking = 0;
    let dancing = 0;
    const dim = sim.map.tileDim;
    for (const rt of sim.runtimes.values()) {
      if (rt.state === 'speaking') speaking++;
      const moving = rt.state === 'walking' || rt.path.length > 0;
      if (isDancing(sim, { id: rt.id, tileX: rt.x * dim, tileY: rt.y * dim, tileDim: dim, moving, state: rt.state })) dancing++;
    }
    villageMusic.hear({
      now: Date.now() / 1000,
      lines,
      activeConversations: sim.conversations.filter((c) => c.active).length,
      speaking,
      dancing,
      backdrop: sim.world?.premise,
    });
  }, 1000);

  // Whether a line is being said right now, checked often so the band can answer each line:
  // a voice playing (any voice, the guide's too), a character speaking, or a line still
  // within its reading time.
  const speechTimer = window.setInterval(() => {
    const sim = getSimulation();
    if (!sim || !villageMusic.enabled) return;
    let speaking =
      Boolean(brainRouter.activeSpeechInfo) ||
      getAudioDebugStats().activeSourcesCount > 0 ||
      (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking);
    if (!speaking) for (const rt of sim.runtimes.values()) if (rt.state === 'speaking') speaking = true;
    if (!speaking) {
      const now = Date.now();
      for (const conv of sim.conversations) {
        const m = conv.messages[conv.messages.length - 1];
        if (m && m.kind !== 'thought' && now - m.timestamp < estimateLineDurationMs(m.text) / Math.max(0.25, Math.abs(sim.speedMultiplier) || 1)) {
          speaking = true;
          break;
        }
      }
    }
    // A line by the Scribe that just ended is a passage of the teller: the band answers it.
    let newest: { at: number; kind?: string } | null = null;
    for (const conv of sim.conversations) {
      const m = conv.messages[conv.messages.length - 1];
      if (m && m.kind !== 'thought' && (!newest || m.timestamp > newest.at)) newest = { at: m.timestamp, kind: m.kind };
    }
    villageMusic.setSpeaking(speaking && !sim.paused, { answer: newest?.kind === 'narration' });
  }, 150);

  // Browsers let sound start only after a click: the band starts on the first one, in any view.
  const start = () => villageMusic.resume();
  window.addEventListener('pointerdown', start);

  return () => {
    window.clearInterval(timer);
    window.clearInterval(speechTimer);
    window.removeEventListener('pointerdown', start);
    wire(null);
  };
}
