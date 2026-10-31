import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root: the corpus (data/laws) and the consultation tree (data/tree.json)
// live OUTSIDE web/ and are imported straight from there at build time, so
// there is exactly one copy of the data in the repo.
const repoRoot = path.resolve(here, '..');

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { alias: { '@data': path.resolve(repoRoot, 'data') } },
  server: { fs: { allow: [repoRoot] } },
  // The corpus JSON is inlined on purpose (static site, no runtime fetch); ~500 kB is expected.
  build: { chunkSizeWarningLimit: 800 },
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
