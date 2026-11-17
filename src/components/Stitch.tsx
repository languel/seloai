import React, { createContext, useContext, useMemo } from 'react';
import type { PaletteName } from '../art/looks';
import { stitchKit, stitchVars, type StitchKit } from '../art/uiChrome';
import { GlyphLookContext, GlyphTip } from './Glyph';

const StitchKitContext = createContext<StitchKit | null>(null);

/** The stitch kit of the nearest StitchScope, for colours a class cannot reach. */
export function useStitchKit(): StitchKit {
  const kit = useContext(StitchKitContext);
  const look = useContext(GlyphLookContext);
  return kit ?? stitchKit(look);
}

/**
 * Sets the look interface pieces inside are drawn in: glyphs, stitched frames, knot dividers
 * and sliders. Renders no box of its own (`display: contents`), only custom properties.
 */
export function StitchScope({ look, children }: { look: PaletteName; children: React.ReactNode }) {
  const kit = useMemo(() => stitchKit(look), [look]);
  const style = useMemo(() => stitchVars(kit) as React.CSSProperties, [kit]);
  return (
    <GlyphLookContext.Provider value={look}>
      <StitchKitContext.Provider value={kit}>
        <div className="stitch-scope" style={style}>
          {children}
        </div>
      </StitchKitContext.Provider>
    </GlyphLookContext.Provider>
  );
}

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/** A see-through cloth patch with a running-stitch frame. `active` stitches it in the main thread. */
export const StitchPanel = React.forwardRef<HTMLDivElement, DivProps & { active?: boolean }>(function StitchPanel(
  { active, className, ...rest },
  ref,
) {
  return <div ref={ref} {...rest} className={`stitch-panel ${active ? 'stitch-panel-active' : ''} ${className ?? ''}`} />;
});

/** A row (or column) of knots in place of a ruled line. */
export function KnotDivider({ orientation = 'vertical', className }: { orientation?: 'vertical' | 'horizontal'; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={`${orientation === 'vertical' ? 'stitch-divider-v' : 'stitch-divider-h'} ${className ?? ''}`}
    />
  );
}

/** A range input with a running-stitch track and a knot thumb. */
export const StitchSlider = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function StitchSlider({ className, ...rest }, ref) {
    return <input ref={ref} type="range" {...rest} className={`stitch-range ${className ?? ''}`} />;
  },
);

/**
 * A dropdown dressed like a glyph button: the chosen option in the look's own type, a small
 * chevron, and the stitched frame on hover and focus. The browser's menu opens over it.
 */
export function StitchSelect({
  value,
  options,
  onChange,
  label,
  tipSide = 'below',
  className,
  style,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  label: string;
  tipSide?: React.ComponentProps<typeof GlyphTip>['side'];
  className?: string;
  style?: React.CSSProperties;
}) {
  const shown = options.find((o) => o.value === value)?.label ?? value;
  return (
    <span
      style={style}
      className={`glyph-button stitch-select group relative inline-flex h-7 items-center gap-0.5 rounded-sm pl-1.5 pr-1 font-mono text-[11px] ${className ?? ''}`}
    >
      <span className="whitespace-nowrap">{shown}</span>
      <svg aria-hidden viewBox="0 0 8 5" className="h-1.5 w-2 shrink-0 opacity-60">
        <path d="M0.5 0.5 L4 4 L7.5 0.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 0.9" />
      </svg>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <GlyphTip side={tipSide}>{label}</GlyphTip>
    </span>
  );
}
