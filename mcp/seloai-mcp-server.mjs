#!/usr/bin/env node
/**
 * Launcher for the SeloAI MCP stdio server. The server itself (mcp/server.ts) is TypeScript
 * that imports the app's engine directly, so it is loaded through Vite's Node runner here.
 * Nothing is written to stdout before the server starts: stdout carries the protocol.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { ViteNodeRunner } from 'vite-node/client';
import { ViteNodeServer } from 'vite-node/server';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const vite = await createServer({
  root: repoRoot,
  configFile: false,
  logLevel: 'silent',
  clearScreen: false,
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
});
await vite.pluginContainer.buildStart({});

const nodeServer = new ViteNodeServer(vite);
const runner = new ViteNodeRunner({
  root: vite.config.root,
  base: vite.config.base,
  fetchModule: (id) => nodeServer.fetchModule(id),
  resolveId: (id, importer) => nodeServer.resolveId(id, importer),
});

await runner.executeFile(path.join(repoRoot, 'mcp', 'server.ts'));
