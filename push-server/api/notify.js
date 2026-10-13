// إشعارات الآيفون (مجاني على Vercel): التطبيق يطلب هذا الرابط بعد ما يرسل رسالة،
// والسيرفر يتأكد إن المرسل عضو في المحادثة ثم يرسل تنبيه Apple للطرف الثاني.
const crypto = require('crypto');
const http2 = require('http2');
const fs = require('fs');

const PROJECT = 'bbm-old-1e477';
const BUNDLE_ID = 'com.zxe088.bpmold';
const TONES = ['classic', 'chime', 'bell', 'pop', 'alert'];
const PREVIEW = { ping: 'PING!!! 👋', voice: '🎤 رسالة صوتية', sticker: 'فيس بلاك بيري 🙂', 'once-photo': '📷 صورة لمرة واحدة' };
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/`;

// تحويل صيغة Firestore REST إلى قيم عادية
function val(v){
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return obj(v.mapValue.fields);
  return undefined;
}
const obj = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));

async function getDoc(path, idToken){
  const r = await fetch(FS + path, { headers: { authorization: 'Bearer ' + idToken } });
  if (!r.ok) return null;
  return obj((await r.json()).fields);
}

let jwtCache = { token: '', at: 0 };
function apnsJwt(){
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache.token && now - jwtCache.at < 50 * 60) return jwtCache.token;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID.trim() });
  const body = b64({ iss: process.env.APPLE_TEAM_ID.trim(), iat: now });
  const key = process.env.APNS_KEY ? process.env.APNS_KEY.replace(/\\n/g, '\n') : fs.readFileSync(process.env.APNS_KEY_FILE, 'utf8');
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
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
    req.setTimeout(8000, () => req.close());
    req.end(JSON.stringify(payload));
  });
}

module.exports = async (req, res) => {
  // Access-Control-Allow-Origin is added by Caddy (duplicating it breaks CORS)
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const chatId = String(body?.chatId || '');
  if (!idToken || !/^[\w-]{1,200}$/.test(chatId)) return res.status(400).json({ error: 'bad request' });

  // قراءة المحادثة برمز المرسل نفسه: تنجح فقط إذا كان عضو فيها (قواعد Firestore)
  let uid = '';
  try { uid = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).user_id || ''; } catch {}
  const chat = await getDoc('chats/' + chatId, idToken);
  if (!chat || !uid || !(chat.members || []).includes(uid)) return res.status(403).json({ error: 'not a member' });
  if (chat.lastFrom !== uid || !chat.lastTs || Math.abs(Date.now() - chat.lastTs) > 2 * 60 * 1000 || chat.lastKind === 'system')
    return res.status(200).json({ sent: 0, skipped: 'no new message' });

  const to = chat.members.filter(m => m !== uid);
  const [sender, ...users] = await Promise.all([uid, ...to].map(id => getDoc('users/' + id, idToken)));
  const cat = chat.isGroup ? 'groups' : chat.lastKind === 'broadcast' ? 'broadcast' : 'friends';
  const name = sender?.name || 'مستخدم';
  const text = PREVIEW[chat.lastKind] || chat.lastMsg || 'رسالة جديدة';
  const title = chat.isGroup ? (chat.name || 'مجموعة') : name;
  const alertBody = chat.isGroup ? `${name}: ${text}` : text;

  const targets = users.filter(u => {
    if (!u?.apns) return false;
    const p = { push: true, ...((u.notif || {})[cat] || {}) };
    return p.push !== false;
  });
  if (!targets.length) { console.log(new Date().toISOString(), 'push', chatId, 'no target with notifications on (apns token missing?)'); return res.status(200).json({ sent: 0 }); }

  const client = http2.connect('https://api.push.apple.com');
  client.on('error', () => {});
  let sent = 0;
  try {
    await Promise.all(targets.map(async u => {
      const p = { tone: 'bbm', mute: false, ...((u.notif || {})[cat] || {}) };
      const aps = { alert: { title, body: alertBody }, 'thread-id': chatId };
      if (!u.mute && !p.mute) aps.sound = TONES.includes(p.tone) ? p.tone + '.wav' : 'bbm.caf';
      const r = await sendApns(client, u.apns, { aps, chatId });
      if (r.status === 200) sent++; else console.error('APNs', r.status, r.data);
      console.log(new Date().toISOString(), 'push', chatId, cat, '->', r.status, r.data || 'ok');
    }));
  } finally { client.close(); }
  res.status(200).json({ sent });
};
