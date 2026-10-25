import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@sp/plugin-api': path.resolve(__dirname, 'vendor/plugin-api/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
