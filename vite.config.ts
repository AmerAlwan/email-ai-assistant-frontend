import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    watch: {
      // Required for hot-reload inside Docker on Windows/macOS where
      // inotify events don't propagate through bind mounts.
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: 'http://agent:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://agent:8000',
        ws: true,
      },
    },
  },
})
