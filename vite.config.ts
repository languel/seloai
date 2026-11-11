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

export default defineConfig({
  plugins: [react(), strictPublicStaticPlugin()],
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
