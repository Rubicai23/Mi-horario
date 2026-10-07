/**
 * utils.js — Funciones puras de apoyo (fechas, formato, texto). Sin DOM ni estado.
 * Todas las fechas se manejan en hora local del dispositivo.
 */

import { LOCALE, pluralWords, t } from './i18n.js';

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ───────── Horas (minutos desde medianoche) ───────── */
export const pad = n => String(n).padStart(2, '0');

export const toHHMM = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** "07:30" -> 450. Devuelve NaN si el texto no es una hora válida. */
export const fromHHMM = value => {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || ''));
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? h * 60 + m : NaN;
};

export const formatDuration = total => {
  const m = Math.max(0, Math.ceil(total));
  if (m < 1) return t('menos de 1 min');
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h} h ${r} min`;
  return h ? `${h} h` : `${r} min`;
};

export const formatTotal = minutes => (minutes <= 0 ? '0 h' : formatDuration(minutes));

/* ───────── Fechas ───────── */
export const toDateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** "2026-10-05" -> Date local a medianoche, o null si no es una fecha real. */
export const parseDateKey = key => {
  if (!DATE_KEY_RE.test(String(key))) return null;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
};

export const isDateKey = key => parseDateKey(key) !== null;

export const startOfDay = date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

/** Días naturales entre dos fechas (robusto frente a cambios de hora). */
export const diffDays = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / 86400000);

export const minutesOfDay = date => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

export const mondayOf = date => {
  const d = startOfDay(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

/** Lunes → domingo de la semana que contiene `date`. */
export const weekDates = date => {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
};

/** Fecha, dentro de la semana de `today`, que cae en el día de la semana `dow` (0 = domingo). */
export const dateForDow = (dow, today) => addDays(mondayOf(today), (dow + 6) % 7);

/* ───────── Texto ───────── */
export const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const plural = (n, one, many) => {
  const [singular, other] = pluralWords(one, many);
  return `${n} ${n === 1 ? singular : other}`;
};

/** "Inglés (45 min, enfoque total)" -> "Inglés" */
export const shortTitle = title => title.split(/[(:]/)[0].trim() || title;

export const formatLongDate = date => capitalize(date.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }));
export const formatShortDate = date => date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });

/* ───────── Identificadores ───────── */
export const uid = () => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `b${c.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
};

/** Hash FNV-1a de 31 bits (positivo, distinto de 0): sirve de id para notificaciones nativas. */
export const hashToInt = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h & 0x7fffffff) || 1;
};
