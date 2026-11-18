import { describe, expect, it } from 'vitest';
import { GUIDED_TOURS } from '../../app/guidedTours';
import { SELO_TOOL_DEFINITIONS } from '../seloToolRegistry';
import { PI_TOOL_NAMES } from '../authoringTools';
import type { VillageMap, VillagerConfig } from '../../engine/types';

const known = new Set(SELO_TOOL_DEFINITIONS.map((t) => t.name));
const cast = [
  { id: 'narrator', name: 'The Scribe' },
  { id: 'rada', name: 'Baba Rada', role: 'Herb-keeper' },
] as unknown as VillagerConfig[];
const map = { pointsOfInterest: [{ id: 'p1', tag: 'Well', label: 'Well', x: 3, y: 4 }] } as unknown as VillageMap;

describe('guided tours', () => {
  it('only use tools the app has, and never change the world or a setting', () => {
    const changing = new Set(['new_world', 'add_character', 'set_appearance', 'change_setting', 'change_settings', 'instruct_world', 'remove_character', 'mixer']);
    for (const tour of GUIDED_TOURS) {
      const steps = tour.steps({ cast, map });
      expect(steps.length).toBeGreaterThan(10);
      for (const step of steps) {
        if (typeof step.wait === 'number') continue;
        const tool = Object.keys(step).find((k) => known.has(k));
        expect(tool, JSON.stringify(step)).toBeTruthy();
        expect(changing.has(tool!), `${tour.id} changes things: ${tool}`).toBe(false);
      }
    }
  });

  it('introduce a real character and place from the open world', () => {
    const text = JSON.stringify(GUIDED_TOURS[0].steps({ cast, map }));
    expect(text).toContain('Baba Rada');
    expect(text).toContain('Well');
    expect(text).not.toContain('This is The Scribe');
  });

  it('can be started by Spinner', () => {
    expect(known.has('guided_tour')).toBe(true);
    expect((PI_TOOL_NAMES as readonly string[]).includes('guided_tour')).toBe(true);
  });
});
