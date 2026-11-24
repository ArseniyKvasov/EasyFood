import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // В продакшене приложение живёт на /app/, лендинг занимает корень.
  // В разработке base остаётся '/', чтобы открывать http://localhost:5173/.
  base: process.env.APP_BASE ?? '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Корень dist занимает лендинг, приложение живёт в dist/app.
    outDir: 'dist/app',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
