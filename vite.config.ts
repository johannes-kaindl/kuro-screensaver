import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      // Relative paths are resolved from the project root by Vite — keeps
      // this config free of node:path / __dirname (no @types/node needed).
      input: {
        main: 'index.html',
        screensaver: 'screensaver.html',
      },
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
