import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'org-delta-chart',
    },
    emptyOutDir: false,
    sourcemap: true,
  },
});
