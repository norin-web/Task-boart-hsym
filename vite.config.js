import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  envDir: '..',            // .env.local лежит в корне проекта
  base: './',              // относительные пути — работает на github.io/<repo>/
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  // no-store: браузер не держит старый код после перезапуска сервера
  server: { port: 5177, strictPort: true, headers: { 'Cache-Control': 'no-store' } },
});
