/** Pure listener-relative audio mix maths (no audio API dependency). */

export interface SpatialMix {
  gain: number;
  pan: number;
  distance: number;
  inRange: boolean;
}

export const EAVESDROP_SLIDER_MAX = 25;
export const EAVESDROP_WHOLE_MAP_THRESHOLD = 90;
export const EAVESDROP_WHOLE_MAP_RADIUS = 999;

export function isWholeMapEavesdrop(radiusTiles: number): boolean {
  return radiusTiles >= EAVESDROP_WHOLE_MAP_THRESHOLD;
}

export function computeSpatialMix(
  speakerX: number,
  speakerY: number,
  listenerX: number,
  listenerY: number,
  radiusTiles = 9,
): SpatialMix {
  const dx = speakerX - listenerX;
  const dy = speakerY - listenerY;
  const distance = Math.hypot(dx, dy);
  if (radiusTiles <= 0) {
    return { gain: 0, pan: 0, distance, inRange: false };
  }
  if (isWholeMapEavesdrop(radiusTiles)) {
    const normalized = Math.max(0, 1 - distance / 90);
    const gain = Math.max(0.38, Math.min(1, 0.38 + 0.62 * Math.pow(normalized, 1.1)));
    const pan = Math.max(-0.85, Math.min(0.85, dx / 24));
    return { gain, pan, distance, inRange: true };
  }
  if (distance >= radiusTiles) {
    return { gain: 0, pan: 0, distance, inRange: false };
  }
  const normalized = 1 - distance / radiusTiles;
  const gain = Math.max(0, Math.min(1, Math.pow(normalized, 1.5)));
  const pan = Math.max(-0.92, Math.min(0.92, dx / Math.max(1, radiusTiles * 0.65)));
  return { gain, pan, distance, inRange: gain > 0.03 };
}
