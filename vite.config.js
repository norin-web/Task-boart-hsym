import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [],             // пустой список: wrangler (Cloudflare) не пытается сам переписывать конфиг
  envDir: '..',            // .env.local лежит в корне проекта
  base: './',              // относительные пути — сайт работает с любого адреса и пути
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  // no-store: браузер не держит старый код после перезапуска сервера
  server: { port: 5177, strictPort: true, headers: { 'Cache-Control': 'no-store' } },
});
