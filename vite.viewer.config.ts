import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, 'viewer.html'),
    },
    emptyOutDir: false,
    sourcemap: true,
  },
});
