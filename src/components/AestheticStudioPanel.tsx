import React, { useEffect, useRef, useState } from 'react';
import { Dices, Monitor, Moon, RotateCcw, Sparkles, Sun, X } from 'lucide-react';
import { WORLD_LOOK_OPTIONS } from '../art/gameLook';
import type { CustomSpriteSheet, Direction } from '../engine/types';
import {
  BUBBLE_STYLE_OPTIONS,
  DEFAULT_AESTHETIC_SETTINGS,
  DEFAULT_PLAYER_APPEARANCE,
  FONT_PRESET_OPTIONS,
  PLAYER_ACCENT_SWATCHES,
  UI_DECORATION_OPTIONS,
  type AestheticSettings,
  type PlayerAttirePreset,
  type PlayerHairPreset,
  type PlayerHeadgearPreset,
  type PlayerPropPreset,
  type PlayerSkinPreset,
  type ResolvedAestheticTokens,
} from '../utils/aestheticThemes';

export type AppThemeMode = 'system' | 'light' | 'dark';

interface AestheticStudioPanelProps {
  settings: AestheticSettings;
  tokens: ResolvedAestheticTokens;
  playerSprite: CustomSpriteSheet;
  worldName: string;
  appTheme?: AppThemeMode;
  onChangeAppTheme?: (next: AppThemeMode) => void;
  onChange: (next: AestheticSettings) => void;
  onClose: () => void;
}

const PREVIEW_DIRS: Direction[] = ['down', 'left', 'right', 'up'];

const ATTIRE_OPTIONS: ReadonlyArray<{ id: PlayerAttirePreset; label: string }> = [
  { id: 'auto', label: 'Match World' },
  { id: 'balkan-yunak', label: 'Yunak Vest' },
  { id: 'balkan-weaver', label: 'Folk Weaver' },
  { id: 'shevitsa-embroiderer', label: 'Shevitsa' },
  { id: 'kuker-wanderer', label: 'Kuker Kozhuh' },
  { id: 'forest-samodiva', label: 'Samodiva' },
  { id: 'classic-traveler', label: 'Wayfarer' },
];

const HEADGEAR_OPTIONS: ReadonlyArray<{ id: PlayerHeadgearPreset; label: string }> = [
  { id: 'auto', label: 'World Auto' },
  { id: 'none', label: 'None' },
  { id: 'kalpak', label: 'Kalpak' },
  { id: 'kerchief', label: 'Kerchief' },
  { id: 'flower-venets', label: 'Flower Crown' },
  { id: 'traveler-hood', label: 'Hood' },
];

const PROP_OPTIONS: ReadonlyArray<{ id: PlayerPropPreset; label: string }> = [
  { id: 'auto', label: 'World Auto' },
  { id: 'none', label: 'Empty Hand' },
  { id: 'lantern', label: 'Lantern' },
  { id: 'staff', label: 'Oak Staff' },
  { id: 'shuttle', label: 'Shuttle' },
  { id: 'rose', label: 'Rose' },
];

const HAIR_OPTIONS: ReadonlyArray<{ id: PlayerHairPreset; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'dark', label: 'Dark' },
  { id: 'chestnut', label: 'Chestnut' },
  { id: 'auburn', label: 'Auburn' },
  { id: 'gold', label: 'Gold' },
  { id: 'silver', label: 'Silver' },
];

const SKIN_OPTIONS: ReadonlyArray<{ id: PlayerSkinPreset; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'warm', label: 'Warm' },
  { id: 'pale', label: 'Fair' },
  { id: 'olive', label: 'Olive' },
  { id: 'deep', label: 'Deep' },
];

export const AestheticStudioPanel: React.FC<AestheticStudioPanelProps> = ({
  settings,
  tokens,
  playerSprite,
  worldName,
  appTheme,
  onChangeAppTheme,
  onChange,
  onClose,
}) => {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewDirIdx, setPreviewDirIdx] = useState(0);
  const [walkingPreview, setWalkingPreview] = useState(true);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = playerSprite.textureUrl;
    let frame = 0;
    let timerId: number | null = null;

    const drawFrame = () => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.imageSmoothingEnabled = false;
      if (!img.complete || img.naturalWidth === 0) return;
      const dir = PREVIEW_DIRS[previewDirIdx];
      const row = playerSprite.rowMap[dir] ?? 0;
      const col = walkingPreview ? frame % 4 : 0;
      const sx = col * playerSprite.frameWidth;
      const sy = row * playerSprite.frameHeight;
      ctx.drawImage(
        img,
        sx,
        sy,
        playerSprite.frameWidth,
        playerSprite.frameHeight,
        0,
        0,
        64,
        64,
      );
    };

    img.onload = drawFrame;
    drawFrame();
    if (walkingPreview) {
      timerId = window.setInterval(() => {
        frame = (frame + 1) % 4;
        drawFrame();
      }, 210);
    }

    return () => {
      if (timerId !== null) window.clearInterval(timerId);
    };
  }, [playerSprite, previewDirIdx, walkingPreview]);

  const updatePlayer = (patch: Partial<AestheticSettings['player']>) => {
    onChange({
      ...settings,
      player: { ...settings.player, ...patch },
    });
  };

  const handleRandomizePlayer = () => {
    const attireChoices = ATTIRE_OPTIONS.slice(1).map((o) => o.id);
    const swatchChoices = PLAYER_ACCENT_SWATCHES.slice(1).map((o) => o.hex);
    const hatChoices = HEADGEAR_OPTIONS.slice(1).map((o) => o.id);
    const propChoices = PROP_OPTIONS.slice(1).map((o) => o.id);
    const hairChoices = HAIR_OPTIONS.slice(1).map((o) => o.id);
    const skinChoices = SKIN_OPTIONS.slice(1).map((o) => o.id);
    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    onChange({
      ...settings,
      player: {
        attire: pick(attireChoices),
        accentColor: pick(swatchChoices),
        headgear: pick(hatChoices),
        propItem: pick(propChoices),
        hairColor: pick(hairChoices),
        skinTone: pick(skinChoices),
        seed: Math.floor(Math.random() * 9999) + 1,
      },
    });
  };

  const worldThemeBadge =
    tokens.worldTheme === 'balkan-myth'
      ? 'Balkan Folklore'
      : tokens.worldTheme === 'shevitsa'
        ? 'Shevitsa Loom'
        : 'Classic Village';

  const pillBtnStyle = (active: boolean): React.CSSProperties =>
    active
      ? {
          backgroundColor: tokens.accentHex,
          color: '#ffffff',
          borderColor: 'rgba(255, 255, 255, 0.25)',
        }
      : {
          backgroundColor: tokens.hudChipIdleBg,
          color: tokens.hudTextColor,
          borderColor: tokens.hudBorderColor,
        };

  return (
    <aside
      role="dialog"
      aria-label="Appearance and Player Studio"
      style={tokens.panelStyle}
      className="thin-scroll absolute right-2 top-2 z-40 flex max-h-[calc(100%-1rem)] w-[min(92vw,24rem)] flex-col overflow-hidden rounded-lg shadow-2xl"
    >
      {settings.showDecorations && (
        <div
          aria-hidden="true"
          className="h-1 w-full shrink-0"
          style={{ backgroundImage: tokens.ribbonGradient }}
        />
      )}

      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${tokens.hudBorderColor}` }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: tokens.poiHighlightHex }} />
            <span className="truncate">Appearance &amp; Player Studio</span>
          </div>
          <div className="truncate text-[10px]" style={{ color: tokens.hudMutedColor }}>
            {worldName} · {worldThemeBadge}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Appearance Studio"
          className="rounded p-1 transition hover:opacity-80"
          style={{ color: tokens.hudMutedColor }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable Sections */}
      <div className="thin-scroll flex-1 space-y-3.5 overflow-y-auto px-3 py-2.5 text-xs">
        {/* Section 1: World-Matched Player Studio */}
        <section
          className="rounded-md p-2.5"
          style={{
            backgroundColor: tokens.hudChipIdleBg,
            border: `1px solid ${tokens.hudBorderColor}`,
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: tokens.poiHighlightHex }}>
              Traveler Character
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => updatePlayer({ ...DEFAULT_PLAYER_APPEARANCE })}
                title="Reset traveler appearance to match the active world theme"
                className="rounded border px-1.5 py-0.5 text-[10px] font-medium transition hover:opacity-85"
                style={{
                  borderColor: tokens.hudBorderColor,
                  backgroundColor: tokens.hudChipIdleBg,
                  color: tokens.hudTextColor,
                }}
              >
                Match World
              </button>
              <button
                type="button"
                onClick={handleRandomizePlayer}
                title="Randomize traveler appearance"
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition hover:opacity-85"
                style={{
                  borderColor: tokens.hudBorderColor,
                  backgroundColor: tokens.hudChipIdleBg,
                  color: tokens.hudTextColor,
                }}
              >
                <Dices className="h-3 w-3" />
                Random
              </button>
            </div>
          </div>

          <div className="mb-2.5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPreviewDirIdx((d) => (d + 1) % PREVIEW_DIRS.length)}
              title="Click to rotate traveler preview"
              className="pixel-canvas relative flex h-16 w-16 shrink-0 items-center justify-center rounded-md border"
              style={{
                borderColor: tokens.hudBorderColor,
                backgroundColor: tokens.isLightSurface ? 'rgba(38, 30, 22, 0.10)' : 'rgba(0, 0, 0, 0.28)',
              }}
            >
              <canvas ref={previewCanvasRef} width={64} height={64} className="pixel-canvas h-16 w-16" />
            </button>
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: tokens.hudMutedColor }}>
                  View: <strong style={{ color: tokens.hudTextColor }}>{PREVIEW_DIRS[previewDirIdx]}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setWalkingPreview((w) => !w)}
                  className="rounded border px-1.5 py-0.5 text-[10px]"
                  style={pillBtnStyle(walkingPreview)}
                >
                  {walkingPreview ? 'Walking' : 'Idle'}
                </button>
              </div>
              <div>
                <div className="mb-1 text-[10px]" style={{ color: tokens.hudMutedColor }}>
                  World Look
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {WORLD_LOOK_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      title={option.hint}
                      aria-pressed={settings.worldLook === option.id}
                      onClick={() => onChange({ ...settings, worldLook: option.id })}
                      className="rounded border px-1.5 py-1 text-[10px]"
                      style={pillBtnStyle(settings.worldLook === option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px]" style={{ color: tokens.hudMutedColor }}>
                  Walking figures
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      [false, 'Always face us', 'The original front-facing figures'],
                      [true, 'Turn as they walk', 'Side-on walking left and right, from behind walking away'],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <button
                      key={label}
                      type="button"
                      title={hint}
                      aria-pressed={settings.figureTurns === value}
                      onClick={() => onChange({ ...settings, figureTurns: value })}
                      className="rounded border px-1.5 py-1 text-[10px]"
                      style={pillBtnStyle(settings.figureTurns === value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-0.5 flex items-center justify-between text-[10px]">
                  <span style={{ color: tokens.hudMutedColor }}>All Character Size</span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...settings, characterScale: 1.15 })}
                    className="font-mono text-[10px] underline-offset-2 hover:underline"
                    style={{ color: tokens.poiHighlightHex }}
                  >
                    {settings.characterScale.toFixed(2)}×
                  </button>
                </div>
                <input
                  type="range"
                  min={0.85}
                  max={1.35}
                  step={0.05}
                  value={settings.characterScale}
                  aria-label="Character sprite scale"
                  onChange={(e) => onChange({ ...settings, characterScale: Number(e.target.value) })}
                  className="h-1.5 w-full cursor-pointer accent-amber-400"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <div className="mb-1 text-[10px]" style={{ color: tokens.hudMutedColor }}>Attire</div>
              <div className="flex flex-wrap gap-1">
                {ATTIRE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updatePlayer({ attire: opt.id })}
                    className="rounded border px-1.5 py-0.5 text-[10px] font-medium transition"
                    style={pillBtnStyle(settings.player.attire === opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 text-[10px]" style={{ color: tokens.hudMutedColor }}>Vest / Cloak Accent</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {PLAYER_ACCENT_SWATCHES.map((sw) => {
                  const selected = settings.player.accentColor === sw.hex;
                  return (
                    <button
                      key={sw.id}
                      type="button"
                      onClick={() => updatePlayer({ accentColor: sw.hex })}
                      title={sw.label}
                      aria-label={`Accent ${sw.label}`}
                      className="flex h-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-medium transition"
                      style={{
                        borderColor: selected ? '#ffffff' : tokens.hudBorderColor,
                        boxShadow: selected ? `0 0 0 2px ${tokens.accentHex}` : undefined,
                        backgroundColor: sw.hex === 'auto' ? tokens.hudChipIdleBg : sw.hex,
                        color: '#ffffff',
                        minWidth: sw.hex === 'auto' ? 'auto' : '22px',
                      }}
                    >
                      {sw.hex === 'auto' ? 'Auto' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="block text-[10px]" style={{ color: tokens.hudMutedColor }}>Headgear</span>
                <select
                  value={settings.player.headgear}
                  onChange={(e) => updatePlayer({ headgear: e.target.value as PlayerHeadgearPreset })}
                  className="w-full rounded border px-1.5 py-1 text-[11px]"
                  style={{
                    backgroundColor: tokens.isLightSurface ? 'rgba(255,255,255,0.7)' : 'rgba(12,12,16,0.75)',
                    borderColor: tokens.hudBorderColor,
                    color: tokens.hudTextColor,
                  }}
                >
                  {HEADGEAR_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[10px]" style={{ color: tokens.hudMutedColor }}>Handheld Token</span>
                <select
                  value={settings.player.propItem}
                  onChange={(e) => updatePlayer({ propItem: e.target.value as PlayerPropPreset })}
                  className="w-full rounded border px-1.5 py-1 text-[11px]"
                  style={{
                    backgroundColor: tokens.isLightSurface ? 'rgba(255,255,255,0.7)' : 'rgba(12,12,16,0.75)',
                    borderColor: tokens.hudBorderColor,
                    color: tokens.hudTextColor,
                  }}
                >
                  {PROP_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[10px]" style={{ color: tokens.hudMutedColor }}>Hair Tone</span>
                <select
                  value={settings.player.hairColor}
                  onChange={(e) => updatePlayer({ hairColor: e.target.value as PlayerHairPreset })}
                  className="w-full rounded border px-1.5 py-1 text-[11px]"
                  style={{
                    backgroundColor: tokens.isLightSurface ? 'rgba(255,255,255,0.7)' : 'rgba(12,12,16,0.75)',
                    borderColor: tokens.hudBorderColor,
                    color: tokens.hudTextColor,
                  }}
                >
                  {HAIR_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[10px]" style={{ color: tokens.hudMutedColor }}>Complexion</span>
                <select
                  value={settings.player.skinTone}
                  onChange={(e) => updatePlayer({ skinTone: e.target.value as PlayerSkinPreset })}
                  className="w-full rounded border px-1.5 py-1 text-[11px]"
                  style={{
                    backgroundColor: tokens.isLightSurface ? 'rgba(255,255,255,0.7)' : 'rgba(12,12,16,0.75)',
                    borderColor: tokens.hudBorderColor,
                    color: tokens.hudTextColor,
                  }}
                >
                  {SKIN_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        {/* Section 2: UI Theme & Glass */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: tokens.poiHighlightHex }}>
              Menus &amp; World Decoration
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px]">
              <input
                type="checkbox"
                checked={settings.showDecorations}
                onChange={(e) => onChange({ ...settings, showDecorations: e.target.checked })}
                className="accent-amber-400"
              />
              <span>Ornaments</span>
            </label>
          </div>
          {appTheme && onChangeAppTheme && (
            <div>
              <div className="mb-1 text-[10px]" style={{ color: tokens.hudMutedColor }}>
                App Theme
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['system', 'System', Monitor],
                    ['light', 'Light', Sun],
                    ['dark', 'Dark', Moon],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChangeAppTheme(id)}
                    aria-pressed={appTheme === id}
                    className="inline-flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition"
                    style={pillBtnStyle(appTheme === id)}
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {UI_DECORATION_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                title={opt.hint}
                onClick={() => onChange({ ...settings, uiDecoration: opt.id })}
                className="rounded border px-2 py-1 text-left text-[11px] font-medium transition"
                style={pillBtnStyle(settings.uiDecoration === opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-0.5 flex items-center justify-between text-[10px]">
              <span style={{ color: tokens.hudMutedColor }}>Menu Frost Opacity</span>
              <span className="font-mono">{Math.round(settings.hudGlassOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.72}
              max={0.96}
              step={0.02}
              value={settings.hudGlassOpacity}
              aria-label="Menu glass opacity"
              onChange={(e) => onChange({ ...settings, hudGlassOpacity: Number(e.target.value) })}
              className="h-1.5 w-full cursor-pointer accent-amber-400"
            />
          </div>
        </section>

        {/* Section 3: Bubbles */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: tokens.poiHighlightHex }}>
              Speech &amp; Thought Bubbles
            </span>
            <div className="flex items-center gap-2.5">
              <label
                className="inline-flex cursor-pointer items-center gap-1 text-[10px]"
                title="Draw speech and thought bubbles behind villager and traveler sprites (labels always stay behind characters)"
              >
                <input
                  type="checkbox"
                  checked={settings.bubblesBehindCharacters}
                  onChange={(e) => onChange({ ...settings, bubblesBehindCharacters: e.target.checked })}
                  className="accent-amber-400"
                />
                <span>Behind Chars</span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1 text-[10px]">
                <input
                  type="checkbox"
                  checked={settings.deoverlapLabels}
                  onChange={(e) => onChange({ ...settings, deoverlapLabels: e.target.checked })}
                  className="accent-amber-400"
                />
                <span>De-overlap</span>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {BUBBLE_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                title={opt.hint}
                onClick={() => onChange({ ...settings, bubbleStyle: opt.id })}
                className="rounded border px-2 py-1 text-left text-[11px] font-medium transition"
                style={pillBtnStyle(settings.bubbleStyle === opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-0.5 flex items-center justify-between text-[10px]">
              <span style={{ color: tokens.hudMutedColor }}>Bubble Glass Opacity</span>
              <span className="font-mono">{Math.round(settings.bubbleOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.72}
              max={0.98}
              step={0.02}
              value={settings.bubbleOpacity}
              aria-label="Bubble opacity"
              onChange={(e) => onChange({ ...settings, bubbleOpacity: Number(e.target.value) })}
              className="h-1.5 w-full cursor-pointer accent-amber-400"
            />
          </div>
        </section>

        {/* Section 4: Typography */}
        <section className="space-y-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: tokens.poiHighlightHex }}>
            Typography
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {FONT_PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChange({ ...settings, fontPreset: opt.id })}
                className="rounded border px-2 py-1 text-left text-[11px] font-medium transition"
                style={{
                  ...pillBtnStyle(settings.fontPreset === opt.id),
                  fontFamily: opt.cssFamily,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-0.5 flex items-center justify-between text-[10px]">
              <span style={{ color: tokens.hudMutedColor }}>Font Scale</span>
              <button
                type="button"
                onClick={() => onChange({ ...settings, fontScale: 1 })}
                className="font-mono hover:underline"
                style={{ color: tokens.poiHighlightHex }}
              >
                {Math.round(settings.fontScale * 100)}%
              </button>
            </div>
            <input
              type="range"
              min={0.85}
              max={1.35}
              step={0.05}
              value={settings.fontScale}
              aria-label="Font scale"
              onChange={(e) => onChange({ ...settings, fontScale: Number(e.target.value) })}
              className="h-1.5 w-full cursor-pointer accent-amber-400"
            />
          </div>
        </section>
      </div>

      {/* Footer */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
        style={{ borderTop: `1px solid ${tokens.hudBorderColor}` }}
      >
        <button
          type="button"
          onClick={() =>
            onChange({
              ...DEFAULT_AESTHETIC_SETTINGS,
              player: { ...DEFAULT_PLAYER_APPEARANCE },
            })
          }
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition hover:opacity-85"
          style={{
            borderColor: tokens.hudBorderColor,
            backgroundColor: tokens.hudChipIdleBg,
            color: tokens.hudTextColor,
          }}
        >
          <RotateCcw className="h-3 w-3" />
          Reset All
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1 text-[11px] font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: tokens.accentHex }}
        >
          Done
        </button>
      </div>
    </aside>
  );
};
