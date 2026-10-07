/**
 * i18n.js — Idioma de la app (español de fábrica, inglés opcional).
 *
 * El idioma se lee una sola vez al cargar (cfg:lang) y cambiarlo recarga la página. Los textos fuente están
 * en español y funcionan como clave del diccionario inglés (lang-en.js). Un texto con huecos {0}, {1}… sirve
 * también como patrón: así un texto ya montado ("Hace 3 semanas") se traduce sin tocar el código que lo escribe.
 * En español no se hace nada: el traductor no se activa.
 */
import { EN, EN_PLURAL } from './lang-en.js';

export const LANG_KEY = 'cfg:lang';
export const LANGS = Object.freeze(['es', 'en']);

function detect() {
  try {
    const stored = globalThis.localStorage && globalThis.localStorage.getItem(LANG_KEY);
    return stored === 'en' ? 'en' : 'es';
  } catch (_) { return 'es'; }
}

export const LANG = detect();
export const isEnglish = LANG === 'en';
/** Idioma para fechas (toLocaleDateString). */
export const LOCALE = isEnglish ? 'en-GB' : 'es-ES';

const fill = (text, args) => text.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] === undefined ? m : String(args[Number(i)])));

/** Patrones: cada clave con huecos se convierte en una expresión regular anclada. */
const PATTERNS = Object.entries(EN)
  .filter(([key]) => /\{\d+\}/.test(key) && key.replace(/\{\d+\}/g, '').trim().length >= 5)
  .map(([key, value]) => {
    const order = [];
    const source = key.split(/(\{\d+\})/).map(part => {
      const hole = /^\{(\d+)\}$/.exec(part);
      if (hole) { order.push(Number(hole[1])); return '([\\s\\S]+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return { regex: new RegExp(`^${source}$`), order, value };
  })
  .sort((a, b) => b.regex.source.length - a.regex.source.length);

/** Traduce un texto (con espacios alrededor incluidos). Devuelve el mismo texto si no hay traducción. */
export function translateText(text) {
  if (!isEnglish || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  const lead = text.slice(0, text.indexOf(trimmed));
  const tail = text.slice(lead.length + trimmed.length);
  if (Object.prototype.hasOwnProperty.call(EN, trimmed)) return lead + fill(EN[trimmed], []) + tail;
  for (const { regex, order, value } of PATTERNS) {
    const m = regex.exec(trimmed);
    if (!m) continue;
    const args = [];
    order.forEach((n, i) => { args[n] = m[i + 1]; });
    return lead + fill(value, args) + tail;
  }
  return text;
}

/** Texto de la interfaz con huecos: t('Hola {0}', nombre). */
export function t(source, ...args) {
  if (!isEnglish) return fill(source, args);
  const known = Object.prototype.hasOwnProperty.call(EN, source) ? EN[source] : source;
  return fill(known, args);
}

/** Palabras para `plural(n, uno, varios)`: en inglés se buscan por la forma en singular en español. */
export function pluralWords(one, many) {
  if (!isEnglish) return [one, many];
  return EN_PLURAL[one] || [t(one), t(many)];
}

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT_VALUE']);
const written = new WeakMap();

const isUserContent = node => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return Boolean(el && el.closest('[translate="no"]'));
};

function translateNode(node) {
  if (node.nodeType === 3) {
    if (isUserContent(node) || (node.parentElement && SKIP_TAGS.has(node.parentElement.tagName))) return;
    if (written.get(node) === node.data) return;
    const next = translateText(node.data);
    if (next !== node.data) { node.data = next; }
    written.set(node, node.data);
    return;
  }
  if (node.nodeType !== 1 || node.getAttribute('translate') === 'no') return;
  if (!isUserContent(node)) {
    ATTRS.forEach(attr => {
      if (!node.hasAttribute(attr)) return;
      const value = node.getAttribute(attr);
      const next = translateText(value);
      if (next !== value) node.setAttribute(attr, next);
    });
  }
  if (!SKIP_TAGS.has(node.tagName)) node.childNodes.forEach(translateNode);
}

/** Activa la traducción de la página y de todo lo que se pinte después. No hace nada en español. */
export function startTranslator(root = document.documentElement) {
  if (!isEnglish) return;
  document.documentElement.lang = 'en';
  translateNode(root);
  new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'characterData') translateNode(record.target);
      else if (record.type === 'attributes') translateNode(record.target);
      else record.addedNodes.forEach(translateNode);
    });
  }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
