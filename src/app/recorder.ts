/**
 * Recording a performance to a video file, in the browser:
 *
 *   - "world": the world's canvas as drawn (no panels, no pointer; no sound yet). Starts at once.
 *   - "app":   the whole app tab, panels, pointer, drawings and its sound. The browser lets a page
 *              capture itself only after a real click, so an agent's request shows a card the
 *              person clicks to start (which is also their consent); it can be declined.
 *
 * Stopping saves a .webm file through the browser's download.
 */

export type RecordWhat = 'world' | 'app';

interface Active {
  what: RecordWhat;
  recorder: MediaRecorder;
  chunks: Blob[];
  stream: MediaStream;
  startedAt: number;
  name: string;
}

let active: Active | null = null;
/** A request waiting for the person's click (whole-app recording). */
let pendingAsk: { name: string; resolve: (ok: boolean) => void } | null = null;
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const fn of listeners) fn();
};
export const subscribeRecorder = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const recorderVersion = () => version;

export function recordingState(): { recording: boolean; what?: RecordWhat; seconds?: number; waitingForClick: boolean } {
  return active
    ? { recording: true, what: active.what, seconds: Math.round((performance.now() - active.startedAt) / 100) / 10, waitingForClick: false }
    : { recording: false, waitingForClick: Boolean(pendingAsk) };
}

export function pendingRecordingAsk() {
  return pendingAsk ? { name: pendingAsk.name } : null;
}

function pickType(): string {
  for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}

function begin(what: RecordWhat, stream: MediaStream, name: string) {
  const type = pickType();
  const recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.start(1000);
  active = { what, recorder, chunks, stream, startedAt: performance.now(), name };
  // If the person stops sharing from the browser's own bar, finish and save.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (active?.stream === stream) void stopRecording();
  });
  changed();
}

/** Starts recording the world's canvas at once. */
function startWorld(name: string) {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.pixel-canvas');
  if (!canvas) throw new Error('The world is not showing. Switch to the village view first.');
  begin('world', canvas.captureStream(30), name);
}

/** Called from the card's button: the person's own click, which lets the page capture itself. */
export async function answerRecordingAsk(ok: boolean) {
  const ask = pendingAsk;
  pendingAsk = null;
  changed();
  if (!ask) return;
  if (!ok) return ask.resolve(false);
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 30 },
      audio: true,
      // Chrome: offer this tab first, and keep the capture on it.
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions);
    begin('app', stream, ask.name);
    ask.resolve(true);
  } catch {
    ask.resolve(false);
  }
}

/**
 * Starts a recording. For the whole app, waits for the person to click Start on the card (or
 * Not now); resolves false if they decline. A second start while recording does nothing.
 */
export async function startRecording(what: RecordWhat, name = 'performance'): Promise<{ started: boolean; note?: string }> {
  if (active) return { started: true, note: `Already recording the ${active.what}.` };
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
  if (what === 'world') {
    startWorld(name);
    return { started: true, note: 'Recording the world only: no panels, pointer or sound.' };
  }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser cannot record the app; record the world instead.');
  pendingAsk?.resolve(false);
  const started = await new Promise<boolean>((resolve) => {
    pendingAsk = { name, resolve };
    changed();
  });
  return started ? { started: true } : { started: false, note: 'The person did not start the recording.' };
}

/** Stops recording and saves the video; returns the file name and length. */
export async function stopRecording(): Promise<{ saved: boolean; file?: string; seconds?: number; megabytes?: number }> {
  const rec = active;
  if (!rec) return { saved: false };
  active = null;
  const stopped = new Promise<void>((r) => rec.recorder.addEventListener('stop', () => r(), { once: true }));
  rec.recorder.stop();
  await stopped;
  for (const t of rec.stream.getTracks()) t.stop();
  const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || 'video/webm' });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = `seloai-${rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'performance'}-${stamp}.webm`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  changed();
  return { saved: true, file, seconds: Math.round((performance.now() - rec.startedAt) / 100) / 10, megabytes: Math.round((blob.size / 1e6) * 10) / 10 };
}
