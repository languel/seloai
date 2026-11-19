import React, { useEffect, useMemo, useRef, useState } from 'react';
import { figureLooksFor, figurePortrait } from '../art/gameLook';
import { PALETTES, paintLinen, type PaletteName } from '../art/looks';
import { RELATION_KINDS, buildPsychohistory, type PsychoLink, type PsychoNode, type RelationKind, type Tone } from '../engine/psychohistory';
import { createLayout, stepLayout, syncLayout, warmLayout, type LayoutState } from '../engine/psychohistoryLayout';
import type { VillageSimulation } from '../engine/simulation';
import { GlyphButton } from './Glyph';
import { KnotDivider, StitchPanel } from './Stitch';

/**
 * Psychohistory: the world at this moment as an abstract map. Characters (their own embroidered
 * portraits) and places (stitched medallions) are nodes; how they stand to one another are
 * threads that settle themselves: who has talked with whom and how it went, who is where, who
 * keeps to a place, who is heading where, and who and what is on each one's mind. Drag the cloth
 * to pan, scroll to zoom, drag a node to move it (it stays where you put it until double-clicked),
 * click to read it. Where the Loom keeps time, this keeps the present.
 */

interface PsychohistoryViewProps {
  sim: VillageSimulation;
  look: PaletteName;
  onJumpToVillage: (villagerId?: string) => void;
}

const RELATION_LABELS: Record<RelationKind, { label: string; hint: string }> = {
  talked: { label: 'Talked', hint: 'Who has talked with whom: a running stitch, coloured by how it went, thicker the more was said' },
  at: { label: 'Where', hint: 'Who is at which place now: a short gold satin stitch' },
  keeps: { label: 'Keeps to', hint: 'Who keeps to a place (the Lamia and her well): a doubled gold thread' },
  heading: { label: 'Heading', hint: 'Who is on the way where, or to whom: loose basting, as on the Loom' },
  thinks: { label: 'On their mind', hint: 'Who and what each one has on their mind, from what they mean to do, remember and have said: a faint dotted thread' },
};

const TONE_INK: Record<Tone, 'primary' | 'dark' | 'accent' | 'secondary'> = { warm: 'primary', tense: 'dark', curious: 'accent', neutral: 'secondary' };
const TONE_WORD: Record<Tone, string> = { warm: 'warm', tense: 'tense', curious: 'curious', neutral: 'even' };

interface View {
  cx: number;
  cy: number;
  /** Pixels per map cell. */
  k: number;
}

const FILTER_KEY = 'seloai.psychohistory.show';

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export default function PsychohistoryView({ sim, look, onJumpToVillage }: PsychohistoryViewProps) {
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [shown, setShown] = useState<Set<RelationKind>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null') as RelationKind[] | null;
      if (Array.isArray(raw)) return new Set(raw.filter((k) => RELATION_KINDS.includes(k)));
    } catch {
      // nothing saved
    }
    return new Set(RELATION_KINDS);
  });
  const [pins, setPins] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layout = useRef<LayoutState>(createLayout());
  const view = useRef<View | null>(null);
  const drag = useRef<{ mode: 'pan' | 'node'; id?: string; x: number; y: number; moved: boolean } | null>(null);
  const portraits = useRef(new Map<string, HTMLCanvasElement | null>());

  // The web is read again about once a second as the world goes on.
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

  const web = useMemo(() => buildPsychohistory(sim), [sim, tick]);
  const byId = useMemo(() => new Map(web.nodes.map((n) => [n.id, n])), [web]);
  const links = useMemo(() => web.links.filter((l) => shown.has(l.kind)), [web, shown]);
  const webRef = useRef(web);
  webRef.current = web;
  const linksRef = useRef(links);
  linksRef.current = links;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    syncLayout(layout.current, web.nodes);
    warmLayout(layout.current, 0.25);
  }, [web]);
  useEffect(() => {
    portraits.current.clear();
  }, [look]);

  const toggle = (kind: RelationKind) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify([...next]));
      } catch {
        // no storage
      }
      warmLayout(layout.current, 0.5);
      return next;
    });

  // Size the canvas to its frame.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(wrap.clientWidth * ratio));
      canvas.height = Math.max(1, Math.floor(wrap.clientHeight * ratio));
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const size = () => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    return { W: canvas.width / ratio, H: canvas.height / ratio, ratio };
  };
  const toScreen = (x: number, y: number) => {
    const { W, H } = size();
    const v = view.current!;
    return { x: W / 2 + (x - v.cx) * v.k, y: H / 2 + (y - v.cy) * v.k };
  };
  const toWorld = (px: number, py: number) => {
    const { W, H } = size();
    const v = view.current!;
    return { x: v.cx + (px - W / 2) / v.k, y: v.cy + (py - H / 2) / v.k };
  };

  /** The view that shows the whole web, with room for names. */
  const fitTarget = (): View | null => {
    const bodies = [...layout.current.bodies.values()];
    if (!bodies.length || !canvasRef.current) return null;
    const { W, H } = size();
    const xs = bodies.map((b) => b.x);
    const ys = bodies.map((b) => b.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min((W - 160) / Math.max(4, x1 - x0), (H - 160) / Math.max(4, y1 - y0));
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k: Math.max(5, Math.min(60, k)) };
  };
  // The view keeps the whole web framed, easing, until the viewer pans, zooms or moves something.
  const autoFit = useRef(true);
  const fit = () => {
    autoFit.current = true;
    if (!view.current) view.current = fitTarget();
  };

  const radiusOf = (n: PsychoNode) => {
    const k = view.current?.k ?? 20;
    const s = Math.max(0.6, Math.min(1.6, Math.sqrt(k / 20)));
    return (n.kind === 'character' ? 21 + n.activity * 3 : 12 + Math.min(n.degree, 6) * 1.6) * s;
  };

  const portraitOf = (id: string, px: number) => {
    const key = `${id}:${Math.round(px)}`;
    if (portraits.current.has(key)) return portraits.current.get(key) ?? null;
    const cfg = sim.configs.get(id);
    const img = cfg
      ? (() => {
          const { build, kind, seed, traits } = figureLooksFor(cfg);
          return figurePortrait(cfg.id, look, Math.round(px), build, 'bust', Math.max(2, Math.ceil(window.devicePixelRatio || 1)), kind, { seed, traits });
        })()
      : null;
    portraits.current.set(key, img);
    return img;
  };

  /** A thread's curve: it sags a little to one side, the same side every time. */
  const curve = (l: PsychoLink, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const sag = (hash(l.id) % 2 ? 1 : -1) * Math.min(40, len * (l.kind === 'thinks' ? 0.2 : 0.1));
    return { cx: mx + (-dy / len) * sag, cy: my + (dx / len) * sag };
  };

  // The loop: settle the web a little, then draw it.
  useEffect(() => {
    let raf = 0;
    const palette = PALETTES[look];
    const lineLook = look === 'ink' || look === 'night';
    let ground: HTMLCanvasElement | null = null;
    let groundKey = '';
    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas || canvas.width < 2) return;
      const w = webRef.current;
      const ls = linksRef.current;
      stepLayout(layout.current, w.nodes, ls);
      if (!view.current) view.current = fitTarget();
      if (!view.current) return;
      if (autoFit.current) {
        const t = fitTarget();
        if (t) {
          const v = view.current;
          v.cx += (t.cx - v.cx) * 0.06;
          v.cy += (t.cy - v.cy) * 0.06;
          v.k += (t.k - v.k) * 0.06;
        }
      }
      const ctx = canvas.getContext('2d')!;
      const { W, H, ratio } = size();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      // The cloth, woven once per size and look.
      const gk = `${W}x${H}:${look}`;
      if (gk !== groundKey) {
        groundKey = gk;
        ground = document.createElement('canvas');
        ground.width = canvas.width;
        ground.height = canvas.height;
        const g = ground.getContext('2d')!;
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        if (lineLook) {
          g.fillStyle = palette.ground;
          g.fillRect(0, 0, W, H);
        } else paintLinen(g, W, H, { unit: 6, origin: [0, 0], palette, seed: 5 });
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (ground) ctx.drawImage(ground, 0, 0);
      ctx.restore();

      const sel = selectedRef.current;
      const near = (l: PsychoLink) => !sel || l.source === sel || l.target === sel;
      const pos = (id: string) => {
        const b = layout.current.bodies.get(id);
        return b ? toScreen(b.x, b.y) : null;
      };

      // Threads.
      for (const l of ls) {
        const a = pos(l.source);
        const b = pos(l.target);
        if (!a || !b) continue;
        const c = curve(l, a, b);
        const fresh = Math.exp(-(w.at - l.lastAt) / 600_000);
        const focus = near(l) ? 1 : 0.12;
        ctx.save();
        ctx.lineCap = 'round';
        const ink = (name: keyof typeof palette.inks) => (lineLook ? palette.inks.dark : palette.inks[name]);
        const path = (offset = 0) => {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y + offset);
          ctx.quadraticCurveTo(c.cx, c.cy + offset, b.x, b.y + offset);
        };
        if (l.kind === 'talked') {
          ctx.strokeStyle = ink(TONE_INK[l.tone ?? 'neutral']);
          ctx.globalAlpha = (0.35 + 0.6 * fresh) * focus;
          ctx.lineWidth = 1 + 3.5 * l.weight;
          ctx.setLineDash([6, 3.5]);
          path();
          ctx.stroke();
        } else if (l.kind === 'at') {
          ctx.strokeStyle = ink('gold');
          ctx.globalAlpha = 0.9 * focus;
          ctx.lineWidth = 3;
          path();
          ctx.stroke();
          ctx.strokeStyle = lineLook ? palette.ground : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          path();
          ctx.stroke();
        } else if (l.kind === 'keeps') {
          ctx.strokeStyle = ink('gold');
          ctx.globalAlpha = 0.85 * focus;
          ctx.lineWidth = 1.4;
          path(-2);
          ctx.stroke();
          path(2);
          ctx.stroke();
        } else if (l.kind === 'heading') {
          ctx.strokeStyle = ink('dark');
          ctx.globalAlpha = 0.55 * focus;
          ctx.lineWidth = 1.3;
          ctx.setLineDash([11, 8]);
          ctx.lineDashOffset = -time / 120;
          path();
          ctx.stroke();
          // A knot where they are bound.
          const t = 0.86;
          const kx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.cx + t * t * b.x;
          const ky = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.cy + t * t * b.y;
          ctx.setLineDash([]);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.arc(kx, ky, 2.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = ink('accent2');
          ctx.globalAlpha = (0.25 + 0.4 * l.weight) * focus;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([1.5, 5]);
          path();
          ctx.stroke();
        }
        ctx.restore();
      }

      // Nodes: places as medallions, people as their portraits.
      const order = [...w.nodes].sort((p, q) => (p.kind === q.kind ? 0 : p.kind === 'place' ? -1 : 1));
      for (const n of order) {
        const p = pos(n.id);
        if (!p) continue;
        const r = radiusOf(n);
        const dim = sel && sel !== n.id && !ls.some((l) => near(l) && (l.source === n.id || l.target === n.id)) ? 0.35 : 1;
        ctx.save();
        ctx.globalAlpha = dim;
        if (n.kind === 'place') {
          ctx.fillStyle = lineLook ? palette.ground : 'rgba(250, 244, 230, 0.92)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.gold;
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = ctx.strokeStyle;
          const knots = 8;
          for (let i = 0; i < knots; i++) {
            const ang = (i / knots) * Math.PI * 2 + (hash(n.id) % 7) / 7;
            ctx.beginPath();
            ctx.arc(p.x + Math.cos(ang) * (r - 4), p.y + Math.sin(ang) * (r - 4), 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = lineLook ? palette.inks.dark : palette.inks.primary;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6 + n.activity * 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Stirring: a soft ring while they speak or think.
          if (n.activity >= 0.75) {
            ctx.strokeStyle = n.color;
            ctx.globalAlpha = dim * (0.25 + 0.2 * Math.sin(time / 260));
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = dim;
          }
          ctx.fillStyle = lineLook ? palette.ground : 'rgba(250, 244, 230, 0.95)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          const img = portraitOf(n.id, r * 2);
          if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(p.x, p.y, r - 1.5, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, p.x - r, p.y - r * 1.02, r * 2, r * 2);
            ctx.restore();
          }
          ctx.strokeStyle = n.color;
          ctx.lineWidth = sel === n.id ? 4 : 2.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          if (n.mood && n.mood !== 'neutral') {
            ctx.fillStyle = lineLook ? palette.inks.dark : palette.inks[TONE_INK[n.mood]];
            ctx.beginPath();
            ctx.arc(p.x + r * 0.72, p.y - r * 0.72, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (layout.current.bodies.get(n.id)?.pinned) {
          ctx.fillStyle = palette.inks.dark;
          ctx.beginPath();
          ctx.arc(p.x, p.y - r - 3, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(p.x - 0.6, p.y - r - 3, 1.2, 5);
        }
        if (sel === n.id) {
          ctx.strokeStyle = palette.inks.dark;
          ctx.setLineDash([2, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // The name, below.
        ctx.font = `${n.kind === 'character' ? 'bold ' : ''}11px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = lineLook ? palette.ground : 'rgba(250, 244, 230, 0.85)';
        const label = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
        ctx.strokeText(label, p.x, p.y + r + 13);
        ctx.fillStyle = palette.inks.dark;
        ctx.fillText(label, p.x, p.y + r + 13);
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // The loop reads the latest web and view through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);

  // Hit-testing: a node under the pointer, else a thread near it.
  const nodeAt = (px: number, py: number) => {
    let best: { id: string; d: number } | null = null;
    for (const n of webRef.current.nodes) {
      const b = layout.current.bodies.get(n.id);
      if (!b) continue;
      const p = toScreen(b.x, b.y);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d <= radiusOf(n) + 3 && (!best || d < best.d)) best = { id: n.id, d };
    }
    return best?.id ?? null;
  };
  const linkAt = (px: number, py: number) => {
    let best: { l: PsychoLink; d: number } | null = null;
    for (const l of linksRef.current) {
      const ba = layout.current.bodies.get(l.source);
      const bb = layout.current.bodies.get(l.target);
      if (!ba || !bb) continue;
      const a = toScreen(ba.x, ba.y);
      const b = toScreen(bb.x, bb.y);
      const c = curve(l, a, b);
      for (let i = 1; i < 20; i++) {
        const t = i / 20;
        const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.cx + t * t * b.x;
        const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.cy + t * t * b.y;
        const d = Math.hypot(x - px, y - py);
        if (d < 6 && (!best || d < best.d)) best = { l, d };
      }
    }
    return best?.l ?? null;
  };

  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = local(e);
    const id = nodeAt(p.x, p.y);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = id ? { mode: 'node', id, x: p.x, y: p.y, moved: false } : { mode: 'pan', x: p.x, y: p.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const d = drag.current;
    if (!d) {
      const id = nodeAt(p.x, p.y);
      if (id) {
        const n = byId.get(id);
        setHover(n ? { x: p.x, y: p.y, text: n.kind === 'character' ? `${n.label}: ${n.intention ?? n.about}` : `${n.label}${n.about ? `: ${n.about}` : ''}` } : null);
      } else {
        const l = linkAt(p.x, p.y);
        setHover(l ? { x: p.x, y: p.y, text: l.note } : null);
      }
      return;
    }
    if (Math.hypot(p.x - d.x, p.y - d.y) > 3) {
      d.moved = true;
      if (d.mode === 'pan') autoFit.current = false;
    }
    if (d.mode === 'node' && d.id) {
      const b = layout.current.bodies.get(d.id);
      if (b) {
        const wpt = toWorld(p.x, p.y);
        b.x = wpt.x;
        b.y = wpt.y;
        b.vx = 0;
        b.vy = 0;
        if (d.moved && !b.pinned) {
          b.pinned = true;
          setPins((n) => n + 1);
        }
        warmLayout(layout.current, 0.5);
      }
    } else if (view.current) {
      view.current.cx -= (p.x - d.x) / view.current.k;
      view.current.cy -= (p.y - d.y) / view.current.k;
      d.x = p.x;
      d.y = p.y;
    }
    setHover(null);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const p = local(e);
    if (d.mode === 'node' && d.id) setSelected((s) => (s === d.id ? null : d.id!));
    else {
      const l = linkAt(p.x, p.y);
      setSelected(l ? l.source : null);
    }
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const p = local(e);
    const id = nodeAt(p.x, p.y);
    const b = id ? layout.current.bodies.get(id) : undefined;
    if (b?.pinned) {
      b.pinned = false;
      setPins((n) => Math.max(0, n - 1));
      warmLayout(layout.current, 0.6);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!view.current) return;
    autoFit.current = false;
    const p = local(e);
    const before = toWorld(p.x, p.y);
    view.current.k = Math.max(5, Math.min(90, view.current.k * Math.exp(-e.deltaY * 0.0015)));
    const after = toWorld(p.x, p.y);
    view.current.cx += before.x - after.x;
    view.current.cy += before.y - after.y;
  };
  const zoomBy = (f: number) => {
    autoFit.current = false;
    if (view.current) view.current.k = Math.max(5, Math.min(90, view.current.k * f));
  };
  const releasePins = () => {
    for (const b of layout.current.bodies.values()) b.pinned = false;
    setPins(0);
    warmLayout(layout.current, 0.8);
  };

  const sel = selected ? byId.get(selected) : undefined;
  const selLinks = useMemo(() => (selected ? web.links.filter((l) => l.source === selected || l.target === selected) : []), [web, selected]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(RELATION_KINDS.map((k) => [k, 0])) as Record<RelationKind, number>;
    for (const l of web.links) c[l.kind]++;
    return c;
  }, [web]);
  const selPortrait = useMemo(() => {
    if (!sel || sel.kind !== 'character') return '';
    const cfg = sim.configs.get(sel.id);
    if (!cfg) return '';
    const { build, kind, seed, traits } = figureLooksFor(cfg);
    return figurePortrait(cfg.id, look, 72, build, 'bust', 2, kind, { seed, traits })?.toDataURL() ?? '';
  }, [sel, look, sim]);

  return (
    <div className="flex h-full min-h-0 gap-2 p-2 text-ink">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <StitchPanel className="flex flex-wrap items-center gap-1.5 px-2 py-1 text-xs">
          <span className="font-display text-sm">Psychohistory</span>
          <KnotDivider className="mx-1 h-5" />
          {RELATION_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              title={RELATION_LABELS[k].hint}
              aria-pressed={shown.has(k)}
              onClick={() => toggle(k)}
              className={`glyph-button rounded-sm px-1.5 py-0.5 ${shown.has(k) ? 'glyph-on' : 'opacity-60'}`}
            >
              {RELATION_LABELS[k].label} <span className="stitch-muted">{counts[k]}</span>
            </button>
          ))}
          <span className="flex-1" />
          {pins > 0 && (
            <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={releasePins} title="Let every node you moved find its own place again">
              Release {pins} pinned
            </button>
          )}
          <GlyphButton glyph="zoomOut" label="Zoom out" onClick={() => zoomBy(1 / 1.25)} />
          <GlyphButton glyph="zoomIn" label="Zoom in" onClick={() => zoomBy(1.25)} />
          <GlyphButton glyph="wholeMap" label="The whole web" onClick={fit} tipSide="below-left" />
        </StitchPanel>
        <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden rounded-sm">
          <canvas
            ref={canvasRef}
            className={drag.current?.mode === 'node' ? 'cursor-grabbing' : 'cursor-grab'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
          />
          {hover && (
            <div
              className="stitch-panel pointer-events-none absolute z-10 max-w-xs px-2 py-1 text-[11px] leading-snug"
              style={{ left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 400) - 260), top: hover.y + 12 }}
            >
              {hover.text}
            </div>
          )}
        </div>
        <div className="stitch-muted px-1 text-[10px]">
          The world as it stands now. People are their portraits, places are medallions, held near where they lie on the map. A running stitch is a conversation (red warm, dark tense, blue curious), gold satin is where someone is, doubled gold where they keep to, loose basting where they are heading, a faint dotted thread who or what is on their mind. Drag the cloth to move, scroll to zoom, drag a node to place it (double-click to let it go), click to read it.
        </div>
      </div>
      <StitchPanel className="flex w-72 shrink-0 flex-col gap-2 overflow-hidden p-3 text-xs">
        {sel ? (
          <>
            <div className="flex items-center gap-2">
              {selPortrait && <img src={selPortrait} width={56} height={56} alt="" aria-hidden="true" />}
              <div className="min-w-0">
                <div className="font-display text-sm">{sel.label}</div>
                <div className="stitch-muted leading-snug">{sel.about}</div>
              </div>
            </div>
            {sel.kind === 'character' && (
              <div className="space-y-1 leading-snug">
                <div>
                  <span className="stitch-muted">Now: </span>
                  {sel.state}
                  {sel.mood ? <span className="stitch-muted"> · {TONE_WORD[sel.mood]} of late</span> : null}
                </div>
                {sel.intention && (
                  <div>
                    <span className="stitch-muted">Means to: </span>
                    {sel.intention}
                  </div>
                )}
                {sel.released && (
                  <div>
                    <span className="stitch-muted">No longer keeps to their place: </span>
                    {sel.released}
                  </div>
                )}
              </div>
            )}
            <div className="font-display text-sm">How things stand</div>
            <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {selLinks.length === 0 && <li className="stitch-muted">Nothing ties {sel.label} to anyone or anywhere just now.</li>}
              {[...selLinks]
                .sort((a, b) => RELATION_KINDS.indexOf(a.kind) - RELATION_KINDS.indexOf(b.kind) || b.weight - a.weight)
                .map((l) => {
                  const other = l.source === sel.id ? l.target : l.source;
                  return (
                    <li key={l.id}>
                      <button type="button" className="w-full text-left leading-snug hover:underline" onClick={() => setSelected(other)}>
                        <span className="font-semibold">{RELATION_LABELS[l.kind].label}</span>
                        {l.tone && l.kind === 'talked' ? <span className="stitch-muted"> · {TONE_WORD[l.tone]}</span> : null}
                        <div>{l.note}</div>
                      </button>
                    </li>
                  );
                })}
            </ol>
            {sel.kind === 'character' && (
              <button type="button" className="stitch-panel px-2 py-1 text-left" onClick={() => onJumpToVillage(sel.id)}>
                Go to {sel.label} in the village
              </button>
            )}
          </>
        ) : (
          <>
            <div className="font-display text-sm">The world now</div>
            <span className="stitch-muted leading-snug">
              Click a person or a place to see how they stand to everyone and everything else. {web.nodes.filter((n) => n.kind === 'character').length} people, {web.nodes.filter((n) => n.kind === 'place').length} places, {web.links.length} threads.
            </span>
          </>
        )}
      </StitchPanel>
    </div>
  );
}
