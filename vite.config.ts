import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  build: { rollupOptions: { output: { manualChunks(id) {
    // Static datasets (presets, Korean name tables) change far less often than app code: own cache entry.
    if (id.includes('/src/data/searchIndex.ts')) return 'search-index';
    if (id.includes('/src/data/')) return 'data';
    if (!id.includes('node_modules')) return;
    if (/\/(react|react-dom|scheduler|zustand)\//.test(id)) return 'vendor-react';
    if (/\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'vendor-motion';
    if (/\/d3-[^/]+\//.test(id)) return 'vendor-graph';
  } } } },
  plugins: [react(), tailwindcss()],
});
