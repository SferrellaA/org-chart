import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'org-delta-chart',
    },
    emptyOutDir: true,
    sourcemap: true,
  },
});
