import { defineConfig } from 'vitest/config';

/** Separate config for memory measurements (see test/zip.memory.ts). */
export default defineConfig({
  test: {
    root: '.',
    include: ['test/**/*.memory.ts'],
    testTimeout: 300000
  }
});
