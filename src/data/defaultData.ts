import * as rawMap from './defaultMapRaw.js';
import { data as f1 } from './spritesheets/f1';
import { data as f2 } from './spritesheets/f2';
import { data as f3 } from './spritesheets/f3';
import { data as f4 } from './spritesheets/f4';
import { data as f5 } from './spritesheets/f5';
import { data as f6 } from './spritesheets/f6';
import { data as f7 } from './spritesheets/f7';
import { data as f8 } from './spritesheets/f8';
import campfireAnim from './animations/campfire.json';
import gentlesparkleAnim from './animations/gentlesparkle.json';
import gentlesplashAnim from './animations/gentlesplash.json';
import gentlewaterfallAnim from './animations/gentlewaterfall.json';
import windmillAnim from './animations/windmill.json';
import type {
  ModelSettings,
  SpritesheetPreset,
  TileGrid,
  VillageMap,
  VillagerConfig,
  VillagerVoiceProfile,
} from '../engine/types';

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

export function getEffectiveVoice(v: Pick<VillagerConfig, 'voice'>): VillagerVoiceProfile {
  return {
    gender: v.voice?.gender ?? 'female',
    language: v.voice?.language ?? 'American English',
    pitchSemitones: v.voice?.pitchSemitones ?? 0,
    speakingRate: v.voice?.speakingRate ?? 1.0,
    warmthDb: v.voice?.warmthDb ?? 0,
  };
}

export const ANIMATION_CATALOG: Record<
  string,
  { label: string; url: string; spritesheet: any; defaultW: number; defaultH: number }
> = {
  'campfire.json': {
    label: 'Hearth Campfire',
    url: '/assets/spritesheets/campfire.png',
    spritesheet: campfireAnim,
    defaultW: 32,
    defaultH: 32,
  },
  'windmill.json': {
    label: 'Village Windmill',
    url: '/assets/spritesheets/windmill.png',
    spritesheet: windmillAnim,
    defaultW: 208,
    defaultH: 208,
  },
  'gentlesparkle.json': {
    label: 'Water Sparkle',
    url: '/assets/spritesheets/gentlesparkle32.png',
    spritesheet: gentlesparkleAnim,
    defaultW: 32,
    defaultH: 32,
  },
  'gentlewaterfall.json': {
    label: 'Waterfall',
    url: '/assets/spritesheets/gentlewaterfall32.png',
    spritesheet: gentlewaterfallAnim,
    defaultW: 32,
    defaultH: 96,
  },
  'gentlesplash.json': {
    label: 'Water Splash',
    url: '/assets/spritesheets/gentlewaterfall32.png',
    spritesheet: gentlesplashAnim,
    defaultW: 32,
    defaultH: 64,
  },
};

export const SPRITESHEET_PRESETS: SpritesheetPreset[] = [
  { id: 'f1', label: 'Folk 1 (Blue Tunic)', textureUrl: '/assets/32x32folk.png', data: f1 },
  { id: 'f2', label: 'Folk 2 (Scholar)', textureUrl: '/assets/32x32folk.png', data: f2 },
  { id: 'f3', label: 'Folk 3 (Herbalist)', textureUrl: '/assets/32x32folk.png', data: f3 },
  { id: 'f4', label: 'Folk 4 (Forester)', textureUrl: '/assets/32x32folk.png', data: f4 },
  { id: 'f5', label: 'Folk 5 (Artisan)', textureUrl: '/assets/32x32folk.png', data: f5 },
  { id: 'f6', label: 'Folk 6 (Merchant)', textureUrl: '/assets/32x32folk.png', data: f6 },
  { id: 'f7', label: 'Folk 7 (Elder)', textureUrl: '/assets/32x32folk.png', data: f7 },
  { id: 'f8', label: 'Folk 8 (Traveler)', textureUrl: '/assets/32x32folk.png', data: f8 },
];

export const TILESET_PRESETS = [
  { label: 'Gentle Village (Placeholder)', url: '/assets/gentle-obj.png', w: 1440, h: 1024 },
  { label: 'RPG Classic Tileset', url: '/assets/rpg-tileset.png', w: 512, h: 512 },
  { label: 'Mage City Tileset', url: '/assets/magecity.png', w: 256, h: 1450 },
];

function buildInitialCollisionGrid(objectTiles: TileGrid[], width: number, height: number): boolean[][] {
  const grid: boolean[][] = Array.from({ length: width }, () => Array(height).fill(false));
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      for (const layer of objectTiles) {
        if (layer[x]?.[y] !== undefined && layer[x][y] !== -1) {
          grid[x][y] = true;
        }
      }
    }
  }
  return grid;
}

function cloneGrids(grids: number[][][]): TileGrid[] {
  return grids.map((layer) => layer.map((col) => [...col]));
}

export function createDefaultMap(): VillageMap {
  const bgTiles = cloneGrids(rawMap.bgtiles);
  const objectTiles = cloneGrids(rawMap.objmap);
  const width = bgTiles[0].length;
  const height = bgTiles[0][0].length;
  return {
    name: 'Selo Horyzont (Placeholder)',
    tileDim: rawMap.tiledim,
    width,
    height,
    tileSetUrl: rawMap.tilesetpath,
    tileSetDimX: rawMap.tilesetpxw,
    tileSetDimY: rawMap.tilesetpxh,
    bgTiles,
    objectTiles,
    collisionGrid: buildInitialCollisionGrid(objectTiles, width, height),
    animatedSprites: rawMap.animatedsprites.map((s: any, idx: number) => ({
      id: `anim-${idx}`,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      layer: s.layer,
      sheet: s.sheet,
      animation: s.animation,
    })),
    spawnPoints: [
      { id: 'spawn-plaza', label: 'Village Square', x: 22, y: 16 },
      { id: 'spawn-mill', label: 'Windmill Meadow', x: 35, y: 20 },
      { id: 'spawn-well', label: 'River Crossing', x: 14, y: 14 },
      { id: 'spawn-hearth', label: 'Hearth Fire', x: 28, y: 11 },
    ],
  };
}

export const DEFAULT_VILLAGERS: VillagerConfig[] = [
  {
    id: 'v-olena',
    name: 'Olena',
    role: 'Rushnyk Weaver',
    accentColor: '#b42828',
    spritesheetId: 'f1',
    identity:
      'Olena is a spirited embroidery weaver who encodes village stories into red-and-black cross-stitch patterns on linen rushnyky. She is warm, observant, and fiercely proud of craft.',
    plan: 'Gather madder root dyes near the meadow and compare geometric motifs with neighbors.',
    voiceStyle: 'Warm, melodic, unhurried village storyteller.',
    voice: {
      gender: 'female',
      language: 'British English',
      pitchSemitones: 0.5,
      speakingRate: 0.96,
      warmthDb: 2.5,
    },
    homeTile: { x: 21, y: 15 },
    speed: 0.78,
  },
  {
    id: 'v-taras',
    name: 'Taras',
    role: 'Clockwork Blacksmith',
    accentColor: '#c98a2c',
    spritesheetId: 'f4',
    identity:
      'Taras tends the village forge and repairs the wooden windmill gears. Blunt yet deeply generous, he prefers practical fixes over idle philosophy.',
    plan: 'Inspect the southern windmill blades and trade iron hinges for fresh bread.',
    voiceStyle: 'Grounded, rhythmic baritone, concise sentences.',
    voice: {
      gender: 'male',
      language: 'American English',
      pitchSemitones: -2.0,
      speakingRate: 0.94,
      warmthDb: 3.5,
    },
    homeTile: { x: 31, y: 18 },
    speed: 0.72,
  },
  {
    id: 'v-marusia',
    name: 'Marusia',
    role: 'Herbalist & Apothecary',
    accentColor: '#2f6b47',
    spritesheetId: 'f3',
    identity:
      'Marusia studies wild thyme, chamomile, and river reeds. She speaks in gentle nature metaphors and remembers every villager’s seasonal ailments.',
    plan: 'Check the riverbank herbs near the waterfall and brew evening tea for the square.',
    voiceStyle: 'Soft, curious, lyrical tone.',
    voice: {
      gender: 'female',
      language: 'American English',
      pitchSemitones: 2.0,
      speakingRate: 1.02,
      warmthDb: 1.0,
    },
    homeTile: { x: 14, y: 14 },
    speed: 0.75,
  },
  {
    id: 'v-bogdan',
    name: 'Bogdan',
    role: 'Lantern Astronomer',
    accentColor: '#23436b',
    spritesheetId: 'f7',
    identity:
      'Bogdan maps the stars above the Carpathian ridge and keeps the village almanac. He asks quirky questions about time, memory, and how minds work.',
    plan: 'Stroll toward the campfire to record evening weather notes and debate big ideas.',
    voiceStyle: 'Thoughtful, inquisitive, slight dry humor.',
    voice: {
      gender: 'male',
      language: 'British English',
      pitchSemitones: -0.5,
      speakingRate: 0.98,
      warmthDb: -1.0,
    },
    homeTile: { x: 26, y: 12 },
    speed: 0.7,
  },
  {
    id: 'v-kalyna',
    name: 'Kalyna',
    role: 'Traveling Chronicler',
    accentColor: '#7c3aed',
    spritesheetId: 'f6',
    identity:
      'Kalyna just arrived from neighboring valleys with songs, gossip, and sketches of folk ornaments. She loves sparking lively debates at the village square.',
    plan: 'Interview every villager to compile a living oral history of the settlement.',
    voiceStyle: 'Energetic, expressive, playful.',
    voice: {
      gender: 'female',
      language: 'Polish',
      pitchSemitones: 1.0,
      speakingRate: 1.06,
      warmthDb: 0,
    },
    homeTile: { x: 24, y: 20 },
    speed: 0.85,
  },
];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  textModelId: 'onnx-community/LFM3-1.7B-ONNX',
  textDtype: 'q4f16',
  omniModelId: 'LiquidAI/LFM3-Omni-2B-GGUF',
  omniMmproj: '',
  inferenceMode: 'auto',
  localApiEnabled: true,
  localApiProvider: 'ollama',
  localApiUrl: 'http://localhost:11434/v1',
  localApiModel: 'lfm3',
  enableOmniTts: true,
  enableWebSpeechFallback: true,
  proximityAudioEnabled: true,
  proximityRadiusTiles: 9,
  ambientAudioEnabled: false,
  autoConverse: true,
};
