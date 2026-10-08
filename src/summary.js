/**
 * summary.js — Texto del resumen semanal para compartir. Solo lleva totales por categoría y la racha:
 * nunca los títulos de las actividades ni las notas.
 */
import { formatTotal } from './utils.js';

/**
 * @param {object} p
 * @param {Record<string,{planned:number,done:number}>} p.summary minutos por categoría
 * @param {string} p.range           texto del rango de fechas, p. ej. "5 – 11 oct"
 * @param {number} p.streak          racha actual (días)
 * @param {Array<{key:string}>} p.categories categorías en orden
 * @param {(key:string)=>string} p.nameOf nombre visible de la categoría
 * @returns {string}
 */
export function buildShareText({ summary, range, streak = 0, categories, nameOf }) {
  const rows = categories
    .map(c => ({ key: c.key, planned: (summary[c.key] || {}).planned || 0, done: (summary[c.key] || {}).done || 0 }))
    .filter(r => r.planned > 0)
    .sort((a, b) => b.planned - a.planned);
  const total = rows.reduce((t, r) => ({ planned: t.planned + r.planned, done: t.done + r.done }), { planned: 0, done: 0 });
  const lines = [`Mi semana (${range})`];
  if (!rows.length) {
    lines.push('Sin actividades esta semana.');
  } else {
    const pct = total.planned ? Math.round((total.done / total.planned) * 100) : 0;
    lines.push(`Hecho: ${formatTotal(total.done)} de ${formatTotal(total.planned)} (${pct} %)`);
    rows.forEach(r => lines.push(`• ${nameOf(r.key)}: ${formatTotal(r.done)} de ${formatTotal(r.planned)}`));
  }
  if (streak > 0) lines.push(`Racha: ${streak} ${streak === 1 ? 'día' : 'días'} 🔥`);
  return lines.join('\n');
}

/**
 * ¿Toca mostrar el resumen de la semana pasada? Solo si el usuario lo activó, aún no se mostró esta semana
 * y la semana anterior tuvo actividades. `seen` es la fecha del lunes de la semana en que se mostró (o se activó).
 */
export function weeklyDue({ enabled, seen, thisMonday, hadActivities }) {
  return Boolean(enabled && hadActivities && seen !== thisMonday);
}
