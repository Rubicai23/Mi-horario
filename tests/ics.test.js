import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, escapeText, foldLine } from '../src/ics.js';

const NOW = new Date(Date.UTC(2026, 9, 7, 10, 0, 0));
const block = (over = {}) => ({ id: 'b1', s: 540, e: 600, t: 'Estudio', c: 'estudio', n: '', d: false, ...over });

test('escapa comas, punto y coma, barras y saltos de línea', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\;c\\\\d\\ne');
});

test('dobla líneas largas a 75 octetos sin partir caracteres', () => {
  const folded = foldLine(`SUMMARY:${'é'.repeat(80)}`);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  parts.forEach((part, i) => {
    assert.ok(new TextEncoder().encode(part).length <= 75, `línea ${i}`);
    if (i > 0) assert.ok(part.startsWith(' '));
  });
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), `SUMMARY:${'é'.repeat(80)}`);
});

test('un evento con hora local, título, categoría y aviso', () => {
  const ics = buildIcs({ days: [{ key: '2026-10-07', blocks: [block({ n: 'Tema 3', k: [{ t: 'Leer', d: true }, { t: 'Resumen', d: false }] })] }], now: NOW, alarm: 10, categoryName: () => 'Estudio' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(ics, /DTSTART:20261007T090000\r\n/);
  assert.match(ics, /DTEND:20261007T100000\r\n/);
  assert.match(ics, /DTSTAMP:20261007T100000Z\r\n/);
  assert.match(ics, /UID:b1-20261007@mi-horario\r\n/);
  assert.match(ics, /SUMMARY:Estudio\r\n/);
  assert.match(ics, /DESCRIPTION:Tema 3\\n\[x\] Leer\\n\[ \] Resumen\r\n/);
  assert.match(ics, /CATEGORIES:Estudio\r\n/);
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Estudio\r\nTRIGGER:-PT10M\r\nEND:VALARM/);
});

test('aviso al empezar, sin aviso y con etiqueta', () => {
  const day = [{ key: '2026-10-07', blocks: [block({ g: 'g1' })] }];
  assert.match(buildIcs({ days: day, now: NOW, alarm: 0 }), /TRIGGER:PT0S/);
  assert.doesNotMatch(buildIcs({ days: day, now: NOW, alarm: null }), /VALARM/);
  assert.match(buildIcs({ days: day, now: NOW, tagName: () => 'TFG, parte 1', categoryName: () => 'Estudio' }), /CATEGORIES:Estudio,TFG\\, parte 1\r\n/);
});

test('todas las líneas acaban en CRLF y no hay eventos si no hay actividades', () => {
  const ics = buildIcs({ days: [{ key: '2026-10-07', blocks: [] }], now: NOW });
  assert.ok(!ics.includes('BEGIN:VEVENT'));
  assert.equal(ics.split('\r\n').filter(Boolean).length, ics.split('\n').filter(Boolean).length);
});

test('UID distinto para la misma actividad en días distintos', () => {
  const ics = buildIcs({ days: [{ key: '2026-10-07', blocks: [block()] }, { key: '2026-10-08', blocks: [block()] }], now: NOW });
  const uids = ics.match(/UID:[^\r]+/g);
  assert.equal(new Set(uids).size, 2);
});
