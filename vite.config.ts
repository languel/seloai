import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Prevent Vite's SPA fallback from returning index.html (200 OK) for missing
 * optional files under /models/ or /vendor/, which breaks Transformers.js JSON probing.
 */
function strictPublicStaticPlugin(): Plugin {
  const publicDir = path.resolve(__dirname, 'public');
  return {
    name: 'strict-public-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = (req.url || '').split('?')[0];
        if (rawUrl.startsWith('/models/') || rawUrl.startsWith('/vendor/')) {
          const decoded = decodeURIComponent(rawUrl);
          const candidate = path.resolve(publicDir, '.' + decoded);
          if (!candidate.startsWith(publicDir) || !fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
        }
        next();
      });
    },
  };
}

function seloBridgePlugin(): Plugin {
  const queue: Array<{
    id: string;
    name: string;
    args: any;
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  const inflight = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  const readJson = (req: any): Promise<any> =>
    new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });

  return {
    name: 'selo-mcp-dev-bridge',
    configureServer(server) {
      server.middlewares.use('/__seloai_bridge', async (req, res, next) => {
        const sub = (req.url || '').split('?')[0];
        if (sub === '/pending' && req.method === 'GET') {
          const item = queue.shift();
          res.setHeader('Content-Type', 'application/json');
          if (!item) {
            res.end('null');
            return;
          }
          // The tab has it: give the call time to finish (a character may be answering).
          clearTimeout(item.timer);
          const timer = setTimeout(() => {
            inflight.delete(item.id);
            item.reject(new Error('The SeloAI tab took too long to answer (timeout).'));
          }, 60_000);
          inflight.set(item.id, { resolve: item.resolve, reject: item.reject, timer });
          res.end(JSON.stringify({ id: item.id, name: item.name, args: item.args }));
          return;
        }
        if (sub === '/reply' && req.method === 'POST') {
          try {
            const data = await readJson(req);
            const entry = inflight.get(data.id);
            if (entry) {
              clearTimeout(entry.timer);
              inflight.delete(data.id);
              if (data.ok) entry.resolve(data.result);
              else entry.reject(new Error(data.error || 'Tool call failed'));
            }
            res.setHeader('Content-Type', 'application/json');
            res.end('{"ok":true}');
          } catch (err: any) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
          }
          return;
        }
        if (sub === '/call' && req.method === 'POST') {
          try {
            const data = await readJson(req);
            const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const result = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                const idx = queue.findIndex((q) => q.id === id);
                if (idx >= 0) queue.splice(idx, 1);
                inflight.delete(id);
                reject(new Error('No active SeloAI browser tab answered within timeout.'));
              }, 3000);
              queue.push({ id, name: data.name, args: data.args ?? {}, resolve, reject, timer });
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, result }));
          } catch (err: any) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), strictPublicStaticPlugin(), seloBridgePlugin()],
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
});
