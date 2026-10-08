/**
 * ui-components.js — Capa de presentación: funciones que devuelven HTML (vistas) y componentes
 * con comportamiento (toast, hojas modales, deslizar para eliminar, arrastrar para ordenar).
 *
 * No conoce el estado de la app ni Firebase: recibe datos ya calculados y devuelve cadenas o
 * llama a las funciones que le pasan. Todo texto de usuario se escapa con escapeHtml.
 */
import { t } from './i18n.js';
import { ACCENTS, CATEGORIES, CATEGORY_COLORS, DAY_LETTERS, DAY_NAMES, DEFAULT_CATEGORY_COLOR, THEMES } from './config.js';
import {
  addDays, escapeHtml, formatDuration, formatLongDate, formatShortDate, formatTotal, pad, parseDateKey, plural, toDateKey, toHHMM
} from './utils.js';

export const $ = id => document.getElementById(id);

/** Nombres propios de las categorías (los define el usuario; si falta uno se usa el original). */
let categoryNames = {};
export const setCategoryNames = map => { categoryNames = { ...map }; };
/** Nombres de las etiquetas (id → nombre), los pone la app desde el perfil. */
let tagNames = {};
export const setTagNames = map => { tagNames = { ...map }; };
export const tagLabel = id => tagNames[id] || '';

export const categoryName = key => categoryNames[key] || (CATEGORIES.find(c => c.key === key) || {}).label || key;

const CATEGORY_BY_KEY = Object.freeze(Object.fromEntries(CATEGORIES.map(c => [c.key, c])));

/* ═══════════════ Iconos (trazo con currentColor, se colorean desde CSS) ═══════════════ */
export const ICONS = Object.freeze({
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/></svg>',
  cap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11.2v4.3c0 1.3 2.5 2.7 5.5 2.7s5.5-1.4 5.5-2.7v-4.3"/></svg>',
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.5 3.3 3.6 4.9 3.6 8.7a3.6 3.6 0 0 1-7.2 0c0-1.3.4-2.2 1-3C7.7 9.2 6 11.4 6 14a6 6 0 0 0 12 0c0-5-4.5-7.4-6-11.5z"/></svg>',
  check: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.6 2.6L10 3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grip: '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 5.5h12M3 9h12M3 12.5h12" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-2a4 4 0 0 1 4-4h12"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 12.5v2a4 4 0 0 1-4 4H4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6L8.5 12l6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
});

/* ═══════════════ Vistas ═══════════════ */

const relativeWeek = offset => {
  if (offset === 0) return 'Esta semana';
  if (offset === -1) return 'Semana pasada';
  if (offset === 1) return 'Próxima semana';
  return offset < 0 ? `Hace ${-offset} semanas` : `Dentro de ${offset} semanas`;
};

/** Cabecera de la semana: flechas, rango de fechas y atajo "Hoy" cuando no se está en la semana actual. */
export function weekNavMarkup({ dates, offset, canPrev, canNext }) {
  return `<button class="wk-btn" id="wkPrev" aria-label="Semana anterior"${canPrev ? '' : ' disabled'}>${ICONS.left}</button>` +
    `<div class="wk-title"><b>${formatShortDate(dates[0])} – ${formatShortDate(dates[6])}</b><small>${relativeWeek(offset)}</small></div>` +
    (offset !== 0 ? '<button class="pill wk-today" id="wkToday">Hoy</button>' : '') +
    `<button class="wk-btn" id="wkNext" aria-label="Semana siguiente"${canNext ? '' : ' disabled'}>${ICONS.right}</button>`;
}

/** Tira de días (lunes → domingo). `dates` = weekDates(hoy). */
export function dayStripMarkup({ dates, today, selectedDow }) {
  return dates.map(date => {
    const dow = date.getDay();
    const isToday = toDateKey(date) === toDateKey(today);
    const cls = `day${isToday ? ' today' : ''}${dow === selectedDow ? ' sel' : ''}`;
    return `<button class="${cls}" data-dow="${dow}" aria-label="${DAY_NAMES[dow]} ${date.getDate()}" aria-pressed="${dow === selectedDow}">` +
      `<span class="l">${DAY_LETTERS[dow]}</span><span class="n">${date.getDate()}</span><span class="dot"></span></button>`;
  }).join('');
}

/* ── Hero ── */

const nextDayLine = nextDay => (nextDay
  ? `<p class="next">${t('Próxima actividad: {0} a las {1}.', `<b>${DAY_NAMES[nextDay.date.getDay()].toLowerCase()}</b>`, `<b>${toHHMM(nextDay.first)}</b>`)}</p>`
  : '');

const HERO_BODY = {
  empty: ({ welcome, nextDay }) => (welcome
    ? '<p class="now-title">Bienvenido a Mi horario</p><p class="now-sub">Crea tu primer día con un toque.</p>'
    : `<p class="now-title">Tu día está en blanco</p><p class="now-sub">Elige un punto de partida y ajústalo a tu gusto.</p>${nextDayLine(nextDay)}`),
  current: ({ status, nowMin }) => {
    const { block, next, progress } = status;
    const pct = Math.min(100, Math.max(0, progress * 100));
    return `<p class="now-title" translate="no">${escapeHtml(block.t)}</p>` +
      `<p class="now-sub">${toHHMM(block.s)} – ${toHHMM(block.e)}, quedan ${formatDuration(block.e - nowMin)}</p>` +
      `<div class="bar" role="progressbar" aria-label="Progreso de la actividad" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct.toFixed(1)}%"></i></div>` +
      (next ? `<p class="next">${t('Después: {0} a las {1}.', `<b translate="no">${escapeHtml(next.t)}</b>`, toHHMM(next.s))}</p>` : '<p class="next">Es la última actividad de hoy.</p>');
  },
  upcoming: ({ status, nowMin }) => (
    '<p class="now-title">Ahora no hay nada programado</p>' +
    `<p class="now-sub">Faltan ${formatDuration(status.block.s - nowMin)} para las ${toHHMM(status.block.s)}</p>` +
    `<p class="next">${t('Siguiente: {0}.', `<b translate="no">${escapeHtml(status.block.t)}</b>`)}</p>`),
  finished: ({ now, nextDay }) => {
    let line = '';
    if (nextDay) {
      const tomorrow = toDateKey(nextDay.date) === toDateKey(addDays(now, 1));
      const at = `<b>${toHHMM(nextDay.first)}</b>`;
      line = `<p class="next">${tomorrow ? t('Mañana empiezas a las {0}.', at) : t('{0} empiezas a las {1}.', DAY_NAMES[nextDay.date.getDay()], at)}</p>`;
    }
    return `<p class="now-title">Día completado</p><p class="now-sub">Descansa, ya no queda nada por hacer.</p>${line}`;
  }
};

/** Hero del día de hoy: reloj grande + qué toca ahora. */
export function todayHeroMarkup({ now, status, nowMin, nextDay, welcome }) {
  return `<p class="date">${formatLongDate(now)}</p>` +
    `<p class="clock">${pad(now.getHours())}:${pad(now.getMinutes())}</p>` +
    HERO_BODY[status.kind]({ now, status, nowMin, nextDay, welcome });
}

/** Hero de cualquier otro día de la semana. */
export function otherDayHeroMarkup({ date, blocks }) {
  const summary = blocks.length
    ? `${toHHMM(blocks[0].s)} – ${toHHMM(blocks[blocks.length - 1].e)}, ${plural(blocks.length, 'actividad', 'actividades')}`
    : 'Sin actividades. Elige un punto de partida más abajo.';
  return `<p class="date">${formatLongDate(date)}</p><p class="clock sm">${DAY_NAMES[date.getDay()]}</p>` +
    `<p class="now-sub flush">${summary}</p><button class="back" id="back">Volver a hoy</button>`;
}

/* ── Racha ── */

const WEEK_LABEL = Object.freeze({
  met: t('objetivo cumplido'), missed: t('objetivo no cumplido'), pending: t('en curso'), rest: t('sin actividades'), future: t('por llegar'),
  restday: t('día de descanso'), off: t('no cuenta para la racha')
});

const streakMessage = ({ current, today, goal, restToday, countsToday }) => {
  const keep = current > 0 ? t(' Tu racha de {0} sigue en pie.', plural(current, 'día', 'días')) : '';
  if (restToday) return t('Hoy es tu día de descanso.{0}', keep);
  if (!countsToday) return t('Hoy no cuenta para tu racha, según tus ajustes.{0}', keep);
  if (today.total === 0) {
    return current > 0
      ? t('Hoy no tienes actividades.{0}', keep)
      : t('Planifica tu día y completa el {0} % de las actividades para empezar una racha.', goal);
  }
  if (today.met) return t('Objetivo de hoy cumplido: {0} de {1}.', today.done, today.total);
  const target = current > 0 ? t('llegar a {0} de racha', plural(current + 1, 'día', 'días')) : t('empezar tu racha');
  return t('Hoy llevas {0} de {1}. Completa {2} para {3}.', today.done, today.total, plural(today.remaining, 'actividad más', 'actividades más'), target);
};

/** Tarjeta de racha: días seguidos que cumplen la meta, semana actual y progreso de hoy. */
export function streakMarkup(view) {
  const { current, best, week, today, goal } = view;
  const dots = week.map(d => (
    `<li class="wk wk-${d.status}${d.isToday ? ' wk-today' : ''}" aria-label="${DAY_NAMES[d.dow]}: ${WEEK_LABEL[d.status]}">` +
    `<span class="wk-dot">${d.status === 'met' ? ICONS.check : d.status === 'restday' ? ICONS.moon : ''}</span><span class="wk-l">${DAY_LETTERS[d.dow]}</span></li>`
  )).join('');
  const pct = today.total ? Math.round((today.done / today.total) * 100) : 0;
  const bar = today.total && !view.restToday && view.countsToday
    ? `<div class="streak-bar${today.met ? ' met' : ''}" role="progressbar" aria-label="Actividades de hoy completadas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i><span class="goal" style="left:${goal}%" aria-hidden="true"></span></div>`
    : '';
  return `<div class="streak-top">` +
    `<div class="streak-count${current > 0 ? ' lit' : ''}">${ICONS.flame}<b>${current}</b><span>${current === 1 ? t('día de racha') : t('días de racha')}</span></div>` +
    `<ol class="streak-week" aria-label="Esta semana">${dots}</ol></div>` +
    `<p class="streak-msg">${streakMessage(view)}</p>${bar}` +
    `<div class="streak-foot">${best > 0 ? `<p class="streak-best">${t('Mejor racha: {0}', plural(best, 'día', 'días'))}</p>` : '<span></span>'}` +
    `<button type="button" class="link" id="openBadges">Insignias</button></div>`;
}

/** Hoja de insignias: las logradas con su fecha y las pendientes con su avance. */
export function badgesMarkup(list) {
  const earned = list.filter(b => b.earnedOn).length;
  const head = `<p class="set-s menu-sub">${t('{0} de {1} conseguidas', earned, list.length)}</p>`;
  return head + '<ul class="badge-grid">' + list.map(b => {
    const got = Boolean(b.earnedOn);
    const date = got ? t('Conseguida el {0}', formatShortDate(parseDateKey(b.earnedOn))) : t('{0} de {1}', b.value, b.target);
    const bar = got ? '' : `<span class="track"><i style="width:${(b.value / b.target * 100).toFixed(0)}%"></i></span>`;
    return `<li class="badge${got ? ' got' : ''}"><span class="badge-ic">${ICONS[b.icon] || ICONS.star}</span>` +
      `<span class="badge-tx"><b>${escapeHtml(b.title)}</b><small>${escapeHtml(b.desc)}</small>` +
      `<em>${date}</em>${bar}</span></li>`;
  }).join('') + '</ul>';
}

/* ── Lista ── */

const presetCardMarkup = p => (
  `<button class="preset" data-preset="${escapeHtml(p.id)}">` +
  `<span class="preset-ic">${ICONS[p.icon] || ICONS.plus}</span>` +
  `<span class="preset-tx"><b>${escapeHtml(p.title)}</b><small>${plural(p.count, 'actividad', 'actividades')} · ${p.from}–${p.to}</small></span></button>`
);

/** Onboarding: un día sin actividades ofrece plantillas de un solo toque. */
export function onboardingMarkup({ presets, welcome }) {
  return '<li class="onboard">' +
    `<p class="onboard-t">${welcome ? t('Empieza con un punto de partida') : t('Elige un punto de partida')}</p>` +
    '<p class="onboard-s">Un toque añade las actividades. Después puedes cambiar horas y nombres, o crear las tuyas con Añadir.</p>' +
    `<div class="preset-list">${presets.map(presetCardMarkup).join('')}</div></li>`;
}

/** Atajos bajo la lista cuando el día ya tiene actividades. */
export function quickAddMarkup(presets) {
  if (!presets.length) return '';
  return '<span class="quick-l">Añadir rápido</span>' + presets.map(p => (
    `<button class="chip-add" data-preset="${escapeHtml(p.id)}">${ICONS.plus}${escapeHtml(p.label)}</button>`
  )).join('');
}

const itemMeta = b => {
  const parts = [];
  if (b.r) parts.push(`<span class="mt">${ICONS.repeat}${t('Cada semana')}</span>`);
  if (b.g && tagLabel(b.g)) parts.push(`<span class="mt tag" translate="no">#${escapeHtml(tagLabel(b.g))}</span>`);
  if (b.k && b.k.length) parts.push(`<span class="mt">${t('{0}/{1} subtareas', b.k.filter(item => item.d).length, b.k.length)}</span>`);
  return parts.length ? `<div class="meta">${parts.join('')}</div>` : '';
};

const itemMarkup = (b, { past, current, sorting }) => {
  const classes = `row${past ? ' past' : ''}${current ? ' cur' : ''}${b.d ? ' done' : ''}`;
  let note = '';
  if (b.n) note = `<div class="no" translate="no">${escapeHtml(b.n)}</div>`;
  else if (b.c === 'libre' && !sorting) note = '<div class="no ph">Toca para anotar lo que hiciste</div>';
  const trailing = sorting
    ? `<span class="gr" aria-label="Arrastrar para mover">${ICONS.grip}</span>`
    : `<button class="ck" aria-label="Marcar como hecha" aria-pressed="${b.d}"><span class="ring">${ICONS.check}</span></button>`;
  const color = (CATEGORY_BY_KEY[b.c] || CATEGORY_BY_KEY.rutina).color;
  return `<li class="item" data-id="${escapeHtml(b.id)}">` +
    '<button class="swipe-del" tabindex="-1" aria-hidden="true">Eliminar</button>' +
    `<div class="${classes}"${sorting ? '' : ' tabindex="0"'} style="--dot:${color}">` +
    `<span class="t">${toHHMM(b.s)}</span><span class="pt"><i></i></span>` +
    `<span class="tx"><div class="ti" translate="no">${escapeHtml(b.t)}</div><div class="du">${t('hasta las {0}, {1}', toHHMM(b.e), formatDuration(b.e - b.s))}</div>${itemMeta(b)}${note}</span>` +
    `${trailing}</div></li>`;
};

export function listMarkup({ blocks, isToday, nowMin, currentIndex, sorting, presets, welcome }) {
  if (!blocks.length) return onboardingMarkup({ presets: presets.filter(p => !p.used), welcome });
  return blocks.map((b, i) => itemMarkup(b, {
    past: isToday && nowMin >= b.e,
    current: isToday && i === currentIndex,
    sorting
  })).join('');
}

/* ── Copiar día y plantillas propias ── */

/** Elige los días de destino: la semana mostrada y la siguiente. El día de origen aparece desactivado. */
export function copyTargetsMarkup({ weeks, sourceKey, selected, todayKey }) {
  return weeks.map(week => (
    `<div class="copy-week"><p class="copy-wl">${escapeHtml(week.label)}</p><div class="copy-days">` +
    week.dates.map(date => {
      const key = toDateKey(date);
      const isSource = key === sourceKey;
      const on = selected.has(key);
      return `<button type="button" class="cday${on ? ' sel' : ''}${key === todayKey ? ' today' : ''}" data-key="${key}" aria-pressed="${on}"${isSource ? ' disabled' : ''}` +
        ` aria-label="${DAY_NAMES[date.getDay()]} ${date.getDate()}${isSource ? t(' (día de origen)') : ''}">` +
        `<span class="l">${DAY_LETTERS[date.getDay()]}</span><span class="n">${date.getDate()}</span></button>`;
    }).join('') + '</div></div>'
  )).join('');
}

export function templatesMarkup(templates) {
  if (!templates.length) {
    return '<p class="set-s">Aún no tienes plantillas. Organiza un día a tu gusto y guárdalo para reutilizarlo con un toque.</p>';
  }
  return '<ul class="tpl-list">' + templates.map(tpl => {
    const from = Math.min(...tpl.blocks.map(b => b.s));
    const to = Math.max(...tpl.blocks.map(b => b.e));
    return `<li class="tpl"><div class="tpl-t"><b translate="no">${escapeHtml(tpl.name)}</b>` +
      `<small>${plural(tpl.blocks.length, 'actividad', 'actividades')} · ${toHHMM(from)}–${toHHMM(to)}</small></div>` +
      `<div class="tpl-b"><button class="btn2" data-act="apply" data-id="${escapeHtml(tpl.id)}">Añadir</button>` +
      `<button class="btn2 danger" data-act="delete" data-id="${escapeHtml(tpl.id)}" aria-label="${t('Eliminar {0}', escapeHtml(tpl.name))}">Eliminar</button></div></li>`;
  }).join('') + '</ul>';
}

/* ── Subtareas y repeticiones (editor y gestor) ── */

const DOW_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 0]);   // lunes → domingo

/** Filas de subtareas del editor: casilla, texto y botón de quitar. */
export function subtasksMarkup(list) {
  return list.map((item, i) => (
    `<li class="sub-row${item.d ? ' done' : ''}" data-i="${i}">` +
    `<button type="button" class="sub-ck" aria-pressed="${item.d}" aria-label="${t('Marcar «{0}»', escapeHtml(item.t))}"><span class="ring">${ICONS.check}</span></button>` +
    `<span class="sub-t" translate="no">${escapeHtml(item.t)}</span>` +
    `<button type="button" class="sub-x" aria-label="${t('Quitar «{0}»', escapeHtml(item.t))}">×</button></li>`
  )).join('');
}

/** Selector de días de la semana para repetir. `locked` = día de la actividad (siempre incluido). */
export function weekdayChipsMarkup({ selected, locked }) {
  return DOW_ORDER.map(dow => {
    const on = selected.has(dow);
    return `<button type="button" class="chip dow${on ? ' sel' : ''}" data-dow="${dow}" aria-pressed="${on}"` +
      ` aria-label="${DAY_NAMES[dow]}"${dow === locked ? ' disabled' : ''}>${DAY_LETTERS[dow]}</button>`;
  }).join('');
}

export const weekdaysLabel = dows => DOW_ORDER.filter(d => dows.includes(d)).map(d => DAY_LETTERS[d]).join(' ');

export function repeatsMarkup(rules) {
  if (!rules.length) {
    return '<p class="set-s">No tienes actividades que se repitan. Al crear o editar una actividad, activa «Repetir cada semana».</p>';
  }
  return '<ul class="tpl-list">' + rules.map(r => (
    `<li class="tpl"><div class="tpl-t"><b translate="no">${escapeHtml(r.t)}</b>` +
    `<small>${weekdaysLabel(r.dows)} · ${toHHMM(r.s)}–${toHHMM(r.e)}</small></div>` +
    `<div class="tpl-b"><button class="btn2 danger" data-act="stop" data-id="${escapeHtml(r.id)}" aria-label="${t('Dejar de repetir {0}', escapeHtml(r.t))}">Dejar de repetir</button></div></li>`
  )).join('') + '</ul>';
}

/* ── Editor y estadísticas ── */

export const categoryChipsMarkup = () => CATEGORIES.map(c => (
  `<button type="button" class="chip" data-c="${c.key}" style="--dot:${c.color}"><i></i><span translate="no">${escapeHtml(categoryName(c.key))}</span></button>`
)).join('');

export const weekRangeLabel = dates => `${formatShortDate(dates[0])} – ${formatShortDate(dates[6])}`;

export function statsMarkup(summary, { empty = 'Sin actividades esta semana.' } = {}) {
  const rows = CATEGORIES
    .map(c => ({ ...c, planned: (summary[c.key] || {}).planned || 0, done: (summary[c.key] || {}).done || 0 }))
    .filter(r => r.planned > 0)
    .sort((a, b) => b.planned - a.planned);
  if (!rows.length) return `<p class="set-s">${escapeHtml(empty)}</p>`;
  const max = rows[0].planned;
  const total = rows.reduce((t, r) => ({ planned: t.planned + r.planned, done: t.done + r.done }), { planned: 0, done: 0 });
  return `<div class="stat-total"><b>${formatTotal(total.done)}</b>${t('hechas de {0} planificadas', formatTotal(total.planned))}</div>` +
    rows.map(r => `<div class="stat" style="--dot:${r.color}">` +
      `<div class="stat-h"><span translate="no">${escapeHtml(categoryName(r.key))}</span><span>${t('{0} de {1}', formatTotal(r.done), formatTotal(r.planned))}</span></div>` +
      `<div class="track"><i class="plan" style="width:${(r.planned / max * 100).toFixed(1)}%"></i><i style="width:${(r.done / max * 100).toFixed(1)}%"></i></div></div>`
    ).join('');
}

/** Selector de etiqueta del editor: «Sin etiqueta» y las propias. */
export const tagChipsMarkup = (tags, selected) => [{ id: '', name: t('Sin etiqueta') }, ...tags].map(tag => (
  `<button type="button" class="chip${tag.id === selected ? ' sel' : ''}" data-g="${escapeHtml(tag.id)}" aria-pressed="${tag.id === selected}">` +
  `${tag.id ? `<span translate="no">${escapeHtml(tag.name)}</span>` : escapeHtml(tag.name)}</button>`
)).join('');

/** Lista para gestionar etiquetas: nombre editable y botón de eliminar. */
export const tagManagerMarkup = tags => (tags.length
  ? '<ul class="tpl-list">' + tags.map(tag => (
    `<li class="tpl"><label class="f tag-edit"><span class="sr">${escapeHtml(t('Nombre de la etiqueta'))}</span>` +
    `<input type="text" data-tag-name="${escapeHtml(tag.id)}" maxlength="24" value="${escapeHtml(tag.name)}" autocomplete="off" translate="no"></label>` +
    `<div class="tpl-b"><button class="btn2 danger" data-act="delete-tag" data-id="${escapeHtml(tag.id)}" aria-label="${t('Eliminar {0}', escapeHtml(tag.name))}">${t('Eliminar')}</button></div></li>`
  )).join('') + '</ul>'
  : `<p class="set-s">${t('Aún no tienes etiquetas.')}</p>`);

/** Tiempo por etiqueta en Estadísticas (solo si hay alguna con actividades). */
export function tagStatsMarkup(summary, tags) {
  const rows = tags.map(tag => ({ ...tag, planned: (summary[tag.id] || {}).planned || 0, done: (summary[tag.id] || {}).done || 0 }))
    .filter(r => r.planned > 0).sort((a, b) => b.planned - a.planned);
  if (!rows.length) return '';
  const max = rows[0].planned;
  return `<div class="set-t stats-sub">${t('Por etiqueta')}</div>` + rows.map(r => (
    `<div class="stat" style="--dot:var(--accent)"><div class="stat-h"><span translate="no">#${escapeHtml(r.name)}</span>` +
    `<span>${t('{0} de {1}', formatTotal(r.done), formatTotal(r.planned))}</span></div>` +
    `<div class="track"><i class="plan" style="width:${(r.planned / max * 100).toFixed(1)}%"></i><i style="width:${(r.done / max * 100).toFixed(1)}%"></i></div></div>`
  )).join('');
}

/** Navegación entre meses de las estadísticas (mismo aspecto que la de semanas). */
export const monthNavMarkup = ({ label, canPrev, canNext, isCurrent }) => (
  `<button class="wk-btn" id="statsPrev" aria-label="Mes anterior"${canPrev ? '' : ' disabled'}>${ICONS.left}</button>` +
  `<div class="wk-title"><b>${escapeHtml(label)}</b><small>${isCurrent ? 'Este mes' : '&nbsp;'}</small></div>` +
  `<button class="wk-btn" id="statsNext" aria-label="Mes siguiente"${canNext ? '' : ' disabled'}>${ICONS.right}</button>`
);

export const monthDaysMarkup = ({ counted, met }) => (counted
  ? `<p class="set-s month-days">${t('{0} de {1} cumplieron la meta.', `<b>${met}</b>`, plural(counted, 'día con actividades', 'días con actividades'))}</p>`
  : '');

/** Aspecto: tema y color de acento. */
export const themeChipsMarkup = current => THEMES.map(th => (
  `<button type="button" class="chip${th.key === current ? ' sel' : ''}" data-theme="${th.key}" aria-pressed="${th.key === current}">${th.label}</button>`
)).join('');
export const accentSwatchesMarkup = current => ACCENTS.map(a => (
  `<button type="button" class="swatch${a.key === current ? ' sel' : ''}" data-accent="${a.key}" style="--sw:${a.swatch}" aria-pressed="${a.key === current}" aria-label="${a.label}"></button>`
)).join('');

/** Hoja de categorías: nombre editable y paleta de colores por categoría. */
export const categoriesMarkup = cats => CATEGORIES.map(c => {
  const own = cats[c.key] || {};
  const selected = own.c || DEFAULT_CATEGORY_COLOR[c.key];
  const swatches = Object.entries(CATEGORY_COLORS).map(([id, hex]) => (
    `<button type="button" class="swatch sm${id === selected ? ' sel' : ''}" data-cat="${c.key}" data-color="${id}" style="--sw:${hex}" aria-pressed="${id === selected}" aria-label="${escapeHtml(id)}"></button>`
  )).join('');
  return `<div class="cat-row"><label class="f"><span>${escapeHtml(c.label)}</span>` +
    `<input type="text" data-cat-name="${c.key}" maxlength="20" value="${escapeHtml(own.l || '')}" placeholder="${escapeHtml(c.label)}" autocomplete="off"></label>` +
    `<div class="swatches" role="group" aria-label="${t('Color de {0}', escapeHtml(c.label))}">${swatches}</div></div>`;
}).join('');

/* ═══════════════ Componentes con comportamiento ═══════════════ */

/** Aviso temporal con acción opcional ("Deshacer"). */
export function createToast(root) {
  const message = root.querySelector('#toastMsg');
  const action = root.querySelector('#toastAct');
  let timer = null;
  let onAction = null;
  const hide = () => { clearTimeout(timer); root.classList.remove('show'); onAction = null; };
  action.addEventListener('click', () => { const fn = onAction; hide(); if (fn) fn(); });
  return {
    show(text, options = {}) {
      clearTimeout(timer);
      message.textContent = text;
      action.hidden = !options.label;
      action.textContent = options.label || '';
      onAction = options.onAction || null;
      root.classList.add('show');
      timer = setTimeout(hide, options.duration || 5000);
    },
    hide
  };
}

/**
 * Hojas modales inferiores. Mientras hay una abierta, el resto de la app queda inerte
 * (sin foco ni lectura por lector de pantalla) y el foco vuelve al botón que la abrió.
 */
export function createSheetManager({ overlay, inert = [] }) {
  let active = null;
  let opener = null;

  const fit = () => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    active.style.bottom = `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`;
    active.style.maxHeight = `${Math.floor(vv.height * 0.94)}px`;
  };

  const close = () => {
    if (!active) return;
    active.classList.remove('open');
    active.style.bottom = '';
    overlay.classList.remove('open');
    document.body.classList.remove('lock');
    inert.forEach(el => { el.inert = false; });
    active = null;
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    opener = null;
  };

  const open = el => {
    if (active && active !== el) close();
    opener = document.activeElement;
    active = el;
    el.scrollTop = 0;
    el.setAttribute('tabindex', '-1');
    el.classList.add('open');
    overlay.classList.add('open');
    document.body.classList.add('lock');
    inert.forEach(target => { target.inert = true; });
    fit();
    el.focus({ preventScroll: true });
  };

  overlay.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fit);
    window.visualViewport.addEventListener('scroll', fit);
  }

  return {
    register: el => ({ open: () => open(el), close: () => { if (active === el) close(); } }),
    closeActive: close,
    isOpen: () => active !== null
  };
}

/**
 * Deslizar a la izquierda para revelar "Eliminar" (Pointer Events: táctil, lápiz y ratón).
 * `isBusy()` indica si hay un gesto en curso o una fila abierta: la app no debe repintar la lista entonces.
 */
export function attachSwipeToDelete(list, { isEnabled, onDelete }) {
  const REVEAL = 88;
  const OPEN_AT = 44;
  const AXIS_LOCK = 8;
  const MAX_PULL = REVEAL * 1.25;
  let gesture = null;
  let openItem = null;
  let lastSwipeAt = 0;

  const moveRow = (row, x, animate) => {
    row.classList.toggle('swiping', !animate);
    row.style.transform = x ? `translateX(${x}px)` : '';
    row.closest('.item').classList.toggle('peek', x !== 0);
  };
  const currentOpen = () => {
    if (openItem && !openItem.item.isConnected) openItem = null; // la lista se repintó
    return openItem;
  };
  const closeOpen = () => {
    const open = currentOpen();
    if (open) { moveRow(open.row, 0, true); openItem = null; }
  };

  list.addEventListener('pointerdown', e => {
    if (!isEnabled() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = e.target.closest('.item');
    if (!item || e.target.closest('.swipe-del')) return;
    const open = currentOpen();
    if (open && open.item !== item) closeOpen();
    gesture = {
      id: e.pointerId, item, row: item.querySelector('.row'),
      x0: e.clientX, y0: e.clientY, axis: null, x: 0,
      base: open && open.item === item ? -REVEAL : 0
    };
  });

  list.addEventListener('pointermove', e => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x0;
    const dy = e.clientY - gesture.y0;
    if (!gesture.axis) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (gesture.axis === 'x') { try { list.setPointerCapture(e.pointerId); } catch (_) { /* nada */ } }
    }
    if (gesture.axis !== 'x') return;
    gesture.x = Math.max(-MAX_PULL, Math.min(0, gesture.base + dx));
    moveRow(gesture.row, gesture.x, false);
  });

  const endGesture = e => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    if (g.axis !== 'x') return;
    lastSwipeAt = Date.now();
    if (g.x < -OPEN_AT) {
      moveRow(g.row, -REVEAL, true);
      openItem = { item: g.item, row: g.row };
    } else {
      moveRow(g.row, 0, true);
      if (openItem && openItem.item === g.item) openItem = null;
    }
  };
  list.addEventListener('pointerup', endGesture);
  list.addEventListener('pointercancel', endGesture);

  // Fase de captura: tras deslizar, o con una fila abierta, el toque no debe activar la fila.
  list.addEventListener('click', e => {
    const deleteButton = e.target.closest('.swipe-del');
    if (deleteButton) {
      openItem = null;
      onDelete(deleteButton.closest('.item').dataset.id);
      return;
    }
    const justSwiped = Date.now() - lastSwipeAt < 300;
    if (justSwiped || currentOpen()) {
      e.stopPropagation();
      e.preventDefault();
      if (!justSwiped) closeOpen();
    }
  }, true);

  return { closeOpen, isBusy: () => gesture !== null || currentOpen() !== null };
}

/** Arrastrar con el icono de la derecha (modo Ordenar). */
export function attachDragSort(list, { isEnabled, onReorder }) {
  let drag = null;

  const step = () => {
    if (!drag) return;
    const others = Array.from(list.querySelectorAll('.item')).filter(el => el !== drag.item);
    const before = others.find(el => {
      const box = el.getBoundingClientRect();
      return drag.y < box.top + box.height / 2;
    });
    if (before) { if (drag.item.nextElementSibling !== before) list.insertBefore(drag.item, before); }
    else if (list.lastElementChild !== drag.item) list.appendChild(drag.item);
    if (drag.y < 90) window.scrollBy(0, -12);
    else if (drag.y > window.innerHeight - 90) window.scrollBy(0, 12);
  };

  // Mover el nodo en el DOM libera la captura del puntero, así que el seguimiento y el final
  // del gesto se escuchan en window: si no, soltar fuera de la lista dejaría el arrastre colgado.
  const onMove = e => { if (drag && e.pointerId === drag.pointerId) { e.preventDefault(); drag.y = e.clientY; } };
  const onEnd = e => { if (drag && e.pointerId === drag.pointerId) finish(); };

  const finish = () => {
    if (!drag) return;
    clearInterval(drag.timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    drag.item.classList.remove('lift');
    const ids = Array.from(list.querySelectorAll('.item')).map(el => el.dataset.id);
    drag = null;
    onReorder(ids);
  };

  list.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.gr');
    if (!handle || !isEnabled() || drag) return;
    e.preventDefault();
    const item = handle.closest('.item');
    item.classList.add('lift');
    drag = { item, y: e.clientY, pointerId: e.pointerId, timer: setInterval(step, 40) };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  });

  return { isActive: () => drag !== null };
}
