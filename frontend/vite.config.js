import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API calls and uploaded images are proxied to the backend so the browser
// talks to one origin in development.
const backend = process.env.VITE_BACKEND_URL || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': backend, '/uploads': backend },
  },
});
