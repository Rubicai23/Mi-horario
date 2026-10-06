/**
 * app.js — Raíz de composición y controlador.
 *
 * Construye los servicios, los conecta con la interfaz y contiene el flujo de la aplicación.
 * No contiene reglas de negocio (state-manager.js), ni acceso a Firebase (firebase-service.js),
 * ni HTML (ui-components.js), ni detalles web/nativos (platform.js).
 */
import { FIREBASE_CONFIG, LEAD_OPTIONS, LIMITS, NOTIFICATIONS, STREAK_RULES, WEEK_RANGE } from './config.js';
import {
  createBrowserStorage, createStartWatcher, createStateManager, describeDay, findOverlaps, parseBackup
} from './state-manager.js';
import { createCloudService } from './firebase-service.js';
import {
  createInstallPrompt, createNotifier, deliverFile, isNative, platformInfo, readFileAsText, registerServiceWorker
} from './platform.js';
import * as ui from './ui-components.js';
import {
  addDays, dateForDow, formatLongDate, fromHHMM, minutesOfDay, plural, shortTitle, toDateKey, toHHMM, weekDates
} from './utils.js';

const { $ } = ui;
const vibrate = ms => { if (navigator.vibrate) navigator.vibrate(ms); };
const debounce = (fn, ms) => {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

/* ═════════════ Contexto compartido ═════════════ */

function createContext() {
  const clock = () => new Date();
  const native = isNative();
  const storage = createBrowserStorage();
  const cloud = createCloudService({ config: FIREBASE_CONFIG, native });
  const state = createStateManager({
    storage,
    clock,
    sync: {
      push: (key, blocks) => cloud.pushDay(key, blocks),
      remove: key => cloud.removeDay(key),
      pushProfile: profile => cloud.pushProfile(profile)
    }
  });
  const serviceWorker = registerServiceWorker();
  const sheets = ui.createSheetManager({ overlay: $('ov'), inert: [$('app')] });

  return {
    clock, native, cloud, state, sheets,
    notifier: createNotifier({ settings: state.settings, getRegistration: () => serviceWorker }),
    toast: ui.createToast($('toast')),
    editSheet: sheets.register($('sheetEdit')),
    settingsSheet: sheets.register($('sheetSettings')),
    statsSheet: sheets.register($('sheetStats')),
    daySheet: sheets.register($('sheetDay')),
    copySheet: sheets.register($('sheetCopy')),
    templatesSheet: sheets.register($('sheetTemplates')),
    repeatsSheet: sheets.register($('sheetRepeats')),
    badgesSheet: sheets.register($('sheetBadges')),
    view: { selectedDow: clock().getDay(), weekOffset: 0, sorting: false, dateKey: toDateKey(clock()), minuteKey: '', stale: false },
    account: { status: 'loading', email: '', uid: '' },
    analytics: 'off',       // off | on | unsupported
    migrated: false,        // ya se hizo la primera conciliación con la nube en esta sesión
    profileMigrated: false, // ídem para el perfil (plantillas propias)
    busy: () => false,      // lo sustituye setupList: true mientras hay un gesto en curso
    swipeReset: () => {},   // lo sustituye setupList: cierra la fila abierta
    render: () => {},       // lo sustituye createRenderer
    requestRender: () => {}
  };
}

/** Fecha de referencia de la semana que se está viendo (hoy ± semanas). */
const anchorOf = (ctx, now) => addDays(now, ctx.view.weekOffset * 7);
const selectedKey = (ctx, now = ctx.clock()) => toDateKey(dateForDow(ctx.view.selectedDow, anchorOf(ctx, now)));

/** Máximo de plantillas propias que se muestran como atajos (el resto, en "Más → Plantillas"). */
const limitCustom = (presets, max) => {
  let custom = 0;
  return presets.filter(p => !p.custom || ++custom <= max);
};

/* ═════════════ Render ═════════════ */

function createRenderer(ctx) {
  const { state, view } = ctx;
  let frame = 0;

  /** Repinta la lista conservando el foco del teclado si estaba dentro de ella. */
  const keepFocus = paint => {
    const active = document.activeElement;
    const item = active && active.closest ? active.closest('#tl .item') : null;
    const memo = item ? { id: item.dataset.id, selector: active.classList.contains('ck') ? '.ck' : '.row' } : null;
    paint();
    if (!memo) return;
    const target = Array.from($('tl').querySelectorAll('.item')).find(el => el.dataset.id === memo.id);
    const focusable = target && target.querySelector(memo.selector);
    if (focusable) focusable.focus({ preventScroll: true });
  };

  function render(now = ctx.clock()) {
    view.stale = false;
    const anchor = anchorOf(ctx, now);
    const dates = weekDates(anchor);
    const date = dates.find(d => d.getDay() === view.selectedDow) || anchor;
    const key = toDateKey(date);
    const isToday = key === toDateKey(now);
    const blocks = state.getDay(key);
    const nowMin = minutesOfDay(now);
    const status = describeDay(blocks, nowMin);
    const presets = state.availablePresets(key);
    const welcome = state.savedDayCount() === 0;

    $('weeknav').innerHTML = ui.weekNavMarkup({
      dates, offset: view.weekOffset, canPrev: view.weekOffset > -WEEK_RANGE.back, canNext: view.weekOffset < WEEK_RANGE.forward
    });
    $('days').innerHTML = ui.dayStripMarkup({ dates, today: now, selectedDow: view.selectedDow });
    $('hero').innerHTML = isToday
      ? ui.todayHeroMarkup({ now, status, nowMin, nextDay: state.nextPlannedDay(now), welcome })
      : ui.otherDayHeroMarkup({ date, blocks });
    $('streak').innerHTML = ui.streakMarkup(state.streakView(now));

    keepFocus(() => {
      $('tl').className = `tl${view.sorting ? ' sorting' : ''}`;
      $('tl').innerHTML = ui.listMarkup({
        blocks, isToday, nowMin, currentIndex: status.index, sorting: view.sorting, presets: limitCustom(presets, 4), welcome
      });
    });
    $('quick').innerHTML = view.sorting || !blocks.length
      ? ''
      : ui.quickAddMarkup(limitCustom(presets.filter(p => p.quick && !p.used), 4));

    $('sortBtn').textContent = view.sorting ? 'Listo' : 'Ordenar';
    $('sortBtn').classList.toggle('on', view.sorting);
    $('sortBtn').hidden = blocks.length < 2 && !view.sorting;
    $('moreBtn').hidden = view.sorting;
    $('addBtn').hidden = view.sorting;
    $('clearBtn').hidden = !blocks.length || view.sorting;
    $('hint').textContent = view.sorting
      ? 'Arrastra el icono de la derecha para mover una actividad. Las horas se recalculan manteniendo la duración de cada una.'
      : (blocks.length ? 'Toca una actividad para editarla o anotar lo que hiciste. Desliza a la izquierda para eliminarla.' : '');
  }

  ctx.render = render;
  /** Agrupa varios cambios seguidos en un solo repintado y lo aplaza mientras haya un gesto activo. */
  ctx.requestRender = () => {
    view.stale = true;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!ctx.busy() && view.stale) render();
    });
  };
}

/* ═════════════ Acciones sobre actividades ═════════════ */

function removeWithUndo(ctx, key, id) {
  const result = ctx.state.removeBlock(key, id);
  if (!result.ok) return;
  ctx.cloud.track('activity_deleted');
  ctx.toast.show('Actividad eliminada', {
    label: 'Deshacer',
    onAction: () => ctx.state.restoreBlock(key, result.removed)
  });
}

function applyPreset(ctx, presetId) {
  const key = selectedKey(ctx);
  const previous = ctx.state.getDay(key);
  const result = ctx.state.applyPreset(key, presetId);
  if (!result.ok) { ctx.toast.show(result.error, { duration: 6000 }); return; }
  ctx.cloud.track('preset_added', { preset: presetId });
  const skipped = result.skipped.length ? ` (${result.skipped.length} omitidas por solaparse)` : '';
  ctx.toast.show(`${plural(result.added, 'actividad añadida', 'actividades añadidas')}${skipped}`, {
    label: 'Deshacer',
    onAction: () => (previous.length ? ctx.state.restoreDay(key, previous) : ctx.state.clearDay(key))
  });
}

function openBadges(ctx) {
  $('badgeList').innerHTML = ui.badgesMarkup(ctx.state.listBadges(ctx.clock()));
  ctx.badgesSheet.open();
}

function toggleDone(ctx, key, id) {
  const result = ctx.state.toggleDone(key, id);
  if (!result.ok) return;
  const fresh = result.done ? ctx.state.checkBadges(ctx.clock()) : [];
  if (fresh.length) ctx.cloud.track('badge_earned', { count: fresh.length });
  const badgeText = fresh.length === 1 ? ` Insignia nueva: ${fresh[0].title}.` : fresh.length ? ` ${fresh.length} insignias nuevas.` : '';
  const seeBadges = fresh.length ? { label: 'Ver', onAction: () => openBadges(ctx) } : {};
  const reachedGoal = result.done && !result.before.met && result.after.met;
  if (reachedGoal && key === toDateKey(ctx.clock())) {
    const { current } = ctx.state.streakView();
    vibrate(30);
    ctx.cloud.track('daily_goal_met', { streak: current });
    ctx.toast.show(`¡Objetivo de hoy cumplido! Racha: ${plural(current, 'día', 'días')}.${badgeText}`, { duration: 6000, ...seeBadges });
  } else if (fresh.length) {
    vibrate(30);
    ctx.toast.show(`¡Insignia conseguida!${badgeText.replace(' Insignia nueva:', '')}`, { duration: 6000, ...seeBadges });
  } else if (result.done) {
    ctx.cloud.track('activity_done');
  }
}

/* ═════════════ Navegación y lista ═════════════ */

function setupNavigation(ctx) {
  const { view, state, toast } = ctx;
  $('days').addEventListener('click', e => {
    const button = e.target.closest('.day');
    if (!button) return;
    view.selectedDow = Number(button.dataset.dow);
    ctx.render();
  });
  $('hero').addEventListener('click', e => {
    if (e.target.id === 'back') { view.weekOffset = 0; view.selectedDow = ctx.clock().getDay(); ctx.render(); }
  });
  $('weeknav').addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button || button.disabled) return;
    if (button.id === 'wkPrev') view.weekOffset = Math.max(-WEEK_RANGE.back, view.weekOffset - 1);
    else if (button.id === 'wkNext') view.weekOffset = Math.min(WEEK_RANGE.forward, view.weekOffset + 1);
    else if (button.id === 'wkToday') { view.weekOffset = 0; view.selectedDow = ctx.clock().getDay(); }
    else return;
    ctx.swipeReset();
    ctx.render();
    const again = $(button.id);
    if (again && !again.disabled) again.focus({ preventScroll: true }); // el teclado no pierde el foco al repintar
  });
  $('addBtn').addEventListener('click', () => openEditor(ctx, null));
  $('quick').addEventListener('click', e => {
    const chip = e.target.closest('[data-preset]');
    if (chip) applyPreset(ctx, chip.dataset.preset);
  });
  $('clearBtn').addEventListener('click', () => {
    const key = selectedKey(ctx);
    const previous = state.clearDay(key);
    toast.show('Día vaciado', { label: 'Deshacer', onAction: () => state.restoreDay(key, previous) });
  });
}

function setupList(ctx) {
  const { view, state } = ctx;
  const swipe = ui.attachSwipeToDelete($('tl'), {
    isEnabled: () => !view.sorting,
    onDelete: id => removeWithUndo(ctx, selectedKey(ctx), id)
  });
  const sorter = ui.attachDragSort($('tl'), {
    isEnabled: () => view.sorting,
    onReorder: ids => {
      if (state.reorder(selectedKey(ctx), ids).ok) ctx.cloud.track('day_reordered');
      ctx.render(); // el DOM ya se movió con el dedo: se vuelve a pintar desde el estado
    }
  });
  ctx.busy = () => swipe.isBusy() || sorter.isActive();
  ctx.swipeReset = swipe.closeOpen;

  $('sortBtn').addEventListener('click', () => { view.sorting = !view.sorting; swipe.closeOpen(); ctx.render(); });

  $('tl').addEventListener('click', e => {
    if (view.sorting) return;
    const preset = e.target.closest('[data-preset]');
    if (preset) { applyPreset(ctx, preset.dataset.preset); return; }
    const row = e.target.closest('.row');
    if (!row) return;
    const id = row.closest('.item').dataset.id;
    if (e.target.closest('.ck')) toggleDone(ctx, selectedKey(ctx), id);
    else openEditor(ctx, id);
  });
  $('tl').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) {
      e.preventDefault();
      openEditor(ctx, e.target.closest('.item').dataset.id);
    }
  });
}

/* ═════════════ Editor de actividad ═════════════ */

const editor = {
  key: null, id: null, category: 'libre',
  subtasks: [],            // copia de trabajo de las subtareas de la actividad
  rule: null,              // serie semanal a la que pertenece la actividad editada (si sigue vigente)
  repeat: false,           // interruptor "repetir" / "aplicar a las próximas semanas"
  dows: new Set()          // días de la semana de la repetición
};

const dowOfKey = key => new Date(`${key}T12:00:00`).getDay();

/** Avisa en vivo si el tramo elegido choca con otras actividades; guardar sigue siendo posible. */
function refreshOverlapWarning(ctx) {
  const range = { s: fromHHMM($('fS').value), e: fromHHMM($('fE').value) };
  const others = findOverlaps(ctx.state.getDay(editor.key), range, editor.id);
  $('fWarn').hidden = !others.length;
  $('saveBtn').textContent = others.length ? 'Guardar igualmente' : 'Guardar';
  if (!others.length) return;
  const named = others.slice(0, 2).map(b => `«${shortTitle(b.t)}» (${toHHMM(b.s)}–${toHHMM(b.e)})`).join(' y ');
  $('fWarn').textContent = `Se solapa con ${named}${others.length > 2 ? ` y ${others.length - 2} más` : ''}.`;
}

function renderSubtasks() {
  $('fK').innerHTML = ui.subtasksMarkup(editor.subtasks);
  $('fKadd').disabled = editor.subtasks.length >= LIMITS.subtasks;
  $('fKnew').disabled = editor.subtasks.length >= LIMITS.subtasks;
}

function renderRepeat() {
  const locked = dowOfKey(editor.key);
  $('repSwitch').setAttribute('aria-checked', editor.repeat);
  $('repDays').hidden = !editor.repeat;
  $('repDays').innerHTML = ui.weekdayChipsMarkup({ selected: editor.dows, locked });
}

function openEditor(ctx, id) {
  const key = selectedKey(ctx);
  const blocks = ctx.state.getDay(key);
  const block = id ? blocks.find(b => b.id === id) : null;
  Object.assign(editor, { key, id: block ? block.id : null });
  showEditorError('');
  $('sTitle').textContent = block ? 'Editar actividad' : 'Nueva actividad';
  $('delBtn').hidden = !block;
  if (block) {
    $('fT').value = block.t;
    $('fS').value = toHHMM(block.s);
    $('fE').value = toHHMM(block.e);
    $('fN').value = block.n;
    selectCategory(block.c);
  } else {
    const lastEnd = blocks.length ? Math.max(...blocks.map(b => b.e)) : 9 * 60;
    const start = Math.min(lastEnd, 22 * 60 + 30);
    $('fT').value = '';
    $('fS').value = toHHMM(start);
    $('fE').value = toHHMM(Math.min(start + 60, 1439));
    $('fN').value = '';
    selectCategory('libre');
  }

  editor.subtasks = block && block.k ? block.k.map(item => ({ ...item })) : [];
  $('fKnew').value = '';
  renderSubtasks();

  // Repetición: una actividad de una serie vigente se puede cambiar "para las próximas semanas" o dejar de repetir.
  const rule = block && block.r ? ctx.state.listRecurring().find(r => r.id === block.r) : null;
  editor.rule = rule && (!rule.until || key <= rule.until) ? rule : null;
  editor.repeat = false;
  editor.dows = new Set(editor.rule ? editor.rule.dows : [dowOfKey(key)]);
  const canRepeat = key >= toDateKey(ctx.clock()) || Boolean(editor.rule);
  $('fRep').hidden = !canRepeat;
  $('repStop').hidden = !editor.rule;
  if (editor.rule) {
    $('repTitle').textContent = 'Aplicar a las próximas semanas';
    $('repHint').textContent = `Se repite cada semana (${ui.weekdaysLabel(editor.rule.dows)}). Por defecto, los cambios afectan solo a este día.`;
  } else {
    $('repTitle').textContent = 'Repetir cada semana';
    $('repHint').textContent = 'Se creará sola en los días que elijas, también en las semanas siguientes.';
  }
  renderRepeat();

  refreshOverlapWarning(ctx);
  ctx.editSheet.open();
  if (!block) $('fT').focus();
}

function showEditorError(message) {
  $('fErr').textContent = message || '';
  $('fErr').hidden = !message;
}

function selectCategory(key) {
  editor.category = key;
  Array.from($('fC').children).forEach(el => {
    const on = el.dataset.c === key;
    el.classList.toggle('sel', on);
    el.setAttribute('aria-pressed', on);
  });
}

function setupEditor(ctx) {
  const { state, toast } = ctx;
  $('fC').innerHTML = ui.categoryChipsMarkup();
  $('fC').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) selectCategory(chip.dataset.c);
  });

  ['fS', 'fE'].forEach(id => {
    $(id).addEventListener('input', () => { showEditorError(''); refreshOverlapWarning(ctx); });
    $(id).addEventListener('change', () => refreshOverlapWarning(ctx));
  });

  /* Subtareas */
  const addSubtask = () => {
    const text = $('fKnew').value.trim();
    if (!text || editor.subtasks.length >= LIMITS.subtasks) return;
    editor.subtasks.push({ t: text.slice(0, LIMITS.subtaskLength), d: false });
    $('fKnew').value = '';
    renderSubtasks();
    $('fKnew').focus();
  };
  $('fKadd').addEventListener('click', addSubtask);
  $('fKnew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } });
  $('fK').addEventListener('click', e => {
    const row = e.target.closest('.sub-row');
    if (!row) return;
    const index = Number(row.dataset.i);
    if (e.target.closest('.sub-ck')) editor.subtasks[index].d = !editor.subtasks[index].d;
    else if (e.target.closest('.sub-x')) editor.subtasks.splice(index, 1);
    else return;
    renderSubtasks();
  });

  /* Repetición */
  $('repSwitch').addEventListener('click', () => { editor.repeat = !editor.repeat; renderRepeat(); });
  $('repDays').addEventListener('click', e => {
    const chip = e.target.closest('.chip.dow');
    if (!chip || chip.disabled) return;
    const dow = Number(chip.dataset.dow);
    if (editor.dows.has(dow)) editor.dows.delete(dow); else editor.dows.add(dow);
    renderRepeat();
  });
  $('repStop').addEventListener('click', () => {
    if (!editor.rule) return;
    const result = state.stopRecurring(editor.rule.id, editor.key);
    if (!result.ok) { showEditorError('La repetición ya no existe.'); return; }
    ctx.cloud.track('recurring_stopped');
    ctx.editSheet.close();
    toast.show(result.until === editor.key ? 'Ya no se repetirá después de este día.' : 'Ya no se repetirá desde hoy.', {
      label: 'Deshacer', duration: 7000, onAction: result.undo
    });
  });

  $('saveBtn').addEventListener('click', () => {
    const draft = {
      t: $('fT').value.trim(),
      s: fromHHMM($('fS').value),
      e: fromHHMM($('fE').value),
      c: editor.category,
      n: $('fN').value.trim(),
      k: editor.subtasks
    };
    const dows = Array.from(editor.dows);
    let result;
    let series = null;
    if (editor.id) {
      result = state.updateBlock(editor.key, editor.id, draft);
      if (result.ok && editor.repeat) {
        series = editor.rule
          ? state.changeRecurring(editor.rule.id, editor.key, { t: draft.t, c: draft.c, s: draft.s, e: draft.e, k: draft.k, dows })
          : state.addRecurring(editor.key, draft, dows, { blockId: editor.id });
      }
    } else if (editor.repeat) {
      result = series = state.addRecurring(editor.key, draft, dows);
    } else {
      result = state.addBlock(editor.key, draft);
    }
    if (!result.ok) { showEditorError(result.error); return; }
    if (series && !series.ok) { showEditorError(series.error); return; }
    ctx.cloud.track('activity_saved', { is_new: !editor.id, repeats: Boolean(series), subtasks: draft.k.length > 0 });
    ctx.editSheet.close();
    if (series) {
      toast.show(editor.rule ? 'Cambio aplicado a las próximas semanas.' : `Se repetirá cada semana (${ui.weekdaysLabel(series.rule.dows)}).`, {
        label: 'Deshacer', duration: 7000, onAction: series.undo
      });
    }
  });
  $('cancelBtn').addEventListener('click', ctx.editSheet.close);
  $('delBtn').addEventListener('click', () => {
    ctx.editSheet.close();
    removeWithUndo(ctx, editor.key, editor.id);
  });
}

/* ═════════════ Menú del día: copiar y plantillas propias ═════════════ */

const copyState = { sourceKey: '', selected: new Set(), replace: false };

function showCopyError(message) {
  $('copyErr').textContent = message || '';
  $('copyErr').hidden = !message;
}

function openCopy(ctx) {
  const sourceKey = selectedKey(ctx);
  const date = dateForDow(ctx.view.selectedDow, anchorOf(ctx, ctx.clock()));
  if (!ctx.state.getDay(sourceKey).length) { ctx.toast.show('Este día no tiene actividades que copiar.'); return; }
  const anchor = anchorOf(ctx, ctx.clock());
  const weeks = [weekDates(anchor), weekDates(addDays(anchor, 7))].map((dates, i) => ({
    label: `${i === 0 ? 'Semana mostrada' : 'Semana siguiente'}: ${ui.weekRangeLabel(dates)}`,
    dates
  }));
  Object.assign(copyState, { sourceKey, selected: new Set(), replace: false });
  $('copyFrom').textContent = `Se copiarán las ${plural(ctx.state.getDay(sourceKey).length, 'actividad', 'actividades')} de ${formatLongDate(date).toLowerCase()}, sin marcar y sin anotaciones.`;
  $('copyTargets').innerHTML = ui.copyTargetsMarkup({ weeks, sourceKey, selected: copyState.selected, todayKey: toDateKey(ctx.clock()) });
  $('replaceSwitch').setAttribute('aria-checked', 'false');
  showCopyError('');
  ctx.copySheet.open();
}

function refreshRestButton(ctx) {
  const key = selectedKey(ctx);
  const isRest = ctx.state.isRestDay(key);
  const past = key < toDateKey(ctx.clock());
  $('menuRestT').textContent = isRest ? 'Quitar día de descanso' : 'Marcar como día de descanso';
  $('menuRestS').textContent = past
    ? 'Solo se puede en hoy y en días que aún no han llegado.'
    : isRest ? 'Volverá a contar para tu racha.' : 'No suma ni rompe tu racha.';
  $('menuRest').disabled = past;
}

function setupDayMenu(ctx) {
  const { state, toast } = ctx;

  $('moreBtn').addEventListener('click', () => {
    const date = dateForDow(ctx.view.selectedDow, anchorOf(ctx, ctx.clock()));
    $('dayLabel').textContent = formatLongDate(date);
    refreshRestButton(ctx);
    ctx.daySheet.open();
  });
  $('closeDay').addEventListener('click', ctx.daySheet.close);
  $('menuRest').addEventListener('click', () => {
    const key = selectedKey(ctx);
    const on = !state.isRestDay(key);
    const result = state.setRestDay(key, on);
    if (!result.ok) { toast.show(result.error); return; }
    ctx.cloud.track(on ? 'rest_day_set' : 'rest_day_removed');
    ctx.daySheet.close();
    toast.show(on ? 'Día de descanso marcado. No suma ni rompe tu racha.' : 'Este día vuelve a contar para tu racha.', {
      label: 'Deshacer', duration: 7000, onAction: () => result.undo()
    });
  });
  $('menuCopy').addEventListener('click', () => openCopy(ctx));
  $('menuTemplates').addEventListener('click', () => openTemplates(ctx));
  $('menuRepeats').addEventListener('click', () => { refreshRepeats(ctx); ctx.repeatsSheet.open(); });
  $('closeRepeats').addEventListener('click', ctx.repeatsSheet.close);
  $('repList').addEventListener('click', e => {
    const button = e.target.closest('button[data-act="stop"]');
    if (!button) return;
    const result = state.stopRecurring(button.dataset.id, toDateKey(addDays(ctx.clock(), -1)));
    if (!result.ok) return;
    ctx.cloud.track('recurring_stopped');
    refreshRepeats(ctx);
    toast.show('Ya no se repetirá desde hoy.', {
      label: 'Deshacer', duration: 7000, onAction: () => { result.undo(); refreshRepeats(ctx); }
    });
  });

  /* Copiar */
  $('copyTargets').addEventListener('click', e => {
    const button = e.target.closest('.cday');
    if (!button || button.disabled) return;
    const on = !copyState.selected.has(button.dataset.key);
    if (on) copyState.selected.add(button.dataset.key); else copyState.selected.delete(button.dataset.key);
    button.classList.toggle('sel', on);
    button.setAttribute('aria-pressed', on);
    showCopyError('');
  });
  $('replaceSwitch').addEventListener('click', () => {
    copyState.replace = !copyState.replace;
    $('replaceSwitch').setAttribute('aria-checked', copyState.replace);
    $('replaceHint').textContent = copyState.replace
      ? 'Se borrará lo que haya en los días elegidos. Podrás deshacerlo justo después.'
      : 'Si está desactivado, solo se añaden las actividades que no chocan con las existentes.';
  });
  $('copyCancel').addEventListener('click', ctx.copySheet.close);
  $('copyGo').addEventListener('click', () => {
    const result = state.copyDay(copyState.sourceKey, Array.from(copyState.selected), { replace: copyState.replace });
    if (!result.ok) { showCopyError(result.error); return; }
    ctx.cloud.track('day_copied', { days: result.days });
    ctx.copySheet.close();
    const skipped = result.skipped ? ` (${plural(result.skipped, 'omitida', 'omitidas')} por solaparse)` : '';
    toast.show(`Copiado a ${plural(result.days, 'día', 'días')}${skipped}`, {
      label: 'Deshacer',
      duration: 7000,
      onAction: () => state.undoCopy(result.previous)
    });
  });

  /* Plantillas */
  const showTemplateError = message => { $('tplErr').textContent = message || ''; $('tplErr').hidden = !message; };
  const refreshTemplates = () => {
    const key = selectedKey(ctx);
    const count = state.getDay(key).length;
    $('tplSaveHint').textContent = count
      ? `Se guardarán las ${plural(count, 'actividad', 'actividades')} de este día (sin anotaciones).`
      : 'Este día está vacío: añade actividades para poder guardarlo como plantilla.';
    $('tplSave').disabled = !count;
    $('tplName').disabled = !count;
    $('tplList').innerHTML = ui.templatesMarkup(state.listTemplates());
  };
  ctx.refreshTemplates = refreshTemplates;

  const saveTemplate = () => {
    const result = state.saveTemplate($('tplName').value, selectedKey(ctx));
    if (!result.ok) { showTemplateError(result.error); return; }
    ctx.cloud.track('template_saved');
    $('tplName').value = '';
    showTemplateError('');
    refreshTemplates();
    toast.show('Plantilla guardada');
  };
  $('tplSave').addEventListener('click', saveTemplate);
  $('tplName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveTemplate(); } });
  $('tplName').addEventListener('input', () => showTemplateError(''));
  $('closeTpl').addEventListener('click', ctx.templatesSheet.close);

  $('tplList').addEventListener('click', e => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    const { id } = button.dataset;
    if (button.dataset.act === 'apply') {
      ctx.templatesSheet.close();
      applyPreset(ctx, id);
      return;
    }
    const result = state.deleteTemplate(id);
    if (!result.ok) return;
    refreshTemplates();
    toast.show('Plantilla eliminada', {
      label: 'Deshacer',
      onAction: () => { state.restoreTemplate(result.removed); if ($('sheetTemplates').classList.contains('open')) refreshTemplates(); }
    });
  });

  // Un cambio llegado de otro dispositivo mientras la hoja está abierta.
  state.subscribe(change => {
    if (change.type !== 'profile') return;
    if ($('sheetTemplates').classList.contains('open')) refreshTemplates();
    if ($('sheetRepeats').classList.contains('open')) refreshRepeats(ctx);
  });
}

/** Lista de repeticiones vigentes (las ya terminadas no se muestran). */
function refreshRepeats(ctx) {
  const today = toDateKey(ctx.clock());
  $('repList').innerHTML = ui.repeatsMarkup(ctx.state.listRecurring().filter(r => !r.until || r.until >= today));
}

function openTemplates(ctx) {
  ctx.refreshTemplates();
  $('tplErr').hidden = true;
  ctx.templatesSheet.open();
}

/* ═════════════ Estadísticas ═════════════ */

function setupStats(ctx) {
  $('openStats').addEventListener('click', () => {
    const now = ctx.clock();
    $('statsRange').textContent = ui.weekRangeLabel(weekDates(now));
    $('statsBody').innerHTML = ui.statsMarkup(ctx.state.weekSummary(now));
    ctx.cloud.track('view_stats');
    ctx.statsSheet.open();
  });
  $('closeStats').addEventListener('click', ctx.statsSheet.close);
}

/* ═════════════ Ajustes: avisos, estadísticas de uso, copia de seguridad, instalación ═════════════ */

function describeNotifications(ctx) {
  const s = ctx.notifier.status();
  if (s.needsInstall) return { on: false, disabled: true, text: 'En iPhone, añade primero la app a la pantalla de inicio (iOS 16.4 o superior).' };
  if (!s.supported) return { on: false, disabled: true, text: 'Este navegador no admite avisos.' };
  if (s.permission === 'denied') return { on: false, disabled: true, text: 'Bloqueados. Actívalos en los ajustes del sistema para esta app.' };
  if (s.enabled) {
    return { on: true, disabled: false, text: s.native
      ? 'Te aviso cuando empiece cada actividad, incluso con la app cerrada.'
      : 'Te aviso cuando empiece cada actividad, con la app abierta o en segundo plano.' };
  }
  return { on: false, disabled: false, text: 'Recibe un aviso justo cuando empiece cada actividad.' };
}

function describeAnalytics(ctx) {
  if (ctx.analytics === 'unsupported') {
    return { on: false, disabled: true, text: 'No disponible en este dispositivo o bloqueado por el navegador.' };
  }
  return { on: ctx.state.settings.getFlag('analytics'), disabled: false, text: 'Envía datos anónimos de uso a Google Analytics, nunca tus actividades ni tus notas.' };
}

/** Minutos de antelación del aviso elegidos en este dispositivo (0 = al empezar). */
function leadOf(ctx) {
  const v = Number(ctx.state.settings.get('lead'));
  return LEAD_OPTIONS.includes(v) ? v : 0;
}

function setupSettings(ctx) {
  const { state, notifier, cloud, toast } = ctx;
  const install = createInstallPrompt(() => refreshSettings());

  function refreshSettings() {
    const n = describeNotifications(ctx);
    $('notifySwitch').setAttribute('aria-checked', n.on);
    $('notifySwitch').disabled = n.disabled;
    $('notifyStatus').textContent = n.text;

    const lead = leadOf(ctx);
    $('leadSelect').value = String(lead);
    $('leadSelect').disabled = !notifier.status().enabled;
    $('leadStatus').textContent = lead === 0
      ? 'Te aviso justo cuando empieza cada actividad.'
      : `Te aviso ${lead} min antes de que empiece cada actividad.`;

    const streak = state.getStreakConfig();
    $('goalSelect').value = String(streak.goal);
    $('goalStatus').textContent = `Completa el ${streak.goal} % de las actividades de un día para sumar a tu racha.`;
    $('streakDays').innerHTML = ui.weekdayChipsMarkup({ selected: new Set(streak.days), locked: -1 });
    $('streakDaysStatus').textContent = streak.days.length === 7
      ? 'Todos los días cuentan.'
      : 'Los demás días no suman ni rompen tu racha.';

    const a = describeAnalytics(ctx);
    $('analyticsSwitch').setAttribute('aria-checked', a.on);
    $('analyticsSwitch').disabled = a.disabled;
    $('analyticsStatus').textContent = a.text;

    const iosHint = platformInfo.ios && !platformInfo.standalone && !ctx.native;
    $('installBlock').hidden = !(install.available() || iosHint);
    $('installBtn').hidden = !install.available();
    $('installHint').textContent = install.available()
      ? 'Instálala para abrirla como una app, a pantalla completa y sin conexión.'
      : 'En Safari pulsa Compartir y después "Añadir a pantalla de inicio".';
    refreshAccountText(ctx);
  }
  ctx.refreshSettings = refreshSettings;

  $('openSettings').addEventListener('click', async () => {
    await notifier.refresh();
    refreshSettings();
    ctx.settingsSheet.open();
  });
  $('closeSettings').addEventListener('click', ctx.settingsSheet.close);

  $('notifySwitch').addEventListener('click', async () => {
    if (notifier.status().enabled) await notifier.disable();
    else await notifier.enable();
    refreshSettings();
    ctx.syncNative();
  });

  $('goalSelect').innerHTML = STREAK_RULES.goalOptions.map(v => `<option value="${v}">${v} %</option>`).join('');
  $('goalSelect').addEventListener('change', e => {
    state.setStreakConfig({ ...state.getStreakConfig(), goal: Number(e.target.value) });
    refreshSettings();
  });
  $('streakDays').addEventListener('click', e => {
    const chip = e.target.closest('[data-dow]');
    if (!chip) return;
    const dow = Number(chip.dataset.dow);
    const config = state.getStreakConfig();
    const days = new Set(config.days);
    if (days.has(dow)) {
      if (days.size === 1) { toast.show('Al menos un día tiene que contar.'); return; }
      days.delete(dow);
    } else days.add(dow);
    state.setStreakConfig({ ...config, days: [...days] });
    refreshSettings();
    const again = $('streakDays').querySelector(`[data-dow="${dow}"]`);
    if (again) again.focus();
  });

  $('leadSelect').innerHTML = LEAD_OPTIONS
    .map(v => `<option value="${v}">${v === 0 ? 'Al empezar' : `${v} min antes`}</option>`).join('');
  $('leadSelect').addEventListener('change', e => {
    const v = Number(e.target.value);
    state.settings.set('lead', LEAD_OPTIONS.includes(v) ? v : 0);
    refreshSettings();
    ctx.syncNative();
  });

  $('analyticsSwitch').addEventListener('click', () => {
    state.settings.setFlag('analytics', !state.settings.getFlag('analytics'));
    ctx.applyAnalyticsPreference();
  });

  $('installBtn').addEventListener('click', () => install.prompt());

  $('exportBtn').addEventListener('click', async () => {
    const file = new File([JSON.stringify(state.exportBackup(), null, 2)], `horario-${toDateKey(ctx.clock())}.json`, { type: 'application/json' });
    try {
      const result = await deliverFile(file);
      if (result === 'cancelled') return;
      cloud.track('backup_exported');
      toast.show(result === 'downloaded' ? 'Copia descargada' : 'Copia lista para guardar');
    } catch (_) {
      toast.show('No se pudo exportar la copia.', { duration: 6000 });
    }
  });

  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const count = parseBackup(text).days.length;
      if (!window.confirm(`Se restaurarán ${plural(count, 'día', 'días')} y se sobrescribirán los que ya existan. ¿Continuar?`)) return;
      state.importBackup(text);
      cloud.track('backup_imported');
      ctx.settingsSheet.close();
      toast.show('Copia restaurada');
    } catch (err) {
      toast.show(err.message || 'No se pudo importar el archivo.', { duration: 6000 });
    }
  });
}

/* ═════════════ Cuenta, acceso previo y sincronización ═════════════ */

const GATE_TEXT = Object.freeze({
  loading: 'Conectando…',
  unavailable: 'No se pudo conectar con la nube. Comprueba tu conexión e inténtalo de nuevo.',
  signedOut: 'Inicia sesión para ver y guardar tu horario.'
});

/** Con una sesión conocida se entra directo (también sin conexión); si no, se pide iniciar sesión. */
function isGated(ctx) {
  if (ctx.account.status === 'signedIn') return false;
  if (ctx.account.status === 'signedOut') return true;
  return !ctx.state.getSessionUid();
}

function refreshGate(ctx) {
  const gated = isGated(ctx);
  $('gate').hidden = !gated;
  $('app').hidden = gated;
  if (gated) ctx.sheets.closeActive();
  $('gateMsg').textContent = location.protocol === 'file:' && ctx.account.status !== 'loading'
    ? 'Abierta como archivo, no se puede iniciar sesión. Ábrela desde una dirección https:// o http://localhost.'
    : (GATE_TEXT[ctx.account.status] || '');
  $('authForm').hidden = ctx.account.status !== 'signedOut';
  $('retryBtn').hidden = ctx.account.status !== 'unavailable';
}

function refreshAccountText(ctx) {
  const signedIn = ctx.account.status === 'signedIn';
  $('accountStatus').textContent = signedIn
    ? `Sesión iniciada como ${ctx.account.email}. Tus cambios se sincronizan solos.`
    : 'Sin conexión con la nube. Tus cambios se guardan en este dispositivo y se subirán al volver la conexión.';
  $('accountOut').hidden = !signedIn;
}

function setupAccount(ctx) {
  const { state, cloud, toast } = ctx;

  const showAuthError = message => { $('authErr').textContent = message || ''; $('authErr').hidden = !message; };

  async function submitAuth(mode) {
    const email = $('authEmail').value.trim();
    const password = $('authPass').value;
    const buttons = [$('signInBtn'), $('signUpBtn')];
    showAuthError('');
    if (!email || !password) { showAuthError('Escribe tu correo y tu contraseña.'); return; }
    buttons.forEach(b => { b.disabled = true; });
    try {
      await cloud[mode](email, password);
      $('authPass').value = '';
      cloud.track(mode === 'signUp' ? 'sign_up' : 'login', { method: 'password' });
      toast.show(mode === 'signUp' ? 'Cuenta creada' : 'Sesión iniciada');
    } catch (err) {
      showAuthError(err.message);
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  }
  $('authForm').addEventListener('submit', e => { e.preventDefault(); submitAuth('signIn'); });
  $('signUpBtn').addEventListener('click', () => submitAuth('signUp'));

  $('forgotBtn').addEventListener('click', async () => {
    const email = $('authEmail').value.trim();
    if (!email) { showAuthError('Escribe tu correo y vuelve a pulsar.'); return; }
    showAuthError('');
    try {
      await cloud.resetPassword(email);
      toast.show('Si el correo existe, te enviaremos un enlace para cambiar la contraseña.', { duration: 8000 });
    } catch (err) {
      showAuthError(err.message);
    }
  });

  $('retryBtn').addEventListener('click', () => cloud.init());
  window.addEventListener('online', () => { if (ctx.account.status === 'unavailable') cloud.init(); });

  $('signOutBtn').addEventListener('click', async () => {
    try {
      await cloud.signOut();
      state.clearLocalData(); // el dispositivo no conserva el horario tras cerrar sesión; sigue en la nube
      ctx.settingsSheet.close();
      refreshGate(ctx);
    } catch (err) {
      toast.show(err.message);
    }
  });

  /* Estado de la sesión */
  cloud.onState(next => {
    ctx.account = next;
    if (next.status === 'signedIn') {
      const previous = state.getSessionUid();
      if (previous && previous !== next.uid) state.clearLocalData(); // otra cuenta en el mismo dispositivo
      state.setSessionUid(next.uid);
      askAnalyticsConsent(ctx);
    } else {
      ctx.migrated = false;
      ctx.profileMigrated = false;
    }
    refreshGate(ctx);
    ctx.refreshSettings();
  });

  /* Cambios llegados de la nube. Primero se aplican, luego se concilia lo que solo existe aquí. */
  cloud.onDays(({ fromCache, remoteKeys, changes }) => {
    state.applyRemoteChanges(changes);
    if (!fromCache && !ctx.migrated) {
      ctx.migrated = true;
      state.reconcile(remoteKeys);
    }
  });

  /* Perfil (plantillas propias): mismo criterio que los días */
  cloud.onProfile(({ fromCache, exists, data }) => {
    state.applyRemoteProfile(exists ? data : null);
    if (!fromCache && !ctx.profileMigrated) {
      ctx.profileMigrated = true;
      state.reconcileProfile(exists);
    }
  });

  let lastErrorAt = 0;
  cloud.onError(err => {
    if (Date.now() - lastErrorAt < 30000) return;
    lastErrorAt = Date.now();
    toast.show(err && err.code === 'permission-denied'
      ? 'La nube rechazó el cambio. Revisa las reglas de Firestore.'
      : 'No se pudo sincronizar con la nube.', { duration: 6000 });
  });

  /* Estadísticas de uso: solo con consentimiento explícito de este dispositivo */
  ctx.applyAnalyticsPreference = async () => {
    ctx.analytics = await cloud.setAnalytics(state.settings.getFlag('analytics'));
    ctx.refreshSettings();
  };
}

function askAnalyticsConsent(ctx) {
  const { state, toast } = ctx;
  if (state.settings.get('analytics') !== null) return; // ya decidido en este dispositivo
  state.settings.setFlag('analytics', false);
  setTimeout(() => toast.show('¿Compartir estadísticas de uso anónimas?', {
    label: 'Activar',
    duration: 12000,
    onAction: () => { state.settings.setFlag('analytics', true); ctx.applyAnalyticsPreference(); }
  }), 1800);
}

/* ═════════════ Reloj, avisos y ciclo de vida ═════════════ */

function setupClock(ctx) {
  const { state, view, notifier, toast } = ctx;
  const watcher = createStartWatcher();

  /** En nativo se reprograman las próximas notificaciones locales (suenan con la app cerrada). */
  ctx.syncNative = debounce(() => {
    if (!ctx.native) return;
    notifier.sync(state.upcomingStarts(ctx.clock(), NOTIFICATIONS.nativeHorizonDays, NOTIFICATIONS.nativeMaxPending, leadOf(ctx)));
  }, 600);

  const announce = (block, lead = 0) => {
    if (!ctx.native && notifier.status().enabled) notifier.announce(block, lead);
    else if (!document.hidden) {
      toast.show(lead > 0 ? `En ${lead} min: ${shortTitle(block.t)}` : `Ahora: ${shortTitle(block.t)}`, { duration: 6000 });
    }
  };

  const checkStarts = (now, silent) => {
    const key = toDateKey(now);
    const lead = notifier.status().enabled ? leadOf(ctx) : 0;
    const started = watcher.collect(key, state.getDay(key), minutesOfDay(now), lead);
    if (!silent && !isGated(ctx)) started.forEach(b => announce(b, lead));
  };

  function tick(force = false) {
    const now = ctx.clock();
    const dateKey = toDateKey(now);
    if (dateKey !== view.dateKey) { view.dateKey = dateKey; view.selectedDow = now.getDay(); view.weekOffset = 0; force = true; }
    checkStarts(now, false);
    if (ctx.busy()) return; // no repintar durante un gesto; se hará al terminar
    const minuteKey = `${dateKey}-${now.getHours()}:${now.getMinutes()}`;
    if (force || view.stale || minuteKey !== view.minuteKey) { view.minuteKey = minuteKey; ctx.render(now); }
  }

  state.subscribe(() => { ctx.requestRender(); ctx.syncNative(); });

  return {
    start() {
      checkStarts(ctx.clock(), true); // al abrir no avisamos de lo que ya empezó
      tick(true);
      refreshGate(ctx);
      ctx.cloud.init().then(() => ctx.applyAnalyticsPreference());
      notifier.refresh().then(() => ctx.syncNative());
      setInterval(tick, 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });
      window.addEventListener('focus', () => tick(true));
    }
  };
}

/* ═════════════ Arranque ═════════════ */

function setupBadges(ctx) {
  $('streak').addEventListener('click', e => { if (e.target.closest('#openBadges')) openBadges(ctx); });
  $('closeBadges').addEventListener('click', ctx.badgesSheet.close);
  // Al abrir: si el historial ya da derecho a alguna insignia, se concede (una sola vez).
  setTimeout(() => {
    const fresh = ctx.state.checkBadges(ctx.clock());
    if (!fresh.length) return;
    ctx.cloud.track('badge_earned', { count: fresh.length });
    ctx.toast.show(fresh.length === 1 ? `¡Insignia conseguida: ${fresh[0].title}!` : `¡${fresh.length} insignias conseguidas!`, {
      label: 'Ver', duration: 7000, onAction: () => openBadges(ctx)
    });
  }, 4000);
}

function main() {
  const ctx = createContext();
  createRenderer(ctx);
  setupNavigation(ctx);
  setupList(ctx);
  setupEditor(ctx);
  setupDayMenu(ctx);
  setupBadges(ctx);
  setupStats(ctx);
  setupSettings(ctx);
  setupAccount(ctx);
  setupClock(ctx).start();
}

main();
