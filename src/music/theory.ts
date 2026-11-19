/**
 * The musical language the village plays in: modes heard over a drone, and the Balkan dance
 * meters (aksak), each a bar of short units grouped in twos and threes. Pure data.
 */

export type ModeId = 'mixolydian' | 'ionian' | 'dorian' | 'aeolian' | 'phrygian' | 'hijaz' | 'ukrainianDorian';

/** Semitones above the tonic for scale degrees 0 to 6. */
export const MODES: Record<ModeId, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  /** Phrygian dominant, makam hicaz: the augmented second that sounds of the east and of danger. */
  hijaz: [0, 1, 4, 5, 7, 8, 10],
  /** Dorian with a raised fourth: restless, very Balkan. */
  ukrainianDorian: [0, 2, 3, 6, 7, 9, 10],
};

export type DanceId = 'free' | 'bavno' | 'pravo' | 'paidushko' | 'lesnoto' | 'rachenitsa' | 'daychovo' | 'kopanitsa';

export interface Dance {
  id: DanceId;
  label: string;
  /** A bar as groups of short units; empty for free rhythm. */
  groups: readonly number[];
  /** Seconds per unit at the slowest and the fastest it is played. */
  unit: readonly [number, number];
}

export const DANCES: Record<DanceId, Dance> = {
  free: { id: 'free', label: 'free rhythm', groups: [], unit: [0, 0] },
  bavno: { id: 'bavno', label: 'bavno (slow, 2/4)', groups: [2, 2], unit: [0.34, 0.25] },
  pravo: { id: 'pravo', label: 'pravo horo (2/4)', groups: [2, 2], unit: [0.21, 0.13] },
  paidushko: { id: 'paidushko', label: 'paidushko (5/16, 2+3)', groups: [2, 3], unit: [0.2, 0.115] },
  lesnoto: { id: 'lesnoto', label: 'lesnoto (7/8, 3+2+2)', groups: [3, 2, 2], unit: [0.24, 0.15] },
  rachenitsa: { id: 'rachenitsa', label: 'rachenitsa (7/16, 2+2+3)', groups: [2, 2, 3], unit: [0.16, 0.092] },
  daychovo: { id: 'daychovo', label: 'daychovo (9/16, 2+2+2+3)', groups: [2, 2, 2, 3], unit: [0.17, 0.1] },
  kopanitsa: { id: 'kopanitsa', label: 'kopanitsa (11/16, 2+2+3+2+2)', groups: [2, 2, 3, 2, 2], unit: [0.14, 0.085] },
};

/** The village's key: the gaida's chanter tonic, D4. The drone sounds two octaves below. */
export const TONIC_MIDI = 62;

/** MIDI note for a scale degree (0 is the tonic, 7 the octave, -1 the note below). */
export function degreeToMidi(degree: number, mode: ModeId, tonic = TONIC_MIDI): number {
  const steps = MODES[mode];
  const octave = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return tonic + octave * 12 + steps[idx];
}

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
