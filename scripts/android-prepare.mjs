/**
 * android-prepare.mjs — Ajusta el proyecto Android que genera `npx cap add android`:
 * añade al AndroidManifest los permisos que necesitan los avisos con la app cerrada.
 * Es idempotente (se puede ejecutar varias veces) y solo usa Node.
 *
 * Uso: node scripts/android-prepare.mjs [ruta/al/AndroidManifest.xml]
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PERMISSIONS = Object.freeze([
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  // Android 13+: USE_EXACT_ALARM se concede sola a apps de calendario/recordatorios; antes de eso, SCHEDULE_EXACT_ALARM.
  '<uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />',
  '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />',
  '<uses-permission android:name="android.permission.VIBRATE" />'
]);

const nameOf = line => /android:name="([^"]+)"/.exec(line)[1];

/** Devuelve el manifiesto con los permisos que falten añadidos justo antes de </manifest>. */
export function addPermissions(xml) {
  if (!xml.includes('</manifest>')) throw new Error('AndroidManifest.xml no válido: falta </manifest>.');
  const missing = PERMISSIONS.filter(line => !xml.includes(`android:name="${nameOf(line)}"`));
  if (!missing.length) return xml;
  const block = missing.map(line => `    ${line}`).join('\n');
  return xml.replace('</manifest>', `${block}\n</manifest>`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || 'android/app/src/main/AndroidManifest.xml';
  if (!fs.existsSync(file)) {
    console.error(`No existe ${file}. Ejecuta antes: npx cap add android`);
    process.exit(1);
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = addPermissions(before);
  if (after !== before) fs.writeFileSync(file, after);
  console.log(after === before ? 'Permisos ya presentes.' : 'Permisos añadidos al AndroidManifest.');
}
