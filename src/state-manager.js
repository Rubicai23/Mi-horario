/**
 * state-manager.js — Estado de la aplicación y reglas de negocio.
 *
 * Sin DOM y sin Firebase: el almacenamiento y la sincronización se inyectan, por lo que todo
 * este módulo se puede probar con `node --test`.
 *
 * Modelo de una actividad:
 *   { id, s, e, t, c, n, d, p? }
 *   s/e = minutos desde medianoche · t = título · c = categoría · n = nota · d = hecha · p = plantilla de origen
 *
 * Los días son inmutables (arrays congelados): cada cambio crea un array nuevo.
 */
import {
  BACKUP, CATEGORIES, LIMITS, MAX_MIN, PRESETS, STORAGE, STREAK_RULES
} from './config.js';
import {
  addDays, diffDays, fromHHMM, isDateKey, parseDateKey, startOfDay, toDateKey, toHHMM, uid, weekDates
} from './utils.js';

const CATEGORY_KEYS = new Set(CATEGORIES.map(c => c.key));
const BLOCK_ID_RE = /^[\w-]{1,40}$/;
const PRESET_ID_RE = /^[a-z0-9-]{1,24}$/;
const TEMPLATE_ID_RE = /^t[a-z0-9]{1,20}$/;
const BACKUP_SETTING_KEYS = Object.freeze([`${STORAGE.settingPrefix}notify`]);

export const EMPTY_DAY = Object.freeze([]);
export const byStart = (a, b) => a.s - b.s || a.e - b.e;

/* ═══════════════ Validación y saneado ═══════════════ */

const clampMinute = n => Math.min(MAX_MIN, Math.max(0, Math.round(Number(n))));

/** Devuelve una actividad limpia o null si los datos no son aprovechables. */
export function sanitizeBlock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = clampMinute(raw.s);
  const e = clampMinute(raw.e);
  const t = typeof raw.t === 'string' ? raw.t.trim().slice(0, LIMITS.titleLength) : '';
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || !t) return null;
  const block = {
    id: typeof raw.id === 'string' && BLOCK_ID_RE.test(raw.id) ? raw.id : uid(),
    s, e, t,
    c: CATEGORY_KEYS.has(raw.c) ? raw.c : 'rutina',
    n: typeof raw.n === 'string' ? raw.n.slice(0, LIMITS.noteLength) : '',
    d: raw.d === true
  };
  if (typeof raw.p === 'string' && PRESET_ID_RE.test(raw.p)) block.p = raw.p;
  return block;
}

/** Array limpio y ordenado, o null si `raw` no es un array. */
export function sanitizeBlocks(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.slice(0, LIMITS.blocksPerDay).map(sanitizeBlock).filter(Boolean).sort(byStart);
}

/** Plantilla propia: { id, name, blocks:[{s,e,t,c}] } o null. No guarda notas ni estado de "hecha". */
export function sanitizeTemplate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, LIMITS.templateName) : '';
  if (!name || typeof raw.id !== 'string' || !TEMPLATE_ID_RE.test(raw.id) || !Array.isArray(raw.blocks)) return null;
  const blocks = raw.blocks.slice(0, LIMITS.blocksPerDay).map(sanitizeBlock).filter(Boolean)
    .sort(byStart).map(({ s, e, t, c }) => ({ s, e, t, c }));
  return blocks.length ? { id: raw.id, name, blocks } : null;
}

/** Perfil del usuario (se sincroniza como un único documento). null si no es un objeto. */
export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seen = new Set();
  const templates = (Array.isArray(raw.templates) ? raw.templates : [])
    .map(sanitizeTemplate)
    .filter(t => t && !seen.has(t.id) && seen.add(t.id))
    .slice(0, LIMITS.templates);
  return { templates };
}

/** Fusiona plantillas: las entrantes sustituyen a las que tienen el mismo id; se respeta el máximo. */
export function mergeTemplates(current, incoming) {
  const byId = new Map(current.map(t => [t.id, t]));
  incoming.forEach(t => byId.set(t.id, t));
  return Array.from(byId.values()).slice(0, LIMITS.templates);
}

/** Mensaje de error para el usuario, o null si el borrador es válido. */
export function validateDraft({ t, s, e }) {
  if (typeof t !== 'string' || !t.trim()) return 'Escribe un nombre para la actividad.';
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 'Elige la hora de inicio y de fin.';
  if (e <= s) return 'La hora de fin debe ser posterior al inicio.';
  return null;
}

const freezeDay = blocks => Object.freeze(blocks.map(b => Object.freeze({ ...b })));

/* ═══════════════ Progreso y rachas ═══════════════ */

/** Actividades que hay que completar para cumplir el objetivo del día (80 %, redondeo hacia arriba). */
export const requiredCount = total => Math.ceil((total * STREAK_RULES.goalNum) / STREAK_RULES.goalDen);

export function dayProgress(blocks) {
  const total = blocks.length;
  const done = blocks.reduce((n, b) => n + (b.d ? 1 : 0), 0);
  const required = requiredCount(total);
  return {
    total,
    done,
    required,
    remaining: Math.max(0, required - done),
    // Comparación entera (sin decimales): done/total >= goalNum/goalDen
    met: total > 0 && done * STREAK_RULES.goalDen >= total * STREAK_RULES.goalNum
  };
}

/**
 * Racha actual y mejor racha: días consecutivos en los que se cumplió el objetivo.
 *  - El día de hoy aún en curso no rompe la racha (suma cuando se cumple).
 *  - Un día pasado con actividades por debajo del objetivo la rompe.
 *  - Los días sin actividades no suman ni rompen, hasta `maxRestGap` seguidos (fin de semana libre).
 *    Un hueco mayor la rompe: evita conservar una racha abandonando la app.
 */
export function computeStreaks({ blocksAt, today, earliestKey }) {
  const first = earliestKey ? parseDateKey(earliestKey) : null;
  if (!first) return { current: 0, best: 0 };
  const span = Math.min(Math.max(diffDays(first, today), 0), STREAK_RULES.maxLookbackDays);
  let run = 0;
  let best = 0;
  let gap = 0;
  for (let offset = span; offset >= 0; offset--) {
    const isToday = offset === 0;
    const progress = dayProgress(blocksAt(toDateKey(addDays(today, -offset))));
    if (progress.total === 0) {
      gap += isToday ? 0 : 1;
      if (gap > STREAK_RULES.maxRestGap) run = 0;
      continue;
    }
    gap = 0;
    if (progress.met) {
      run += 1;
      best = Math.max(best, run);
    } else if (!isToday) {
      run = 0;
    }
  }
  return { current: run, best };
}

/** Estado de cada día de la semana actual (lunes → domingo) para dibujar la racha. */
export function weekStrip({ blocksAt, today }) {
  const todayKey = toDateKey(today);
  return weekDates(today).map(date => {
    const key = toDateKey(date);
    const progress = dayProgress(blocksAt(key));
    let status;
    if (key > todayKey) status = 'future';
    else if (progress.total === 0) status = 'rest';
    else if (progress.met) status = 'met';
    else status = key === todayKey ? 'pending' : 'missed';
    return { key, dow: date.getDay(), status, isToday: key === todayKey, done: progress.done, total: progress.total };
  });
}

/* ═══════════════ Consultas puras sobre un día ═══════════════ */

/** Qué está pasando ahora en un día: current | upcoming | finished | empty. */
export function describeDay(blocks, nowMin) {
  if (!blocks.length) return { kind: 'empty', index: -1 };
  const index = blocks.findIndex(b => nowMin >= b.s && nowMin < b.e);
  if (index >= 0) {
    const block = blocks[index];
    return { kind: 'current', block, next: blocks[index + 1] || null, progress: (nowMin - block.s) / (block.e - block.s), index };
  }
  const upcoming = blocks.find(b => b.s > nowMin);
  return upcoming ? { kind: 'upcoming', block: upcoming, index: -1 } : { kind: 'finished', index: -1 };
}

/** Minutos planificados y hechos por categoría. */
export function summarizeWeek(blocksPerDay) {
  return blocksPerDay.reduce((all, day) => all.concat(day), []).reduce((acc, b) => {
    const entry = acc[b.c] || (acc[b.c] = { planned: 0, done: 0 });
    entry.planned += b.e - b.s;
    if (b.d) entry.done += b.e - b.s;
    return acc;
  }, {});
}

/** Recoloca las actividades en el orden dado conservando la duración de cada una. */
export function reorderBlocks(blocks, orderedIds) {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const ordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
  if (ordered.length !== blocks.length || new Set(orderedIds).size !== blocks.length) return blocks;
  let cursor = Math.min(...blocks.map(b => b.s));
  return ordered.map(b => {
    const length = b.e - b.s;
    const moved = { ...b, s: Math.min(cursor, MAX_MIN - 5), e: Math.min(cursor + length, MAX_MIN) };
    cursor += length;
    return moved;
  });
}

/** Actividades que se solapan con el tramo [s, e), ignorando la de id `ignoreId`. */
export function findOverlaps(blocks, { s, e }, ignoreId = null) {
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return [];
  return blocks.filter(b => b.id !== ignoreId && s < b.e && e > b.s);
}

/** Coloca candidatas saltándose las que chocan con lo ya ocupado (o entre sí). `skipped` = títulos omitidos. */
export function placeBlocks(existing, candidates) {
  const occupied = existing.slice();
  const added = [];
  const skipped = [];
  candidates.forEach(block => {
    if (findOverlaps(occupied, block).length) { skipped.push(block.t); return; }
    added.push(block);
    occupied.push(block);
  });
  return { added, skipped };
}

/** Crea las actividades de una plantilla saltándose las que se solapan con las existentes. */
export function instantiatePreset(preset, dow, existing) {
  const rows = preset.rows(dow) || [];
  const candidates = rows
    .map(([from, to, t, c]) => sanitizeBlock({ id: uid(), s: fromHHMM(from), e: fromHHMM(to), t, c, n: '', d: false, p: preset.id }))
    .filter(Boolean);
  return placeBlocks(existing, candidates);
}

/** Próximos inicios de actividad (no hechas), ordenados por hora. Alimenta las notificaciones nativas. */
export function upcomingStarts({ blocksAt, from, horizonDays, limit }) {
  const out = [];
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(from, i);
    const key = toDateKey(date);
    blocksAt(key).forEach(block => {
      if (block.d) return;
      const at = startOfDay(date);
      at.setMinutes(block.s);
      if (at > from) out.push({ key, block, at });
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, limit);
}

/** Primer día posterior a `from` con actividades. */
export function findNextPlannedDay({ blocksAt, from, horizonDays = 7 }) {
  for (let i = 1; i <= horizonDays; i++) {
    const date = addDays(from, i);
    const blocks = blocksAt(toDateKey(date));
    if (blocks.length) return { date, first: blocks[0].s };
  }
  return null;
}

/** Detecta qué actividades acaban de empezar (una sola vez por actividad y día). */
export function createStartWatcher(windowMinutes = 2) {
  const seen = new Set();
  return {
    collect(dateKey, blocks, nowMin) {
      return blocks.filter(b => {
        const age = nowMin - b.s;
        const id = `${dateKey}:${b.id}`;
        if (age < 0 || age >= windowMinutes || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }
  };
}

/* ═══════════════ Copias de seguridad ═══════════════ */

/** Valida un archivo de copia. Lanza Error con un mensaje apto para el usuario. */
export function parseBackup(text) {
  let payload;
  try { payload = JSON.parse(text); } catch (_) { throw new Error('El archivo no es un JSON válido.'); }
  if (!payload || payload.app !== BACKUP.app || !payload.data || typeof payload.data !== 'object') {
    throw new Error('Este archivo no es una copia de Mi horario.');
  }
  const days = [];
  const settings = [];
  let profile = null;
  Object.keys(payload.data).forEach(storageKey => {
    const value = payload.data[storageKey];
    if (typeof value !== 'string') return;
    if (storageKey === STORAGE.profile) {
      try { profile = sanitizeProfile(JSON.parse(value)); } catch (_) { profile = null; }
    } else if (storageKey.startsWith(STORAGE.dayPrefix)) {
      const key = storageKey.slice(STORAGE.dayPrefix.length);
      let blocks = null;
      try { blocks = sanitizeBlocks(JSON.parse(value)); } catch (_) { blocks = null; }
      if (isDateKey(key) && blocks) days.push([key, blocks]);
    } else if (BACKUP_SETTING_KEYS.includes(storageKey) && (value === '0' || value === '1')) {
      settings.push([storageKey, value]);
    }
  });
  const hasProfile = Boolean(profile && profile.templates.length);
  if (!days.length && !settings.length && !hasProfile) throw new Error('La copia no contiene datos válidos.');
  return { days, settings, profile: hasProfile ? profile : null };
}

/* ═══════════════ Almacenamiento (adaptadores) ═══════════════ */

export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    read: key => (map.has(key) ? map.get(key) : null),
    write: (key, value) => { map.set(key, String(value)); },
    remove: key => { map.delete(key); },
    keys: () => Array.from(map.keys())
  };
}

/** localStorage con memoria como respaldo (modo privado, cuota llena o acceso bloqueado). */
export function createBrowserStorage() {
  const memory = createMemoryStorage();
  let ls = null;
  try {
    ls = globalThis.localStorage;
    ls.setItem('__probe', '1');
    ls.removeItem('__probe');
  } catch (_) { ls = null; }
  return {
    read(key) {
      if (ls) { try { return ls.getItem(key); } catch (_) { /* usa memoria */ } }
      return memory.read(key);
    },
    write(key, value) {
      memory.write(key, value);
      if (ls) { try { ls.setItem(key, String(value)); } catch (_) { /* cuota llena */ } }
    },
    remove(key) {
      memory.remove(key);
      if (ls) { try { ls.removeItem(key); } catch (_) { /* nada */ } }
    },
    keys() {
      const out = new Set(memory.keys());
      if (ls) { try { for (let i = 0; i < ls.length; i++) out.add(ls.key(i)); } catch (_) { /* nada */ } }
      return Array.from(out);
    }
  };
}

/* ═══════════════ Gestor de estado ═══════════════ */

const NO_SYNC = Object.freeze({
  push: () => Promise.resolve(false),
  remove: () => Promise.resolve(false),
  pushProfile: () => Promise.resolve(false)
});

/**
 * @param {object} deps
 * @param {{read, write, remove, keys}} deps.storage  adaptador de almacenamiento local
 * @param {{push(key, blocks): Promise<boolean>, remove(key): Promise<boolean>, pushProfile?(profile): Promise<boolean>}} [deps.sync]  subida a la nube
 * @param {() => Date} [deps.clock]
 */
export function createStateManager({ storage, sync = NO_SYNC, clock = () => new Date() }) {
  const cache = new Map();        // dateKey -> día congelado
  const versions = new Map();     // dateKey -> nº de cambio local (evita limpiar "pendiente" con una subida antigua)
  const listeners = new Set();

  const dayStorageKey = key => STORAGE.dayPrefix + key;
  const emit = change => { listeners.forEach(fn => fn(change)); };
  const assertDateKey = key => { if (!isDateKey(key)) throw new TypeError(`Fecha no válida: ${key}`); };

  /* ── Lectura ── */
  const parseStored = key => {
    const raw = storage.read(dayStorageKey(key));
    if (raw === null || raw === undefined) return null;
    try { return sanitizeBlocks(JSON.parse(raw)); } catch (_) { return null; }
  };
  const load = key => {
    let day = cache.get(key);
    if (!day) {
      const stored = parseStored(key);
      day = stored ? freezeDay(stored) : EMPTY_DAY;
      cache.set(key, day);
    }
    return day;
  };
  const storedKeys = () => storage.keys()
    .filter(k => k.startsWith(STORAGE.dayPrefix))
    .map(k => k.slice(STORAGE.dayPrefix.length))
    .filter(isDateKey);

  /* ── Cambios pendientes de confirmar en la nube: { 'YYYY-MM-DD': 'put' | 'del' } ── */
  const readDirty = () => {
    try {
      const raw = JSON.parse(storage.read(STORAGE.dirty));
      if (Array.isArray(raw)) return Object.fromEntries(raw.filter(isDateKey).map(k => [k, 'put'])); // formato antiguo
      if (raw && typeof raw === 'object') {
        return Object.fromEntries(Object.entries(raw).filter(([k, v]) => isDateKey(k) && (v === 'put' || v === 'del')));
      }
    } catch (_) { /* sin pendientes */ }
    return {};
  };
  const writeDirty = map => {
    if (Object.keys(map).length) storage.write(STORAGE.dirty, JSON.stringify(map));
    else storage.remove(STORAGE.dirty);
  };
  const setDirty = (key, kind) => { const map = readDirty(); map[key] = kind; writeDirty(map); };
  const clearDirty = key => { const map = readDirty(); if (key in map) { delete map[key]; writeDirty(map); } };

  /** Registra el cambio como pendiente y lo envía; solo se da por confirmado si no hubo cambios después. */
  const send = (key, kind) => {
    const version = (versions.get(key) || 0) + 1;
    versions.set(key, version);
    setDirty(key, kind);
    let operation;
    try { operation = kind === 'put' ? sync.push(key, load(key)) : sync.remove(key); } catch (_) { operation = false; }
    Promise.resolve(operation).then(ok => {
      if (ok && versions.get(key) === version) clearDirty(key);
    }, () => { /* queda pendiente: se reintentará en reconcile() */ });
  };

  /* ── Perfil (plantillas propias): un único documento, con el mismo esquema de "pendiente" ── */
  const freezeProfile = value => Object.freeze({
    templates: Object.freeze(value.templates.map(t => Object.freeze({
      id: t.id, name: t.name, blocks: Object.freeze(t.blocks.map(b => Object.freeze({ ...b })))
    })))
  });
  let profile = null;
  let profileVersion = 0;
  const loadProfile = () => {
    if (!profile) {
      let parsed = null;
      try { parsed = sanitizeProfile(JSON.parse(storage.read(STORAGE.profile))); } catch (_) { parsed = null; }
      profile = freezeProfile(parsed || { templates: [] });
    }
    return profile;
  };
  const sendProfile = () => {
    profileVersion += 1;
    const version = profileVersion;
    storage.write(STORAGE.profileDirty, '1');
    let operation;
    try { operation = sync.pushProfile ? sync.pushProfile(loadProfile()) : false; } catch (_) { operation = false; }
    Promise.resolve(operation).then(ok => {
      if (ok && profileVersion === version) storage.remove(STORAGE.profileDirty);
    }, () => { /* queda pendiente */ });
  };
  const commitProfile = (next, origin = 'local') => {
    profile = freezeProfile(next);
    storage.write(STORAGE.profile, JSON.stringify(profile));
    sendProfile();
    emit({ type: 'profile', origin });
  };
  const isProfileDirty = () => storage.read(STORAGE.profileDirty) === '1';

  /* ── Escritura ── */
  const commit = (key, blocks, origin = 'local') => {
    const frozen = freezeDay(blocks.slice().sort(byStart));
    cache.set(key, frozen);
    storage.write(dayStorageKey(key), JSON.stringify(frozen));
    send(key, 'put');
    emit({ type: 'days', keys: [key], origin });
    return frozen;
  };

  const FIELDS = ['t', 's', 'e', 'c', 'n'];
  const pickFields = patch => Object.fromEntries(FIELDS.filter(f => f in patch).map(f => [f, patch[f]]));

  const api = {
    /* Suscripción a cambios */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /* Lectura */
    getDay(key) { assertDateKey(key); return load(key); },
    hasSavedDay: key => storage.read(dayStorageKey(key)) !== null,
    savedDayCount: () => storedKeys().length,

    /* Actividades */
    addBlock(key, draft) {
      assertDateKey(key);
      const error = validateDraft(draft);
      if (error) return { ok: false, error };
      const current = load(key);
      if (current.length >= LIMITS.blocksPerDay) return { ok: false, error: `Máximo ${LIMITS.blocksPerDay} actividades por día.` };
      const block = sanitizeBlock({ ...pickFields(draft), id: uid(), d: false });
      if (!block) return { ok: false, error: 'La actividad no es válida.' };
      commit(key, [...current, block]);
      return { ok: true, block };
    },

    updateBlock(key, id, patch) {
      assertDateKey(key);
      const current = load(key);
      const existing = current.find(b => b.id === id);
      if (!existing) return { ok: false, error: 'La actividad ya no existe.' };
      const merged = { ...existing, ...pickFields(patch) };
      const error = validateDraft(merged);
      if (error) return { ok: false, error };
      const block = sanitizeBlock(merged);
      if (!block) return { ok: false, error: 'La actividad no es válida.' };
      commit(key, current.map(b => (b.id === id ? block : b)));
      return { ok: true, block };
    },

    removeBlock(key, id) {
      assertDateKey(key);
      const current = load(key);
      const removed = current.find(b => b.id === id);
      if (!removed) return { ok: false };
      commit(key, current.filter(b => b.id !== id));
      return { ok: true, removed };
    },

    /** Reinserta una actividad eliminada (deshacer). */
    restoreBlock(key, block) {
      assertDateKey(key);
      const clean = sanitizeBlock(block);
      const current = load(key);
      if (!clean || current.some(b => b.id === clean.id)) return { ok: false };
      commit(key, [...current, clean]);
      return { ok: true };
    },

    toggleDone(key, id) {
      assertDateKey(key);
      const current = load(key);
      const target = current.find(b => b.id === id);
      if (!target) return { ok: false };
      const next = current.map(b => (b.id === id ? { ...b, d: !b.d } : b));
      commit(key, next);
      return { ok: true, done: !target.d, before: dayProgress(current), after: dayProgress(next) };
    },

    reorder(key, orderedIds) {
      assertDateKey(key);
      const current = load(key);
      const next = reorderBlocks(current, orderedIds);
      if (next === current) return { ok: false };
      commit(key, next);
      return { ok: true };
    },

    /** Vacía el día (y lo borra de la nube). Devuelve las actividades anteriores para poder deshacer. */
    clearDay(key) {
      assertDateKey(key);
      const previous = load(key);
      storage.remove(dayStorageKey(key));
      cache.set(key, EMPTY_DAY);
      send(key, 'del');
      emit({ type: 'days', keys: [key], origin: 'local' });
      return previous;
    },

    restoreDay(key, blocks) {
      assertDateKey(key);
      const clean = sanitizeBlocks(blocks);
      if (!clean) return { ok: false };
      commit(key, clean);
      return { ok: true };
    },

    /**
     * Copia las actividades de un día a otros. Las copias nacen sin marcar y sin anotaciones.
     * Por defecto se añaden saltándose las que chocan con lo existente; con `replace` sustituyen el día.
     * Devuelve `previous` ([clave, actividades anteriores]) para poder deshacer.
     */
    copyDay(fromKey, toKeys, { replace = false } = {}) {
      assertDateKey(fromKey);
      const source = load(fromKey);
      if (!source.length) return { ok: false, error: 'Este día no tiene actividades que copiar.' };
      const targets = Array.from(new Set(toKeys)).filter(k => isDateKey(k) && k !== fromKey);
      if (!targets.length) return { ok: false, error: 'Elige al menos un día.' };
      const previous = [];
      let added = 0;
      let skipped = 0;
      targets.forEach(key => {
        const current = load(key);
        const base = replace ? [] : current;
        const candidates = source.map(b => sanitizeBlock({ ...b, id: uid(), d: false, n: '' }));
        const placed = placeBlocks(base, candidates);
        const usable = placed.added.slice(0, Math.max(0, LIMITS.blocksPerDay - base.length));
        skipped += candidates.length - usable.length;
        if (!usable.length) return;
        previous.push([key, current]);
        added += usable.length;
        commit(key, [...base, ...usable]);
      });
      if (!previous.length) return { ok: false, error: 'No se copió nada: esas horas ya están ocupadas.' };
      return { ok: true, days: previous.length, added, skipped, previous };
    },

    /** Revierte una copia: restaura cada día a como estaba. */
    undoCopy(previous) {
      previous.forEach(([key, blocks]) => {
        if (blocks.length) api.restoreDay(key, blocks);
        else api.clearDay(key);
      });
    },

    /* Plantillas propias (se sincronizan en el perfil) */
    listTemplates: () => loadProfile().templates,

    saveTemplate(name, key) {
      assertDateKey(key);
      const day = load(key);
      if (!day.length) return { ok: false, error: 'Este día no tiene actividades que guardar.' };
      const clean = typeof name === 'string' ? name.trim().slice(0, LIMITS.templateName) : '';
      if (!clean) return { ok: false, error: 'Escribe un nombre para la plantilla.' };
      const templates = loadProfile().templates;
      if (templates.length >= LIMITS.templates) return { ok: false, error: `Máximo ${LIMITS.templates} plantillas. Elimina alguna.` };
      if (templates.some(t => t.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: 'Ya tienes una plantilla con ese nombre.' };
      const template = sanitizeTemplate({
        id: `t${uid().slice(1, 13)}`,
        name: clean,
        blocks: day.map(({ s, e, t, c }) => ({ s, e, t, c }))
      });
      if (!template) return { ok: false, error: 'No se pudo crear la plantilla.' };
      commitProfile({ templates: [...templates, template] });
      return { ok: true, template };
    },

    deleteTemplate(id) {
      const templates = loadProfile().templates;
      const removed = templates.find(t => t.id === id);
      if (!removed) return { ok: false };
      commitProfile({ templates: templates.filter(t => t.id !== id) });
      return { ok: true, removed };
    },

    restoreTemplate(template) {
      const clean = sanitizeTemplate(template);
      const templates = loadProfile().templates;
      if (!clean || templates.some(t => t.id === clean.id) || templates.length >= LIMITS.templates) return { ok: false };
      commitProfile({ templates: [...templates, clean] });
      return { ok: true };
    },

    /* Plantillas de arranque (onboarding): las integradas más las propias */
    availablePresets(key) {
      assertDateKey(key);
      const dow = parseDateKey(key).getDay();
      const day = load(key);
      const custom = loadProfile().templates.map(t => ({
        id: t.id,
        label: t.name,
        title: `Añadir «${t.name}»`,
        icon: 'star',
        quick: true,
        custom: true,
        count: t.blocks.length,
        from: toHHMM(Math.min(...t.blocks.map(b => b.s))),
        to: toHHMM(Math.max(...t.blocks.map(b => b.e))),
        used: day.some(b => b.p === t.id)
      }));
      return PRESETS.map(preset => {
        const rows = preset.rows(dow);
        if (!rows || !rows.length) return null;
        const starts = rows.map(r => fromHHMM(r[0]));
        const ends = rows.map(r => fromHHMM(r[1]));
        return {
          id: preset.id,
          label: preset.label,
          title: preset.title,
          icon: preset.icon,
          quick: preset.quick,
          count: rows.length,
          from: toHHMM(Math.min(...starts)),
          to: toHHMM(Math.max(...ends)),
          used: day.some(b => b.p === preset.id)
        };
      }).filter(Boolean).concat(custom);
    },

    applyPreset(key, presetId) {
      assertDateKey(key);
      const template = loadProfile().templates.find(t => t.id === presetId);
      const preset = template
        ? { id: template.id, rows: () => template.blocks.map(b => [toHHMM(b.s), toHHMM(b.e), b.t, b.c]) }
        : PRESETS.find(p => p.id === presetId);
      if (!preset) return { ok: false, error: 'Plantilla desconocida.' };
      const current = load(key);
      const room = LIMITS.blocksPerDay - current.length;
      const { added, skipped } = instantiatePreset(preset, parseDateKey(key).getDay(), current);
      const usable = added.slice(0, Math.max(0, room));
      if (!usable.length) return { ok: false, error: 'Esas horas ya están ocupadas por otras actividades.', skipped };
      commit(key, [...current, ...usable]);
      return { ok: true, added: usable.length, skipped };
    },

    /* Progreso, racha y resúmenes */
    streakView(now = clock()) {
      const blocksAt = load;
      const keys = storedKeys().sort();
      const { current, best } = computeStreaks({ blocksAt, today: now, earliestKey: keys[0] || null });
      return {
        current,
        best,
        week: weekStrip({ blocksAt, today: now }),
        today: dayProgress(load(toDateKey(now)))
      };
    },
    weekSummary(now = clock()) {
      return summarizeWeek(weekDates(now).map(d => load(toDateKey(d))));
    },
    nextPlannedDay: (now = clock()) => findNextPlannedDay({ blocksAt: load, from: now }),
    upcomingStarts: (from, horizonDays, limit) => upcomingStarts({ blocksAt: load, from, horizonDays, limit }),

    /* Sincronización con la nube */

    /** Aplica cambios llegados de la nube. Los días con cambios locales pendientes no se pisan. */
    applyRemoteChanges(changes) {
      const dirty = readDirty();
      let changed = false;
      changes.forEach(({ key, blocks }) => {
        if (!isDateKey(key) || dirty[key]) return;
        if (blocks === null) {
          if (storage.read(dayStorageKey(key)) === null) return;
          storage.remove(dayStorageKey(key));
          cache.set(key, EMPTY_DAY);
          changed = true;
          return;
        }
        const clean = sanitizeBlocks(blocks);
        // Datos remotos corruptos: nunca vaciar un día por un documento ilegible.
        if (!clean || (Array.isArray(blocks) && blocks.length && !clean.length)) return;
        const current = parseStored(key);
        if (current && JSON.stringify(current) === JSON.stringify(clean)) return;
        cache.set(key, freezeDay(clean));
        storage.write(dayStorageKey(key), JSON.stringify(clean));
        changed = true;
      });
      if (changed) emit({ type: 'days', keys: changes.map(c => c.key), origin: 'remote' });
      return changed;
    },

    /** Tras la primera lectura completa de la nube: sube lo pendiente y lo que solo existe en este dispositivo. */
    reconcile(remoteKeys) {
      const remote = new Set(remoteKeys);
      const dirty = readDirty();
      storedKeys().forEach(key => {
        if (dirty[key] === 'put' || (!remote.has(key) && !dirty[key])) send(key, 'put');
      });
      Object.keys(dirty).forEach(key => { if (dirty[key] === 'del') send(key, 'del'); });
    },

    /** Perfil llegado de la nube (null = el documento no existe). No pisa cambios locales pendientes. */
    applyRemoteProfile(remote) {
      if (remote === null || remote === undefined || isProfileDirty()) return false;
      const clean = sanitizeProfile(remote);
      if (!clean) return false;
      if (JSON.stringify(clean) === JSON.stringify(loadProfile())) return false;
      profile = freezeProfile(clean);
      storage.write(STORAGE.profile, JSON.stringify(profile));
      emit({ type: 'profile', origin: 'remote' });
      return true;
    },

    /** Primera lectura completa del perfil: sube lo pendiente o lo que solo existe en este dispositivo. */
    reconcileProfile(remoteExists) {
      if (isProfileDirty() || (!remoteExists && loadProfile().templates.length)) sendProfile();
    },

    /* Sesión: a qué cuenta pertenecen los datos locales */
    getSessionUid: () => storage.read(STORAGE.uid),
    setSessionUid: uidValue => storage.write(STORAGE.uid, uidValue),

    /** Borra los datos del horario de este dispositivo (cerrar sesión o cambiar de cuenta). */
    clearLocalData() {
      storedKeys().forEach(key => storage.remove(dayStorageKey(key)));
      storage.remove(STORAGE.dirty);
      storage.remove(STORAGE.uid);
      storage.remove(STORAGE.profile);
      storage.remove(STORAGE.profileDirty);
      profile = null;
      cache.clear();
      versions.clear();
      emit({ type: 'reset', origin: 'local' });
    },

    /* Preferencias de este dispositivo */
    settings: {
      get: name => storage.read(STORAGE.settingPrefix + name),
      set: (name, value) => storage.write(STORAGE.settingPrefix + name, String(value)),
      getFlag: name => storage.read(STORAGE.settingPrefix + name) === '1',
      setFlag: (name, on) => storage.write(STORAGE.settingPrefix + name, on ? '1' : '0')
    },

    /* Copias de seguridad */
    exportBackup() {
      const data = {};
      storedKeys().forEach(key => { data[dayStorageKey(key)] = storage.read(dayStorageKey(key)); });
      BACKUP_SETTING_KEYS.forEach(k => { const v = storage.read(k); if (v !== null) data[k] = v; });
      if (loadProfile().templates.length) data[STORAGE.profile] = JSON.stringify(loadProfile());
      return { app: BACKUP.app, version: BACKUP.version, exportedAt: new Date().toISOString(), data };
    },

    importBackup(text) {
      const { days, settings, profile: imported } = parseBackup(text);
      days.forEach(([key, blocks]) => {
        const frozen = freezeDay(blocks);
        cache.set(key, frozen);
        storage.write(dayStorageKey(key), JSON.stringify(frozen));
        send(key, 'put');
      });
      settings.forEach(([k, v]) => storage.write(k, v));
      if (imported && imported.templates.length) {
        commitProfile({ templates: mergeTemplates(loadProfile().templates, imported.templates) }, 'import');
      }
      emit({ type: 'days', keys: days.map(([key]) => key), origin: 'import' });
      return { days: days.length, templates: imported ? imported.templates.length : 0 };
    }
  };

  return api;
}
