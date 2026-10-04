import { defineConfig } from 'vite';
import { stampServiceWorker } from './scripts/stamp-sw.js';

export default defineConfig({
  // Rutas relativas: la misma build sirve en GitHub Pages (/Mi-horario/), en un dominio propio y dentro de Capacitor.
  base: './',
  plugins: [stampServiceWorker()],
  build: {
    outDir: 'dist',
    target: 'es2020'
  },
  server: { host: true }
});
