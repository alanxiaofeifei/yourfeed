import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { maxWorkers: 2, environment: 'node', include: ['tests/**/*.test.ts','hosting/tests/**/*.test.ts'] } });
