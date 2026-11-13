export const MIN_ACTIVE_SPEED = 0.125; // 1/8× slowest active pace
export const MAX_SPEED = 10;
export const SLIDER_MAX_POS = 1000;
const ZERO_DEADBAND_RATIO = 0.032;
const SNAP_EPSILON_RATIO = 0.014;

export const SPEED_LOG_MARKS: ReadonlyArray<{ value: number; label: string }> = [
  { value: -10, label: '-10' },
  { value: -4, label: '-4' },
  { value: -2, label: '-2' },
  { value: -1, label: '-1' },
  { value: -0.5, label: '-½' },
  { value: -0.25, label: '-¼' },
  { value: 0, label: '0' },
  { value: 0.25, label: '¼' },
  { value: 0.5, label: '½' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 10, label: '10' },
];

const LOG_RATIO = Math.log2(MAX_SPEED / MIN_ACTIVE_SPEED);

/**
 * Map a signed normalized slider position `pos ∈ [-1000, +1000]` to a logarithmic
 * simulation speed multiplier `∈ [-10, +10]` with a center zero pause and gentle detent snapping.
 */
export function sliderPosToSpeed(pos: number): number {
  const clamped = Math.max(-SLIDER_MAX_POS, Math.min(SLIDER_MAX_POS, pos));
  const ratio = clamped / SLIDER_MAX_POS;
  if (Math.abs(ratio) <= ZERO_DEADBAND_RATIO) {
    return 0;
  }

  for (const mark of SPEED_LOG_MARKS) {
    if (mark.value === 0) continue;
    const markRatio = speedToSliderPos(mark.value) / SLIDER_MAX_POS;
    if (Math.abs(ratio - markRatio) <= SNAP_EPSILON_RATIO) {
      return mark.value;
    }
  }

  const sign = Math.sign(ratio);
  const t = (Math.abs(ratio) - ZERO_DEADBAND_RATIO) / (1 - ZERO_DEADBAND_RATIO);
  const mag = MIN_ACTIVE_SPEED * Math.pow(MAX_SPEED / MIN_ACTIVE_SPEED, t);
  const rounded = mag < 1 ? Math.round(mag * 100) / 100 : Math.round(mag * 10) / 10;
  return sign * Math.max(MIN_ACTIVE_SPEED, Math.min(MAX_SPEED, rounded));
}

/**
 * Inverse map from speed multiplier `∈ [-10, +10]` to signed slider position `∈ [-1000, +1000]`.
 */
export function speedToSliderPos(speed: number): number {
  if (!Number.isFinite(speed) || Math.abs(speed) < 0.001) {
    return 0;
  }
  const sign = Math.sign(speed);
  const mag = Math.max(MIN_ACTIVE_SPEED, Math.min(MAX_SPEED, Math.abs(speed)));
  const t = Math.log2(mag / MIN_ACTIVE_SPEED) / LOG_RATIO;
  const ratio = sign * (ZERO_DEADBAND_RATIO + t * (1 - ZERO_DEADBAND_RATIO));
  return Math.round(ratio * SLIDER_MAX_POS);
}

/** Percentage `[0, 100]` along the slider track for placing tick marks cleanly. */
export function speedToTrackPercent(speed: number): number {
  return ((speedToSliderPos(speed) + SLIDER_MAX_POS) / (2 * SLIDER_MAX_POS)) * 100;
}

/** Human-readable fraction/scalar readout (e.g. `¼×`, `½×`, `0×`, `-2×`, `1×`, `10×`). */
export function formatSpeedLabel(speed: number): string {
  if (!Number.isFinite(speed) || Math.abs(speed) < 0.001) return '0×';
  const sign = speed < 0 ? '-' : '';
  const abs = Math.abs(speed);
  if (Math.abs(abs - 0.25) < 0.015) return `${sign}¼×`;
  if (Math.abs(abs - 0.5) < 0.015) return `${sign}½×`;
  if (Math.abs(abs - 0.75) < 0.015) return `${sign}¾×`;
  if (Math.abs(abs - Math.round(abs)) < 0.04) return `${sign}${Math.round(abs)}×`;
  const formatted = abs < 1 ? abs.toFixed(2).replace(/0$/, '') : abs.toFixed(1).replace(/\.0$/, '');
  return `${sign}${formatted}×`;
}
