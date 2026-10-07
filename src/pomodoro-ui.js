/**
 * pomodoro-ui.js — Pantalla del Pomodoro y menú principal. El temporizador (pomodoro.js) no sabe nada del DOM.
 */
import { POMODORO_OPTIONS, createPomodoro, formatClock } from './pomodoro.js';
import { t } from './i18n.js';
import { toDateKey } from './utils.js';
import * as ui from './ui-components.js';

const { $ } = ui;
const PHASE_LABEL = { focus: t('Concentración'), short: t('Descanso corto'), long: t('Descanso largo') };
const PHASE_LOWER = { focus: t('concentración'), short: t('descanso corto'), long: t('descanso largo') };
const optionsMarkup = (values, selected) => values.map(v => `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`).join('');

/** Pitido corto con WebAudio (sin archivos). Falla en silencio si el navegador no lo permite. */
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const audio = new Ctx();
    [0, 0.25, 0.5].forEach(offset => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audio.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + offset + 0.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + offset);
      osc.stop(audio.currentTime + offset + 0.22);
    });
    setTimeout(() => audio.close().catch(() => {}), 1200);
  } catch (_) { /* sin audio */ }
}

export function setupMenuAndPomodoro(ctx, { openBadges, openTour }) {
  const { state, toast, notifier } = ctx;
  const timer = createPomodoro({
    load: () => state.settings.get('pomo'),
    save: text => state.settings.set('pomo', text),
    dayKey: ms => toDateKey(new Date(ms))
  });
  ctx.pomodoro = timer;
  const now = () => ctx.clock().getTime();

  /* Menú */
  $('openMenu').addEventListener('click', () => ctx.menuSheet.open());
  $('closeMenu').addEventListener('click', ctx.menuSheet.close);
  $('menuPomo').addEventListener('click', () => { paint(); ctx.pomodoroSheet.open(); });
  $('menuBadges').addEventListener('click', () => openBadges());
  $('menuTour').addEventListener('click', () => openTour());
  $('pomoPill').addEventListener('click', () => { paint(); ctx.pomodoroSheet.open(); });
  $('closePomo').addEventListener('click', ctx.pomodoroSheet.close);

  const select = (id, key) => {
    $(id).innerHTML = optionsMarkup(POMODORO_OPTIONS[key], timer.view(now()).config[key]);
    $(id).addEventListener('change', e => { timer.setConfig({ [key]: Number(e.target.value) }, now()); schedule(); paint(); });
  };
  select('pomoFocus', 'focus'); select('pomoShort', 'short'); select('pomoLong', 'long'); select('pomoRounds', 'rounds');

  /** Nativo: el aviso de fin de fase se programa al empezar y se cancela al parar. */
  function schedule() {
    if (!ctx.native) return;
    const v = timer.view(now());
    if (!v.running) { notifier.schedulePomodoro(null); return; }
    notifier.schedulePomodoro(new Date(now() + v.remainingMs), phaseEndTitle(v.phase), phaseNextBody(v.phase));
  }
  const phaseEndTitle = phase => (phase === 'focus' ? t('¡Tiempo de descansar!') : t('¡A concentrarse otra vez!'));
  const phaseNextBody = phase => (phase === 'focus' ? t('Has terminado un pomodoro.') : t('El descanso ha terminado.'));

  function paint() {
    const v = timer.view(now());
    const started = v.running || v.remainingMs < v.totalMs;
    $('pomoPhase').textContent = PHASE_LABEL[v.phase];
    $('pomoTime').textContent = formatClock(v.remainingMs);
    $('pomoFill').style.width = `${Math.round((1 - v.remainingMs / v.totalMs) * 100)}%`;
    $('pomoRound').textContent = `Ronda ${v.round} de ${v.rounds}`;
    $('pomoToggle').textContent = v.running ? 'Pausar' : started ? 'Seguir' : 'Empezar';
    $('pomoToday').textContent = v.doneToday === 0 ? 'Hoy aún no has completado ningún pomodoro.'
      : `Pomodoros completados hoy: ${v.doneToday}`;
    const pill = $('pomoPill');
    pill.hidden = !started;
    if (started) {
      pill.textContent = formatClock(v.remainingMs);
      pill.classList.toggle('rest', v.phase !== 'focus');
      pill.classList.toggle('paused', !v.running);
      pill.setAttribute('aria-label', `Pomodoro: ${PHASE_LABEL[v.phase]}, ${formatClock(v.remainingMs)}. Abrir`);
    }
    ['pomoFocus', 'pomoShort', 'pomoLong', 'pomoRounds'].forEach(id => {
      const key = { pomoFocus: 'focus', pomoShort: 'short', pomoLong: 'long', pomoRounds: 'rounds' }[id];
      if (document.activeElement !== $(id)) $(id).value = String(v.config[key]);
    });
  }

  $('pomoToggle').addEventListener('click', () => {
    const v = timer.view(now());
    if (v.running) timer.pause(now()); else timer.start(now());
    schedule(); paint();
  });
  $('pomoSkip').addEventListener('click', () => { timer.skip(now()); schedule(); paint(); });
  $('pomoReset').addEventListener('click', () => { timer.reset(); schedule(); paint(); });

  /** Se llama cada segundo desde el reloj de la app. */
  ctx.pomodoroTick = () => {
    const finished = timer.tick(now());
    if (finished) {
      const title = phaseEndTitle(finished.ended);
      const body = finished.ended === 'focus' ? t('Toca {0}.', PHASE_LOWER[finished.next]) : t('Pulsa «Empezar» cuando estés listo.');
      if (!$('sheetPomodoro').classList.contains('open')) toast.show(`${title} ${body}`, { duration: 8000, label: 'Abrir', onAction: () => { paint(); ctx.pomodoroSheet.open(); } });
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      beep();
      if (document.hidden) notifier.announcePomodoro(title, body);
      ctx.cloud.track('pomodoro_phase_end', { phase: finished.ended });
    }
    paint();
  };
  paint();
}
