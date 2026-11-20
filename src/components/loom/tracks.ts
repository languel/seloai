/**
 * The Loom's lanes, top to bottom: the Scribe, Spinner, the cloth's bands (places or
 * characters), and the music. Each has a base height; the whole stack zooms and scrolls
 * vertically, and one lane can be zoomed on its own (focus) to fill most of the view, which is
 * how the music lane opens into its piano roll. Pure geometry, shared by drawing and hit-tests.
 */

export type TrackKind = 'scribe' | 'spinner' | 'band' | 'music';

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  /** Height at vertical zoom 1 (px). */
  base: number;
  /** For a band: its index in the cloth. */
  band?: number;
}

export interface PlacedTrack extends Track {
  /** Top and height in content pixels (0 = the top of the first lane). */
  top: number;
  h: number;
}

export const LANE_H = 30;
export const MUSIC_COLLAPSED = 40;
/** From this height the music lane shows the piano roll instead of the summary strip. */
export const MUSIC_ROLL_MIN = 120;
/** A focused lane takes this share of the view. */
export const FOCUS_SHARE = 0.72;
export const VZOOM_MIN = 0.5;
export const VZOOM_MAX = 8;

export interface TrackOptions {
  bands: Array<{ id: string; label: string }>;
  showMusic: boolean;
  /** Height of the lanes' view (canvas minus the ruler). */
  viewH: number;
}

/** The lanes, with base heights chosen so that at zoom 1 everything fits the view. */
export function buildTracks({ bands, showMusic, viewH }: TrackOptions): Track[] {
  const fixed = LANE_H * 2 + (showMusic ? MUSIC_COLLAPSED : 0);
  const bandBase = Math.max(24, (viewH - fixed) / Math.max(1, bands.length));
  const out: Track[] = [
    { id: 'lane:scribe', kind: 'scribe', label: 'The Scribe', base: LANE_H },
    { id: 'lane:spinner', kind: 'spinner', label: 'Spinner', base: LANE_H },
    ...bands.map((b, i) => ({ id: `band:${b.id}`, kind: 'band' as const, label: b.label, base: bandBase, band: i })),
  ];
  if (showMusic) out.push({ id: 'lane:music', kind: 'music', label: 'Music', base: MUSIC_COLLAPSED });
  return out;
}

/** Stacks the lanes at a vertical zoom, with `focus` (a lane id) taking most of the view. */
export function placeTracks(tracks: Track[], vzoom: number, focus: string | null, viewH: number): { placed: PlacedTrack[]; total: number } {
  let top = 0;
  const placed = tracks.map((t) => {
    // A focused music lane is always tall enough to open into its piano roll.
    const h = t.id === focus ? Math.max(t.base * vzoom, viewH * FOCUS_SHARE, t.kind === 'music' ? MUSIC_ROLL_MIN + 40 : 0) : t.base * vzoom;
    const p = { ...t, top, h };
    top += h;
    return p;
  });
  return { placed, total: top };
}

export function clampScroll(scroll: number, total: number, viewH: number): number {
  return Math.max(0, Math.min(Math.max(0, total - viewH), scroll));
}

/** The lane at a content height, if any. */
export function trackAt(placed: PlacedTrack[], contentY: number): PlacedTrack | undefined {
  return placed.find((t) => contentY >= t.top && contentY < t.top + t.h);
}

/**
 * The cloth's height `v` (0..1 down the bands, as the layout gives it) in content pixels: each
 * band keeps its share of `v` but has its own height, so a focused band opens out.
 */
export function clothY(placed: PlacedTrack[], bandCount: number, v: number): number {
  const bands = placed.filter((t) => t.kind === 'band');
  if (bands.length === 0 || bandCount === 0) return 0;
  const scaled = Math.max(0, Math.min(bandCount - 1e-9, v * bandCount));
  const i = Math.floor(scaled);
  const band = bands[i] ?? bands[bands.length - 1];
  return band.top + (scaled - i) * band.h;
}

/** Scroll that brings a lane into the middle of the view (or its top, if it is taller). */
export function scrollToTrack(track: PlacedTrack, total: number, viewH: number): number {
  const want = track.h >= viewH ? track.top : track.top + track.h / 2 - viewH / 2;
  return clampScroll(want, total, viewH);
}

/** A new vertical zoom, keeping the content under `anchorY` (view pixels) where it is. */
export function zoomRows(vzoom: number, scroll: number, k: number, anchorY: number): { vzoom: number; scroll: number } {
  const next = Math.max(VZOOM_MIN, Math.min(VZOOM_MAX, vzoom * k));
  const ratio = next / vzoom;
  return { vzoom: next, scroll: Math.max(0, (scroll + anchorY) * ratio - anchorY) };
}
