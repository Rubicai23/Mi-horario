import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryStorage, createStateManager, parseBackup, profileHasData, sanitizeCategories, sanitizeProfile, summarizeMonth
} from '../src/state-manager.js';
import { CATEGORY_COLORS, LIMITS, STORAGE } from '../src/config.js';

const NOW = new Date(2026, 9, 7, 12, 0, 0); // miércoles 7 de octubre de 2026
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const blk = (id, s, e, c, d = false) => ({ id, s, e, t: id, c, n: '', d });
const seed = days => Object.fromEntries(Object.entries(days).map(([k, v]) => [`day:${k}`, JSON.stringify(v)]));
const setup = (days = {}, extra = {}) => {
  const storage = createMemoryStorage({ ...seed(days), ...extra });
  const calls = { profile: [] };
  const sync = {
    push: () => Promise.resolve(true), remove: () => Promise.resolve(true),
    pushProfile: p => { calls.profile.push(JSON.parse(JSON.stringify(p))); return Promise.resolve(true); }
  };
  return { storage, calls, state: createStateManager({ storage, sync, clock: () => NOW }) };
};

/* ───────── Categorías propias ───────── */

test('sanitizeCategories: solo categorías, nombres y colores permitidos', () => {
  assert.deepEqual(sanitizeCategories(undefined), {});
  assert.deepEqual(sanitizeCategories([1]), {});
  const clean = sanitizeCategories({
    clase: { l: '  Mates   y   física ', c: 'rojo' },
    gym: { c: 'javascript:alert(1)', l: 'x'.repeat(100) },
    inventada: { l: 'Hola' },
    libre: { l: '   ', c: 'no-existe' },
    rutina: 'texto'
  });
  assert.deepEqual(clean.clase, { l: 'Mates y física', c: 'rojo' });
  assert.equal(clean.gym.l.length, LIMITS.categoryLabel);
  assert.equal('c' in clean.gym, false);
  assert.deepEqual(Object.keys(clean).sort(), ['clase', 'gym']);
  assert.ok(Object.keys(CATEGORY_COLORS).includes('rojo'));
});

test('categorías: se cambian, se guardan, se suben y se pueden restaurar', async () => {
  const { state, calls, storage } = setup();
  assert.deepEqual(state.getCategories(), {});
  state.setCategory('clase', { label: 'Mates', color: 'rojo' });
  state.setCategory('clase', { color: 'azul' });
  state.setCategory('gym', { label: 'Deporte' });
  assert.deepEqual(state.getCategories(), { clase: { l: 'Mates', c: 'azul' }, gym: { l: 'Deporte' } });
  assert.equal(state.setCategory('nada', { label: 'x' }).ok, false);
  await flush();
  assert.deepEqual(calls.profile.at(-1).cats, state.getCategories());
  assert.deepEqual(JSON.parse(storage.read(STORAGE.profile)).cats.clase, { l: 'Mates', c: 'azul' });
  state.setCategory('clase', { label: '' });
  assert.deepEqual(state.getCategories().clase, { c: 'azul' });
  state.setCategory('clase', { color: null });
  assert.equal('clase' in state.getCategories(), false, 'sin nada que guardar se quita');
  const reset = state.resetCategories();
  assert.equal(reset.changed, true);
  assert.deepEqual(state.getCategories(), {});
  assert.equal('cats' in JSON.parse(storage.read(STORAGE.profile)), false);
  reset.undo();
  assert.deepEqual(state.getCategories(), { gym: { l: 'Deporte' } });
  assert.equal(state.resetCategories().changed, true);
  assert.equal(state.resetCategories().changed, false);
});

test('categorías: llegan de la nube; un documento sin ellas no borra las locales', () => {
  const { state } = setup({}, { [STORAGE.profile]: JSON.stringify({ templates: [], recurring: [], cats: { gym: { l: 'Deporte' } } }) });
  state.applyRemoteProfile({ templates: [], recurring: [] });
  assert.deepEqual(state.getCategories(), { gym: { l: 'Deporte' } });
  assert.equal(state.applyRemoteProfile({ templates: [], recurring: [], cats: { clase: { l: 'Mates', c: 'rojo' }, gym: { c: 'basura' } } }), true);
  assert.deepEqual(state.getCategories(), { clase: { l: 'Mates', c: 'rojo' } });
  assert.equal(state.applyRemoteProfile({ templates: [], recurring: [], cats: {} }), true);
  assert.deepEqual(state.getCategories(), {});
});

test('categorías: perfil con datos, copia de seguridad y ajustes de aspecto', () => {
  assert.equal(profileHasData(sanitizeProfile({ cats: { gym: { l: 'Deporte' } } })), true);
  const a = setup();
  a.state.setCategory('gym', { label: 'Deporte', color: 'verde' });
  a.state.settings.set('theme', 'dark');
  a.state.settings.set('accent', 'azul');
  const text = JSON.stringify(a.state.exportBackup());
  assert.deepEqual(parseBackup(text).profile.cats, { gym: { l: 'Deporte', c: 'verde' } });
  assert.equal(parseBackup(text).settings.length, 2);
  const b = setup();
  b.state.setCategory('clase', { label: 'Mates' });
  b.state.importBackup(text);
  assert.deepEqual(b.state.getCategories(), { clase: { l: 'Mates' }, gym: { l: 'Deporte', c: 'verde' } });
  assert.equal(b.state.settings.get('theme'), 'dark');
  const bad = JSON.stringify({ app: 'mi-horario', version: 1, data: { 'cfg:theme': 'rosa-fosforito', 'cfg:accent': '<script>', 'day:2026-10-07': '[]' } });
  assert.deepEqual(parseBackup(bad).settings, []);
});

/* ───────── Estadísticas por mes ───────── */

test('summarizeMonth: suma el tiempo del mes y cuenta los días cumplidos', () => {
  const days = {
    '2026-10-01': [blk('a', 480, 540, 'estudio', true), blk('b', 540, 600, 'gym', true)],
    '2026-10-02': [blk('c', 480, 540, 'estudio', true), blk('d', 540, 600, 'gym', false)],
    '2026-09-30': [blk('x', 480, 540, 'estudio', true)],
    '2026-11-01': [blk('y', 480, 540, 'estudio', true)]
  };
  const r = summarizeMonth({ blocksAt: k => days[k] || [], year: 2026, month: 9 });
  assert.deepEqual(r.summary, { estudio: { planned: 120, done: 120 }, gym: { planned: 120, done: 60 } });
  assert.equal(r.countedDays, 2);
  assert.equal(r.metDays, 1);
  assert.equal(summarizeMonth({ blocksAt: () => [], year: 2026, month: 1 }).countedDays, 0);
});

test('summarizeMonth: respeta la meta, los días que no cuentan y el descanso', () => {
  const days = {
    '2026-10-01': [blk('a', 480, 540, 'estudio', true), blk('b', 540, 600, 'gym', false)], // jueves: 50 %
    '2026-10-03': [blk('c', 480, 540, 'estudio', true)],                                    // sábado
    '2026-10-05': [blk('d', 480, 540, 'estudio', true)]                                     // lunes
  };
  const at = k => days[k] || [];
  assert.equal(summarizeMonth({ blocksAt: at, year: 2026, month: 9 }).metDays, 2);
  assert.equal(summarizeMonth({ blocksAt: at, year: 2026, month: 9, config: { goal: 50, days: [0, 1, 2, 3, 4, 5, 6] } }).metDays, 3);
  const weekdays = summarizeMonth({ blocksAt: at, year: 2026, month: 9, config: { goal: 80, days: [1, 2, 3, 4, 5] } });
  assert.equal(weekdays.countedDays, 2);
  assert.equal(weekdays.metDays, 1);
  const rest = summarizeMonth({ blocksAt: at, year: 2026, month: 9, rest: new Set(['2026-10-05']) });
  assert.equal(rest.countedDays, 2);
});

test('monthSummary: navega por meses e incluye los días generados por repeticiones', () => {
  const { state } = setup({ '2026-09-15': [blk('p', 480, 540, 'estudio', true)], '2026-10-07': [blk('h', 480, 540, 'gym', true)] });
  state.addRecurring('2026-10-07', { t: 'Inglés', s: 600, e: 660, c: 'ingles' }, [3]);
  const now = state.monthSummary(NOW);
  assert.equal(now.month, 9);
  assert.equal(now.summary.gym.done, 60);
  assert.equal(now.summary.ingles.planned, 60 * 4, 'miércoles 7, 14, 21 y 28');
  assert.equal(state.monthSummary(NOW, -1).summary.estudio.done, 60);
  assert.equal(state.monthSummary(NOW, -1).month, 8);
  assert.equal(state.monthSummary(NOW, 3).month, 0);
  assert.equal(state.monthSummary(NOW, 3).year, 2027);
});
