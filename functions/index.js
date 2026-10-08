'use strict';
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { splitDue } = require('./logic');

initializeApp();

const DEAD_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

/** Cada minuto: envía los avisos que ya tocan y deja solo los futuros. */
exports.sendDueReminders = onSchedule({ schedule: 'every 1 minutes', region: 'europe-west1', timeoutSeconds: 60 }, async () => {
  const db = getFirestore();
  const now = Date.now();
  const snap = await db.collection('pushQueue').where('nextAt', '>', 0).where('nextAt', '<=', now).limit(200).get();
  await Promise.all(snap.docs.map(async docSnap => {
    const data = docSnap.data();
    const { due, keep, nextAt } = splitDue(data.items, now);
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];
    const dead = new Set();
    for (const item of due) {
      await Promise.all(tokens.map(token => getMessaging().send({
        token,
        data: { title: String(item.t || 'Mi horario').slice(0, 120), body: String(item.b || '').slice(0, 200), tag: `r-${item.at}` },
        webpush: { headers: { Urgency: 'high', TTL: '600' } }
      }).catch(err => { if (DEAD_TOKEN.has(err && err.code)) dead.add(token); })));
    }
    const update = { items: keep, nextAt };
    if (dead.size) update.tokens = FieldValue.arrayRemove(...dead);
    await docSnap.ref.update(update);
  }));
});
