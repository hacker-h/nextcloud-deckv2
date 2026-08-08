import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { buildDefines } from './build-info.js';

export default defineConfig({
  plugins: [svelte()],
  define: buildDefines,
  server: {
    port: 5173,
    proxy: {
      // Keep the browser's Host header so the backend's Origin CSRF check sees
      // http://localhost:5173 and accepts mutating requests through the dev proxy.
      '/auth': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
