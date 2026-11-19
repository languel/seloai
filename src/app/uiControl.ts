/**
 * The app's controls, reachable from code: everything a person can do with the interface
 * (switch views, open and close the side panel, move the camera, toggle what is shown) is
 * registered here by the part of the app that owns it, so agents (Spinner, MCP, WebMCP) and
 * scripted performances can drive the app completely. Parts register while they are on
 * screen; a command for a part that is not showing says so.
 */

export type PanelMode = 'storyline' | 'spinner' | 'style' | 'sound' | 'data' | 'closed';
export type ShowWhat = 'paths' | 'labels' | 'speech_bubbles' | 'thought_bubbles' | 'subtitles' | 'performance';

export interface CameraCommand {
  /** The centre to look at, in cells. */
  x?: number;
  y?: number;
  /** How close: 1 is usual; "whole" fits the whole map. */
  zoom?: number | 'whole';
  /** Follow this character (by id) as they move. */
  follow?: string | null;
  /** Cut straight there, or glide (the default). */
  move?: 'cut' | 'glide';
}

export interface AppControls {
  state(): { tab: string; panel: PanelMode; topBarHidden: boolean };
  setTab(tab: string): void;
  setPanel(mode: PanelMode): void;
  setTopBar(show: boolean): void;
  exportImage(what: 'view' | 'tapestry'): void;
}

export interface VillageControls {
  state(): {
    camera: { x: number; y: number; zoom: number; minZoom: number; following: string | null; storyCamera: boolean };
    selected: string | null;
    shown: Record<ShowWhat, boolean>;
  };
  camera(cmd: CameraCommand): void;
  storyCamera(on: boolean): void;
  select(id: string): void;
  show(what: ShowWhat, on: boolean): void;
  /** Where a character is now, in cells. */
  characterCell(id: string): { x: number; y: number } | null;
  /** A point in cells to a point on the screen (CSS pixels, viewport), or null when off view. */
  worldToScreen(x: number, y: number): { x: number; y: number } | null;
}

const parts: { app?: AppControls; village?: VillageControls } = {};
const listeners = new Set<() => void>();

export function registerControls<K extends keyof typeof parts>(part: K, controls: NonNullable<(typeof parts)[K]>): () => void {
  parts[part] = controls as (typeof parts)[K];
  for (const fn of listeners) fn();
  return () => {
    if (parts[part] === controls) delete parts[part];
  };
}

export function appControls(): AppControls {
  if (!parts.app) throw new Error('The app is not open in a browser tab.');
  return parts.app;
}

export function villageControls(): VillageControls {
  if (!parts.village) throw new Error('The village view is not showing. Switch to it first (ui_action tab "village").');
  return parts.village;
}

export function hasVillage(): boolean {
  return Boolean(parts.village);
}

export function onControlsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
