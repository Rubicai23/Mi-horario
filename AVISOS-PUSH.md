# Avisos con la app cerrada (iPhone) — guía paso a paso

**Importante:** esta parte no se ha podido probar de extremo a extremo (necesita tu proyecto real de Firebase).
La app y la función están escritas y la lógica probada, pero puede que haya que ajustar algo al probarlo.
Requisitos: iPhone con iOS 16.4 o superior y la app **añadida a la pantalla de inicio** (Safari → Compartir → Añadir a pantalla de inicio).

## 1. Plan Blaze (obligatorio)
Las funciones programadas de Firebase exigen el plan **Blaze** (hay que poner una tarjeta). Para uso personal el gasto
suele ser 0 € (hay una cuota gratuita mensual), pero conviene crear una **alerta de presupuesto** de 1 € en
Google Cloud → Facturación → Presupuestos y alertas.

## 2. Clave web push
Firebase → ⚙ Configuración del proyecto → **Cloud Messaging** → *Certificados push web* → **Generar par de claves**.
Copia la clave larga y pégala en `src/config.js`:
```js
export const PUSH = Object.freeze({ vapidKey: 'AQUÍ_TU_CLAVE', horizonDays: 3, maxItems: 40 });
```

## 3. Publicar reglas y función (en tu PC, en la carpeta del proyecto)
```
npm install -g firebase-tools
firebase login
firebase use mi-horario-5e8b1
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,functions
```

## 4. Subir la app a GitHub como siempre
Después, en el iPhone: Ajustes de la app → **Avisos con la app cerrada** → activar → aceptar el permiso.

## Cómo funciona
La app guarda en la nube la hora y el título de tus próximas actividades (3 días). Una función se ejecuta cada minuto
y envía la notificación a su hora. Es opcional: si no activas el ajuste, no se guarda nada. Al borrar la cuenta se borra también.

## Si algo falla
- No aparece el ajuste: falta la clave del paso 2, o no has iniciado sesión.
- "No se pudo activar": abre la app desde el icono de la pantalla de inicio (no desde Safari).
- No llegan avisos: en Firebase → Functions → Registros mira si `sendDueReminders` da errores y envíame el texto.
