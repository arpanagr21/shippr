import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'unsafe-none',
    },
    watch: {
      usePolling: true,
      interval: 300,
    },
    hmr: {
      host: 'localhost',
      port: 24678,
      protocol: 'ws',
    },
  },
});
