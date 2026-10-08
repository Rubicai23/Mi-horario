/**
 * weekly-ui.js — Resumen automático de la semana pasada. Es opcional (apagado por defecto): solo aparece
 * al abrir la app en una semana nueva, una vez por semana, y únicamente si la semana anterior tuvo actividades.
 */
import { CATEGORIES } from './config.js';
import { buildShareText, weeklyDue } from './summary.js';
import { shareText } from './platform.js';
import * as ui from './ui-components.js';
import { addDays, toDateKey, weekDates } from './utils.js';
import { t } from './i18n.js';

const $ = id => document.getElementById(id);

export function setupWeekly(ctx) {
  const { state } = ctx;
  const mondayKey = now => toDateKey(weekDates(now)[0]);
  let current = null;

  const open = (now, { force = false } = {}) => {
    const prev = addDays(now, -7);
    current = { range: ui.weekRangeLabel(weekDates(prev)), summary: state.weekSummary(prev) };
    const had = Object.keys(current.summary).length > 0;
    if (!force && !weeklyDue({
      enabled: state.settings.getFlag('weekly'), seen: state.settings.get('weeklySeen'), thisMonday: mondayKey(now), hadActivities: had
    })) return false;
    state.settings.set('weeklySeen', mondayKey(now));
    $('weeklyRange').textContent = current.range;
    $('weeklyBody').innerHTML = ui.statsMarkup(current.summary, { empty: 'Sin actividades esta semana.' });
    const streak = state.streakView(now).current;
    $('weeklyStreak').textContent = streak > 0 ? t('Racha: {0} días 🔥', streak) : '';
    ctx.weeklySheet.open();
    return true;
  };

  ctx.maybeShowWeekly = () => {
    if (!$('tour').hidden) return;
    open(ctx.clock());
  };

  /** Al activar el ajuste no sale de golpe: empieza a contar desde la semana que viene. */
  ctx.markWeeklySeen = () => state.settings.set('weeklySeen', mondayKey(ctx.clock()));

  $('closeWeekly').addEventListener('click', ctx.weeklySheet.close);
  $('weeklyShare').addEventListener('click', async () => {
    if (!current) return;
    const text = buildShareText({
      summary: current.summary, range: current.range, streak: state.streakView(ctx.clock()).current,
      categories: CATEGORIES, nameOf: ui.categoryName
    });
    try {
      if ((await shareText(text)) === 'copied') ctx.toast.show('Resumen copiado. Pégalo donde quieras.');
    } catch (_) { ctx.toast.show('No se pudo compartir el resumen.', { duration: 5000 }); }
  });
}
