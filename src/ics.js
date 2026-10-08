/**
 * ics.js — Exporta actividades a un archivo de calendario (.ics, formato iCalendar RFC 5545).
 * Función pura: recibe los días ya calculados y devuelve el texto. Las horas son "flotantes" (sin zona):
 * cada calendario las interpreta en la zona horaria del dispositivo, que es lo que una agenda personal necesita.
 */
import { pad } from './utils.js';

const CRLF = '\r\n';

/** Escapa un texto de valor (RFC 5545 §3.3.11). */
export const escapeText = text => String(text)
  .replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Dobla las líneas a 75 octetos UTF-8 como máximo, sin partir caracteres (la continuación empieza con un espacio). */
export function foldLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    if (size + bytes > limit) { parts.push(current); current = ''; size = 0; limit = 74; }
    current += ch;
    size += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

const stamp = date => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
const local = (key, minutes) => `${key.replace(/-/g, '')}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;

/**
 * @param {object} p
 * @param {Array<{key:string, blocks:Array}>} p.days     días (AAAA-MM-DD) con sus actividades
 * @param {Date} p.now                                   para DTSTAMP
 * @param {number|null} [p.alarm]                        minutos de antelación del aviso (null = sin aviso)
 * @param {(key:string)=>string} [p.categoryName]
 * @param {(id:string)=>string} [p.tagName]              nombre de la etiqueta de una actividad (si tiene)
 * @param {string} [p.calendarName]
 * @returns {string} texto .ics (líneas separadas por CRLF)
 */
export function buildIcs({ days, now, alarm = null, categoryName = k => k, tagName = () => '', calendarName = 'Mi horario' }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mi horario//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`
  ];
  days.forEach(({ key, blocks }) => {
    blocks.forEach(block => {
      const details = [];
      if (block.n) details.push(block.n);
      if (block.k && block.k.length) details.push(block.k.map(item => `${item.d ? '[x]' : '[ ]'} ${item.t}`).join('\n'));
      const tag = block.g ? tagName(block.g) : '';
      const categories = [categoryName(block.c), tag].filter(Boolean).map(escapeText).join(',');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${block.id}-${key.replace(/-/g, '')}@mi-horario`,
        `DTSTAMP:${stamp(now)}`,
        `DTSTART:${local(key, block.s)}`,
        `DTEND:${local(key, block.e)}`,
        `SUMMARY:${escapeText(block.t)}`
      );
      if (details.length) lines.push(`DESCRIPTION:${escapeText(details.join('\n'))}`);
      if (categories) lines.push(`CATEGORIES:${categories}`);
      if (alarm !== null && alarm >= 0) {
        lines.push(
          'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(block.t)}`,
          alarm === 0 ? 'TRIGGER:PT0S' : `TRIGGER:-PT${alarm}M`, 'END:VALARM'
        );
      }
      lines.push('END:VEVENT');
    });
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}
