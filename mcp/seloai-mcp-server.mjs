#!/usr/bin/env node
/**
 * SeloAI Model Context Protocol (MCP) stdio server.
 *
 * - Exposes all SeloAI tools (from src/api/toolSchemas.json) to MCP clients
 *   (Claude Desktop, Cursor, Antigravity, Gemini CLI, etc.).
 * - If a SeloAI Vite dev server + browser tab is running at SELOAI_BRIDGE_URL
 *   (default http://localhost:5173/__seloai_bridge/call), tool calls execute LIVE
 *   inside the active browser world.
 * - Otherwise executes in standalone headless state mode so agents can create
 *   worlds, characters, scenarios, configure backends, and export portable JSON bundles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const schemasPath = path.join(repoRoot, 'src', 'api', 'toolSchemas.json');
const TOOLS = JSON.parse(fs.readFileSync(schemasPath, 'utf8'));

const BRIDGE_URL = process.env.SELOAI_BRIDGE_URL || 'http://localhost:5173/__seloai_bridge/call';

// Headless fallback state when no live browser tab is connected
const headlessState = {
  map: {
    name: 'Headless World',
    tileDim: 32,
    width: 36,
    height: 28,
    tileSetUrl: '/assets/gentle-obj.png',
    tileSetDimX: 1440,
    tileSetDimY: 1024,
    bgTiles: [Array.from({ length: 36 }, () => Array(28).fill(0))],
    objectTiles: [Array.from({ length: 36 }, () => Array(28).fill(-1))],
    collisionGrid: Array.from({ length: 36 }, () => Array(28).fill(false)),
    animatedSprites: [],
    spawnPoints: [{ id: 'spawn-center', label: 'Center', x: 18, y: 14 }],
    pointsOfInterest: [{ id: 'poi-center', tag: 'Center', label: 'Center', x: 18, y: 14 }],
    stamps: [],
  },
  villagers: [],
  conversations: [],
  characterHistories: {},
  focalWorldlineId: 'scribe',
  settings: {
    inferenceMode: 'auto',
    localApiEnabled: true,
    localApiProvider: 'ollama',
    localApiUrl: 'http://localhost:11434/v1',
    localApiModel: 'lfm3',
    voiceApiEnabled: false,
    voiceProvider: 'local-omni-webspeech',
    imageGenEnabled: false,
    imageGenProvider: 'agent',
    narratorEnabled: true,
    narratorName: 'Scribe',
    narratorStyle: 'dungeon-master',
    proximityRadiusTiles: 9,
  },
};

async function tryBridgeCall(name, args) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (res.ok && json.ok) {
      return { hit: true, result: json.result };
    }
    return { hit: false, reason: json?.error || `HTTP ${res.status}` };
  } catch (err) {
    return { hit: false, reason: err?.message || 'Bridge offline' };
  } finally {
    clearTimeout(timeout);
  }
}

function runHeadlessTool(name, args = {}) {
  switch (name) {
    case 'get_world_state':
      return {
        mode: 'headless',
        map: {
          name: headlessState.map.name,
          width: headlessState.map.width,
          height: headlessState.map.height,
          pointsOfInterest: headlessState.map.pointsOfInterest,
        },
        villagers: headlessState.villagers,
        conversations: headlessState.conversations,
        focalWorldlineId: headlessState.focalWorldlineId,
        settings: headlessState.settings,
      };
    case 'create_world': {
      const w = Math.max(12, Math.min(80, Number(args.width ?? 36)));
      const h = Math.max(12, Math.min(64, Number(args.height ?? 28)));
      headlessState.map = {
        ...headlessState.map,
        name: args.name || 'Headless World',
        width: w,
        height: h,
        tileDim: Number(args.tileDim ?? 32),
        tileSetUrl: args.tileSetUrl || headlessState.map.tileSetUrl,
        bgTiles: [Array.from({ length: w }, () => Array(h).fill(0))],
        objectTiles: [Array.from({ length: w }, () => Array(h).fill(-1))],
        collisionGrid: Array.from({ length: w }, () => Array(h).fill(false)),
        pointsOfInterest: Array.isArray(args.pois)
          ? args.pois.map((p, idx) => ({
              id: p.id || `poi-${idx}`,
              tag: String(p.tag || p.label || `POI${idx}`),
              label: String(p.label || p.tag || `Point ${idx + 1}`),
              x: Math.round(Number(p.x ?? w / 2)),
              y: Math.round(Number(p.y ?? h / 2)),
              description: p.description,
            }))
          : [{ id: 'poi-center', tag: 'Center', label: 'Center', x: Math.floor(w / 2), y: Math.floor(h / 2) }],
      };
      if (args.clearDatabase) {
        headlessState.conversations = [];
        headlessState.characterHistories = {};
      }
      return { ok: true, mode: 'headless', map: headlessState.map.name, pointsOfInterest: headlessState.map.pointsOfInterest };
    }
    case 'create_character': {
      const nameStr = String(args.name || `Traveler-${headlessState.villagers.length + 1}`);
      const id = String(args.id || `v-${nameStr.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
      const cfg = {
        id,
        name: nameStr,
        role: String(args.role || 'Traveler'),
        spritesheetId: args.customSpriteDataUrl ? 'custom' : 'f1',
        accentColor: String(args.accentColor || '#6c93bf'),
        identity: String(args.identity || `${nameStr} entered the settlement.`),
        plan: String(args.plan || 'Explore landmarks and meet residents.'),
        voiceStyle: String(args.voiceStyle || 'Clear cadence.'),
        voice: { gender: args.gender || 'female', language: args.language || 'American English', pitchSemitones: 0, speakingRate: 1, warmthDb: 0 },
        homeTile: { x: Number(args.x ?? Math.floor(headlessState.map.width / 2)), y: Number(args.y ?? Math.floor(headlessState.map.height / 2)) },
        speed: 0.72,
      };
      const idx = headlessState.villagers.findIndex((v) => v.id === id);
      if (idx >= 0) headlessState.villagers[idx] = cfg;
      else headlessState.villagers.push(cfg);
      return { ok: true, mode: 'headless', villager: cfg };
    }
    case 'run_scenario': {
      if (args.worldName || args.pois) runHeadlessTool('create_world', { name: args.worldName, width: args.width, height: args.height, pois: args.pois, clearDatabase: args.clearDatabase });
      if (Array.isArray(args.villagers)) {
        for (const v of args.villagers) runHeadlessTool('create_character', v);
      }
      if (args.focalWorldlineId) headlessState.focalWorldlineId = String(args.focalWorldlineId);
      if (args.openingDirective) runHeadlessTool('instruct_world', { text: args.openingDirective });
      return { ok: true, mode: 'headless', world: runHeadlessTool('get_world_state', {}) };
    }
    case 'instruct_world': {
      const conv = {
        id: `conv-${Date.now()}`,
        participantIds: ['player', ...headlessState.villagers.slice(0, 1).map((v) => v.id)],
        startedAt: Date.now(),
        updatedAt: Date.now(),
        active: false,
        messages: [
          {
            id: `msg-${Date.now()}`,
            senderId: 'player',
            senderName: 'Visitor',
            text: String(args.text || ''),
            timestamp: Date.now(),
            kind: 'speech',
            source: 'human-text',
          },
        ],
      };
      headlessState.conversations.unshift(conv);
      return { ok: true, mode: 'headless', conversationId: conv.id, messages: conv.messages };
    }
    case 'configure_backends': {
      Object.assign(headlessState.settings, args);
      return { ok: true, mode: 'headless', settings: headlessState.settings };
    }
    case 'export_bundle': {
      const scope = String(args.scope || 'project');
      const payload =
        scope === 'level'
          ? { format: 'seloai-level-v1', exportedAt: new Date().toISOString(), map: headlessState.map }
          : scope === 'characters'
            ? { format: 'seloai-characters-v1', exportedAt: new Date().toISOString(), villagers: headlessState.villagers }
            : scope === 'characters-history'
              ? { format: 'seloai-characters-history-v1', exportedAt: new Date().toISOString(), villagers: headlessState.villagers, characterHistories: headlessState.characterHistories }
              : scope === 'database'
                ? { format: 'seloai-db-v1', exportedAt: new Date().toISOString(), conversations: headlessState.conversations, characterHistories: headlessState.characterHistories }
                : { format: 'seloai-project-v1', exportedAt: new Date().toISOString(), ...headlessState };
      return { ok: true, mode: 'headless', scope, json: JSON.stringify(payload, null, 2) };
    }
    case 'clear_database':
      headlessState.conversations = [];
      headlessState.characterHistories = {};
      return { ok: true, mode: 'headless' };
    default:
      throw new Error(`Tool "${name}" requires a live SeloAI browser tab connected at ${BRIDGE_URL}.`);
  }
}

async function handleRpc(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'seloai-mcp', version: '1.0.0' },
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const toolName = String(params?.name || '');
    const toolArgs = params?.arguments ?? {};
    try {
      const bridged = await tryBridgeCall(toolName, toolArgs);
      const output = bridged.hit ? bridged.result : runHeadlessTool(toolName, toolArgs);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: err?.message || String(err) }],
        },
      };
    }
  }

  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        resources: [
          { uri: 'seloai://state', name: 'SeloAI World State', mimeType: 'application/json' },
          { uri: 'seloai://tools', name: 'SeloAI Tool Schemas', mimeType: 'application/json' },
        ],
      },
    };
  }

  if (method === 'resources/read') {
    const uri = String(params?.uri || '');
    if (uri === 'seloai://tools') {
      return {
        jsonrpc: '2.0',
        id,
        result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(TOOLS, null, 2) }] },
      };
    }
    const bridged = await tryBridgeCall('get_world_state', {});
    const state = bridged.hit ? bridged.result : runHeadlessTool('get_world_state', {});
    return {
      jsonrpc: '2.0',
      id,
      result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(state, null, 2) }] },
    };
  }

  if (id !== undefined) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
  return null;
}

// Auto-detect Content-Length vs newline-delimited JSON-RPC stdio framing
let useContentLength = false;
let rawBuffer = Buffer.alloc(0);

function sendResponse(obj) {
  if (!obj) return;
  const json = JSON.stringify(obj);
  if (useContentLength) {
    const body = Buffer.from(json, 'utf8');
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function processChunk() {
  while (rawBuffer.length > 0) {
    const asStr = rawBuffer.toString('utf8');
    if (asStr.startsWith('Content-Length:')) {
      useContentLength = true;
      const headerEnd = rawBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = rawBuffer.slice(0, headerEnd).toString('utf8');
      const m = header.match(/Content-Length:\s*(\d+)/i);
      const len = m ? Number(m[1]) : 0;
      const bodyStart = headerEnd + 4;
      if (rawBuffer.length < bodyStart + len) return;
      const bodyStr = rawBuffer.slice(bodyStart, bodyStart + len).toString('utf8');
      rawBuffer = rawBuffer.slice(bodyStart + len);
      try {
        const resp = await handleRpc(JSON.parse(bodyStr));
        sendResponse(resp);
      } catch {
        // ignore malformed packet
      }
      continue;
    }

    const nl = rawBuffer.indexOf('\n');
    if (nl === -1) return;
    const line = rawBuffer.slice(0, nl).toString('utf8').trim();
    rawBuffer = rawBuffer.slice(nl + 1);
    if (!line) continue;
    try {
      const resp = await handleRpc(JSON.parse(line));
      sendResponse(resp);
    } catch {
      // ignore malformed packet
    }
  }
}

process.stdin.on('data', (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, chunk]);
  void processChunk();
});
