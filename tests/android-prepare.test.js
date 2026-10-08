import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, addPermissions } from '../scripts/android-prepare.mjs';

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="Mi horario"><activity android:name=".MainActivity" /></application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

test('añade todos los permisos antes de </manifest> y conserva lo existente', () => {
  const out = addPermissions(MANIFEST);
  PERMISSIONS.forEach(line => assert.ok(out.includes(line), line));
  assert.ok(out.includes('android.permission.INTERNET'));
  assert.ok(out.trimEnd().endsWith('</manifest>'));
  assert.equal(out.match(/<manifest/g).length, 1);
});

test('es idempotente', () => {
  const once = addPermissions(MANIFEST);
  assert.equal(addPermissions(once), once);
});

test('no duplica un permiso que ya estaba', () => {
  const withOne = MANIFEST.replace('</manifest>', '    <uses-permission android:name="android.permission.VIBRATE" />\n</manifest>');
  const out = addPermissions(withOne);
  assert.equal(out.match(/android.permission.VIBRATE/g).length, 1);
});

test('rechaza un manifiesto roto', () => {
  assert.throws(() => addPermissions('<manifest>'), /manifiesto|AndroidManifest/i);
});
