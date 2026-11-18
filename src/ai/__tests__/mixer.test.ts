import { describe, expect, it } from 'vitest';
import { busFor, effectiveLevel, mixerLevels, setLevel } from '../mixer';

describe('the mixer', () => {
  it('puts the narrator, the Traveler and characters on their own buses', () => {
    expect(busFor({ id: 'narrator' })).toBe('narrator');
    expect(busFor({ id: 'player', role: 'Traveler' })).toBe('guide');
    expect(busFor({ id: 'lamia', role: 'Serpent Keeper' })).toBe('voices');
  });

  it('keeps levels in range and applies the master to each bus', () => {
    setLevel('voices', 2);
    expect(mixerLevels().voices).toBe(1);
    setLevel('voices', 0.5);
    setLevel('master', 0.5);
    expect(effectiveLevel('voices')).toBe(0.25);
    expect(effectiveLevel('guide')).toBe(0.5);
    setLevel('voices', 1);
    setLevel('master', 1);
  });
});
