import { describe, expect, it } from 'vitest';
import { wellWaterIn } from '../simulation';

describe('wellWaterIn', () => {
  it('hears the water come back in plain statements', () => {
    expect(wellWaterIn('With a hiss, the Lamia uncoils and releases the water.')).toBe('flowing');
    expect(wellWaterIn("The well's water stops hissing and begins to flow.")).toBe('flowing');
    expect(wellWaterIn('Cold water gushes up from the stone mouth of the well.')).toBe('flowing');
    expect(wellWaterIn('At last the water returns to Zmeyovo.')).toBe('flowing');
  });
  it('hears the well run dry', () => {
    expect(wellWaterIn('By dusk the well runs dry again.')).toBe('dry');
  });
  it('ignores hints, negations and people going to the well', () => {
    expect(wellWaterIn('A single trembling drop of water begins to seep through the cracked stone.')).toBeNull();
    expect(wellWaterIn('The Lamia will not release the water until the oath is kept.')).toBeNull();
    expect(wellWaterIn('Baba Rada returns to the well with a basket of herbs.')).toBeNull();
    expect(wellWaterIn('Dry wind hisses up from the stone mouth.')).toBeNull();
  });
});
