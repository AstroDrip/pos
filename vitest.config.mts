import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20_000, // a few tests build the whole database several times; 5 s was too tight when every core is busy
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
