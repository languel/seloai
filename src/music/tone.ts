/**
 * How the band sounds, apart from what it plays: each instrument's level, how much breath and
 * noise is in it, and its character, from a clean electronic synth (0) through the usual (0.5)
 * to gritty and overdriven (1). The gaida's drone also has a voicing, a slow movement of its
 * tone, and beating between its reeds. The ambience is the room the band plays in and a tape
 * echo. Plain data, saved per device; the instruments read it as they play.
 */

export interface VoiceTone {
  /** 0 to 1 (0.8 is usual). */
  level: number;
  /** Breath and noise, 0 to 1 (0.5 is usual). */
  breath: number;
  /** 0 a clean electronic synth, 0.5 the usual, 1 gritty and overdriven. */
  character: number;
}

export type DroneVoicing = 'tonic' | 'fifth' | 'octave' | 'open';

export interface DroneTone extends VoiceTone {
  /** `tonic` alone, with the `fifth` above, with the `octave`, or `open` (all three). */
  voicing: DroneVoicing;
  /** How much the drone's tone drifts and swells on its own, 0 to 1. */
  movement: number;
  /** Beating between the drone's reeds, 0 (in tune) to 1 (a slow, wide shimmer). */
  beating: number;
}

export interface Ambience {
  /** How much of the room is heard, 0 (dry) to 1. */
  reverb: number;
  /** The room's size, 0 (a small house) to 1 (a gorge). */
  room: number;
  /** A tape echo, 0 (none) to 1. */
  echo: number;
}

export interface BandTone {
  gaida: VoiceTone;
  drone: DroneTone;
  kaval: VoiceTone;
  tapan: VoiceTone;
  ambience: Ambience;
}

export const DEFAULT_TONE: BandTone = {
  gaida: { level: 0.8, breath: 0.4, character: 0.5 },
  drone: { level: 0.8, breath: 0.35, character: 0.5, voicing: 'tonic', movement: 0.4, beating: 0.3 },
  kaval: { level: 0.8, breath: 0.5, character: 0.5 },
  tapan: { level: 0.8, breath: 0.5, character: 0.5 },
  ambience: { reverb: 0.4, room: 0.5, echo: 0.15 },
};

/** A few starting points for the whole band's sound. */
export const TONE_PRESETS: Record<string, { label: string; tone: BandTone }> = {
  village: { label: 'Village', tone: DEFAULT_TONE },
  synthfolk: {
    label: 'Synthfolk',
    tone: {
      gaida: { level: 0.75, breath: 0.1, character: 0.12 },
      drone: { level: 0.85, breath: 0.1, character: 0.1, voicing: 'open', movement: 0.75, beating: 0.55 },
      kaval: { level: 0.8, breath: 0.25, character: 0.15 },
      tapan: { level: 0.75, breath: 0.25, character: 0.15 },
      ambience: { reverb: 0.7, room: 0.85, echo: 0.45 },
    },
  },
  gritty: {
    label: 'Gritty',
    tone: {
      gaida: { level: 0.8, breath: 0.75, character: 0.9 },
      drone: { level: 0.8, breath: 0.7, character: 0.85, voicing: 'fifth', movement: 0.3, beating: 0.45 },
      kaval: { level: 0.8, breath: 0.85, character: 0.85 },
      tapan: { level: 0.85, breath: 0.75, character: 0.85 },
      ambience: { reverb: 0.25, room: 0.3, echo: 0.05 },
    },
  },
  mountain: {
    label: 'Mountain',
    tone: {
      gaida: { level: 0.7, breath: 0.45, character: 0.45 },
      drone: { level: 0.75, breath: 0.4, character: 0.4, voicing: 'octave', movement: 0.55, beating: 0.2 },
      kaval: { level: 0.9, breath: 0.65, character: 0.45 },
      tapan: { level: 0.6, breath: 0.5, character: 0.45 },
      ambience: { reverb: 0.75, room: 1, echo: 0.3 },
    },
  },
};

const c01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** A tone read from storage or an agent, with anything missing or out of range set right. */
export function normalizeTone(raw: unknown): BandTone {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown>>;
  const voice = (k: 'gaida' | 'kaval' | 'tapan'): VoiceTone => ({
    level: c01(r[k]?.level, DEFAULT_TONE[k].level),
    breath: c01(r[k]?.breath, DEFAULT_TONE[k].breath),
    character: c01(r[k]?.character, DEFAULT_TONE[k].character),
  });
  const d = r.drone ?? {};
  const voicing = (['tonic', 'fifth', 'octave', 'open'] as const).find((v) => v === d.voicing) ?? DEFAULT_TONE.drone.voicing;
  return {
    gaida: voice('gaida'),
    kaval: voice('kaval'),
    tapan: voice('tapan'),
    drone: {
      level: c01(d.level, DEFAULT_TONE.drone.level),
      breath: c01(d.breath, DEFAULT_TONE.drone.breath),
      character: c01(d.character, DEFAULT_TONE.drone.character),
      voicing,
      movement: c01(d.movement, DEFAULT_TONE.drone.movement),
      beating: c01(d.beating, DEFAULT_TONE.drone.beating),
    },
    ambience: {
      reverb: c01(r.ambience?.reverb, DEFAULT_TONE.ambience.reverb),
      room: c01(r.ambience?.room, DEFAULT_TONE.ambience.room),
      echo: c01(r.ambience?.echo, DEFAULT_TONE.ambience.echo),
    },
  };
}

/**
 * A waveshaper curve for a character: straight (clean) up to the usual, then a soft clip that
 * hardens and leans to one side (even harmonics, like a reed pushed too hard) towards gritty.
 */
export function gritCurve(character: number, size = 1024): Float32Array<ArrayBuffer> {
  const drive = character <= 0.5 ? 0 : (character - 0.5) * 2;
  const curve = new Float32Array(size);
  const k = 1 + drive * 9;
  const norm = Math.tanh(k);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = drive === 0 ? x : Math.tanh(k * (x + drive * 0.18 * x * x)) / norm;
  }
  return curve;
}
