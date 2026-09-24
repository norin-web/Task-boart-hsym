import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5177,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
