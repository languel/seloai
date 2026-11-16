import React, { createContext, useContext, useMemo } from 'react';
import type { PaletteName } from '../art/looks';
import { stitchKit, stitchVars, type StitchKit } from '../art/uiChrome';
import { GlyphLookContext } from './Glyph';

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
