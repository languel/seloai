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

/** The box a tip can be seen in: the window, cut down by every ancestor that clips. */
function visibleBox(el: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = p.getBoundingClientRect();
    if (cs.overflowX !== 'visible') {
      box.left = Math.max(box.left, r.left);
      box.right = Math.min(box.right, r.right);
    }
    if (cs.overflowY !== 'visible') {
      box.top = Math.max(box.top, r.top);
      box.bottom = Math.min(box.bottom, r.bottom);
    }
  }
  return box;
}

/**
 * Nudges a tip back inside what can be seen when it would run past an edge (or under a
 * clipping panel): sideways first, then flipped to the other side of its button.
 */
export function keepTipInView(tip: HTMLElement) {
  tip.style.translate = '';
  const r = tip.getBoundingClientRect();
  if (!r.width) return;
  const box = visibleBox(tip);
  const pad = 4;
  let dx = 0;
  if (r.right > box.right - pad) dx = box.right - pad - r.right;
  if (r.left + dx < box.left + pad) dx = box.left + pad - r.left;
  let dy = 0;
  const host = tip.parentElement?.getBoundingClientRect();
  if (host) {
    if (r.bottom > box.bottom - pad && r.top > host.top) dy = host.top - 4 - r.bottom;
    else if (r.top < box.top + pad && r.bottom < host.bottom) dy = host.bottom + 4 - r.top;
  }
  if (dx || dy) tip.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

/** A hover tip styled as a small stitched patch rather than a dark slab. */
export function GlyphTip({ children, side = 'below' }: { children: React.ReactNode; side?: TipSide }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const tip = ref.current;
    const host = tip?.parentElement;
    if (!tip || !host) return;
    const place = () => keepTipInView(tip);
    host.addEventListener('pointerenter', place);
    host.addEventListener('focusin', place);
    return () => {
      host.removeEventListener('pointerenter', place);
      host.removeEventListener('focusin', place);
    };
  }, []);
  return (
    <span
      ref={ref}
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
