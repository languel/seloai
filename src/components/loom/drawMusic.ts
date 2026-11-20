/**
 * The Loom's music lane. Short, it is the summary strip: ambience faint, the in-between
 * stronger, song strongest, and above it when lines were said. Tall (zoomed or focused), it
 * opens into a piano roll like a DAW's: a header with the parts and every instruction the band
 * was given, then a row per instrument (kaval, gaida chanter, the drone, the tapan's dum and
 * tek) with each note the band wrote, at its pitch and length.
 */
import type { Palette } from '../../art/looks';
import { noteName } from '../../engine/moment';
import type { MusicEvent, MusicPhrase, MusicSpan } from '../../music/villageMusic';
import { MUSIC_ROLL_MIN } from './tracks';

export interface MusicLaneInput {
  ctx: CanvasRenderingContext2D;
  x: (t: number) => number;
  t0: number;
  t1: number;
  /** Lane top and height on the canvas. */
  top: number;
  h: number;
  labelW: number;
  W: number;
  palette: Palette;
  lineLook: boolean;
  spans: readonly MusicSpan[];
  speech: ReadonlyArray<{ t0: number; t1: number }>;
  phrases: readonly MusicPhrase[];
  events: readonly MusicEvent[];
  selected: MusicPhrase | null;
}

export type RollRow = 'header' | 'kaval' | 'gaida' | 'drone' | 'tapan';

/** Where each row of the piano roll lies within the lane (relative to its top). */
export function rollRows(h: number): Array<{ row: RollRow; y: number; h: number }> {
  const header = 20;
  const rest = h - header - 8;
  const shares: Array<[RollRow, number]> = [
    ['kaval', 0.34],
    ['gaida', 0.3],
    ['drone', 0.12],
    ['tapan', 0.24],
  ];
  let y = header + 6;
  const rows: Array<{ row: RollRow; y: number; h: number }> = [{ row: 'header', y: 0, h: header }];
  for (const [row, share] of shares) {
    rows.push({ row, y, h: rest * share });
    y += rest * share;
  }
  return rows;
}

const EVENT_MARK: Record<MusicEvent['kind'], string> = {
  direction: '▼',
  release: '△',
  reading: '◆',
  amounts: '≡',
  tone: '~',
  on: '♪',
  off: '×',
};

export function drawMusicLane(m: MusicLaneInput) {
  const { ctx, x, t0, t1, top, h, labelW, W, palette, lineLook } = m;
  const music = lineLook ? palette.inks.dark : palette.inks.primary;
  ctx.save();
  // Labels in the gutter.
  ctx.fillStyle = palette.inks.dark;
  ctx.globalAlpha = 0.85;
  ctx.font = '11px Georgia, serif';
  ctx.fillText('Music', 8, top + 14);
  ctx.globalAlpha = 0.55;
  ctx.font = '9px Georgia, serif';
  if (h < MUSIC_ROLL_MIN) {
    ctx.fillText('click to open', 8, top + 26);
    drawSummary(m, music);
    ctx.restore();
    return;
  }
  const rows = rollRows(h);
  for (const r of rows) {
    if (r.row === 'header') continue;
    ctx.globalAlpha = 0.75;
    ctx.font = '10px Georgia, serif';
    ctx.fillText(r.row, 14, top + r.y + Math.min(r.h / 2 + 4, 14));
  }

  // The lane's cloth: rows ruled faintly.
  ctx.beginPath();
  ctx.rect(labelW, top, W - labelW, h);
  ctx.clip();
  ctx.globalAlpha = 1;
  for (const r of rows) {
    if (r.row === 'header') continue;
    ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.secondary;
    ctx.globalAlpha = 0.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(labelW, top + r.y);
    ctx.lineTo(W, top + r.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const visible = m.phrases.filter((p) => p.t1 >= t0 && p.t0 <= t1);
  const rowOf = (row: RollRow) => rows.find((r) => r.row === row)!;

  // Header: the parts as a strip, then the instructions as marks with a few words.
  const head = rowOf('header');
  const strength = { ambience: 0.16, between: 0.55, song: 0.9 } as const;
  for (const sp of m.spans) {
    if (sp.t1 < t0 || sp.t0 > t1) continue;
    const a = Math.max(labelW, x(sp.t0));
    const b = Math.min(W, x(sp.t1));
    if (b - a < 0.5) continue;
    ctx.globalAlpha = strength[sp.part];
    ctx.fillStyle = sp.part === 'song' && !lineLook ? palette.inks.gold : music;
    ctx.fillRect(a, top + head.y + 12, b - a, 4);
  }
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = palette.inks.dark;
  for (const sp of m.speech) {
    if (sp.t1 < t0 || sp.t0 > t1) continue;
    const a = Math.max(labelW, x(sp.t0));
    ctx.fillRect(a, top + head.y + 18, Math.max(1, x(sp.t1) - a), 2);
  }
  let lastText = -Infinity;
  for (const e of m.events) {
    if (e.t < t0 || e.t > t1) continue;
    const ex = x(e.t);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = e.kind === 'direction' || e.kind === 'release' ? palette.inks.accent : palette.inks.dark;
    ctx.font = '10px Georgia, serif';
    ctx.fillText(EVENT_MARK[e.kind], ex - 4, top + head.y + 10);
    if (ex - lastText > 140) {
      ctx.globalAlpha = 0.7;
      ctx.font = '9px Georgia, serif';
      const words = e.text.length > 28 ? `${e.text.slice(0, 27)}…` : e.text;
      ctx.fillText(words, ex + 6, top + head.y + 10);
      lastText = ex;
    }
  }

  // Pitch ranges of what is in view, per instrument.
  const range = (pick: (p: MusicPhrase) => Array<{ midi: number }>) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of visible) for (const n of pick(p)) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    if (!Number.isFinite(lo)) return null;
    return { lo: lo - 1, hi: hi + 1 };
  };
  const inks = {
    kaval: lineLook ? palette.inks.dark : palette.inks.primary,
    gaida: lineLook ? palette.inks.dark : palette.inks.accent,
    drone: lineLook ? palette.inks.dark : palette.inks.gold,
    tapan: palette.inks.dark,
  };
  const pxPerSec = (W - labelW) / ((t1 - t0) / 1000);

  for (const inst of ['kaval', 'gaida'] as const) {
    const row = rowOf(inst);
    const r = range((p) => (inst === 'gaida' && !p.plan.gaidaOn ? [] : p.plan[inst]));
    if (!r) continue;
    const yOf = (midi: number) => top + row.y + 3 + (1 - (midi - r.lo) / (r.hi - r.lo)) * (row.h - 6);
    const thick = Math.max(1.5, Math.min(6, (row.h - 6) / (r.hi - r.lo + 1)));
    // The pitch range, named in the gutter.
    ctx.restore();
    ctx.save();
    ctx.fillStyle = palette.inks.dark;
    ctx.globalAlpha = 0.5;
    ctx.font = '8px Georgia, serif';
    if (row.h > 28) {
      ctx.fillText(noteName(r.hi - 1), labelW - 26, yOf(r.hi - 1) + 3);
      ctx.fillText(noteName(r.lo + 1), labelW - 26, yOf(r.lo + 1) + 3);
    }
    ctx.beginPath();
    ctx.rect(labelW, top, W - labelW, h);
    ctx.clip();
    for (const p of visible) {
      if (inst === 'gaida' && !p.plan.gaidaOn) continue;
      const end = p.cutAt ?? Infinity;
      for (const n of p.plan[inst]) {
        const a = p.t0 + n.t * 1000;
        if (a >= end) continue;
        const b = Math.min(end, a + n.dur * 1000);
        if (b < t0 || a > t1) continue;
        const y = yOf(n.midi);
        ctx.globalAlpha = (0.35 + 0.65 * n.vel) * (p.part === 'ambience' ? 0.6 : 1);
        ctx.strokeStyle = inks[inst];
        ctx.lineWidth = thick;
        ctx.lineCap = 'butt';
        if (n.trillTo !== undefined) ctx.setLineDash([3, 1.5]);
        ctx.beginPath();
        ctx.moveTo(x(a), y);
        ctx.lineTo(Math.max(x(a) + 1.5, x(b) - 1), y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (n.glideFrom !== undefined) {
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x(a) - 4, yOf(n.glideFrom));
          ctx.lineTo(x(a), y);
          ctx.stroke();
        }
        if (n.graces?.length) {
          ctx.fillStyle = inks[inst];
          n.graces.forEach((g, k) => ctx.fillRect(x(a) - 3 * (n.graces!.length - k), yOf(g) - 1, 1.5, 2));
        }
        if (pxPerSec > 60 && x(b) - x(a) > 22 && thick >= 3) {
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = palette.inks.dark;
          ctx.font = '8px Georgia, serif';
          ctx.fillText(noteName(n.midi), x(a) + 2, y - thick / 2 - 1);
        }
      }
    }
  }

  // The drone: a band as loud as it is, with its degree.
  const drone = rowOf('drone');
  for (const p of visible) {
    if (p.plan.drone <= 0.01) continue;
    const a = Math.max(labelW, x(p.t0));
    const b = Math.min(W, x(p.t1));
    const th = Math.max(1, (drone.h - 4) * Math.min(1, p.plan.drone));
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = inks.drone;
    ctx.fillRect(a, top + drone.y + (drone.h - th) / 2, Math.max(1, b - a), th);
    if (b - a > 60 && drone.h > 12) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = palette.inks.dark;
      ctx.font = '8px Georgia, serif';
      ctx.fillText(`${p.plan.mode}${p.plan.droneDegree ? ` · degree ${p.plan.droneDegree}` : ''}`, a + 2, top + drone.y + drone.h / 2 + 3);
    }
  }

  // The tapan: dum below, tek above.
  const tapan = rowOf('tapan');
  for (const p of visible) {
    const end = p.cutAt ?? Infinity;
    for (const hit of p.plan.tapan) {
      const at = p.t0 + hit.t * 1000;
      if (at >= end || at < t0 || at > t1) continue;
      const hx = x(at);
      ctx.globalAlpha = 0.35 + 0.65 * hit.vel;
      ctx.fillStyle = inks.tapan;
      if (hit.kind === 'dum') {
        ctx.beginPath();
        ctx.arc(hx, top + tapan.y + tapan.h * 0.68, Math.max(1.5, Math.min(4, tapan.h * 0.12)), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(hx - 0.5, top + tapan.y + tapan.h * 0.18, 1.2, Math.max(2, tapan.h * 0.22));
      }
    }
  }

  // Phrase boundaries, and the chosen phrase outlined.
  for (const p of visible) {
    if (p.part === 'ambience' && pxPerSec < 20) continue;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = palette.inks.dark;
    ctx.fillRect(x(p.t0), top + head.h, 1, h - head.h);
  }
  if (m.selected && m.selected.t1 >= t0 && m.selected.t0 <= t1) {
    const p = m.selected;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = lineLook ? palette.inks.dark : palette.inks.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x(p.t0), top + 2, x(p.cutAt ?? p.t1) - x(p.t0), h - 4);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawSummary(m: MusicLaneInput, music: string) {
  const { ctx, x, t0, t1, top, h, labelW, W, palette, lineLook } = m;
  // The summary keeps its own height however tall the lane is.
  const laneH = Math.min(h, 46) - 14;
  ctx.beginPath();
  ctx.rect(labelW, top, W - labelW, h);
  ctx.clip();
  ctx.globalAlpha = 1;
  const strength = { ambience: 0.16, between: 0.55, song: 0.9 } as const;
  for (const sp of m.spans) {
    if (sp.t1 < t0 || sp.t0 > t1) continue;
    const x0 = Math.max(labelW, x(sp.t0));
    const x1 = Math.min(W, x(sp.t1));
    if (x1 - x0 < 0.5) continue;
    ctx.globalAlpha = strength[sp.part];
    ctx.fillStyle = sp.part === 'song' && !lineLook ? palette.inks.gold : music;
    const inset = sp.part === 'ambience' ? laneH * 0.3 : 0;
    ctx.fillRect(x0, top + 10 + inset, x1 - x0, laneH - 6 - inset * 2);
    if (x1 - x0 > 70 && sp.part !== 'ambience') {
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = sp.part === 'song' || lineLook ? palette.inks.dark : palette.ground;
      ctx.font = '9px Georgia, serif';
      ctx.fillText(sp.label.split(' · ').slice(0, 2).join(' · '), x0 + 3, top + 10 + laneH / 2);
    }
  }
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = palette.inks.dark;
  for (const sp of m.speech) {
    if (sp.t1 < t0 || sp.t0 > t1) continue;
    const x0 = Math.max(labelW, x(sp.t0));
    ctx.fillRect(x0, top + 4, Math.max(1, x(sp.t1) - x0), 3);
  }
}

/** The phrase under a time in the lane: the one sounding, preferring song and motif over ambience. */
export function phraseAt(phrases: readonly MusicPhrase[], t: number): MusicPhrase | null {
  let ambience: MusicPhrase | null = null;
  for (let i = phrases.length - 1; i >= 0; i--) {
    const p = phrases[i];
    if (p.t1 < t - 60_000) break;
    if (p.t0 > t || t >= (p.cutAt ?? p.t1)) continue;
    if (p.part !== 'ambience') return p;
    ambience ??= p;
  }
  return ambience;
}
