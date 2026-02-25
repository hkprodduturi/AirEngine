import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Gap acceptance tests are opt-in only (npm run test:complex-gaps)
      'tests/complex-app-gaps.test.ts',
    ],
  },
});
