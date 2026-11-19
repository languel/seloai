import { createBulgarianShevitsaMap } from './shevitsaMap';
import {
  createBalkanMythMap,
  createBalkanMythVillagers,
  createBalkanMythWorld,
} from './balkanMythMap';
import type {
  ApiBrainProvider,
  BrainEngineKind,
  ImageGenProvider,
  ModelSettings,
  TextDtype,
  VillageMap,
  VillagerConfig,
  VillagerVoiceProfile,
  VoiceBackendProvider,
} from '../engine/types';

export interface BrainPreset {
  id: string;
  label: string;
  engine: BrainEngineKind;
  modelId: string;
  dtype: TextDtype;
  sizeNote: string;
  description: string;
}

export const WEBGPU_BRAIN_PRESETS: BrainPreset[] = [
  {
    id: 'lfm3-omni-allinone',
    label: 'Liquid LFM3-Omni-2B (All-in-One Brain + Voice)',
    engine: 'lfm3-omni',
    modelId: 'LiquidAI/LFM3-Omni-2B-GGUF',
    dtype: 'q4f16',
    sizeNote: '~1.6 GB (Downloaded, shared)',
    description: 'First-choice WebGPU model for NPC thinking, conversations, STT & TTS — saves ~1.1 GB VRAM.',
  },
  {
    id: 'lfm3-1.7b-local',
    label: 'Liquid LFM3-1.7B (ONNX · Local)',
    engine: 'transformers-onnx',
    modelId: 'onnx-community/LFM3-1.7B-ONNX',
    dtype: 'q4f16',
    sizeNote: '~1.1 GB (Downloaded)',
    description: 'Tri-hybrid local agent model served from public/models/.',
  },
  {
    id: 'qwen3.5-0.8b-text',
    label: 'Qwen 3.5 0.8B Text (webml-community)',
    engine: 'transformers-onnx',
    modelId: 'onnx-community/Qwen3.5-0.8B-Text-ONNX',
    dtype: 'q4f16',
    sizeNote: '~469 MB',
    description: 'Ultra-light & fast text model for rapid multi-NPC village chatter.',
  },
  {
    id: 'ternary-bonsai-1.7b',
    label: 'Ternary Bonsai 1.7B (webml-community)',
    engine: 'transformers-onnx',
    modelId: 'onnx-community/Ternary-Bonsai-1.7B-ONNX',
    dtype: 'q2f16',
    sizeNote: '~470 MB',
    description: '2-bit / ternary quantized 1.7B model for low-VRAM GPUs.',
  },
  {
    id: 'bonsai-1.7b-q1',
    label: 'Bonsai 1.7B 1-bit (webml-community)',
    engine: 'transformers-onnx',
    modelId: 'onnx-community/Bonsai-1.7B-ONNX',
    dtype: 'q1',
    sizeNote: '~291 MB',
    description: 'Smallest 1-bit quantized 1.7B WebGPU model.',
  },
  {
    id: 'qwen3.5-2b',
    label: 'Qwen 3.5 2B (webml-community)',
    engine: 'transformers-onnx',
    modelId: 'onnx-community/Qwen3.5-2B-ONNX',
    dtype: 'q4f16',
    sizeNote: '~1.2 GB',
    description: 'Stronger 2B reasoning & roleplay via Transformers.js WebGPU.',
  },
  {
    id: 'minicpm5-2b',
    label: 'MiniCPM5 2B GGUF (webml-community)',
    engine: 'minicpm5-gguf',
    modelId: 'openbmb/MiniCPM5-2B-GGUF',
    dtype: 'q4f16',
    sizeNote: '~1.6 GB',
    description: 'Runs openbmb/MiniCPM5-2B-GGUF via the MiniCPM5 WebGPU GGUF runtime.',
  },
  {
    id: 'gemma-4-e2b',
    label: 'Gemma 4 E2B-it (webml-community)',
    engine: 'transformers-onnx',
    modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
    dtype: 'q4f16',
    sizeNote: '~3.4 GB',
    description: 'Google Gemma 4 E2B instruction-tuned via Transformers.js WebGPU.',
  },
  {
    id: 'bonsai-2-27b',
    label: 'Ternary Bonsai-2 27B (webml-community)',
    engine: 'bonsai2-gguf',
    modelId: 'prism-ml/Ternary-Bonsai-2-27B-gguf',
    dtype: 'q2',
    sizeNote: '~5.95 GB (needs 8–12+ GB VRAM)',
    description:
      'Prism ML 27B 1.58-bit ternary model via custom WebGPU GGUF kernels (Ternary-Bonsai-2-27B-PTQ1_0.gguf). Requires large WebGPU buffer limits & high GPU/unified memory.',
  },
];

export const OMNI_SPEECH_LANGUAGES = [
  'American English',
  'British English',
  'Polish',
  'German',
  'French',
  'Italian',
  'Spanish',
  'Portuguese',
  'Dutch',
  'Danish',
  'Swedish',
  'Finnish',
  'Greek',
  'Turkish',
  'Hebrew',
  'Arabic',
  'Japanese',
  'Korean',
  'Chinese',
] as const;

/** The accent a voice with none set speaks in: the world's own language (English: American English). */
export function worldAccent(worldLanguage?: string): string {
  const world = worldLanguage?.trim() || 'English';
  return world.toLowerCase() === 'english' ? 'American English' : world;
}

export function getEffectiveVoice(v: Pick<VillagerConfig, 'voice'>, worldLanguage?: string): VillagerVoiceProfile {
  return {
    gender: v.voice?.gender ?? 'female',
    language: v.voice?.language ?? worldAccent(worldLanguage),
    pitchSemitones: v.voice?.pitchSemitones ?? 0,
    speakingRate: v.voice?.speakingRate ?? 1.0,
    warmthDb: v.voice?.warmthDb ?? 0,
  };
}

export function buildNarratorConfig(settings: ModelSettings): VillagerConfig {
  const voiceStyle =
    settings.narratorStyle === 'dungeon-master'
      ? 'Warm, dramatic dungeon-master storyteller guiding the scene in calm measured cadence.'
      : settings.narratorStyle === 'chronicler'
        ? 'Observant village chronicler recording folklore and gestures crisply.'
        : 'Gentle fireside storybook narrator.';
  return {
    id: 'narrator',
    name: settings.narratorName.trim() || 'Scribe',
    role: 'Village Scribe',
    spritesheetId: 'custom',
    accentColor: '#c98a3b',
    identity: 'The invisible chronicler of Selo who reads scene beats, gestures, and reflections.',
    plan: 'Observe and narrate non-dialogue moments in turn.',
    voiceStyle,
    voice: {
      ...DEFAULT_MODEL_SETTINGS.narratorVoice,
      ...(settings.narratorVoice ?? {}),
    },
    homeTile: { x: 16, y: 12 },
    speed: 0,
  };
}

/** The Traveler (the player) as a speaker, so their own lines can be voiced and tested. */
export function buildTravelerConfig(settings: ModelSettings, worldPlayerName = 'Traveler'): VillagerConfig {
  return {
    id: 'human-visitor',
    name: settings.playerName?.trim() || worldPlayerName,
    role: 'Traveler',
    spritesheetId: 'custom',
    accentColor: '#3b5b8c',
    identity: 'The visitor the player steers through the world.',
    plan: '',
    voiceStyle: 'Plain, curious, unhurried.',
    figure: settings.playerFigure,
    voice: {
      ...DEFAULT_MODEL_SETTINGS.playerVoice,
      ...(settings.playerVoice ?? {}),
    },
    homeTile: { x: 0, y: 0 },
    speed: 0,
  };
}

/** Animated prop catalogue. Empty until procedural animated props exist. */
export const ANIMATION_CATALOG: Record<
  string,
  { label: string; url: string; spritesheet: any; defaultW: number; defaultH: number }
> = {};

export const TILESET_PRESETS = [
  { label: 'Balkan Myth Embroidery (Lamia & Zmeyovo)', url: '/assets/balkan-myth-tileset.png', w: 512, h: 512, tileDim: 32 },
  { label: 'Bulgarian Shevitsa (Folk Embroidery)', url: '/assets/shevitsa-tileset.png', w: 512, h: 512, tileDim: 32 },
];

export { createBulgarianShevitsaMap, createBalkanMythMap, createBalkanMythVillagers, createBalkanMythWorld };

/** The world a fresh install opens with. */
export function createDefaultMap(): VillageMap {
  return createBalkanMythMap();
}

export const DEFAULT_VILLAGERS: VillagerConfig[] = createBalkanMythVillagers();


export const API_BRAIN_PRESETS: Array<{
  provider: ApiBrainProvider;
  label: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
}> = [
  { provider: 'ollama', label: 'Ollama (Local)', baseUrl: 'http://localhost:11434/v1', defaultModel: 'lfm3', requiresKey: false },
  { provider: 'lmstudio', label: 'LM Studio (Local)', baseUrl: 'http://localhost:1234/v1', defaultModel: 'local-model', requiresKey: false },
  { provider: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash', requiresKey: true },
  { provider: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-latest', requiresKey: true },
  { provider: 'openai', label: 'OpenAI / ChatGPT', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', requiresKey: true },
  { provider: 'github', label: 'GitHub Models', baseUrl: 'https://models.inference.ai.azure.com', defaultModel: 'gpt-4o-mini', requiresKey: true },
  { provider: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'google/gemini-2.5-flash', requiresKey: true },
  { provider: 'custom', label: 'Custom OpenAI Endpoint', baseUrl: 'http://localhost:8080/v1', defaultModel: 'default', requiresKey: false },
];

export const VOICE_BACKEND_PRESETS: Array<{
  provider: VoiceBackendProvider;
  label: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
}> = [
  { provider: 'local-omni-webspeech', label: 'Local Omni / Web Speech', baseUrl: '', defaultModel: 'lfm3-omni', requiresKey: false },
  { provider: 'openai', label: 'OpenAI TTS (ChatGPT)', baseUrl: 'https://api.openai.com/v1', defaultModel: 'tts-1', requiresKey: true },
  { provider: 'gemini', label: 'Gemini Audio / TTS', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash-preview-tts', requiresKey: true },
  { provider: 'openrouter', label: 'OpenRouter Audio', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-audio-mini', requiresKey: true },
  { provider: 'elevenlabs', label: 'ElevenLabs TTS', baseUrl: 'https://api.elevenlabs.io/v1', defaultModel: 'eleven_flash_v2_5', requiresKey: true },
  { provider: 'custom', label: 'Custom / Kokoro OpenAI TTS', baseUrl: 'http://localhost:8880/v1', defaultModel: 'kokoro', requiresKey: false },
];

export const IMAGE_GEN_PRESETS: Array<{
  provider: ImageGenProvider;
  label: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
}> = [
  { provider: 'agent', label: 'Agent / MCP Callback', baseUrl: '', defaultModel: 'agent-image-tool', requiresKey: false },
  { provider: 'openrouter', label: 'OpenRouter Image', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'google/gemini-2.5-flash-image-preview', requiresKey: true },
  { provider: 'openai', label: 'OpenAI Image', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-image-1', requiresKey: true },
  { provider: 'gemini', label: 'Google Gemini / Imagen', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash-preview-image-generation', requiresKey: true },
  { provider: 'local-sd', label: 'Local WebUI (A1111 / Forge)', baseUrl: 'http://127.0.0.1:7860', defaultModel: 'sd-local', requiresKey: false },
  { provider: 'comfyui', label: 'Local ComfyUI API', baseUrl: 'http://127.0.0.1:8188', defaultModel: 'comfyui-workflow', requiresKey: false },
  { provider: 'custom', label: 'Custom Images Endpoint', baseUrl: 'http://localhost:8080/v1', defaultModel: 'flux', requiresKey: false },
];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  brainEngine: 'lfm3-omni',
  textModelId: 'onnx-community/LFM3-1.7B-ONNX',
  textDtype: 'q4f16',
  omniModelId: 'LiquidAI/LFM3-Omni-2B-GGUF',
  omniMmproj: '',
  autoLoadCachedModel: true,
  inferenceMode: 'auto',
  localApiEnabled: true,
  localApiProvider: 'ollama',
  localApiUrl: 'http://localhost:11434/v1',
  localApiKey: '',
  localApiModel: 'lfm3',
  voiceApiEnabled: false,
  voiceProvider: 'local-omni-webspeech',
  voiceApiUrl: '',
  voiceApiKey: '',
  voiceApiModel: 'lfm3-omni',
  imageGenEnabled: false,
  imageGenProvider: 'agent',
  imageGenUrl: '',
  imageGenApiKey: '',
  imageGenModel: 'agent-image-tool',
  enableOmniTts: true,
  enableWebSpeechFallback: true,
  proximityRadiusTiles: 9,
  eavesdropSpeech: true,
  eavesdropThoughts: false,
  showReasoning: false,
  speakReasoning: false,
  ambientAudioEnabled: false,
  autoConverse: true,
  talkDensity: 0.5,
  scribeDensity: 0.5,
  narratorEnabled: true,
  narratorName: 'The Scribe',
  narratorStyle: 'dungeon-master',
  narrateEvents: true,
  narratorVoice: {
    gender: 'male',
    language: 'Greek',
    pitchSemitones: -1.5,
    speakingRate: 0.94,
    warmthDb: 4,
  },
  playerName: '',
  playerVoice: {
    gender: 'female',
    language: 'Danish',
    pitchSemitones: 0,
    speakingRate: 1.0,
    warmthDb: 0,
  },
  speakPlayerLines: false,
  worldLanguage: 'English',
  ttsInstructionTemplate: 'Perform TTS in {locale} using a {gender} thick heavily accented fairytale voice.',
};
