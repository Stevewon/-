import build from '@hono/vite-build/cloudflare-pages';
import devServer from '@hono/vite-dev-server';
import adapter from '@hono/vite-dev-server/cloudflare';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  if (mode === 'client' || mode === 'development') {
    // Client build or dev mode: React SPA
    return {
      plugins: [react()],
      build: {
        outDir: 'dist',
        sourcemap: false,
        minify: 'esbuild',
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: ['react', 'react-dom', 'react-router-dom'],
              charts: ['lightweight-charts'],
              state: ['zustand', 'axios'],
            },
          },
        },
      },
      server: {
        port: 5173,
        host: '0.0.0.0',
        allowedHosts: true,
        proxy: {
          '/api': { target: 'http://localhost:3001', changeOrigin: true },
        },
        watch: {
          ignored: ['**/*.db', '**/*.db-wal', '**/*.db-shm'],
        },
      },
    };
  }

  // Server build: Hono _worker.js for Cloudflare Pages
  return {
    plugins: [
      build({
        entry: 'src/server/index.ts',
        outputDir: 'dist',
      }),
    ],
  };
});
