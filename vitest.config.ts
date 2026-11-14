import { defineConfig } from 'vitest/config';
// Miniflare suites start real local workerd processes; serialize files on small CI hosts.
export default defineConfig({ test: { maxWorkers: 1, hookTimeout: 30_000, testTimeout: 30_000, environment: 'node', include: ['tests/**/*.test.ts','hosting/tests/**/*.test.ts'] } });
