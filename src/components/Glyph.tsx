import React, { createContext, useContext, useMemo } from 'react';
import type { GlyphName } from '../art/glyphs';
import { glyphDataUrl } from '../art/glyphRender';
import type { PaletteName } from '../art/looks';

/** The look interface glyphs are drawn in; set once near the app root. */
export const GlyphLookContext = createContext<PaletteName>('ink');

export function Glyph({ name, size = 16, className }: { name: GlyphName; size?: number; className?: string }) {
  const look = useContext(GlyphLookContext);
  const ratio = typeof window === 'undefined' ? 2 : Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  const src = useMemo(() => glyphDataUrl(name, look, size, ratio), [name, look, size, ratio]);
  if (!src) return null;
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} className={`pointer-events-none select-none ${className ?? ''}`} />;
}

type TipSide = 'below' | 'below-left' | 'below-right' | 'above';

const TIP_POSITION: Record<TipSide, string> = {
  below: 'left-1/2 top-full mt-1 -translate-x-1/2',
  'below-left': 'right-0 top-full mt-1',
  'below-right': 'left-0 top-full mt-1',
  above: 'left-1/2 bottom-full mb-1 -translate-x-1/2',
};

/** A hover tip styled as a small stitched patch rather than a dark slab. */
export function GlyphTip({ children, side = 'below' }: { children: React.ReactNode; side?: TipSide }) {
  return (
    <span
      role="tooltip"
      className={`glyph-tip pointer-events-none absolute z-50 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition-opacity delay-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${TIP_POSITION[side]}`}
    >
      {children}
    </span>
  );
}

export interface GlyphButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  glyph: GlyphName;
  /** Spoken name and hover tip. */
  label: string;
  pressed?: boolean;
  /** Fade the glyph while `pressed` is false, for show/hide toggles. */
  dimOff?: boolean;
  size?: number;
  tipSide?: TipSide;
  /** Extra content after the glyph, such as a status dot. */
  children?: React.ReactNode;
}

/**
 * An icon-only button: the glyph, a hover tip with its name, and a stitched outline when
 * pressed or active. Off states are drawn faded rather than recoloured.
 */
export function GlyphButton({ glyph, label, pressed, dimOff, size = 16, tipSide = 'below', className, children, ...rest }: GlyphButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
      className={`glyph-button group relative inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-sm px-1 transition disabled:cursor-not-allowed disabled:opacity-35 ${
        dimOff && pressed === false ? 'glyph-off' : ''
      } ${pressed ? 'glyph-on' : ''} ${className ?? ''}`}
    >
      <Glyph name={glyph} size={size} />
      {children}
      <GlyphTip side={tipSide}>{label}</GlyphTip>
    </button>
  );
}
