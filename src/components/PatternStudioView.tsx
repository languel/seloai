import { useEffect, useMemo, useRef, useState } from 'react';
import { PALETTES, paintLinen, renderEmbroidery, renderLineArt, type PaletteName } from '../art/looks';
import { findGrammar, growMotif, motifShape, resolveMotifParams, type MotifGrid, type MotifParamSpec, type MotifParams, type MotifRecipe } from '../art/patternGrammar';
import { SHEVITSA_REFERENCES, recipeFromReference, type PatternReference } from '../art/patternReferences';
import type { Ink } from '../art/shapes';
import { GlyphButton } from './Glyph';
import { KnotDivider, StitchPanel, StitchSlider } from './Stitch';

/** A motif stitched in the current look, fitted to a square of `size` pixels. */
function MotifCanvas({ grid, look, size, onClick, selected }: { grid: MotifGrid; look: PaletteName; size: number; onClick?: () => void; selected?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const span = Math.max(grid.w, grid.h) + 2;
    const unit = size / span;
    const options = { unit, origin: [size / 2, size / 2] as [number, number], palette: PALETTES[look], seed: 5 };
    const shape = motifShape(grid, 1);
    if (look === 'ink' || look === 'night') {
      ctx.fillStyle = PALETTES[look].ground;
      ctx.fillRect(0, 0, size, size);
      renderLineArt(ctx, [shape], options);
    } else {
      paintLinen(ctx, size, size, options);
      renderEmbroidery(ctx, [shape], options);
    }
  }, [grid, look, size]);
  return (
    <canvas
      ref={ref}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`rounded-sm ${onClick ? 'cursor-pointer' : ''} ${selected ? 'outline outline-2 outline-offset-2' : ''}`}
    />
  );
}

const INK_LABEL: Record<Ink, string> = { primary: 'First', secondary: 'Second', accent: 'Third', accent2: 'Fourth', gold: 'Gold', dark: 'Dark', skin: 'Skin' };
const INK_CHOICES: Ink[] = ['primary', 'secondary', 'accent', 'accent2', 'gold', 'dark'];

/**
 * The pattern studio: motifs generated from references (described styles), never digitised
 * from pictures. Pick a reference to see a page of new motifs in its style, pick one, and
 * tune its parameters; the recipe (grammar, parameters, seed) is what a world or a garment
 * would keep.
 */
export default function PatternStudioView({ look }: { look: PaletteName }) {
  const [refId, setRefId] = useState(SHEVITSA_REFERENCES[0].id);
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState(0);
  const [tweaks, setTweaks] = useState<MotifParams>({});
  const [copied, setCopied] = useState(false);
  const ref: PatternReference = SHEVITSA_REFERENCES.find((r) => r.id === refId) ?? SHEVITSA_REFERENCES[0];
  const grammar = findGrammar(ref.grammar)!;
  const palette = PALETTES[look];

  const seeds = useMemo(() => Array.from({ length: 8 }, (_, i) => page * 100 + i), [page]);
  const pageRecipes = useMemo(() => seeds.map((s) => recipeFromReference(ref, s)), [ref, seeds]);
  const pageMotifs = useMemo(() => pageRecipes.map((r) => growMotif(r)), [pageRecipes]);
  const base = pageRecipes[chosen] ?? pageRecipes[0];
  const recipe: MotifRecipe = useMemo(() => ({ ...base, params: resolveMotifParams(grammar, { ...base.params, ...tweaks }) }), [base, grammar, tweaks]);
  const motif = useMemo(() => growMotif(recipe), [recipe]);
  const thumbs = useMemo(() => SHEVITSA_REFERENCES.map((r) => growMotif(recipeFromReference(r, 1))), []);

  const pick = (i: number) => {
    setChosen(i);
    setTweaks({});
  };
  const setParam = (spec: MotifParamSpec, value: MotifParams[string]) => setTweaks((t) => ({ ...t, [spec.key]: value }));

  return (
    <div className="flex h-full min-h-0 gap-2 p-2 text-ink">
      <StitchPanel className="flex w-60 shrink-0 flex-col gap-1.5 overflow-y-auto p-3 text-xs">
        <div className="font-display text-sm">References</div>
        <p className="stitch-muted text-[10px] leading-snug">Described styles, not pictures: each one grows new motifs in its manner. These follow the regions of the Shevitsa map.</p>
        {SHEVITSA_REFERENCES.map((r, i) => (
          <button
            key={r.id}
            type="button"
            onClick={() => {
              setRefId(r.id);
              pick(0);
            }}
            className={`glyph-button flex items-center gap-2 rounded-sm p-1 text-left ${r.id === refId ? 'glyph-on' : ''}`}
          >
            <MotifCanvas grid={thumbs[i]} look={look} size={36} />
            <span>
              <span className="block font-semibold">{r.label}</span>
              <span className="stitch-muted block text-[10px]">{r.region}</span>
            </span>
          </button>
        ))}
      </StitchPanel>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <StitchPanel className="flex items-center gap-2 px-3 py-1.5 text-xs">
          <span className="font-display text-sm">{ref.label}</span>
          <span className="stitch-muted min-w-0 flex-1 truncate">{ref.description}</span>
          <GlyphButton glyph="dice" label="A new page of motifs" tipSide="below-left" onClick={() => { setPage((p) => p + 1); pick(0); }} />
        </StitchPanel>
        <StitchPanel className="grid min-h-0 flex-1 grid-cols-4 content-start gap-3 overflow-y-auto p-3">
          {pageMotifs.map((g, i) => (
            <div key={seeds[i]} className="flex flex-col items-center gap-1" style={{ outlineColor: palette.inks.dark }}>
              <MotifCanvas grid={g} look={look} size={128} onClick={() => pick(i)} selected={i === chosen} />
              <span className="stitch-muted text-[10px]">seed {seeds[i]}</span>
            </div>
          ))}
        </StitchPanel>
      </div>

      <StitchPanel className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto p-3 text-xs">
        <div className="font-display text-sm">The motif</div>
        <div className="flex justify-center">
          <MotifCanvas grid={motif} look={look} size={240} />
        </div>
        <div className="stitch-muted text-[10px]">
          {grammar.name} · {motif.w}×{motif.h} stitches · seed {recipe.seed}
        </div>
        <KnotDivider orientation="horizontal" />
        {grammar.params.map((spec) => {
          const value = recipe.params[spec.key];
          if (spec.type === 'bool') {
            return (
              <label key={spec.key} className="flex items-center justify-between">
                <span>{spec.label}</span>
                <input type="checkbox" checked={Boolean(value)} onChange={(e) => setParam(spec, e.target.checked)} />
              </label>
            );
          }
          if (spec.type === 'enum') {
            return (
              <label key={spec.key} className="flex items-center justify-between gap-2">
                <span>{spec.label}</span>
                <select value={String(value)} onChange={(e) => setParam(spec, e.target.value)} className="rounded-sm border border-borderFolk bg-transparent px-1 py-0.5">
                  {spec.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            );
          }
          if (spec.type === 'ink') {
            return (
              <div key={spec.key} className="flex items-center justify-between gap-2">
                <span>{spec.label}</span>
                <span className="flex gap-0.5">
                  {INK_CHOICES.map((ink) => (
                    <button
                      key={ink}
                      type="button"
                      title={INK_LABEL[ink]}
                      aria-label={`${spec.label}: ${INK_LABEL[ink]}`}
                      aria-pressed={value === ink}
                      onClick={() => setParam(spec, ink)}
                      className="h-4 w-4 rounded-sm"
                      style={{ background: palette.inks[ink], outline: value === ink ? `2px solid ${palette.inks.dark}` : 'none', outlineOffset: 1 }}
                    />
                  ))}
                </span>
              </div>
            );
          }
          return (
            <label key={spec.key} className="flex flex-col gap-0.5">
              <span className="flex justify-between">
                <span>{spec.label}</span>
                <span className="stitch-muted">{String(value)}</span>
              </span>
              <StitchSlider min={spec.min} max={spec.max} step={spec.step ?? (spec.type === 'int' ? 1 : 0.05)} value={Number(value)} onChange={(e) => setParam(spec, Number(e.target.value))} />
            </label>
          );
        })}
        {Object.keys(tweaks).length > 0 && (
          <button type="button" className="glyph-button self-start rounded-sm px-1.5 py-0.5" onClick={() => setTweaks({})}>
            Back to the reference's choice
          </button>
        )}
        <KnotDivider orientation="horizontal" />
        <button
          type="button"
          className="stitch-panel px-2 py-1 text-left"
          onClick={() => {
            void navigator.clipboard?.writeText(JSON.stringify(recipe, null, 2)).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy the recipe'}
        </button>
        <span className="stitch-muted text-[10px] leading-snug">The recipe (grammar, settings, seed) regrows this exact motif. Cell-by-cell touch-ups, a library, and motifs on houses and garments come next.</span>
      </StitchPanel>
    </div>
  );
}
