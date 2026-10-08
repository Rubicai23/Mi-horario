/**
 * push-ui.js — Avisos con la app cerrada (Web Push). Opcional y solo con sesión iniciada.
 * La app guarda en la nube los próximos avisos (título y hora de cada actividad) y una función programada
 * los envía a su hora. Si PUSH.vapidKey está vacío, el ajuste no se muestra.
 */
import { PUSH } from './config.js';
import { reminderTitle } from './platform.js';
import { toHHMM } from './utils.js';

const debounce = (fn, ms) => {
  let timer = null;
  return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
};

const $ = id => document.getElementById(id);

export const pushAvailable = ctx => Boolean(
  PUSH.vapidKey && !ctx.native && typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
);

export function setupPush(ctx) {
  const { state, cloud, toast } = ctx;
  const active = () => pushAvailable(ctx) && state.settings.getFlag('push') && Notification.permission === 'granted'
    && ctx.account.status === 'signedIn';
  ctx.pushActive = active;

  ctx.syncPush = debounce(() => {
    if (!active()) return;
    const lead = Number(state.settings.get('lead')) || 0;
    const items = state.upcomingStarts(ctx.clock(), PUSH.horizonDays, PUSH.maxItems, lead).map(({ block, at }) => ({
      at: at.getTime(), t: reminderTitle(block, lead), b: `${toHHMM(block.s)} – ${toHHMM(block.e)}`
    }));
    cloud.pushSchedule(items);
  }, 1500);

  const describe = () => {
    if (!pushAvailable(ctx)) return null;
    if (ctx.account.status !== 'signedIn') return { on: false, disabled: true, text: 'Inicia sesión para usar los avisos con la app cerrada.' };
    const on = active();
    return {
      on, disabled: false,
      text: on
        ? 'Activado. Te llegan los avisos aunque la app esté cerrada. Se guarda en la nube la hora y el título de tus próximas actividades.'
        : 'Desactivado. Si lo activas, los avisos llegan aunque la app esté cerrada (en iPhone, con la app añadida a la pantalla de inicio).'
    };
  };

  ctx.refreshPushSetting = () => {
    const d = describe();
    $('pushRow').hidden = !d;
    if (!d) return;
    $('pushSwitch').setAttribute('aria-checked', d.on);
    $('pushSwitch').disabled = d.disabled;
    $('pushStatus').textContent = d.text;
  };

  $('pushSwitch').addEventListener('click', async () => {
    if (active()) {
      state.settings.setFlag('push', false);
      await cloud.disablePush();
      ctx.refreshPushSetting();
      return;
    }
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') { toast.show('Permiso de notificaciones denegado.', { duration: 5000 }); return; }
      const registration = await navigator.serviceWorker.ready;
      await cloud.enablePush(PUSH.vapidKey, registration);
      state.settings.setFlag('push', true);
      ctx.syncPush();
      toast.show('Avisos con la app cerrada activados.');
    } catch (_) {
      toast.show('No se pudo activar. Comprueba la conexión e inténtalo de nuevo.', { duration: 6000 });
    }
    ctx.refreshPushSetting();
  });
}
