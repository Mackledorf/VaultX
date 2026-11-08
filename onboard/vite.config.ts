import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.ONBOARD_BASE_PATH || '/',
  build: {
    assetsInlineLimit: 0,
  },
});
