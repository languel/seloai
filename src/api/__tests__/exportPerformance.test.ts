import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { startHeadlessHost } from '../../headless/headlessHost';
import { seloToolHost } from '../seloToolRegistry';

const host = startHeadlessHost({ tickMs: 100 });
afterAll(() => host.stop());

describe('exporting a performance as playable HTML', () => {
  it('embeds the world and script safely, points at the app in player mode, and has no secrets', async () => {
    const steps = [{ narrate: 'Welcome. </script><script>alert(1)</script>' }, { wait: 1 }, { ui_action: { action: 'camera', focus: 'the whole map' } }];
    // PERF_OUT (by hand): write a small real tour instead, to open in a browser.
    const tour = [
      { narrate: 'Welcome to Zmeyovo, a village stitched in thread.' },
      { ui_action: { action: 'camera', focus: 'the whole map' } },
      { wait: 1 },
      { ui_action: { action: 'camera', focus: 'Lamia', zoom: 2.4 } },
      { draw: { shapes: [{ shape: 'arrow', at: 'Lamia', text: 'The Lamia guards the well', seconds: 6 }] } },
      { narrate: 'The Lamia has coiled around the well.' },
      { clear_drawings: {} },
    ];
    if (process.env.PERF_OUT) steps.splice(0, steps.length, ...(tour as typeof steps));
    const r = (await seloToolHost.callTool('export_performance', { name: 'Tour of Zmeyovo', steps, app_url: process.env.PERF_APP_URL ?? 'https://example.org/seloai/' })) as { file: string; html: string; plays_in: string };
    expect(r.file).toBe('tour-of-zmeyovo.html');
    expect(r.html).toContain('?player=1');
    // The script text cannot close the data block.
    expect(r.html.split('</script>').length).toBe(3);
    const data = JSON.parse(r.html.split('id="performance">')[1].split('</script>')[0]);
    expect(data.format).toBe('seloai-performance');
    if (!process.env.PERF_OUT) expect(data.steps[0].narrate).toContain('</script>');
    const project = JSON.parse(data.project);
    expect(project.conversations).toEqual([]);
    expect(project.map.name).toBe(host.store.document.map.name);
    expect(JSON.stringify(project.modelSettings)).not.toMatch(/"localApiKey":"[^"]+"/);
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, r.html);
  });

  it('refuses a script with unknown tools before saving anything', async () => {
    await expect(seloToolHost.callTool('export_performance', { name: 'x', steps: [{ tool: 'nope' }] })).rejects.toThrow(/Unknown or not allowed/);
  });
});
