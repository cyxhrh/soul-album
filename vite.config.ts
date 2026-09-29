import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The local paid-key API is proxied below. Another localhost page must not
    // receive a permissive CORS preflight for this development server.
    cors: false,
    proxy: {
      // Preserve the browser-visible Host so the backend can require Origin === Host.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
})
