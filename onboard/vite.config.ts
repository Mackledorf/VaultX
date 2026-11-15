import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createExtensionArchive } from './scripts/extensionArchive.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'onboard-extension-archive',
      configureServer(server) {
        const archivePath = `${server.config.base}onboard-extension.zip`;
        server.middlewares.use((request, response, next) => {
          const path = new URL(request.url ?? '/', 'http://localhost').pathname;
          if (!['GET', 'HEAD'].includes(request.method ?? '') || path !== archivePath) {
            next();
            return;
          }
          try {
            const archive = createExtensionArchive();
            response.setHeader('Content-Type', 'application/zip');
            response.setHeader('Content-Disposition', 'attachment; filename="onboard-extension.zip"');
            response.setHeader('Content-Length', archive.length);
            response.end(request.method === 'HEAD' ? undefined : archive);
          } catch (error) {
            next(error);
          }
        });
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'onboard-extension.zip', source: createExtensionArchive() });
      },
    },
  ],
  base: process.env.ONBOARD_BASE_PATH || '/',
  build: {
    assetsInlineLimit: 0,
  },
});
