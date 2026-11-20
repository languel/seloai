import type { VillageSimulation } from './simulation';
import { bakeScene } from '../world/worldScene';

const DANCE_WORDS = /\b(danc\w*|khoro|horo|celebrat\w*|festiv\w*|wedding|feast|music)\b/i;
const danceGrounds = new WeakMap<object, Array<[number, number, number, number]>>();

/**
 * Whether a character is dancing: standing still and not talking, either because what they
 * are doing is a dance or a celebration, or because they stand on a dancing ground.
 * Everyone else keeps their arms down.
 */
export function isDancing(sim: VillageSimulation, body: { id: string; tileX: number; tileY: number; tileDim: number; moving: boolean; state?: string }): boolean {
  if (body.moving || body.state === 'speaking' || body.state === 'walking' || body.state === 'thinking') return false;
  const label = sim.runtimes.get(body.id)?.activityLabel ?? '';
  if (DANCE_WORDS.test(label)) return true;
  const scene = sim.map.scene;
  if (!scene) return false;
  let grounds = danceGrounds.get(scene);
  if (!grounds) {
    grounds = bakeScene(scene).model.features.filter((f) => f.kind === 'star').map((f): [number, number, number, number] => [f.x - 0.5, f.y - 0.5, f.x + f.w + 0.5, f.y + f.h + 0.5]);
    danceGrounds.set(scene, grounds);
  }
  const x = body.tileX / body.tileDim + 0.5;
  const y = body.tileY / body.tileDim + 0.5;
  return grounds.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

