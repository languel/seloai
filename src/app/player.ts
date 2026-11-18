/**
 * The app's side of an exported performance (see `export_performance`): in player mode it tells
 * the page around it that it is ready, takes the performance (a world and a script) from that
 * page only, loads the world, runs the script, and reports how it is going, so the page can
 * offer to play it again. Nothing is saved (see playerMode.ts).
 */
import { seloToolHost } from '../api/seloToolRegistry';
import { PLAYER_MODE } from './playerMode';

export interface PerformancePayload {
  format: 'seloai-performance';
  version: 1;
  name: string;
  /** A whole project export (seloai-project-v1), without secrets or conversations. */
  project: string;
  steps: unknown[];
  world?: 'paused' | 'running';
}

export function startPlayerBridge(): () => void {
  if (!PLAYER_MODE || typeof window === 'undefined' || window.parent === window) return () => {};
  const parent = window.parent;
  const post = (msg: Record<string, unknown>) => parent.postMessage(msg, '*');
  let polling: ReturnType<typeof setInterval> | null = null;

  const play = async (payload: PerformancePayload) => {
    try {
      await seloToolHost.callTool('import_bundle', { json: payload.project });
      await seloToolHost.callTool('start_story', { paused: true });
      await seloToolHost.callTool('perform', { name: payload.name, steps: payload.steps, world: payload.world ?? 'paused' });
      post({ type: 'SELOAI_PLAYER_STATE', state: 'running' });
      if (polling) clearInterval(polling);
      polling = setInterval(async () => {
        const status = (await seloToolHost.callTool('performance_status', {})) as { state: string; step?: number; of?: number };
        post({ type: 'SELOAI_PLAYER_STATE', state: status.state, step: status.step, of: status.of });
        if (status.state !== 'running' && polling) {
          clearInterval(polling);
          polling = null;
          // The world goes on living after the performance.
          await seloToolHost.callTool('ui_action', { action: 'play' }).catch(() => undefined);
        }
      }, 1000);
    } catch (err) {
      post({ type: 'SELOAI_PLAYER_STATE', state: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const onMessage = (event: MessageEvent) => {
    // Only the page this player is embedded in may hand it a performance.
    if (event.source !== parent) return;
    const data = event.data as { type?: string; payload?: PerformancePayload };
    if (data?.type === 'SELOAI_PLAY' && data.payload?.format === 'seloai-performance') void play(data.payload);
  };
  window.addEventListener('message', onMessage);
  post({ type: 'SELOAI_PLAYER_READY' });
  return () => {
    window.removeEventListener('message', onMessage);
    if (polling) clearInterval(polling);
  };
}
