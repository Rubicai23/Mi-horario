import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage, createStateManager, sanitizeTags, summarizeTags, sanitizeProfile } from '../src/state-manager.js';
import { LIMITS } from '../src/config.js';

const NOW = new Date(2026, 9, 7, 12, 0, 0);
const setup = () => {
  const calls = [];
  const sync = { push: () => Promise.resolve(true), remove: () => Promise.resolve(true), pushProfile: p => { calls.push(JSON.parse(JSON.stringify(p))); return Promise.resolve(true); } };
  return { calls, state: createStateManager({ storage: createMemoryStorage(), sync, clock: () => NOW }) };
};
const draft = (g, t = 'Estudiar') => ({ t, c: 'estudio', s: 600, e: 660, g });

test('sanitizeTags: ids válidos, nombres únicos sin distinguir mayúsculas, con tope', () => {
  assert.deepEqual(sanitizeTags(undefined), []);
  const clean = sanitizeTags([{ id: 'g1', name: ' TFG ' }, { id: 'g2', name: 'tfg' }, { id: 'g1', name: 'Otra' }, { id: '<x>', name: 'Mala' }, { id: 'g3', name: '' }, null, 5]);
  assert.deepEqual(clean, [{ id: 'g1', name: 'TFG' }]);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, name: `N${i}` }));
  assert.equal(sanitizeTags(many).length, LIMITS.tags);
  assert.equal(sanitizeTags([{ id: 'g1', name: 'x'.repeat(100) }])[0].name.length, LIMITS.tagName);
});

test('addTag / renameTag / deleteTag / restoreTag', () => {
  const { state, calls } = setup();
  assert.equal(state.addTag('  ').ok, false);
  const a = state.addTag('TFG');
  assert.equal(a.ok, true);
  assert.equal(state.addTag('tfg').ok, false);
  assert.equal(state.tagName(a.tag.id), 'TFG');
  assert.equal(state.renameTag(a.tag.id, 'Tesis').ok, true);
  assert.equal(state.tagName(a.tag.id), 'Tesis');
  const b = state.addTag('Carnet');
  assert.equal(state.renameTag(b.tag.id, 'tesis').ok, false);
  assert.equal(state.renameTag('gNoExiste', 'X').ok, false);
  const del = state.deleteTag(a.tag.id);
  assert.equal(del.ok, true);
  assert.equal(state.tagName(a.tag.id), '');
  assert.equal(state.restoreTag(del.removed).ok, true);
  assert.equal(state.restoreTag(del.removed).ok, false);
  state.deleteTag(a.tag.id); state.deleteTag(b.tag.id);
  assert.equal('tags' in calls[calls.length - 1], false);
});

test('límite de etiquetas', () => {
  const { state } = setup();
  for (let i = 0; i < LIMITS.tags; i++) assert.equal(state.addTag(`T${i}`).ok, true);
  assert.equal(state.addTag('Una más').ok, false);
});

test('la etiqueta viaja en actividades y en reglas recurrentes', () => {
  const { state } = setup();
  const g = state.addTag('TFG').tag.id;
  const r = state.addBlock('2026-10-07', draft(g));
  assert.equal(r.block.g, g);
  assert.equal(state.updateBlock('2026-10-07', r.block.id, { g: undefined }).ok, true);
  assert.equal(state.getDay('2026-10-07')[0].g, undefined);
});

test('summarizeTags: ignora sin etiqueta y etiquetas borradas', () => {
  const tags = [{ id: 'g1', name: 'A' }];
  const s = summarizeTags([[{ g: 'g1', s: 0, e: 60, d: true }, { g: 'g1', s: 60, e: 90, d: false }, { g: 'g9', s: 0, e: 10 }, { s: 0, e: 10 }]], tags);
  assert.deepEqual(s, { g1: { planned: 90, done: 60 } });
});

test('sanitizeProfile conserva etiquetas válidas', () => {
  const p = sanitizeProfile({ templates: [], recurring: [], tags: [{ id: 'g1', name: 'A' }, { id: '!', name: 'B' }] });
  assert.deepEqual(p.tags, [{ id: 'g1', name: 'A' }]);
});

test('copia de seguridad: las etiquetas viajan y se unen al importar', () => {
  const a = setup();
  const t = a.state.addTag('TFG').tag;
  a.state.addBlock('2026-10-07', draft(t.id));
  const text = JSON.stringify(a.state.exportBackup ? a.state.exportBackup() : {});
  const b = setup();
  b.state.addTag('Carnet');
  b.state.importBackup(text);
  assert.deepEqual(b.state.getTags().map(x => x.name).sort(), ['Carnet', 'TFG']);
  assert.equal(b.state.getDay('2026-10-07')[0].g, t.id);
});
