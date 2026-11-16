/**
 * The Scribe's band: narration sewn along the bottom of the cloth, centred, in the ductus
 * hand and gold thread, written letter by letter as it is spoken. A new line writes itself
 * while the old one fades. A couched rule above it marks the band off, like the woven edge
 * of a rushnyk; there is no box behind it.
 */
import { ductusAdvance, ductusStrokes, drawDuctus, type DuctusStitch } from './ductus';

export interface ScribeLine {
  id: string;
  text: string;
}

interface Shown {
  id: string;
  text: string;
  since: number;
  gone?: number;
}

const WRITE_CPS = 26;
const FADE_SEC = 0.9;

/** The same colour with no opacity, for gradients that fade out. */
function clearOf(colour: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour);
  if (!m) return 'rgba(255,255,255,0)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0)`;
}

export class ScribeBand {
  private shown: Shown[] = [];

  /** Height of the band in screen pixels, for framing the view above it. */
  static height(viewW: number) {
    const xh = ScribeBand.xHeight(viewW);
    return xh * 2.6 * 3 + 18;
  }

  private static xHeight(viewW: number) {
    return Math.max(7, Math.min(11, viewW / 90));
  }

  /** Lays the text out in lines no wider than `maxW`, breaking at spaces. */
  private static wrap(text: string, xh: number, maxW: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    const width = (s: string) => [...s].reduce((w, ch) => w + ductusAdvance(ch) * xh, 0);
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (width(next) > maxW && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Draws the band in screen space; `t` in seconds. */
  draw(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    line: ScribeLine | null,
    t: number,
    colour: string,
    rule: string,
    stitch: DuctusStitch,
    ground?: string,
  ) {
    if (line && this.shown[this.shown.length - 1]?.id !== line.id) {
      for (const s of this.shown) s.gone ??= t;
      this.shown.push({ id: line.id, text: line.text, since: t });
    } else if (line) {
      const cur = this.shown[this.shown.length - 1];
      if (cur && line.text.length > cur.text.length) cur.text = line.text;
    }
    this.shown = this.shown.filter((s) => !s.gone || t - s.gone < FADE_SEC);
    if (this.shown.length === 0) return;

    const xh = ScribeBand.xHeight(viewW);
    const lineH = xh * 2.6;
    const maxW = Math.min(viewW * 0.72, 680);
    const bottom = viewH - 10;
    ctx.save();
    for (const s of this.shown) {
      const fade = s.gone ? Math.max(0, 1 - (t - s.gone) / FADE_SEC) : 1;
      const lines = ScribeBand.wrap(s.text, xh, maxW).slice(-3);
      const visible = Math.floor((t - s.since) * WRITE_CPS);
      // A line on its way out rises a little as it fades, so it never sits under the new one.
      const lift = s.gone ? Math.min(1, (t - s.gone) / FADE_SEC) * lineH * 1.2 : 0;
      const top = bottom - lines.length * lineH - lift;
      // A soft wash of the cloth's own colour behind the words, with no edge, so they read
      // over a river or a road without sitting in a box.
      if (ground) {
        const cx = viewW / 2;
        const cy = (top + bottom) / 2;
        const rx = Math.min(maxW, viewW) * 0.62;
        const ry = (bottom - top) * 0.95 + 10;
        ctx.save();
        ctx.globalAlpha = 0.78 * fade;
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        const wash = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
        // Fade to the same colour made clear, never to clear black (which shows as a grey halo).
        wash.addColorStop(0, ground);
        wash.addColorStop(0.65, ground);
        wash.addColorStop(1, clearOf(ground));
        ctx.fillStyle = wash;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // The couched rule above the band.
      ctx.globalAlpha = 0.55 * fade;
      ctx.strokeStyle = rule;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 4]);
      const ruleW = Math.min(maxW, Math.max(...lines.map((l) => [...l].reduce((w, ch) => w + ductusAdvance(ch) * xh, 0)))) + 40;
      ctx.beginPath();
      ctx.moveTo(viewW / 2 - ruleW / 2, top - 4);
      ctx.lineTo(viewW / 2 + ruleW / 2, top - 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = fade;
      let count = 0;
      lines.forEach((text, row) => {
        const width = [...text].reduce((w, ch) => w + ductusAdvance(ch) * xh, 0);
        let x = viewW / 2 - width / 2;
        const y = top + row * lineH + lineH * 0.55;
        [...text].forEach((ch, i) => {
          const adv = ductusAdvance(ch) * xh;
          const progress = Math.max(0, Math.min(1, visible - count + 1));
          count++;
          if (progress > 0 && ch !== ' ') {
            ctx.save();
            ctx.translate(x + adv / 2, y);
            drawDuctus(ctx, ductusStrokes(ch, { slant: 0.18, wobble: 0.45, seed: (i % 4) * 7919 + ch.charCodeAt(0) }), xh, colour, 0.13, stitch, progress, true);
            ctx.restore();
          }
          x += adv;
        });
      });
    }
    ctx.restore();
  }
}
