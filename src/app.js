/**
 * app.js — Raíz de composición y controlador.
 *
 * Construye los servicios, los conecta con la interfaz y contiene el flujo de la aplicación.
 * No contiene reglas de negocio (state-manager.js), ni acceso a Firebase (firebase-service.js),
 * ni HTML (ui-components.js), ni detalles web/nativos (platform.js).
 */
import { FIREBASE_CONFIG, NOTIFICATIONS } from './config.js';
import { createBrowserStorage, createStartWatcher, createStateManager, describeDay, parseBackup } from './state-manager.js';
import { createCloudService } from './firebase-service.js';
import {
  createInstallPrompt, createNotifier, deliverFile, isNative, platformInfo, readFileAsText, registerServiceWorker
} from './platform.js';
import * as ui from './ui-components.js';
import { dateForDow, fromHHMM, minutesOfDay, plural, shortTitle, toDateKey, toHHMM, weekDates } from './utils.js';

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
    sync: { push: (key, blocks) => cloud.pushDay(key, blocks), remove: key => cloud.removeDay(key) }
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
    view: { selectedDow: clock().getDay(), sorting: false, dateKey: toDateKey(clock()), minuteKey: '', stale: false },
    account: { status: 'loading', email: '', uid: '' },
    analytics: 'off',       // off | on | unsupported
    migrated: false,        // ya se hizo la primera conciliación con la nube en esta sesión
    busy: () => false,      // lo sustituye setupList: true mientras hay un gesto en curso
    render: () => {},       // lo sustituye createRenderer
    requestRender: () => {}
  };
}

const selectedKey = (ctx, now = ctx.clock()) => toDateKey(dateForDow(ctx.view.selectedDow, now));

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
    const dates = weekDates(now);
    const date = dates.find(d => d.getDay() === view.selectedDow) || now;
    const key = toDateKey(date);
    const isToday = key === toDateKey(now);
    const blocks = state.getDay(key);
    const nowMin = minutesOfDay(now);
    const status = describeDay(blocks, nowMin);
    const presets = state.availablePresets(key);
    const welcome = state.savedDayCount() === 0;

    $('days').innerHTML = ui.dayStripMarkup({ dates, today: now, selectedDow: view.selectedDow });
    $('hero').innerHTML = isToday
      ? ui.todayHeroMarkup({ now, status, nowMin, nextDay: state.nextPlannedDay(now), welcome })
      : ui.otherDayHeroMarkup({ date, blocks });
    $('streak').innerHTML = ui.streakMarkup(state.streakView(now));

    keepFocus(() => {
      $('tl').className = `tl${view.sorting ? ' sorting' : ''}`;
      $('tl').innerHTML = ui.listMarkup({ blocks, isToday, nowMin, currentIndex: status.index, sorting: view.sorting, presets, welcome });
    });
    $('quick').innerHTML = view.sorting || !blocks.length ? '' : ui.quickAddMarkup(presets.filter(p => p.quick && !p.used));

    $('sortBtn').textContent = view.sorting ? 'Listo' : 'Ordenar';
    $('sortBtn').classList.toggle('on', view.sorting);
    $('sortBtn').hidden = blocks.length < 2 && !view.sorting;
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

function toggleDone(ctx, key, id) {
  const result = ctx.state.toggleDone(key, id);
  if (!result.ok) return;
  const reachedGoal = result.done && !result.before.met && result.after.met;
  if (reachedGoal && key === toDateKey(ctx.clock())) {
    const { current } = ctx.state.streakView();
    vibrate(30);
    ctx.cloud.track('daily_goal_met', { streak: current });
    ctx.toast.show(`¡Objetivo de hoy cumplido! Racha: ${plural(current, 'día', 'días')}`, { duration: 6000 });
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
    if (e.target.id === 'back') { view.selectedDow = ctx.clock().getDay(); ctx.render(); }
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

const editor = { key: null, id: null, category: 'libre' };

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
  $('fC').innerHTML = ui.categoryChipsMarkup();
  $('fC').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) selectCategory(chip.dataset.c);
  });

  $('saveBtn').addEventListener('click', () => {
    const draft = {
      t: $('fT').value.trim(),
      s: fromHHMM($('fS').value),
      e: fromHHMM($('fE').value),
      c: editor.category,
      n: $('fN').value.trim()
    };
    const result = editor.id
      ? ctx.state.updateBlock(editor.key, editor.id, draft)
      : ctx.state.addBlock(editor.key, draft);
    if (!result.ok) { showEditorError(result.error); return; }
    ctx.cloud.track('activity_saved', { is_new: !editor.id });
    ctx.editSheet.close();
  });
  $('cancelBtn').addEventListener('click', ctx.editSheet.close);
  $('delBtn').addEventListener('click', () => {
    ctx.editSheet.close();
    removeWithUndo(ctx, editor.key, editor.id);
  });
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

function setupSettings(ctx) {
  const { state, notifier, cloud, toast } = ctx;
  const install = createInstallPrompt(() => refreshSettings());

  function refreshSettings() {
    const n = describeNotifications(ctx);
    $('notifySwitch').setAttribute('aria-checked', n.on);
    $('notifySwitch').disabled = n.disabled;
    $('notifyStatus').textContent = n.text;

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
    notifier.sync(state.upcomingStarts(ctx.clock(), NOTIFICATIONS.nativeHorizonDays, NOTIFICATIONS.nativeMaxPending));
  }, 600);

  const announce = block => {
    if (!ctx.native && notifier.status().enabled) notifier.announce(block);
    else if (!document.hidden) toast.show(`Ahora: ${shortTitle(block.t)}`, { duration: 6000 });
  };

  const checkStarts = (now, silent) => {
    const key = toDateKey(now);
    const started = watcher.collect(key, state.getDay(key), minutesOfDay(now));
    if (!silent && !isGated(ctx)) started.forEach(announce);
  };

  function tick(force = false) {
    const now = ctx.clock();
    const dateKey = toDateKey(now);
    if (dateKey !== view.dateKey) { view.dateKey = dateKey; view.selectedDow = now.getDay(); force = true; }
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

function main() {
  const ctx = createContext();
  createRenderer(ctx);
  setupNavigation(ctx);
  setupList(ctx);
  setupEditor(ctx);
  setupStats(ctx);
  setupSettings(ctx);
  setupAccount(ctx);
  setupClock(ctx).start();
}

main();
