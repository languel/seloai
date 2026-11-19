import type { TileMeaningTable } from '../art/scene';
import type { FigureTraits } from '../art/figures';
import type { WorldScene } from '../world/worldScene';
export type Direction = 'down' | 'left' | 'right' | 'up';

/** Tile matrix indexed as [x][y] (column-major). -1 means empty. */
export type TileGrid = number[][];

export interface AnimatedSpritePlacement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  sheet: string;
  animation: string;
}

export interface SpawnPoint {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface PointOfInterest {
  id: string;
  /** Short addressable tag without leading # (e.g. "Plaza", "OldBridge") */
  tag: string;
  label: string;
  x: number;
  y: number;
  description?: string;
  /** The feature this place belongs to (a well, a dancing ground): moving it moves the place too. */
  featureId?: string;
}

export interface TileMacroStamp {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Row-major tile indices [dy * width + dx] from tileset (-1 = empty) */
  tiles: number[];
  layer?: 'bg0' | 'bg1' | 'obj0' | 'obj1';
  blocksMovement?: boolean;
}

export interface VillageMap {
  name: string;
  /** Where the art looks may plant groves: anywhere (the default), or only near the edge. */
  groves?: 'anywhere' | 'edge';
  tileDim: number;
  width: number;
  height: number;
  tileSetUrl: string;
  tileSetDimX: number;
  tileSetDimY: number;
  bgTiles: TileGrid[];
  objectTiles: TileGrid[];
  /** Explicit blocked tiles [x][y]. If omitted/empty, objectTiles >= 0 block movement. */
  collisionGrid: boolean[][];
  animatedSprites: AnimatedSpritePlacement[];
  spawnPoints: SpawnPoint[];
  pointsOfInterest?: PointOfInterest[];
  stamps?: TileMacroStamp[];
  /**
   * What the tiles mean (water, road, a house), so the art looks can redraw the place.
   * Supplied by the world that made the map; without it a map is drawn from walkability.
   */
  tileMeanings?: TileMeaningTable;
  /**
   * The world as a place: a generator recipe plus hand edits. When present it is the
   * authored thing, and size, walkability, places and spawns are derived from it.
   */
  scene?: WorldScene;
}

export interface CustomSpriteSheet {
  textureUrl: string;
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  /** Row index (0-based) for each direction */
  rowMap: Record<Direction, number>;
  framesPerDirection: number;
}

export type VoiceGender = 'female' | 'male';

export type CharacterGender = 'female' | 'male' | 'neutral';

export type SkinToneId =
  | 'porcelain'
  | 'ivory'
  | 'warm-peach'
  | 'olive'
  | 'tan'
  | 'amber'
  | 'chestnut'
  | 'deep-espresso';

export type EyeColorId =
  | 'brown'
  | 'blue'
  | 'green'
  | 'hazel'
  | 'amber'
  | 'charcoal'
  | 'violet';

export type HairStyleId =
  | 'short-crop'
  | 'parted-bob'
  | 'long-wavy'
  | 'braids'
  | 'ponytail'
  | 'spiky'
  | 'bun'
  | 'curly-afro'
  | 'scholar-crown'
  | 'shaved';

export type HairColorId =
  | 'raven'
  | 'espresso'
  | 'chestnut'
  | 'auburn'
  | 'golden-blonde'
  | 'platinum-silver'
  | 'copper-rose'
  | 'indigo-dye'
  | 'forest-sage';

export type FacialHairId = 'none' | 'stubble' | 'mustache' | 'goatee' | 'full-beard';

export type ClothingStyleId =
  | 'rushnyk-tunic'
  | 'herbalist-dress'
  | 'blacksmith-apron'
  | 'scholar-robe'
  | 'forester-vest'
  | 'traveler-cloak'
  | 'overalls'
  | 'noble-coat';

export type ClothingColorId =
  | 'crimson'
  | 'cobalt'
  | 'forest'
  | 'ochre'
  | 'plum'
  | 'charcoal'
  | 'cream-linen'
  | 'teal'
  | 'rust'
  | 'burgundy';

export type TrimColorId =
  | 'gold'
  | 'crimson'
  | 'ivory'
  | 'indigo'
  | 'emerald'
  | 'copper'
  | 'silver'
  | 'obsidian';

export type BottomStyleId = 'trousers' | 'skirt' | 'breeches';

export type FootwearColorId = 'dark-leather' | 'russet-brown' | 'charcoal' | 'straw-tan';

export type AccessoryId =
  | 'none'
  | 'glasses'
  | 'flower-crown'
  | 'straw-hat'
  | 'hood'
  | 'bandana'
  | 'headscarf'
  | 'feather-cap';

export interface CharacterAppearance {
  gender: CharacterGender;
  skinTone: SkinToneId;
  eyeColor: EyeColorId;
  hairStyle: HairStyleId;
  hairColor: HairColorId;
  facialHair: FacialHairId;
  clothingStyle: ClothingStyleId;
  clothingColor: ClothingColorId;
  trimColor: TrimColorId;
  bottomStyle: BottomStyleId;
  footwearColor: FootwearColorId;
  accessory: AccessoryId;
}

export interface VillagerVoiceProfile {
  gender: VoiceGender;
  /** Any of the 19 LFM3-Omni-2B speech locales (e.g. "American English", "British English", "Polish") */
  language: string;
  /** Client-side Web Audio pitch shift in semitones (-6 to +6) */
  pitchSemitones: number;
  /** Client-side speaking speed multiplier (0.80 to 1.25) */
  speakingRate: number;
  /** Client-side low-shelf warmth EQ in dB (-6 to +6) */
  warmthDb: number;
}

export interface VillagerConfig {
  id: string;
  name: string;
  role: string;
  accentColor: string;
  spritesheetId: string;
  customSprite?: CustomSpriteSheet;
  appearance?: CharacterAppearance;
  /** How the art looks draw this character. Unset: decided from appearance or voice. */
  figure?: {
    build?: 'skirted' | 'trousered';
    /** What sort of being: a world pack sets this for its special cast (a lamia, a kuker). */
    kind?: 'human' | 'serpent' | 'kuker' | 'samodiva';
    /** The seed the figure is drawn from; by default, one made from the character's id. */
    seed?: number;
    /** Traits chosen by hand in the character editor; they win over the seed. */
    traits?: FigureTraits;
  };
  identity: string;
  plan: string;
  voiceStyle: string;
  /** Other names people call them by in passing ("Stoyane", "Bai Stoyan"); the first is the usual one. */
  callNames?: string[];
  voice?: VillagerVoiceProfile;
  homeTile: { x: number; y: number };
  speed: number;
}

export interface MemoryEntry {
  id: string;
  timestamp: number;
  importance: number;
  kind: 'observation' | 'conversation' | 'reflection';
  summary: string;
}

export type VillagerActivityState =
  | 'idle'
  | 'walking'
  | 'thinking'
  | 'conversing'
  | 'speaking'
  | 'listening';

export interface BubbleEntry {
  text: string;
  startedAt?: number;
  expiresAt: number;
}

export interface VillagerRuntime {
  id: string;
  x: number; // tile space float
  y: number;
  facing: Direction;
  path: Array<{ x: number; y: number }>;
  state: VillagerActivityState;
  activityLabel: string;
  currentBubble?: BubbleEntry;
  currentThoughtBubble?: BubbleEntry;
  activeConversationId?: string;
  memories: MemoryEntry[];
  worldFeed?: string[];
  currentIntention?: string;
  recentMotives?: string[];
  recentUtterances?: string[];
  blockedTicks?: number;
  sidestepTicks?: number;
  avoidSign?: 1 | -1;
  avoidTargetId?: string;
  lastRerouteAt?: number;
  /** Someone the player sent them to: they keep after them until they are side by side. */
  errand?: { targetId: string; tries: number };
  /** Sent somewhere by the player: they keep walking while they answer. */
  walkAndTalk?: boolean;
  lastThinkAt: number;
  lastMoveAt: number;
  lastLatencyMs?: number;
  animFrame: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  kind?: 'speech' | 'narration' | 'thought';
  /** Raw LLM <think>...</think> reasoning trace, separated from story text */
  reasoning?: string;
  source:
    | 'lfm3-1.7b'
    | 'lfm3-omni'
    | 'minicpm5'
    | 'bonsai2'
    | 'webgpu-onnx'
    | 'ollama'
    | 'lmstudio'
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'github'
    | 'openrouter'
    | 'custom-api'
    | 'human-text'
    | 'human-voice'
    | 'story-sim';
  hasAudio?: boolean;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  messages: ChatMessage[];
  startedAt: number;
  updatedAt: number;
  active: boolean;
}

export type TextDtype = 'q4f16' | 'q4' | 'q2f16' | 'q2' | 'q1' | 'fp16';
export type BrainEngineKind =
  | 'transformers-onnx'
  | 'lfm3-omni'
  | 'minicpm5-gguf'
  | 'bonsai2-gguf';
export type InferenceMode =
  | 'auto'
  | 'lfm3-omni-brain'
  | 'strict-webgpu'
  | 'local-api'
  | 'story-sim';

export type ApiBrainProvider =
  | 'ollama'
  | 'lmstudio'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'github'
  | 'openrouter'
  | 'custom';

export type VoiceBackendProvider =
  | 'local-omni-webspeech'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'elevenlabs'
  | 'custom';

export type ImageGenProvider =
  | 'agent'
  | 'openrouter'
  | 'openai'
  | 'gemini'
  | 'local-sd'
  | 'comfyui'
  | 'custom';

export interface ModelSettings {
  brainEngine: BrainEngineKind;
  textModelId: string;
  textDtype: TextDtype;
  omniModelId: string;
  omniMmproj: string;
  /** Automatically check & load the last-used WebGPU model on startup if already downloaded locally */
  autoLoadCachedModel?: boolean;
  inferenceMode: InferenceMode;
  localApiEnabled: boolean;
  localApiProvider: ApiBrainProvider;
  localApiUrl: string;
  localApiKey?: string;
  localApiModel: string;
  voiceApiEnabled?: boolean;
  voiceProvider?: VoiceBackendProvider;
  voiceApiUrl?: string;
  voiceApiKey?: string;
  voiceApiModel?: string;
  imageGenEnabled?: boolean;
  imageGenProvider?: ImageGenProvider;
  imageGenUrl?: string;
  imageGenApiKey?: string;
  imageGenModel?: string;
  enableOmniTts: boolean;
  enableWebSpeechFallback: boolean;
  /** Eavesdrop hearing radius in tiles (0 = off, 1–24 = local radius, >=90 = whole map) */
  proximityRadiusTiles: number;
  /** Hear spoken villager dialogue within eavesdrop radius */
  eavesdropSpeech: boolean;
  /** Eavesdrop on villagers' in-character thoughts within eavesdrop radius */
  eavesdropThoughts: boolean;
  /** Separate mode to display raw <think>...</think> LLM reasoning blocks */
  showReasoning: boolean;
  /** Speak <think>...</think> reasoning aloud (off by default) */
  speakReasoning: boolean;
  ambientAudioEnabled: boolean;
  autoConverse: boolean;
  /**
   * How much the characters talk among themselves, 0 to 1 (0.5 is usual): how soon they strike
   * up a conversation again, how readily, and how long it runs. 0: they go about their business.
   */
  talkDensity?: number;
  /**
   * How much the Scribe tells, 0 to 1 (0.5 is usual): below the middle fewer scenes are framed
   * with an opening and a closing beat; above it the Scribe also tells quiet moments of village
   * life between conversations, more often the higher it is. 0: the Scribe stays silent.
   */
  scribeDensity?: number;
  narratorEnabled: boolean;
  narratorName: string;
  narratorStyle: 'dungeon-master' | 'storybook' | 'chronicler';
  narrateEvents: boolean;
  narratorVoice: VillagerVoiceProfile;
  /** The Traveler's name; empty keeps the name the world gives the player. */
  playerName: string;
  /** The voice the Traveler's own lines are spoken in. */
  playerVoice: VillagerVoiceProfile;
  /**
   * The language every line is written and spoken in. A voice's speech locale only sets the
   * accent it is read with, so a Greek voice reads English lines with a Greek accent.
   */
  worldLanguage: string;
  /**
   * The instruction the voice model reads each line with, with {world}, {accent} and {gender}
   * filled in. Empty uses the built-in wording.
   */
  ttsInstructionTemplate: string;
  /** How the Traveler is drawn in the stitched looks: the same figure villagers have. */
  playerFigure?: VillagerConfig['figure'];
  /** Speak the Traveler's typed lines aloud before the reply. */
  speakPlayerLines: boolean;
}

export type ModelStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export interface ModelProgress {
  status: ModelStatus;
  fraction: number;
  loadedBytes?: number;
  totalBytes?: number;
  message: string;
  error?: string;
}

export interface TelemetryEvent {
  id: string;
  timestamp: number;
  channel: 'lfm3-1.7b' | 'lfm3-omni' | 'local-api' | 'voice-api' | 'image-gen' | 'mcp' | 'sim' | 'audio' | 'storage';
  level: 'info' | 'success' | 'warn' | 'error';
  title: string;
  detail: string;
  durationMs?: number;
  tokensPerSec?: number;
}
