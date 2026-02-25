import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/complex-app-gaps.test.ts'],
  },
});
