/**
 * tour.js — Tutorial de 3 pantallas: se muestra una vez a quien estrena la app y se puede repetir desde el menú.
 */
import * as ui from './ui-components.js';

const { $ } = ui;
const STEPS = Object.freeze([
  { art: '📅', title: 'Tu día, a tu manera', text: 'Toca «Añadir» para crear actividades con su hora. Marca el círculo cuando las hagas y desliza una fila para editarla o borrarla.' },
  { art: '🔥', title: 'Constancia sin agobios', text: 'Cumple tu meta del día para mantener la racha. Puedes marcar días de descanso, ajustar la meta en Ajustes y ganar insignias por el camino.' },
  { art: '⏱️', title: 'Más herramientas', text: 'En el menú ☰ tienes el Pomodoro para concentrarte por tramos. Con «Más» copias días, guardas plantillas y creas repeticiones semanales.' }
]);

export function setupTour(ctx) {
  const { state } = ctx;
  let step = 0;
  let opener = null;

  const paint = () => {
    const last = step === STEPS.length - 1;
    $('tourArt').textContent = STEPS[step].art;
    $('tourTitle').textContent = STEPS[step].title;
    $('tourText').textContent = STEPS[step].text;
    $('tourDots').innerHTML = STEPS.map((_, i) => `<i${i === step ? ' class="on"' : ''}></i>`).join('');
    $('tourNext').textContent = last ? 'Empezar' : 'Siguiente';
    $('tourSkip').hidden = last;
  };

  const close = () => {
    $('tour').hidden = true;
    $('app').inert = false;
    document.body.classList.remove('lock');
    state.settings.setFlag('tour', true);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  };

  ctx.openTour = () => {
    ctx.sheets.closeActive();
    opener = document.activeElement;
    step = 0;
    paint();
    $('tour').hidden = false;
    $('app').inert = true;
    document.body.classList.add('lock');
    $('tourNext').focus({ preventScroll: true });
  };

  /** Solo a quien estrena la app: sin tutorial visto y sin ningún día guardado. */
  let checked = false;
  ctx.maybeShowTour = () => {
    if (checked) return;
    checked = true;
    if (state.settings.getFlag('tour')) return;
    if (state.savedDayCount() > 0) { state.settings.setFlag('tour', true); return; }
    setTimeout(ctx.openTour, 500);
  };

  $('tourNext').addEventListener('click', () => { if (step >= STEPS.length - 1) close(); else { step += 1; paint(); } });
  $('tourSkip').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('tour').hidden) close(); });
}
