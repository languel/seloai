import { createBrowserSimulation } from '../../app/browserSimulation';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { SeloToolHost, seloToolHost } from '../seloToolRegistry';
import { installSeloWebMcpAndApi } from '../webMcpBridge';
import { createBlankWorldMap } from '../../storage/villageStore';

describe('Agent tools', () => {
  it('exposes full autonomous world/character/scenario tools to API, WebMCP, and stdio MCP server', async () => {
    let map = createDefaultMap();
    let villagers = structuredClone(DEFAULT_VILLAGERS.slice(0, 2));
    let settings = { ...DEFAULT_MODEL_SETTINGS };
    const sim = createBrowserSimulation(map, villagers, [], settings);

    const host = new SeloToolHost({
      getSimulation: () => sim,
      getMap: () => map,
      getVillagers: () => villagers,
      getSettings: () => settings,
      applyMap: (next) => {
        map = next;
        sim.updateMap(next);
      },
      applyVillagers: (next) => {
        villagers = next;
        sim.syncVillagers(next);
      },
      updateSettings: (patch) => {
        settings = { ...settings, ...patch };
        sim.updateSettings(settings);
      },
    });

    // Autonomous scenario build + interact + query + export
    const scenario = await host.callTool('run_scenario', {
      worldName: 'Clockwork Keep',
      width: 28,
      height: 22,
      clearDatabase: true,
      pois: [{ tag: 'Watchtower', label: 'North Watchtower', x: 14, y: 8 }],
      villagers: [
        { name: 'Kaelen', role: 'Ranger', identity: 'Alert scout.', plan: 'Patrol Watchtower', x: 10, y: 10 },
        { name: 'Vesper', role: 'Archivist', identity: 'Tracks relics.', plan: 'Inspect Watchtower', x: 12, y: 10 },
      ],
      focalWorldlineId: 'Kaelen',
      openingDirective: '@Kaelen go to #Watchtower',
    });
    expect(scenario.ok).toBe(true);
    expect(map.name).toBe('Clockwork Keep');
    expect(villagers.some((v) => v.name === 'Kaelen')).toBe(true);
    expect(sim.focalWorldlineId.toLowerCase()).toContain('kaelen');

    const dbRes = await host.callTool('query_world_db', {
      query: 'Watchtower',
      includeGraph: true,
    });
    expect(dbRes.totalRecords).toBeGreaterThanOrEqual(1);
    expect(dbRes.graph?.nodes?.length).toBeGreaterThan(0);

    const cfgRes = await host.callTool('configure_backends', {
      localApiProvider: 'openrouter',
      localApiKey: 'secret-key-123',
      imageGenEnabled: true,
      imageGenProvider: 'openrouter',
    });
    expect(cfgRes.settings.localApiProvider).toBe('openrouter');
    expect(cfgRes.settings.localApiKey).toBe('***');

    // WebMCP navigator.modelContext registration check
    const registered: string[] = [];
    const origNav = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        modelContext: {
          registerTool: (t: any) => registered.push(t.name),
          unregisterTool: () => {},
        },
      },
    });
    seloToolHost.setHooks({
      getSimulation: () => sim,
      getMap: () => map,
      getVillagers: () => villagers,
      getSettings: () => settings,
      applyMap: (next) => {
        map = next;
      },
      applyVillagers: (next) => {
        villagers = next;
      },
      updateSettings: (patch) => {
        settings = { ...settings, ...patch };
      },
    });
    const cleanup = installSeloWebMcpAndApi();
    try {
      expect(registered.length).toBe(host.listTools().length);
      expect(registered).toContain('seloai_run_scenario');
    } finally {
      cleanup();
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: origNav });
    }

    // Stdio MCP server smoke test (initialize -> tools/list -> tools/call)
    const mcpResponses = await new Promise<any[]>((resolve, reject) => {
      const child = spawn('node', ['mcp/seloai-mcp-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, SELOAI_BRIDGE_URL: 'http://127.0.0.1:1/closed' },
      });
      const out: any[] = [];
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) {
          if (l.trim()) out.push(JSON.parse(l));
        }
        if (out.length >= 3) {
          child.kill();
          resolve(out);
        }
      });
      child.on('error', reject);
      setTimeout(() => {
        child.kill();
        reject(new Error(`MCP server timeout, got ${out.length} responses`));
      }, 4000);

      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'run_scenario',
            arguments: { worldName: 'MCP Fortress', pois: [{ tag: 'Gate', label: 'Main Gate', x: 5, y: 5 }] },
          },
        }) + '\n',
      );
    });
    expect(mcpResponses[0].result.serverInfo.name).toBe('seloai-mcp');
    expect(mcpResponses[1].result.tools.length).toBe(host.listTools().length);
    const callPayload = JSON.parse(mcpResponses[2].result.content[0].text);
    expect(callPayload.ok).toBe(true);
    expect(callPayload.world.map.name).toBe('MCP Fortress');
  });

  it('supports all SeloAI tools including tapestry tab, stamps, ASCII pattern composition, and headless MCP parity', async () => {
    let map = createBlankWorldMap('Tool Test', 24, 18);
    let villagers = structuredClone(DEFAULT_VILLAGERS.slice(0, 1));
    let settings = { ...DEFAULT_MODEL_SETTINGS };
    let activeTab = 'village';
    const sim = createBrowserSimulation(map, villagers, [], settings);

    const host = new SeloToolHost({
      getSimulation: () => sim,
      getMap: () => map,
      getVillagers: () => villagers,
      getSettings: () => settings,
      applyMap: (next) => {
        map = next;
        sim.updateMap(next);
      },
      applyVillagers: (next) => {
        villagers = next;
        sim.syncVillagers(next);
      },
      updateSettings: (patch) => {
        settings = { ...settings, ...patch };
        sim.updateSettings(settings);
      },
      setTab: (tab) => {
        activeTab = tab;
      },
    });

    const tools = host.listTools();
    // The 22 original tools plus the authoring set, each once.
    expect(tools.length).toBeGreaterThanOrEqual(22);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    expect(tools.some((t) => t.name === 'compose_pixel_pattern')).toBe(true);

    // Switch to Tapestry Studio tab + run Shevitsa scenario preset
    const tabRes = await host.callTool('control_simulation', { tab: 'tapestry' });
    expect(tabRes.ok).toBe(true);
    expect(activeTab).toBe('tapestry');

    const shevRes = await host.callTool('run_scenario', {
      worldPreset: 'shevitsa',
      worldName: 'Shevitsa Loom Square',
    });
    expect(shevRes.ok).toBe(true);
    expect(map.name).toBe('Shevitsa Loom Square');
    expect(map.tileSetUrl).toContain('shevitsa-tileset.png');

    // Add + place a macro stamp via edit_world_map
    const editRes = await host.callTool('edit_world_map', {
      addStamps: [
        {
          id: 'custom-rug-runner',
          name: 'Rug Runner',
          width: 2,
          height: 1,
          layer: 'bg0',
          tiles: [14, 15],
        },
      ],
      placeStamps: [{ stampId: 'custom-rug-runner', x: 3, y: 3, layer: 'bg0' }],
    });
    expect(editRes.ok).toBe(true);
    expect(map.bgTiles[0][3][3]).toBe(14);
    expect(map.bgTiles[0][4][3]).toBe(15);

    // Compose crisp ASCII pixel art into the tileset and place onto the map
    const composeRes = await host.callTool('compose_pixel_pattern', {
      name: 'Rose Diamond',
      asciiRows: ['.RR.', 'RYYR', 'RYYR', '.RR.'],
      paletteMap: { R: '#c2272d', Y: '#d9a441' },
      outCols: 2,
      outRows: 1,
      targetCol: 0,
      targetRow: 2,
      layer: 'obj0',
      blocksMovement: true,
      applyToMap: true,
      placeAt: { x: 6, y: 7 },
    });
    expect(composeRes.ok).toBe(true);
    expect(composeRes.stamp.width).toBe(2);
    expect(composeRes.stamp.height).toBe(1);
    expect(composeRes.placedAt).toEqual({ x: 6, y: 7 });
    expect(composeRes.proceduralCode).toContain('drawRoseDiamondPalette');
    const sheetCols = Math.floor((map.tileSetDimX ?? 512) / (map.tileDim ?? 32));
    expect(map.objectTiles[0][6][7]).toBe(2 * sheetCols);
    expect(map.objectTiles[0][7][7]).toBe(2 * sheetCols + 1);
    expect(map.collisionGrid[6][7]).toBe(true);

    // Verify stdio MCP headless parity for new tools & arguments
    const mcpResponses = await new Promise<any[]>((resolve, reject) => {
      const child = spawn('node', ['mcp/seloai-mcp-server.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, SELOAI_BRIDGE_URL: 'http://127.0.0.1:1/closed' },
      });
      const out: any[] = [];
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) {
          if (l.trim()) out.push(JSON.parse(l));
        }
        if (out.length >= 4) {
          child.kill();
          resolve(out);
        }
      });
      child.on('error', reject);
      setTimeout(() => {
        child.kill();
        reject(new Error(`MCP headless parity timeout, got ${out.length} responses`));
      }, 4000);

      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'control_simulation', arguments: { tab: 'tapestry' } },
        }) + '\n',
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'create_world', arguments: { preset: 'shevitsa' } },
        }) + '\n',
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'compose_pixel_pattern',
            arguments: {
              name: 'MCP Motif',
              asciiRows: ['.RR.', 'RYYR', 'RYYR', '.RR.'],
              paletteMap: { R: '#c2272d', Y: '#d9a441' },
              outCols: 2,
              outRows: 1,
              targetCol: 1,
              targetRow: 1,
              applyToMap: true,
              placeAt: { x: 2, y: 3 },
            },
          },
        }) + '\n',
      );
    });
    expect(mcpResponses[0].result.tools.map((t: { name: string }) => t.name)).toEqual(tools.map((t) => t.name));
    expect(JSON.parse(mcpResponses[1].result.content[0].text).tab).toBe('tapestry');
    expect(JSON.parse(mcpResponses[2].result.content[0].text).preset).toBe('shevitsa');
    const mcpCompose = JSON.parse(mcpResponses[3].result.content[0].text);
    expect(mcpCompose.ok).toBe(true);
    expect(mcpCompose.placedAt).toEqual({ x: 2, y: 3 });
  });
});
