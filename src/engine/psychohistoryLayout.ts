import type { PsychoLink, PsychoNode, RelationKind } from './psychohistory';

/**
 * Where Psychohistory's nodes lie, settled by a gentle force simulation: nodes keep apart,
 * threads draw what they join together (each kind of relation to its own length), and every
 * node is held loosely near its place on the map, places more firmly than people, so the
 * web reads as an abstract map of the village. A node someone has moved by hand is pinned
 * where they put it until released. Units are map cells. Pure apart from the state it is given.
 */

export interface LayoutBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
}

export interface LayoutState {
  bodies: Map<string, LayoutBody>;
  /** How lively the layout still is, 1 after a change, settling towards 0. */
  heat: number;
}

/** The rest length of each kind of thread, in cells. */
const REST: Record<RelationKind, number> = { at: 2.2, keeps: 2.6, talked: 4.5, heading: 6, thinks: 7.5 };
/** How hard each kind of thread pulls. */
const PULL: Record<RelationKind, number> = { at: 0.09, keeps: 0.08, talked: 0.05, heading: 0.025, thinks: 0.012 };
const REPEL = 9;
const HOME_PLACE = 0.05;
const HOME_PERSON = 0.006;
const DAMPING = 0.82;

export function createLayout(): LayoutState {
  return { bodies: new Map(), heat: 1 };
}

/** Adds bodies for new nodes (at their map position) and drops those that are gone. */
export function syncLayout(state: LayoutState, nodes: PsychoNode[]): void {
  const ids = new Set(nodes.map((n) => n.id));
  let changed = false;
  for (const id of [...state.bodies.keys()]) {
    if (!ids.has(id)) {
      state.bodies.delete(id);
      changed = true;
    }
  }
  for (const n of nodes) {
    if (state.bodies.has(n.id)) continue;
    // Start where it is on the map, with a nudge so two at one spot do not sit on each other.
    const jitter = (hash(n.id) % 100) / 100 - 0.5;
    state.bodies.set(n.id, { x: n.mapX + jitter, y: n.mapY - jitter, vx: 0, vy: 0, pinned: false });
    changed = true;
  }
  if (changed) state.heat = Math.max(state.heat, 0.8);
}

/** Lets the web settle a little; call once a frame. Returns how much it moved. */
export function stepLayout(state: LayoutState, nodes: PsychoNode[], links: PsychoLink[]): number {
  const heat = state.heat;
  if (heat < 0.02) return 0;
  const list = nodes.map((n) => ({ n, b: state.bodies.get(n.id)! })).filter((e) => e.b);
  const fx = new Map<string, { x: number; y: number }>();
  for (const { n } of list) fx.set(n.id, { x: 0, y: 0 });

  // Nodes keep apart (people and places alike), more strongly up close.
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      let dx = a.b.x - b.b.x;
      let dy = a.b.y - b.b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = 0.1;
        dy = 0.05;
        d2 = 0.0125;
      }
      const d = Math.sqrt(d2);
      const f = REPEL / Math.max(d2, 0.6);
      fx.get(a.n.id)!.x += (dx / d) * f;
      fx.get(a.n.id)!.y += (dy / d) * f;
      fx.get(b.n.id)!.x -= (dx / d) * f;
      fx.get(b.n.id)!.y -= (dy / d) * f;
    }
  }

  // Threads draw what they join towards their rest length.
  for (const l of links) {
    const a = state.bodies.get(l.source);
    const b = state.bodies.get(l.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(0.01, Math.hypot(dx, dy));
    const f = (d - REST[l.kind]) * PULL[l.kind] * (0.5 + l.weight);
    fx.get(l.source)!.x += (dx / d) * f;
    fx.get(l.source)!.y += (dy / d) * f;
    fx.get(l.target)!.x -= (dx / d) * f;
    fx.get(l.target)!.y -= (dy / d) * f;
  }

  // Everything is held loosely near its place on the map.
  for (const { n, b } of list) {
    const k = n.kind === 'place' ? HOME_PLACE : HOME_PERSON;
    fx.get(n.id)!.x += (n.mapX - b.x) * k;
    fx.get(n.id)!.y += (n.mapY - b.y) * k;
  }

  let moved = 0;
  for (const { n, b } of list) {
    if (b.pinned) {
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    const f = fx.get(n.id)!;
    b.vx = (b.vx + f.x * heat) * DAMPING;
    b.vy = (b.vy + f.y * heat) * DAMPING;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 1.2) {
      b.vx *= 1.2 / sp;
      b.vy *= 1.2 / sp;
    }
    b.x += b.vx;
    b.y += b.vy;
    moved += Math.abs(b.vx) + Math.abs(b.vy);
  }
  // It settles, but never quite stops while things are moving: the world is alive.
  state.heat = Math.max(0.06, heat * 0.985);
  return moved;
}

/** Wakes the layout (after the web changed or something was moved by hand). */
export function warmLayout(state: LayoutState, heat = 0.6): void {
  state.heat = Math.max(state.heat, heat);
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
