import { registerAgentImageHandler, type AgentImageHandler } from '../ai/localApiClient';
import { SELO_TOOL_DEFINITIONS, seloToolHost, type SeloToolDefinition } from './seloToolRegistry';
import { toolResultContent } from './authoringTools';

/**
 * Tool calls over postMessage can reconfigure backends and export the world, so they are
 * accepted only from this page's own origin or from origins listed (comma-separated) in
 * the build-time VITE_SELOAI_ALLOWED_ORIGINS variable.
 */
export function isAllowedToolCallOrigin(origin: string, selfOrigin?: string): boolean {
  const own = selfOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  if (!origin || origin === 'null') return false;
  if (origin === own) return true;
  const extra = String((import.meta as any).env?.VITE_SELOAI_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

export interface SeloWindowApi {
  version: string;
  listTools: () => SeloToolDefinition[];
  callTool: (name: string, args?: Record<string, any>) => Promise<any>;
  getWorldState: (includeMessages?: boolean) => Promise<any>;
  runScenario: (scenario: Record<string, any>) => Promise<any>;
  instruct: (text: string, recipientId?: string) => Promise<any>;
  registerImageGenerator: (handler: AgentImageHandler | null) => void;
}

declare global {
  interface Window {
    seloAI?: SeloWindowApi;
  }
}

function registerWithNavigatorModelContext(tools: SeloToolDefinition[]): () => void {
  const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
  const mc = nav?.modelContext;
  if (!mc) return () => {};

  const unregisterFns: Array<() => void> = [];
  const wrapped = tools.map((tool) => ({
    name: `seloai_${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input: Record<string, any>) {
      const result = await seloToolHost.callTool(tool.name, input ?? {});
      return { content: toolResultContent(result) };
    },
  }));

  try {
    if (typeof mc.registerTool === 'function') {
      for (const spec of wrapped) {
        try {
          mc.registerTool(spec);
          if (typeof mc.unregisterTool === 'function') {
            unregisterFns.push(() => {
              try {
                mc.unregisterTool(spec.name);
              } catch {
                // ignore
              }
            });
          }
        } catch {
          // duplicate or unsupported tool schema
        }
      }
    } else if (typeof mc.provideContext === 'function') {
      mc.provideContext({ tools: wrapped });
      if (typeof mc.clearContext === 'function') {
        unregisterFns.push(() => mc.clearContext());
      }
    }
  } catch {
    // WebMCP unavailable or rejected
  }

  return () => {
    for (const fn of unregisterFns) fn();
  };
}

export function installSeloWebMcpAndApi(): () => void {
  const api: SeloWindowApi = {
    version: '1.0.0',
    listTools: () => seloToolHost.listTools(),
    callTool: (name, args = {}) => seloToolHost.callTool(name, args),
    getWorldState: (includeMessages = true) =>
      seloToolHost.callTool('get_world_state', { includeMessages }),
    runScenario: (scenario) => seloToolHost.callTool('run_scenario', scenario),
    instruct: (text, recipientId) => seloToolHost.callTool('instruct_world', { text, recipientId }),
    registerImageGenerator: (fn) => registerAgentImageHandler(fn),
  };

  if (typeof window !== 'undefined') {
    window.seloAI = api;
  }

  const cleanupWebMcp = registerWithNavigatorModelContext(SELO_TOOL_DEFINITIONS);

  const onMessage = async (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'SELOAI_TOOL_CALL') return;
    if (!isAllowedToolCallOrigin(event.origin)) return;
    const replyTarget = (event.source as WindowProxy | null) ?? window;
    try {
      const result = await seloToolHost.callTool(String(data.name || ''), data.args ?? {});
      replyTarget?.postMessage?.(
        { type: 'SELOAI_TOOL_RESULT', id: data.id, ok: true, result },
        event.origin && event.origin !== 'null' ? event.origin : '*',
      );
    } catch (err: any) {
      replyTarget?.postMessage?.(
        {
          type: 'SELOAI_TOOL_RESULT',
          id: data.id,
          ok: false,
          error: err?.message || String(err),
        },
        event.origin && event.origin !== 'null' ? event.origin : '*',
      );
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('message', onMessage);
  }

  // Optional dev-only live bridge so a local stdio MCP server can drive the active browser tab
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const isDev = Boolean((import.meta as any).env?.DEV);

  const pollDevBridge = async () => {
    if (stopped || !isDev || typeof fetch === 'undefined') return;
    try {
      const res = await fetch('/__seloai_bridge/pending');
      if (res.ok) {
        const req = await res.json();
        if (req && req.id && req.name) {
          let payload: any;
          try {
            const result = await seloToolHost.callTool(req.name, req.args ?? {});
            payload = { id: req.id, ok: true, result };
          } catch (err: any) {
            payload = { id: req.id, ok: false, error: err?.message || String(err) };
          }
          await fetch('/__seloai_bridge/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => undefined);
        }
      }
    } catch {
      // Dev bridge idle or server restarted
    } finally {
      if (!stopped) {
        timer = setTimeout(pollDevBridge, 350);
      }
    }
  };

  if (isDev && typeof window !== 'undefined') {
    timer = setTimeout(pollDevBridge, 350);
  }

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    cleanupWebMcp();
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', onMessage);
      delete window.seloAI;
    }
  };
}
