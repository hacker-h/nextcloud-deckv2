import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    // Playwright owns e2e/; collecting it here fails on @playwright/test.
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
  },
  resolve: {
    // Without the browser condition Vite resolves Svelte's server build,
    // which renders no DOM for Testing Library.
    conditions: ['browser'],
  },
});
