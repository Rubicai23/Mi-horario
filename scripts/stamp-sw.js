/**
 * Plugin de Vite: sustituye __BUILD_ID__ en dist/sw.js por un identificador único de cada build,
 * de modo que cada despliegue estrena caché y el service worker se actualiza solo.
 * Sin dependencias, así se puede probar con Node.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const BUILD_PLACEHOLDER = '__BUILD_ID__';

/** Devuelve true si el archivo existía y contenía el marcador. */
export function stampFile(file, buildId) {
  if (!existsSync(file)) return false;
  const source = readFileSync(file, 'utf8');
  if (!source.includes(BUILD_PLACEHOLDER)) return false;
  writeFileSync(file, source.split(BUILD_PLACEHOLDER).join(buildId));
  return true;
}

export function stampServiceWorker() {
  let outDir = 'dist';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() { stampFile(resolve(outDir, 'sw.js'), Date.now().toString(36)); }
  };
}
