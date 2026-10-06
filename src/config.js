/**
 * config.js — Constantes y datos estáticos. Sin lógica, sin DOM, sin dependencias.
 */

/* ───────── Claves de almacenamiento local ───────── */
export const STORAGE = Object.freeze({
  dayPrefix: 'day:',        // day:YYYY-MM-DD  -> JSON con las actividades del día
  uid: 'meta:uid',          // cuenta que "posee" los datos locales de este dispositivo
  dirty: 'meta:dirty',      // cambios locales pendientes de confirmar en la nube
  profile: 'meta:profile',  // perfil del usuario (plantillas propias…): se sincroniza en un solo documento
  profileDirty: 'meta:profile-dirty',
  settingPrefix: 'cfg:'     // cfg:notify, cfg:analytics
});

/* ───────── Límites y reglas de negocio ───────── */
export const MAX_MIN = 1439;            // 23:59
export const LIMITS = Object.freeze({
  blocksPerDay: 60,                     // debe coincidir con firestore.rules
  titleLength: 80,
  noteLength: 300,
  templates: 20,                        // debe coincidir con firestore.rules
  templateName: 40,
  recurring: 40,                        // debe coincidir con firestore.rules
  subtasks: 15,
  subtaskLength: 60,
  restDays: 400,                        // debe coincidir con firestore.rules
  badges: 40                            // debe coincidir con firestore.rules
});

/** Minutos de antelación que se pueden elegir para los avisos (0 = al empezar). */
export const LEAD_OPTIONS = Object.freeze([0, 5, 10, 15, 30]);

/** Semanas que se pueden recorrer hacia atrás y hacia delante desde la actual. */
export const WEEK_RANGE = Object.freeze({ back: 104, forward: 52 });

/** Un día "cumple" cuando se completa al menos goalNum/goalDen de sus actividades. */
export const STREAK_RULES = Object.freeze({
  goalNum: 4,
  goalDen: 5,               // 4/5 = 80 %
  maxRestGap: 2,            // días vacíos seguidos que no rompen la racha (p. ej. un fin de semana sin plan)
  maxLookbackDays: 730,
  defaultGoal: 80,          // % por defecto
  goalOptions: Object.freeze([50, 60, 70, 80, 90, 100])
});

/**
 * Insignias. Se calculan con el historial y, al conseguirlas, se guardan con su fecha.
 * kind: done = actividades completadas en total · streak = mejor racha · days = días con objetivo cumplido
 *       week = semanas perfectas (objetivo cumplido todos los días con actividades, mínimo 3 días).
 */
export const BADGES = Object.freeze([
  { id: 'primer-paso',    kind: 'done',   target: 1,   icon: 'check', title: 'Primer paso',      desc: 'Completa tu primera actividad.' },
  { id: 'en-marcha',      kind: 'done',   target: 25,  icon: 'check', title: 'En marcha',        desc: 'Completa 25 actividades.' },
  { id: 'cien-hechas',    kind: 'done',   target: 100, icon: 'check', title: 'Cien hechas',      desc: 'Completa 100 actividades.' },
  { id: 'imparable',      kind: 'done',   target: 500, icon: 'check', title: 'Imparable',        desc: 'Completa 500 actividades.' },
  { id: 'racha-3',        kind: 'streak', target: 3,   icon: 'flame', title: 'Tres seguidos',    desc: 'Racha de 3 días.' },
  { id: 'racha-7',        kind: 'streak', target: 7,   icon: 'flame', title: 'Semana de fuego',  desc: 'Racha de 7 días.' },
  { id: 'racha-14',       kind: 'streak', target: 14,  icon: 'flame', title: 'Dos semanas',      desc: 'Racha de 14 días.' },
  { id: 'racha-30',       kind: 'streak', target: 30,  icon: 'flame', title: 'Mes de hierro',    desc: 'Racha de 30 días.' },
  { id: 'racha-100',      kind: 'streak', target: 100, icon: 'flame', title: 'Centenario',       desc: 'Racha de 100 días.' },
  { id: 'dias-10',        kind: 'days',   target: 10,  icon: 'star',  title: 'Buen ritmo',       desc: 'Cumple el objetivo en 10 días.' },
  { id: 'dias-50',        kind: 'days',   target: 50,  icon: 'star',  title: 'Medio centenar',   desc: 'Cumple el objetivo en 50 días.' },
  { id: 'semana-perfecta', kind: 'week',  target: 1,   icon: 'star',  title: 'Semana perfecta',  desc: 'Cumple el objetivo todos los días con actividades de una semana (mínimo 3 días).' }
]);

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
