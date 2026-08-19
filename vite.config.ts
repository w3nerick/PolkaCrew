import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Local multiplayer relay. Production builds use VITE_POLKACREW_RELAY_URL.
    proxy: {
      '/events': 'http://localhost:8765',
      '/send': 'http://localhost:8765',
    },
  },
  preview: { host: true, port: 4173, strictPort: true },
});
