/**
 * platform.js — Adaptadores entre la web (PWA) y Capacitor (Android/iOS):
 * notificaciones, entrega de archivos, service worker e instalación.
 *
 * Los plugins de Capacitor se cargan bajo demanda (import dinámico) y solo en dispositivos nativos.
 */
import { Capacitor } from '@capacitor/core';
import { hashToInt, shortTitle, toHHMM } from './utils.js';

export const isNative = () => Capacitor.isNativePlatform();

export const platformInfo = (() => {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = Boolean(navigator.standalone)
    || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return Object.freeze({ ios, standalone });
})();

/* ───────── Service worker (solo web, nunca en la app nativa ni en desarrollo) ───────── */
export async function registerServiceWorker() {
  const dev = Boolean(import.meta.env && import.meta.env.DEV);
  if (isNative() || dev || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return null;
  try { return await navigator.serviceWorker.register('sw.js'); } catch (_) { return null; }
}

/* ───────── Instalación como PWA ───────── */
export function createInstallPrompt(onChange) {
  let deferred = null;
  if (!isNative()) {
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event; onChange(); });
    window.addEventListener('appinstalled', () => { deferred = null; onChange(); });
  }
  return {
    available: () => deferred !== null,
    async prompt() {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      onChange();
    }
  };
}

/** Título del aviso: "¡Toca Inglés!" al empezar, o "En 10 min: Inglés" con antelación. */
export const reminderTitle = (block, lead = 0) => (lead > 0
  ? `En ${lead} min: ${shortTitle(block.t)}`
  : `¡Toca ${shortTitle(block.t)}!`);

/* ───────── Notificaciones ─────────
 * Web:    se avisa mientras la app está abierta o recién pasada a segundo plano (limitación del navegador).
 * Nativo: se programan las próximas actividades como notificaciones locales; suenan con la app cerrada. */
export function createNotifier({ settings, getRegistration }) {
  const native = isNative();
  const webSupported = typeof Notification !== 'undefined';
  let nativePermission = 'prompt';          // prompt | granted | denied
  let queue = Promise.resolve();            // serializa las operaciones del plugin nativo

  const plugin = () => import('@capacitor/local-notifications').then(m => m.LocalNotifications);
  const mapPermission = display => (display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt');

  const status = () => {
    if (native) {
      return {
        native, supported: true, permission: nativePermission, needsInstall: false,
        enabled: nativePermission === 'granted' && settings.getFlag('notify')
      };
    }
    const permission = webSupported ? Notification.permission : 'unsupported';
    return {
      native,
      supported: webSupported,
      permission,
      needsInstall: !webSupported && platformInfo.ios && !platformInfo.standalone,
      enabled: webSupported && permission === 'granted' && settings.getFlag('notify')
    };
  };

  const requestWebPermission = () => new Promise(resolve => {
    const maybePromise = Notification.requestPermission(resolve); // Safari antiguo usa callback
    if (maybePromise && typeof maybePromise.then === 'function') maybePromise.then(resolve);
  });

  const cancelAllPending = async () => {
    const notifications = (await (await plugin()).getPending()).notifications;
    if (notifications.length) await (await plugin()).cancel({ notifications: notifications.map(({ id }) => ({ id })) });
  };

  return {
    status,

    /** Lee el permiso actual del sistema (necesario en nativo, donde la consulta es asíncrona). */
    async refresh() {
      if (!native) return;
      try { nativePermission = mapPermission((await (await plugin()).checkPermissions()).display); } catch (_) { /* nada */ }
    },

    async enable() {
      if (native) {
        try { nativePermission = mapPermission((await (await plugin()).requestPermissions()).display); } catch (_) { return 'unsupported'; }
        settings.setFlag('notify', nativePermission === 'granted');
        return nativePermission;
      }
      if (!webSupported) return 'unsupported';
      const result = Notification.permission === 'granted' ? 'granted' : await requestWebPermission();
      settings.setFlag('notify', result === 'granted');
      return result;
    },

    disable() {
      settings.setFlag('notify', false);
      if (native) queue = queue.then(cancelAllPending).catch(() => {});
      return queue;
    },

    /** Web: aviso de que una actividad empieza ya (`lead` = 0) o en `lead` minutos. */
    async announce(block, lead = 0) {
      if (native || !status().enabled) return;
      const title = reminderTitle(block, lead);
      const options = {
        body: `${toHHMM(block.s)} – ${toHHMM(block.e)}${shortTitle(block.t) === block.t ? '' : `\n${block.t}`}`,
        tag: `start-${block.id}-${lead}`,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png'
      };
      try {
        const registration = await getRegistration();
        if (registration && registration.showNotification) await registration.showNotification(title, options);
        else new Notification(title, options);
      } catch (_) { /* algunos navegadores bloquean el constructor */ }
    },

    /** Nativo: reprograma los próximos avisos. `upcoming` = [{ key, block, at, lead }] (`at` = cuándo suena). */
    sync(upcoming) {
      if (!native) return Promise.resolve();
      const wanted = status().enabled ? upcoming : [];
      queue = queue.then(async () => {
        await cancelAllPending();
        if (!wanted.length) return;
        await (await plugin()).schedule({
          notifications: wanted.map(({ key, block, at, lead = 0 }) => ({
            id: hashToInt(`${key}:${block.id}`),
            title: reminderTitle(block, lead),
            body: `${toHHMM(block.s)} – ${toHHMM(block.e)}`,
            schedule: { at, allowWhileIdle: true }
          }))
        });
      }).catch(() => { /* permiso revocado o plugin no disponible */ });
      return queue;
    }
  };
}

/* ───────── Entrega de archivos (copia de seguridad) ───────── */

/** Devuelve 'shared' | 'downloaded' | 'cancelled'. */
export async function deliverFile(file) {
  if (isNative()) return deliverFileNative(file);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia de Mi horario' }); return 'shared'; } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

/** WebView nativo: las descargas con <a download> no funcionan; se escribe en caché y se abre la hoja de compartir. */
async function deliverFileNative(file) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share')
  ]);
  const { uri } = await Filesystem.writeFile({
    path: file.name, data: await file.text(), directory: Directory.Cache, encoding: Encoding.UTF8
  });
  try {
    await Share.share({ title: 'Copia de Mi horario', url: uri, dialogTitle: 'Guardar copia' });
    return 'shared';
  } catch (err) {
    if (/cancel/i.test(String(err && (err.message || err)))) return 'cancelled';
    throw err;
  }
}

/** Lee un archivo seleccionado por el usuario como texto. */
export const readFileAsText = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.readAsText(file);
});
