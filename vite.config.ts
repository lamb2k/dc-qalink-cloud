import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, normalize } from 'node:path';

// Private recordings (game pictures, run data) live outside this repository, in ../private-data.
// They are served to the dev server only, under /@private/, and never copied into a build.
const PRIVATE = resolve(__dirname, '..', 'private-data');
function privateData(): Plugin {
  return {
    name: 'studio-private-data',
    configureServer(server) {
      server.middlewares.use('/@private/', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
        const file = normalize(resolve(PRIVATE, rel));
        if (!file.startsWith(PRIVATE) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : 'application/x-ndjson');
        createReadStream(file).pipe(res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/@private/', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
        const file = normalize(resolve(PRIVATE, rel));
        if (!file.startsWith(PRIVATE) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', 'application/x-ndjson');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [privateData()],
  server: { port: 5178, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5179, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), speed: resolve(__dirname, 'speed.html') } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
