import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStreaks, createMemoryStorage, createStartWatcher, createStateManager, expandRules, occurrenceId, parseBackup,
  ruleAppliesOn, sanitizeBlock, sanitizeProfile, sanitizeRule, sanitizeSubtasks, upcomingStarts
} from '../src/state-manager.js';
import { LIMITS } from '../src/config.js';

/* Hoy = miércoles 7 de octubre de 2026, 12:00 */
let NOW = new Date(2026, 9, 7, 12, 0, 0);
const K = {
  mon: '2026-10-05', tue: '2026-10-06', wed: '2026-10-07', thu: '2026-10-08', fri: '2026-10-09',
  nextMon: '2026-10-12', nextWed: '2026-10-14', nextThu: '2026-10-15', wed2: '2026-10-21', prevWed: '2026-09-30'
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const setup = ({ initial = {}, pushResult = true } = {}) => {
  NOW = new Date(2026, 9, 7, 12, 0, 0);
  const storage = createMemoryStorage(initial);
  const calls = { push: [], remove: [], profile: [] };
  const sync = {
    push: (key, blocks) => { calls.push.push([key, blocks.map(b => b.t)]); return Promise.resolve(pushResult); },
    remove: key => { calls.remove.push(key); return Promise.resolve(pushResult); },
    pushProfile: profile => { calls.profile.push(profile); return Promise.resolve(pushResult); }
  };
  const state = createStateManager({ storage, sync, clock: () => NOW });
  return { storage, calls, state };
};
const draft = (t, s, e, extra = {}) => ({ t, s, e, c: 'estudio', n: '', ...extra });
const titles = day => day.map(b => b.t);

/* ───────── Subtareas ───────── */

test('subtareas: se saneanse, recortan y limitan', () => {
  assert.deepEqual(sanitizeSubtasks([{ t: '  a ', d: true }, { t: '', d: true }, null, { t: 5 }, { t: 'b' }]), [{ t: 'a', d: true }, { t: 'b', d: false }]);
  assert.equal(sanitizeSubtasks(Array.from({ length: 40 }, (_, i) => ({ t: `x${i}` }))).length, LIMITS.subtasks);
  assert.equal(sanitizeSubtasks([{ t: 'z'.repeat(200) }])[0].t.length, LIMITS.subtaskLength);
  assert.deepEqual(sanitizeSubtasks('no'), []);
});

test('subtareas: una actividad sin subtareas no lleva la clave k', () => {
  const block = sanitizeBlock({ id: 'a', s: 1, e: 2, t: 'x', k: [] });
  assert.equal('k' in block, false);
  assert.deepEqual(sanitizeBlock({ id: 'a', s: 1, e: 2, t: 'x', k: [{ t: 'u' }] }).k, [{ t: 'u', d: false }]);
});

test('subtareas: se guardan, se editan, se vacían y son inmutables', () => {
  const { state } = setup();
  const { block } = state.addBlock(K.mon, draft('Estudio', 540, 600, { k: [{ t: 'Tema 1', d: false }, { t: 'Tema 2', d: true }] }));
  assert.equal(state.getDay(K.mon)[0].k.length, 2);
  assert.throws(() => { state.getDay(K.mon)[0].k.push({ t: 'x', d: false }); }, TypeError);
  assert.throws(() => { state.getDay(K.mon)[0].k[0].d = true; }, TypeError);
  state.updateBlock(K.mon, block.id, { k: [{ t: 'Tema 1', d: true }, { t: 'Tema 2', d: true }] });
  assert.equal(state.getDay(K.mon)[0].k.every(item => item.d), true);
  state.updateBlock(K.mon, block.id, { k: [] });
  assert.equal('k' in state.getDay(K.mon)[0], false);
});

test('subtareas: al copiar un día se conservan sin marcar; las plantillas guardan el texto', () => {
  const { state } = setup();
  state.addBlock(K.mon, draft('Estudio', 540, 600, { k: [{ t: 'A', d: true }, { t: 'B', d: true }] }));
  state.copyDay(K.mon, [K.tue]);
  assert.deepEqual(state.getDay(K.tue)[0].k, [{ t: 'A', d: false }, { t: 'B', d: false }]);
  const { template } = state.saveTemplate('Con lista', K.mon);
  assert.deepEqual(template.blocks[0].k, [{ t: 'A', d: false }, { t: 'B', d: false }]);
  state.applyPreset(K.thu, template.id);
  assert.deepEqual(state.getDay(K.thu)[0].k, [{ t: 'A', d: false }, { t: 'B', d: false }]);
});

/* ───────── Reglas semanales (funciones puras) ───────── */

const rule = (over = {}) => sanitizeRule({ id: 'rabc', t: 'Inglés', c: 'ingles', s: 1020, e: 1080, dows: [3, 1], from: K.mon, ...over });

test('sanitizeRule: normaliza y rechaza lo inválido', () => {
  assert.deepEqual(rule().dows, [1, 3]);
  assert.equal(rule({ dows: [] }), null);
  assert.equal(rule({ dows: [9, -1, 'x'] }), null);
  assert.equal(rule({ from: 'ayer' }), null);
  assert.equal(rule({ id: 'MAL' }), null);
  assert.equal(rule({ s: 100, e: 50 }), null);
  assert.equal(rule({ until: 'xx' }).until, undefined);
  assert.equal(rule({ until: K.fri }).until, K.fri);
  assert.deepEqual(rule({ k: [{ t: 'a', d: true }] }).k, [{ t: 'a', d: false }]);
});

test('ruleAppliesOn: respeta días, inicio y fin (inclusive)', () => {
  const r = rule({ until: K.nextWed });
  assert.equal(ruleAppliesOn(r, K.mon), true);
  assert.equal(ruleAppliesOn(r, K.tue), false, 'martes no está');
  assert.equal(ruleAppliesOn(r, '2026-09-28'), false, 'antes del inicio');
  assert.equal(ruleAppliesOn(r, K.nextWed), true, 'el último día cuenta');
  assert.equal(ruleAppliesOn(r, K.wed2), false, 'después del fin');
});

test('expandRules: ids estables por regla y fecha, sin marcar, ordenadas', () => {
  const a = expandRules([rule(), rule({ id: 'rzzz', t: 'Antes', s: 400, e: 430, dows: [1] })], K.mon);
  assert.deepEqual(titles(a), ['Antes', 'Inglés']);
  assert.equal(a[1].id, occurrenceId(rule(), K.mon));
  assert.equal(a[1].id, 'rabc-20261005');
  assert.deepEqual(a.map(b => [b.d, b.n, b.r]), [[false, '', 'rzzz'], [false, '', 'rabc']]);
  assert.deepEqual(expandRules([rule()], K.tue), []);
});

test('sanitizeProfile: reglas inválidas o repetidas se descartan y se respeta el máximo', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, t: 'x', c: 'libre', s: 1, e: 2, dows: [1], from: K.mon }));
  assert.equal(sanitizeProfile({ recurring: many }).recurring.length, LIMITS.recurring);
  assert.equal(sanitizeProfile({ recurring: [many[0], many[0], { id: 'x' }] }).recurring.length, 1);
});

/* ───────── Repeticiones en el gestor ───────── */

test('repetir: una actividad nueva aparece en los mismos días de las semanas siguientes sin escribir nada', async () => {
  const { state, calls, storage } = setup();
  const result = state.addRecurring(K.wed, draft('Inglés', 1020, 1080, { c: 'ingles', n: 'unidad 1' }), [1, 3]);
  assert.equal(result.ok, true);
  assert.deepEqual(titles(state.getDay(K.wed)), ['Inglés']);
  assert.equal(state.getDay(K.wed)[0].n, 'unidad 1', 'la nota del día elegido se conserva');
  assert.deepEqual(titles(state.getDay(K.nextMon)), ['Inglés']);
  assert.deepEqual(titles(state.getDay(K.nextWed)), ['Inglés']);
  assert.deepEqual(titles(state.getDay(K.nextThu)), [], 'el jueves no está en la serie');
  assert.deepEqual(titles(state.getDay(K.mon)), [], 'el pasado no se rellena');
  assert.equal(storage.read('day:2026-10-14'), null, 'los días futuros no se guardan hasta tocarlos');
  await flush();
  assert.deepEqual(calls.push.map(([key]) => key), [K.wed], 'solo se sube el día creado');
  assert.equal(calls.profile.length, 1);
});

test('repetir: el día de la fecha elegida entra siempre en la serie', () => {
  const { state } = setup();
  const { rule: created } = state.addRecurring(K.wed, draft('Gym', 600, 660), [5]);
  assert.deepEqual(created.dows, [3, 5]);
});

test('repetir: tocar una ocurrencia futura la guarda; el resto sigue virtual', () => {
  const { state, storage } = setup();
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  const future = state.getDay(K.nextWed)[0];
  state.toggleDone(K.nextWed, future.id);
  assert.equal(state.getDay(K.nextWed)[0].d, true);
  assert.notEqual(storage.read('day:2026-10-14'), null);
  assert.equal(state.getDay(K.wed2)[0].d, false);
  assert.equal(storage.read('day:2026-10-21'), null);
});

test('repetir: borrar una ocurrencia no la resucita', () => {
  const { state } = setup();
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  const future = state.getDay(K.nextWed)[0];
  state.removeBlock(K.nextWed, future.id);
  assert.deepEqual(state.getDay(K.nextWed), []);
  assert.equal(state.getDay(K.wed2).length, 1, 'las demás semanas siguen');
});

test('repetir: vaciar un día con repeticiones mantiene el día vacío', () => {
  const { state } = setup();
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  const previous = state.clearDay(K.nextWed);
  assert.equal(previous.length, 1);
  assert.deepEqual(state.getDay(K.nextWed), []);
  state.restoreDay(K.nextWed, previous);
  assert.equal(state.getDay(K.nextWed).length, 1);
});

test('repetir: se añade también a los días ya guardados, sin solapar', () => {
  const { state } = setup();
  state.addBlock(K.nextWed, draft('Reunión', 1000, 1100));      // choca con la serie
  state.addBlock(K.wed2, draft('Otra cosa', 600, 660));          // no choca
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  assert.deepEqual(titles(state.getDay(K.nextWed)), ['Reunión'], 'se omite lo que choca');
  assert.deepEqual(titles(state.getDay(K.wed2)), ['Otra cosa', 'Inglés']);
});

test('repetir: el día elegido se añade aunque choque (el editor ya avisó)', () => {
  const { state } = setup();
  state.addBlock(K.wed, draft('Reunión', 1000, 1100));
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  assert.deepEqual(titles(state.getDay(K.wed)), ['Reunión', 'Inglés']);
});

test('repetir: convertir una actividad existente en serie', () => {
  const { state } = setup();
  const { block } = state.addBlock(K.wed, draft('Gimnasio', 1000, 1080, { c: 'gym', n: 'hoy piernas' }));
  const result = state.addRecurring(K.wed, draft('Gimnasio', 1000, 1080, { c: 'gym' }), [5], { blockId: block.id });
  assert.equal(result.ok, true);
  assert.equal(state.getDay(K.wed).length, 1, 'no se duplica');
  assert.equal(state.getDay(K.wed)[0].r, result.rule.id);
  assert.equal(state.getDay(K.wed)[0].n, 'hoy piernas');
  assert.deepEqual(titles(state.getDay(K.fri)), ['Gimnasio']);
});

test('repetir: validaciones y máximo', () => {
  const { state } = setup();
  assert.match(state.addRecurring(K.wed, draft('', 1, 2), [1]).error, /nombre/);
  assert.match(state.addRecurring(K.wed, draft('x', 10, 5), [1]).error, /posterior/);
  for (let i = 0; i < LIMITS.recurring; i++) assert.equal(state.addRecurring(K.wed, draft(`R${i}`, 1 + i, 2 + i), [1]).ok, true);
  assert.match(state.addRecurring(K.wed, draft('Una más', 900, 910), [1]).error, /Máximo/);
});

test('repetir: deshacer deja todo como estaba', async () => {
  const { state, calls } = setup();
  state.addBlock(K.nextWed, draft('Reunión', 1200, 1260));
  const before = JSON.stringify(state.getDay(K.nextWed));
  const result = state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  assert.equal(state.getDay(K.nextWed).length, 2);
  result.undo();
  assert.equal(state.listRecurring().length, 0);
  assert.equal(JSON.stringify(state.getDay(K.nextWed)), before);
  assert.deepEqual(state.getDay(K.wed), []);
  await flush();
  assert.ok(calls.remove.includes(K.wed), 'el día creado se borra de la nube');
});

test('dejar de repetir: termina la serie, conserva el pasado y quita lo futuro sin hacer', () => {
  const { state } = setup();
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  const doneFuture = state.getDay(K.nextWed)[0];
  state.toggleDone(K.nextWed, doneFuture.id);                       // hecha: se conserva
  const pending = state.getDay(K.wed2)[0];
  state.updateBlock(K.wed2, pending.id, { n: 'anotación' });          // guardada y sin hacer: se quita
  const [created] = state.listRecurring();
  const result = state.stopRecurring(created.id, K.nextWed);
  assert.equal(result.ok, true);
  assert.equal(state.listRecurring()[0].until, K.nextWed);
  assert.equal(state.getDay(K.wed).length, 1);
  assert.equal(state.getDay(K.nextWed).length, 1, 'la ocurrencia del último día se queda');
  assert.deepEqual(state.getDay(K.wed2), []);
  assert.deepEqual(state.getDay('2026-10-28'), [], 'y no se genera más');
});

test('dejar de repetir: no toca ni el pasado ni hoy si se pide una fecha anterior (corta desde hoy)', () => {
  const { state } = setup();
  state.addRecurring(K.prevWed, draft('Inglés', 1020, 1080), [3]);
  assert.equal(state.getDay(K.prevWed).length, 1);
  const [created] = state.listRecurring();
  state.stopRecurring(created.id, K.prevWed);
  assert.equal(state.listRecurring()[0].until, K.tue, 'hasta ayer');
  assert.equal(state.getDay(K.prevWed).length, 1, 'el pasado intacto');
  assert.equal(state.getDay(K.wed).length, 0, 'hoy ya no');
});

test('dejar de repetir: una serie que no llegó a empezar desaparece; deshacer la devuelve', () => {
  const { state } = setup();
  state.addRecurring(K.nextWed, draft('Inglés', 1020, 1080), [3]);
  const [created] = state.listRecurring();
  const result = state.stopRecurring(created.id, K.wed);
  assert.equal(state.listRecurring().length, 0);
  result.undo();
  assert.equal(state.listRecurring().length, 1);
  assert.equal(state.getDay(K.nextWed).length, 1);
  assert.equal(state.stopRecurring('rnoexiste', K.wed).ok, false);
});

test('cambiar la serie: desde una fecha en adelante, sin tocar lo anterior', () => {
  const { state } = setup();
  state.addRecurring(K.prevWed, draft('Inglés', 1020, 1080, { c: 'ingles' }), [3]);
  const [original] = state.listRecurring();
  state.toggleDone(K.nextWed, state.getDay(K.nextWed)[0].id);          // esta semana que viene ya hecha
  state.updateBlock(K.wed2, state.getDay(K.wed2)[0].id, { n: 'nota' });
  const result = state.changeRecurring(original.id, K.wed, { t: 'Inglés avanzado', s: 1100, e: 1160 });
  assert.equal(result.ok, true);
  assert.equal(state.listRecurring().length, 2);
  assert.equal(state.getDay(K.prevWed)[0].t, 'Inglés', 'el pasado conserva su versión');
  assert.equal(state.getDay(K.prevWed)[0].s, 1020);
  assert.equal(state.getDay(K.wed)[0].t, 'Inglés avanzado');
  assert.equal(state.getDay(K.nextWed)[0].t, 'Inglés', 'una ya hecha no se reescribe');
  assert.equal(state.getDay(K.wed2)[0].t, 'Inglés avanzado');
  assert.equal(state.getDay(K.wed2)[0].n, 'nota', 'conserva la nota');
  assert.equal(state.getDay('2026-10-28')[0].s, 1100, 'y las futuras sin guardar usan la nueva');
});

test('cambiar la serie: añadir y quitar días de la semana', () => {
  const { state } = setup();
  state.addRecurring(K.wed, draft('Gym', 1000, 1060), [3]);
  state.addBlock(K.nextThu, draft('Otro', 600, 660));                   // día guardado de un jueves
  state.addBlock(K.nextMon, draft('Otro', 600, 660));                   // lunes guardado
  state.toggleDone(K.nextMon, state.getDay(K.nextMon)[0].id);
  const [original] = state.listRecurring();
  state.changeRecurring(original.id, K.wed, { dows: [1, 4] });          // el día de hoy sale de la serie
  const [created] = state.listRecurring();
  assert.deepEqual(created.dows, [1, 4]);
  assert.deepEqual(titles(state.getDay(K.nextThu)), ['Otro', 'Gym'], 'jueves guardado recibe la actividad');
  assert.deepEqual(titles(state.getDay(K.nextMon)), ['Otro', 'Gym'], 'lunes guardado también');
  assert.deepEqual(titles(state.getDay(K.nextWed)), [], 'el miércoles ya no');
});

test('cambiar la serie: validaciones, serie terminada y deshacer', () => {
  const { state } = setup();
  state.addRecurring(K.wed, draft('Gym', 1000, 1060), [3]);
  const [original] = state.listRecurring();
  assert.match(state.changeRecurring(original.id, K.wed, { t: '' }).error, /nombre/);
  assert.match(state.changeRecurring(original.id, K.wed, { s: 1100, e: 1000 }).error, /posterior/);
  assert.equal(state.changeRecurring('rnada', K.wed, { t: 'x' }).ok, false);
  const result = state.changeRecurring(original.id, K.nextWed, { t: 'Gym 2' });
  assert.equal(state.getDay(K.nextWed)[0].t, 'Gym 2');
  assert.equal(state.getDay(K.wed)[0].t, 'Gym');
  result.undo();
  assert.equal(state.listRecurring().length, 1);
  assert.equal(state.getDay(K.nextWed)[0].t, 'Gym');
  state.stopRecurring(original.id, K.wed);
  assert.match(state.changeRecurring(original.id, K.nextWed, { t: 'x' }).error, /terminó/);
});

test('cambiar la serie desde el pasado empieza hoy', () => {
  const { state } = setup();
  state.addRecurring(K.prevWed, draft('Gym', 1000, 1060), [3]);
  const [original] = state.listRecurring();
  state.changeRecurring(original.id, K.prevWed, { t: 'Nuevo' });
  assert.equal(state.getDay(K.prevWed)[0].t, 'Gym');
  assert.equal(state.getDay(K.wed)[0].t, 'Nuevo');
});

/* ───────── Interacción con rachas, avisos y sincronización ───────── */

test('rachas: un día pasado con repeticiones sin hacer cuenta como no cumplido', () => {
  const { state } = setup();
  state.addRecurring(K.prevWed, draft('Gym', 1000, 1060), [3]);
  NOW = new Date(2026, 9, 8, 12, 0, 0);                                    // jueves
  const streak = state.streakView(NOW);
  assert.equal(streak.current, 0, 'el miércoles 7 quedó sin hacer');
  state.toggleDone(K.wed, state.getDay(K.wed)[0].id);
  assert.equal(state.streakView(NOW).current, 1);
});

test('avisos: las repeticiones futuras se programan aunque no estén guardadas', () => {
  const { state } = setup();
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  const starts = state.upcomingStarts(NOW, 8, 10);
  assert.deepEqual(starts.map(s => s.key), [K.wed, K.nextWed]);
  assert.ok(starts.every(s => s.block.r === state.listRecurring()[0].id));
});

test('sync: el perfil con repeticiones sube, y la nube rechaza datos ilegibles sin borrar nada', async () => {
  const { state, calls } = setup();
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  await flush();
  assert.equal(calls.profile.at(-1).recurring.length, 1);
  // Un perfil remoto dañado nunca borra lo local.
  assert.equal(state.applyRemoteProfile({ templates: [], recurring: 'basura' }), false);
  assert.equal(state.applyRemoteProfile({ recurring: [{ id: 'malo' }] }), false);
  assert.equal(state.listRecurring().length, 1);
});

test('sync: un perfil remoto con otra regla cambia los días generados y avisa', async () => {
  const { state } = setup();
  await flush();
  const events = [];
  state.subscribe(c => events.push(c.type));
  state.applyRemoteProfile({ templates: [], recurring: [{ id: 'rnube', t: 'Remota', c: 'libre', s: 600, e: 660, dows: [3], from: K.wed }] });
  assert.deepEqual(titles(state.getDay(K.nextWed)), ['Remota']);
  assert.ok(events.includes('profile'));
  state.applyRemoteProfile({ templates: [], recurring: [] });
  assert.deepEqual(state.getDay(K.nextWed), []);
});

test('sesión: cerrar sesión borra también las repeticiones', () => {
  const { state } = setup();
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  state.clearLocalData();
  assert.deepEqual(state.getDay(K.nextWed), []);
  assert.equal(state.listRecurring().length, 0);
});

test('copia de seguridad: incluye las repeticiones y las fusiona', () => {
  const a = setup();
  a.state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  const text = JSON.stringify(a.state.exportBackup());
  assert.equal(parseBackup(text).profile.recurring.length, 1);
  const b = setup();
  b.state.addRecurring(K.wed, draft('Otra', 600, 660), [1]);
  const result = b.state.importBackup(text);
  assert.equal(result.recurring, 1);
  assert.equal(b.state.listRecurring().length, 2);
  // 'Otra' se repite lunes y miércoles (el día de creación entra siempre); 'Inglés' el miércoles.
  assert.deepEqual(titles(b.state.getDay(K.nextWed)), ['Otra', 'Inglés']);
});

test('copiar un día no arrastra el vínculo con la serie', () => {
  const { state } = setup();
  state.addRecurring(K.wed, draft('Inglés', 1020, 1080), [3]);
  state.copyDay(K.wed, [K.thu]);
  assert.equal('r' in state.getDay(K.thu)[0], false);
});

/* ───────── Aviso con antelación ───────── */

test('antelación: el vigilante avisa N minutos antes y una sola vez', () => {
  const watcher = createStartWatcher();
  const blocks = [{ id: 'a', s: 600, e: 660, t: 'x' }];
  assert.equal(watcher.collect(K.wed, blocks, 589, 10).length, 0);
  assert.equal(watcher.collect(K.wed, blocks, 590, 10).length, 1);
  assert.equal(watcher.collect(K.wed, blocks, 590.5, 10).length, 0, 'no se repite');
  assert.equal(watcher.collect(K.wed, blocks, 600, 0).length, 1, 'cambiar la antelación vuelve a avisar');
});

test('antelación: upcomingStarts programa el aviso antes y descarta los que ya pasaron', () => {
  const blocksAt = key => (key === K.wed ? [{ id: 'a', s: 12 * 60 + 5, e: 800, t: 'x', d: false }, { id: 'b', s: 12 * 60 + 20, e: 800, t: 'y', d: false }] : []);
  const out = upcomingStarts({ blocksAt, from: NOW, horizonDays: 0, limit: 10, lead: 10 });
  assert.deepEqual(out.map(o => o.block.id), ['b'], 'el aviso de la primera (11:55) ya pasó');
  assert.equal(out[0].at.getHours() * 60 + out[0].at.getMinutes(), 12 * 60 + 10);
  assert.equal(out[0].lead, 10);
});
