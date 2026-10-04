import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryStorage, createStateManager, findOverlaps, instantiatePreset, mergeTemplates, parseBackup,
  placeBlocks, sanitizeProfile, sanitizeTemplate
} from '../src/state-manager.js';
import { LIMITS, PRESETS } from '../src/config.js';

const TODAY = new Date(2026, 9, 7, 12, 0, 0);
const KEY = { mon: '2026-10-05', tue: '2026-10-06', wed: '2026-10-07', thu: '2026-10-08', fri: '2026-10-09', nextMon: '2026-10-12' };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const setup = ({ pushResult = true, initial = {} } = {}) => {
  const storage = createMemoryStorage(initial);
  const calls = { push: [], remove: [], profile: [] };
  const sync = {
    push: (key, blocks) => { calls.push.push([key, blocks.length]); return Promise.resolve(pushResult); },
    remove: key => { calls.remove.push(key); return Promise.resolve(pushResult); },
    pushProfile: profile => { calls.profile.push(profile); return Promise.resolve(pushResult); }
  };
  const state = createStateManager({ storage, sync, clock: () => TODAY });
  return { storage, calls, state };
};
const draft = (t, s, e, extra = {}) => ({ t, s, e, c: 'estudio', n: '', ...extra });

/** Lunes con tres actividades: una hecha y una con nota. */
const seedMonday = state => {
  const a = state.addBlock(KEY.mon, draft('Desayuno', 420, 450, { c: 'rutina', n: 'tostadas' })).block;
  state.addBlock(KEY.mon, draft('Estudio', 540, 660));
  state.addBlock(KEY.mon, draft('Gimnasio', 900, 960, { c: 'gym' }));
  state.toggleDone(KEY.mon, a.id);
  return state.getDay(KEY.mon);
};

/* ───────── Solapamientos ───────── */

test('findOverlaps: solo cuenta solapes reales (tocarse en el borde no lo es)', () => {
  const blocks = [{ id: 'a', s: 600, e: 660 }, { id: 'b', s: 700, e: 760 }];
  assert.deepEqual(findOverlaps(blocks, { s: 630, e: 650 }).map(b => b.id), ['a']);
  assert.deepEqual(findOverlaps(blocks, { s: 660, e: 700 }), [], 'encaja entre las dos');
  assert.deepEqual(findOverlaps(blocks, { s: 650, e: 710 }).map(b => b.id), ['a', 'b']);
});

test('findOverlaps: ignora la propia actividad al editarla y los rangos incompletos', () => {
  const blocks = [{ id: 'a', s: 600, e: 660 }];
  assert.deepEqual(findOverlaps(blocks, { s: 610, e: 650 }, 'a'), []);
  assert.deepEqual(findOverlaps(blocks, { s: NaN, e: 650 }), []);
  assert.deepEqual(findOverlaps(blocks, { s: 700, e: 650 }), []);
});

test('placeBlocks: omite las que chocan con lo existente y entre sí', () => {
  const existing = [{ id: 'x', s: 600, e: 660, t: 'X' }];
  const { added, skipped } = placeBlocks(existing, [
    { id: '1', s: 620, e: 640, t: 'choca' }, { id: '2', s: 660, e: 700, t: 'libre' }, { id: '3', s: 680, e: 720, t: 'choca con 2' }
  ]);
  assert.deepEqual(added.map(b => b.id), ['2']);
  assert.deepEqual(skipped, ['choca', 'choca con 2']);
});

test('instantiatePreset sigue marcando el origen y omitiendo solapes', () => {
  const morning = PRESETS.find(p => p.id === 'morning');
  const { added, skipped } = instantiatePreset(morning, 1, [{ id: 'z', s: 480, e: 495, t: 'ocupado' }]);
  assert.equal(added.length, 2);
  assert.deepEqual(skipped, ['Repasar el plan del día']);
  assert.ok(added.every(b => b.p === 'morning'));
});

/* ───────── Copiar día ───────── */

test('copyDay: copia sin marcar, sin notas y con ids nuevos; no toca el origen', async () => {
  const { state, calls } = setup();
  const source = seedMonday(state);
  const result = state.copyDay(KEY.mon, [KEY.tue, KEY.wed]);
  assert.equal(result.ok, true);
  assert.equal(result.days, 2);
  assert.equal(result.added, 6);
  const copy = state.getDay(KEY.tue);
  assert.deepEqual(copy.map(b => [b.t, b.s, b.e, b.c]), source.map(b => [b.t, b.s, b.e, b.c]));
  assert.ok(copy.every(b => b.d === false && b.n === ''), 'sin hechas ni notas');
  assert.equal(new Set([...copy, ...source, ...state.getDay(KEY.wed)].map(b => b.id)).size, 9, 'ids únicos');
  assert.equal(state.getDay(KEY.mon).find(b => b.t === 'Desayuno').n, 'tostadas', 'el origen conserva su nota');
  await flush();
  assert.ok(calls.push.some(([key]) => key === KEY.tue) && calls.push.some(([key]) => key === KEY.wed), 'se sube a la nube');
});

test('copyDay: por defecto no pisa lo existente y omite lo que choca', () => {
  const { state } = setup();
  seedMonday(state);
  state.addBlock(KEY.tue, draft('Reunión', 530, 600)); // choca con Estudio (540–660)
  const result = state.copyDay(KEY.mon, [KEY.tue]);
  assert.equal(result.ok, true);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(state.getDay(KEY.tue).map(b => b.t), ['Desayuno', 'Reunión', 'Gimnasio']);
});

test('copyDay con replace sustituye el día de destino', () => {
  const { state } = setup();
  seedMonday(state);
  state.addBlock(KEY.tue, draft('Reunión', 530, 600));
  state.copyDay(KEY.mon, [KEY.tue], { replace: true });
  assert.deepEqual(state.getDay(KEY.tue).map(b => b.t), ['Desayuno', 'Estudio', 'Gimnasio']);
});

test('copyDay: deshacer devuelve cada día a su estado anterior (también los que estaban vacíos)', async () => {
  const { state, calls } = setup();
  seedMonday(state);
  state.addBlock(KEY.tue, draft('Reunión', 530, 600));
  const result = state.copyDay(KEY.mon, [KEY.tue, KEY.wed], { replace: true });
  state.undoCopy(result.previous);
  assert.deepEqual(state.getDay(KEY.tue).map(b => b.t), ['Reunión']);
  assert.equal(state.getDay(KEY.wed).length, 0);
  await flush();
  assert.ok(calls.remove.includes(KEY.wed), 'el día que estaba vacío se borra de la nube');
});

test('copyDay: errores claros y sin cambios', () => {
  const { state } = setup();
  assert.match(state.copyDay(KEY.mon, [KEY.tue]).error, /no tiene actividades/);
  seedMonday(state);
  assert.match(state.copyDay(KEY.mon, []).error, /al menos un día/);
  assert.match(state.copyDay(KEY.mon, [KEY.mon, 'xx']).error, /al menos un día/, 'el origen y las claves inválidas se ignoran');
  assert.throws(() => state.copyDay('xx', [KEY.tue]), TypeError);
  state.copyDay(KEY.mon, [KEY.tue]);
  const again = state.copyDay(KEY.mon, [KEY.tue]);
  assert.equal(again.ok, false, 'copiar dos veces lo mismo no duplica: todo choca');
  assert.equal(state.getDay(KEY.tue).length, 3);
});

test('copyDay respeta el máximo de actividades por día', () => {
  const { state } = setup();
  for (let i = 0; i < 40; i++) state.addBlock(KEY.mon, draft(`A${i}`, i * 10, i * 10 + 5));
  for (let i = 0; i < 40; i++) state.addBlock(KEY.tue, draft(`B${i}`, 500 + i * 10, 505 + i * 10));
  const before = state.getDay(KEY.tue).length;
  state.copyDay(KEY.mon, [KEY.tue]);
  assert.ok(state.getDay(KEY.tue).length <= LIMITS.blocksPerDay);
  assert.ok(state.getDay(KEY.tue).length >= before);
});

/* ───────── Plantillas propias ───────── */

test('sanitizeTemplate: exige id, nombre y actividades válidas, y no guarda notas ni estado', () => {
  const ok = sanitizeTemplate({ id: 'tabc123', name: '  Mi día ', blocks: [{ s: 60, e: 90, t: 'X', c: 'gym', n: 'secreto', d: true, id: 'zz' }] });
  assert.deepEqual(ok, { id: 'tabc123', name: 'Mi día', blocks: [{ s: 60, e: 90, t: 'X', c: 'gym' }] });
  assert.equal(sanitizeTemplate({ id: 'XYZ', name: 'a', blocks: [{ s: 1, e: 2, t: 'x' }] }), null, 'id con mayúsculas');
  assert.equal(sanitizeTemplate({ id: 'tabc', name: '', blocks: [{ s: 1, e: 2, t: 'x' }] }), null);
  assert.equal(sanitizeTemplate({ id: 'tabc', name: 'a', blocks: [{ s: 5, e: 2, t: 'x' }] }), null);
  assert.equal(sanitizeTemplate(null), null);
});

test('sanitizeProfile: descarta plantillas inválidas y duplicadas y respeta el máximo', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, name: `P${i}`, blocks: [{ s: 1, e: 2, t: 'x' }] }));
  assert.equal(sanitizeProfile({ templates: many }).templates.length, LIMITS.templates);
  const dup = sanitizeProfile({ templates: [many[0], many[0], { id: 'malo' }] });
  assert.equal(dup.templates.length, 1);
  assert.deepEqual(sanitizeProfile({}), { templates: [] });
  assert.equal(sanitizeProfile('x'), null);
});

test('plantillas: guardar un día, listarlo y aplicarlo a otro', async () => {
  const { state, calls } = setup();
  seedMonday(state);
  const saved = state.saveTemplate('  Día de estudio  ', KEY.mon);
  assert.equal(saved.ok, true);
  assert.equal(state.listTemplates().length, 1);
  assert.equal(state.listTemplates()[0].name, 'Día de estudio');
  assert.ok(state.listTemplates()[0].blocks.every(b => !('n' in b) && !('d' in b) && !('id' in b)));

  const preset = state.availablePresets(KEY.thu).find(p => p.id === saved.template.id);
  assert.ok(preset && preset.custom && preset.quick && preset.count === 3 && preset.from === '07:00' && preset.to === '16:00');
  assert.equal(preset.used, false);

  const applied = state.applyPreset(KEY.thu, saved.template.id);
  assert.deepEqual([applied.ok, applied.added], [true, 3]);
  assert.ok(state.getDay(KEY.thu).every(b => b.p === saved.template.id && b.d === false && b.n === ''));
  assert.equal(state.availablePresets(KEY.thu).find(p => p.id === saved.template.id).used, true);
  await flush();
  assert.equal(calls.profile.length, 1);
  assert.equal(calls.profile[0].templates[0].name, 'Día de estudio');
});

test('plantillas: validaciones de nombre, día vacío, duplicados y máximo', () => {
  const { state } = setup();
  assert.match(state.saveTemplate('x', KEY.mon).error, /vacío|no tiene/);
  seedMonday(state);
  assert.match(state.saveTemplate('   ', KEY.mon).error, /nombre/);
  assert.equal(state.saveTemplate('Uno', KEY.mon).ok, true);
  assert.match(state.saveTemplate('UNO', KEY.mon).error, /ya tienes/i);
  for (let i = 1; i < LIMITS.templates; i++) assert.equal(state.saveTemplate(`P${i}`, KEY.mon).ok, true);
  assert.match(state.saveTemplate('Una más', KEY.mon).error, /Máximo/);
  assert.equal(state.listTemplates().length, LIMITS.templates);
});

test('plantillas: el nombre se recorta y las plantillas son inmutables', () => {
  const { state } = setup();
  seedMonday(state);
  const { template } = state.saveTemplate('N'.repeat(100), KEY.mon);
  assert.equal(template.name.length, LIMITS.templateName);
  assert.throws(() => { 'use strict'; state.listTemplates().push({}); }, TypeError);
  assert.throws(() => { 'use strict'; state.listTemplates()[0].name = 'x'; }, TypeError);
});

test('plantillas: eliminar y deshacer', () => {
  const { state } = setup();
  seedMonday(state);
  const { template } = state.saveTemplate('Uno', KEY.mon);
  const removed = state.deleteTemplate(template.id);
  assert.equal(removed.ok, true);
  assert.equal(state.listTemplates().length, 0);
  assert.equal(state.applyPreset(KEY.thu, template.id).ok, false, 'ya no se puede aplicar');
  assert.equal(state.deleteTemplate(template.id).ok, false);
  assert.equal(state.restoreTemplate(removed.removed).ok, true);
  assert.equal(state.restoreTemplate(removed.removed).ok, false, 'no se duplica');
  assert.equal(state.listTemplates().length, 1);
});

test('plantillas: aplicar sobre un día ocupado omite los solapes y avisa si no cabe nada', () => {
  const { state } = setup();
  seedMonday(state);
  const { template } = state.saveTemplate('Uno', KEY.mon);
  state.addBlock(KEY.thu, draft('Ocupado', 530, 700));
  const applied = state.applyPreset(KEY.thu, template.id);
  assert.equal(applied.added, 2);
  assert.deepEqual(applied.skipped, ['Estudio']);
  assert.equal(state.applyPreset(KEY.thu, template.id).ok, false);
});

test('plantillas: los títulos con HTML se guardan como texto (el escapado es de la vista)', () => {
  const { state } = setup();
  state.addBlock(KEY.mon, draft('<b>x</b>', 60, 120));
  assert.equal(state.saveTemplate('<i>p</i>', KEY.mon).ok, true);
  assert.equal(state.listTemplates()[0].name, '<i>p</i>');
});

/* ───────── Perfil: sincronización ───────── */

test('perfil: un cambio sin confirmar queda pendiente y no lo pisa la nube', async () => {
  const { state, storage } = setup({ pushResult: false });
  seedMonday(state);
  state.saveTemplate('Local', KEY.mon);
  await flush();
  assert.equal(storage.read('meta:profile-dirty'), '1');
  const changed = state.applyRemoteProfile({ templates: [{ id: 'tnube', name: 'Nube', blocks: [{ s: 1, e: 2, t: 'x' }] }] });
  assert.equal(changed, false);
  assert.equal(state.listTemplates()[0].name, 'Local');
});

test('perfil: se confirma al subir y entonces acepta cambios remotos', async () => {
  const { state, storage } = setup();
  seedMonday(state);
  state.saveTemplate('Local', KEY.mon);
  await flush();
  assert.equal(storage.read('meta:profile-dirty'), null);
  const events = [];
  state.subscribe(c => events.push(c));
  const changed = state.applyRemoteProfile({ templates: [{ id: 'tnube', name: 'Nube', blocks: [{ s: 1, e: 2, t: 'x' }] }] });
  assert.equal(changed, true);
  assert.deepEqual(state.listTemplates().map(t => t.name), ['Nube']);
  assert.deepEqual(events.map(e => [e.type, e.origin]), [['profile', 'remote']]);
  assert.equal(state.applyRemoteProfile({ templates: [{ id: 'tnube', name: 'Nube', blocks: [{ s: 1, e: 2, t: 'x' }] }] }), false, 'sin cambios reales');
});

test('perfil: un perfil remoto ilegible o ausente nunca borra las plantillas locales', () => {
  const { state } = setup();
  seedMonday(state);
  state.saveTemplate('Local', KEY.mon);
  assert.equal(state.applyRemoteProfile(null), false);
  assert.equal(state.applyRemoteProfile(undefined), false);
  assert.equal(state.applyRemoteProfile('basura'), false);
  assert.equal(state.listTemplates().length, 1);
});

test('perfil: reconcileProfile sube lo que solo existe aquí y lo pendiente', async () => {
  const first = setup({ pushResult: false });
  seedMonday(first.state);
  first.state.saveTemplate('Local', KEY.mon);
  await flush();
  const { storage } = first;

  const second = setup({ initial: Object.fromEntries(storage.keys().map(k => [k, storage.read(k)])) });
  second.state.reconcileProfile(true); // pendiente → sube aunque exista en la nube
  await flush();
  assert.equal(second.calls.profile.length, 1);

  const third = setup();
  seedMonday(third.state);
  third.state.saveTemplate('A', KEY.mon);
  await flush();
  const before = third.calls.profile.length;
  third.state.reconcileProfile(true);
  assert.equal(third.calls.profile.length, before, 'ya sincronizado y existe en la nube: nada que subir');
  third.state.reconcileProfile(false);
  assert.equal(third.calls.profile.length, before + 1, 'la nube no lo tiene: se sube');
});

test('perfil: sin pushProfile en el servicio de sync, editar sigue funcionando', () => {
  const state = createStateManager({
    storage: createMemoryStorage(),
    sync: { push: () => Promise.resolve(true), remove: () => Promise.resolve(true) },
    clock: () => TODAY
  });
  state.addBlock(KEY.mon, draft('A', 60, 120));
  assert.equal(state.saveTemplate('P', KEY.mon).ok, true);
});

test('perfil: clearLocalData borra las plantillas de este dispositivo', () => {
  const { state, storage } = setup();
  seedMonday(state);
  state.saveTemplate('Uno', KEY.mon);
  state.clearLocalData();
  assert.equal(state.listTemplates().length, 0);
  assert.equal(storage.read('meta:profile'), null);
  assert.equal(storage.read('meta:profile-dirty'), null);
});

test('perfil: las plantillas persisten entre sesiones', () => {
  const a = setup();
  seedMonday(a.state);
  a.state.saveTemplate('Uno', KEY.mon);
  const b = createStateManager({ storage: a.storage, clock: () => TODAY });
  assert.deepEqual(b.listTemplates().map(t => t.name), ['Uno']);
});

/* ───────── Copia de seguridad con plantillas ───────── */

test('copia de seguridad: incluye las plantillas y las fusiona al importar', () => {
  const a = setup();
  seedMonday(a.state);
  a.state.saveTemplate('Uno', KEY.mon);
  const text = JSON.stringify(a.state.exportBackup());
  assert.equal(parseBackup(text).profile.templates.length, 1);

  const b = setup();
  seedMonday(b.state);
  b.state.saveTemplate('Otra', KEY.mon);
  const result = b.state.importBackup(text);
  assert.equal(result.templates, 1);
  assert.deepEqual(b.state.listTemplates().map(t => t.name).sort(), ['Otra', 'Uno']);
});

test('copia de seguridad: una copia solo con plantillas es válida; un perfil corrupto se ignora', () => {
  const profile = JSON.stringify({ templates: [{ id: 'tabc', name: 'P', blocks: [{ s: 1, e: 2, t: 'x' }] }] });
  assert.equal(parseBackup(JSON.stringify({ app: 'mi-horario', data: { 'meta:profile': profile } })).profile.templates.length, 1);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'mi-horario', data: { 'meta:profile': '{no' } })), /datos válidos/);
});

test('mergeTemplates: las entrantes sustituyen por id y se respeta el máximo', () => {
  const t = (id, name) => ({ id, name, blocks: [{ s: 1, e: 2, t: 'x', c: 'libre' }] });
  const merged = mergeTemplates([t('ta', 'viejo'), t('tb', 'b')], [t('ta', 'nuevo')]);
  assert.deepEqual(merged.map(x => x.name), ['nuevo', 'b']);
  const lots = Array.from({ length: 25 }, (_, i) => t(`t${i}`, `n${i}`));
  assert.equal(mergeTemplates(lots.slice(0, 15), lots.slice(10)).length, LIMITS.templates);
});
