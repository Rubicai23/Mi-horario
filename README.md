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
│   ├── state-manager.js    Estado, reglas de negocio y rachas (sin DOM ni Firebase)
│   ├── firebase-service.js Auth, Firestore y Analytics
│   ├── ui-components.js    Vistas (HTML), toast, hojas, deslizar y arrastrar
│   ├── platform.js         Web vs nativo: notificaciones, archivos, instalación
│   ├── config.js           Constantes, plantillas y configuración de Firebase
│   ├── utils.js            Funciones puras
│   └── style.css
├── tests/state-manager.test.js
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
