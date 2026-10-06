import test from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeStats, computeStreaks, createMemoryStorage, createStateManager, dayProgress, earnedBadges, isDefaultStreak,
  normalizeStreakConfig, parseBackup, profileHasData, requiredFor, sanitizeProfile, weekStrip
} from '../src/state-manager.js';
import { BADGES, LIMITS, STORAGE } from '../src/config.js';

/* Hoy = miércoles 7 de octubre de 2026, 12:00 */
const NOW = new Date(2026, 9, 7, 12, 0, 0);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const day = (total, done) => Array.from({ length: total }, (_, i) => ({
  id: `b${i}`, s: 480 + i * 10, e: 485 + i * 10, t: `T${i}`, c: 'estudio', n: '', d: i < done
}));
const seed = days => Object.fromEntries(Object.entries(days).map(([k, v]) => [`day:${k}`, JSON.stringify(v)]));
const setup = (days = {}, extra = {}) => {
  const storage = createMemoryStorage({ ...seed(days), ...extra });
  const calls = { profile: [] };
  const sync = {
    push: () => Promise.resolve(true),
    remove: () => Promise.resolve(true),
    pushProfile: profile => { calls.profile.push(JSON.parse(JSON.stringify(profile))); return Promise.resolve(true); }
  };
  const state = createStateManager({ storage, sync, clock: () => NOW });
  return { storage, calls, state };
};
const streaks = (days, opts = {}) => computeStreaks({
  blocksAt: k => days[k] || [], today: NOW, earliestKey: Object.keys(days).sort()[0] || null, ...opts
});

/* ───────── Configuración y meta ───────── */

test('normalizeStreakConfig: valores raros vuelven a los de fábrica', () => {
  assert.deepEqual(normalizeStreakConfig(undefined), { goal: 80, days: [0, 1, 2, 3, 4, 5, 6] });
  assert.deepEqual(normalizeStreakConfig({ goal: 75, days: [] }), { goal: 80, days: [0, 1, 2, 3, 4, 5, 6] });
  assert.deepEqual(normalizeStreakConfig({ goal: '60', days: [5, 1, 1, 9, 'x'] }), { goal: 60, days: [1, 5] });
  assert.equal(isDefaultStreak(normalizeStreakConfig({})), true);
  assert.equal(isDefaultStreak(normalizeStreakConfig({ goal: 90 })), false);
});

test('dayProgress: la meta cambia el umbral y por defecto sigue siendo 80 %', () => {
  assert.equal(dayProgress(day(4, 2), 50).met, true);
  assert.equal(dayProgress(day(4, 2)).met, false);
  assert.equal(dayProgress(day(5, 4), 100).met, false);
  assert.equal(dayProgress(day(5, 5), 100).met, true);
  assert.equal(requiredFor(5, 60), 3);
  assert.equal(dayProgress(day(3, 3), 100).remaining, 0);
});

test('racha: con una meta del 50 % basta con la mitad', () => {
  const days = { '2026-10-06': day(4, 2), '2026-10-07': day(4, 2) };
  assert.equal(streaks(days).current, 0);
  assert.equal(streaks(days, { config: { goal: 50, days: [0, 1, 2, 3, 4, 5, 6] } }).current, 2);
});

/* ───────── Días que cuentan y descanso ───────── */

const weekdaysOnly = { goal: 80, days: [1, 2, 3, 4, 5] };

test('racha: un fin de semana desactivado no cuenta como hueco', () => {
  // vie 2 cumplido · sáb 3, dom 4 y lun 5 vacíos · mar 6 y mié 7 cumplidos
  const days = { '2026-10-02': day(2, 2), '2026-10-06': day(2, 2), '2026-10-07': day(2, 2) };
  assert.equal(streaks(days).current, 2, 'por defecto 3 huecos rompen la racha');
  assert.equal(streaks(days, { config: weekdaysOnly }).current, 3, 'sin sábado ni domingo solo hay 1 hueco');
});

test('racha: un día desactivado incumplido no la rompe ni suma', () => {
  const days = { '2026-10-02': day(2, 2), '2026-10-03': day(4, 0), '2026-10-05': day(2, 2) };
  assert.equal(streaks(days).current, 1);
  const r = streaks(days, { config: weekdaysOnly });
  assert.equal(r.current, 2);
  assert.equal(r.best, 2);
});

test('racha: un día de descanso se salta (ni suma, ni rompe, ni es hueco)', () => {
  const days = { '2026-10-05': day(2, 2), '2026-10-06': day(2, 0), '2026-10-07': day(2, 2) };
  assert.equal(streaks(days).current, 1);
  assert.equal(streaks(days, { rest: new Set(['2026-10-06']) }).current, 2);
  const empties = { '2026-10-02': day(2, 2), '2026-10-07': day(2, 2) };
  assert.equal(streaks(empties).current, 1, 'sábado, domingo, lunes y martes vacíos rompen');
  assert.equal(streaks(empties, { rest: new Set(['2026-10-05', '2026-10-06']) }).current, 2);
});

test('weekStrip: marca descanso y días que no cuentan', () => {
  const strip = weekStrip({
    blocksAt: k => ({ '2026-10-05': day(2, 2) }[k] || []), today: NOW,
    config: { goal: 80, days: [1, 2, 3, 4, 5] }, rest: new Set(['2026-10-06', '2026-10-09'])
  });
  assert.deepEqual(strip.map(d => d.status), ['met', 'restday', 'rest', 'future', 'restday', 'off', 'off']);
});

test('descanso: solo hoy y futuro; se puede deshacer y se guarda en el perfil', async () => {
  const { state, calls, storage } = setup({ '2026-10-06': day(2, 0), '2026-10-07': day(2, 2) });
  assert.equal(state.setRestDay('2026-10-06', true).ok, false, 'ayer no');
  assert.equal(state.setRestDay('2026-10-07', true).ok, true);
  assert.equal(state.streakView(NOW).restToday, true);
  assert.deepEqual(state.listRestDays(), ['2026-10-07']);
  assert.equal(state.setRestDay('2026-10-07', true).changed, false);
  const future = state.setRestDay('2026-10-10', true);
  assert.deepEqual(state.listRestDays(), ['2026-10-07', '2026-10-10']);
  future.undo();
  assert.deepEqual(state.listRestDays(), ['2026-10-07']);
  assert.equal(state.setRestDay('2028-01-01', true).ok, false, 'demasiado lejos');
  await flush();
  assert.deepEqual(calls.profile.at(-1).rest, ['2026-10-07']);
  assert.deepEqual(JSON.parse(storage.read(STORAGE.profile)).rest, ['2026-10-07']);
  state.setRestDay('2026-10-07', false);
  assert.deepEqual(state.listRestDays(), []);
  assert.equal('rest' in JSON.parse(storage.read(STORAGE.profile)), false, 'sin días no deja rastro');
});

test('descanso: hoy en descanso no rompe la racha aunque no se complete nada', () => {
  const { state } = setup({ '2026-10-05': day(2, 2), '2026-10-06': day(2, 2), '2026-10-07': day(2, 0) });
  assert.equal(state.streakView(NOW).current, 2);
  state.setRestDay('2026-10-07', true);
  const view = state.streakView(NOW);
  assert.equal(view.current, 2);
  assert.equal(view.week.find(d => d.isToday).status, 'restday');
});

test('ajustes de racha: se guardan, se sincronizan y cambian el resultado', async () => {
  const { state, calls, storage } = setup({ '2026-10-06': day(4, 2), '2026-10-07': day(4, 2) });
  assert.equal(state.streakView(NOW).current, 0);
  assert.equal(state.setStreakConfig({ goal: 50, days: [0, 1, 2, 3, 4, 5, 6] }).changed, true);
  const view = state.streakView(NOW);
  assert.equal(view.current, 2);
  assert.equal(view.goal, 50);
  assert.equal(view.today.met, true);
  await flush();
  assert.deepEqual(calls.profile.at(-1).streak, { goal: 50, days: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(state.setStreakConfig({ goal: 50 }).changed, false);
  // toggleDone usa la meta elegida
  const r = state.toggleDone('2026-10-06', 'b2');
  assert.equal(r.after.met, true);
  assert.equal(r.before.met, true);
  // volver a los valores de fábrica no deja rastro
  state.setStreakConfig({});
  assert.equal('streak' in JSON.parse(storage.read(STORAGE.profile)), false);
  assert.equal(state.getStreakConfig().goal, 80);
});

test('ajustes de racha: el día de hoy desactivado se indica', () => {
  const { state } = setup({ '2026-10-07': day(2, 0) });
  state.setStreakConfig({ goal: 80, days: [1, 2] });
  assert.equal(state.streakView(NOW).countsToday, false);
});

/* ───────── Perfil ───────── */

test('sanitizeProfile: descarta lo inválido y omite los valores por defecto', () => {
  assert.deepEqual(sanitizeProfile({}), { templates: [], recurring: [] });
  const p = sanitizeProfile({
    templates: [], rest: ['2026-10-09', 'mal', '2026-10-09', 7], streak: { goal: 90, days: [1, 2] },
    badges: { 'racha-3': '2026-10-01', inventada: '2026-10-01', 'racha-7': 'mal' }
  });
  assert.deepEqual(p.rest, ['2026-10-09']);
  assert.deepEqual(p.streak, { goal: 90, days: [1, 2] });
  assert.deepEqual(p.badges, { 'racha-3': '2026-10-01' });
  assert.equal(sanitizeProfile({ templates: [], rest: 'x', streak: 5, badges: [1] }).rest, undefined);
  assert.equal(sanitizeProfile({ rest: Array.from({ length: 900 }, (_, i) => `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`) }).rest.length <= LIMITS.restDays, true);
  assert.equal(profileHasData({ templates: [], recurring: [] }), false);
  assert.equal(profileHasData({ templates: [], recurring: [], streak: { goal: 50, days: [1] } }), true);
});

test('perfil remoto: un documento antiguo sin los campos nuevos no borra lo local', () => {
  const { state } = setup({}, { [STORAGE.profile]: JSON.stringify({ templates: [], recurring: [], rest: ['2026-10-09'], streak: { goal: 60, days: [1, 2, 3] } }) });
  state.applyRemoteProfile({ templates: [], recurring: [] });
  assert.deepEqual(state.listRestDays(), ['2026-10-09']);
  assert.equal(state.getStreakConfig().goal, 60);
  assert.equal(state.applyRemoteProfile({ templates: [], recurring: [], rest: [], streak: { goal: 80, days: [0, 1, 2, 3, 4, 5, 6] } }), true);
  assert.deepEqual(state.listRestDays(), []);
  assert.equal(state.getStreakConfig().goal, 80);
});

test('perfil remoto: las insignias se unen, nunca se pierden', async () => {
  const { state, calls } = setup({}, { [STORAGE.profile]: JSON.stringify({ templates: [], recurring: [], badges: { 'racha-3': '2026-10-05' } }) });
  state.applyRemoteProfile({ templates: [], recurring: [], badges: { 'dias-10': '2026-10-01' } });
  await flush();
  const mine = state.listBadges(NOW).filter(b => b.earnedOn).map(b => b.id).sort();
  assert.deepEqual(mine, ['dias-10', 'racha-3']);
  assert.deepEqual(Object.keys(calls.profile.at(-1).badges).sort(), ['dias-10', 'racha-3'], 'se sube lo que faltaba en la nube');
});

test('copia de seguridad: guarda y fusiona descansos, ajustes e insignias', () => {
  const a = setup({ '2026-10-07': day(1, 1) });
  a.state.setRestDay('2026-10-09', true);
  a.state.setStreakConfig({ goal: 70, days: [1, 2, 3] });
  a.state.checkBadges(NOW);
  const text = JSON.stringify(a.state.exportBackup());
  const parsed = parseBackup(text);
  assert.deepEqual(parsed.profile.rest, ['2026-10-09']);
  assert.equal(parsed.profile.streak.goal, 70);
  assert.ok(parsed.profile.badges['primer-paso']);
  const b = setup();
  b.state.setRestDay('2026-10-12', true);
  b.state.importBackup(text);
  assert.deepEqual(b.state.listRestDays(), ['2026-10-09', '2026-10-12']);
  assert.equal(b.state.getStreakConfig().goal, 70);
  assert.ok(b.state.listBadges(NOW).find(x => x.id === 'primer-paso').earnedOn);
});

/* ───────── Insignias ───────── */

test('insignias: cada una tiene id único y requisito', () => {
  assert.equal(new Set(BADGES.map(b => b.id)).size, BADGES.length);
  BADGES.forEach(b => assert.ok(b.title && b.desc && b.target > 0 && ['done', 'streak', 'days', 'week'].includes(b.kind)));
  assert.ok(BADGES.length <= LIMITS.badges);
});

test('insignias: se consiguen una sola vez y guardan la fecha', async () => {
  const { state, calls } = setup({ '2026-10-07': day(3, 1) });
  const first = state.checkBadges(NOW);
  assert.deepEqual(first.map(b => b.id), ['primer-paso']);
  assert.deepEqual(state.checkBadges(NOW), [], 'no se repite');
  const list = state.listBadges(NOW);
  assert.equal(list.find(b => b.id === 'primer-paso').earnedOn, '2026-10-07');
  assert.equal(list.find(b => b.id === 'en-marcha').earnedOn, null);
  assert.equal(list.find(b => b.id === 'en-marcha').value, 1);
  await flush();
  assert.deepEqual(calls.profile.at(-1).badges, { 'primer-paso': '2026-10-07' });
});

test('insignias: una insignia ganada no se pierde al borrar actividades', () => {
  const { state } = setup({ '2026-10-07': day(1, 1) });
  state.checkBadges(NOW);
  state.clearDay('2026-10-07');
  assert.equal(state.listBadges(NOW).find(b => b.id === 'primer-paso').earnedOn, '2026-10-07');
});

test('insignias: racha y días cumplidos', () => {
  const days = {};
  ['2026-10-05', '2026-10-06', '2026-10-07'].forEach(k => { days[k] = day(2, 2); });
  const { state } = setup(days);
  const ids = state.checkBadges(NOW).map(b => b.id).sort();
  assert.deepEqual(ids, ['primer-paso', 'racha-3']);
  const stats = badgeStats({ blocksAt: k => days[k] || [], keys: Object.keys(days), today: NOW });
  assert.deepEqual(stats, { done: 6, daysMet: 3, perfectWeeks: 0, best: 3 });
  assert.equal(earnedBadges(stats).length, 2);
});

test('insignias: semana perfecta solo con semanas terminadas y al menos 3 días', () => {
  const lastWeek = {};
  ['2026-09-28', '2026-09-29', '2026-09-30'].forEach(k => { lastWeek[k] = day(2, 2); });
  const stats = k => badgeStats({ blocksAt: x => k[x] || [], keys: Object.keys(k), today: NOW });
  assert.equal(stats(lastWeek).perfectWeeks, 1);
  assert.equal(stats({ ...lastWeek, '2026-10-01': day(2, 0) }).perfectWeeks, 0, 'un día incumplido la estropea');
  assert.equal(stats({ '2026-09-28': day(2, 2), '2026-09-29': day(2, 2) }).perfectWeeks, 0, 'con 2 días no basta');
  assert.equal(stats({ '2026-10-05': day(2, 2), '2026-10-06': day(2, 2), '2026-10-07': day(2, 2) }).perfectWeeks, 0, 'la semana actual no ha terminado');
  const rested = { ...lastWeek, '2026-10-01': day(2, 0) };
  const withRest = badgeStats({ blocksAt: x => rested[x] || [], keys: Object.keys(rested), today: NOW, rest: new Set(['2026-10-01']) });
  assert.equal(withRest.perfectWeeks, 1, 'un día de descanso no estropea la semana');
});
