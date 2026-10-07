import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.localStorage = { getItem: key => (key === 'cfg:lang' ? 'en' : null), setItem() {}, removeItem() {} };
const { EN, EN_PLURAL } = await import('../src/lang-en.js');
const i18n = await import('../src/i18n.js');
const { plural, formatLongDate, formatDuration } = await import('../src/utils.js');
const { DAY_NAMES, DAY_LETTERS, BADGES, PRESETS } = await import('../src/config.js');

const holes = text => (text.match(/\{\d+\}/g) || []).sort().join(',');

test('idioma inglés detectado', () => {
  assert.equal(i18n.LANG, 'en');
  assert.equal(i18n.isEnglish, true);
});

test('cada entrada del diccionario tiene los mismos huecos que su clave', () => {
  Object.entries(EN).forEach(([key, value]) => {
    assert.ok(value.length > 0, key);
    assert.equal(holes(value), holes(key), `huecos distintos en: ${key}`);
  });
});

test('traduce textos exactos y con huecos, conservando espacios', () => {
  assert.equal(i18n.translateText('Guardar'), 'Save');
  assert.equal(i18n.translateText('  Guardar\n'), '  Save\n');
  assert.equal(i18n.translateText('Hace 3 semanas'), '3 weeks ago');
  assert.equal(i18n.translateText('Sesión iniciada como a@b.c. Tus cambios se sincronizan solos.'), 'Signed in as a@b.c. Your changes sync automatically.');
  assert.equal(i18n.translateText('Texto que no existe'), 'Texto que no existe');
});

test('los patrones demasiado genéricos no se aplican solos', () => {
  assert.equal(i18n.translateText('Semana de fuego'), 'Week on fire');   // exacta
  assert.equal(i18n.translateText('Cena de empresa'), 'Cena de empresa'); // no coincide con «{0} de {1}»
  assert.equal(i18n.t('{0} de {1}', 2, 5), '2 of 5');                     // pero sí con t() explícito
});

test('plural, fechas y duraciones en inglés', () => {
  assert.equal(plural(1, 'actividad', 'actividades'), '1 activity');
  assert.equal(plural(3, 'actividad', 'actividades'), '3 activities');
  assert.equal(plural(2, 'día', 'días'), '2 days');
  assert.equal(formatLongDate(new Date(2026, 9, 7)), 'Wednesday 7 October');
  assert.equal(formatDuration(0), 'less than 1 min');
  assert.deepEqual([...DAY_NAMES].slice(0, 2), ['Sunday', 'Monday']);
  assert.equal(DAY_LETTERS[3], 'W');
});

test('insignias y plantillas vienen traducidas y el horario DAM no existe en inglés', () => {
  assert.equal(BADGES[0].title, 'First step');
  assert.ok(!PRESETS.some(p => p.id === 'sample-dam'));
});

test('todo texto fijo de index.html tiene traducción', () => {
  const brand = new Set(['Mi horario', 'Pomodoro']);
  let html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  html = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<option[\s\S]*?<\/option>/g, '');
  const missing = new Set();
  for (const m of html.matchAll(/>([^<>]+)</g)) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (/[A-Za-zÁ-úñ]{2}/.test(text) && !brand.has(text) && !(text in EN)) missing.add(text);
  }
  for (const m of html.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]+)"/g)) {
    if (!brand.has(m[1]) && !(m[1] in EN)) missing.add(m[1]);
  }
  assert.deepEqual([...missing], []);
});

test('todo t(\'…\') del código tiene traducción', () => {
  const missing = new Set();
  for (const file of fs.readdirSync(new URL('../src/', import.meta.url))) {
    if (!file.endsWith('.js') || file === 'lang-en.js' || file === 'i18n.js') continue;
    const code = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const m of code.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
      const key = m[1].replace(/\\'/g, "'");
      if (!(key in EN)) missing.add(`${file}: ${key}`);
    }
  }
  assert.deepEqual([...missing], []);
});

test('los textos de error de las reglas tienen traducción', () => {
  const code = fs.readFileSync(new URL('../src/state-manager.js', import.meta.url), 'utf8');
  const missing = new Set();
  for (const m of code.matchAll(/(?:error|reason|message):\s*'((?:[^'\\]|\\.)*)'/g)) {
    if (!(m[1] in EN)) missing.add(m[1]);
  }
  for (const m of code.matchAll(/(?:error|reason|message):\s*`((?:[^`\\]|\\.)*)`/g)) {
    const key = m[1].replace(/\$\{[^}]*\}/g, (x, i, all) => x).replace(/\$\{[^}]*\}/g, '{0}');
    if (!(key in EN)) missing.add(key);
  }
  assert.deepEqual([...missing], []);
});

test('EN_PLURAL tiene singular y plural', () => {
  Object.values(EN_PLURAL).forEach(pair => assert.equal(pair.length, 2));
});
