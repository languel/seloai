import type { SpritesheetData } from '../data/spritesheets/types';

export type Direction = 'down' | 'left' | 'right' | 'up';

/** Tile matrix indexed as [x][y], matching ai-town map convention. -1 means empty. */
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

export interface VillageMap {
  name: string;
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
}

export interface SpritesheetPreset {
  id: string;
  label: string;
  textureUrl: string;
  data: SpritesheetData;
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
  identity: string;
  plan: string;
  voiceStyle: string;
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

export interface VillagerRuntime {
  id: string;
  x: number; // tile space float
  y: number;
  facing: Direction;
  path: Array<{ x: number; y: number }>;
  state: VillagerActivityState;
  activityLabel: string;
  currentBubble?: {
    text: string;
    expiresAt: number;
  };
  activeConversationId?: string;
  memories: MemoryEntry[];
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
  source:
    | 'lfm3-1.7b'
    | 'lfm3-omni'
    | 'minicpm5'
    | 'webgpu-onnx'
    | 'ollama'
    | 'lmstudio'
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
export type BrainEngineKind = 'transformers-onnx' | 'lfm3-omni' | 'minicpm5-gguf';
export type InferenceMode =
  | 'auto'
  | 'lfm3-omni-brain'
  | 'strict-webgpu'
  | 'local-api'
  | 'story-sim';

export interface ModelSettings {
  brainEngine: BrainEngineKind;
  textModelId: string;
  textDtype: TextDtype;
  omniModelId: string;
  omniMmproj: string;
  inferenceMode: InferenceMode;
  localApiEnabled: boolean;
  localApiProvider: 'ollama' | 'lmstudio' | 'custom';
  localApiUrl: string;
  localApiModel: string;
  enableOmniTts: boolean;
  enableWebSpeechFallback: boolean;
  proximityAudioEnabled: boolean;
  proximityRadiusTiles: number;
  ambientAudioEnabled: boolean;
  autoConverse: boolean;
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
  channel: 'lfm3-1.7b' | 'lfm3-omni' | 'local-api' | 'sim' | 'audio' | 'storage';
  level: 'info' | 'success' | 'warn' | 'error';
  title: string;
  detail: string;
  durationMs?: number;
  tokensPerSec?: number;
}
