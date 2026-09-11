import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is built into dist/client and served by the Express server in
// production; in dev, vite proxies the API to the server on PORT.
export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
});
