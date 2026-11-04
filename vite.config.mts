import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer only. Relative base so the built files load from file:// inside Electron.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
