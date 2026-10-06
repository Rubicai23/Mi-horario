# Mi horario v2

PWA en JavaScript puro (módulos ES) + Firebase, lista para empaquetarse con Capacitor.

## Estructura

```
mi-horario-v2/
├── index.html              Marcado limpio, sin CSS ni JS en línea
├── firestore.rules         Reglas de seguridad de Firestore
├── firebase.json
├── capacitor.config.json
├── vite.config.js
├── package.json
├── public/                 Se copia tal cual a dist/
│   ├── manifest.json
│   ├── sw.js               Service worker (el build sustituye __BUILD_ID__)
│   └── icons/
├── scripts/stamp-sw.js     Plugin de Vite: versiona la caché del SW
├── src/
│   ├── app.js              Raíz de composición: cablea todo
│   ├── state-manager.js    Estado, reglas de negocio, rachas, copiar día y plantillas (sin DOM ni Firebase)
│   ├── firebase-service.js Auth, Firestore y Analytics
│   ├── ui-components.js    Vistas (HTML), toast, hojas, deslizar y arrastrar
│   ├── platform.js         Web vs nativo: notificaciones, archivos, instalación
│   ├── config.js           Constantes, plantillas y configuración de Firebase
│   ├── utils.js            Funciones puras
│   └── style.css
├── tests/                  state-manager, templates-copy, recurring-subtasks, streak-badges, categories-month
└── .github/workflows/deploy.yml
```

## Comandos

```
npm install
npm run dev        # desarrollo
npm test           # tests del núcleo (node --test)
npm run build      # genera dist/
npm run preview
```

## Firebase (consola)

1. Authentication → Sign-in method → activar **Correo/contraseña** (pulsa "Comenzar" si aparece).
2. Authentication → Settings → Dominios autorizados: `rubicai23.github.io` y `localhost`.
3. Firestore → Reglas: pega `firestore.rules` y publica (o `firebase deploy --only firestore:rules`).
4. Prueba las reglas en el Rules Playground:
   - Propietario lee/escribe `users/UID/days/2026-10-07` → permitido.
   - Otro uid sobre esa ruta → denegado.
   - Sin sesión → denegado.
   - Escritura con un campo extra, o `updatedAt` que no sea `serverTimestamp()` → denegado.
   - Id de documento `hoy` → denegado.
   - `users/UID/profile/main` con `templates` (lista) y `updatedAt` = `request.time` → permitido solo al propietario.
   - Igual, añadiendo `recurring` (lista de ≤ 40) → permitido; con `recurring` que no sea una lista → denegado.
   - Igual, añadiendo `rest` (lista ≤ 400), `streak` (mapa `{goal, days}`) `badges` (mapa ≤ 40) y `cats` (mapa ≤ 6) → permitido; con `streak` que no sea un mapa → denegado.
   - `users/UID/profile/otro` o con un campo extra → denegado.

Modelo de datos: `users/{uid}/days/{YYYY-MM-DD}` (actividades de cada día) y `users/{uid}/profile/main` (plantillas propias y repeticiones semanales: `{ templates, recurring, rest, streak, badges, cats, updatedAt }`). **Si actualizas la app y no republicas `firestore.rules`, las plantillas y repeticiones funcionan en el dispositivo pero no se sincronizan.**

Racha: la meta (50–100 %) y los días de la semana que cuentan van en `streak`; los días de descanso manuales (solo hoy o futuros) en `rest`; las insignias conseguidas, con su fecha, en `badges` (solo se ganan: al sincronizar se unen, nunca se pierden). Los días de descanso y los días que no cuentan no suman ni rompen la racha ni cuentan como hueco.

Categorías: `cats` guarda, por categoría, un nombre propio (`l`, máx. 20 caracteres) y un color elegido de una paleta fija (`c`, el nombre del color, nunca un valor libre). El tema (claro/oscuro/automático) y el color de acento son de cada dispositivo y no se sincronizan.

Eliminar cuenta (Ajustes → Cuenta): pide la contraseña, borra de Firestore todos los días y el perfil y, por último, el usuario de Authentication. Si falla a medias se puede repetir.

Textos legales: `public/privacidad.html` (política de privacidad y términos). **Antes de publicar en una tienda, añade tu correo de contacto** en el comentario que hay al principio del archivo.

Repeticiones: los días sin registro se calculan al vuelo a partir de las reglas; un día guardado (aunque esté vacío) nunca se vuelve a rellenar. «Dejar de repetir» y «cambiar la serie» solo afectan de hoy en adelante.

Limitación: las reglas no tienen bucles, así que no pueden validar el contenido de cada bloque, solo la forma del documento y `blocks.size() <= 60`. Cada cliente sanea los bloques; el aislamiento entre usuarios sí es total.

## GitHub Pages

Settings → Pages → Source: **GitHub Actions**. Cada push a `main` ejecuta tests, build y despliegue.

## Capacitor

```
npm run build
npx cap add android      # y/o ios (macOS + Xcode)
npm run cap:android      # build + sync + abrir Android Studio
npm run cap:ios
```

- Android 12+: las alarmas exactas pueden requerir el permiso "Alarmas y recordatorios".
- iOS limita a 64 notificaciones locales pendientes; la app programa como máximo 60 de los próximos 7 días.
- Analytics no está soportado en el contenedor nativo; la app lo desactiva ahí.
- Los iconos de las tiendas (adaptativos de Android, AppIcon de iOS) se generan aparte, p. ej. con `@capacitor/assets`.
