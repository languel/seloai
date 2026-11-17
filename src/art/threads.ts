/**
 * Conversation threads: while characters talk, a thread of running stitch hangs between
 * them, sagging like a real thread. When someone is speaking, the stitches run from the
 * speaker toward the listener and a small knot travels along it, so who is talking to whom
 * reads at a glance. A first step toward thread as a mechanic (section 9 of the art notes).
 */
import { clothPalette, type PaletteName } from './looks';

export interface ThreadEnd {
  id: string;
  /** Screen-space anchor at chest height, in world pixels. */
  x: number;
  y: number;
  speaking: boolean;
  conversationId: string;
}

/** Pairs to join: everyone in a conversation, in a chain, speaker first where there is one. */
export function threadPairs(ends: ThreadEnd[]): Array<[ThreadEnd, ThreadEnd]> {
  const groups = new Map<string, ThreadEnd[]>();
  for (const end of ends) {
    const list = groups.get(end.conversationId) ?? [];
    list.push(end);
    groups.set(end.conversationId, list);
  }
  const pairs: Array<[ThreadEnd, ThreadEnd]> = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => Number(b.speaking) - Number(a.speaking) || a.id.localeCompare(b.id));
    for (let i = 1; i < ordered.length; i++) pairs.push([ordered[0], ordered[i]]);
  }
  return pairs;
}

/** A point on the sagging thread between a and b, t in 0..1. */
export function threadPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number): [number, number] {
  const sag = Math.min(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.22);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 + sag;
  const u = 1 - t;
  return [u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y];
}

export function drawConversationThreads(ctx: CanvasRenderingContext2D, ends: ThreadEnd[], look: PaletteName, timeSec: number) {
  const palette = clothPalette(look);
  const thread = look === 'ink' || look === 'night' ? palette.inks.dark : palette.inks.primary;
  const lineLook = look === 'ink' || look === 'night';
  ctx.save();
  ctx.lineCap = 'round';
  for (const [speaker, listener] of threadPairs(ends)) {
    const flowing = speaker.speaking;
    const sag = Math.min(40, Math.hypot(listener.x - speaker.x, listener.y - speaker.y) * 0.22);
    const cx = (speaker.x + listener.x) / 2;
    const cy = (speaker.y + listener.y) / 2 + sag;
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(speaker.x, speaker.y);
      ctx.quadraticCurveTo(cx, cy, listener.x, listener.y);
    };
    // Running stitch: dashes that move from speaker to listener while words are spoken.
    ctx.setLineDash([5, 3.5]);
    ctx.lineDashOffset = flowing ? -timeSec * 14 : 0;
    if (!lineLook) {
      ctx.strokeStyle = 'rgba(40, 26, 12, 0.22)';
      ctx.lineWidth = 1.6;
      ctx.save();
      ctx.translate(0.8, 1);
      trace();
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = thread;
    ctx.globalAlpha = flowing ? 0.9 : 0.55;
    ctx.lineWidth = lineLook ? 1 : 1.4;
    trace();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    if (flowing) {
      const t = (timeSec * 0.55) % 1;
      const [kx, ky] = threadPoint(speaker, listener, t);
      ctx.fillStyle = lineLook ? palette.inks.dark : palette.inks.gold;
      ctx.beginPath();
      ctx.arc(kx, ky, lineLook ? 1.6 : 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
