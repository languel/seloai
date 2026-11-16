import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PALETTES, paintLinen, type PaletteName } from '../art/looks';
import type { Ink } from '../art/shapes';
import type { VillageSimulation } from '../engine/simulation';
import { layoutLoom, loomInputFor, worldlineRecorderFor, type LoomArrangement, type LoomLayout, type LoomStitch } from '../engine/worldlines';
import { GlyphButton } from './Glyph';
import { KnotDivider, StitchPanel } from './Stitch';

interface LoomViewProps {
  sim: VillageSimulation;
  look: PaletteName;
  onJumpToVillage: (villagerId?: string) => void;
}

const THREAD_INKS: Ink[] = ['primary', 'secondary', 'accent', 'accent2', 'gold', 'dark'];
const LABEL_W = 132;
const TOP = 26;
const BOTTOM = 10;

function ago(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/**
 * The Loom: the world's whole history as a piece of weaving. Threads are characters, bands
 * are places, stitches are what was said. Scroll to zoom through time, drag to move along
 * it, click a thread to pull it out, click a stitch to open the moment.
 */
export default function LoomView({ sim, look, onJumpToVillage }: LoomViewProps) {
  const recorder = useMemo(() => worldlineRecorderFor(sim), [sim]);
  const [arrangement, setArrangement] = useState<LoomArrangement>('place');
  const [query, setQuery] = useState('');
  const [pulled, setPulled] = useState<string | null>(null);
  const [opened, setOpened] = useState<LoomStitch | null>(null);
  const [followNow, setFollowNow] = useState(true);
  const [tick, setTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The visible stretch of time, as [start, end] timestamps.
  const view = useRef<{ t0: number; t1: number } | null>(null);
  const drag = useRef<{ x: number; t0: number; t1: number; moved: boolean } | null>(null);
  const hoverX = useRef<number | null>(null);
  const [frame, setFrame] = useState(0);
  const redraw = () => setFrame((f) => f + 1);

  // The cloth grows as the world goes on; re-lay it about once a second.
  useEffect(() => {
    let last = 0;
    return sim.subscribe(() => {
      const t = performance.now();
      if (t - last > 900) {
        last = t;
        setTick((n) => n + 1);
      }
    });
  }, [sim]);

  const layout: LoomLayout = useMemo(() => layoutLoom(loomInputFor(sim, recorder, arrangement)), [sim, recorder, arrangement, tick]);
  const names = useMemo(() => new Map([...sim.configs.values()].map((c) => [c.id, c.name])), [sim, tick]);
  names.set('narrator', sim.modelSettings.narratorName || 'Scribe');
  names.set(sim.player.id, sim.player.name);

  // Keep the window on "now" while following, else leave it where the viewer put it.
  if (!view.current) view.current = { t0: layout.now - 3 * 60_000, t1: layout.now + 30_000 };
  if (followNow && view.current) {
    const span = view.current.t1 - view.current.t0;
    view.current = { t0: layout.now + 30_000 - span, t1: layout.now + 30_000 };
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

  // Geometry helpers shared by drawing and hit-testing.
  const geom = () => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    const W = canvas.width / ratio;
    const H = canvas.height / ratio;
    const { t0, t1 } = view.current!;
    const x = (t: number) => LABEL_W + ((t - t0) / (t1 - t0)) * (W - LABEL_W - 8);
    const tOf = (px: number) => t0 + ((px - LABEL_W) / (W - LABEL_W - 8)) * (t1 - t0);
    const y = (v: number) => TOP + v * (H - TOP - BOTTOM);
    return { W, H, x, y, tOf, ratio };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view.current) return;
    const ctx = canvas.getContext('2d')!;
    const { W, H, x, y, ratio } = geom();
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

    // Bands: faint alternating cloth, with a running stitch between them.
    ctx.font = '11px Georgia, serif';
    layout.bands.forEach((b, i) => {
      if (i % 2) {
        ctx.fillStyle = lineLook ? 'rgba(127,127,127,0.06)' : 'rgba(120, 90, 50, 0.06)';
        ctx.fillRect(LABEL_W, y(b.y0), W - LABEL_W, y(b.y1) - y(b.y0));
      }
      ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.secondary;
      ctx.globalAlpha = 0.28;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(LABEL_W, y(b.y0));
      ctx.lineTo(W, y(b.y0));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = palette.inks.dark;
      const label = b.label.length > 20 ? `${b.label.slice(0, 19)}…` : b.label;
      ctx.fillText(label, 8, (y(b.y0) + y(b.y1)) / 2 + 4);
      ctx.globalAlpha = 1;
    });

    // Time marks along the top, in minutes before now.
    const span = t1 - t0;
    const STEPS = [10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000];
    const stepMs = STEPS.find((st) => span / st < 9) ?? STEPS[STEPS.length - 1];
    ctx.fillStyle = palette.inks.dark;
    ctx.globalAlpha = 0.6;
    ctx.font = '10px Georgia, serif';
    let lastLabel = -Infinity;
    for (let t = layout.now - Math.ceil((layout.now - t0) / stepMs) * stepMs; t <= t1; t += stepMs) {
      const px = x(t);
      if (px < LABEL_W) continue;
      ctx.fillRect(px, TOP - 6, 1, 4);
      // A label only where it has room, so marks never print over each other.
      if (px - lastLabel < 56) continue;
      ctx.fillText(t === layout.now ? 'now' : ago(layout.now - t), px + 3, TOP - 9);
      lastLabel = px;
    }
    ctx.globalAlpha = 1;

    // The future: a little paler, past the needle.
    const nowX = x(layout.now);
    ctx.fillStyle = lineLook ? 'rgba(127,127,127,0.07)' : 'rgba(255,255,255,0.22)';
    ctx.fillRect(Math.max(LABEL_W, nowX), TOP, W - Math.max(LABEL_W, nowX), H - TOP);

    ctx.save();
    ctx.beginPath();
    ctx.rect(LABEL_W, 0, W - LABEL_W, H);
    ctx.clip();

    // Narration: gold laid across the whole width.
    for (const s of layout.stitches) {
      if (s.kind !== 'narration' || s.t < t0 || s.t > t1) continue;
      ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.gold;
      ctx.globalAlpha = matches(s) ? 0.9 : 0.35;
      ctx.lineWidth = matches(s) ? 2.2 : 1.2;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x(s.t), TOP);
      ctx.lineTo(x(s.t), H - BOTTOM);
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
    const pxPerSec = (W - LABEL_W) / (span / 1000);
    for (const s of layout.stitches) {
      if (s.kind === 'narration' || s.t < t0 || s.t > t1) continue;
      const sx = x(s.t);
      const sy = y(s.y);
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
        ctx.moveTo(sx - 2, sy - 4);
        ctx.lineTo(sx + 2, sy - 7);
        ctx.stroke();
        continue;
      }
      // Couched thread to each listener, then the stitch at the speaker.
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([1.5, 2]);
      for (const ty of s.toY) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
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
        ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      if (s.motif === 'question') {
        ctx.arc(sx, sy, r * 0.8, 0, Math.PI * 2);
      } else if (s.motif === 'exclaim') {
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI;
          ctx.moveTo(sx - Math.cos(a) * r, sy - Math.sin(a) * r);
          ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
        }
      } else {
        ctx.moveTo(sx - r, sy - r);
        ctx.lineTo(sx + r, sy + r);
        ctx.moveTo(sx + r, sy - r);
        ctx.lineTo(sx - r, sy + r);
        if (s.motif === 'long') {
          ctx.moveTo(sx - r, sy);
          ctx.lineTo(sx + r, sy);
        }
      }
      ctx.stroke();
      // Close in, the words themselves appear beside their stitch.
      if (pxPerSec > 9 && involved) {
        ctx.fillStyle = palette.inks.dark;
        ctx.font = '10px Georgia, serif';
        const words = s.text.split(/\s+/).slice(0, Math.min(10, Math.floor(pxPerSec / 2.5))).join(' ');
        ctx.fillText(words, sx + r + 3, sy - r - 2);
      }
      ctx.globalAlpha = 1;
    }

    // The needle at now, and the hover needle.
    ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nowX, TOP - 2);
    ctx.lineTo(nowX, H - BOTTOM);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(nowX, TOP - 3, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (hoverX.current !== null && hoverX.current > LABEL_W) {
      ctx.strokeStyle = palette.inks.dark;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX.current, TOP);
      ctx.lineTo(hoverX.current, H - BOTTOM);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }, [frame, layout, look, pulled, q]);

  const onWheel = (e: React.WheelEvent) => {
    const { tOf } = geom();
    const rect = canvasRef.current!.getBoundingClientRect();
    const at = tOf(e.clientX - rect.left);
    const v = view.current!;
    const k = Math.exp(e.deltaY * 0.0016);
    const span = Math.max(15_000, Math.min(6 * 3600_000, (v.t1 - v.t0) * k));
    const frac = (at - v.t0) / (v.t1 - v.t0);
    view.current = { t0: at - frac * span, t1: at + (1 - frac) * span };
    if (k < 1 && view.current.t1 < layout.now) setFollowNow(false);
    redraw();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, t0: view.current!.t0, t1: view.current!.t1, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    hoverX.current = e.clientX - rect.left;
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 3) {
        d.moved = true;
        setFollowNow(false);
      }
      const { W } = geom();
      const dt = (dx / (W - LABEL_W - 8)) * (d.t1 - d.t0);
      view.current = { t0: d.t0 - dt, t1: d.t1 - dt };
    }
    redraw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { x, y, tOf } = geom();
    // A stitch under the pointer opens the moment; else a thread near it is pulled out.
    const hit = layout.stitches
      .filter((s) => s.kind !== 'narration')
      .map((s) => ({ s, d: Math.hypot(x(s.t) - px, y(s.y) - py) }))
      .sort((a, b) => a.d - b.d)[0];
    if (hit && hit.d < 9) {
      setOpened(hit.s);
      return;
    }
    const narr = layout.stitches.find((s) => s.kind === 'narration' && Math.abs(x(s.t) - px) < 4);
    if (narr) {
      setOpened(narr);
      return;
    }
    const t = tOf(px);
    let best: { id: string; d: number } | null = null;
    for (const th of layout.threads) {
      const p = th.points.filter((pt) => pt.t <= t).pop() ?? th.points[0];
      if (!p) continue;
      const dist = Math.abs(y(p.y) - py);
      if (dist < 8 && (!best || dist < best.d)) best = { id: th.id, d: dist };
    }
    setPulled(best && best.id !== pulled ? best.id : null);
  };

  // The moment a stitch opens onto: its whole conversation, in order.
  const moment = useMemo(() => {
    if (!opened) return [];
    if (!opened.conversationId) return [opened];
    return layout.stitches.filter((s) => s.conversationId === opened.conversationId);
  }, [opened, layout]);

  const fitAll = () => {
    view.current = { t0: layout.start - 10_000, t1: layout.now + 30_000 };
    setFollowNow(true);
    redraw();
  };

  return (
    <div className="flex h-full min-h-0 gap-2 p-2 text-ink">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <StitchPanel className="flex flex-wrap items-center gap-1.5 px-2 py-1 text-xs">
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
              className={`glyph-button rounded-sm px-1.5 py-0.5 ${arrangement === id ? 'glyph-on' : ''}`}
            >
              {label}
            </button>
          ))}
          <KnotDivider className="mx-1 h-5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find words or a name…"
            className="w-44 rounded-sm border border-borderFolk bg-transparent px-1.5 py-0.5"
          />
          <span className="flex-1" />
          {pulled && (
            <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={() => setPulled(null)}>
              Let go of {names.get(pulled)}
            </button>
          )}
          <GlyphButton glyph="wholeMap" label="The whole cloth" onClick={fitAll} />
          <GlyphButton glyph="follow" label="Keep now in view" pressed={followNow} dimOff onClick={() => setFollowNow((f) => !f)} tipSide="below-left" />
        </StitchPanel>
        <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden rounded-sm">
          <canvas
            ref={canvasRef}
            className="cursor-grab"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              hoverX.current = null;
              redraw();
            }}
          />
        </div>
        <div className="stitch-muted px-1 text-[10px]">
          Scroll to zoom through time, drag to move along it. Click a thread to pull it out, a stitch to open the moment. ✕ a plain line, ○ a question, ✳ an exclamation, a barred ✕ a long speech; dashed gold is the Scribe; long loose stitches ahead of now are where someone is heading.
        </div>
      </div>
      <StitchPanel className="flex w-72 shrink-0 flex-col gap-2 overflow-hidden p-3 text-xs">
        <div className="font-display text-sm">The moment</div>
        {opened ? (
          <>
            <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
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
      </StitchPanel>
    </div>
  );
}
