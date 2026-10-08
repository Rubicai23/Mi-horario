import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareText } from '../src/summary.js';

const categories = [{ key: 'clase' }, { key: 'gym' }];
const nameOf = k => ({ clase: 'Clase', gym: 'Gimnasio' }[k]);

test('el resumen lleva totales, categorías ordenadas y racha', () => {
  const text = buildShareText({
    summary: { clase: { planned: 120, done: 60 }, gym: { planned: 180, done: 180 } },
    range: '5 – 11 oct', streak: 4, categories, nameOf
  });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Mi semana (5 – 11 oct)');
  assert.match(lines[1], /^Hecho: 4 h de 5 h \(80 %\)$/);
  assert.match(lines[2], /^• Gimnasio: 3 h de 3 h$/);
  assert.match(lines[3], /^• Clase: 1 h de 2 h$/);
  assert.equal(lines[4], 'Racha: 4 días 🔥');
});

test('semana vacía y racha de 0: sin filas ni racha', () => {
  const text = buildShareText({ summary: {}, range: 'x', streak: 0, categories, nameOf });
  assert.equal(text, 'Mi semana (x)\nSin actividades esta semana.');
});

test('una racha de 1 va en singular', () => {
  assert.match(buildShareText({ summary: {}, range: 'x', streak: 1, categories, nameOf }), /Racha: 1 día 🔥/);
});

import { weeklyDue } from '../src/summary.js';
test('weeklyDue: solo activado, con datos y una vez por semana', () => {
  const base = { enabled: true, seen: null, thisMonday: '2026-10-05', hadActivities: true };
  assert.equal(weeklyDue(base), true);
  assert.equal(weeklyDue({ ...base, enabled: false }), false);
  assert.equal(weeklyDue({ ...base, hadActivities: false }), false);
  assert.equal(weeklyDue({ ...base, seen: '2026-10-05' }), false);
  assert.equal(weeklyDue({ ...base, seen: '2026-09-28' }), true);
});
