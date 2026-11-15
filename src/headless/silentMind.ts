import { brainRouter } from '../ai/brainRouter';
import type { SimMind } from '../engine/ports';

/** A mind for runs with no speakers: the model router for text, and no audio. */
export function createSilentMind(): SimMind {
  const silent = async () => {};
  return {
    decideVillagerNextAction: (p) => brainRouter.decideVillagerNextAction(p),
    generateVillagerReply: (p) => brainRouter.generateVillagerReply(p),
    generateNarratorReply: (p) => brainRouter.generateNarratorReply(p),
    generateSceneBeat: (p) => brainRouter.generateSceneBeat(p),
    reflectMemory: (p) => brainRouter.reflectMemory(p),
    converseWithVoice: (p) => brainRouter.converseWithVoice(p),
    speakLine: silent,
    speakThought: silent,
    speakNarration: silent,
    refreshActiveSpatialMix: () => {},
    flushAudioQueue: () => {},
    setSpeechPaused: () => {},
    log: (event) => brainRouter.log(event),
  };
}
