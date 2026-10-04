/**
 * firebase-service.js — Única puerta de entrada a Firebase (Auth, Firestore y Analytics).
 * El resto de la app solo conoce la interfaz que devuelve `createCloudService`; no importa Firebase.
 *
 * Modelo de datos:  users/{uid}/days/{YYYY-MM-DD}  →  { blocks: [...], updatedAt: serverTimestamp }
 *
 * Estados de cuenta: loading → signedIn | signedOut | unavailable
 */
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence, createUserWithEmailAndPassword, indexedDBLocalPersistence, initializeAuth,
  onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut
} from 'firebase/auth';
import {
  collection, deleteDoc, doc, initializeFirestore, memoryLocalCache, onSnapshot, persistentLocalCache,
  persistentMultipleTabManager, persistentSingleTabManager, serverTimestamp, setDoc
} from 'firebase/firestore';

const AUTH_MESSAGES = Object.freeze({
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/email-already-in-use': 'Ese correo ya tiene cuenta. Pulsa Entrar.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/network-request-failed': 'Sin conexión. Inténtalo de nuevo.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un momento.',
  'auth/operation-not-allowed': 'Activa "Correo electrónico/contraseña" en Firebase → Authentication → Método de acceso.',
  'auth/configuration-not-found': 'Authentication no está iniciado: en la consola de Firebase abre Authentication y pulsa "Comenzar".',
  'auth/unauthorized-domain': 'Añade este dominio en Authentication → Configuración → Dominios autorizados.',
  'auth/admin-restricted-operation': 'El registro de cuentas nuevas está desactivado en Firebase → Authentication → Configuración.',
  'auth/invalid-api-key': 'La clave de API de Firebase no es válida. Revisa la configuración.',
  'auth/api-key-not-valid': 'La clave de API de Firebase no es válida. Revisa la configuración.',
  'auth/internal-error': 'Error interno de Firebase. Inténtalo de nuevo en un momento.'
});

const toAuthError = err => {
  const code = (err && err.code) || 'desconocido';
  const error = new Error(AUTH_MESSAGES[code] || `No se pudo completar la operación (${code}).`);
  error.code = code;
  return error;
};

const noop = () => {};

/**
 * @param {object} options
 * @param {object} options.config  firebaseConfig del proyecto
 * @param {boolean} [options.native]  true dentro de Capacitor (Android/iOS)
 */
export function createCloudService({ config, native = false }) {
  const handlers = { state: noop, days: noop, error: noop };
  let app = null;
  let auth = null;
  let db = null;
  let user = null;
  let stopWatching = null;
  let initPromise = null;
  let analytics = null;
  let analyticsModule = null;
  let analyticsOn = false;

  const publishState = status => handlers.state({
    status,
    email: user ? user.email || '' : '',
    uid: user ? user.uid : ''
  });

  /* Caché local persistente: permite leer y escribir sin conexión. */
  const createFirestore = firebaseApp => {
    try {
      const tabManager = native ? persistentSingleTabManager({}) : persistentMultipleTabManager();
      return initializeFirestore(firebaseApp, { localCache: persistentLocalCache({ tabManager }) });
    } catch (_) {
      return initializeFirestore(firebaseApp, { localCache: memoryLocalCache() });
    }
  };

  const dayRef = (uid, key) => doc(db, 'users', uid, 'days', key);

  const stopDaysListener = () => {
    if (stopWatching) { stopWatching(); stopWatching = null; }
  };

  const watchDays = () => {
    stopWatching = onSnapshot(
      collection(db, 'users', user.uid, 'days'),
      snapshot => handlers.days({
        fromCache: snapshot.metadata.fromCache,
        remoteKeys: snapshot.docs.map(d => d.id),
        changes: snapshot.docChanges().map(change => ({
          key: change.doc.id,
          blocks: change.type === 'removed' ? null : change.doc.data().blocks
        }))
      }),
      error => handlers.error(error)
    );
  };

  const onUserChanged = nextUser => {
    stopDaysListener();
    user = nextUser;
    publishState(nextUser ? 'signedIn' : 'signedOut');
    if (nextUser) watchDays();
  };

  const requireAuth = () => {
    if (!auth) throw new Error('Sin conexión con la nube.');
    return auth;
  };

  return {
    /** Inicializa Firebase una sola vez. Nunca rechaza: publica el estado 'unavailable' si falla. */
    init() {
      if (initPromise) return initPromise;
      publishState('loading');
      initPromise = Promise.resolve().then(() => {
        app = getApps().length ? getApp() : initializeApp(config);
        // initializeAuth (en vez de getAuth) evita cargar el iframe de redirección, que falla en WebViews de Capacitor.
        auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
        db = createFirestore(app);
        onAuthStateChanged(auth, onUserChanged, error => handlers.error(error));
      }).catch(error => {
        console.error('Firebase no se pudo inicializar:', error);
        initPromise = null;
        publishState('unavailable');
      });
      return initPromise;
    },

    onState(fn) { handlers.state = fn; },
    onDays(fn) { handlers.days = fn; },
    onError(fn) { handlers.error = fn; },

    /* ── Cuenta ── */
    async signIn(email, password) {
      try { await signInWithEmailAndPassword(requireAuth(), email, password); } catch (err) { throw toAuthError(err); }
    },
    async signUp(email, password) {
      try { await createUserWithEmailAndPassword(requireAuth(), email, password); } catch (err) { throw toAuthError(err); }
    },
    async signOut() {
      try { await signOut(requireAuth()); } catch (err) { throw toAuthError(err); }
    },
    async resetPassword(email) {
      try { await sendPasswordResetEmail(requireAuth(), email); } catch (err) {
        if (err && err.code === 'auth/user-not-found') return; // no revelamos si el correo existe
        throw toAuthError(err);
      }
    },

    /* ── Datos. Devuelven true cuando el servidor confirma (offline: la promesa queda pendiente). ── */
    async pushDay(key, blocks) {
      if (!db || !user) return false;
      const { uid } = user;
      try {
        await setDoc(dayRef(uid, key), {
          blocks: JSON.parse(JSON.stringify(blocks)), // quita undefined: Firestore los rechaza
          updatedAt: serverTimestamp()
        });
        return true;
      } catch (error) {
        handlers.error(error);
        return false;
      }
    },
    async removeDay(key) {
      if (!db || !user) return false;
      const { uid } = user;
      try {
        await deleteDoc(dayRef(uid, key));
        return true;
      } catch (error) {
        handlers.error(error);
        return false;
      }
    },

    /* ── Analytics: no se inicia hasta que el usuario lo acepta. 'on' | 'off' | 'unsupported' ── */
    async setAnalytics(enabled) {
      if (native || !app) return 'unsupported'; // en Android/iOS haría falta el plugin nativo de Firebase Analytics
      if (!enabled && !analytics) return 'off';
      try {
        analyticsModule = analyticsModule || await import('firebase/analytics');
        if (!(await analyticsModule.isSupported())) return 'unsupported';
        if (enabled && !analytics) {
          const debug = /[?&]debug=1(?:&|$)/.test(location.search); // ?debug=1 → visible en DebugView
          analytics = debug
            ? analyticsModule.initializeAnalytics(app, { config: { debug_mode: true } })
            : analyticsModule.getAnalytics(app);
        }
        if (analytics) analyticsModule.setAnalyticsCollectionEnabled(analytics, enabled);
        analyticsOn = enabled && Boolean(analytics);
        return enabled ? 'on' : 'off';
      } catch (_) {
        return 'unsupported';
      }
    },

    /** Solo eventos genéricos: nunca títulos ni notas. */
    track(name, params) {
      if (!analyticsOn || !analytics || !analyticsModule) return;
      try { analyticsModule.logEvent(analytics, name, params); } catch (_) { /* nada */ }
    }
  };
}
