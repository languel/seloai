import { useMemo } from 'react';
import { EXPRESSIONS, FIGURE_TRAIT_SPECS, seededFigureTraits, type FigureTraitKey, type FigureTraits } from '../art/figures';
import { figureLooksFor, figurePortrait } from '../art/gameLook';
import { PALETTES, type PaletteName } from '../art/looks';
import type { Ink } from '../art/shapes';
import { createSeededRng, hashString } from '../core/rng';
import type { VillagerConfig } from '../engine/types';
import { GlyphButton } from './Glyph';
import { KnotDivider } from './Stitch';

interface FigureAppearanceProps {
  villager: VillagerConfig;
  look: PaletteName;
  onChange: (figure: VillagerConfig['figure']) => void;
}

function Portrait({ villager, look, size, framing, expression }: { villager: VillagerConfig; look: PaletteName; size: number; framing: 'bust' | 'full'; expression?: (typeof EXPRESSIONS)[number] }) {
  const src = useMemo(() => {
    const { build, kind, seed, traits } = figureLooksFor(villager);
    return figurePortrait(villager.id, look, size, build, framing, 2, kind, { seed, traits, expression })?.toDataURL() ?? '';
  }, [villager, look, size, framing, expression]);
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" style={{ width: size, height: size }} />;
}

/**
 * The procedural look of a character: a seed draws every trait, and any trait can be chosen
 * by hand, which then stays put when the seed is rolled again. Choosing one trait never
 * changes another, because hand choices are applied after the seed has drawn everything.
 */
export function FigureAppearance({ villager, look, onChange }: FigureAppearanceProps) {
  const looks = figureLooksFor(villager);
  const seed = villager.figure?.seed ?? hashString(villager.id);
  const chosen: FigureTraits = villager.figure?.traits ?? {};
  const seeded = useMemo(() => seededFigureTraits(createSeededRng(seed), looks.kind), [seed, looks.kind]);
  const palette = PALETTES[look];
  const lineLook = look === 'ink' || look === 'night';

  const effective = { ...seeded, ...chosen };
  const setTrait = (key: FigureTraitKey, value: FigureTraits[FigureTraitKey] | undefined) => {
    const next: FigureTraits = { ...chosen };
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
    onChange({ ...villager.figure, traits: Object.keys(next).length ? next : undefined });
  };

  const visible = FIGURE_TRAIT_SPECS.filter((spec) => {
    if (!spec.builds.includes(looks.build)) return false;
    if (spec.key === 'pattern') return effective.skirtStyle === 'outlined';
    if (spec.key === 'apronInk') return effective.skirtStyle === 'apron';
    return true;
  });
  const chosenCount = Object.keys(chosen).length;

  return (
    <div className="mt-3 space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-sm">Appearance</span>
        <span className="stitch-muted">
          seed {seed}
          {villager.figure?.seed === undefined ? ' (from the id)' : ''}
        </span>
        <GlyphButton
          glyph="dice"
          label={chosenCount ? 'A new person; your chosen traits stay' : 'A new person'}
          onClick={() => onChange({ ...villager.figure, seed: Math.floor(Math.random() * 1_000_000) })}
        />
        {villager.figure?.seed !== undefined && (
          <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={() => onChange({ ...villager.figure, seed: undefined })}>
            Back to the original
          </button>
        )}
        {chosenCount > 0 && (
          <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={() => onChange({ ...villager.figure, traits: undefined })}>
            Clear {chosenCount} choice{chosenCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className="flex items-end gap-3">
        <Portrait villager={villager} look={look} size={112} framing="full" />
        <div className="flex flex-col gap-1">
          <span className="stitch-muted">Moods</span>
          <div className="flex gap-1">
            {EXPRESSIONS.map((e) => (
              <div key={e} className="flex flex-col items-center" title={e}>
                <Portrait villager={villager} look={look} size={44} framing="bust" expression={e} />
                <span className="stitch-muted text-[9px]">{e}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <KnotDivider orientation="horizontal" />

      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {visible.map((spec) => {
          const own = chosen[spec.key];
          const fromSeed = seeded[spec.key as keyof typeof seeded];
          const seedLabel = spec.options.find((o) => o.value === fromSeed)?.label ?? String(fromSeed ?? '—');
          if (spec.ink) {
            return (
              <div key={spec.key} className="flex items-center justify-between gap-2">
                <span>{spec.label}</span>
                <span className="flex items-center gap-0.5">
                  <button
                    type="button"
                    title={`From the seed (${seedLabel})`}
                    aria-pressed={own === undefined}
                    onClick={() => setTrait(spec.key, undefined)}
                    className={`glyph-button rounded-sm px-1 py-0.5 text-[9px] ${own === undefined ? 'glyph-on' : ''}`}
                  >
                    seed
                  </button>
                  {spec.options.map((o) => (
                    <button
                      key={String(o.value)}
                      type="button"
                      title={o.label}
                      aria-label={`${spec.label}: ${o.label}`}
                      aria-pressed={own === o.value}
                      onClick={() => setTrait(spec.key, o.value as Ink)}
                      className="h-4 w-4 rounded-sm"
                      style={{
                        background: palette.inks[o.value as Ink],
                        outline: own === o.value ? `2px solid ${palette.inks.dark}` : (own === undefined && fromSeed === o.value) ? `1px dashed ${palette.inks.dark}` : 'none',
                        outlineOffset: 1,
                        opacity: lineLook ? 0.85 : 1,
                      }}
                    />
                  ))}
                </span>
              </div>
            );
          }
          return (
            <label key={spec.key} className="flex items-center justify-between gap-2">
              <span>{spec.label}</span>
              <select
                value={own === undefined ? '' : String(own)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') return setTrait(spec.key, undefined);
                  const option = spec.options.find((o) => String(o.value) === raw);
                  setTrait(spec.key, option?.value as FigureTraits[FigureTraitKey]);
                }}
                className={`max-w-[11rem] rounded-sm border border-borderFolk bg-transparent px-1 py-0.5 ${own === undefined ? 'stitch-muted' : ''}`}
              >
                <option value="">From the seed: {seedLabel}</option>
                {spec.options.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {lineLook && <p className="stitch-muted">This look is drawn in one ink, so thread colours show only in the coloured looks.</p>}
    </div>
  );
}
