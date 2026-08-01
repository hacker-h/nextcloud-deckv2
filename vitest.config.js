import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./test/setup.js'],
          // Playwright owns e2e/; collecting it here fails on @playwright/test.
          include: ['src/**/*.test.js', 'test/**/*.test.js'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.js'],
        },
      },
    ],
  },
  resolve: {
    // Without the browser condition Vite resolves Svelte's server build,
    // which renders no DOM for Testing Library.
    conditions: ['browser'],
  },
});
