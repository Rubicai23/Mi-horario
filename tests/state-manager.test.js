import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStreaks, createMemoryStorage, createStartWatcher, createStateManager, dayProgress, describeDay,
  findNextPlannedDay, instantiatePreset, parseBackup, reorderBlocks, requiredCount, sanitizeBlock,
  sanitizeBlocks, summarizeWeek, upcomingStarts, validateDraft, weekStrip
} from '../src/state-manager.js';
import { PRESETS } from '../src/config.js';

/* Hoy = miércoles 7 de octubre de 2026, 12:00 (hora local) */
const TODAY = new Date(2026, 9, 7, 12, 0, 0);
const KEY = { fri: '2026-10-02', sat: '2026-10-03', sun: '2026-10-04', mon: '2026-10-05', tue: '2026-10-06', wed: '2026-10-07', thu: '2026-10-08' };

/** Día con `total` actividades de 10 min, las primeras `done` marcadas como hechas. */
const day = (done, total) => Array.from({ length: total }, (_, i) => ({
  id: `b${i}`, s: 480 + i * 10, e: 485 + i * 10, t: `Actividad ${i}`, c: 'estudio', n: '', d: i < done
}));
const streaksFor = (days, today = TODAY) => computeStreaks({
  blocksAt: key => days[key] || [],
  today,
  earliestKey: Object.keys(days).sort()[0] || null
});
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/* ───────── Objetivo del 80 % ───────── */

test('requiredCount redondea hacia arriba el 80 %', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 8, 10].map(requiredCount), [0, 1, 2, 3, 4, 4, 7, 8]);
});

test('dayProgress: el límite exacto del 80 % cumple y por debajo no', () => {
  assert.equal(dayProgress(day(4, 5)).met, true);
  assert.equal(dayProgress(day(3, 5)).met, false);
  assert.equal(dayProgress(day(7, 8)).met, true);
  assert.equal(dayProgress(day(6, 8)).met, false);
  assert.equal(dayProgress(day(1, 1)).met, true);
  assert.equal(dayProgress(day(0, 1)).met, false);
});

test('dayProgress: un día sin actividades nunca cumple', () => {
  assert.deepEqual(dayProgress([]), { total: 0, done: 0, required: 0, remaining: 0, met: false });
});

test('dayProgress: remaining cuenta lo que falta para el objetivo', () => {
  assert.equal(dayProgress(day(3, 8)).remaining, 4);
  assert.equal(dayProgress(day(8, 8)).remaining, 0);
});

/* ───────── Rachas ───────── */

test('racha: días consecutivos cumplidos, incluido hoy', () => {
  const result = streaksFor({ [KEY.mon]: day(5, 5), [KEY.tue]: day(4, 5), [KEY.wed]: day(5, 5) });
  assert.deepEqual(result, { current: 3, best: 3 });
});

test('racha: hoy en curso no rompe la racha, pero tampoco suma', () => {
  const result = streaksFor({ [KEY.mon]: day(5, 5), [KEY.tue]: day(5, 5), [KEY.wed]: day(1, 5) });
  assert.equal(result.current, 2);
});

test('racha: un día pasado por debajo del 80 % la rompe', () => {
  const result = streaksFor({ [KEY.mon]: day(5, 5), [KEY.tue]: day(3, 5), [KEY.wed]: day(5, 5) });
  assert.deepEqual(result, { current: 1, best: 1 });
});

test('racha: un fin de semana sin plan no la rompe', () => {
  const monday = new Date(2026, 9, 5, 9, 0);
  const result = streaksFor({ [KEY.fri]: day(5, 5), [KEY.mon]: day(5, 5) }, monday);
  assert.equal(result.current, 2);
});

test('racha: tres días vacíos seguidos sí la rompen (no se conserva abandonando la app)', () => {
  const monday = new Date(2026, 9, 5, 9, 0);
  const result = streaksFor({ '2026-10-01': day(5, 5), [KEY.mon]: day(5, 5) }, monday);
  // jueves 1 cumplido; vie, sáb y dom vacíos (3 días) → el lunes empieza una racha nueva
  assert.equal(result.current, 1);
});

test('racha: hoy vacío no rompe la racha de ayer', () => {
  const monday = new Date(2026, 9, 5, 9, 0);
  const result = streaksFor({ [KEY.fri]: day(5, 5) }, monday);
  assert.equal(result.current, 1);
});

test('racha: la mejor racha histórica se conserva aunque la actual sea menor', () => {
  const days = {};
  ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].forEach(k => { days[k] = day(5, 5); });
  days['2026-09-28'] = day(0, 5); // lunes fallado
  days[KEY.tue] = day(5, 5);
  days[KEY.wed] = day(5, 5);
  assert.deepEqual(streaksFor(days), { current: 2, best: 5 });
});

test('racha: sin datos es 0', () => {
  assert.deepEqual(streaksFor({}), { current: 0, best: 0 });
});

test('weekStrip: estado de cada día de la semana', () => {
  const days = { [KEY.mon]: day(5, 5), [KEY.tue]: day(1, 5), [KEY.wed]: day(1, 5) };
  const strip = weekStrip({ blocksAt: k => days[k] || [], today: TODAY });
  assert.deepEqual(strip.map(d => d.status), ['met', 'missed', 'pending', 'future', 'future', 'future', 'future']);
  assert.equal(strip[2].isToday, true);
  assert.deepEqual(strip.map(d => d.dow), [1, 2, 3, 4, 5, 6, 0]);
});

/* ───────── Saneado ───────── */

test('sanitizeBlock descarta datos inválidos y conserva los válidos', () => {
  assert.equal(sanitizeBlock(null), null);
  assert.equal(sanitizeBlock({ s: 10, e: 5, t: 'x' }), null);
  assert.equal(sanitizeBlock({ s: 10, e: 20, t: '   ' }), null);
  assert.equal(sanitizeBlock({ s: 'a', e: 20, t: 'x' }), null);
  const b = sanitizeBlock({ id: 'ok-1', s: 60, e: 120, t: ' Estudiar ', c: 'inventada', n: 'nota', d: true, p: 'morning', extra: 1 });
  assert.deepEqual(b, { id: 'ok-1', s: 60, e: 120, t: 'Estudiar', c: 'rutina', n: 'nota', d: true, p: 'morning' });
});

test('sanitizeBlock rechaza ids y plantillas con caracteres peligrosos', () => {
  const b = sanitizeBlock({ id: '"><img src=x>', s: 60, e: 120, t: 'x', p: '<script>' });
  assert.match(b.id, /^[\w-]{1,40}$/);
  assert.equal('p' in b, false);
});

test('sanitizeBlocks ordena y limita; no-array → null', () => {
  assert.equal(sanitizeBlocks('x'), null);
  const out = sanitizeBlocks([{ s: 100, e: 110, t: 'b' }, { s: 10, e: 20, t: 'a' }, { nope: 1 }]);
  assert.deepEqual(out.map(b => b.t), ['a', 'b']);
});

test('validateDraft', () => {
  assert.match(validateDraft({ t: '', s: 1, e: 2 }), /nombre/);
  assert.match(validateDraft({ t: 'x', s: NaN, e: 2 }), /hora/);
  assert.match(validateDraft({ t: 'x', s: 5, e: 5 }), /posterior/);
  assert.equal(validateDraft({ t: 'x', s: 5, e: 6 }), null);
});

/* ───────── Funciones puras sobre un día ───────── */

test('describeDay', () => {
  const blocks = sanitizeBlocks([{ s: 60, e: 120, t: 'a' }, { s: 120, e: 180, t: 'b' }]);
  assert.equal(describeDay([], 0).kind, 'empty');
  assert.equal(describeDay(blocks, 30).kind, 'upcoming');
  assert.equal(describeDay(blocks, 90).kind, 'current');
  assert.equal(describeDay(blocks, 90).next.t, 'b');
  assert.equal(describeDay(blocks, 200).kind, 'finished');
});

test('reorderBlocks conserva duraciones y encadena las horas', () => {
  const blocks = sanitizeBlocks([{ id: 'a', s: 60, e: 120, t: 'a' }, { id: 'b', s: 300, e: 330, t: 'b' }]);
  const out = reorderBlocks(blocks, ['b', 'a']);
  assert.deepEqual(out.map(b => [b.id, b.s, b.e]), [['b', 60, 90], ['a', 90, 150]]);
  assert.equal(reorderBlocks(blocks, ['a']), blocks, 'ids incompletos: sin cambios');
  assert.equal(reorderBlocks(blocks, ['a', 'a']), blocks, 'ids repetidos: sin cambios');
});

test('summarizeWeek suma planificado y hecho por categoría', () => {
  const out = summarizeWeek([[{ s: 0, e: 60, c: 'gym', d: true }], [{ s: 0, e: 30, c: 'gym', d: false }]]);
  assert.deepEqual(out.gym, { planned: 90, done: 60 });
});

test('instantiatePreset omite actividades que se solapan', () => {
  const morning = PRESETS.find(p => p.id === 'morning');
  const existing = sanitizeBlocks([{ s: 7 * 60 + 10, e: 7 * 60 + 20, t: 'Ya ocupado' }]);
  const { added, skipped } = instantiatePreset(morning, 1, existing);
  assert.equal(added.length + skipped.length, 3);
  assert.equal(skipped.length, 1);
  assert.ok(added.every(b => b.p === 'morning'));
});

test('upcomingStarts: ordena, excluye pasadas y hechas, y respeta el límite', () => {
  const days = {
    [KEY.wed]: sanitizeBlocks([
      { id: 'p', s: 11 * 60, e: 11 * 60 + 30, t: 'pasada' },
      { id: 'f', s: 13 * 60, e: 14 * 60, t: 'futura' },
      { id: 'd', s: 15 * 60, e: 16 * 60, t: 'hecha', d: true }
    ]),
    [KEY.thu]: sanitizeBlocks([{ id: 'm', s: 8 * 60, e: 9 * 60, t: 'mañana' }])
  };
  const all = upcomingStarts({ blocksAt: k => days[k] || [], from: TODAY, horizonDays: 7, limit: 60 });
  assert.deepEqual(all.map(x => x.block.id), ['f', 'm']);
  assert.equal(all[0].at.getHours(), 13);
  const limited = upcomingStarts({ blocksAt: k => days[k] || [], from: TODAY, horizonDays: 7, limit: 1 });
  assert.equal(limited.length, 1);
});

test('findNextPlannedDay', () => {
  const days = { '2026-10-09': sanitizeBlocks([{ s: 420, e: 480, t: 'x' }]), [KEY.tue]: sanitizeBlocks([{ s: 60, e: 90, t: 'pasado' }]) };
  const next = findNextPlannedDay({ blocksAt: k => days[k] || [], from: TODAY });
  assert.equal(next.date.getDate(), 9);
  assert.equal(next.first, 420);
  assert.equal(findNextPlannedDay({ blocksAt: () => [], from: TODAY }), null);
});

test('createStartWatcher avisa una sola vez por actividad', () => {
  const blocks = sanitizeBlocks([{ id: 'a', s: 600, e: 660, t: 'a' }]);
  const watcher = createStartWatcher(2);
  assert.equal(watcher.collect(KEY.wed, blocks, 599).length, 0);
  assert.equal(watcher.collect(KEY.wed, blocks, 600.2).length, 1);
  assert.equal(watcher.collect(KEY.wed, blocks, 600.9).length, 0);
  assert.equal(watcher.collect(KEY.thu, blocks, 600.2).length, 1, 'otro día, aviso nuevo');
});

/* ───────── Gestor de estado ───────── */

const setup = ({ pushResult = true, initial = {} } = {}) => {
  const storage = createMemoryStorage(initial);
  const calls = { push: [], remove: [] };
  const sync = {
    push: (key, blocks) => { calls.push.push([key, blocks.length]); return Promise.resolve(pushResult); },
    remove: key => { calls.remove.push(key); return Promise.resolve(pushResult); }
  };
  const state = createStateManager({ storage, sync, clock: () => TODAY });
  return { storage, calls, state };
};
const draft = (t, s = 600, e = 660) => ({ t, s, e, c: 'estudio', n: '' });

test('estado: un usuario nuevo parte de un día vacío', () => {
  const { state } = setup();
  assert.equal(state.getDay(KEY.mon).length, 0);
  assert.equal(state.savedDayCount(), 0);
  assert.equal(state.hasSavedDay(KEY.mon), false);
});

test('estado: addBlock valida, ordena, persiste y sube a la nube', async () => {
  const { state, calls, storage } = setup();
  assert.equal(state.addBlock(KEY.mon, draft('')).ok, false);
  assert.equal(state.addBlock(KEY.mon, draft('b', 700, 760)).ok, true);
  assert.equal(state.addBlock(KEY.mon, draft('a', 600, 660)).ok, true);
  assert.deepEqual(state.getDay(KEY.mon).map(b => b.t), ['a', 'b']);
  assert.equal(state.hasSavedDay(KEY.mon), true);
  assert.deepEqual(calls.push.at(-1), [KEY.mon, 2]);
  await flush();
  assert.equal(storage.read('meta:dirty'), null, 'confirmado en la nube → ya no está pendiente');
});

test('estado: los días son inmutables', () => {
  const { state } = setup();
  state.addBlock(KEY.mon, draft('a'));
  assert.throws(() => { state.getDay(KEY.mon)[0].t = 'hack'; }, TypeError);
  assert.throws(() => state.getDay(KEY.mon).push({}), TypeError);
});

test('estado: fechas inválidas lanzan error', () => {
  const { state } = setup();
  assert.throws(() => state.getDay('2026-02-31'), TypeError);
  assert.throws(() => state.addBlock('nope', draft('x')), TypeError);
});

test('estado: updateBlock valida el resultado combinado', () => {
  const { state } = setup();
  const { block } = state.addBlock(KEY.mon, draft('a', 600, 660));
  assert.equal(state.updateBlock(KEY.mon, block.id, { e: 500 }).ok, false);
  assert.equal(state.updateBlock(KEY.mon, block.id, { t: 'b', n: 'nota' }).ok, true);
  assert.equal(state.getDay(KEY.mon)[0].t, 'b');
  assert.equal(state.updateBlock(KEY.mon, 'inexistente', { t: 'x' }).ok, false);
});

test('estado: toggleDone devuelve el progreso antes y después', () => {
  const { state } = setup();
  const ids = [1, 2, 3, 4, 5].map(i => state.addBlock(KEY.mon, draft(`t${i}`, i * 100, i * 100 + 50)).block.id);
  ids.slice(0, 3).forEach(id => state.toggleDone(KEY.mon, id));
  const r = state.toggleDone(KEY.mon, ids[3]);
  assert.equal(r.before.met, false);
  assert.equal(r.after.met, true, 'la 4.ª de 5 alcanza el 80 %');
  assert.equal(state.toggleDone(KEY.mon, ids[3]).done, false);
});

test('estado: removeBlock + restoreBlock (deshacer)', () => {
  const { state } = setup();
  const { block } = state.addBlock(KEY.mon, draft('a'));
  const { removed } = state.removeBlock(KEY.mon, block.id);
  assert.equal(state.getDay(KEY.mon).length, 0);
  assert.equal(state.restoreBlock(KEY.mon, removed).ok, true);
  assert.equal(state.restoreBlock(KEY.mon, removed).ok, false, 'no se duplica');
  assert.equal(state.getDay(KEY.mon).length, 1);
});

test('estado: clearDay borra el día en la nube y se puede deshacer', () => {
  const { state, calls } = setup();
  state.addBlock(KEY.mon, draft('a'));
  const previous = state.clearDay(KEY.mon);
  assert.equal(previous.length, 1);
  assert.equal(state.getDay(KEY.mon).length, 0);
  assert.equal(state.hasSavedDay(KEY.mon), false);
  assert.deepEqual(calls.remove, [KEY.mon]);
  state.restoreDay(KEY.mon, previous);
  assert.equal(state.getDay(KEY.mon).length, 1);
});

test('estado: reorder', () => {
  const { state } = setup();
  const a = state.addBlock(KEY.mon, draft('a', 60, 120)).block;
  const b = state.addBlock(KEY.mon, draft('b', 300, 330)).block;
  assert.equal(state.reorder(KEY.mon, [b.id, a.id]).ok, true);
  assert.deepEqual(state.getDay(KEY.mon).map(x => x.t), ['b', 'a']);
  assert.equal(state.reorder(KEY.mon, [b.id]).ok, false);
});

test('estado: plantillas del onboarding', () => {
  const { state } = setup();
  let presets = state.availablePresets(KEY.mon);
  assert.deepEqual(presets.map(p => p.id), ['morning', 'focus', 'sample-dam']);
  assert.equal(presets[0].count, 3);
  assert.equal(presets[0].from, '07:00');
  assert.equal(presets[0].to, '08:15');

  const first = state.applyPreset(KEY.mon, 'morning');
  assert.deepEqual([first.ok, first.added], [true, 3]);
  assert.ok(state.getDay(KEY.mon).every(b => b.p === 'morning'));
  presets = state.availablePresets(KEY.mon);
  assert.equal(presets.find(p => p.id === 'morning').used, true);

  const again = state.applyPreset(KEY.mon, 'morning');
  assert.equal(again.ok, false, 'todo solapa con lo ya añadido');
  assert.equal(state.getDay(KEY.mon).length, 3);
  assert.equal(state.applyPreset(KEY.mon, 'no-existe').ok, false);
});

test('estado: el horario de ejemplo solo se ofrece de lunes a viernes', () => {
  const { state } = setup();
  assert.ok(state.availablePresets(KEY.mon).some(p => p.id === 'sample-dam'));
  assert.ok(!state.availablePresets(KEY.sat).some(p => p.id === 'sample-dam'));
  assert.equal(state.applyPreset(KEY.mon, 'sample-dam').ok, true);
  assert.equal(state.getDay(KEY.mon).length, 10);
});

test('estado: la racha refleja las acciones del usuario', () => {
  const { state } = setup();
  state.applyPreset(KEY.mon, 'morning');
  state.getDay(KEY.mon).forEach(b => state.toggleDone(KEY.mon, b.id));
  const view = state.streakView(new Date(2026, 9, 5, 20, 0));
  assert.equal(view.current, 1);
  assert.equal(view.today.met, true);
  assert.equal(view.week.length, 7);
});

/* ───────── Sincronización ───────── */

test('sync: un cambio sin confirmar queda pendiente y no lo pisa la nube', async () => {
  const { state, storage } = setup({ pushResult: false });
  const { block } = state.addBlock(KEY.mon, draft('local'));
  await flush();
  assert.ok(storage.read('meta:dirty').includes(KEY.mon));
  const changed = state.applyRemoteChanges([{ key: KEY.mon, blocks: [{ s: 1, e: 2, t: 'remoto' }] }]);
  assert.equal(changed, false);
  assert.equal(state.getDay(KEY.mon)[0].id, block.id);
});

test('sync: aplica cambios remotos y detecta que no hay cambios reales', () => {
  const { state } = setup();
  const remote = [{ id: 'r1', s: 60, e: 120, t: 'remota', c: 'gym', n: '', d: false }];
  assert.equal(state.applyRemoteChanges([{ key: KEY.tue, blocks: remote }]), true);
  assert.equal(state.getDay(KEY.tue)[0].t, 'remota');
  assert.equal(state.applyRemoteChanges([{ key: KEY.tue, blocks: remote }]), false, 'mismos datos');
  assert.equal(state.applyRemoteChanges([{ key: KEY.tue, blocks: null }]), true, 'borrado remoto');
  assert.equal(state.getDay(KEY.tue).length, 0);
});

test('sync: datos remotos corruptos nunca vacían un día', () => {
  const { state } = setup({ initial: { 'day:2026-10-06': JSON.stringify([{ id: 'x', s: 1, e: 2, t: 'ok', c: 'gym', n: '', d: false }]) } });
  assert.equal(state.applyRemoteChanges([{ key: KEY.tue, blocks: [{ basura: true }] }]), false);
  assert.equal(state.applyRemoteChanges([{ key: KEY.tue, blocks: 'xx' }]), false);
  assert.equal(state.getDay(KEY.tue).length, 1);
  assert.equal(state.applyRemoteChanges([{ key: KEY.tue, blocks: [] }]), true, 'un día vacío legítimo sí se aplica');
  assert.equal(state.getDay(KEY.tue).length, 0);
});

test('sync: reconcile sube lo pendiente y lo que solo existe en este dispositivo', async () => {
  const { state, calls } = setup({
    initial: {
      'day:2026-10-05': JSON.stringify([{ id: 'a', s: 1, e: 2, t: 'solo local', c: 'gym', n: '', d: false }]),
      'day:2026-10-06': JSON.stringify([{ id: 'b', s: 1, e: 2, t: 'ya en la nube', c: 'gym', n: '', d: false }]),
      'meta:dirty': JSON.stringify({ '2026-10-07': 'del' })
    }
  });
  state.reconcile([KEY.tue]);
  await flush();
  assert.deepEqual(calls.push.map(c => c[0]), [KEY.mon]);
  assert.deepEqual(calls.remove, [KEY.wed]);
});

test('sync: el formato antiguo de pendientes (array) se interpreta como "put"', () => {
  const { state, calls } = setup({
    initial: {
      'day:2026-10-05': JSON.stringify([{ id: 'a', s: 1, e: 2, t: 'x', c: 'gym', n: '', d: false }]),
      'meta:dirty': JSON.stringify([KEY.mon])
    }
  });
  state.reconcile([KEY.mon]);
  assert.deepEqual(calls.push.map(c => c[0]), [KEY.mon]);
});

test('sync: un fallo síncrono del servicio de nube no rompe la edición', () => {
  const storage = createMemoryStorage();
  const state = createStateManager({ storage, sync: { push: () => { throw new Error('boom'); }, remove: () => { throw new Error('boom'); } } });
  assert.equal(state.addBlock(KEY.mon, draft('a')).ok, true);
  assert.ok(storage.read('meta:dirty').includes(KEY.mon));
});

test('sesión: clearLocalData borra días, pendientes y cuenta, pero conserva ajustes', () => {
  const { state, storage } = setup();
  state.setSessionUid('abc');
  state.settings.setFlag('notify', true);
  state.addBlock(KEY.mon, draft('a'));
  state.clearLocalData();
  assert.equal(state.savedDayCount(), 0);
  assert.equal(state.getDay(KEY.mon).length, 0);
  assert.equal(state.getSessionUid(), null);
  assert.equal(storage.read('meta:dirty'), null);
  assert.equal(state.settings.getFlag('notify'), true);
});

test('estado: notifica los cambios a los suscriptores', () => {
  const { state } = setup();
  const events = [];
  const off = state.subscribe(e => events.push(e.origin));
  state.addBlock(KEY.mon, draft('a'));
  state.applyRemoteChanges([{ key: KEY.tue, blocks: [{ s: 1, e: 2, t: 'r' }] }]);
  off();
  state.addBlock(KEY.mon, draft('b', 900, 960));
  assert.deepEqual(events, ['local', 'remote']);
});

/* ───────── Copias de seguridad ───────── */

test('copia de seguridad: exportar e importar conserva los datos', () => {
  const a = setup();
  a.state.applyPreset(KEY.mon, 'morning');
  a.state.settings.setFlag('notify', true);
  const text = JSON.stringify(a.state.exportBackup());

  const b = setup();
  const result = b.state.importBackup(text);
  assert.equal(result.days, 1);
  assert.deepEqual(b.state.getDay(KEY.mon).map(x => x.t), a.state.getDay(KEY.mon).map(x => x.t));
  assert.equal(b.state.settings.getFlag('notify'), true);
  assert.ok(b.calls.push.length >= 1, 'lo importado se sube a la nube');
});

test('copia de seguridad: rechaza archivos ajenos o corruptos', () => {
  assert.throws(() => parseBackup('no es json'), /JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'otra', data: {} })), /copia de Mi horario/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'mi-horario', data: { 'day:xxxx': '[]' } })), /datos válidos/);
});

test('copia de seguridad: ignora claves que no son de la app y ajustes no permitidos', () => {
  const text = JSON.stringify({
    app: 'mi-horario',
    data: {
      'day:2026-10-05': JSON.stringify([{ s: 1, e: 2, t: 'ok' }]),
      'day:2026-13-45': '[]',
      'meta:uid': 'intruso',
      'cfg:analytics': '1',
      'cfg:notify': '1'
    }
  });
  const { days, settings } = parseBackup(text);
  assert.equal(days.length, 1);
  assert.deepEqual(settings, [['cfg:notify', '1']]);
});
