import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
