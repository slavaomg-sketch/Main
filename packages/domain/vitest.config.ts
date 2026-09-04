import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

dotenv({ path: resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.integration.test.ts'], environment: 'node' },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          environment: 'node',
          setupFiles: ['./vitest.setup.integration.ts'],
          globalSetup: ['./vitest.global-setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
