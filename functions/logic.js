'use strict';
/** Lógica pura (sin Firebase) para decidir qué avisos enviar ahora. Se prueba con `node --test`. */

const GRACE_MS = 10 * 60 * 1000; // un aviso que lleva más de 10 min vencido ya no tiene sentido

/**
 * @param {Array<{at:number,t:string,b:string}>} items avisos guardados por la app
 * @param {number} now ms
 * @returns {{ due: Array, keep: Array, nextAt: number }}
 */
function splitDue(items, now) {
  const list = Array.isArray(items) ? items.filter(i => i && typeof i.at === 'number') : [];
  const due = list.filter(i => i.at <= now && i.at > now - GRACE_MS);
  const keep = list.filter(i => i.at > now);
  return { due, keep, nextAt: keep.length ? Math.min(...keep.map(i => i.at)) : 0 };
}

module.exports = { splitDue, GRACE_MS };
