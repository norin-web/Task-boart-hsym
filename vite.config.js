import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  envDir: '..',            // .env.local лежит в корне проекта
  base: './',              // относительные пути — работает на github.io/<repo>/
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: { port: 5177, strictPort: true },
});
