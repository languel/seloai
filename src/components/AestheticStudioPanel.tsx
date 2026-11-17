import React from 'react';
import { Monitor, Moon, RotateCcw, Sparkles, Sun, X } from 'lucide-react';
import { WORLD_LOOK_OPTIONS } from '../art/gameLook';
import {
  BUBBLE_STYLE_OPTIONS,
  DEFAULT_AESTHETIC_SETTINGS,
  DEFAULT_PLAYER_APPEARANCE,
  FONT_PRESET_OPTIONS,
  UI_DECORATION_OPTIONS,
  type AestheticSettings,
  type ResolvedAestheticTokens,
} from '../utils/aestheticThemes';

export type AppThemeMode = 'system' | 'light' | 'dark';

interface AestheticStudioPanelProps {
  settings: AestheticSettings;
  tokens: ResolvedAestheticTokens;
  worldName: string;
  appTheme?: AppThemeMode;
  onChangeAppTheme?: (next: AppThemeMode) => void;
  onChange: (next: AestheticSettings) => void;
  onClose: () => void;
  /** Fill the slot it is placed in (the village inspector's), instead of its own width. */
  fill?: boolean;
}

export const AestheticStudioPanel: React.FC<AestheticStudioPanelProps> = ({
  settings,
  tokens,
  worldName,
  appTheme,
  onChangeAppTheme,
  onChange,
  onClose,
  fill = false,
}) => {
  const worldThemeBadge =
    tokens.worldTheme === 'balkan-myth'
      ? 'Balkan Folklore'
      : tokens.worldTheme === 'shevitsa'
        ? 'Shevitsa Loom'
        : 'Classic Village';

  // Buttons as the Storyline panel draws them: the chosen one outlined in ink on linen, the
  // rest quiet, with no coloured fill.
  const pillBtnStyle = (active: boolean): React.CSSProperties =>
    active
      ? {
          backgroundColor: 'var(--bg-linen)',
          color: 'var(--text-ink)',
          borderColor: 'color-mix(in srgb, var(--text-ink) 50%, transparent)',
          fontWeight: 600,
        }
      : {
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--text-muted)',
          borderColor: 'var(--border-folk)',
        };

  return (
    <aside
      aria-label="Style"
      className={`flex h-full ${fill ? 'w-full' : 'w-[min(92vw,22rem)] border-l border-borderFolk'} shrink-0 flex-col overflow-hidden bg-surface text-ink`}
    >
      {settings.showDecorations && !fill && (
        <div
          aria-hidden="true"
          className="h-1 w-full shrink-0"
          style={{ backgroundImage: tokens.ribbonGradient }}
        />
      )}

      {/* Header (in the panel, the mode tabs stand in for it) */}
      {!fill && (
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${'var(--border-folk)'}` }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <span className="truncate">Style</span>
          </div>
          <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {worldName} · {worldThemeBadge}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Style"
          className="rounded p-1 transition hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      )}

      {/* Scrollable Sections */}
      <div className="thin-scroll flex-1 space-y-3.5 overflow-y-auto px-3 py-2.5 text-xs">
        {/* Section 1: World-Matched Player Studio */}
        <section
          className="rounded-md p-2.5"
          style={{
            backgroundColor: 'transparent',
            border: `1px solid ${'var(--border-folk)'}`,
          }}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            The world&apos;s look
          </div>

          <div>
            <div className="space-y-1.5">
              <div>
                <div className="mb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
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
                <div className="mb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
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
                <div className="mb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Speech and thoughts
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      ['bubbles', 'Bubbles', 'Speech bubbles that follow the characters'],
                      ['woven', 'Woven text', 'Words embroidered onto the cloth around the speaker, fading in time'],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <button
                      key={value}
                      type="button"
                      title={hint}
                      aria-pressed={settings.speechStyle === value}
                      onClick={() => onChange({ ...settings, speechStyle: value })}
                      className="rounded border px-1.5 py-1 text-[10px]"
                      style={pillBtnStyle(settings.speechStyle === value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {settings.speechStyle === 'woven' && (
                  <div className="mt-1.5 space-y-1.5">
                    <div className="grid grid-cols-2 gap-1">
                      {(
                        [
                          ['satin', 'Satin', 'Serif letters, upper and lower case, worked in satin stitch'],
                          ['ductus', 'Hand-sewn', 'A single-stroke hand written stroke by stroke and sewn in a stitch you choose'],
                          ['script', 'Script', "The system's handwriting face, thin"],
                          ['counted', 'Counted', 'Capitals cross-stitched on the sampler grid'],
                        ] as const
                      ).map(([value, label, hint]) => (
                        <button
                          key={value}
                          type="button"
                          title={hint}
                          aria-pressed={settings.wovenHand === value}
                          onClick={() => onChange({ ...settings, wovenHand: value })}
                          className="rounded border px-1.5 py-1 text-[10px]"
                          style={pillBtnStyle(settings.wovenHand === value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {settings.wovenHand === 'ductus' && (
                      <div className="grid grid-cols-4 gap-1">
                        {(['back', 'running', 'stem', 'chain'] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            title={{ back: 'Backstitch: a solid line of short stitches', running: 'Running stitch: dashes', stem: 'Stem stitch: a twisted cord', chain: 'Chain stitch: small loops' }[value]}
                            aria-pressed={settings.wovenStitch === value}
                            onClick={() => onChange({ ...settings, wovenStitch: value })}
                            className="rounded border px-1 py-1 text-[10px] capitalize"
                            style={pillBtnStyle(settings.wovenStitch === value)}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    )}
                    {(
                      [
                        ['wovenSize', 'Letter size', 0.4, 2, 0.05, '×'],
                        ...(settings.wovenHand === 'ductus'
                          ? ([
                              ['wovenWeight', 'Thread weight', 0.02, 0.2, 0.005, ''],
                              ['wovenSlant', 'Slant', -0.3, 0.6, 0.02, ''],
                              ['wovenWobble', 'Hand wobble', 0, 1.5, 0.05, ''],
                            ] as const)
                          : []),
                      ] as const
                    ).map(([key, label, min, max, step, unit]) => (
                      <label key={key} className="block text-[10px]">
                        <span className="flex justify-between" style={{ color: 'var(--text-muted)' }}>
                          <span>{label}</span>
                          <span>
                            {Math.round(settings[key] * 100) / 100}
                            {unit}
                          </span>
                        </span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={settings[key]}
                          onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })}
                          className="stitch-range w-full"
                        />
                      </label>
                    ))}
                    {(
                      [
                        ['wovenHoldSec', 'Words stay', 4, 120, 1],
                        ['wovenFadeSec', 'Then fade over', 1, 30, 0.5],
                      ] as const
                    ).map(([key, label, min, max, step]) => (
                      <label key={key} className="block text-[10px]">
                        <span className="flex justify-between" style={{ color: 'var(--text-muted)' }}>
                          <span>{label}</span>
                          <span>{settings[key]}s</span>
                        </span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={settings[key]}
                          onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })}
                          className="stitch-range w-full"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Figure drawing
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      [false, 'Neat', 'Even hems, heads set straight, small patterns'],
                      [true, "Maker's hand", 'Hems that dip, a head a little off true, one big hand, an oversized motif on some skirts'],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <button
                      key={label}
                      type="button"
                      title={hint}
                      aria-pressed={settings.figureQuirks === value}
                      onClick={() => onChange({ ...settings, figureQuirks: value })}
                      className="rounded border px-1.5 py-1 text-[10px]"
                      style={pillBtnStyle(settings.figureQuirks === value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {(
                [
                  ['figureSolid', 'Figures over the cloth', [[true, 'Solid', 'A figure hides the stitches behind it'], [false, 'See-through', 'The cloth shows between a figure\'s threads']]],
                ] as const
              ).map(([key, title, options]) => (
                <div key={key}>
                  <div className="mb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {title}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {options.map(([value, label, hint]) => (
                      <button
                        key={label}
                        type="button"
                        title={hint}
                        aria-pressed={settings[key] === value}
                        onClick={() => onChange({ ...settings, [key]: value })}
                        className="rounded border px-1.5 py-1 text-[10px]"
                        style={pillBtnStyle(settings[key] === value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <div className="mb-0.5 flex items-center justify-between text-[10px]">
                  <span style={{ color: 'var(--text-muted)' }}>All Character Size</span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...settings, characterScale: 1.15 })}
                    className="font-mono text-[10px] underline-offset-2 hover:underline"
                    style={{ color: 'var(--text-muted)' }}
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
                  className="h-1.5 w-full cursor-pointer accent-[var(--text-ink)]"
                />
              </div>
            </div>
          </div>

        </section>

        {/* Section 2: UI Theme & Glass */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Menus &amp; World Decoration
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px]">
              <input
                type="checkbox"
                checked={settings.showDecorations}
                onChange={(e) => onChange({ ...settings, showDecorations: e.target.checked })}
                className="accent-[var(--text-ink)]"
              />
              <span>Ornaments</span>
            </label>
          </div>
          {appTheme && onChangeAppTheme && (
            <div>
              <div className="mb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
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
              <span style={{ color: 'var(--text-muted)' }}>Menu Frost Opacity</span>
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
              className="h-1.5 w-full cursor-pointer accent-[var(--text-ink)]"
            />
          </div>
        </section>

        {/* Section 3: Bubbles */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
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
                  className="accent-[var(--text-ink)]"
                />
                <span>Behind Chars</span>
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1 text-[10px]">
                <input
                  type="checkbox"
                  checked={settings.deoverlapLabels}
                  onChange={(e) => onChange({ ...settings, deoverlapLabels: e.target.checked })}
                  className="accent-[var(--text-ink)]"
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
              <span style={{ color: 'var(--text-muted)' }}>Bubble Glass Opacity</span>
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
              className="h-1.5 w-full cursor-pointer accent-[var(--text-ink)]"
            />
          </div>
        </section>

        {/* Section 4: Typography */}
        <section className="space-y-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
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
              <span style={{ color: 'var(--text-muted)' }}>Font Scale</span>
              <button
                type="button"
                onClick={() => onChange({ ...settings, fontScale: 1 })}
                className="font-mono hover:underline"
                style={{ color: 'var(--text-muted)' }}
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
              className="h-1.5 w-full cursor-pointer accent-[var(--text-ink)]"
            />
          </div>
        </section>
      </div>

      {/* Footer */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
        style={{ borderTop: `1px solid ${'var(--border-folk)'}` }}
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
            borderColor: 'var(--border-folk)',
            backgroundColor: 'transparent',
            color: 'var(--text-ink)',
          }}
        >
          <RotateCcw className="h-3 w-3" />
          Reset All
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border px-3 py-1 text-[11px] font-semibold transition hover:opacity-90"
          style={{ backgroundColor: 'var(--bg-linen)', borderColor: 'var(--border-folk)', color: 'var(--text-ink)' }}
        >
          Close
        </button>
      </div>
    </aside>
  );
};
