/**
 * SeloAI Model Context Protocol (MCP) stdio server.
 *
 * Tool calls go to a live browser tab when the Vite dev server's bridge is reachable
 * (SELOAI_BRIDGE_URL, default http://localhost:5173/__seloai_bridge/call). Otherwise they
 * run against the real engine in this process: the same simulation, world store and tool
 * implementations the app uses, with no rendering or audio.
 */
import { SELO_TOOL_DEFINITIONS, seloToolHost } from '../src/api/seloToolRegistry';
import { AUTHORING_GUIDE, AUTHORING_PROMPTS, authoringPromptMessages, toolResultContent } from '../src/api/authoringTools';
import { startHeadlessHost, type HeadlessHost } from '../src/headless/headlessHost';

// The dev server's bridge: SELOAI_BRIDGE_URL if set, else the usual dev ports in turn.
const BRIDGE_DISABLED = process.env.SELOAI_BRIDGE_URL === 'off';
const BRIDGE_URLS = process.env.SELOAI_BRIDGE_URL && !BRIDGE_DISABLED
  ? [process.env.SELOAI_BRIDGE_URL]
  : ['http://localhost:5183/__seloai_bridge/call', 'http://localhost:5173/__seloai_bridge/call'];
let bridgeUrl: string | null = null;

let host: HeadlessHost | null = null;
let bridgeDownUntil = 0;

async function postBridge(url: string, name: string, args: unknown): Promise<{ hit: boolean; result?: unknown; reached: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (res.ok && json.ok) return { hit: true, result: json.result, reached: true };
    if (json && json.ok === false && typeof json.error === 'string' && !/no active|timeout|timed out/i.test(json.error)) {
      // The tab answered with a real tool error: report it rather than falling back.
      throw new Error(json.error);
    }
    return { hit: false, reached: true };
  } catch (err) {
    if (err instanceof Error && !/abort|fetch failed|ECONNREFUSED|Unexpected/i.test(err.message)) throw err;
    return { hit: false, reached: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function tryBridgeCall(name: string, args: unknown): Promise<{ hit: boolean; result?: unknown }> {
  // Once the engine is running here, stay here: switching worlds mid-session would lose state.
  if (BRIDGE_DISABLED || host || Date.now() < bridgeDownUntil) return { hit: false };
  for (const url of bridgeUrl ? [bridgeUrl] : BRIDGE_URLS) {
    const res = await postBridge(url, name, args);
    if (res.hit) {
      bridgeUrl = url;
      return res;
    }
    if (res.reached) {
      bridgeUrl = url;
      break;
    }
  }
  bridgeDownUntil = Date.now() + 15_000;
  return { hit: false };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const bridged = await tryBridgeCall(name, args);
  if (bridged.hit) return bridged.result;
  if (!host) host = startHeadlessHost();
  const result = await seloToolHost.callTool(name, args);
  return result && typeof result === 'object' ? { mode: 'headless', ...result } : result;
}

async function handleRpc(message: any): Promise<any> {
  const { id, method, params } = message ?? {};
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'seloai-mcp', version: '2.0.0' },
      },
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: SELO_TOOL_DEFINITIONS } };

  if (method === 'tools/call') {
    try {
      const output = await callTool(String(params?.name || ''), params?.arguments ?? {});
      return { jsonrpc: '2.0', id, result: { content: toolResultContent(output) } };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: err?.message || String(err) }] },
      };
    }
  }

  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        resources: [
          { uri: 'seloai://guide', name: 'How to make a world with someone', mimeType: 'text/markdown' },
          { uri: 'seloai://story', name: 'The current story, as Markdown', mimeType: 'text/markdown' },
          { uri: 'seloai://state', name: 'SeloAI World State', mimeType: 'application/json' },
          { uri: 'seloai://tools', name: 'SeloAI Tool Schemas', mimeType: 'application/json' },
        ],
      },
    };
  }

  if (method === 'resources/read') {
    const uri = String(params?.uri || '');
    if (uri === 'seloai://guide' || uri === 'seloai://story') {
      const text = uri === 'seloai://guide' ? AUTHORING_GUIDE : ((await callTool('read_story_markdown', {})) as { markdown: string }).markdown;
      return { jsonrpc: '2.0', id, result: { contents: [{ uri, mimeType: 'text/markdown', text }] } };
    }
    const payload = uri === 'seloai://tools' ? SELO_TOOL_DEFINITIONS : await callTool('get_world_state', {});
    return {
      jsonrpc: '2.0',
      id,
      result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }] },
    };
  }

  if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: AUTHORING_PROMPTS } };
  if (method === 'prompts/get') {
    const name = String(params?.name || '');
    if (!AUTHORING_PROMPTS.some((p) => p.name === name)) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown prompt: ${name}` } };
    }
    return { jsonrpc: '2.0', id, result: { messages: authoringPromptMessages(name, params?.arguments ?? {}) } };
  }

  if (id !== undefined) {
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
  return null;
}

// Auto-detect Content-Length vs newline-delimited JSON-RPC stdio framing.
let useContentLength = false;
let rawBuffer = Buffer.alloc(0);
let draining = false;

function sendResponse(obj: unknown) {
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

function takeMessage(): string | null {
  if (rawBuffer.length === 0) return null;
  if (rawBuffer.toString('utf8', 0, 15) === 'Content-Length:') {
    useContentLength = true;
    const headerEnd = rawBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return null;
    const match = rawBuffer.slice(0, headerEnd).toString('utf8').match(/Content-Length:\s*(\d+)/i);
    const length = match ? Number(match[1]) : 0;
    const bodyStart = headerEnd + 4;
    if (rawBuffer.length < bodyStart + length) return null;
    const body = rawBuffer.slice(bodyStart, bodyStart + length).toString('utf8');
    rawBuffer = rawBuffer.slice(bodyStart + length);
    return body;
  }
  const newline = rawBuffer.indexOf('\n');
  if (newline === -1) return null;
  const line = rawBuffer.slice(0, newline).toString('utf8').trim();
  rawBuffer = rawBuffer.slice(newline + 1);
  return line;
}

// Requests are answered strictly in the order received.
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (let text = takeMessage(); text !== null; text = takeMessage()) {
      if (!text) continue;
      try {
        sendResponse(await handleRpc(JSON.parse(text)));
      } catch {
        // ignore a malformed packet
      }
    }
  } finally {
    draining = false;
  }
}

let draining_: Promise<void> = Promise.resolve();
process.stdin.on('data', (chunk: Buffer) => {
  rawBuffer = Buffer.concat([rawBuffer, chunk]);
  draining_ = draining_.then(() => drain());
});
// At the end of input, answer what is still in flight, then stop.
process.stdin.on('end', () => {
  void draining_.then(async () => {
    while (draining) await new Promise((r) => setTimeout(r, 50));
    host?.stop();
    process.exit(0);
  });
});
