import {
  BALKAN_MYTH_OPENING_DIRECTIVE,
  createBalkanMythMap,
  createBalkanMythVillagers,
} from '../../data/balkanMythMap';
import type { WorldContext } from '../worldContext';
import type { VillageMap } from '../../engine/types';
import { generatedFromTileMap } from '../sceneGenerators';
import { mapFromScene } from '../worldScene';
import { ZMEYOVO_EDITS } from './zmeyovoEdits';
import { WORLD_PACK_FORMAT, WORLD_PACK_VERSION, type WorldPackDefinition } from '../worldPack';

const WELL_TOPIC = ['lamia', 'well'];

export const ZMEYOVO_CONTEXT: WorldContext = {
  settingName: 'Zmeyovo',
  settingKind: 'village',
  playerName: 'Traveler',
  fallbackLandmark: 'the Well',
  premise:
    'Drought grips Zmeyovo: the serpent Lamia Zmeitsa has coiled around the village well and demands a sacrifice before she releases the water.',
  themeId: 'balkan-myth',
  storyLines: {
    openingBeats: [
      'Dry wind hisses up from the stone mouth near {place}; {a} eyes the empty water pitchers between them as {b} fingers a silver coin.',
      "A bronze kuker bell chimes once in the dusty air around {place}, drawing {a} and {b} toward the Lamia's warning ribbon.",
      "Emerald mist coils over the cracked mortar beside {place}; {a} whispers of the well's sacrifice demand while {b} grips a bundle of basil.",
    ],
    closingBeats: [],
    characterLines: {
      lamia: {
        lines: [
          'Come no closer with hollow jugs, {partner}. The springs stay chained in darkness until Zmeyovo lays true tribute on my altar stone.',
          'Gold rings hollow and steel breaks against river-stone, {partner}. Bring honeyed wheat, silver obols, or an oath worth my thirst.',
          'I taste the Samodiva brook upon your boots, {partner}. Would you bargain for rain, or test how deep my coils reach?',
        ],
      },
      'kuker-marin': {
        whenMentioned: WELL_TOPIC,
        lines: [
          'Let the Lamia hiss from the shaft, {partner}—three chimes of bronze chanove bells at #KukeriHearth will rattle every stone around #LamiaWell!',
          'My mask is carved to frighten winter spirits, {partner}, yet even I heard brass groan down #LamiaWell before dawn.',
        ],
      },
      'baba-rada': {
        whenMentioned: WELL_TOPIC,
        lines: [
          'Hush your iron boasting, {partner}. Our grandmothers appeased the Lamia with sweet kolivo, basil, and braided martenitsa wool—never drawn knives.',
          "Every gourd along #BabaHerbhouse stays parched, {partner}, until someone sets an honest offering on #LamiaWell's threshold.",
        ],
      },
      'samodiva-raina': {
        whenMentioned: WELL_TOPIC,
        lines: [
          'Only the birch-ringed basin at #SamodivaSpring still sings sweet and clear, {partner}—never cross my glade with angry steel.',
          'The Lamia fears living water freely shared, {partner}. Leave scarlet thread by the moss stone and draw what you need.',
        ],
      },
      tsveta: {
        whenMentioned: WELL_TOPIC,
        lines: [
          "Look at the Elbetitsa stars in #KhoroStar, {partner}—eight directions stitched in red thread will turn the Lamia's drought into autumn rain.",
          'I am finishing the covenant border at #WeaverCardak, {partner}; will you stand witness with me at #LamiaWell?',
        ],
      },
      stoyan: {
        whenMentioned: WELL_TOPIC,
        lines: [
          'My forge quench-trough is bone dry, {partner}. Whether by iron hook or honest riddle at #LamiaWell, water runs for Zmeyovo before dusk.',
          'Cross #YunakBridge with me, {partner}—we either trade with Samodiva Raina or settle terms with the serpent herself.',
        ],
      },
    },
    sharedLines: [
      {
        whenMentioned: ['sacrifice', 'tribute', 'offering', 'coin'],
        lines: [
          'Look at the silver coins and honey jar left before #LamiaWell, {partner}—half the village thinks appeasement works, the other half wants to break the chains.',
        ],
      },
    ],
  },
};

/**
 * The demo Zmeyovo: the authored tile map frozen into a place (as the World Editor does on
 * the first edit), with the owner's hand edits on top. The default world.
 */
export function createZmeyovoDemoMap(): VillageMap {
  const tiles = createBalkanMythMap();
  const map = mapFromScene({ recipe: { generator: 'tiles', params: {}, seed: 0 }, edits: structuredClone(ZMEYOVO_EDITS), base: generatedFromTileMap(tiles) }, tiles.name);
  // Keep the tileset it came from, so older saves and tools still know which world it is.
  return { ...map, tileSetUrl: tiles.tileSetUrl, tileSetDimX: tiles.tileSetDimX, tileSetDimY: tiles.tileSetDimY };
}

export const zmeyovoPack: WorldPackDefinition = {
  id: 'balkan-myth',
  name: 'Zmeyovo: Well of the Lamia',
  description: '48×36 Balkan myth map, 6 embroidered characters, Wang brook & Lamia sacrifice lore',
  build: () => ({
    format: WORLD_PACK_FORMAT,
    version: WORLD_PACK_VERSION,
    id: 'balkan-myth',
    name: 'Zmeyovo: Well of the Lamia',
    description: 'A drought-stricken Balkan village bargaining with the serpent in its well.',
    context: structuredClone(ZMEYOVO_CONTEXT),
    story: { openingDirective: BALKAN_MYTH_OPENING_DIRECTIVE, focalCharacterId: 'lamia' },
    map: createZmeyovoDemoMap(),
    cast: createBalkanMythVillagers(),
  }),
};
