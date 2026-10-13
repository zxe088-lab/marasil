// إشعارات الآيفون: كل ما تتحدث محادثة برسالة جديدة نرسل تنبيه (Apple Push) للطرف الثاني
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const http2 = require('http2');

initializeApp();
const db = getFirestore();

const APNS_KEY = defineSecret('APNS_KEY');            // محتوى ملف AuthKey_XXXX.p8
const APNS_KEY_ID = defineString('APNS_KEY_ID');      // Key ID (10 حروف)
const APPLE_TEAM_ID = defineString('APPLE_TEAM_ID');  // Team ID (10 حروف)
const BUNDLE_ID = 'com.zxe088.bpmold';

let jwtCache = { token: '', at: 0 };
function apnsJwt(){
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache.token && now - jwtCache.at < 50 * 60) return jwtCache.token;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: APNS_KEY_ID.value().trim() });
  const body = b64({ iss: APPLE_TEAM_ID.value().trim(), iat: now });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body),
    { key: APNS_KEY.value(), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  jwtCache = { token: `${head}.${body}.${sig}`, at: now };
  return jwtCache.token;
}

function sendApns(client, token, payload){
  return new Promise(resolve => {
    const req = client.request({
      ':method': 'POST', ':path': '/3/device/' + token,
      authorization: 'bearer ' + apnsJwt(),
      'apns-topic': BUNDLE_ID, 'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 24 * 3600)
    });
    let status = 0, data = '';
    req.on('response', h => { status = h[':status']; });
    req.on('data', c => { data += c; });
    req.on('end', () => resolve({ status, data }));
    req.on('error', e => resolve({ status: 0, data: String(e) }));
    req.end(JSON.stringify(payload));
  });
}

const TONES = ['classic', 'chime', 'bell', 'pop', 'alert'];
const PREVIEW = {
  ping: 'PING!!! 👋', voice: '🎤 رسالة صوتية', sticker: 'فيس بلاك بيري 🙂',
  'once-photo': '📷 صورة لمرة واحدة'
};

exports.notifyNewMessage = onDocumentUpdated({ document: 'chats/{chatId}', secrets: [APNS_KEY] }, async event => {
  const before = event.data.before.data() || {}, chat = event.data.after.data() || {};
  if (!chat.lastTs || chat.lastTs === before.lastTs || !chat.lastFrom) return;
  if (chat.lastKind === 'system') return;
  const to = (chat.members || []).filter(m => m !== chat.lastFrom);
  if (!to.length) return;

  const senderSnap = await db.doc('users/' + chat.lastFrom).get();
  const sender = senderSnap.exists ? (senderSnap.data().name || 'مستخدم') : 'مستخدم';
  const text = PREVIEW[chat.lastKind] || chat.lastMsg || 'رسالة جديدة';
  const title = chat.isGroup ? (chat.name || 'مجموعة') : sender;
  const body = chat.isGroup ? `${sender}: ${text}` : text;

  const cat = chat.isGroup ? 'groups' : chat.lastKind === 'broadcast' ? 'broadcast' : 'friends';
  const users = await Promise.all(to.map(id => db.doc('users/' + id).get()));
  const prefOf = u => ({ tone: 'bbm', mute: false, push: true, ...((u.notif || {})[cat] || {}) });
  const targets = users.filter(s => s.exists && s.data().apns && prefOf(s.data()).push !== false);
  if (!targets.length) return;

  const client = http2.connect('https://api.push.apple.com');
  try {
    await Promise.all(targets.map(async s => {
      const u = s.data(), pref = prefOf(u);
      const aps = { alert: { title, body }, 'thread-id': event.params.chatId };
      if (!u.mute && !pref.mute) aps.sound = TONES.includes(pref.tone) ? pref.tone + '.wav' : 'bbm.caf';
      const r = await sendApns(client, u.apns, { aps, chatId: event.params.chatId });
      if (r.status === 410 || /BadDeviceToken|Unregistered/.test(r.data)) {
        await s.ref.update({ apns: FieldValue.delete() }).catch(() => {});
      } else if (r.status !== 200) {
        console.error('APNs', r.status, r.data);
      }
    }));
  } finally { client.close(); }
});
