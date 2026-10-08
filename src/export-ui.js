/**
 * export-ui.js — Hoja «Exportar al calendario»: elige días y aviso y entrega un archivo .ics.
 */
import { LEAD_OPTIONS } from './config.js';
import { buildIcs } from './ics.js';
import { deliverFile } from './platform.js';
import { t } from './i18n.js';
import * as ui from './ui-components.js';
import { addDays, plural, toDateKey } from './utils.js';

const { $ } = ui;
const RANGES = Object.freeze([
  { id: 'week', days: 7, label: 'Próximos 7 días' },
  { id: 'month', days: 28, label: 'Próximas 4 semanas' },
  { id: 'quarter', days: 90, label: 'Próximos 3 meses' }
]);

export function setupExport(ctx) {
  const { state, toast } = ctx;
  const choice = { range: 'month', alarm: '10' };

  /** Días desde hoy con sus actividades (incluye las que salen de repeticiones semanales). */
  const collect = () => {
    const today = ctx.clock();
    const total = RANGES.find(r => r.id === choice.range).days;
    return Array.from({ length: total }, (_, i) => {
      const key = toDateKey(addDays(today, i));
      return { key, blocks: state.getDay(key) };
    }).filter(day => day.blocks.length);
  };

  const paint = () => {
    $('exportRange').innerHTML = RANGES.map(r => (
      `<button type="button" class="chip${r.id === choice.range ? ' sel' : ''}" data-range="${r.id}" aria-pressed="${r.id === choice.range}">${t(r.label)}</button>`
    )).join('');
    const days = collect();
    const events = days.reduce((n, d) => n + d.blocks.length, 0);
    $('exportInfo').textContent = events
      ? t('Se exportarán {0} en {1}.', plural(events, 'actividad', 'actividades'), plural(days.length, 'día', 'días'))
      : t('No hay actividades en ese periodo.');
    $('exportGo').disabled = events === 0;
  };

  $('exportAlarm').innerHTML = ['none', ...LEAD_OPTIONS].map(v => {
    const label = v === 'none' ? t('Sin aviso') : v === 0 ? t('Al empezar') : t('{0} min antes', v);
    return `<option value="${v}">${label}</option>`;
  }).join('');
  $('exportAlarm').value = choice.alarm;
  $('exportAlarm').addEventListener('change', e => { choice.alarm = e.target.value; });

  $('exportRange').addEventListener('click', e => {
    const chip = e.target.closest('[data-range]');
    if (!chip) return;
    choice.range = chip.dataset.range;
    paint();
    const again = document.querySelector(`#exportRange [data-range="${choice.range}"]`);
    if (again) again.focus();
  });

  $('menuExport').addEventListener('click', () => {
    $('exportErr').hidden = true;
    paint();
    ctx.exportSheet.open();
  });
  $('exportCancel').addEventListener('click', ctx.exportSheet.close);

  $('exportGo').addEventListener('click', async () => {
    const days = collect();
    if (!days.length) return;
    const ics = buildIcs({
      days, now: new Date(), alarm: choice.alarm === 'none' ? null : Number(choice.alarm),
      categoryName: ui.categoryName, tagName: id => (state.tagName ? state.tagName(id) : '')
    });
    const file = new File([ics], `horario-${toDateKey(ctx.clock())}.ics`, { type: 'text/calendar' });
    try {
      const result = await deliverFile(file);
      if (result === 'cancelled') return;
      ctx.cloud.track('calendar_exported');
      ctx.exportSheet.close();
      toast.show(result === 'downloaded' ? t('Archivo descargado. Ábrelo para añadirlo al calendario.') : t('Archivo listo para el calendario'), { duration: 6000 });
    } catch (_) {
      $('exportErr').textContent = t('No se pudo crear el archivo.');
      $('exportErr').hidden = false;
    }
  });
}
