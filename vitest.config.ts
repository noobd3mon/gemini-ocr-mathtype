import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': `${process.cwd()}/src` } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
