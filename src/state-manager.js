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
  ACCENTS, BACKUP, BADGES, CATEGORIES, CATEGORY_COLORS, LEAD_OPTIONS, LIMITS, MAX_MIN, PRESETS, STORAGE, STREAK_RULES, THEMES
} from './config.js';
import {
  addDays, diffDays, fromHHMM, isDateKey, parseDateKey, startOfDay, toDateKey, toHHMM, uid, weekDates
} from './utils.js';
import { t as translate } from './i18n.js';

const CATEGORY_KEYS = new Set(CATEGORIES.map(c => c.key));
const BLOCK_ID_RE = /^[\w-]{1,40}$/;
const PRESET_ID_RE = /^[a-z0-9-]{1,24}$/;
const TEMPLATE_ID_RE = /^t[a-z0-9]{1,20}$/;
/** Ajustes que viajan en la copia de seguridad, cada uno con su validador. */
const BACKUP_SETTINGS = Object.freeze({
  [`${STORAGE.settingPrefix}notify`]: value => value === '0' || value === '1',
  [`${STORAGE.settingPrefix}lead`]: value => /^\d+$/.test(value) && LEAD_OPTIONS.includes(Number(value)),
  [`${STORAGE.settingPrefix}theme`]: value => THEMES.some(t => t.key === value),
  [`${STORAGE.settingPrefix}accent`]: value => ACCENTS.some(a => a.key === value),
  [`${STORAGE.settingPrefix}lang`]: value => value === 'es' || value === 'en'
});
const BACKUP_SETTING_KEYS = Object.freeze(Object.keys(BACKUP_SETTINGS));
const RULE_ID_RE = /^r[a-z0-9]{1,20}$/;

export const EMPTY_DAY = Object.freeze([]);
export const byStart = (a, b) => a.s - b.s || a.e - b.e;

/* ═══════════════ Validación y saneado ═══════════════ */

const clampMinute = n => Math.min(MAX_MIN, Math.max(0, Math.round(Number(n))));

/** Subtareas de una actividad: [{ t, d }] (vacío si no hay o no son válidas). */
export function sanitizeSubtasks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, LIMITS.subtasks)
    .map(item => (item && typeof item === 'object' && typeof item.t === 'string'
      ? { t: item.t.trim().slice(0, LIMITS.subtaskLength), d: item.d === true }
      : null))
    .filter(item => item && item.t);
}

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
  const k = sanitizeSubtasks(raw.k);
  if (k.length) block.k = k;
  if (typeof raw.r === 'string' && RULE_ID_RE.test(raw.r)) block.r = raw.r;   // regla semanal de la que procede
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
    .sort(byStart).map(structureOf);
  return blocks.length ? { id: raw.id, name, blocks } : null;
}

/** Lo que una plantilla o regla conserva de una actividad: horas, título, tipo y subtareas sin marcar. */
function structureOf(block) {
  const out = { s: block.s, e: block.e, t: block.t, c: block.c };
  if (block.k) out.k = block.k.map(item => ({ t: item.t, d: false }));
  return out;
}

/* ═══════════════ Repeticiones semanales ═══════════════ */

/** Regla: { id, t, c, s, e, dows:[0-6], from, until?, k? }. Genera una actividad cada semana en esos días. */
export function sanitizeRule(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !RULE_ID_RE.test(raw.id)) return null;
  const base = sanitizeBlock({ id: 'x', s: raw.s, e: raw.e, t: raw.t, c: raw.c, k: raw.k });
  const dows = Array.from(new Set((Array.isArray(raw.dows) ? raw.dows : []).map(Number)
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6))).sort((a, b) => a - b);
  if (!base || !dows.length || !isDateKey(raw.from)) return null;
  const rule = { id: raw.id, t: base.t, c: base.c, s: base.s, e: base.e, dows, from: raw.from };
  if (base.k) rule.k = base.k.map(item => ({ t: item.t, d: false }));
  if (isDateKey(raw.until)) rule.until = raw.until;
  return rule;
}

/** ¿Genera la regla una actividad ese día? (las fechas AAAA-MM-DD se comparan como texto) */
export const ruleAppliesOn = (rule, key) => key >= rule.from
  && (!rule.until || key <= rule.until)
  && rule.dows.includes(parseDateKey(key).getDay());

/** Id estable: todos los dispositivos generan la misma actividad para la misma regla y fecha. */
export const occurrenceId = (rule, key) => `${rule.id}-${key.replace(/-/g, '')}`;

export const occurrenceBlock = (rule, key) => sanitizeBlock({
  id: occurrenceId(rule, key), s: rule.s, e: rule.e, t: rule.t, c: rule.c, n: '', d: false, k: rule.k, r: rule.id
});

/** Actividades que las reglas generan para un día (sin guardar). */
export const expandRules = (rules, key) => rules
  .filter(rule => ruleAppliesOn(rule, key))
  .map(rule => occurrenceBlock(rule, key))
  .filter(Boolean)
  .sort(byStart);

/** Nombre y color propios de las categorías: { clase: { l: 'Mates', c: 'rojo' } }. Solo valores permitidos. */
export function sanitizeCategories(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  CATEGORIES.forEach(({ key }) => {
    const item = raw[key];
    if (!item || typeof item !== 'object') return;
    const entry = {};
    const label = typeof item.l === 'string' ? item.l.replace(/\s+/g, ' ').trim().slice(0, LIMITS.categoryLabel) : '';
    if (label) entry.l = label;
    if (typeof item.c === 'string' && Object.hasOwn(CATEGORY_COLORS, item.c)) entry.c = item.c;
    if (entry.l || entry.c) out[key] = entry;
  });
  return out;
}

/** Perfil del usuario (se sincroniza como un único documento). null si no es un objeto. */
export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seen = new Set();
  const templates = (Array.isArray(raw.templates) ? raw.templates : [])
    .map(sanitizeTemplate)
    .filter(t => t && !seen.has(t.id) && seen.add(t.id))
    .slice(0, LIMITS.templates);
  const seenRules = new Set();
  const recurring = (Array.isArray(raw.recurring) ? raw.recurring : [])
    .map(sanitizeRule)
    .filter(rule => rule && !seenRules.has(rule.id) && seenRules.add(rule.id))
    .slice(0, LIMITS.recurring);
  const profile = { templates, recurring };
  const rest = Array.from(new Set((Array.isArray(raw.rest) ? raw.rest : []).filter(isDateKey))).sort().slice(-LIMITS.restDays);
  if (rest.length) profile.rest = rest;
  const streak = normalizeStreakConfig(raw.streak);
  if (!isDefaultStreak(streak)) profile.streak = streak;
  const badgeSource = raw.badges && typeof raw.badges === 'object' && !Array.isArray(raw.badges) ? raw.badges : {};
  const badges = Object.fromEntries(Object.entries(badgeSource)
    .filter(([id, date]) => BADGE_IDS.has(id) && isDateKey(date))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, LIMITS.badges));
  if (Object.keys(badges).length) profile.badges = badges;
  const cats = sanitizeCategories(raw.cats);
  if (Object.keys(cats).length) profile.cats = cats;
  return profile;
}

/** ¿Tiene el perfil algo que guardar o sincronizar? */
export const profileHasData = profile => Boolean(profile && (
  profile.templates.length || profile.recurring.length || (profile.rest && profile.rest.length)
  || profile.streak || (profile.badges && Object.keys(profile.badges).length) || (profile.cats && Object.keys(profile.cats).length)
));

/** Une dos mapas de insignias: se queda la fecha más antigua de cada una. */
const unionBadges = (a = {}, b = {}) => {
  const out = { ...a };
  Object.entries(b).forEach(([id, date]) => { if (!out[id] || date < out[id]) out[id] = date; });
  return out;
};

const mergeById = (current, incoming, max) => {
  const byId = new Map(current.map(item => [item.id, item]));
  incoming.forEach(item => byId.set(item.id, item));
  return Array.from(byId.values()).slice(0, max);
};

/** Fusiona plantillas: las entrantes sustituyen a las que tienen el mismo id; se respeta el máximo. */
export const mergeTemplates = (current, incoming) => mergeById(current, incoming, LIMITS.templates);
export const mergeRules = (current, incoming) => mergeById(current, incoming, LIMITS.recurring);

/** Mensaje de error para el usuario, o null si el borrador es válido. */
export function validateDraft({ t, s, e }) {
  if (typeof t !== 'string' || !t.trim()) return 'Escribe un nombre para la actividad.';
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 'Elige la hora de inicio y de fin.';
  if (e <= s) return 'La hora de fin debe ser posterior al inicio.';
  return null;
}

const freezeBlock = block => {
  const copy = { ...block };
  if (copy.k) copy.k = Object.freeze(copy.k.map(item => Object.freeze({ ...item })));
  return Object.freeze(copy);
};
const freezeDay = blocks => Object.freeze(blocks.map(freezeBlock));

/* ═══════════════ Ajustes de racha ═══════════════ */

const ALL_DOWS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const NO_REST = Object.freeze(new Set());
export const DEFAULT_STREAK = Object.freeze({ goal: STREAK_RULES.defaultGoal, days: ALL_DOWS });

/** Meta (%) y días de la semana que cuentan para la racha. Cualquier valor raro vuelve al valor por defecto. */
export function normalizeStreakConfig(raw) {
  const object = raw && typeof raw === 'object' ? raw : {};
  const goal = STREAK_RULES.goalOptions.includes(Number(object.goal)) ? Number(object.goal) : STREAK_RULES.defaultGoal;
  const days = Array.isArray(object.days)
    ? Array.from(new Set(object.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))).sort((a, b) => a - b)
    : [];
  return { goal, days: days.length ? days : ALL_DOWS.slice() };
}
export const isDefaultStreak = config => config.goal === STREAK_RULES.defaultGoal && config.days.length === 7;

/* ═══════════════ Progreso y rachas ═══════════════ */

/** Actividades que hay que completar para cumplir la meta del día (redondeo hacia arriba). */
export const requiredFor = (total, goal) => Math.ceil((total * goal) / 100);
export const requiredCount = total => requiredFor(total, STREAK_RULES.defaultGoal);

export function dayProgress(blocks, goal = STREAK_RULES.defaultGoal) {
  const total = blocks.length;
  const done = blocks.reduce((n, b) => n + (b.d ? 1 : 0), 0);
  const required = requiredFor(total, goal);
  return {
    total,
    done,
    required,
    remaining: Math.max(0, required - done),
    // Comparación entera (sin decimales): done/total >= goal/100
    met: total > 0 && done * 100 >= total * goal
  };
}

/** ¿Cuenta este día para la racha? No cuentan los días de descanso ni los días de la semana desactivados. */
const countsForStreak = (key, dow, config, rest) => !rest.has(key) && config.days.includes(dow);

/**
 * Racha actual y mejor racha: días consecutivos en los que se cumplió la meta.
 *  - El día de hoy aún en curso no rompe la racha (suma cuando se cumple).
 *  - Un día pasado con actividades por debajo de la meta la rompe.
 *  - Los días sin actividades no suman ni rompen, hasta `maxRestGap` seguidos (fin de semana libre).
 *    Un hueco mayor la rompe: evita conservar una racha abandonando la app.
 *  - Los días de descanso y los días de la semana que no cuentan se saltan por completo: ni suman, ni rompen,
 *    ni cuentan como hueco.
 */
export function computeStreaks({ blocksAt, today, earliestKey, config = DEFAULT_STREAK, rest = NO_REST }) {
  const first = earliestKey ? parseDateKey(earliestKey) : null;
  if (!first) return { current: 0, best: 0 };
  const span = Math.min(Math.max(diffDays(first, today), 0), STREAK_RULES.maxLookbackDays);
  let run = 0;
  let best = 0;
  let gap = 0;
  for (let offset = span; offset >= 0; offset--) {
    const isToday = offset === 0;
    const date = addDays(today, -offset);
    const key = toDateKey(date);
    if (!countsForStreak(key, date.getDay(), config, rest)) continue;
    const progress = dayProgress(blocksAt(key), config.goal);
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
export function weekStrip({ blocksAt, today, config = DEFAULT_STREAK, rest = NO_REST }) {
  const todayKey = toDateKey(today);
  return weekDates(today).map(date => {
    const key = toDateKey(date);
    const progress = dayProgress(blocksAt(key), config.goal);
    let status;
    if (rest.has(key)) status = 'restday';
    else if (!config.days.includes(date.getDay())) status = 'off';
    else if (key > todayKey) status = 'future';
    else if (progress.total === 0) status = 'rest';
    else if (progress.met) status = 'met';
    else status = key === todayKey ? 'pending' : 'missed';
    return { key, dow: date.getDay(), status, isToday: key === todayKey, done: progress.done, total: progress.total };
  });
}

/* ═══════════════ Insignias ═══════════════ */

const BADGE_IDS = new Set(BADGES.map(b => b.id));
const badgeValueOf = (badge, stats) => ({ done: stats.done, streak: stats.best, days: stats.daysMet, week: stats.perfectWeeks })[badge.kind] || 0;

/** Cifras del historial con las que se consiguen las insignias. `keys` = días con registro propio. */
export function badgeStats({ blocksAt, keys, today, config = DEFAULT_STREAK, rest = NO_REST }) {
  let done = 0;
  let daysMet = 0;
  const weeks = new Set();
  keys.forEach(key => {
    const blocks = blocksAt(key);
    done += blocks.reduce((n, b) => n + (b.d ? 1 : 0), 0);
    const date = parseDateKey(key);
    if (countsForStreak(key, date.getDay(), config, rest) && dayProgress(blocks, config.goal).met) daysMet += 1;
    weeks.add(toDateKey(weekDates(date)[0]));
  });
  const todayKey = toDateKey(today);
  let perfectWeeks = 0;
  weeks.forEach(mondayKey => {
    const dates = weekDates(parseDateKey(mondayKey));
    if (toDateKey(dates[6]) >= todayKey) return; // solo semanas ya terminadas
    let withActivities = 0;
    let allMet = true;
    dates.forEach(date => {
      const key = toDateKey(date);
      if (!countsForStreak(key, date.getDay(), config, rest)) return;
      const blocks = blocksAt(key);
      if (!blocks.length) return;
      withActivities += 1;
      if (!dayProgress(blocks, config.goal).met) allMet = false;
    });
    if (allMet && withActivities >= 3) perfectWeeks += 1;
  });
  const earliest = keys.length ? keys.slice().sort()[0] : null;
  const { best } = computeStreaks({ blocksAt, today, earliestKey: earliest, config, rest });
  return { done, daysMet, perfectWeeks, best };
}

/** Insignias cuyo requisito cumplen las cifras (con su valor actual). */
export const earnedBadges = stats => BADGES.filter(b => badgeValueOf(b, stats) >= b.target);
export const badgeProgress = (badge, stats) => Math.min(badgeValueOf(badge, stats), badge.target);

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

/** Resumen de un mes natural: tiempo por categoría y días con objetivo cumplido (sin comparar con otros meses). */
export function summarizeMonth({ blocksAt, year, month, config = DEFAULT_STREAK, rest = NO_REST }) {
  const length = new Date(year, month + 1, 0).getDate();
  const perDay = [];
  let counted = 0;
  let met = 0;
  for (let d = 1; d <= length; d++) {
    const date = new Date(year, month, d);
    const key = toDateKey(date);
    const blocks = blocksAt(key);
    perDay.push(blocks);
    if (!blocks.length || !countsForStreak(key, date.getDay(), config, rest)) continue;
    counted += 1;
    if (dayProgress(blocks, config.goal).met) met += 1;
  }
  return { year, month, summary: summarizeWeek(perDay), countedDays: counted, metDays: met };
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
    .map(([from, to, title, c, subtasks]) => sanitizeBlock({
      id: uid(), s: fromHHMM(from), e: fromHHMM(to), t: translate(title), c, n: '', d: false, p: preset.id,
      k: (subtasks || []).map(text => ({ t: translate(text), d: false }))
    }))
    .filter(Boolean);
  return placeBlocks(existing, candidates);
}

/** Próximos avisos de actividades no hechas, ordenados por hora. `at` es cuándo debe sonar (inicio − antelación). */
export function upcomingStarts({ blocksAt, from, horizonDays, limit, lead = 0 }) {
  const out = [];
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDays(from, i);
    const key = toDateKey(date);
    blocksAt(key).forEach(block => {
      if (block.d) return;
      const at = startOfDay(date);
      at.setMinutes(block.s - lead);   // con antelación, el aviso salta `lead` minutos antes
      if (at > from) out.push({ key, block, at, lead });
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
    /** Actividades cuyo aviso acaba de tocar: `lead` minutos antes del inicio (0 = al empezar). */
    collect(dateKey, blocks, nowMin, lead = 0) {
      return blocks.filter(b => {
        const age = nowMin - (b.s - lead);
        const id = `${dateKey}:${b.id}:${lead}`;
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
    } else if (BACKUP_SETTINGS[storageKey] && BACKUP_SETTINGS[storageKey](value)) {
      settings.push([storageKey, value]);
    }
  });
  const hasProfile = profileHasData(profile);
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
  /** Días sin registro propio: lo que generan las repeticiones semanales (no se guarda hasta que se toca). */
  const virtualCache = new Map();
  const load = key => {
    const hit = cache.get(key);
    if (hit) return hit;
    const stored = parseStored(key);
    if (stored) {
      const day = freezeDay(stored);
      cache.set(key, day);
      return day;
    }
    let virtual = virtualCache.get(key);
    if (!virtual) {
      const generated = expandRules(loadProfile().recurring, key);
      virtual = generated.length ? freezeDay(generated) : EMPTY_DAY;
      virtualCache.set(key, virtual);
    }
    return virtual;
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
  const freezeStructure = block => {
    const copy = { ...block };
    if (copy.k) copy.k = Object.freeze(copy.k.map(item => Object.freeze({ ...item })));
    return Object.freeze(copy);
  };
  const freezeProfile = value => {
    const out = {
      templates: Object.freeze(value.templates.map(t => Object.freeze({
        id: t.id, name: t.name, blocks: Object.freeze(t.blocks.map(freezeStructure))
      }))),
      recurring: Object.freeze(value.recurring.map(rule => {
        const copy = { ...rule, dows: Object.freeze(rule.dows.slice()) };
        if (copy.k) copy.k = Object.freeze(copy.k.map(item => Object.freeze({ ...item })));
        return Object.freeze(copy);
      }))
    };
    if (value.rest && value.rest.length) out.rest = Object.freeze(value.rest.slice());
    if (value.streak) out.streak = Object.freeze({ goal: value.streak.goal, days: Object.freeze(value.streak.days.slice()) });
    if (value.badges && Object.keys(value.badges).length) out.badges = Object.freeze({ ...value.badges });
    if (value.cats && Object.keys(value.cats).length) {
      out.cats = Object.freeze(Object.fromEntries(Object.entries(value.cats).map(([k, v]) => [k, Object.freeze({ ...v })])));
    }
    return Object.freeze(out);
  };
  let profile = null;
  let profileVersion = 0;
  const loadProfile = () => {
    if (!profile) {
      let parsed = null;
      try { parsed = sanitizeProfile(JSON.parse(storage.read(STORAGE.profile))); } catch (_) { parsed = null; }
      profile = freezeProfile(parsed || { templates: [], recurring: [] });
    }
    return profile;
  };
  /** Cambia el perfil en memoria; los días generados por repeticiones se recalculan. */
  const setProfile = next => {
    profile = freezeProfile(next);
    virtualCache.clear();
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
    setProfile(next);
    storage.write(STORAGE.profile, JSON.stringify(profile));
    sendProfile();
    emit({ type: 'profile', origin });
  };
  const isProfileDirty = () => storage.read(STORAGE.profileDirty) === '1';
  const streakConfig = () => normalizeStreakConfig(loadProfile().streak);
  const restSet = () => new Set(loadProfile().rest || []);

  /* ── Escritura ── */
  const commit = (key, blocks, origin = 'local') => {
    const frozen = freezeDay(blocks.slice().sort(byStart));
    cache.set(key, frozen);
    storage.write(dayStorageKey(key), JSON.stringify(frozen));
    send(key, 'put');
    emit({ type: 'days', keys: [key], origin });
    return frozen;
  };

  const rulesApplyOn = key => loadProfile().recurring.some(rule => ruleAppliesOn(rule, key));
  const todayKey = () => toDateKey(clock());
  const dayBefore = key => toDateKey(addDays(parseDateKey(key), -1));
  const dowOf = key => parseDateKey(key).getDay();
  const newRuleId = () => `r${uid().slice(1, 13)}`;

  /** Quita el registro de un día (y de la nube). Sin repeticiones, el día vuelve a estar vacío. */
  const dropDayRecord = key => {
    storage.remove(dayStorageKey(key));
    cache.delete(key);
    send(key, 'del');
    emit({ type: 'days', keys: [key], origin: 'local' });
  };
  /** Guarda las actividades de un día; un día vacío sin repeticiones no necesita registro. */
  const setDayBlocks = (key, blocks) => {
    if (blocks.length || rulesApplyOn(key)) commit(key, blocks);
    else dropDayRecord(key);
  };

  /** Prepara un cambio de repeticiones que se pueda deshacer: recuerda las reglas y los días que se toquen. */
  const beginChange = () => {
    const before = loadProfile().recurring;
    const days = new Map();
    return {
      touch(key) {
        if (!days.has(key)) days.set(key, { saved: storage.read(dayStorageKey(key)) !== null, blocks: load(key) });
      },
      undo() {
        commitProfile({ ...loadProfile(), recurring: before });
        days.forEach(({ saved, blocks }, key) => {
          if (saved) commit(key, blocks);
          else if (storage.read(dayStorageKey(key)) !== null) dropDayRecord(key);
        });
      }
    };
  };

  const FIELDS = ['t', 's', 'e', 'c', 'n', 'k'];
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
      const { goal } = streakConfig();
      return { ok: true, done: !target.d, before: dayProgress(current, goal), after: dayProgress(next, goal) };
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
      // Con repeticiones se deja un registro vacío: si no, las actividades repetidas reaparecerían.
      if (rulesApplyOn(key)) commit(key, []);
      else dropDayRecord(key);
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
        const candidates = source.map(b => sanitizeBlock({
          ...b, id: uid(), d: false, n: '', r: undefined, k: (b.k || []).map(item => ({ t: item.t, d: false }))
        }));
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

    /* Repeticiones semanales (se guardan como reglas en el perfil y se sincronizan) */
    listRecurring: () => loadProfile().recurring,

    /**
     * Crea una repetición semanal desde `key` (hoy o una fecha futura). El día de `key` se incluye siempre.
     * Con `blockId`, esa actividad ya existente pasa a ser la primera de la serie.
     * Devuelve `undo()` para deshacerlo todo.
     */
    addRecurring(key, draft, dows, { blockId = null } = {}) {
      assertDateKey(key);
      const error = validateDraft(draft);
      if (error) return { ok: false, error };
      const profile0 = loadProfile();
      if (profile0.recurring.length >= LIMITS.recurring) {
        return { ok: false, error: `Máximo ${LIMITS.recurring} repeticiones. Quita alguna.` };
      }
      const rule = sanitizeRule({
        id: newRuleId(), t: draft.t, c: draft.c, s: draft.s, e: draft.e, k: draft.k,
        dows: [...(Array.isArray(dows) ? dows : []), dowOf(key)], from: key
      });
      if (!rule) return { ok: false, error: 'La repetición no es válida.' };

      const change = beginChange();
      commitProfile({ ...profile0, recurring: [...profile0.recurring, rule] });

      // El día elegido: queda guardado con su serie (y la nota que se haya escrito).
      change.touch(key);
      const current = load(key);
      let next;
      if (blockId) {
        next = current.map(b => (b.id === blockId ? { ...b, r: rule.id } : b));
      } else {
        const note = typeof draft.n === 'string' ? draft.n : '';
        const has = current.some(b => b.r === rule.id);
        const own = occurrenceBlock(rule, key);
        next = has ? current.map(b => (b.r === rule.id ? { ...b, n: note } : b)) : [...current, { ...own, n: note }];
      }
      commit(key, next);

      // Resto de días ya guardados que encajan en la serie.
      storedKeys().filter(k => k !== key && ruleAppliesOn(rule, k)).forEach(k => {
        const day = load(k);
        if (day.some(b => b.r === rule.id)) return;
        const block = occurrenceBlock(rule, k);
        if (!block || findOverlaps(day, block).length) return;
        change.touch(k);
        commit(k, [...day, block]);
      });
      return { ok: true, rule, undo: change.undo };
    },

    /**
     * Deja de repetir: la serie termina en `afterKey` (inclusive). Nunca se toca el pasado:
     * si `afterKey` es anterior a ayer, se corta desde hoy.
     */
    stopRecurring(ruleId, afterKey) {
      assertDateKey(afterKey);
      const rules = loadProfile().recurring;
      const rule = rules.find(r => r.id === ruleId);
      if (!rule) return { ok: false };
      const yesterday = dayBefore(todayKey());
      const until = afterKey < yesterday ? yesterday : afterKey;
      const change = beginChange();
      const next = rule.from > until
        ? rules.filter(r => r.id !== ruleId)
        : rules.map(r => (r.id === ruleId ? { ...r, until: r.until && r.until < until ? r.until : until } : r));
      commitProfile({ ...loadProfile(), recurring: next });
      storedKeys().filter(k => k > until).forEach(k => {
        const day = load(k);
        const rest = day.filter(b => !(b.r === ruleId && !b.d));
        if (rest.length === day.length) return;
        change.touch(k);
        setDayBlocks(k, rest);
      });
      return { ok: true, until, undo: change.undo };
    },

    /**
     * Cambia la serie "desde `fromKey` en adelante" (como en un calendario): la regla anterior termina el día
     * antes y nace una nueva con los datos cambiados. El pasado no se modifica (como mínimo, desde hoy).
     */
    changeRecurring(ruleId, fromKey, patch) {
      assertDateKey(fromKey);
      const profile0 = loadProfile();
      const old = profile0.recurring.find(r => r.id === ruleId);
      if (!old) return { ok: false, error: 'La repetición ya no existe.' };
      const start = fromKey < todayKey() ? todayKey() : fromKey;
      if (old.until && start > old.until) return { ok: false, error: 'Esa repetición ya terminó.' };
      const merged = {
        t: 't' in patch ? patch.t : old.t,
        c: 'c' in patch ? patch.c : old.c,
        s: 's' in patch ? patch.s : old.s,
        e: 'e' in patch ? patch.e : old.e,
        k: 'k' in patch ? patch.k : old.k,
        dows: 'dows' in patch ? patch.dows : old.dows
      };
      const error = validateDraft(merged);
      if (error) return { ok: false, error };
      const created = sanitizeRule({ id: newRuleId(), ...merged, from: start, until: old.until });
      if (!created) return { ok: false, error: 'La repetición no es válida.' };
      const keepsOld = start > old.from;
      if (profile0.recurring.length + (keepsOld ? 1 : 0) > LIMITS.recurring) {
        return { ok: false, error: `Máximo ${LIMITS.recurring} repeticiones. Quita alguna.` };
      }

      const change = beginChange();
      const closed = keepsOld ? { ...old, until: dayBefore(start) } : null;
      commitProfile({
        ...profile0,
        recurring: profile0.recurring.flatMap(r => (r.id !== ruleId ? [r] : closed ? [closed, created] : [created]))
      });

      storedKeys().filter(k => k >= start && (!old.until || k <= old.until)).sort().forEach(k => {
        const day = load(k);
        const pending = day.find(b => b.r === ruleId && !b.d);
        let next = day;
        if (pending) {
          const rest = day.filter(b => b !== pending);
          next = ruleAppliesOn(created, k) ? [...rest, { ...occurrenceBlock(created, k), n: pending.n }] : rest;
        } else if (!day.some(b => b.r === ruleId) && ruleAppliesOn(created, k) && !old.dows.includes(dowOf(k))) {
          const block = occurrenceBlock(created, k);   // día de la semana añadido a la serie
          if (block && !findOverlaps(day, block).length) next = [...day, block];
        }
        if (next === day) return;
        change.touch(k);
        setDayBlocks(k, next);
      });
      return { ok: true, rule: created, undo: change.undo };
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
        blocks: day.map(structureOf)
      });
      if (!template) return { ok: false, error: 'No se pudo crear la plantilla.' };
      commitProfile({ ...loadProfile(), templates: [...templates, template] });
      return { ok: true, template };
    },

    deleteTemplate(id) {
      const templates = loadProfile().templates;
      const removed = templates.find(t => t.id === id);
      if (!removed) return { ok: false };
      commitProfile({ ...loadProfile(), templates: templates.filter(t => t.id !== id) });
      return { ok: true, removed };
    },

    restoreTemplate(template) {
      const clean = sanitizeTemplate(template);
      const templates = loadProfile().templates;
      if (!clean || templates.some(t => t.id === clean.id) || templates.length >= LIMITS.templates) return { ok: false };
      commitProfile({ ...loadProfile(), templates: [...templates, clean] });
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
        ? { id: template.id, rows: () => template.blocks.map(b => [toHHMM(b.s), toHHMM(b.e), b.t, b.c, (b.k || []).map(item => item.t)]) }
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
      const config = streakConfig();
      const rest = restSet();
      const { current, best } = computeStreaks({ blocksAt, today: now, earliestKey: keys[0] || null, config, rest });
      const key = toDateKey(now);
      return {
        current,
        best,
        goal: config.goal,
        week: weekStrip({ blocksAt, today: now, config, rest }),
        today: dayProgress(load(key), config.goal),
        restToday: rest.has(key),
        countsToday: config.days.includes(now.getDay())
      };
    },

    /* Ajustes de racha (se sincronizan con el perfil) */
    getStreakConfig: () => streakConfig(),
    setStreakConfig(raw) {
      const next = normalizeStreakConfig(raw);
      const before = streakConfig();
      if (next.goal === before.goal && next.days.join() === before.days.join()) return { ok: true, changed: false };
      const profile0 = { ...loadProfile() };
      if (isDefaultStreak(next)) delete profile0.streak;
      else profile0.streak = next;
      commitProfile(profile0);
      return { ok: true, changed: true, config: next };
    },

    /* Días de descanso: no suman ni rompen la racha. Solo hoy y días futuros (el pasado no se reescribe). */
    listRestDays: () => loadProfile().rest || [],
    isRestDay: key => (loadProfile().rest || []).includes(key),
    setRestDay(key, on) {
      assertDateKey(key);
      if (key < todayKey()) return { ok: false, error: 'Solo puedes cambiar hoy o días que aún no han llegado.' };
      if (key > toDateKey(addDays(clock(), 365))) return { ok: false, error: 'Ese día queda demasiado lejos.' };
      const current = loadProfile().rest || [];
      if (current.includes(key) === Boolean(on)) return { ok: true, changed: false };
      const cutoff = toDateKey(addDays(clock(), -STREAK_RULES.maxLookbackDays));
      const list = on ? [...current.filter(k => k >= cutoff), key].sort() : current.filter(k => k !== key);
      if (list.length > LIMITS.restDays) return { ok: false, error: 'Tienes demasiados días de descanso marcados.' };
      const profile0 = { ...loadProfile() };
      if (list.length) profile0.rest = list;
      else delete profile0.rest;
      commitProfile(profile0);
      return { ok: true, changed: true, undo: () => api.setRestDay(key, !on) };
    },

    /* Categorías con nombre y color propios (se sincronizan con el perfil) */
    getCategories: () => loadProfile().cats || {},
    setCategory(key, patch = {}) {
      if (!CATEGORIES.some(c => c.key === key)) return { ok: false };
      const current = loadProfile().cats || {};
      const entry = { ...(current[key] || {}) };
      if ('label' in patch) entry.l = patch.label;
      if ('color' in patch) entry.c = patch.color;
      const cats = sanitizeCategories({ ...current, [key]: entry });
      const next = { ...loadProfile() };
      if (Object.keys(cats).length) next.cats = cats;
      else delete next.cats;
      commitProfile(next);
      return { ok: true };
    },
    resetCategories() {
      const previous = loadProfile().cats;
      if (!previous || !Object.keys(previous).length) return { ok: true, changed: false };
      const next = { ...loadProfile() };
      delete next.cats;
      commitProfile(next);
      return { ok: true, changed: true, undo: () => commitProfile({ ...loadProfile(), cats: previous }) };
    },

    /* Insignias: se calculan con el historial; al lograrlas se guardan con su fecha */
    checkBadges(now = clock()) {
      const stats = badgeStats({ blocksAt: load, keys: storedKeys().sort(), today: now, config: streakConfig(), rest: restSet() });
      const have = loadProfile().badges || {};
      const fresh = earnedBadges(stats).filter(b => !have[b.id]);
      if (!fresh.length) return [];
      const date = toDateKey(now);
      const badges = { ...have };
      fresh.forEach(b => { badges[b.id] = date; });
      commitProfile({ ...loadProfile(), badges });
      return fresh;
    },
    listBadges(now = clock()) {
      const stats = badgeStats({ blocksAt: load, keys: storedKeys().sort(), today: now, config: streakConfig(), rest: restSet() });
      const have = loadProfile().badges || {};
      return BADGES.map(b => ({ ...b, earnedOn: have[b.id] || null, value: badgeProgress(b, stats) }));
    },
    weekSummary(now = clock()) {
      return summarizeWeek(weekDates(now).map(d => load(toDateKey(d))));
    },
    monthSummary(now = clock(), offset = 0) {
      const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return summarizeMonth({
        blocksAt: load, year: target.getFullYear(), month: target.getMonth(), config: streakConfig(), rest: restSet()
      });
    },
    nextPlannedDay: (now = clock()) => findNextPlannedDay({ blocksAt: load, from: now }),
    upcomingStarts: (from, horizonDays, limit, lead = 0) => upcomingStarts({ blocksAt: load, from, horizonDays, limit, lead }),

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
          cache.delete(key);
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
      // Datos remotos corruptos (campo que no es lista, o lista cuyo contenido no sirve): nunca vaciar lo local.
      const corrupt = ['templates', 'recurring'].some(field => (
        remote[field] != null && (!Array.isArray(remote[field]) || (remote[field].length > 0 && !clean[field].length))
      ));
      if (corrupt) return false;
      // Campos opcionales que el documento remoto no trae (lo escribió una versión anterior): se conserva lo local.
      // Las insignias solo se ganan: se unen con las locales.
      const local = loadProfile();
      const merged = sanitizeProfile({
        ...clean,
        rest: remote.rest == null ? local.rest : clean.rest,
        streak: remote.streak == null ? local.streak : clean.streak,
        cats: remote.cats == null ? local.cats : clean.cats,
        badges: unionBadges(local.badges, clean.badges)
      });
      const extraBadges = Object.keys(merged.badges || {}).length > Object.keys(clean.badges || {}).length;
      if (JSON.stringify(merged) === JSON.stringify(local)) {
        if (extraBadges) sendProfile();
        return false;
      }
      setProfile(merged);
      storage.write(STORAGE.profile, JSON.stringify(profile));
      emit({ type: 'profile', origin: 'remote' });
      if (extraBadges) sendProfile();
      return true;
    },

    /** Primera lectura completa del perfil: sube lo pendiente o lo que solo existe en este dispositivo. */
    reconcileProfile(remoteExists) {
      const local = loadProfile();
      if (isProfileDirty() || (!remoteExists && profileHasData(local))) sendProfile();
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
      virtualCache.clear();
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
      if (profileHasData(loadProfile())) data[STORAGE.profile] = JSON.stringify(loadProfile());
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
      if (imported) {
        const current = loadProfile();
        commitProfile(sanitizeProfile({
          templates: mergeTemplates(current.templates, imported.templates),
          recurring: mergeRules(current.recurring, imported.recurring),
          rest: Array.from(new Set([...(current.rest || []), ...(imported.rest || [])])),
          streak: current.streak || imported.streak,
          cats: { ...imported.cats, ...current.cats },
          badges: unionBadges(current.badges, imported.badges)
        }), 'import');
      }
      emit({ type: 'days', keys: days.map(([key]) => key), origin: 'import' });
      return { days: days.length, templates: imported ? imported.templates.length : 0, recurring: imported ? imported.recurring.length : 0 };
    }
  };

  return api;
}
