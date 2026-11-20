import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { piSession } from '../agent/piSession';
import { probeTime, setProbe, subscribeProbe } from '../app/momentProbe';
import { momentSourcesFor, spinnerRecord } from '../app/momentSources';
import { momentAt } from '../engine/moment';
import { villageMusic, type MusicPhrase } from '../music/villageMusic';
import { drawMusicLane, phraseAt } from './loom/drawMusic';
import { BandRulesList, PhrasePanel, ProbePanel } from './loom/LoomPanels';
import { MUSIC_ROLL_MIN, buildTracks, clampScroll, clothY, placeTracks, scrollToTrack, trackAt, zoomRows } from './loom/tracks';
import { PALETTES, paintLinen, type PaletteName } from '../art/looks';
import type { Ink } from '../art/shapes';
import type { VillageSimulation } from '../engine/simulation';
import { effectiveSpeed, isStopped, setSpeed, togglePause } from '../engine/timeControl';
import { layoutLoom, loomInputFor, worldlineRecorderFor, type LoomArrangement, type LoomLayout, type LoomStitch } from '../engine/worldlines';
import {
  DEFAULT_BREAK_SECONDS,
  cueWallTime,
  describeOffset,
  parseDelay,
  scheduleFor,
  wallToSimTime,
  type CueKind,
  type ScheduledCue,
} from '../engine/worldSchedule';
import { SPEED_LOG_MARKS } from '../utils/speedSlider';
import { GlyphButton } from './Glyph';
import { KnotDivider, StitchPanel, StitchSelect } from './Stitch';

interface LoomViewProps {
  sim: VillageSimulation;
  look: PaletteName;
  onJumpToVillage: (villagerId?: string) => void;
  /** Whether Psychohistory is shown beside the Loom, following the probe; and the switch for it. */
  webBeside?: boolean;
  onToggleWeb?: () => void;
}

const THREAD_INKS: Ink[] = ['primary', 'secondary', 'accent', 'accent2', 'gold', 'dark'];
const TOP = 30;
/** The ruler along the top: dragging here selects a span of time. */
const RULER_H = TOP + 4;
const RIGHT_PAD = 8;
const MIN_SPAN = 5_000;
const MAX_SPAN_FLOOR = 6 * 3600_000;

function ago(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** A label for a point on the axis: "now", "30s ago", or "in 30s" (world time, ahead). */
function markLabel(t: number, now: number) {
  if (Math.abs(t - now) < 500) return 'now';
  return t < now ? ago(now - t) : describeOffset(t - now);
}

const CUE_KINDS: Array<{ id: CueKind; label: string; hint: string }> = [
  { id: 'message', label: 'Message', hint: 'Sent as if you said it then: to the Scribe, to everyone, or to one character' },
  { id: 'music', label: 'Musical break', hint: 'The band takes the floor and the story holds back while it plays' },
  { id: 'note', label: 'Note', hint: 'Only a mark on the cloth, for you' },
];

const KIND_MARK: Record<CueKind, string> = { message: '✉', music: '♪', note: '✎' };

type Side =
  | { mode: 'moment' }
  | { mode: 'span' }
  | { mode: 'cue'; id: string | null; atSimMs: number }
  | { mode: 'probe' }
  | { mode: 'phrase' }
  | { mode: 'spinner'; t: number };

interface CueForm {
  kind: CueKind;
  to: string;
  text: string;
  when: string;
  /** Whether "when" was changed here; if not, saving keeps the cue where it is. */
  whenEdited: boolean;
  hold: string;
}

/** Draws text wrapped into at most `lines` lines within `maxW`, ending in … when it runs over. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lines: number, lineH: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  let line = '';
  let row = 0;
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
      continue;
    }
    if (row === lines - 1) {
      let cut = line;
      while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
      ctx.fillText(`${cut}…`, x, y + row * lineH);
      return;
    }
    ctx.fillText(line, x, y + row * lineH);
    row++;
    line = words[i];
  }
  if (line) {
    let cut = line;
    while (cut.length > 1 && ctx.measureText(cut).width > maxW) cut = cut.slice(0, -1);
    ctx.fillText(cut === line ? line : `${cut}…`, x, y + row * lineH);
  }
}

/**
 * The Loom: the world's whole history as a piece of weaving, in lanes. The Scribe's passages
 * and Spinner's work run along the top; the cloth's threads are characters through bands of
 * places, its stitches what was said; the music runs along the bottom and opens into a piano
 * roll. A second needle, the probe, looks back at one moment. Ahead of the live needle, cues a
 * person has placed wait for the world clock to reach them.
 */
export default function LoomView({ sim, look, onJumpToVillage, webBeside, onToggleWeb }: LoomViewProps) {
  const recorder = useMemo(() => worldlineRecorderFor(sim), [sim]);
  const schedule = useMemo(() => scheduleFor(sim), [sim]);
  const [arrangement, setArrangement] = useState<LoomArrangement>('place');
  const [query, setQuery] = useState('');
  const [pulled, setPulled] = useState<string | null>(null);
  const [opened, setOpened] = useState<LoomStitch | null>(null);
  const [followNow, setFollowNow] = useState(true);
  const [spanMode, setSpanMode] = useState(false);
  const [span, setSpan] = useState<{ t0: number; t1: number } | null>(null);
  const [side, setSide] = useState<Side>({ mode: 'moment' });
  const [form, setForm] = useState<CueForm | null>(null);
  // The lane zoomed on its own (it takes most of the view), and the phrase of music chosen.
  const [focus, setFocus] = useState<string | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const [phrase, setPhrase] = useState<MusicPhrase | null>(null);
  const [probe, setProbeState] = useState<number | null>(probeTime);
  useEffect(
    () =>
      subscribeProbe(() => {
        setProbeState(probeTime());
        redraw();
      }),
    [],
  );
  useSyncExternalStore(piSession.subscribe, piSession.snapshot);
  // The music lane: what the band played, under what was said. Remembered on this device.
  const [showMusic, setShowMusic] = useState(() => {
    try {
      return localStorage.getItem('seloai.loom.music') !== 'off';
    } catch {
      return true;
    }
  });
  const toggleMusic = () =>
    setShowMusic((on) => {
      try {
        localStorage.setItem('seloai.loom.music', on ? 'off' : 'on');
      } catch {
        // no storage
      }
      return !on;
    });
  const [tick, setTick] = useState(0);
  const [clockState, setClockState] = useState(() => `${sim.paused}|${sim.speedMultiplier}`);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The visible stretch of time, as [start, end] timestamps, and where "now" sits in it while following.
  const view = useRef<{ t0: number; t1: number } | null>(null);
  const nowFrac = useRef(0.8);
  // Vertical zoom and scroll of the lanes.
  const rows = useRef({ vzoom: 1, scroll: 0 });
  const drag = useRef<
    | { kind: 'pan'; x: number; y: number; t0: number; t1: number; scroll: number; moved: boolean }
    | { kind: 'span'; x: number; from: number; moved: boolean; onRuler: boolean }
    | { kind: 'cue'; id: string; x: number; moved: boolean }
    | { kind: 'probe'; x: number; moved: boolean }
    | { kind: 'rows'; y: number; scroll: number; moved: boolean }
    | null
  >(null);
  const hoverX = useRef<number | null>(null);
  const [frame, setFrame] = useState(0);
  const redraw = () => setFrame((f) => f + 1);

  // The cloth grows as the world goes on; re-lay it about once a second. Pause and pace show at once.
  useEffect(() => {
    let last = 0;
    return sim.subscribe(() => {
      setClockState(`${sim.paused}|${sim.speedMultiplier}`);
      const t = performance.now();
      if (t - last > 900) {
        last = t;
        setTick((n) => n + 1);
      }
    });
  }, [sim]);
  useEffect(() => schedule.subscribe(() => setTick((n) => n + 1)), [schedule]);

  const layout: LoomLayout = useMemo(() => layoutLoom(loomInputFor(sim, recorder, arrangement)), [sim, recorder, arrangement, tick]);
  // The world clock as the cloth was laid, to place cues ahead of the needle.
  const simNow = useMemo(() => sim.simTimeMs, [sim, tick]);
  const cues = schedule.list();
  const names = useMemo(() => new Map([...sim.configs.values()].map((c) => [c.id, c.name])), [sim, tick]);
  names.set('narrator', sim.modelSettings.narratorName || 'Scribe');
  names.set(sim.player.id, sim.player.name);
  const recipientName = (to?: string) => (to === 'all' ? 'everyone' : names.get(to || 'narrator') ?? to ?? 'the Scribe');
  const spinnerItems = spinnerRecord();
  const score = villageMusic.score();

  const cueX = (c: ScheduledCue) => (c.firedAtWall !== undefined ? c.firedAtWall : cueWallTime(c, simNow, layout.now));
  const lastCueT = cues.reduce((m, c) => Math.max(m, cueX(c)), layout.now);
  const maxSpan = Math.max(MAX_SPAN_FLOOR, (lastCueT - layout.start) * 1.4);

  // Keep the window on "now" while following, else leave it where the viewer put it.
  if (!view.current) view.current = { t0: layout.now - 3 * 60_000, t1: layout.now + 45_000 };
  if (followNow && view.current) {
    const w = view.current.t1 - view.current.t0;
    view.current = { t0: layout.now - nowFrac.current * w, t1: layout.now + (1 - nowFrac.current) * w };
  }

  const q = query.trim().toLowerCase();
  const matches = (s: LoomStitch) => q.length > 1 && (s.text.toLowerCase().includes(q) || (names.get(s.from) ?? '').toLowerCase().includes(q));

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(wrap.clientWidth * ratio);
      canvas.height = Math.round(wrap.clientHeight * ratio);
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // Geometry shared by drawing and hit-testing: time across, lanes down. The labels narrow on a narrow loom.
  const geom = () => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    const W = canvas.width / ratio;
    const H = canvas.height / ratio;
    const labelW = W < 560 ? 86 : 132;
    const viewH = Math.max(40, H - TOP);
    const tracks = buildTracks({ bands: layout.bands, showMusic, viewH });
    const { placed, total } = placeTracks(tracks, rows.current.vzoom, focusRef.current, viewH);
    rows.current.scroll = clampScroll(rows.current.scroll, total, viewH);
    const scroll = rows.current.scroll;
    const sy = (contentY: number) => TOP + contentY - scroll;
    const { t0, t1 } = view.current!;
    const x = (t: number) => labelW + ((t - t0) / (t1 - t0)) * (W - labelW - RIGHT_PAD);
    const tOf = (px: number) => t0 + ((px - labelW) / (W - labelW - RIGHT_PAD)) * (t1 - t0);
    const y = (v: number) => sy(clothY(placed, layout.bands.length, v));
    const trackUnder = (py: number) => (py < TOP ? undefined : trackAt(placed, py - TOP + scroll));
    const bandsBottom = (() => {
      const bands = placed.filter((t) => t.kind === 'band');
      const last = bands[bands.length - 1];
      return last ? sy(last.top + last.h) : TOP;
    })();
    const bandsTop = (() => {
      const first = placed.find((t) => t.kind === 'band');
      return first ? sy(first.top) : TOP;
    })();
    return { W, H, x, y, tOf, ratio, labelW, viewH, placed, total, sy, trackUnder, bandsTop, bandsBottom };
  };

  /** Sets the view, keeping it within sensible bounds; following stays on only if now is still in view. */
  const setView = (t0: number, t1: number) => {
    let w = Math.max(MIN_SPAN, Math.min(maxSpan, t1 - t0));
    const mid = (t0 + t1) / 2;
    if (!Number.isFinite(w)) w = 3 * 60_000;
    view.current = { t0: mid - w / 2, t1: mid + w / 2 };
    nowFrac.current = (layout.now - view.current.t0) / w;
    if (nowFrac.current < 0.02 || nowFrac.current > 0.98) setFollowNow(false);
    redraw();
  };

  /** Zooms by `k` (below 1 closer) about time `at` (or now, while following). */
  const zoomBy = (k: number, at?: number) => {
    const v = view.current!;
    const anchor = followNow ? layout.now : at ?? (v.t0 + v.t1) / 2;
    const w = Math.max(MIN_SPAN, Math.min(maxSpan, (v.t1 - v.t0) * k));
    const frac = (anchor - v.t0) / (v.t1 - v.t0);
    view.current = { t0: anchor - frac * w, t1: anchor + (1 - frac) * w };
    if (followNow) nowFrac.current = frac;
    redraw();
  };

  const panBy = (dt: number) => {
    const v = view.current!;
    setFollowNow(false);
    view.current = { t0: v.t0 + dt, t1: v.t1 + dt };
    redraw();
  };

  /** Taller or shorter lanes (k above 1 taller), keeping what is under `anchorY` (canvas px) in place. */
  const zoomLanes = (k: number, anchorY?: number) => {
    const { viewH } = geom();
    const r = zoomRows(rows.current.vzoom, rows.current.scroll, k, (anchorY ?? TOP + viewH / 2) - TOP);
    rows.current = r;
    redraw();
  };

  const scrollLanes = (dy: number) => {
    rows.current.scroll += dy;
    redraw();
  };

  /** Zooms one lane to fill most of the view, or lets it go back. */
  const toggleFocus = (id: string) => {
    const next = focusRef.current === id ? null : id;
    focusRef.current = next;
    setFocus(next);
    if (next) {
      // Bring it into view once it has its new height.
      requestAnimationFrame(() => {
        const { placed, total, viewH } = geom();
        const t = placed.find((p) => p.id === next);
        if (t) rows.current.scroll = scrollToTrack(t, total, viewH);
        redraw();
      });
    }
  };

  const fitAll = () => {
    const t0 = layout.start - 10_000;
    const t1 = Math.max(layout.now + 30_000, lastCueT + 20_000);
    view.current = { t0, t1 };
    nowFrac.current = (layout.now - t0) / (t1 - t0);
    rows.current = { vzoom: 1, scroll: 0 };
    focusRef.current = null;
    setFocus(null);
    setFollowNow(true);
    redraw();
  };

  const zoomToSpan = () => {
    if (!span) return;
    const pad = (span.t1 - span.t0) * 0.05;
    setFollowNow(false);
    setView(span.t0 - pad, span.t1 + pad);
    setFollowNow(false);
  };

  const placeProbe = (t: number) => {
    setProbe(t);
    setSide({ mode: 'probe' });
  };

  // Drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view.current) return;
    const ctx = canvas.getContext('2d')!;
    const g = geom();
    const { W, H, x, y, ratio, labelW: LABEL_W, placed, sy, bandsTop, bandsBottom } = g;
    const palette = PALETTES[look];
    const lineLook = look === 'ink' || look === 'night';
    // Each thread is the character's own colour (their dot), or a palette thread without one.
    const ink = (i: number) => {
      if (lineLook) return palette.inks.dark;
      const id = layout.threads.find((th) => th.ink === i)?.id;
      return (id && sim.configs.get(id)?.accentColor) || palette.inks[THREAD_INKS[i % THREAD_INKS.length]];
    };
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (lineLook) {
      ctx.fillStyle = palette.ground;
      ctx.fillRect(0, 0, W, H);
    } else {
      paintLinen(ctx, W, H, { unit: 6, origin: [0, 0], palette, seed: 3 });
    }
    const { t0, t1 } = view.current;
    const w = t1 - t0;
    const usable = W - LABEL_W - RIGHT_PAD;
    const pxPerSec = usable / (w / 1000);

    // The ruler along the top: marks before now and ahead of it.
    const STEPS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000];
    const stepMs = STEPS.find((st) => (st / w) * usable >= 64) ?? STEPS[STEPS.length - 1];
    ctx.fillStyle = palette.inks.dark;
    ctx.globalAlpha = 0.6;
    ctx.font = '10px Georgia, serif';
    let lastLabel = -Infinity;
    for (let t = layout.now - Math.ceil((layout.now - t0) / stepMs) * stepMs; t <= t1; t += stepMs) {
      const px = x(t);
      if (px < LABEL_W) continue;
      ctx.fillRect(px, TOP - 6, 1, 4);
      // A label only where it has room, so marks never print over each other.
      if (px - lastLabel < 58 || px > W - 40) continue;
      ctx.fillText(markLabel(t, layout.now), px + 3, TOP - 9);
      lastLabel = px;
    }
    ctx.globalAlpha = 1;

    // Everything below the ruler scrolls with the lanes.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TOP, W, H - TOP);
    ctx.clip();

    // Lanes: faint alternating cloth with a running stitch between, and their names in the gutter.
    const labelChars = Math.max(6, Math.floor((LABEL_W - 12) / 6));
    placed.forEach((tr, i) => {
      const top = sy(tr.top);
      if (top > H || top + tr.h < TOP) return;
      if (tr.kind === 'scribe' || tr.kind === 'spinner') {
        ctx.fillStyle = lineLook ? 'rgba(127,127,127,0.08)' : 'rgba(150, 110, 40, 0.07)';
        ctx.fillRect(0, top, W, tr.h);
      } else if (i % 2) {
        ctx.fillStyle = lineLook ? 'rgba(127,127,127,0.06)' : 'rgba(120, 90, 50, 0.06)';
        ctx.fillRect(LABEL_W, top, W - LABEL_W, tr.h);
      }
      ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.secondary;
      ctx.globalAlpha = tr.kind === 'band' && placed[i - 1]?.kind === 'band' ? 0.28 : 0.5;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, top);
      ctx.lineTo(W, top);
      ctx.stroke();
      ctx.setLineDash([]);
      if (tr.kind === 'music') return;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = palette.inks.dark;
      ctx.font = tr.kind === 'band' ? '11px Georgia, serif' : 'italic 11px Georgia, serif';
      const label = tr.label.length > labelChars ? `${tr.label.slice(0, labelChars - 1)}…` : tr.label;
      ctx.fillText(label, 8, top + Math.min(tr.h / 2 + 4, 15));
      if (focus === tr.id) {
        ctx.fillStyle = lineLook ? palette.inks.dark : palette.inks.accent;
        ctx.fillRect(2, top + 3, 2, tr.h - 6);
      }
      ctx.globalAlpha = 1;
    });

    // The future: a little paler, past the needle.
    const nowX = x(layout.now);
    ctx.fillStyle = lineLook ? 'rgba(127,127,127,0.07)' : 'rgba(255,255,255,0.22)';
    ctx.fillRect(Math.max(LABEL_W, nowX), TOP, W - Math.max(LABEL_W, nowX), H - TOP);

    ctx.beginPath();
    ctx.rect(LABEL_W, TOP, W - LABEL_W, H - TOP);
    ctx.clip();

    // A selected span: a wash across the lanes, with its two edges stitched.
    if (span) {
      const a = x(span.t0);
      const b = x(span.t1);
      ctx.fillStyle = lineLook ? 'rgba(127,127,127,0.12)' : 'rgba(70, 100, 160, 0.08)';
      ctx.fillRect(a, TOP, b - a, H);
      ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.primary;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 3]);
      for (const ex of [a, b]) {
        ctx.beginPath();
        ctx.moveTo(ex, TOP);
        ctx.lineTo(ex, H);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // The Scribe's lane: a gold satin stitch for each passage, its words beside it when there is room.
    const scribeLane = placed.find((p) => p.kind === 'scribe');
    const narrations = layout.stitches.filter((s) => s.kind === 'narration' && s.t >= t0 - 60_000 && s.t <= t1);
    if (scribeLane) {
      const top = sy(scribeLane.top);
      const mid = top + scribeLane.h / 2;
      narrations.forEach((s, k) => {
        const sx = x(s.t);
        const lit = matches(s) || (side.mode === 'moment' && opened?.id === s.id);
        ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.gold;
        ctx.globalAlpha = lit ? 1 : 0.85;
        ctx.lineWidth = lit ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(sx, mid - Math.min(9, scribeLane.h * 0.3));
        ctx.lineTo(sx, mid + Math.min(9, scribeLane.h * 0.3));
        ctx.stroke();
        const next = narrations[k + 1];
        const room = (next ? x(next.t) : W) - sx - 10;
        if (room > 40) {
          ctx.fillStyle = palette.inks.dark;
          ctx.globalAlpha = 0.8;
          ctx.font = 'italic 10px Georgia, serif';
          const lines = Math.max(1, Math.min(6, Math.floor((scribeLane.h - 6) / 12)));
          wrapText(ctx, s.text, sx + 5, top + 12, room, lines, 12);
        }
      });
      ctx.globalAlpha = 1;
    }

    // Spinner's lane: what it was asked (an open ring), what it said (a knot), what it did (a small square).
    const spinnerLane = placed.find((p) => p.kind === 'spinner');
    if (spinnerLane) {
      const top = sy(spinnerLane.top);
      const mid = top + spinnerLane.h / 2;
      const shown = spinnerItems.filter((it) => it.t >= t0 - 60_000 && it.t <= t1);
      shown.forEach((it, k) => {
        const sx = x(it.t);
        const colour = lineLook ? palette.inks.dark : it.kind === 'pi' ? palette.inks.primary : it.kind === 'tool' ? palette.inks.secondary : palette.inks.dark;
        ctx.globalAlpha = side.mode === 'spinner' && side.t === it.t ? 1 : 0.85;
        ctx.strokeStyle = colour;
        ctx.fillStyle = colour;
        ctx.lineWidth = 1.5;
        if (it.kind === 'user') {
          ctx.beginPath();
          ctx.arc(sx, mid, 3.5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (it.kind === 'tool') {
          ctx.fillRect(sx - 2, mid - 2, 4, 4);
        } else {
          ctx.beginPath();
          ctx.arc(sx, mid, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (it.kind === 'tool') return;
        const next = shown.slice(k + 1).find((o) => o.kind !== 'tool');
        const room = (next ? x(next.t) : W) - sx - 10;
        if (room > 40) {
          ctx.fillStyle = palette.inks.dark;
          ctx.globalAlpha = 0.75;
          ctx.font = it.kind === 'user' ? 'italic 10px Georgia, serif' : '10px Georgia, serif';
          const lines = Math.max(1, Math.min(6, Math.floor((spinnerLane.h - 6) / 12)));
          wrapText(ctx, it.text, sx + 6, lines > 1 ? top + 12 : mid + 3, room, lines, 12);
        }
      });
      ctx.globalAlpha = 1;
    }

    // The cloth.
    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, Math.max(TOP, bandsTop), W - LABEL_W, Math.max(0, bandsBottom - Math.max(TOP, bandsTop)));
    ctx.clip();

    // The Scribe's passages, faint across the cloth, so the story's turns line up with the threads.
    for (const s of narrations) {
      ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.gold;
      ctx.globalAlpha = matches(s) ? 0.8 : 0.22;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x(s.t), bandsTop);
      ctx.lineTo(x(s.t), bandsBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Threads, with a soft shadow so they sit on the cloth.
    const trace = (pts: Array<{ t: number; y: number }>) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(x(p.t), y(p.y));
        else {
          const prev = pts[i - 1];
          const mx = (x(prev.t) + x(p.t)) / 2;
          ctx.bezierCurveTo(mx, y(prev.y), mx, y(p.y), x(p.t), y(p.y));
        }
      });
    };
    for (const th of layout.threads) {
      const faded = pulled && pulled !== th.id;
      const lifted = pulled === th.id;
      if (!lineLook) {
        ctx.save();
        ctx.translate(1, 1.5);
        ctx.strokeStyle = 'rgba(40, 26, 12, 0.18)';
        ctx.lineWidth = lifted ? 4.5 : 2.6;
        ctx.globalAlpha = faded ? 0.25 : 1;
        trace(th.points);
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = ink(th.ink);
      ctx.globalAlpha = faded ? 0.2 : 1;
      ctx.lineWidth = lifted ? 3.6 : 2;
      ctx.lineCap = 'round';
      if (lineLook) ctx.setLineDash(th.ink % 3 === 0 ? [] : th.ink % 3 === 1 ? [7, 3] : [2, 2.5]);
      trace(th.points);
      ctx.stroke();
      ctx.setLineDash([]);
      // Basting: long loose stitches toward where they mean to go.
      if (th.basting) {
        ctx.setLineDash([9, 7]);
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = faded ? 0.15 : 0.6;
        trace(th.basting);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    // Stitches: what was said, between speaker and listener.
    for (const s of layout.stitches) {
      if (s.kind === 'narration' || s.t < t0 || s.t > t1) continue;
      const sx = x(s.t);
      const sY = y(s.y);
      const lit = matches(s);
      const involved = !pulled || s.from === pulled || s.to.includes(pulled);
      ctx.globalAlpha = q.length > 1 && !lit ? 0.25 : involved ? 1 : 0.2;
      const th = layout.threads.find((t) => t.id === s.from);
      const colour = th ? ink(th.ink) : palette.inks.dark;
      if (s.kind === 'thought') {
        // A seed stitch on the thinker's own thread.
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sx - 2, sY - 4);
        ctx.lineTo(sx + 2, sY - 7);
        ctx.stroke();
        continue;
      }
      // Couched thread to each listener, then the stitch at the speaker.
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([1.5, 2]);
      for (const ty of s.toY) {
        ctx.beginPath();
        ctx.moveTo(sx, sY);
        ctx.lineTo(sx, y(ty));
        ctx.stroke();
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(sx, y(ty), 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.setLineDash([]);
      const r = lit ? 6 : 4;
      if (lit) {
        ctx.fillStyle = lineLook ? 'rgba(127,127,127,0.25)' : 'rgba(214, 170, 60, 0.45)';
        ctx.beginPath();
        ctx.arc(sx, sY, r + 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      if (s.motif === 'question') {
        ctx.arc(sx, sY, r * 0.8, 0, Math.PI * 2);
      } else if (s.motif === 'exclaim') {
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI;
          ctx.moveTo(sx - Math.cos(a) * r, sY - Math.sin(a) * r);
          ctx.lineTo(sx + Math.cos(a) * r, sY + Math.sin(a) * r);
        }
      } else {
        ctx.moveTo(sx - r, sY - r);
        ctx.lineTo(sx + r, sY + r);
        ctx.moveTo(sx + r, sY - r);
        ctx.lineTo(sx - r, sY + r);
        if (s.motif === 'long') {
          ctx.moveTo(sx - r, sY);
          ctx.lineTo(sx + r, sY);
        }
      }
      ctx.stroke();
      // Close in, the words themselves appear beside their stitch.
      if (pxPerSec > 9 && involved) {
        ctx.fillStyle = palette.inks.dark;
        ctx.font = '10px Georgia, serif';
        const words = s.text.split(/\s+/).slice(0, Math.min(14, Math.floor(pxPerSec / 2.5))).join(' ');
        ctx.fillText(words, sx + r + 3, sY - r - 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // The music lane.
    const musicLane = placed.find((p) => p.kind === 'music');
    if (musicLane) {
      const top = sy(musicLane.top);
      if (top < H && top + musicLane.h > TOP) {
        // Out of the cloth's clip, so its names can sit in the gutter; then back into it.
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, TOP, W, H - TOP);
        ctx.clip();
        const { spans, speech } = villageMusic.timeline();
        drawMusicLane({ ctx, x, t0, t1, top, h: musicLane.h, labelW: LABEL_W, W, palette, lineLook, spans, speech, phrases: score.phrases, events: score.events, selected: side.mode === 'phrase' ? phrase : null });
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(LABEL_W, TOP, W - LABEL_W, H - TOP);
        ctx.clip();
      }
    }

    // Cues: a pin stood in the cloth with a knot at its head; ones gone off are faded.
    const cueInk = lineLook ? palette.inks.dark : palette.inks.accent;
    const editing = side.mode === 'cue' ? side.id : null;
    for (const c of cues) {
      const cx = x(cueX(c));
      if (cx < LABEL_W - 10 || cx > W + 10) continue;
      const gone = c.firedAtSimMs !== undefined;
      ctx.globalAlpha = gone ? 0.4 : 1;
      ctx.strokeStyle = cueInk;
      ctx.lineWidth = editing === c.id ? 2 : 1.3;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, TOP + 4);
      ctx.lineTo(cx, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cueInk;
      ctx.beginPath();
      ctx.moveTo(cx, TOP - 4);
      ctx.lineTo(cx + 5, TOP + 2);
      ctx.lineTo(cx, TOP + 8);
      ctx.lineTo(cx - 5, TOP + 2);
      ctx.closePath();
      if (editing === c.id) {
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fill();
      ctx.font = '11px Georgia, serif';
      ctx.fillStyle = palette.inks.dark;
      const head = c.kind === 'message' ? `${KIND_MARK.message} ${recipientName(c.to)}` : c.kind === 'music' ? `${KIND_MARK.music} music` : KIND_MARK.note;
      const label = `${head}${c.text ? `: ${c.text}` : ''}`;
      // Beside the pin, on whichever side has room.
      const right = W - cx - 14;
      const leftRoom = cx - LABEL_W - 14;
      const onLeft = right < 140 && leftRoom > right;
      const room = Math.max(40, Math.min(220, onLeft ? leftRoom : right));
      let shownLabel = label;
      while (shownLabel.length > 4 && ctx.measureText(shownLabel).width > room) shownLabel = `${shownLabel.slice(0, -2)}…`;
      ctx.textAlign = onLeft ? 'right' : 'left';
      ctx.fillText(shownLabel, onLeft ? cx - 8 : cx + 8, TOP + 20);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    // The needle at now.
    ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nowX, TOP - 2);
    ctx.lineTo(nowX, H);
    ctx.stroke();
    if (isStopped(sim)) {
      ctx.font = 'italic 10px Georgia, serif';
      ctx.fillStyle = palette.inks.dark;
      ctx.globalAlpha = 0.75;
      ctx.fillText('held', nowX + 6, TOP + 10);
      ctx.globalAlpha = 1;
    }
    // The hover needle.
    if (hoverX.current !== null && hoverX.current > LABEL_W) {
      ctx.strokeStyle = palette.inks.dark;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX.current, TOP);
      ctx.lineTo(hoverX.current, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // The needles' heads sit on the ruler, above the lanes.
    ctx.fillStyle = lineLook ? palette.inks.dark : palette.inks.gold;
    if (nowX >= LABEL_W) {
      ctx.beginPath();
      ctx.arc(nowX, TOP - 3, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // The probe: a second needle with a square head, and how long before now it is.
    if (probe !== null) {
      const px = x(probe);
      if (px >= LABEL_W && px <= W) {
        const probeInk = lineLook ? palette.inks.dark : palette.inks.accent2 ?? palette.inks.primary;
        ctx.strokeStyle = probeInk;
        ctx.fillStyle = probeInk;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(px, TOP - 6);
        ctx.lineTo(px, H);
        ctx.stroke();
        ctx.fillRect(px - 4.5, TOP - 13, 9, 9);
        ctx.font = '10px Georgia, serif';
        const label = markLabel(probe, layout.now);
        const lw = ctx.measureText(label).width;
        const lx = px + 8 + lw > W ? px - 8 - lw : px + 8;
        ctx.fillStyle = lineLook ? palette.ground : 'rgba(250, 245, 235, 0.9)';
        ctx.fillRect(lx - 2, TOP - 15, lw + 4, 12);
        ctx.fillStyle = probeInk;
        ctx.fillText(label, lx, TOP - 6);
      }
    }
    // Lanes scrolled out of view: a hint along the right edge.
    if (g.total > g.viewH) {
      const frac = g.viewH / g.total;
      const at = rows.current.scroll / g.total;
      ctx.fillStyle = palette.inks.dark;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(W - 4, TOP + at * g.viewH, 3, Math.max(12, frac * g.viewH));
      ctx.globalAlpha = 1;
    }
  }, [frame, layout, look, pulled, q, showMusic, span, cues, side, clockState, simNow, focus, probe, phrase, spinnerItems.length, opened]);

  // Wheel and trackpad: over the cloth, up and down (or a pinch) zooms time about the pointer and
  // sideways pans it; over the lane names, up and down scrolls the lanes; with Alt (Option), the
  // lanes grow or shrink. A native listener, so the page itself does not scroll or zoom.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const { tOf, W, labelW } = geom();
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (e.altKey) {
      zoomLanes(Math.exp(-e.deltaY * 0.004), py);
      return;
    }
    if (px < labelW && py >= TOP) {
      scrollLanes(e.deltaY);
      return;
    }
    const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY) || (e.shiftKey && !e.ctrlKey);
    if (sideways) {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const v = view.current!;
      panBy((d / (W - labelW - RIGHT_PAD)) * (v.t1 - v.t0));
      return;
    }
    zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), tOf(px));
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const pendingCueAt = (px: number, py: number): ScheduledCue | null => {
    const { x } = geom();
    let best: { c: ScheduledCue; d: number } | null = null;
    for (const c of cues) {
      const dx = Math.abs(x(cueX(c)) - px);
      const near = py < TOP + 26 ? dx < 9 : dx < 5;
      if (near && (!best || dx < best.d)) best = { c, d: dx };
    }
    return best?.c ?? null;
  };

  const nearProbeHead = (px: number, py: number) => {
    if (probe === null || py > TOP + 2) return false;
    return Math.abs(geom().x(probe) - px) < 8;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const g = geom();
    if (nearProbeHead(px, py)) {
      drag.current = { kind: 'probe', x: e.clientX, moved: false };
      return;
    }
    if (px < g.labelW && py >= TOP) {
      drag.current = { kind: 'rows', y: e.clientY, scroll: rows.current.scroll, moved: false };
      return;
    }
    const cue = pendingCueAt(px, py);
    if (cue) {
      drag.current = { kind: 'cue', id: cue.id, x: e.clientX, moved: false };
      return;
    }
    if (spanMode || e.shiftKey || py < RULER_H) {
      drag.current = { kind: 'span', x: e.clientX, from: g.tOf(px), moved: false, onRuler: py < RULER_H };
      return;
    }
    drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, t0: view.current!.t0, t1: view.current!.t1, scroll: rows.current.scroll, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    hoverX.current = px;
    const d = drag.current;
    const canvas = canvasRef.current!;
    const g = geom();
    if (!d) {
      const cue = pendingCueAt(px, py);
      canvas.style.cursor = nearProbeHead(px, py)
        ? 'ew-resize'
        : px < g.labelW && py >= TOP
          ? 'ns-resize'
          : cue
            ? cue.firedAtSimMs === undefined
              ? 'ew-resize'
              : 'pointer'
            : spanMode || e.shiftKey || py < RULER_H
              ? 'text'
              : 'grab';
    }
    if (d) {
      const dx = e.clientX - (d.kind === 'rows' ? e.clientX : d.x);
      const dy = d.kind === 'rows' || d.kind === 'pan' ? e.clientY - d.y : 0;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
      if (d.kind === 'pan') {
        if (d.moved && Math.abs(dx) > 3) setFollowNow(false);
        const dt = (dx / (g.W - g.labelW - RIGHT_PAD)) * (d.t1 - d.t0);
        view.current = { t0: d.t0 - dt, t1: d.t1 - dt };
        rows.current.scroll = d.scroll - dy;
      } else if (d.kind === 'rows') {
        rows.current.scroll = d.scroll - dy;
      } else if (d.kind === 'probe') {
        setProbe(Math.min(Date.now(), g.tOf(px)));
      } else if (d.kind === 'span' && d.moved) {
        const t = g.tOf(px);
        setSpan({ t0: Math.min(d.from, t), t1: Math.max(d.from, t) });
      } else if (d.kind === 'cue' && d.moved) {
        const c = schedule.get(d.id);
        if (c && c.firedAtSimMs === undefined) {
          const at = Math.max(sim.simTimeMs + 1000, wallToSimTime(g.tOf(px), sim.simTimeMs, Date.now()));
          schedule.update(d.id, { atSimMs: at }, sim.simTimeMs);
        }
      }
    }
    redraw();
  };

  const openCue = (c: ScheduledCue | null, atSimMs: number) => {
    setSide({ mode: 'cue', id: c?.id ?? null, atSimMs });
    setForm({
      kind: c?.kind ?? 'message',
      to: c?.to ?? 'narrator',
      text: c?.text ?? '',
      when: describeOffset(atSimMs - sim.simTimeMs).replace(/^in /, '').replace(/ ago$/, ''),
      whenEdited: !c,
      hold: String(c?.holdSeconds ?? DEFAULT_BREAK_SECONDS),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const g = geom();
    if (d.kind === 'probe') {
      setSide({ mode: 'probe' });
      return;
    }
    if (d.kind === 'rows') {
      if (!d.moved) {
        const tr = g.trackUnder(py);
        if (tr) toggleFocus(tr.id);
      }
      return;
    }
    if (d.kind === 'cue') {
      const c = schedule.get(d.id);
      if (c && (!d.moved || side.mode === 'cue')) openCue(c, c.atSimMs);
      return;
    }
    if (d.kind === 'span') {
      if (!d.moved) {
        // A click on the ruler sets the probe there; elsewhere it lets the span go.
        if (d.onRuler && px >= g.labelW) placeProbe(Math.min(Date.now(), g.tOf(px)));
        else {
          setSpan(null);
          if (side.mode === 'span') setSide({ mode: 'moment' });
        }
      } else {
        setSide({ mode: 'span' });
      }
      return;
    }
    if (d.moved) return;
    const { x, y, tOf } = g;
    const tr = g.trackUnder(py);
    const t = tOf(px);
    if (tr?.kind === 'scribe') {
      const hit = layout.stitches.filter((s) => s.kind === 'narration').map((s) => ({ s, d: Math.abs(x(s.t) - px) })).sort((a, b) => a.d - b.d)[0];
      if (hit && hit.d < 10) {
        setOpened(hit.s);
        setSide({ mode: 'moment' });
      }
      return;
    }
    if (tr?.kind === 'spinner') {
      const hit = spinnerItems.map((it) => ({ it, d: Math.abs(x(it.t) - px) })).sort((a, b) => a.d - b.d)[0];
      if (hit && hit.d < 10) setSide({ mode: 'spinner', t: hit.it.t });
      return;
    }
    if (tr?.kind === 'music') {
      if (tr.h < MUSIC_ROLL_MIN) {
        toggleFocus(tr.id);
        return;
      }
      const p = phraseAt(score.phrases, t);
      if (p) {
        setPhrase(p);
        setSide({ mode: 'phrase' });
      }
      return;
    }
    // A stitch under the pointer opens the moment; else a thread near it is pulled out.
    const hit = layout.stitches
      .filter((s) => s.kind !== 'narration')
      .map((s) => ({ s, d: Math.hypot(x(s.t) - px, y(s.y) - py) }))
      .sort((a, b) => a.d - b.d)[0];
    if (hit && hit.d < 9) {
      setOpened(hit.s);
      setSide({ mode: 'moment' });
      return;
    }
    let best: { id: string; d: number } | null = null;
    for (const th of layout.threads) {
      const p = th.points.filter((pt) => pt.t <= t).pop() ?? th.points[0];
      if (!p) continue;
      const dist = Math.abs(y(p.y) - py);
      if (dist < 8 && (!best || dist < best.d)) best = { id: th.id, d: dist };
    }
    setPulled(best && best.id !== pulled ? best.id : null);
  };

  // A double-click ahead of the needle places a cue there; on a lane's name, it zooms that lane.
  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const g = geom();
    const px = e.clientX - rect.left;
    if (px < g.labelW) return;
    const t = g.tOf(px);
    if (t <= Date.now() + 500) return;
    openCue(null, wallToSimTime(t, sim.simTimeMs, Date.now()));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName !== 'DIV') return;
    const v = view.current!;
    const k = e.key;
    if (k === '+' || k === '=') zoomBy(1 / 1.4);
    else if (k === '-' || k === '_') zoomBy(1.4);
    else if (k === ']') zoomLanes(1.25);
    else if (k === '[') zoomLanes(0.8);
    else if (k === '0' || k === 'f') fitAll();
    else if (k === 'ArrowLeft') panBy(-(v.t1 - v.t0) * 0.15);
    else if (k === 'ArrowRight') panBy((v.t1 - v.t0) * 0.15);
    else if (k === 'ArrowUp') scrollLanes(-60);
    else if (k === 'ArrowDown') scrollLanes(60);
    else if (k === 'p') placeProbe(Math.min(Date.now(), hoverX.current !== null ? geom().tOf(hoverX.current) : (v.t0 + v.t1) / 2));
    else if (k === ' ') togglePause(sim);
    else if (k === 'Escape') {
      if (span || spanMode) {
        setSpan(null);
        setSpanMode(false);
      } else if (probe !== null) {
        setProbe(null);
        if (side.mode === 'probe') setSide({ mode: 'moment' });
      }
    } else return;
    e.preventDefault();
  };

  // The probed moment, read from the records.
  const probed = useMemo(() => (probe === null ? null : momentAt(momentSourcesFor(sim), probe)), [probe, sim, tick]);

  // The moment a stitch opens onto: its whole conversation, in order.
  const moment = useMemo(() => {
    if (!opened) return [];
    if (!opened.conversationId) return [opened];
    return layout.stitches.filter((s) => s.conversationId === opened.conversationId);
  }, [opened, layout]);

  // What happened in a selected span.
  const inSpan = useMemo(() => (span ? layout.stitches.filter((s) => s.t >= span.t0 && s.t <= span.t1) : []), [span, layout]);
  const cuesInSpan = span ? cues.filter((c) => cueX(c) >= span.t0 && cueX(c) <= span.t1) : [];

  const speedNow = effectiveSpeed(sim);
  const speedValue = String(SPEED_LOG_MARKS.reduce((best, m) => (Math.abs(m.value - speedNow) < Math.abs(best - speedNow) ? m.value : best), 1));
  const stopped = isStopped(sim);
  const pending = cues.filter((c) => c.firedAtSimMs === undefined);
  const gone = cues.filter((c) => c.firedAtSimMs !== undefined).slice(-5).reverse();

  const castOptions = [
    { value: 'narrator', label: names.get('narrator') ?? 'Scribe' },
    { value: 'all', label: 'Everyone' },
    ...[...sim.configs.values()].map((c) => ({ value: c.id, label: c.name })),
  ];

  const saveCue = () => {
    if (!form || side.mode !== 'cue') return;
    const delay = form.whenEdited ? parseDelay(form.when) : null;
    const atSimMs = delay !== null ? sim.simTimeMs + delay : side.id ? (schedule.get(side.id)?.atSimMs ?? side.atSimMs) : side.atSimMs;
    const draft = {
      kind: form.kind,
      atSimMs,
      text: form.text,
      to: form.kind === 'message' ? form.to : undefined,
      holdSeconds: form.kind === 'music' ? Number(form.hold) || DEFAULT_BREAK_SECONDS : undefined,
    };
    if (side.id) schedule.update(side.id, draft, sim.simTimeMs);
    else {
      const made = schedule.add(draft);
      setSide({ mode: 'cue', id: made.id, atSimMs: made.atSimMs });
      setForm({ ...form, whenEdited: false });
    }
    // Bring it into view if it lies beyond the right edge.
    const v = view.current!;
    const wallAt = cueWallTime({ atSimMs }, sim.simTimeMs, Date.now());
    if (wallAt > v.t1 - (v.t1 - v.t0) * 0.05) {
      const t1 = wallAt + (v.t1 - v.t0) * 0.15;
      if (followNow) {
        const t0 = Math.min(v.t0, layout.now - 60_000);
        view.current = { t0, t1 };
        nowFrac.current = (layout.now - t0) / (t1 - t0);
      } else view.current = { t0: v.t0 + (t1 - v.t1), t1 };
    }
    redraw();
  };

  const editingCue = side.mode === 'cue' && side.id ? schedule.get(side.id) : undefined;
  const formDelay = form ? parseDelay(form.when) : null;
  const canSave = !!form && (form.kind !== 'message' || form.text.trim().length > 0) && (formDelay !== null || (side.mode === 'cue' && !!side.id));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-ink lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
        <StitchPanel className="relative z-20 flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-2 text-xs">
          <span className="font-display text-sm">The Loom</span>
          <KnotDivider className="mx-1 h-5" />
          {(
            [
              ['place', 'By place', 'Places are bands across the cloth; a thread lies where its character was'],
              ['character', 'By character', 'Each character a row; threads draw together while they talk'],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              title={hint}
              aria-pressed={arrangement === id}
              onClick={() => setArrangement(id)}
              className={`glyph-button whitespace-nowrap rounded-sm px-1.5 py-0.5 ${arrangement === id ? 'glyph-on' : ''}`}
            >
              {label}
            </button>
          ))}
          <KnotDivider className="mx-1 h-5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find words or a name…"
            aria-label="Find words or a name"
            className="w-36 min-w-[6rem] flex-shrink rounded-sm border border-borderFolk bg-transparent px-1.5 py-0.5"
          />
          <span className="flex-1" />
          {pulled && (
            <button type="button" className="glyph-button whitespace-nowrap rounded-sm px-1.5 py-0.5" onClick={() => setPulled(null)}>
              Let go of {names.get(pulled)}
            </button>
          )}
          <span className="inline-flex items-center gap-0.5" role="group" aria-label="The world clock">
            <GlyphButton
              glyph={stopped ? 'play' : 'pause'}
              label={stopped ? 'Resume the world (space)' : 'Pause the world (space)'}
              onClick={() => togglePause(sim)}
            />
            <StitchSelect
              value={speedValue}
              onChange={(v) => setSpeed(sim, Number(v))}
              label="How fast the world runs: negative winds back, 0 pauses"
              className="font-semibold"
              options={[...SPEED_LOG_MARKS].reverse().map((m) => ({ value: String(m.value), label: m.value === 0 ? 'Pause' : `${m.label}×` }))}
            />
          </span>
          <KnotDivider className="mx-0.5 h-5" />
          <span className="inline-flex items-center gap-0.5" role="group" aria-label="Moving through time">
            <GlyphButton glyph="zoomOut" label="Zoom out (−)" onClick={() => zoomBy(1.6)} />
            <GlyphButton glyph="zoomIn" label="Zoom in (+)" onClick={() => zoomBy(1 / 1.6)} />
            <GlyphButton glyph="wholeMap" label="The whole cloth, and what is ahead (0)" onClick={fitAll} />
            <GlyphButton glyph="follow" label="Keep now in view" pressed={followNow} dimOff onClick={() => setFollowNow((f) => !f)} tipSide="below-left" />
            <GlyphButton glyph="span" label="Select a span of time (or shift-drag, or drag the ruler)" pressed={spanMode} dimOff onClick={() => setSpanMode((m) => !m)} tipSide="below-left" />
          </span>
          <KnotDivider className="mx-0.5 h-5" />
          <GlyphButton
            glyph="schedule"
            label="Place a cue ahead of now (or double-click the cloth ahead of the needle)"
            pressed={side.mode === 'cue' && !side.id}
            onClick={() => openCue(null, sim.simTimeMs + 60_000)}
            tipSide="below-left"
          />
          <GlyphButton glyph="music" label="Show the music lane (click its name to open the piano roll)" pressed={showMusic} dimOff onClick={toggleMusic} tipSide="below-left" />
          <KnotDivider className="mx-0.5 h-5" />
          <span className="inline-flex items-center gap-0.5" role="group" aria-label="The lanes">
            <GlyphButton glyph="rowsShorter" label="Shorter lanes ([, or Alt-scroll)" onClick={() => zoomLanes(0.8)} tipSide="below-left" />
            <GlyphButton glyph="rowsTaller" label="Taller lanes (], or Alt-scroll)" onClick={() => zoomLanes(1.25)} tipSide="below-left" />
          </span>
          <GlyphButton
            glyph="probe"
            label={probe === null ? 'Set the probe: a second needle to look back at a moment (or click the ruler, or P)' : 'Take the probe away (Escape)'}
            pressed={probe !== null}
            onClick={() => {
              if (probe === null) {
                const v = view.current!;
                placeProbe(Math.min(Date.now() - 1000, (v.t0 + v.t1) / 2));
              } else {
                setProbe(null);
                if (side.mode === 'probe') setSide({ mode: 'moment' });
              }
            }}
            tipSide="below-left"
          />
          {onToggleWeb && <GlyphButton glyph="web" label={webBeside ? 'Hide Psychohistory' : 'Psychohistory beside the Loom, at the probe'} pressed={webBeside} onClick={onToggleWeb} tipSide="below-left" />}
        </StitchPanel>
        <div
          ref={wrapRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label="The Loom: the world's history as cloth"
          className="relative min-h-[160px] flex-1 overflow-hidden rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-sage"
        >
          <canvas
            ref={canvasRef}
            className="cursor-grab touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
            onDoubleClick={onDoubleClick}
            onPointerLeave={() => {
              hoverX.current = null;
              redraw();
            }}
          />
          {span && <SpanBar span={span} geom={geom} count={inSpan.length} onZoom={zoomToSpan} onShow={() => setSide({ mode: 'span' })} onClear={() => setSpan(null)} />}
        </div>
        <div className={`stitch-muted px-1 text-[10px] leading-snug ${webBeside ? 'hidden' : ''}`}>
          Scroll or pinch to zoom through time, swipe sideways or drag to move along it (dragging also moves the lanes up and down); over the lane names, scroll moves the lanes, Alt-scroll makes them taller or shorter, and a click zooms one lane on its own (the music opens into a piano roll: click a phrase for its notes). Click the ruler to set the probe, a second needle for looking back; drag the ruler to select a span. Click a thread to pull it out, a stitch to open the moment. Double-click ahead of now to place a cue. ✕ a plain line, ○ a question, ✳ an exclamation, a barred ✕ a long speech.
        </div>
      </div>
      <StitchPanel className="flex max-h-[45%] min-h-0 w-full shrink-0 flex-col gap-2 overflow-hidden p-3 text-xs lg:max-h-none lg:w-72">
        {side.mode === 'probe' && probed ? (
          <ProbePanel
            moment={probed}
            now={layout.now}
            settings={sim.modelSettings}
            onClear={() => {
              setProbe(null);
              setSide({ mode: 'moment' });
            }}
            onFocusMusic={() => {
              if (focus !== 'lane:music') toggleFocus('lane:music');
              const v = view.current!;
              const w = Math.min(v.t1 - v.t0, 40_000);
              setFollowNow(false);
              view.current = { t0: probed.t - w / 2, t1: probed.t + w / 2 };
              redraw();
            }}
          />
        ) : side.mode === 'phrase' && phrase ? (
          <PhrasePanel phrase={phrase} events={score.events} now={layout.now} settings={sim.modelSettings} onClose={() => setSide({ mode: probe !== null ? 'probe' : 'moment' })} />
        ) : side.mode === 'spinner' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto thin-scroll">
            <div className="font-display text-sm">Spinner</div>
            {spinnerItems
              .filter((it) => Math.abs(it.t - side.t) < 20_000)
              .map((it, k) => (
                <div key={k} className={`leading-snug ${it.t === side.t ? '' : 'opacity-60'}`}>
                  <span className="stitch-muted">{it.kind === 'user' ? 'asked' : it.kind === 'pi' ? 'said' : it.kind === 'tool' ? 'did' : 'note'} · {ago(layout.now - it.t)}</span>
                  <div className={it.kind === 'tool' ? 'font-mono text-[10px]' : ''}>{it.text}</div>
                </div>
              ))}
          </div>
        ) : side.mode === 'cue' && form ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto thin-scroll">
            <div className="font-display text-sm">{editingCue ? (editingCue.firedAtSimMs !== undefined ? 'A cue that went off' : 'A cue ahead') : 'Place a cue ahead'}</div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="What kind of cue">
              {CUE_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={form.kind === k.id}
                  title={k.hint}
                  onClick={() => setForm({ ...form, kind: k.id })}
                  className={`glyph-button whitespace-nowrap rounded-sm px-1.5 py-0.5 ${form.kind === k.id ? 'glyph-on' : ''}`}
                >
                  {KIND_MARK[k.id]} {k.label}
                </button>
              ))}
            </div>
            <div className="stitch-muted leading-snug">{CUE_KINDS.find((k) => k.id === form.kind)?.hint}</div>
            {form.kind === 'message' && (
              <label className="flex items-center gap-1.5">
                <span className="stitch-muted">To</span>
                <StitchSelect value={form.to} onChange={(v) => setForm({ ...form, to: v })} label="Who the message is for" options={castOptions} tipSide="below-right" />
              </label>
            )}
            <textarea
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              rows={3}
              aria-label="The words"
              placeholder={
                form.kind === 'message'
                  ? 'A stage direction or a turn in the story, e.g. “a storm rolls in from the hills”'
                  : form.kind === 'music'
                    ? 'What the break is for (optional), e.g. “a wedding horo”'
                    : 'A note to yourself'
              }
              className="w-full resize-y rounded-sm border border-borderFolk bg-transparent px-1.5 py-1"
            />
            <label className="flex flex-wrap items-center gap-1.5">
              <span className="stitch-muted">In</span>
              <input
                value={form.when}
                onChange={(e) => setForm({ ...form, when: e.target.value, whenEdited: true })}
                aria-label="How long from now, in world time"
                className="w-20 rounded-sm border border-borderFolk bg-transparent px-1.5 py-0.5"
              />
              {[
                ['30s', 30_000],
                ['1m', 60_000],
                ['5m', 300_000],
              ].map(([l, ms]) => (
                <button key={l} type="button" className="glyph-button rounded-sm px-1 py-0.5" onClick={() => setForm({ ...form, when: describeOffset(Number(ms)).replace(/^in /, ''), whenEdited: true })}>
                  {l}
                </button>
              ))}
            </label>
            <div className="stitch-muted leading-snug">
              {editingCue && !form.whenEdited
                ? editingCue.firedAtSimMs !== undefined
                  ? 'It has gone off. Give it a new time to set it again.'
                  : `Goes off ${describeOffset(editingCue.atSimMs - simNow)} of world time. Drag its pin on the cloth, or give a new time, to move it.`
                : formDelay === null
                  ? 'Say how long, e.g. 45s, 2m, 1:30.'
                  : `Goes off ${describeOffset(formDelay)} of world time: it waits while the world is paused and comes sooner when it runs fast.`}
            </div>
            {form.kind === 'music' && (
              <label className="flex items-center gap-1.5">
                <span className="stitch-muted">For</span>
                <input
                  value={form.hold}
                  onChange={(e) => setForm({ ...form, hold: e.target.value })}
                  inputMode="numeric"
                  aria-label="How long the break lasts, in seconds"
                  className="w-14 rounded-sm border border-borderFolk bg-transparent px-1.5 py-0.5"
                />
                <span className="stitch-muted">seconds</span>
              </label>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button type="button" disabled={!canSave} onClick={saveCue} className="stitch-panel px-2 py-1 font-semibold disabled:opacity-40">
                {editingCue ? 'Save' : 'Place on the cloth'}
              </button>
              {editingCue && (
                <button
                  type="button"
                  className="glyph-button rounded-sm px-2 py-1"
                  onClick={() => {
                    schedule.remove(editingCue.id);
                    setSide({ mode: 'moment' });
                  }}
                >
                  Remove
                </button>
              )}
              <button type="button" className="glyph-button rounded-sm px-2 py-1" onClick={() => setSide({ mode: 'moment' })}>
                {editingCue ? 'Close' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : side.mode === 'span' && span ? (
          <>
            <div className="font-display text-sm">A span</div>
            <div className="stitch-muted">
              {markLabel(span.t0, layout.now)} to {markLabel(span.t1, layout.now)} · {inSpan.length} {inSpan.length === 1 ? 'stitch' : 'stitches'}
              {cuesInSpan.length ? ` · ${cuesInSpan.length} ${cuesInSpan.length === 1 ? 'cue' : 'cues'}` : ''}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={zoomToSpan}>
                Zoom to it
              </button>
              <button
                type="button"
                className="glyph-button rounded-sm px-1.5 py-0.5"
                onClick={() => {
                  setSpan(null);
                  setSide({ mode: 'moment' });
                }}
              >
                Clear
              </button>
            </div>
            <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto thin-scroll">
              {cuesInSpan.map((c) => (
                <li key={c.id}>
                  <button type="button" className="text-left" onClick={() => openCue(c, c.atSimMs)}>
                    <span className="stitch-thread">{KIND_MARK[c.kind]} </span>
                    {c.text || (c.kind === 'music' ? 'A musical break' : 'A cue')}
                  </button>
                </li>
              ))}
              {inSpan.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => {
                      setOpened(s);
                      setSide({ mode: 'moment' });
                    }}
                  >
                    <span className="font-semibold">{names.get(s.from) ?? s.from}</span>
                    <span className="stitch-muted"> · {ago(layout.now - s.t)}</span>
                    <div className="leading-snug">{s.text}</div>
                  </button>
                </li>
              ))}
              {inSpan.length === 0 && cuesInSpan.length === 0 && <li className="stitch-muted">Nothing was said in this span.</li>}
            </ol>
          </>
        ) : (
          <>
            <div className="font-display text-sm">The moment</div>
            {opened ? (
              <>
                <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto thin-scroll">
                  {moment.map((s) => (
                    <li key={s.id} className={s.id === opened.id ? 'stitch-thread' : ''}>
                      <span className="font-semibold">{names.get(s.from) ?? s.from}</span>
                      <span className="stitch-muted"> · {ago(layout.now - s.t)}</span>
                      <div className="leading-snug">{s.text}</div>
                    </li>
                  ))}
                </ol>
                <button type="button" className="stitch-panel px-2 py-1 text-left" onClick={() => onJumpToVillage(opened.from === 'narrator' ? undefined : opened.from)}>
                  Go to {names.get(opened.from) ?? 'the village'} in the village
                </button>
              </>
            ) : (
              <span className="stitch-muted leading-snug">Click a stitch to read what was said there, with the rest of that conversation.</span>
            )}
            <BandRulesList />
          </>
        )}
        {side.mode !== 'cue' && side.mode !== 'probe' && side.mode !== 'phrase' && (pending.length > 0 || gone.length > 0) && (
          <div className="flex max-h-[45%] shrink-0 flex-col gap-1 border-t border-dashed border-borderFolk pt-2">
            <div className="font-display text-sm">Ahead</div>
            <ol className="min-h-0 space-y-1 overflow-y-auto thin-scroll">
              {pending.map((c) => (
                <CueRow key={c.id} cue={c} offset={c.atSimMs - simNow} who={recipientName(c.to)} onOpen={() => openCue(c, c.atSimMs)} onRemove={() => schedule.remove(c.id)} />
              ))}
              {gone.map((c) => (
                <CueRow key={c.id} cue={c} offset={(c.firedAtWall ?? layout.now) - layout.now} who={recipientName(c.to)} onOpen={() => openCue(c, c.atSimMs)} onRemove={() => schedule.remove(c.id)} />
              ))}
            </ol>
          </div>
        )}
      </StitchPanel>
    </div>
  );
}

function CueRow({ cue, offset, who, onOpen, onRemove }: { cue: ScheduledCue; offset: number; who: string; onOpen: () => void; onRemove: () => void }) {
  const gone = cue.firedAtSimMs !== undefined;
  return (
    <li className={`flex items-start gap-1 ${gone ? 'opacity-50' : ''}`}>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="stitch-thread">{KIND_MARK[cue.kind]} </span>
        <span className="stitch-muted">{describeOffset(offset)}</span>
        {cue.kind === 'message' && <span className="stitch-muted"> · to {who}</span>}
        <div className="truncate leading-snug">{cue.text || (cue.kind === 'music' ? `A musical break, ${cue.holdSeconds}s` : 'A note')}</div>
      </button>
      <button type="button" aria-label="Remove this cue" title="Remove" className="glyph-button rounded-sm px-1 leading-none" onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

/** The little bar over a selected span: zoom to it, read it, or let it go. Kept inside the loom. */
function SpanBar({
  span,
  geom,
  count,
  onZoom,
  onShow,
  onClear,
}: {
  span: { t0: number; t1: number };
  geom: () => { W: number; x: (t: number) => number; labelW: number };
  count: number;
  onZoom: () => void;
  onShow: () => void;
  onClear: () => void;
}) {
  const { W, x, labelW } = geom();
  const BAR_W = 230;
  const mid = (Math.max(labelW, x(span.t0)) + Math.min(W, x(span.t1))) / 2;
  const left = Math.max(4, Math.min(W - BAR_W - 4, mid - BAR_W / 2));
  return (
    <div className="stitch-panel absolute z-10 flex items-center gap-1 px-2 py-1 text-[11px]" style={{ position: 'absolute', left, top: TOP + 6, width: BAR_W }} role="toolbar" aria-label="The selected span">
      <button type="button" className="glyph-button rounded-sm px-1 py-0.5" onClick={onZoom}>
        Zoom to it
      </button>
      <button type="button" className="glyph-button rounded-sm px-1 py-0.5" onClick={onShow}>
        What happened ({count})
      </button>
      <span className="flex-1" />
      <button type="button" aria-label="Clear the span" className="glyph-button rounded-sm px-1 py-0.5" onClick={onClear}>
        ×
      </button>
    </div>
  );
}
