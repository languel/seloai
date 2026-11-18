import { afterAll, describe, expect, it } from 'vitest';
import { startHeadlessHost } from '../../headless/headlessHost';
import { seloToolHost, SELO_TOOL_DEFINITIONS } from '../seloToolRegistry';

const host = startHeadlessHost({ tickMs: 100 });
afterAll(() => host.stop());
const call = (name: string, args: Record<string, unknown> = {}) => seloToolHost.callTool(name, args);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('performances', () => {
  it('lists the tools for driving the app and performing', () => {
    const names = SELO_TOOL_DEFINITIONS.map((t) => t.name);
    for (const n of ['ui_state', 'ui_action', 'pointer', 'draw', 'clear_drawings', 'narrate', 'perform', 'performance_status', 'stop_performance', 'start_recording', 'stop_recording']) expect(names).toContain(n);
  });

  it('runs a script of tools and waits in the background, in any of the step shapes', async () => {
    const started = await call('perform', {
      name: 'setup',
      steps: [
        { tool: 'set_story', args: { place: 'Lindenfeld', premise: 'The bells have gone silent.' } },
        { wait: 0.1 },
        { add_place: { name: 'Bell Tower', x: 10, y: 10 } },
        { tool: 'story_overview' },
      ],
    });
    expect(started.steps).toBe(4);
    for (let i = 0; i < 40 && (await call('performance_status')).state === 'running'; i++) await sleep(50);
    const status = await call('performance_status');
    expect(status.state).toBe('done');
    expect(status.failed).toEqual([]);
    expect(host.store.document.context.settingName).toBe('Lindenfeld');
    expect((host.store.document.map.pointsOfInterest ?? []).some((p) => p.label === 'Bell Tower')).toBe(true);
  });

  it('reports a failing step and carries on; refuses unknown tools and nested performances up front', async () => {
    await call('perform', { steps: [{ tool: 'add_things', args: { thing: 'dragon' } }, { tool: 'story_overview' }] });
    for (let i = 0; i < 40 && (await call('performance_status')).state === 'running'; i++) await sleep(50);
    const status = await call('performance_status');
    expect(status.state).toBe('done');
    expect(status.failed[0]).toMatch(/step 1 \(add_things\): Cannot place/);
    await expect(call('perform', { steps: [{ tool: 'no_such_tool' }] })).rejects.toThrow(/Unknown or not allowed/);
    await expect(call('perform', { steps: [{ tool: 'perform', args: {} }] })).rejects.toThrow(/not allowed/);
    await expect(call('perform', { steps: [{ bogus: true }] })).rejects.toThrow(/Step not understood/);
  });

  it('says plainly when the app is not open (headless)', async () => {
    await expect(call('ui_state')).rejects.toThrow(/not open in a browser tab/);
    await expect(call('ui_action', { action: 'camera', focus: 'the well' })).rejects.toThrow(/village view is not showing/);
  });
});
