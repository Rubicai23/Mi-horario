/**
 * ui-components.js — Capa de presentación: funciones que devuelven HTML (vistas) y componentes
 * con comportamiento (toast, hojas modales, deslizar para eliminar, arrastrar para ordenar).
 *
 * No conoce el estado de la app ni Firebase: recibe datos ya calculados y devuelve cadenas o
 * llama a las funciones que le pasan. Todo texto de usuario se escapa con escapeHtml.
 */
import { CATEGORIES, DAY_LETTERS, DAY_NAMES } from './config.js';
import {
  addDays, escapeHtml, formatDuration, formatLongDate, formatShortDate, formatTotal, pad, plural, toDateKey, toHHMM
} from './utils.js';

export const $ = id => document.getElementById(id);

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
  ? `<p class="next">Próxima actividad: <b>${DAY_NAMES[nextDay.date.getDay()].toLowerCase()}</b> a las <b>${toHHMM(nextDay.first)}</b>.</p>`
  : '');

const HERO_BODY = {
  empty: ({ welcome, nextDay }) => (welcome
    ? '<p class="now-title">Bienvenido a Mi horario</p><p class="now-sub">Crea tu primer día con un toque.</p>'
    : `<p class="now-title">Tu día está en blanco</p><p class="now-sub">Elige un punto de partida y ajústalo a tu gusto.</p>${nextDayLine(nextDay)}`),
  current: ({ status, nowMin }) => {
    const { block, next, progress } = status;
    const pct = Math.min(100, Math.max(0, progress * 100));
    return `<p class="now-title">${escapeHtml(block.t)}</p>` +
      `<p class="now-sub">${toHHMM(block.s)} – ${toHHMM(block.e)}, quedan ${formatDuration(block.e - nowMin)}</p>` +
      `<div class="bar" role="progressbar" aria-label="Progreso de la actividad" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct.toFixed(1)}%"></i></div>` +
      (next ? `<p class="next">Después: <b>${escapeHtml(next.t)}</b> a las ${toHHMM(next.s)}.</p>` : '<p class="next">Es la última actividad de hoy.</p>');
  },
  upcoming: ({ status, nowMin }) => (
    '<p class="now-title">Ahora no hay nada programado</p>' +
    `<p class="now-sub">Faltan ${formatDuration(status.block.s - nowMin)} para las ${toHHMM(status.block.s)}</p>` +
    `<p class="next">Siguiente: <b>${escapeHtml(status.block.t)}</b>.</p>`),
  finished: ({ now, nextDay }) => {
    let line = '';
    if (nextDay) {
      const tomorrow = toDateKey(nextDay.date) === toDateKey(addDays(now, 1));
      line = `<p class="next">${tomorrow ? 'Mañana' : DAY_NAMES[nextDay.date.getDay()]} empiezas a las <b>${toHHMM(nextDay.first)}</b>.</p>`;
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
  met: 'objetivo cumplido', missed: 'objetivo no cumplido', pending: 'en curso', rest: 'sin actividades', future: 'por llegar'
});

const streakMessage = ({ current, today }) => {
  if (today.total === 0) {
    return current > 0
      ? `Hoy no tienes actividades. Tu racha de ${plural(current, 'día', 'días')} sigue en pie.`
      : 'Planifica tu día y completa el 80 % de las actividades para empezar una racha.';
  }
  if (today.met) return `Objetivo de hoy cumplido: ${today.done} de ${today.total}.`;
  const goal = current > 0 ? `llegar a ${plural(current + 1, 'día', 'días')} de racha` : 'empezar tu racha';
  return `Hoy llevas ${today.done} de ${today.total}. Completa ${plural(today.remaining, 'actividad más', 'actividades más')} para ${goal}.`;
};

/** Tarjeta de racha: días seguidos con ≥ 80 % completado, semana actual y progreso de hoy. */
export function streakMarkup(view) {
  const { current, best, week, today } = view;
  const dots = week.map(d => (
    `<li class="wk wk-${d.status}${d.isToday ? ' wk-today' : ''}" aria-label="${DAY_NAMES[d.dow]}: ${WEEK_LABEL[d.status]}">` +
    `<span class="wk-dot">${d.status === 'met' ? ICONS.check : ''}</span><span class="wk-l">${DAY_LETTERS[d.dow]}</span></li>`
  )).join('');
  const pct = today.total ? Math.round((today.done / today.total) * 100) : 0;
  const bar = today.total
    ? `<div class="streak-bar${today.met ? ' met' : ''}" role="progressbar" aria-label="Actividades de hoy completadas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i><span class="goal" aria-hidden="true"></span></div>`
    : '';
  return `<div class="streak-top">` +
    `<div class="streak-count${current > 0 ? ' lit' : ''}">${ICONS.flame}<b>${current}</b><span>${current === 1 ? 'día' : 'días'} de racha</span></div>` +
    `<ol class="streak-week" aria-label="Esta semana">${dots}</ol></div>` +
    `<p class="streak-msg">${streakMessage(view)}</p>${bar}` +
    (best > 0 ? `<p class="streak-best">Mejor racha: ${plural(best, 'día', 'días')}</p>` : '');
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
    `<p class="onboard-t">${welcome ? 'Empieza con un punto de partida' : 'Elige un punto de partida'}</p>` +
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

const itemMarkup = (b, { past, current, sorting }) => {
  const classes = `row${past ? ' past' : ''}${current ? ' cur' : ''}${b.d ? ' done' : ''}`;
  let note = '';
  if (b.n) note = `<div class="no">${escapeHtml(b.n)}</div>`;
  else if (b.c === 'libre' && !sorting) note = '<div class="no ph">Toca para anotar lo que hiciste</div>';
  const trailing = sorting
    ? `<span class="gr" aria-label="Arrastrar para mover">${ICONS.grip}</span>`
    : `<button class="ck" aria-label="Marcar como hecha" aria-pressed="${b.d}"><span class="ring">${ICONS.check}</span></button>`;
  const color = (CATEGORY_BY_KEY[b.c] || CATEGORY_BY_KEY.rutina).color;
  return `<li class="item" data-id="${escapeHtml(b.id)}">` +
    '<button class="swipe-del" tabindex="-1" aria-hidden="true">Eliminar</button>' +
    `<div class="${classes}"${sorting ? '' : ' tabindex="0"'} style="--dot:${color}">` +
    `<span class="t">${toHHMM(b.s)}</span><span class="pt"><i></i></span>` +
    `<span class="tx"><div class="ti">${escapeHtml(b.t)}</div><div class="du">hasta las ${toHHMM(b.e)}, ${formatDuration(b.e - b.s)}</div>${note}</span>` +
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
        ` aria-label="${DAY_NAMES[date.getDay()]} ${date.getDate()}${isSource ? ' (día de origen)' : ''}">` +
        `<span class="l">${DAY_LETTERS[date.getDay()]}</span><span class="n">${date.getDate()}</span></button>`;
    }).join('') + '</div></div>'
  )).join('');
}

export function templatesMarkup(templates) {
  if (!templates.length) {
    return '<p class="set-s">Aún no tienes plantillas. Organiza un día a tu gusto y guárdalo para reutilizarlo con un toque.</p>';
  }
  return '<ul class="tpl-list">' + templates.map(t => {
    const from = Math.min(...t.blocks.map(b => b.s));
    const to = Math.max(...t.blocks.map(b => b.e));
    return `<li class="tpl"><div class="tpl-t"><b>${escapeHtml(t.name)}</b>` +
      `<small>${plural(t.blocks.length, 'actividad', 'actividades')} · ${toHHMM(from)}–${toHHMM(to)}</small></div>` +
      `<div class="tpl-b"><button class="btn2" data-act="apply" data-id="${escapeHtml(t.id)}">Añadir</button>` +
      `<button class="btn2 danger" data-act="delete" data-id="${escapeHtml(t.id)}" aria-label="Eliminar ${escapeHtml(t.name)}">Eliminar</button></div></li>`;
  }).join('') + '</ul>';
}

/* ── Editor y estadísticas ── */

export const categoryChipsMarkup = () => CATEGORIES.map(c => (
  `<button type="button" class="chip" data-c="${c.key}" style="--dot:${c.color}"><i></i>${c.label}</button>`
)).join('');

export const weekRangeLabel = dates => `${formatShortDate(dates[0])} – ${formatShortDate(dates[6])}`;

export function statsMarkup(summary) {
  const rows = CATEGORIES
    .map(c => ({ ...c, planned: (summary[c.key] || {}).planned || 0, done: (summary[c.key] || {}).done || 0 }))
    .filter(r => r.planned > 0)
    .sort((a, b) => b.planned - a.planned);
  if (!rows.length) return '<p class="set-s">Sin actividades esta semana.</p>';
  const max = rows[0].planned;
  const total = rows.reduce((t, r) => ({ planned: t.planned + r.planned, done: t.done + r.done }), { planned: 0, done: 0 });
  return `<div class="stat-total"><b>${formatTotal(total.done)}</b>hechas de ${formatTotal(total.planned)} planificadas</div>` +
    rows.map(r => `<div class="stat" style="--dot:${r.color}">` +
      `<div class="stat-h"><span>${r.label}</span><span>${formatTotal(r.done)} de ${formatTotal(r.planned)}</span></div>` +
      `<div class="track"><i class="plan" style="width:${(r.planned / max * 100).toFixed(1)}%"></i><i style="width:${(r.done / max * 100).toFixed(1)}%"></i></div></div>`
    ).join('');
}

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
