import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// A build id that is visible on the page.
//
// Several rounds of geometry fixes were reported as "no visible change", and
// there was no way to tell whether the browser was even running the new code.
// Stamping it means the next screenshot answers that question by itself.
let build = 'dev';
try {
  const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  build = `${hash}-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`;
} catch {
  build = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '');
}

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  server: { port: 5173 },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: 'index.html',
        showcase: 'showcase.html',
      },
    },
  },
});
