import type { CSSProperties } from 'react';
import type { VillageMap } from '../engine/types';

export type WorldThemeKind = 'balkan-myth' | 'shevitsa' | 'classic';

export type UiDecorationPreset =
  | 'auto'
  | 'balkan-shevitsa'
  | 'samodiva-mist'
  | 'carved-hearth'
  | 'frosted-obsidian'
  | 'parchment-chronicle';

export type ResolvedUiDecoration = Exclude<UiDecorationPreset, 'auto'>;

export type FontPreset = 'inter' | 'folk-serif' | 'literary' | 'pixel-mono';

export type BubbleStylePreset =
  | 'frosted-glass'
  | 'embroidered-card'
  | 'parchment-scroll'
  | 'minimal-pill';

export type PlayerAttirePreset =
  | 'auto'
  | 'balkan-yunak'
  | 'balkan-weaver'
  | 'kuker-wanderer'
  | 'forest-samodiva'
  | 'shevitsa-embroiderer'
  | 'classic-traveler';

export type PlayerHeadgearPreset =
  | 'auto'
  | 'none'
  | 'kalpak'
  | 'kerchief'
  | 'flower-venets'
  | 'traveler-hood';

export type PlayerPropPreset = 'auto' | 'none' | 'lantern' | 'staff' | 'shuttle' | 'rose';

export type PlayerHairPreset = 'auto' | 'dark' | 'chestnut' | 'auburn' | 'gold' | 'silver';

export type PlayerSkinPreset = 'auto' | 'warm' | 'pale' | 'olive' | 'deep';

export interface PlayerAppearanceConfig {
  attire: PlayerAttirePreset;
  accentColor: string;
  headgear: PlayerHeadgearPreset;
  hairColor: PlayerHairPreset;
  skinTone: PlayerSkinPreset;
  propItem: PlayerPropPreset;
  seed: number;
}

export interface AestheticSettings {
  uiDecoration: UiDecorationPreset;
  fontPreset: FontPreset;
  fontScale: number;
  bubbleStyle: BubbleStylePreset;
  bubbleOpacity: number;
  bubblesBehindCharacters: boolean;
  hudGlassOpacity: number;
  showDecorations: boolean;
  characterScale: number;
  deoverlapLabels: boolean;
  player: PlayerAppearanceConfig;
}

export const AESTHETIC_STORAGE_KEY = 'seloai:aesthetic-settings-v1';

export const DEFAULT_PLAYER_APPEARANCE: PlayerAppearanceConfig = {
  attire: 'auto',
  accentColor: 'auto',
  headgear: 'auto',
  hairColor: 'auto',
  skinTone: 'auto',
  propItem: 'auto',
  seed: 1,
};

export const DEFAULT_AESTHETIC_SETTINGS: AestheticSettings = {
  uiDecoration: 'auto',
  fontPreset: 'inter',
  fontScale: 1,
  bubbleStyle: 'frosted-glass',
  bubbleOpacity: 0.86,
  bubblesBehindCharacters: false,
  hudGlassOpacity: 0.86,
  showDecorations: true,
  characterScale: 1.15,
  deoverlapLabels: true,
  player: { ...DEFAULT_PLAYER_APPEARANCE },
};

export const PLAYER_ACCENT_SWATCHES: ReadonlyArray<{ id: string; label: string; hex: string }> = [
  { id: 'auto', label: 'World Auto', hex: 'auto' },
  { id: 'crimson', label: 'Madder Crimson', hex: '#b81f28' },
  { id: 'indigo', label: 'Danube Indigo', hex: '#243e6d' },
  { id: 'emerald', label: 'Rhodope Forest', hex: '#206b44' },
  { id: 'ochre', label: 'Harvest Gold', hex: '#c97e1c' },
  { id: 'plum', label: 'Pirin Plum', hex: '#6e3678' },
  { id: 'teal', label: 'River Teal', hex: '#237a7d' },
];

export const UI_DECORATION_OPTIONS: ReadonlyArray<{
  id: UiDecorationPreset;
  label: string;
  hint: string;
}> = [
  { id: 'auto', label: 'Auto (World)', hint: 'Adapts automatically to the active world tiles & lore' },
  { id: 'balkan-shevitsa', label: 'Balkan Shevitsa', hint: 'Smoked obsidian glass, crimson stitch & amber glow' },
  { id: 'samodiva-mist', label: 'Samodiva Mist', hint: 'Deep pine twilight glass with moonlit jade rim' },
  { id: 'carved-hearth', label: 'Carved Hearth', hint: 'Warm roasted walnut glass with honey brass trim' },
  { id: 'frosted-obsidian', label: 'Subtitle Glass', hint: 'Minimal smoked slate glass matching the subtitle bar' },
  { id: 'parchment-chronicle', label: 'Chronicle Vellum', hint: 'High-contrast frosted parchment with deep ink' },
];

export const FONT_PRESET_OPTIONS: ReadonlyArray<{
  id: FontPreset;
  label: string;
  cssFamily: string;
  canvasFamily: string;
}> = [
  {
    id: 'inter',
    label: 'Clean Sans',
    cssFamily: 'Inter, system-ui, -apple-system, sans-serif',
    canvasFamily: 'Inter, system-ui, sans-serif',
  },
  {
    id: 'folk-serif',
    label: 'Folk Serif',
    cssFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif',
    canvasFamily: 'Georgia, serif',
  },
  {
    id: 'literary',
    label: 'Storybook',
    cssFamily: '"Iowan Old Style", Charter, Cambria, Georgia, serif',
    canvasFamily: 'Charter, Georgia, serif',
  },
  {
    id: 'pixel-mono',
    label: 'Retro Mono',
    cssFamily: '"VCR OSD Mono", ui-monospace, SFMono-Regular, monospace',
    canvasFamily: '"VCR OSD Mono", ui-monospace, monospace',
  },
];

export const BUBBLE_STYLE_OPTIONS: ReadonlyArray<{
  id: BubbleStylePreset;
  label: string;
  hint: string;
}> = [
  { id: 'frosted-glass', label: 'Subtitle Glass', hint: 'Smoked dark glass with crisp ivory & amber callouts' },
  { id: 'embroidered-card', label: 'Shevitsa Stitch', hint: 'Smoked dark weave with delicate geometric corner ticks' },
  { id: 'parchment-scroll', label: 'Vellum Scroll', hint: 'Warm antique ivory cards with high-contrast sepia ink' },
  { id: 'minimal-pill', label: 'Compact Pill', hint: 'Streamlined rounded pill cards for dense crowds' },
];

/** Detect the world aesthetic motif from the active map tileset / world name. */
export function detectWorldTheme(
  map?: Pick<VillageMap, 'tileSetUrl' | 'name'> | null,
): WorldThemeKind {
  const hay = `${map?.tileSetUrl ?? ''} ${map?.name ?? ''}`.toLowerCase();
  if (
    hay.includes('balkan-myth') ||
    hay.includes('zmeyovo') ||
    hay.includes('lamia') ||
    hay.includes('змейово')
  ) {
    return 'balkan-myth';
  }
  if (hay.includes('shevitsa') || hay.includes('шевиц') || hay.includes('bulgaria')) {
    return 'shevitsa';
  }
  return 'classic';
}

export function resolveUiDecoration(
  preset: UiDecorationPreset,
  worldTheme: WorldThemeKind,
): ResolvedUiDecoration {
  if (preset !== 'auto') return preset;
  if (worldTheme === 'balkan-myth') return 'balkan-shevitsa';
  if (worldTheme === 'shevitsa') return 'carved-hearth';
  return 'frosted-obsidian';
}

export interface CanvasThemeConfig {
  fontFamily: string;
  fontScale: number;
  characterScale: number;
  bubbleStyle: BubbleStylePreset;
  bubbleOpacity: number;
  deoverlapLabels: boolean;
  showDecorations: boolean;
  speechFill: string;
  speechRimLight: string;
  speechBorder: string;
  speechText: string;
  speechHighlight: string;
  thoughtFill: string;
  thoughtBorder: string;
  thoughtText: string;
  thoughtHighlight: string;
  namePillFill: string;
  namePillBorder: string;
  namePillText: string;
  playerPillFill: string;
  playerPillBorder: string;
  poiFill: string;
  poiBorder: string;
  poiText: string;
  poiGemFill: string;
}

export interface ResolvedAestheticTokens {
  worldTheme: WorldThemeKind;
  resolvedDecoration: ResolvedUiDecoration;
  isLightSurface: boolean;
  fontFamilyCss: string;
  canvasFontFamily: string;
  fontScale: number;
  hudStyle: CSSProperties;
  panelStyle: CSSProperties;
  subtitleStyle: CSSProperties;
  hudTextColor: string;
  hudMutedColor: string;
  hudHoverBg: string;
  hudChipIdleBg: string;
  hudBorderColor: string;
  accentHex: string;
  poiHighlightHex: string;
  activeSpeechBg: string;
  activeSpeechText: string;
  activeThoughtBg: string;
  activeThoughtText: string;
  activeSubtitleBg: string;
  activeSubtitleText: string;
  ribbonGradient: string;
  canvasTheme: CanvasThemeConfig;
}

interface PaletteSpec {
  rgbBg: [number, number, number];
  rgbBorder: [number, number, number];
  isLight: boolean;
  text: string;
  muted: string;
  accentHex: string;
  poiHex: string;
  hoverBg: string;
  chipIdleBg: string;
  ribbonGradient: string;
  poiGemFill: string;
}

const DECORATION_PALETTES: Record<ResolvedUiDecoration, PaletteSpec> = {
  'balkan-shevitsa': {
    rgbBg: [17, 15, 19],
    rgbBorder: [212, 162, 76],
    isLight: false,
    text: '#faf6ee',
    muted: '#c8bfb2',
    accentHex: '#e15b5b',
    poiHex: '#fde68a',
    hoverBg: 'rgba(255, 255, 255, 0.10)',
    chipIdleBg: 'rgba(255, 255, 255, 0.06)',
    ribbonGradient:
      'repeating-linear-gradient(90deg, rgba(220,58,64,0.85) 0 6px, transparent 6px 8px, rgba(244,198,78,0.85) 8px 12px, transparent 12px 14px, rgba(56,160,104,0.8) 14px 18px, transparent 18px 22px)',
    poiGemFill: '#d97706',
  },
  'samodiva-mist': {
    rgbBg: [13, 22, 20],
    rgbBorder: [94, 212, 156],
    isLight: false,
    text: '#eefaf3',
    muted: '#b2d3c2',
    accentHex: '#4ade80',
    poiHex: '#fde68a',
    hoverBg: 'rgba(134, 239, 172, 0.12)',
    chipIdleBg: 'rgba(255, 255, 255, 0.06)',
    ribbonGradient:
      'repeating-linear-gradient(90deg, rgba(74,222,128,0.75) 0 6px, transparent 6px 9px, rgba(167,139,250,0.75) 9px 13px, transparent 13px 16px, rgba(248,250,252,0.5) 16px 18px, transparent 18px 22px)',
    poiGemFill: '#10b981',
  },
  'carved-hearth': {
    rgbBg: [27, 19, 15],
    rgbBorder: [217, 146, 58],
    isLight: false,
    text: '#fbf4e8',
    muted: '#d2beaa',
    accentHex: '#f59e0b',
    poiHex: '#fde68a',
    hoverBg: 'rgba(251, 191, 36, 0.12)',
    chipIdleBg: 'rgba(255, 245, 230, 0.06)',
    ribbonGradient:
      'repeating-linear-gradient(90deg, rgba(217,119,6,0.85) 0 8px, transparent 8px 10px, rgba(180,40,40,0.85) 10px 14px, transparent 14px 18px)',
    poiGemFill: '#d97706',
  },
  'frosted-obsidian': {
    rgbBg: [16, 17, 22],
    rgbBorder: [148, 163, 184],
    isLight: false,
    text: '#f4f4f6',
    muted: '#b8bcc8',
    accentHex: '#818cf8',
    poiHex: '#fde68a',
    hoverBg: 'rgba(255, 255, 255, 0.10)',
    chipIdleBg: 'rgba(255, 255, 255, 0.06)',
    ribbonGradient:
      'linear-gradient(90deg, rgba(148,163,184,0.35), rgba(245,158,11,0.45), rgba(148,163,184,0.35))',
    poiGemFill: '#d97706',
  },
  'parchment-chronicle': {
    rgbBg: [246, 239, 224],
    rgbBorder: [138, 102, 62],
    isLight: true,
    text: '#1f1812',
    muted: '#5c4b3b',
    accentHex: '#a33228',
    poiHex: '#8a3c0c',
    hoverBg: 'rgba(68, 48, 28, 0.08)',
    chipIdleBg: 'rgba(68, 48, 28, 0.05)',
    ribbonGradient:
      'repeating-linear-gradient(90deg, rgba(163,50,40,0.75) 0 6px, transparent 6px 8px, rgba(138,102,62,0.75) 8px 14px, transparent 14px 18px)',
    poiGemFill: '#b45309',
  },
};

export function clampAestheticSettings(raw: Partial<AestheticSettings> | null | undefined): AestheticSettings {
  const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.min(max, Math.max(min, n));
  };
  const uiDecoration: UiDecorationPreset = UI_DECORATION_OPTIONS.some((o) => o.id === raw?.uiDecoration)
    ? (raw!.uiDecoration as UiDecorationPreset)
    : DEFAULT_AESTHETIC_SETTINGS.uiDecoration;
  const fontPreset: FontPreset = FONT_PRESET_OPTIONS.some((o) => o.id === raw?.fontPreset)
    ? (raw!.fontPreset as FontPreset)
    : DEFAULT_AESTHETIC_SETTINGS.fontPreset;
  const bubbleStyle: BubbleStylePreset = BUBBLE_STYLE_OPTIONS.some((o) => o.id === raw?.bubbleStyle)
    ? (raw!.bubbleStyle as BubbleStylePreset)
    : DEFAULT_AESTHETIC_SETTINGS.bubbleStyle;

  const p: Partial<PlayerAppearanceConfig> = raw?.player ?? {};
  return {
    uiDecoration,
    fontPreset,
    fontScale: clamp(raw?.fontScale, 0.85, 1.35, DEFAULT_AESTHETIC_SETTINGS.fontScale),
    bubbleStyle,
    bubbleOpacity: clamp(raw?.bubbleOpacity, 0.72, 0.98, DEFAULT_AESTHETIC_SETTINGS.bubbleOpacity),
    bubblesBehindCharacters:
      typeof raw?.bubblesBehindCharacters === 'boolean'
        ? raw.bubblesBehindCharacters
        : DEFAULT_AESTHETIC_SETTINGS.bubblesBehindCharacters,
    hudGlassOpacity: clamp(raw?.hudGlassOpacity, 0.72, 0.96, DEFAULT_AESTHETIC_SETTINGS.hudGlassOpacity),
    showDecorations:
      typeof raw?.showDecorations === 'boolean'
        ? raw.showDecorations
        : DEFAULT_AESTHETIC_SETTINGS.showDecorations,
    characterScale: clamp(raw?.characterScale, 0.85, 1.35, DEFAULT_AESTHETIC_SETTINGS.characterScale),
    deoverlapLabels:
      typeof raw?.deoverlapLabels === 'boolean'
        ? raw.deoverlapLabels
        : DEFAULT_AESTHETIC_SETTINGS.deoverlapLabels,
    player: {
      attire: p.attire ?? DEFAULT_PLAYER_APPEARANCE.attire,
      accentColor: p.accentColor ?? DEFAULT_PLAYER_APPEARANCE.accentColor,
      headgear: p.headgear ?? DEFAULT_PLAYER_APPEARANCE.headgear,
      hairColor: p.hairColor ?? DEFAULT_PLAYER_APPEARANCE.hairColor,
      skinTone: p.skinTone ?? DEFAULT_PLAYER_APPEARANCE.skinTone,
      propItem: p.propItem ?? DEFAULT_PLAYER_APPEARANCE.propItem,
      seed: typeof p.seed === 'number' && Number.isFinite(p.seed) ? p.seed : DEFAULT_PLAYER_APPEARANCE.seed,
    },
  };
}

export function loadAestheticSettings(): AestheticSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_AESTHETIC_SETTINGS, player: { ...DEFAULT_PLAYER_APPEARANCE } };
    const raw = localStorage.getItem(AESTHETIC_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AESTHETIC_SETTINGS, player: { ...DEFAULT_PLAYER_APPEARANCE } };
    return clampAestheticSettings(JSON.parse(raw) as Partial<AestheticSettings>);
  } catch {
    return { ...DEFAULT_AESTHETIC_SETTINGS, player: { ...DEFAULT_PLAYER_APPEARANCE } };
  }
}

export function saveAestheticSettings(settings: AestheticSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AESTHETIC_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota / private mode failures
  }
}

function rgba(rgb: readonly [number, number, number], a: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(2)})`;
}

export function resolveAestheticTokens(
  settings: AestheticSettings,
  worldTheme: WorldThemeKind,
): ResolvedAestheticTokens {
  const resolvedDecoration = resolveUiDecoration(settings.uiDecoration, worldTheme);
  const pal = DECORATION_PALETTES[resolvedDecoration];
  const fontSpec = FONT_PRESET_OPTIONS.find((f) => f.id === settings.fontPreset) ?? FONT_PRESET_OPTIONS[0];
  const hudAlpha = settings.hudGlassOpacity;
  const bubbleAlpha = settings.bubbleOpacity;

  const borderAlpha = pal.isLight ? 0.48 : 0.36;
  const borderColor = rgba(pal.rgbBorder, borderAlpha);
  const hudBg = rgba(pal.rgbBg, hudAlpha);

  const hudStyle: CSSProperties = {
    backgroundColor: hudBg,
    borderColor,
    borderWidth: '1px',
    borderStyle: 'solid',
    color: pal.text,
    backdropFilter: 'blur(14px) saturate(1.15)',
    WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
    boxShadow: pal.isLight
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.72), 0 8px 24px rgba(32, 24, 16, 0.22)'
      : 'inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 10px 28px rgba(0, 0, 0, 0.42)',
    fontFamily: fontSpec.cssFamily,
  };

  const panelBg = rgba(pal.rgbBg, Math.min(0.96, hudAlpha + 0.06));
  const panelStyle: CSSProperties = {
    ...hudStyle,
    backgroundColor: panelBg,
  };

  const subtitleBg =
    resolvedDecoration === 'parchment-chronicle'
      ? rgba(pal.rgbBg, Math.min(0.96, hudAlpha + 0.04))
      : rgba(pal.rgbBg, Math.max(0.84, hudAlpha));
  const subtitleStyle: CSSProperties = {
    ...hudStyle,
    backgroundColor: subtitleBg,
    borderColor: rgba(pal.rgbBorder, pal.isLight ? 0.52 : 0.44),
  };

  // Resolve Canvas2D speech / thought / label colors
  const isParchmentBubble = settings.bubbleStyle === 'parchment-scroll';
  const speechFill = isParchmentBubble
    ? rgba([250, 244, 232], Math.min(0.98, bubbleAlpha + 0.06))
    : rgba(pal.isLight ? [28, 24, 21] : pal.rgbBg, bubbleAlpha);
  const speechText = isParchmentBubble ? '#1e1915' : '#faf6ee';
  const speechHighlight = isParchmentBubble ? '#8c2323' : '#fde68a';
  const speechBorder = isParchmentBubble
    ? 'rgba(138, 96, 54, 0.78)'
    : rgba(pal.rgbBorder, 0.62);

  const thoughtFill = isParchmentBubble
    ? rgba([241, 236, 250], Math.min(0.96, bubbleAlpha + 0.04))
    : `rgba(34, 26, 52, ${Math.min(0.96, bubbleAlpha + 0.02).toFixed(2)})`;
  const thoughtBorder = isParchmentBubble ? '#7356a6' : 'rgba(196, 181, 253, 0.72)';
  const thoughtText = isParchmentBubble ? '#33244f' : '#efe9ff';
  const thoughtHighlight = isParchmentBubble ? '#55368c' : '#fde68a';

  const namePillFill = pal.isLight
    ? `rgba(246, 239, 224, ${Math.min(0.95, hudAlpha + 0.04).toFixed(2)})`
    : `rgba(17, 16, 20, ${Math.min(0.94, hudAlpha).toFixed(2)})`;
  const namePillBorder = pal.isLight ? 'rgba(116, 86, 52, 0.55)' : 'rgba(255, 255, 255, 0.16)';
  const namePillText = pal.isLight ? '#1f1812' : '#faf6ee';

  const playerPillFill =
    resolvedDecoration === 'balkan-shevitsa'
      ? 'rgba(134, 24, 34, 0.90)'
      : resolvedDecoration === 'samodiva-mist'
        ? 'rgba(20, 88, 62, 0.90)'
        : resolvedDecoration === 'carved-hearth'
          ? 'rgba(146, 78, 20, 0.90)'
          : 'rgba(35, 67, 107, 0.90)';

  const canvasTheme: CanvasThemeConfig = {
    fontFamily: fontSpec.canvasFamily,
    fontScale: settings.fontScale,
    characterScale: settings.characterScale,
    bubbleStyle: settings.bubbleStyle,
    bubbleOpacity: settings.bubbleOpacity,
    deoverlapLabels: settings.deoverlapLabels,
    showDecorations: settings.showDecorations,
    speechFill,
    speechRimLight: isParchmentBubble ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.14)',
    speechBorder,
    speechText,
    speechHighlight,
    thoughtFill,
    thoughtBorder,
    thoughtText,
    thoughtHighlight,
    namePillFill,
    namePillBorder,
    namePillText,
    playerPillFill,
    playerPillBorder: 'rgba(255, 255, 255, 0.28)',
    poiFill: namePillFill,
    poiBorder: pal.isLight ? 'rgba(168, 104, 32, 0.65)' : 'rgba(245, 198, 96, 0.45)',
    poiText: pal.isLight ? '#7c2d12' : '#fde68a',
    poiGemFill: pal.poiGemFill,
  };

  return {
    worldTheme,
    resolvedDecoration,
    isLightSurface: pal.isLight,
    fontFamilyCss: fontSpec.cssFamily,
    canvasFontFamily: fontSpec.canvasFamily,
    fontScale: settings.fontScale,
    hudStyle,
    panelStyle,
    subtitleStyle,
    hudTextColor: pal.text,
    hudMutedColor: pal.muted,
    hudHoverBg: pal.hoverBg,
    hudChipIdleBg: pal.chipIdleBg,
    hudBorderColor: borderColor,
    accentHex: pal.accentHex,
    poiHighlightHex: pal.poiHex,
    activeSpeechBg: pal.isLight ? 'rgba(163, 50, 40, 0.16)' : 'rgba(225, 91, 91, 0.24)',
    activeSpeechText: pal.isLight ? '#881c16' : '#fecaca',
    activeThoughtBg: pal.isLight ? 'rgba(91, 61, 153, 0.15)' : 'rgba(139, 92, 246, 0.24)',
    activeThoughtText: pal.isLight ? '#4c1d95' : '#ddd6fe',
    activeSubtitleBg: pal.isLight ? 'rgba(180, 83, 9, 0.15)' : 'rgba(245, 158, 11, 0.22)',
    activeSubtitleText: pal.isLight ? '#78350f' : '#fde68a',
    ribbonGradient: pal.ribbonGradient,
    canvasTheme,
  };
}
