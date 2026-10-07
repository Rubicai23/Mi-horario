import test from 'node:test';
import assert from 'node:assert/strict';
import { POMODORO_DEFAULTS, createPomodoro, sanitizePomodoroConfig } from '../src/pomodoro.js';

const MIN = 60000;
const dayKey = ms => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.UTC(2026, 9, 7, 10, 0, 0);
const make = (saved = null) => {
  const store = { text: saved };
  const timer = createPomodoro({ load: () => store.text, save: text => { store.text = text; }, dayKey });
  return { timer, store };
};

test('ajustes: solo valores permitidos', () => {
  assert.deepEqual(sanitizePomodoroConfig(null), POMODORO_DEFAULTS);
  assert.deepEqual(sanitizePomodoroConfig({ focus: 50, short: 7, long: '20', rounds: 99 }), { focus: 50, short: 5, long: 20, rounds: 4 });
});

test('empieza parado en la primera ronda de trabajo (25 min)', () => {
  const { timer } = make();
  const v = timer.view(T0);
  assert.deepEqual([v.phase, v.running, v.round, v.remainingMs, v.doneToday], ['focus', false, 1, 25 * MIN, 0]);
});

test('empezar, pausar y reanudar conservan el tiempo restante', () => {
  const { timer } = make();
  timer.start(T0);
  assert.equal(timer.view(T0 + 5 * MIN).remainingMs, 20 * MIN);
  timer.pause(T0 + 5 * MIN);
  assert.equal(timer.view(T0 + 60 * MIN).remainingMs, 20 * MIN, 'en pausa no avanza');
  timer.start(T0 + 60 * MIN);
  assert.equal(timer.tick(T0 + 79 * MIN), null);
  assert.deepEqual(timer.tick(T0 + 80 * MIN), { ended: 'focus', next: 'short' });
});

test('ciclo completo: 4 trabajos con descansos cortos y uno largo', () => {
  const { timer } = make();
  let now = T0;
  const seq = [];
  for (let i = 0; i < 8; i++) {
    timer.start(now);
    now += timer.view(now).remainingMs;
    const r = timer.tick(now);
    seq.push(`${r.ended}>${r.next}`);
  }
  assert.deepEqual(seq, ['focus>short', 'short>focus', 'focus>short', 'short>focus', 'focus>short', 'short>focus', 'focus>long', 'long>focus']);
  const v = timer.view(now);
  assert.deepEqual([v.phase, v.round, v.doneToday], ['focus', 1, 4]);
});

test('al acabar una fase se queda esperando (no sigue sola) y avisa una sola vez', () => {
  const { timer } = make();
  timer.start(T0);
  assert.ok(timer.tick(T0 + 25 * MIN));
  assert.equal(timer.tick(T0 + 26 * MIN), null);
  const v = timer.view(T0 + 26 * MIN);
  assert.deepEqual([v.phase, v.running, v.remainingMs], ['short', false, 5 * MIN]);
});

test('saltar no cuenta el pomodoro; reiniciar vuelve al principio pero conserva lo de hoy', () => {
  const { timer } = make();
  timer.skip(T0);
  assert.deepEqual([timer.view(T0).phase, timer.view(T0).doneToday], ['short', 0]);
  timer.start(T0); timer.tick(T0 + 5 * MIN);
  timer.start(T0 + 5 * MIN); timer.tick(T0 + 30 * MIN);
  assert.equal(timer.view(T0 + 30 * MIN).doneToday, 1);
  timer.reset();
  const v = timer.view(T0 + 30 * MIN);
  assert.deepEqual([v.phase, v.round, v.running, v.remainingMs, v.doneToday], ['focus', 1, false, 25 * MIN, 1]);
});

test('los pomodoros de hoy se reinician al cambiar de día', () => {
  const { timer } = make();
  timer.start(T0); timer.tick(T0 + 25 * MIN);
  assert.equal(timer.view(T0 + 26 * MIN).doneToday, 1);
  assert.equal(timer.view(T0 + 24 * 60 * MIN).doneToday, 0);
});

test('cambiar los ajustes: se aplican si está sin empezar y no pasan del tiempo que queda', () => {
  const { timer } = make();
  timer.setConfig({ focus: 50 });
  assert.equal(timer.view(T0).remainingMs, 50 * MIN);
  timer.start(T0);
  timer.setConfig({ focus: 15 }, T0);
  assert.equal(timer.view(T0).remainingMs, 15 * MIN, 'no puede quedar más que la nueva duración');
  timer.setConfig({ rounds: 2 });
  assert.equal(timer.view(T0).rounds, 2);
  timer.setConfig({ focus: 999 });
  assert.equal(timer.view(T0).config.focus, 25, 'valor no permitido: el de fábrica');
});

test('el estado se guarda y se recupera, incluso en marcha tras cerrar la app', () => {
  const a = make();
  a.timer.start(T0);
  const b = make(a.store.text);
  const v = b.timer.view(T0 + 10 * MIN);
  assert.deepEqual([v.running, v.remainingMs], [true, 15 * MIN]);
  assert.deepEqual(b.timer.tick(T0 + 40 * MIN), { ended: 'focus', next: 'short' }, 'si se acabó mientras estaba cerrada, avisa al volver');
});

test('un estado guardado corrupto no rompe nada', () => {
  for (const bad of ['{', 'null', '[]', JSON.stringify({ phase: 'x', remainingMs: 'a', cfg: 5, running: true }), JSON.stringify({ running: true, endAt: 'mañana' })]) {
    const { timer } = make(bad);
    const v = timer.view(T0);
    assert.equal(v.running, false);
    assert.ok(v.remainingMs > 0);
    assert.ok(['focus', 'short', 'long'].includes(v.phase));
  }
});
