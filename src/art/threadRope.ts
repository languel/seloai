/**
 * A loose thread with a little physics: a chain of points under gravity, joined by links of
 * fixed length and pinned at both ends (a speaker and the words they are sewing). It sags,
 * swings when the speaker walks, and whips a little each time a new letter pulls its end
 * along. Verlet integration with a few constraint passes: cheap, steady, and good enough to
 * look like thread.
 */

interface Knot {
  x: number;
  y: number;
  px: number;
  py: number;
}

export interface RopeOptions {
  /** Points along the thread. */
  segments: number;
  /** Extra length over the straight distance, as a share (0.25 = a quarter longer: a sag). */
  slack: number;
  /** Pull downward, in world pixels per second squared. */
  gravity: number;
  /** How much motion is kept each step (0..1). */
  damping: number;
}

export const DEFAULT_ROPE: RopeOptions = { segments: 18, slack: 0.42, gravity: 520, damping: 0.982 };

export class ThreadRope {
  knots: Knot[] = [];
  private time = -1;

  constructor(private readonly options: RopeOptions = DEFAULT_ROPE) {}

  private init(ax: number, ay: number, bx: number, by: number) {
    const n = this.options.segments;
    this.knots = Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      // Start hanging in a sag, so the first frame already looks like thread.
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t + Math.sin(t * Math.PI) * Math.hypot(bx - ax, by - ay) * 0.18;
      return { x, y, px: x, py: y };
    });
  }

  /**
   * Advances to time `t` (seconds) with the ends pinned at a and b. A small breeze, from
   * `wind` (any number, for example the speaker's id hashed), keeps it from hanging dead.
   */
  step(t: number, ax: number, ay: number, bx: number, by: number, wind = 0) {
    if (this.knots.length === 0 || this.time < 0) {
      this.init(ax, ay, bx, by);
      this.time = t;
      return;
    }
    const dt = Math.max(0, Math.min(1 / 30, t - this.time));
    this.time = t;
    if (dt === 0) return;
    const { segments: n, slack, gravity, damping } = this.options;
    const k = this.knots;
    const breeze = Math.sin(t * 1.1 + wind) * 40 + Math.sin(t * 2.7 + wind * 1.7) * 22 + Math.sin(t * 5.3 + wind * 0.6) * 8;
    for (let i = 1; i < n; i++) {
      const p = k[i];
      const vx = (p.x - p.px) * damping;
      const vy = (p.y - p.py) * damping;
      p.px = p.x;
      p.py = p.y;
      p.x += vx + breeze * dt * dt * 6;
      p.y += vy + gravity * dt * dt;
    }
    k[0].x = k[0].px = ax;
    k[0].y = k[0].py = ay;
    k[n].x = k[n].px = bx;
    k[n].y = k[n].py = by;
    // At least a little length even when the ends are close, so a short thread still loops.
    const rest = (Math.max(30, Math.hypot(bx - ax, by - ay)) * (1 + slack)) / n;
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < n; i++) {
        const a = k[i];
        const b = k[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - rest) / d;
        const wa = i === 0 ? 0 : i + 1 === n ? 1 : 0.5;
        const wb = i + 1 === n ? 0 : i === 0 ? 1 : 0.5;
        a.x += dx * diff * wa;
        a.y += dy * diff * wa;
        b.x -= dx * diff * wb;
        b.y -= dy * diff * wb;
      }
    }
  }

  /** Strokes the thread as a smooth curve through its knots. */
  trace(ctx: CanvasRenderingContext2D) {
    const k = this.knots;
    if (k.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(k[0].x, k[0].y);
    for (let i = 1; i < k.length - 1; i++) {
      const mx = (k[i].x + k[i + 1].x) / 2;
      const my = (k[i].y + k[i + 1].y) / 2;
      ctx.quadraticCurveTo(k[i].x, k[i].y, mx, my);
    }
    const last = k[k.length - 1];
    ctx.lineTo(last.x, last.y);
  }
}

/**
 * Draws a thread as sewing thread: a soft shadow, the running stitch in the speaker's colour
 * (dashed, moving along it while the line is being written), and a small knot at the end.
 */
export function drawThread(
  ctx: CanvasRenderingContext2D,
  rope: ThreadRope,
  colour: string,
  alpha: number,
  t: number,
  options: { dashed?: 'speech' | 'thought'; flowing?: boolean; lineLook?: boolean } = {},
) {
  if (alpha <= 0.01 || rope.knots.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const dash = options.dashed === 'thought' ? [2, 3] : [6, 3];
  if (!options.lineLook) {
    ctx.save();
    ctx.translate(0.8, 1.4);
    ctx.globalAlpha = alpha * 0.22;
    ctx.strokeStyle = 'rgb(40, 26, 12)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash(dash);
    rope.trace(ctx);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = alpha * 0.85;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.3;
  ctx.setLineDash(dash);
  ctx.lineDashOffset = options.flowing ? -t * 18 : 0;
  rope.trace(ctx);
  ctx.stroke();
  ctx.setLineDash([]);
  const end = rope.knots[rope.knots.length - 1];
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(end.x, end.y, 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
