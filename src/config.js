/**
 * config.js — Constantes y datos estáticos. Sin lógica, sin DOM, sin dependencias.
 */

/* ───────── Claves de almacenamiento local ───────── */
export const STORAGE = Object.freeze({
  dayPrefix: 'day:',        // day:YYYY-MM-DD  -> JSON con las actividades del día
  uid: 'meta:uid',          // cuenta que "posee" los datos locales de este dispositivo
  dirty: 'meta:dirty',      // cambios locales pendientes de confirmar en la nube
  settingPrefix: 'cfg:'     // cfg:notify, cfg:analytics
});

/* ───────── Límites y reglas de negocio ───────── */
export const MAX_MIN = 1439;            // 23:59
export const LIMITS = Object.freeze({
  blocksPerDay: 60,                     // debe coincidir con firestore.rules
  titleLength: 80,
  noteLength: 300
});

/** Un día "cumple" cuando se completa al menos goalNum/goalDen de sus actividades. */
export const STREAK_RULES = Object.freeze({
  goalNum: 4,
  goalDen: 5,               // 4/5 = 80 %
  maxRestGap: 2,            // días vacíos seguidos que no rompen la racha (p. ej. un fin de semana sin plan)
  maxLookbackDays: 730
});

export const NOTIFICATIONS = Object.freeze({
  nativeHorizonDays: 7,     // días por delante que se programan en Android/iOS
  nativeMaxPending: 60      // iOS admite 64 notificaciones locales pendientes
});

export const BACKUP = Object.freeze({ app: 'mi-horario', version: 1 });

/* ───────── Calendario ───────── */
export const DAY_NAMES = Object.freeze(['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']);
export const DAY_LETTERS = Object.freeze(['D', 'L', 'M', 'X', 'J', 'V', 'S']);

/* ───────── Categorías ───────── */
export const CATEGORIES = Object.freeze([
  { key: 'clase',   label: 'Clase',    color: 'var(--c-clase)' },
  { key: 'gym',     label: 'Gimnasio', color: 'var(--c-gym)' },
  { key: 'estudio', label: 'Estudio',  color: 'var(--c-estudio)' },
  { key: 'ingles',  label: 'Inglés',   color: 'var(--c-ingles)' },
  { key: 'libre',   label: 'Libre',    color: 'var(--c-libre)' },
  { key: 'rutina',  label: 'Rutina',   color: 'var(--c-rutina)' }
].map(Object.freeze));

/* ───────── Plantillas para el onboarding ─────────
 * Cada fila: [inicio, fin, título, categoría]. Un día nuevo empieza vacío; el usuario
 * añade estas plantillas con un toque y después edita lo que quiera. */
const MORNING = [
  ['07:00', '07:30', 'Despertar y desayuno', 'rutina'],
  ['07:30', '08:00', 'Ducha y cuidado personal', 'rutina'],
  ['08:00', '08:15', 'Repasar el plan del día', 'estudio']
];

const FOCUS_DAY = [
  ['09:00', '11:00', 'Bloque de enfoque 1', 'estudio'],
  ['11:00', '11:15', 'Descanso', 'libre'],
  ['11:15', '13:15', 'Bloque de enfoque 2', 'estudio'],
  ['13:15', '14:15', 'Comida y descanso', 'rutina'],
  ['14:15', '16:15', 'Bloque de enfoque 3', 'estudio'],
  ['16:15', '16:30', 'Cerrar el día y planificar mañana', 'rutina']
];

/* Horario de ejemplo (semana de un estudiante de DAM). Índice = Date.getDay(). */
const WAKE = ['07:00', '08:15', 'Despertar, desayuno, skincare y trayecto', 'rutina'];
const GYM = [
  ['16:15', '16:30', 'Desplazamiento al gimnasio', 'rutina'],
  ['16:30', '18:30', 'Gimnasio (fuerza + cardio)', 'gym'],
  ['18:30', '19:00', 'Retorno, ducha y batido post-entreno', 'gym']
];
const NIGHT = [
  ['20:30', '21:15', 'Inglés (45 min, enfoque total)', 'ingles'],
  ['21:15', '22:00', 'Paseo (cardio ligero, desconexión)', 'libre'],
  ['22:00', '23:00', 'Cena, rutina facial y a la cama sin pantallas', 'rutina']
];
const MON_TUE = [
  WAKE,
  ['08:15', '14:45', 'Clases DAM', 'clase'],
  ['14:45', '16:15', 'Trayecto, almuerzo y descanso corto', 'rutina'],
  ...GYM,
  ['19:00', '20:30', 'Bloque móvil: estudio DAM / autoescuela', 'estudio'],
  ...NIGHT
];
const WED_THU = [
  WAKE,
  ['08:15', '13:45', 'Clases DAM', 'clase'],
  ['13:45', '14:45', 'Trayecto, almuerzo rápido y descanso', 'rutina'],
  ['14:45', '16:15', 'Ocio puro (jugar/leer) o recuperar estudio', 'libre'],
  ...GYM,
  ['19:00', '20:30', 'Bloque móvil: estudio DAM / taller', 'estudio'],
  ...NIGHT
];
const FRIDAY = [
  WAKE,
  ['08:15', '14:45', 'Clases DAM', 'clase'],
  ['14:45', '16:15', 'Trayecto, almuerzo y descanso', 'rutina'],
  ['16:15', '20:30', 'Libre (fin de semana / amigos)', 'libre'],
  ['20:30', '21:15', 'Libre / ocio', 'libre'],
  ['21:15', '22:00', 'Libre / cena fuera', 'libre'],
  ['22:00', '23:00', 'Libre (sin hora de dormir)', 'libre']
];
const SAMPLE_WEEK = [null, MON_TUE, MON_TUE, WED_THU, WED_THU, FRIDAY, null];

/**
 * `rows(dow)` devuelve las filas de la plantilla para ese día de la semana o null si no aplica.
 * `quick`: se ofrece también como atajo cuando el día ya tiene actividades.
 */
export const PRESETS = Object.freeze([
  Object.freeze({ id: 'morning', quick: true, icon: 'sun', label: 'Rutina de mañana', title: 'Añadir rutina de mañana', rows: () => MORNING }),
  Object.freeze({ id: 'focus', quick: true, icon: 'book', label: 'Jornada de estudio/trabajo', title: 'Añadir jornada de estudio/trabajo', rows: () => FOCUS_DAY }),
  Object.freeze({ id: 'sample-dam', quick: false, icon: 'cap', label: 'Horario DAM de ejemplo', title: 'Usar el horario DAM de ejemplo', rows: dow => SAMPLE_WEEK[dow] })
]);

/* ───────── Firebase (clave pública del cliente: la protección real son firestore.rules) ───────── */
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyDXfsCjQso4-hWjhVvnh4TFiOQ65CZr0J8',
  authDomain: 'mi-horario-5e8b1.firebaseapp.com',
  projectId: 'mi-horario-5e8b1',
  storageBucket: 'mi-horario-5e8b1.firebasestorage.app',
  messagingSenderId: '648700193583',
  appId: '1:648700193583:web:158cd44f811959e5a74fda',
  measurementId: 'G-XZTVCMFT0C'
});
