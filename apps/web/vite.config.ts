import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    // Vite's preview server rejects any request whose Host header isn't allow-listed (a
    // DNS-rebinding protection) — a leading "." allows the domain and every subdomain, so
    // this covers punjab-king.onrender.com and any other *.onrender.com service.
    allowedHosts: ['.onrender.com'],
  },
});
