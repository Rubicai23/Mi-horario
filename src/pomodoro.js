/**
 * pomodoro.js — Temporizador Pomodoro (sin DOM): trabajo → descanso corto, y cada N rondas un descanso largo.
 *
 * El tiempo se calcula con la hora de fin (`endAt`), no restando segundos: sigue siendo exacto aunque el
 * navegador congele la pestaña. El estado se guarda con `save` y se recupera con `load` (texto JSON).
 */
export const POMODORO_OPTIONS = Object.freeze({
  focus: Object.freeze([15, 20, 25, 30, 45, 50]),
  short: Object.freeze([3, 5, 10]),
  long: Object.freeze([10, 15, 20, 30]),
  rounds: Object.freeze([2, 3, 4, 5, 6])
});
export const POMODORO_DEFAULTS = Object.freeze({ focus: 25, short: 5, long: 15, rounds: 4 });
const PHASES = new Set(['focus', 'short', 'long']);

/** Ajustes válidos: cualquier valor que no esté entre las opciones vuelve al de fábrica. */
export function sanitizePomodoroConfig(raw) {
  const object = raw && typeof raw === 'object' ? raw : {};
  const pick = key => (POMODORO_OPTIONS[key].includes(Number(object[key])) ? Number(object[key]) : POMODORO_DEFAULTS[key]);
  return { focus: pick('focus'), short: pick('short'), long: pick('long'), rounds: pick('rounds') };
}

/**
 * @param {object} deps
 * @param {() => string|null} [deps.load]   lee el estado guardado
 * @param {(text: string) => void} [deps.save]
 * @param {(ms: number) => string} deps.dayKey  fecha (AAAA-MM-DD) de un instante: los pomodoros de hoy se cuentan por día
 */
export function createPomodoro({ load = () => null, save = () => {}, dayKey }) {
  const minutes = (cfg, phase) => cfg[phase] * 60000;
  let state;

  const fresh = () => {
    const cfg = sanitizePomodoroConfig(null);
    return { cfg, phase: 'focus', round: 1, running: false, endAt: null, remainingMs: minutes(cfg, 'focus'), day: '', done: 0 };
  };
  const restore = () => {
    const base = fresh();
    let raw = null;
    try { raw = JSON.parse(load()); } catch (_) { raw = null; }
    if (!raw || typeof raw !== 'object') return base;
    const cfg = sanitizePomodoroConfig(raw.cfg);
    const phase = PHASES.has(raw.phase) ? raw.phase : 'focus';
    const total = minutes(cfg, phase);
    const remaining = Number.isFinite(raw.remainingMs) ? Math.min(total, Math.max(0, raw.remainingMs)) : total;
    const running = raw.running === true && Number.isFinite(raw.endAt);
    return {
      cfg, phase,
      round: Number.isInteger(raw.round) && raw.round >= 1 && raw.round <= cfg.rounds ? raw.round : 1,
      running, endAt: running ? raw.endAt : null, remainingMs: remaining,
      day: typeof raw.day === 'string' ? raw.day : '',
      done: Number.isInteger(raw.done) && raw.done >= 0 ? raw.done : 0
    };
  };
  state = restore();

  const persist = () => { try { save(JSON.stringify(state)); } catch (_) { /* sin almacenamiento */ } };
  const rollDay = nowMs => {
    const key = dayKey(nowMs);
    if (state.day !== key) { state.day = key; state.done = 0; }
  };
  const remainingAt = nowMs => (state.running ? Math.max(0, state.endAt - nowMs) : state.remainingMs);

  /** Pasa a la fase siguiente (parado, esperando que el usuario empiece). */
  const advance = (nowMs, countDone) => {
    const ended = state.phase;
    if (ended === 'focus') {
      if (countDone) { rollDay(nowMs); state.done += 1; }
      state.phase = state.round >= state.cfg.rounds ? 'long' : 'short';
    } else {
      state.phase = 'focus';
      state.round = ended === 'long' ? 1 : state.round + 1;
    }
    state.running = false;
    state.endAt = null;
    state.remainingMs = minutes(state.cfg, state.phase);
    persist();
    return { ended, next: state.phase };
  };

  return {
    view(nowMs) {
      rollDay(nowMs);
      return {
        phase: state.phase, running: state.running, round: state.round, rounds: state.cfg.rounds,
        remainingMs: remainingAt(nowMs), totalMs: minutes(state.cfg, state.phase),
        doneToday: state.done, config: { ...state.cfg }
      };
    },
    start(nowMs) {
      if (state.running) return;
      state.running = true;
      state.endAt = nowMs + state.remainingMs;
      persist();
    },
    pause(nowMs) {
      if (!state.running) return;
      state.remainingMs = remainingAt(nowMs);
      state.running = false;
      state.endAt = null;
      persist();
    },
    /** Vuelve al primer trabajo de la serie (no borra los pomodoros ya contados hoy). */
    reset() {
      Object.assign(state, { phase: 'focus', round: 1, running: false, endAt: null, remainingMs: minutes(state.cfg, 'focus') });
      persist();
    },
    /** Salta a la fase siguiente sin contar el pomodoro. */
    skip(nowMs) { return advance(nowMs, false); },
    /** Llamar cada segundo: devuelve { ended, next } cuando acaba una fase (y null el resto del tiempo). */
    tick(nowMs) {
      if (!state.running || nowMs < state.endAt) return null;
      return advance(nowMs, true);
    },
    /** `nowMs` hace falta si está en marcha: el tiempo que queda no puede pasar de la nueva duración. */
    setConfig(partial, nowMs = Date.now()) {
      const next = sanitizePomodoroConfig({ ...state.cfg, ...partial });
      const wasFull = !state.running && state.remainingMs === minutes(state.cfg, state.phase);
      const total = minutes(next, state.phase);
      state.cfg = next;
      if (state.round > next.rounds) state.round = 1;
      if (state.running) state.endAt = Math.min(state.endAt, nowMs + total);
      else state.remainingMs = wasFull ? total : Math.min(state.remainingMs, total);
      persist();
    }
  };
}

/** Reloj "mm:ss" (redondea hacia arriba: 0:00 solo cuando de verdad ha terminado). */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
