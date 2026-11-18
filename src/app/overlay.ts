/**
 * What an agent shows over the app while it works or gives a walkthrough: drawings (arrows,
 * rings, boxes and labels, pinned to a place in the world, to a part of the interface, or to
 * the screen), a caption for what it is saying, and a virtual pointer that moves to buttons,
 * tabs and menus by their names and clicks, hovers, chooses and types like a person would.
 */
import { villageControls, hasVillage } from './uiControl';

/** Where a drawing is: a point in the world (cells), a part of the interface (by its name), or a point on the screen. */
export type Anchor = { world: { x: number; y: number } } | { character: string } | { ui: string } | { screen: { x: number; y: number } };

export interface Drawing {
  id: string;
  shape: 'arrow' | 'ring' | 'box' | 'label' | 'underline' | 'dot';
  at: Anchor;
  /** Where an arrow comes from (it points at `at`); left out, it comes in from above left. */
  from?: Anchor;
  text?: string;
  colour?: string;
  /** Size in pixels: a ring's radius, a dot's radius, a label's text size. */
  size?: number;
  /** When it goes (ms since page load); left out, it stays until cleared. */
  until?: number;
}

export interface Caption {
  speaker: string;
  text: string;
  until?: number;
}

export interface Pointer {
  x: number;
  y: number;
  visible: boolean;
  /** Pressed: drawn as a click ripple. */
  pressedAt: number;
}

interface OverlayState {
  drawings: Drawing[];
  caption: Caption | null;
  pointer: Pointer;
}

export const overlay: OverlayState = {
  drawings: [],
  caption: null,
  pointer: { x: -100, y: -100, visible: false, pressedAt: 0 },
};

const listeners = new Set<() => void>();
let version = 0;
export const subscribeOverlay = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const overlayVersion = () => version;
function changed() {
  version++;
  for (const fn of listeners) fn();
}

let nextId = 1;
export function addDrawings(list: Array<Omit<Drawing, 'id'> & { id?: string }>): string[] {
  const ids: string[] = [];
  for (const d of list) {
    const id = d.id ?? `d${nextId++}`;
    overlay.drawings = [...overlay.drawings.filter((x) => x.id !== id), { ...d, id }];
    ids.push(id);
  }
  changed();
  return ids;
}

export function clearDrawings(ids?: string[]) {
  overlay.drawings = ids?.length ? overlay.drawings.filter((d) => !ids.includes(d.id)) : [];
  changed();
}

export function setCaption(caption: Caption | null) {
  overlay.caption = caption;
  changed();
}

/** Drops drawings and captions whose time has run out (called by the overlay each frame). */
export function expireOverlay(now: number) {
  const before = overlay.drawings.length;
  overlay.drawings = overlay.drawings.filter((d) => !d.until || d.until > now);
  const captionGone = overlay.caption?.until !== undefined && overlay.caption.until <= now;
  if (captionGone) overlay.caption = null;
  if (captionGone || overlay.drawings.length !== before) changed();
}

// ---------------------------------------------------------------------------------------------
// Finding parts of the interface by name
// ---------------------------------------------------------------------------------------------

const CANDIDATES = 'button, [role="tab"], [role="option"], [role="button"], a[href], input, select, textarea, summary, [aria-label], [title], label';

/** Shown on the page (it may be scrolled out of view: see onScreen). */
function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The names an element goes by: its label, title, placeholder and visible text. */
function namesOf(el: Element): string[] {
  const out = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), (el as HTMLElement).innerText?.slice(0, 80)];
  return out.map(clean).filter(Boolean);
}

/**
 * The part of the interface a name means: "Style" (the tab), "Zoom in", "Show speech bubbles",
 * "Download Spinner", "Message Spinner". Exact names first, then names that start with it, then
 * names that contain it. Ignores the agent's own overlay. Throws with what is near when not found.
 */
export function findUi(name: string): HTMLElement {
  const want = clean(name).replace(/\s+(tab|button|menu|field|box)$/, '');
  const all = [...document.querySelectorAll<HTMLElement>(CANDIDATES)].filter((el) => !el.closest('[data-agent-overlay]') && visible(el));
  const score = (el: HTMLElement) => {
    const names = namesOf(el);
    if (names.some((n) => n === want)) return 3;
    if (names.some((n) => n.startsWith(want))) return 2;
    if (names.some((n) => n.includes(want))) return 1;
    return 0;
  };
  let best: HTMLElement | null = null;
  let bestScore = 0;
  let bestArea = Infinity;
  for (const el of all) {
    // On screen beats scrolled out of view (which a pointer scrolls to first).
    const s = score(el) && score(el) * 2 + (onScreen(el) ? 1 : 0);
    if (!s) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    // A better match wins; between equals, the smallest (the control itself, not its container).
    if (s > bestScore || (s === bestScore && area < bestArea)) {
      best = el;
      bestScore = s;
      bestArea = area;
    }
  }
  if (!best) {
    const near = [...new Set(all.filter(onScreen).flatMap((el) => namesOf(el).filter((n) => n.length <= 40)))].slice(0, 40);
    throw new Error(`Nothing on screen called "${name}". Some of what is there: ${near.join(' | ')}`);
  }
  return best;
}

/** Where an anchor is on the screen now (CSS pixels), or null when it is off view. */
export function anchorPoint(at: Anchor): { x: number; y: number; w?: number; h?: number } | null {
  if ('screen' in at) return at.screen;
  if ('world' in at) {
    if (!hasVillage()) return null;
    const v = villageControls();
    const p = v.worldToScreen(at.world.x, at.world.y);
    if (!p) return null;
    // A place is about three cells across, at whatever the zoom is.
    const right = v.worldToScreen(at.world.x + 1, at.world.y);
    const cell = right ? Math.abs(right.x - p.x) : 20;
    return { ...p, w: cell * 3, h: cell * 3 };
  }
  if ('character' in at) {
    if (!hasVillage()) return null;
    const v = villageControls();
    const cell = v.characterCell(at.character);
    // About chest height: a little above the cell the figure stands in.
    const p = cell ? v.worldToScreen(cell.x, cell.y - 0.6) : null;
    return p ? { ...p, w: 36, h: 56 } : null;
  }
  try {
    const r = findUi(at.ui).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The virtual pointer
// ---------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Glides the pointer to a point, easing in and out, over about `ms` milliseconds. */
export async function movePointer(to: { x: number; y: number }, ms = 650): Promise<void> {
  const p = overlay.pointer;
  if (!p.visible) {
    // Appears near where it is going, a little below right, as if the hand came in.
    p.x = Math.min(innerWidth - 10, to.x + 120);
    p.y = Math.min(innerHeight - 10, to.y + 90);
    p.visible = true;
  }
  const from = { x: p.x, y: p.y };
  const start = performance.now();
  const dur = Math.max(0, ms);
  while (true) {
    const t = dur === 0 ? 1 : Math.min(1, (performance.now() - start) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    // A slight arc, as a hand moves.
    const arc = Math.sin(Math.PI * t) * Math.min(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.12);
    p.x = from.x + (to.x - from.x) * e;
    p.y = from.y + (to.y - from.y) * e - arc;
    changed();
    if (t >= 1) break;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  }
}

export function hidePointer() {
  overlay.pointer.visible = false;
  changed();
}

function press() {
  overlay.pointer.pressedAt = performance.now();
  changed();
}

/** Sets a form field's value so the app sees it as typed (React listens for input events). */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export type PointerAction = 'move' | 'click' | 'hover' | 'choose' | 'type' | 'press_enter';

/**
 * Does what a person's pointer would: moves to a part of the interface (or a point in the
 * world), then clicks, hovers to show its tip, chooses an option in a menu, or types into a
 * field. Returns what it touched.
 */
export async function pointerDo(target: Anchor, action: PointerAction, value?: string, ms = 650): Promise<{ touched: string }> {
  let el: HTMLElement | null = null;
  let point: { x: number; y: number } | null;
  if ('ui' in target) {
    el = findUi(target.ui);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    point = { x: r.left + Math.min(r.width / 2, 24), y: r.top + r.height / 2 };
  } else point = anchorPoint(target);
  if (!point) throw new Error('That place is not in view. Move the camera there first.');
  await movePointer(point, ms);
  const name = el ? namesOf(el)[0] ?? el.tagName.toLowerCase() : 'the world';

  if (action === 'move') return { touched: name };
  if (action === 'hover') {
    if (el) {
      el.classList.add('agent-hover');
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      setTimeout(() => el?.classList.remove('agent-hover'), 2500);
    }
    return { touched: name };
  }
  if (action === 'click') {
    press();
    await sleep(120);
    if (el) {
      el.focus?.({ preventScroll: true });
      el.click();
    } else {
      // A click on the world: what the canvas would get under the pointer.
      const under = document.elementFromPoint(point.x, point.y);
      for (const type of ['pointerdown', 'pointerup', 'click'] as const) {
        under?.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: point.x, clientY: point.y, pointerId: 1, isPrimary: true }));
      }
    }
    await sleep(80);
    return { touched: name };
  }
  if (!el) throw new Error(`"${action}" needs a part of the interface, not a point.`);
  if (action === 'choose') {
    // A menu: the select itself, or one inside the thing named (the stitched dropdowns).
    const select = el instanceof HTMLSelectElement ? el : el.querySelector('select') ?? el.closest('span, label, div')?.querySelector('select');
    if (!select) throw new Error(`"${name}" is not a menu.`);
    const wanted = clean(value);
    const option = [...select.options].find((o) => clean(o.text) === wanted || clean(o.value) === wanted) ?? [...select.options].find((o) => clean(o.text).includes(wanted));
    if (!option) throw new Error(`"${name}" has no option "${value}". Options: ${[...select.options].map((o) => o.text).join(' | ')}`);
    press();
    await sleep(120);
    setFieldValue(select, option.value);
    return { touched: `${name}: ${option.text}` };
  }
  if (action === 'type' || action === 'press_enter') {
    const field = (el.matches('input, textarea') ? el : el.querySelector('input, textarea')) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!field && action === 'type') throw new Error(`"${name}" is not a field to type in.`);
    press();
    field?.focus({ preventScroll: true });
    if (action === 'type' && field) {
      // Typed out a little at a time, so it reads as typing on a recording.
      const text = value ?? '';
      const step = Math.max(1, Math.ceil(text.length / 30));
      for (let i = step; i < text.length + step; i += step) {
        setFieldValue(field, text.slice(0, i));
        await sleep(25);
      }
    } else {
      // Sends the field's form if it has one (what Enter does there), else presses Enter on it.
      const target = field ?? el;
      const form = target.closest('form');
      if (form) form.requestSubmit();
      else target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    }
    return { touched: name };
  }
  return { touched: name };
}
