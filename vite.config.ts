import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyRequest) => {
            const host = proxyRequest.getHeader('host');
            if (typeof host === 'string') {
              proxyRequest.setHeader('origin', `http://${host}`);
            }
          });
        },
      },
    },
  },
});
