import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
  },
});
