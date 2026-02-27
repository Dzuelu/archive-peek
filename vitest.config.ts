import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    benchmark: {
      include: ['test/**/*.bench.ts']
    },
    testTimeout: 15000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
