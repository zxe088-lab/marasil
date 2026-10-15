/* BPB OLD — تطبيق محادثة على طريقة الماسنجر الكلاسيكي، يعمل على Firebase (الخطة المجانية) */
'use strict';

const $ = id => document.getElementById(id);
// One layout owner: follow the visible viewport, including Safari's focus pan.
// Predict the native keyboard inset at will-show; cap the viewport instead of subtracting twice.
let viewportFrame = 0, nativeKeyboardOpen = false, nativeKeyboardTarget = null, closedViewportHeight = window.innerHeight;
function syncViewport(){
  const viewport = window.visualViewport;
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
  const root = document.documentElement;
  let height = viewport?.height ?? window.innerHeight;
  const top = Math.max(0, viewport?.offsetTop ?? 0);
  if (height <= 0) return; // Ignore transient measurements during rotation.
  if (!nativeKeyboardOpen) closedViewportHeight = window.innerHeight;
  if (nativeKeyboardOpen && nativeKeyboardTarget !== null) height = Math.min(height, nativeKeyboardTarget);
  const inputFocused = document.activeElement?.matches('input,textarea,[contenteditable="true"]');
  const keyboardOpen = nativeKeyboardOpen ||
    (inputFocused && window.innerHeight - height - top > 80);
  const list = document.getElementById('msgList');
  const atBottom = list && list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  root.style.setProperty('--app-height', height + 'px');
  root.style.setProperty('--app-top', top + 'px');
  root.classList.toggle('keyboard-open', !!keyboardOpen);
  // Only follow the latest message if the reader was already near the bottom.
  if (atBottom) list.scrollTop = list.scrollHeight;
}
function scheduleViewport(){
  if (viewportFrame) return;
  viewportFrame = requestAnimationFrame(() => { viewportFrame = 0; syncViewport(); });
}
window.visualViewport?.addEventListener('resize', scheduleViewport);
window.visualViewport?.addEventListener('scroll', scheduleViewport);
window.addEventListener('resize', scheduleViewport);
window.addEventListener('scroll', scheduleViewport, { passive: true });
window.addEventListener('orientationchange', scheduleViewport);
window.addEventListener('pageshow', scheduleViewport);
document.addEventListener('visibilitychange', scheduleViewport);
document.addEventListener('focusin', scheduleViewport);
document.addEventListener('focusout', scheduleViewport);
// Keyboard plugin also emits these compatibility events on window.
window.addEventListener('keyboardWillShow', event => {
  const keyboardHeight = Number(event?.keyboardHeight ?? event?.detail?.keyboardHeight);
  if (!nativeKeyboardOpen) closedViewportHeight = window.innerHeight;
  nativeKeyboardOpen = true;
  nativeKeyboardTarget = Number.isFinite(keyboardHeight) && keyboardHeight > 0 && keyboardHeight < closedViewportHeight ? closedViewportHeight - keyboardHeight : null;
  syncViewport();
});
window.addEventListener('keyboardDidShow', scheduleViewport);
window.addEventListener('keyboardWillHide', scheduleViewport);
window.addEventListener('keyboardDidHide', () => { nativeKeyboardOpen = false; nativeKeyboardTarget = null; scheduleViewport(); });
syncViewport();
const COLORS = ['#c0392b','#2e86c1','#239b56','#b9770e','#7d3c98','#148f77','#a04000','#2c3e8f'];
const COUNTRIES = [
  ['SA','السعودية'],['KW','الكويت'],['AE','الإمارات'],['QA','قطر'],['BH','البحرين'],['OM','عُمان'],
  ['YE','اليمن'],['IQ','العراق'],['JO','الأردن'],['EG','مصر'],['SY','سوريا'],['LB','لبنان'],
  ['PS','فلسطين'],['SD','السودان'],['LY','ليبيا'],['TN','تونس'],['DZ','الجزائر'],['MA','المغرب'],['','أخرى']
];
const DEFAULT_CAT = 'جهات الاتصال';
// حسابات صاحب التطبيق (الموقع + تطبيق الآيفون): هم بس اللي يقدرون يغيّرون رمز PIN
const OWNER_UIDS = ['7KzlcizFv8TrIeqRVqi6BjNoCue2', 'c5yYZKI92rXqwr0cb1gm2HNKdSy2'];
const isOwner = id => OWNER_UIDS.includes(id);
const APP_NAME = 'BPB OLD';
// داخل تطبيق الآيفون (Capacitor): دخول بدون حساب فقط + اهتزاز حقيقي
const IS_NATIVE = !!window.Capacitor?.isNativePlatform?.();
if (IS_NATIVE && window.Capacitor?.getPlatform?.() === 'ios') {
  // Disable the outer UIScrollView, leaving CSS message/form scrollers active.
  window.Capacitor?.Plugins?.Keyboard?.setScroll({ isDisabled: true })
    .catch(e => console.warn('Could not disable outer WebView scrolling', e));
}
const Haptics = IS_NATIVE ? window.Capacitor?.Plugins?.Haptics : null;
let blocked = {};                 // المستخدمين اللي حظرتهم
const gone = {};                  // حسابات انحذفت
const isBlocked = id => !!blocked[id];
const ONLINE_MS = 6 * 60 * 1000;
const GROUP_MS = 5 * 60 * 1000;   // رسائل نفس الشخص خلال 5 دقائق تنجمع في بطاقة وحدة

let auth, fs, uid = null, me = null, tab = null;
const users = {}, userSubs = {};
let contacts = {}, chats = {}, closedCats = {};
let incomingRequests = {}, outgoingRequests = {}, groups = {};
let requestsReadable = true, groupsReadable = true;
let stack = [], profileId = null;
let chatGroup = null, lastChat = null;
let chatId = null, chatPeer = null, unsubMsgs = null, unsubChat = null, curChat = null, msgs = [];
let firstChatsSnap = true, firstMsgsSnap = true, typingSent = 0, readTimer = null, seenUpdates = 0;

try { closedCats = JSON.parse(localStorage.getItem('marasil-closed') || '{}'); seenUpdates = +localStorage.getItem('marasil-seen') || 0; } catch {}
const saveLocal = () => { try { localStorage.setItem('marasil-closed', JSON.stringify(closedCats)); localStorage.setItem('marasil-seen', seenUpdates); } catch {} };

/* ---------- أدوات ---------- */
function toast(t){ const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(e._t); e._t = setTimeout(() => e.hidden = true, 2800); }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// رمز PIN: 8 خانات يبدأ بـ 2A ثم 6 خانات عشوائية
const newPin = () => '2A' + Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const fmtTime = (ts, tz) => new Date(ts).toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
const fmtDay = ts => new Date(ts).toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long' });
function ago(ts){
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'الآن';
  if (s < 3600) return 'قبل ' + Math.round(s / 60) + ' دقيقة';
  const d = new Date(ts), n = new Date();
  if (d.toDateString() === n.toDateString()) return 'اليوم ' + fmtTime(ts);
  if (n - d < 2 * 864e5) return 'أمس ' + fmtTime(ts);
  return d.toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long' }) + ' ' + fmtTime(ts);
}
const shortWhen = ts => { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? fmtTime(ts) : d.toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'numeric' }); };
const flagOf = cc => cc ? String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🌐';
const countryName = cc => (COUNTRIES.find(c => c[0] === cc) || [, ''])[1];
const nameOf = id => (id === uid ? me?.name : users[id]?.name) || 'جهة اتصال';
const dataOf = id => id === uid ? me : users[id];
const isOnline = id => id === uid || (Date.now() - (users[id]?.lastSeen || 0) < ONLINE_MS);
const chatIdWith = id => [uid, id].sort().join('_');
function tzOffset(tz){
  try { const p = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(x => x.type === 'timeZoneName'); return (p?.value || '').replace('GMT', '') || '+0'; } catch { return ''; }
}
function colorOf(id){ let h = 0; for (const c of (dataOf(id)?.pin || id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
const initialOf = id => [...nameOf(id)].find(ch => /\p{L}/u.test(ch)) || '؟';
const photoOf = id => { const p = dataOf(id)?.photo; return typeof p === 'string' && p.startsWith('data:image/') ? p : ''; };
function avatar(id, size = ''){
  const a = el('div', 'avatar' + (size ? ' ' + size : '')); a.style.background = colorOf(id);
  const p = photoOf(id);
  if (p) { const img = el('img'); img.src = p; img.alt = ''; a.append(img); } else a.textContent = initialOf(id);
  return a;
}
function statusIcon(id){
  const d = dataOf(id), s = el('span', 'st-icon');
  if (d?.busy) s.classList.add('busy'); else if (!isOnline(id)) s.classList.add('off');
  s.title = statusLabel(d);
  return s;
}
// نص الحالة: المخصصة إن وجدت، وإلا متوفر/مشغول
function statusLabel(d){ return (d?.stText || '').trim() || (d?.busy ? 'مشغول' : 'متوفر'); }
function statusText(id){ const d = dataOf(id); return d?.busy || isOnline(id) || id === uid ? statusLabel(d) : 'غير متصل'; }

/* ---------- النغمات والاهتزاز ---------- */
let actx = null;
function audio(){ if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (actx?.state === 'suspended') actx.resume(); return actx; }
['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, audio, { capture: true, passive: true }));
// صوت كتابة خفيف مثل لوحة المفاتيح (يقدر الشخص يقفله من الإعدادات)
const typingSoundOn = () => { try { return localStorage.getItem('marasil-typing-sound') !== 'off'; } catch { return true; } };
let lastKeyClick = 0, keyClickBuf = null;
function keyClick(){
  if (me?.mute || !typingSoundOn()) return;
  const now = performance.now(); if (now - lastKeyClick < 40) return; lastKeyClick = now;
  const ctx = audio(); if (!ctx || ctx.state !== 'running') return;
  if (!keyClickBuf) {
    const n = Math.floor(ctx.sampleRate * 0.02); keyClickBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = keyClickBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
  }
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = keyClickBuf; f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 400; f.Q.value = 0.8; g.gain.value = 0.09;
  s.connect(f).connect(g).connect(ctx.destination); s.start();
}
function tone(notes){
  const ctx = audio(); if (!ctx) return;
  let t = ctx.currentTime + 0.02;
  for (const [freq, dur, type = 'sine', vol = 0.18] of notes) {
    if (freq) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    t += dur * 0.85;
  }
}
const TONE_NOTES = {
  incoming: [[1046.5, .12, 'triangle'], [1318.5, .12, 'triangle'], [1568, .22, 'triangle']],
  sent:     [[880, .07, 'sine', .08], [1174.7, .1, 'sine', .08]],
  ping:     [[1760, .08, 'square', .1], [0, .05], [1760, .08, 'square', .1], [0, .05], [1760, .08, 'square', .1], [0, .12], [2093, .25, 'square', .1]],
  contact:  [[659.3, .15, 'sine'], [987.8, .3, 'sine']],
};
const SOUNDS = Object.fromEntries(Object.entries(TONE_NOTES).map(([k, n]) => [k, () => tone(n)]));
// نفس النغمة كملف WAV (للتشغيل عبر عنصر audio في تطبيق الآيفون)
function synthWav(notes){
  const rate = 22050; let t = 0.02; const parts = [];
  for (const [freq, dur, type = 'sine', vol = 0.18] of notes) { if (freq) parts.push([t, freq, dur, type, Math.min(vol * 2.2, 0.6)]); t += dur * 0.85; }
  const len = Math.ceil((t + 0.4) * rate), pcm = new Float32Array(len);
  for (const [st, freq, dur, type, vol] of parts) {
    const a = Math.floor(st * rate), n = Math.floor((dur + 0.02) * rate);
    for (let i = 0; i < n && a + i < len; i++) {
      const x = i / rate, ph = (x * freq) % 1;
      const w = type === 'square' ? (ph < .5 ? 1 : -1) * .6 : type === 'triangle' ? 1 - 4 * Math.abs(ph - .5) : Math.sin(2 * Math.PI * ph);
      const env = x < .01 ? x / .01 : Math.max(0, Math.exp(Math.log(.001 / 1) * (x - .01) / Math.max(dur - .01, .01)));
      pcm[a + i] += w * vol * env;
    }
  }
  const buf = new DataView(new ArrayBuffer(44 + len * 2)), str = (o, v) => [...v].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); buf.setUint32(4, 36 + len * 2, true); str(8, 'WAVEfmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
  let bin = ''; const u8 = new Uint8Array(buf.buffer); for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return 'data:audio/wav;base64,' + btoa(bin);
}
/* نغمات خاصة: 1) ملف يختاره الشخص من جواله (محفوظ في جهازه)  2) ملف في مجلد sounds على السيرفر  3) النغمة الافتراضية */
const TONE_NAMES = { contact: 'تحديثات الأصحاب' };
// تشغيل ملفات النغمات عبر عنصر audio، مع احترام قيود التشغيل في النظام.
const toneEls = {};      // name -> Audio
const toneOrigin = {};   // 'device' | 'site'
async function loadTone(name){
  delete toneEls[name]; delete toneOrigin[name];
  let src = null;
  try { src = localStorage.getItem('marasil-tone-' + name); } catch {}
  if (src) toneOrigin[name] = 'device';
  else if (name === 'sent') { src = 'sounds/sent.mp3'; toneOrigin[name] = 'site'; }
  else if (IS_NATIVE && name !== 'incoming' && name !== 'ping' && TONE_NOTES[name]) {
    // تطبيق الآيفون: ملف bbm.mp3 غير موجود فيه، فنشغّل نغمات التطبيق كملف صوت
    src = synthWav(TONE_NOTES[name]); toneOrigin[name] = 'app';
  } else if (name === 'incoming' || name === 'ping') {
    src = 'sounds/bbm.mp3'; toneOrigin[name] = 'site';
  } else {
    for (const ext of ['mp3', 'm4a', 'wav', 'ogg']) {
      try {
        const r = await fetch('sounds/' + name + '.' + ext, { method: 'HEAD', cache: 'no-cache' });
        if (r.ok && (r.headers.get('content-type') || '').startsWith('audio')) { src = 'sounds/' + name + '.' + ext; toneOrigin[name] = 'site'; break; }
      } catch {}
    }
  }
  if (src) {
    const a = new Audio(src); a.preload = 'auto';
    a.addEventListener('ended', () => { a._want = false; });
    toneEls[name] = a;
  }
}
Object.keys(TONE_NAMES).forEach(loadTone);
// الآيفون يسمح بتشغيل الصوت بعد أول لمسة فقط: نفتح العناصر بصمت مع أول لمسة
document.addEventListener('pointerdown', () => {
  Object.values(toneEls).forEach(a => {
    if (a._want) return;
    a.muted = true;
    a.play().then(() => { if (!a._want) { a.pause(); try { a.currentTime = 0; } catch {} } a.muted = false; }).catch(() => { a.muted = false; });
  });
}, { once: true, capture: true });
function playFile(name){
  // الوكزة: إذا ما لها نغمة خاصة تشغّل نغمة الرسالة الواردة (والاهتزاز يجي من nudgeEffect)
  const a = toneEls[name] || (name === 'ping' ? toneEls.incoming : null); if (!a) return false;
  a._want = true; a.muted = false;
  try { a.currentTime = 0; } catch {}
  const p = a.play();
  if (p) p.catch(() => { a._want = false; SOUNDS[name]?.(); });
  return true;
}
const play = name => { if (me?.mute) return; if (name === 'ping') name = 'incoming'; if (playFile(name)) return; SOUNDS[name]?.(); };
function toneReady(name){
  return new Promise(res => {
    const a = toneEls[name]; if (!a) return res(false);
    a.oncanplaythrough = () => res(true); a.onerror = () => res(false);
    a.load(); setTimeout(() => res(true), 3000);
  });
}

function renderTonePicker(){
  const box = $('toneList'); if (!box || box.childElementCount) return;
  Object.entries(TONE_NAMES).forEach(([name, label]) => {
    const row = el('div', 'tonerow');
    const lab = el('span', 'tn-label', label);
    const st = el('span', 'tn-state');
    const refresh = () => { st.textContent = toneOrigin[name] === 'device' ? 'نغمة من جهازك' : toneOrigin[name] === 'site' || toneOrigin[name] === 'app' ? 'نغمة التطبيق' : 'افتراضية'; };
    loadTone(name).then(refresh);
    const pick = el('button', 'btn sm', 'اختيار'); pick.type = 'button';
    const test = el('button', 'btn sm', '▶'); test.type = 'button'; test.title = 'تجربة';
    const reset = el('button', 'btn sm', 'افتراضي'); reset.type = 'button';
    const inp = el('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.hidden = true;
    pick.onclick = () => inp.click();
    test.onclick = () => { const m = me.mute; me.mute = false; play(name); me.mute = m; };
    reset.onclick = async () => { try { localStorage.removeItem('marasil-tone-' + name); } catch {} await loadTone(name); refresh(); toast('رجعت النغمة الافتراضية'); };
    inp.onchange = () => {
      const f = inp.files?.[0]; inp.value = '';
      if (!f) return;
      if (f.size > 1.5e6) { toast('الملف كبير، اختر نغمة أقصر (أقل من 1.5 ميجا)'); return; }
      const fr = new FileReader();
      fr.onload = async () => {
        try { localStorage.setItem('marasil-tone-' + name, fr.result); } catch { toast('ما فيه مساحة كافية لحفظ النغمة'); return; }
        await loadTone(name);
        if (!(await toneReady(name))) { try { localStorage.removeItem('marasil-tone-' + name); } catch {} await loadTone(name); refresh(); toast('ما قدرنا نشغّل هذا الملف، جرّب mp3'); }
        else { refresh(); test.onclick(); toast('تم تغيير نغمة ' + label); }
      };
      fr.readAsDataURL(f);
    };
    refresh();
    const btns = el('span', 'tn-btns'); btns.append(pick, test, reset);
    const info = el('span', 'tn-info'); info.append(lab, st);
    row.append(info, btns, inp); box.append(row);
  });
}
// إشعارات الرسائل: لكل نوع (أصدقاء / مجموعات / برودكاست) نغمة + كتم + إشعار خارج التطبيق
// النغمات موجودة داخل التطبيق نفسه عشان آيفون يقدر يشغّلها في الإشعار وهو مقفل
// النغمات تنقرأ من مجلد sounds/tones (ملف tones.json) — تضيف نغمة جديدة بدون ما تعدّل الكود
const MSG_TONES = { bbm: 'BBM الأصلية', waqz: 'وكزة', classic: 'كلاسيك', chime: 'رنّة', bell: 'جرس', pop: 'فقاعة', alert: 'تنبيه' };
const TONE_FILES = { bbm: 'bbm.mp3', waqz: 'waqz.mp3', classic: 'classic.wav', chime: 'chime.wav', bell: 'bell.wav', pop: 'pop.wav', alert: 'alert.wav' };
const NOTIF_CATS = { friends: 'رسائل الأصدقاء', groups: 'رسائل المجموعات', broadcast: 'رسائل البرودكاست', ping: 'الوكزة (PING)' };
const NOTIF_DEFAULT = { tone: 'bbm', mute: false, push: true };
const notifPref = cat => ({ ...NOTIF_DEFAULT, ...(cat === 'ping' ? { tone: 'waqz' } : {}), ...(me?.notif?.[cat] || {}) });
const chatCat = c => c?.lastKind === 'ping' ? 'ping' : c?.isGroup ? 'groups' : c?.lastKind === 'broadcast' ? 'broadcast' : 'friends';
const toneFile = t => 'sounds/tones/' + (TONE_FILES[t] || TONE_FILES.bbm);
const msgToneEls = {};
const makeToneEl = t => { if (msgToneEls[t]) return; const a = new Audio(toneFile(t)); a.preload = 'auto'; msgToneEls[t] = a; };
Object.keys(MSG_TONES).forEach(makeToneEl);
fetch('sounds/tones/tones.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : []).then(list => {
  let added = false;
  (Array.isArray(list) ? list : []).forEach(x => {
    if (!x || !/^[a-z0-9-]{1,30}$/.test(x.id || '') || !x.file) return;
    if (!MSG_TONES[x.id]) added = true;
    MSG_TONES[x.id] = String(x.name || x.id).slice(0, 30); TONE_FILES[x.id] = String(x.file); makeToneEl(x.id);
  });
  if (added && $('notifList')?.childElementCount) renderNotifSettings();
}).catch(() => {});
document.addEventListener('pointerdown', () => {
  Object.values(msgToneEls).forEach(a => { a.muted = true; a.play().then(() => { if (!a._want) { a.pause(); try { a.currentTime = 0; } catch {} } a.muted = false; }).catch(() => { a.muted = false; }); });
}, { once: true, capture: true });
// الرسائل اللي وصلت وأنت برّا التطبيق نبّهك عليها الإشعار، فما نعيد صوتها لما ترجع للتطبيق
let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0, shownAt = 0;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') hiddenAt = Date.now(); else shownAt = Date.now(); });
const arrivedWhileAway = ts => !!(hiddenAt && shownAt > hiddenAt && ts >= hiddenAt - 1000 && ts <= shownAt + 1500 && Date.now() - shownAt < 10000);
function playMsgTone(t, force){
  if (me?.mute && !force) return;
  const a = msgToneEls[MSG_TONES[t] ? t : 'bbm'] || msgToneEls.bbm;
  if (!a || a.error) { SOUNDS[t === 'waqz' ? 'ping' : 'incoming']?.(); return; }
  a._want = true; a.muted = false; try { a.currentTime = 0; } catch {}
  a.play()?.catch(() => SOUNDS[t === 'waqz' ? 'ping' : 'incoming']?.());
}
function renderNotifSettings(){
  const box = $('notifList'); if (!box) return;
  box.replaceChildren();
  Object.entries(NOTIF_CATS).forEach(([cat, label]) => {
    const p = notifPref(cat), row = el('div', 'notifcat');
    const save = (fields, msg) => { const n = { ...(me.notif || {}) }; n[cat] = { ...notifPref(cat), ...fields }; saveMe({ notif: n }, null, msg); };
    const sel = el('select', 'notif-tone');
    Object.entries(MSG_TONES).forEach(([k, v]) => { const o = el('option', null, v); o.value = k; sel.append(o); });
    sel.value = p.tone;
    sel.onchange = () => { playMsgTone(sel.value, true); save({ tone: sel.value }, 'تم تغيير نغمة ' + label); };
    const test = el('button', 'btn sm', '▶'); test.type = 'button'; test.title = 'تجربة';
    test.onclick = () => playMsgTone(sel.value, true);
    const chk = (text, key, on, onMsg, offMsg) => {
      const l = el('label', 'check'), i = el('input'); i.type = 'checkbox'; i.checked = on;
      i.onchange = () => save({ [key]: i.checked }, i.checked ? onMsg : offMsg);
      l.append(i, document.createTextNode(' ' + text)); return l;
    };
    const line = el('div', 'line'); line.append(sel, test);
    row.append(el('div', 'tn-label', label), line,
      chk('كتم (بدون صوت ولا اهتزاز)', 'mute', p.mute, 'تم كتم ' + label, 'رجع صوت ' + label),
      chk('إشعار على الجوال وأنا خارج التطبيق', 'push', p.push, 'إشعارات ' + label + ' شغالة', 'تم إيقاف إشعارات ' + label));
    box.append(row);
  });
}
const buzz = pattern => {
  try {
    if (Haptics) {
      // الآيفون: الاهتزاز العادي ما يشتغل إذا الجوال على الصامت، فنضيف نبضات Taptic قوية تشتغل حتى بالصامت
      const pulses = Array.isArray(pattern) ? pattern : [pattern];
      Haptics.vibrate?.({ duration: 300 })?.catch?.(() => {});
      let t = 0;
      pulses.forEach((d, i) => {
        if (i % 2 === 0) for (let k = 0, n = Math.max(1, Math.round(d / 110)); k < n; k++)
          setTimeout(() => { Haptics.impact?.({ style: 'HEAVY' })?.catch?.(() => {}); }, t + k * 110);
        t += d;
      });
      return;
    }
    navigator.vibrate?.(pattern);
  } catch {}
};
// لمبة بلاك بيري: ومضة وحدة مع كل رسالة واصلة ثم تطفى
let ledTimer = null;
function ledFlash(){
  const l = $('led'); if (!l) return;
  l.classList.remove('on'); void l.offsetWidth; l.classList.add('on');
  clearTimeout(ledTimer); ledTimer = setTimeout(() => l.classList.remove('on'), 1600);
}
function nudgeEffect(){
  buzz([400, 100, 400, 100, 400, 100, 800]);
}

/* ---------- التنقل ---------- */
const SCREENS = ['s-loading','s-error','s-login','s-email','s-setup','s-home','s-add','s-menu','s-broadcast','s-group','s-profile','s-chat'];
function show(id, push = true){
  const cur = SCREENS.find(s => !$(s).hidden);
  if (push && cur && cur !== id && !['s-loading','s-error','s-login','s-email','s-setup'].includes(cur)) stack.push(cur);
  SCREENS.forEach(s => $(s).hidden = s !== id);
  if (id !== 's-chat') closeChat();
  else if (!push && !chatId && lastChat) { const lc = lastChat; setTimeout(() => lc.group ? openGroup(lc.id) : openChat(lc.id)); }
  if (id === 's-home') { stack = []; renderHome(); }
  updateTitle();
}
function back(){ show(stack.pop() || 's-home', false); }
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));

function setTab(t){
  tab = t;
  document.querySelectorAll('.classic-menu [data-section]').forEach(b => {
    const active = b.dataset.section === t;
    const panel = document.getElementById(b.getAttribute('aria-controls')); if (panel) panel.hidden = !active;
    b.classList.toggle('selected', active);
    b.setAttribute('aria-expanded', String(active));
    b.querySelector('.category-toggle').textContent = active ? '−' : '+';
  });
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'updates') { seenUpdates = Date.now(); saveLocal(); }
  renderHome();
}
{ const nb = document.querySelector('.tabbar [data-tab="contacts"]'); if (nb) nb.dataset.tab = 'cat:' + DEFAULT_CAT; } document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
document.querySelectorAll('[data-section]').forEach(b => b.addEventListener('click', () => setTab(tab === b.dataset.section ? null : b.dataset.section)));

/* ---------- Firebase ---------- */
function boot(){
  const cfg = window.FIREBASE_CONFIG;
  if (!window.firebase || !cfg || String(cfg.apiKey).includes('ضع')) {
    $('errText').textContent = 'لازم تحط إعدادات مشروعك في ملف firebase-config.js. الخطوات موجودة في ملف README.';
    show('s-error'); return;
  }
  firebase.initializeApp(cfg);
  auth = firebase.auth(); fs = firebase.firestore();
  auth.onAuthStateChanged(u => { authSeen = true; if (u) start(u.uid); else openAuth(false); });
  // إذا ما رد Firebase خلال 12 ثانية نعرض زر إعادة المحاولة بدل شاشة تحميل معلّقة
  setTimeout(() => { if (!authSeen && !uid) authFail('timeout'); }, 12000);
  if (!IS_NATIVE) auth.getRedirectResult?.().then(r => { if (r?.operationType === 'link') toast('تم ربط حسابك ✅'); }).catch(authError);
}

/* ---------- تسجيل الدخول: جوجل / ابل / إيميل ---------- */
// في تطبيق الآيفون نستخدم شاشات جوجل وابل الأصلية، ثم ندخل Firebase بنفس الحساب
const FA = IS_NATIVE ? window.Capacitor?.Plugins?.FirebaseAuthentication : null;
let authLinkMode = false, authCreate = false;
function renderAuth(){
  $('authTitle').textContent = authLinkMode ? 'احفظ حسابك' : authCreate ? 'إنشاء حساب' : 'تسجيل الدخول إلى حسابك';
  $('authSub').textContent = authLinkMode
    ? 'اربط حسابك بجوجل أو ابل أو الإيميل عشان يبقى رمز PIN حقك وأصحابك معك حتى لو غيّرت جوالك.'
    : 'رمز PIN حقك يرتبط بحسابك ويبقى معك حتى لو غيّرت جوالك.';
  $('authSwitch').hidden = authLinkMode; $('authLater').hidden = !authLinkMode;
  $('authSwitch').innerHTML = authCreate ? 'عندك حساب؟ <b>تسجيل الدخول</b>' : 'ما عندك حساب؟ <b>إنشاء حساب</b>';
  $('appleLoginBtn').hidden = !FA;
}
function openAuth(linkMode){ authLinkMode = !!linkMode; renderAuth(); show('s-login', false); }
const authCancelled = e => /cancel|1001|popup-closed|cancelled-popup/i.test((e?.code || '') + ' ' + (e?.message || ''));
async function nativeCredential(kind){
  if (kind === 'google') {
    const r = await FA.signInWithGoogle();
    return firebase.auth.GoogleAuthProvider.credential(r?.credential?.idToken || null, r?.credential?.accessToken || null);
  }
  const r = await FA.signInWithApple();
  return new firebase.auth.OAuthProvider('apple.com').credential({ idToken: r?.credential?.idToken, rawNonce: r?.credential?.nonce });
}
async function socialAuth(kind, link){
  const u = auth.currentUser;
  let cred = null;
  try {
    if (FA) {
      cred = await nativeCredential(kind);
      if (link && u) await u.linkWithCredential(cred); else await auth.signInWithCredential(cred);
    } else {
      if (kind !== 'google') return;
      if (link && u) await u.linkWithPopup(gProvider()); else await auth.signInWithPopup(gProvider());
    }
    if (link) { await auth.currentUser?.reload(); renderAccount(); toast('تم ربط حسابك ✅ رمز PIN حقك محفوظ'); if (!$('s-login').hidden) show('s-home', false); }
  } catch (e) {
    if (authCancelled(e)) return;
    if (link && (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use')) {
      const ok = await askText('هذا الحساب مربوط بحساب ثاني في ' + APP_NAME + '. اكتب "دخول" إذا تبي تنتقل له (حسابك الحالي بيضيع)');
      const c = cred || e.credential;
      if (ok === 'دخول' && c) { await auth.signInWithCredential(c).catch(authError); location.reload(); }
      return;
    }
    if (!FA && popupIssue(e)) return (link && u ? u.linkWithRedirect(gProvider()) : auth.signInWithRedirect(gProvider())).catch(authError);
    authError(e);
  }
}
function gProvider(){ const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; }
const popupIssue = e => ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e?.code);
function authError(e){
  if (!e) return;
  console.error(e);
  const c = e.code || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
  if (c === 'auth/unauthorized-domain') toast('لازم تضيف zxe088-lab.github.io في Authorized domains داخل Firebase');
  else if (c === 'auth/operation-not-allowed') toast('لازم تفعّل الدخول بقوقل (Google) داخل Firebase');
  else if (c === 'auth/network-request-failed') toast('تأكد من اتصال الإنترنت');
  else toast('ما قدرنا نسجل الدخول، جرّب مرة ثانية');
}
async function googleSignIn(){ return socialAuth('google', false); }
let authSeen = false;
function authFail(code){
  $('errText').textContent = 'ما قدرنا نسجل الدخول. تأكد من اتصال الإنترنت وجرّب مرة ثانية.' + (code ? ' (' + code + ')' : '');
  $('errRetry').hidden = false; show('s-error', false);
}
async function anonSignIn(){
  // نعيد المحاولة تلقائياً 3 مرات قبل عرض الخطأ
  for (let i = 0; i < 3; i++) {
    try { await auth.signInAnonymously(); return; }
    catch (e) { console.error(e); if (i === 2) { authFail(e?.code || 'error'); return; } await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
}
$('errRetry').addEventListener('click', () => { $('errRetry').hidden = true; show('s-loading', false); location.reload(); });
async function linkGoogle(){
  const u = auth.currentUser; if (!u) return;
  try { await u.linkWithPopup(gProvider()); await u.reload(); toast('تم ربط حسابك بقوقل ✅'); renderAccount(); }
  catch (e) {
    if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
      const ok = await askText('حساب القوقل هذا مربوط بحساب ثاني في ' + APP_NAME + '. اكتب "دخول" إذا تبي تنتقل له (حسابك الحالي بيضيع)');
      if (ok === 'دخول' && e.credential) { await auth.signInWithCredential(e.credential).catch(authError); location.reload(); }
      return;
    }
    if (popupIssue(e)) return u.linkWithRedirect(gProvider()).catch(authError);
    authError(e);
  }
}
/* ---------- دخول المالك بالإيميل ---------- */
// الربط: المالك يربط إيميل وكلمة مرور بحسابه الحالي (نفس الـ UID)، وبعدها يدخل فيه من أي جهاز.
// لازم يكون الدخول بالإيميل (Email/Password) مفعّل في Firebase Authentication ← Sign-in method.
let emailMode = 'login', emailReturn = 's-login';
function openEmailScreen(mode, from){
  emailMode = mode; emailReturn = from || 's-login';
  const link = mode === 'link', signup = mode === 'signup';
  $('emailTitle').textContent = link ? 'ربط حسابك بإيميل' : signup ? 'إنشاء حساب بالإيميل' : 'تسجيل الدخول بالإيميل';
  $('emailIntro').textContent = link
    ? 'اختر إيميل وكلمة مرور (8 خانات أو أكثر). بعد الربط تدخل بهم من أي جهاز بنفس حسابك ورمز PIN حقك.'
    : signup ? 'اكتب إيميلك واختر كلمة مرور (8 خانات أو أكثر).' : 'ادخل بالإيميل وكلمة المرور حق حسابك.';
  $('emailSubmit').textContent = link ? 'ربط الإيميل' : signup ? 'إنشاء الحساب' : 'دخول';
  $('emailPass').autocomplete = link || signup ? 'new-password' : 'current-password';
  $('emailReset').hidden = link || signup;
  $('emailPass').value = '';
  show('s-email');
}
function emailAuthError(e){
  console.error(e);
  const c = e?.code || '';
  if (c === 'auth/operation-not-allowed') toast('لازم تفعّل الدخول بالإيميل (Email/Password) داخل Firebase');
  else if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(c)) toast('الإيميل أو كلمة المرور غير صحيحة');
  else if (c === 'auth/invalid-email') toast('الإيميل غير صحيح');
  else if (c === 'auth/weak-password') toast('كلمة المرور ضعيفة، استخدم 8 خانات أو أكثر');
  else if (c === 'auth/email-already-in-use' || c === 'auth/credential-already-in-use') toast('هذا الإيميل مربوط بحساب ثاني');
  else if (c === 'auth/provider-already-linked') toast('حسابك مربوط بإيميل من قبل');
  else if (c === 'auth/requires-recent-login') toast('سجّل خروج ثم ادخل من جديد وجرّب الربط');
  else if (c === 'auth/too-many-requests') toast('محاولات كثيرة، انتظر شوي وجرّب');
  else if (c === 'auth/network-request-failed') toast('تأكد من اتصال الإنترنت');
  else toast('ما قدرنا ننفّذ الطلب، جرّب مرة ثانية');
}
$('emailSubmit').addEventListener('click', async () => {
  const email = $('emailInput').value.trim(), pass = $('emailPass').value;
  if (!email || !pass) { toast('اكتب الإيميل وكلمة المرور'); return; }
  if ((emailMode === 'link' || emailMode === 'signup') && pass.length < 8) { toast('كلمة المرور لازم تكون 8 خانات أو أكثر'); return; }
  $('emailSubmit').disabled = true;
  try {
    if (emailMode === 'link') {
      const u = auth.currentUser; if (!u) return;
      await u.linkWithCredential(firebase.auth.EmailAuthProvider.credential(email, pass));
      await u.reload(); $('emailPass').value = ''; renderAccount(); toast('تم ربط الإيميل ✅ تقدر تدخل فيه من أي جهاز');
      if (emailReturn === 's-login') show('s-home', false); else back();
    } else if (emailMode === 'signup') {
      await auth.createUserWithEmailAndPassword(email, pass);
      $('emailPass').value = ''; location.reload();
    } else {
      await auth.signInWithEmailAndPassword(email, pass);
      $('emailPass').value = ''; location.reload();
    }
  } catch (e) { emailAuthError(e); }
  $('emailSubmit').disabled = false;
});
$('emailReset').addEventListener('click', async () => {
  const email = $('emailInput').value.trim();
  if (!email) { toast('اكتب الإيميل أول'); return; }
  try { await auth.sendPasswordResetEmail(email); toast('إذا الإيميل مسجّل بيوصلك رابط إعادة تعيين كلمة المرور'); } catch (e) { emailAuthError(e); }
});
$('emailCancel').addEventListener('click', () => { $('emailPass').value = ''; if (emailMode === 'link' && emailReturn !== 's-login') back(); else show(emailReturn, false); });
$('emailLoginBtn').addEventListener('click', () => openEmailScreen(authLinkMode ? 'link' : authCreate ? 'signup' : 'login', 's-login'));
$('linkEmailBtn').addEventListener('click', () => openEmailScreen('link'));
$('authSwitch').addEventListener('click', () => { authCreate = !authCreate; renderAuth(); });
$('authLater').addEventListener('click', () => show('s-home', false));
$('appleLoginBtn').addEventListener('click', () => socialAuth('apple', authLinkMode));
$('linkAppleBtn').addEventListener('click', () => socialAuth('apple', true));
$('setupOtherBtn').addEventListener('click', async () => { await FA?.signOut?.().catch(() => {}); await auth.signOut(); location.reload(); });

async function signOutNow(){
  const u = auth.currentUser;
  if (u?.isAnonymous) {
    const ok = await askText('حسابك مو مربوط بجوجل أو ابل أو إيميل، لو طلعت بيضيع نهائياً. اكتب "خروج" للتأكيد');
    if (ok !== 'خروج') return;
  }
  await FA?.signOut?.().catch(() => {});
  await auth.signOut(); location.reload();
}
function renderAccount(){
  const u = auth?.currentUser; if (!u) return;
  $('accId').textContent = u.uid;
  const pw = (u.providerData || []).find(p => p.providerId === 'password');
  const pwText = pw ? 'مربوط بالإيميل: ' + (pw.email || u.email || '') : '';
  $('linkEmailBtn').hidden = !!pw;
  const ap = (u.providerData || []).find(p => p.providerId === 'apple.com');
  $('linkAppleBtn').hidden = !FA || !!ap;
  $('signOutBtn').hidden = u.isAnonymous;
  const g = (u.providerData || []).find(p => p.providerId === 'google.com');
  if (ap && !g) { $('accState').textContent = 'مربوط بابل' + (ap.email ? ': ' + ap.email : ''); $('linkGoogleBtn').hidden = false; return; }
  $('accState').textContent = g ? 'مربوط بقوقل: ' + (g.email || u.email || '') : pwText || 'حسابك مو مربوط. لو مسحت بيانات المتصفح أو غيّرت جوالك بيضيع حسابك.';
  $('linkGoogleBtn').hidden = !!g;
}

// حذف الحساب نهائياً (شرط من آبل)
async function deleteAccount(){
  const ok = await askText('حذف الحساب نهائي: ملفك ورمز PIN وجهات اتصالك. اكتب "حذف" للتأكيد');
  if (ok !== 'حذف') return;
  try {
    const wipe = async col => { const s = await fs.collection(col).get(); for (const d of s.docs) await fs.doc(col + '/' + d.id).delete(); };
    await wipe('users/' + uid + '/contacts');
    await wipe('users/' + uid + '/blocked');
    if (me?.pin) await fs.doc('pins/' + me.pin).delete().catch(() => {});
    await fs.doc('users/' + uid).delete();
    try { await auth.currentUser.delete(); } catch { try { await auth.signOut(); } catch {} }
    toast('تم حذف حسابك');
    setTimeout(() => location.reload(), 1200);
  } catch (e) { console.error(e); toast('ما قدرنا نحذف الحساب، جرّب مرة ثانية'); }
}
$('deleteAccBtn').addEventListener('click', deleteAccount);

// الحظر والإبلاغ (شرط من آبل)
async function setBlocked(id, on){
  try {
    const ref = fs.doc('users/' + uid + '/blocked/' + id);
    if (on) await ref.set({ at: Date.now() }); else await ref.delete();
    toast(on ? 'تم حظر ' + nameOf(id) + '. ما راح يقدر يراسلك.' : 'تم إلغاء الحظر');
  } catch (e) { console.error(e); toast('ما قدرنا نحدّث الحظر، جرّب مرة ثانية'); }
}
async function reportUser(id){
  const reason = await askText('ليش تبلّغ عن ' + nameOf(id) + '؟ (اختياري)');
  if (reason === null) return;
  let recent = [];
  try {
    const s = await fs.collection('chats/' + chatIdWith(id) + '/messages').orderBy('ts', 'desc').limit(30).get();
    recent = s.docs.map(d => d.data()).filter(m => m.from === id && m.text).slice(0, 10).map(m => m.text.slice(0, 300));
  } catch {}
  try {
    await fs.collection('reports').add({ from: uid, about: id, aboutName: nameOf(id), reason: reason.slice(0, 500), messages: recent, ts: Date.now() });
    toast('وصل البلاغ، بنراجعه خلال 24 ساعة. تقدر تحظره بعد.');
  } catch (e) { console.error(e); toast('ما قدرنا نرسل البلاغ، جرّب مرة ثانية'); }
}
$('googleLoginBtn').addEventListener('click', () => socialAuth('google', authLinkMode));
$('linkGoogleBtn').addEventListener('click', () => socialAuth('google', true));
$('signOutBtn').addEventListener('click', signOutNow);

function start(id){
  if (uid) return; uid = id;
  fs.doc('users/' + uid).onSnapshot(s => {
    const had = !!me; me = s.exists ? s.data() : null;
    if (!me) { if (auth.currentUser?.isAnonymous && !isOwner(uid)) { auth.signOut().then(() => location.reload()); return; } show('s-setup', false); watchMyJoin(); return; }
    if (!had) {
      show('s-home', false); listen(); heartbeat(); setupPush();
      if (auth.currentUser?.isAnonymous) setTimeout(() => { if (!$('s-home').hidden) openAuth(true); }, 900);
      // ميزة تغيير الرمز لصاحب التطبيق فقط (مسجّل في مجموعة admins)
      $('pinAdminCard').hidden = !isOwner(uid);
      if (isOwner(uid)) watchJoinRequests();
    }
    renderHomeSoon(); if (profileId === uid && !$('s-profile').hidden) renderProfile();
  }, err => { $('errText').textContent = 'ما عندك صلاحية. تأكد من نسخ قواعد الأمان (firestore.rules) في Firebase.'; show('s-error'); console.error(err); });
}

$('setupBtn').addEventListener('click', async () => {
  const name = $('setupName').value.trim();
  if (!name) { toast('اكتب اسم العرض · Enter a display name'); return; }
  if (!$('agreeTerms').checked) { toast('لازم توافق على شروط الاستخدام · Please accept the terms'); return; }
  $('setupBtn').disabled = true;
  const invite = ($('setupInvite')?.value || '').trim().toUpperCase();
  try {
    if (isOwner(uid) || !auth.currentUser?.isAnonymous || (invite && inviteOk(invite))) {
      let pin;
      for (let i = 0; i < 5; i++) { pin = newPin(); if (!(await fs.doc('pins/' + pin).get()).exists) break; }
      await fs.doc('pins/' + pin).set({ uid });
      await createMe(name, pin);
    } else {
      // طلب انضمام: المالك يوافق ويحدد رمز PIN
      if (invite) { toast('رمز الدعوة غير صحيح · Invalid invite code'); $('setupBtn').disabled = false; return; }
      await fs.doc('joinRequests/' + uid).set({ name, at: Date.now(), status: 'pending' });
    }
  } catch (e) { console.error(e); toast('صار خطأ، جرّب مرة ثانية' + (e?.code ? ' (' + e.code + ')' : '')); }
  $('setupBtn').disabled = false;
});

// رمز دعوة يتخطى انتظار الموافقة (يُعطى لمراجع آبل في ملاحظات المراجعة). نخزن البصمة فقط
const INVITE_HASHES = ['2ah47uqytni'];
function inviteHash(s){let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0,ch;i<s.length;i++){ch=s.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507);h1^=Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507);h2^=Math.imul(h1^(h1>>>13),3266489909);return (4294967296*(2097151&h2)+(h1>>>0)).toString(36);}
const inviteOk = code => INVITE_HASHES.includes(inviteHash('bpb-invite:' + code));

// إشعارات الآيفون وأنت خارج التطبيق: نحفظ رمز الجهاز في ملفك، والسيرفر يرسل التنبيه
const Push = IS_NATIVE ? window.Capacitor?.Plugins?.PushNotifications : null;
// بعد كل رسالة نطلب من سيرفر الإشعارات (Vercel المجاني) ينبّه الطرف الثاني
const PUSH_URL = window.PUSH_URL || 'https://51-254-218-100.sslip.io/api/notify';
function notifyPush(chatId){
  if (!PUSH_URL || !chatId) return;
  auth.currentUser?.getIdToken().then(t => fetch(PUSH_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ chatId }), keepalive: true
  })).catch(() => {});
}
async function setupPush(){
  if (!Push) return;
  try {
    Push.addListener('registration', t => {
      if (t?.value && me?.apns !== t.value) fs.doc('users/' + uid).update({ apns: t.value }).catch(console.error);
    });
    Push.addListener('registrationError', e => console.error('push', e));
    Push.addListener('pushNotificationActionPerformed', a => {
      const cid = a?.notification?.data?.chatId; if (!cid) return;
      const go = () => {
        const c = chats[cid]; if (!c) return false;
        if (c.isGroup) openGroup(cid); else { const p = (c.members || []).find(m => m !== uid); if (p) openChat(p); }
        return true;
      };
      if (!go()) { let n = 0; const t = setInterval(() => { if (go() || ++n > 20) clearInterval(t); }, 500); }
    });
    let p = await Push.checkPermissions();
    if (p.receive === 'prompt' || p.receive === 'prompt-with-rationale') p = await Push.requestPermissions();
    if (p.receive === 'granted') await Push.register();
    const clear = () => { if (document.visibilityState === 'visible') Push.removeAllDeliveredNotifications?.().catch(() => {}); };
    clear(); document.addEventListener('visibilitychange', clear);
  } catch (e) { console.error('push', e); }
}
function heartbeat(){
  const beat = () => { if (document.visibilityState === 'visible') fs.doc('users/' + uid).update({ lastSeen: Date.now() }).catch(() => {}); };
  beat(); setInterval(beat, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { beat(); markRead(); updateTitle(); });
  setInterval(() => { renderHomeSoon(); if (!$('s-profile').hidden) renderProfile(); if (chatPeer || chatGroup) renderChatHead(); }, 30000);
}

function watchUser(id){
  if (userSubs[id]) return;
  userSubs[id] = fs.doc('users/' + id).onSnapshot(s => {
    const prev = users[id];
    if (s.exists) { users[id] = s.data(); delete gone[id]; } else { delete users[id]; gone[id] = true; }
    if (prev && users[id] && prev.updatedAt !== users[id].updatedAt && contacts[id]) play('contact');
    renderHomeSoon();
    if (profileId === id && !$('s-profile').hidden) renderProfile();
    if (chatPeer === id) { renderChatHead(); renderMsgsSoon(); }
  });
}

function listen(){
  ['from', 'to'].forEach(field => {
    fs.collection('contactRequests').where(field, '==', uid).onSnapshot(s => {
      const items = {}; s.docs.forEach(d => { items[d.id] = d.data(); watchUser(field === 'from' ? d.data().to : d.data().from); });
      if (field === 'from') outgoingRequests = items; else incomingRequests = items;
      renderHomeSoon();
    }, () => { requestsReadable = false; renderHomeSoon(); });
  });
  fs.collection('users/' + uid + '/blocked').onSnapshot(s => {
    blocked = {}; s.docs.forEach(d => blocked[d.id] = true);
    renderHomeSoon();
    if (chatPeer) { renderChatHead(); renderMsgsSoon(); }
    if (profileId && !$('s-profile').hidden) renderProfile();
  });
  fs.collection('users/' + uid + '/contacts').onSnapshot(s => {
    contacts = {};
    s.docs.forEach(d => { contacts[d.id] = d.data(); watchUser(d.id); });
    renderHomeSoon();
  });
  fs.collection('chats').where('members', 'array-contains', uid).onSnapshot(s => {
    s.docChanges().forEach(c => {
      const d = c.doc.data(), peer = d.members.find(m => m !== uid);
      if (d.isGroup) (d.members || []).forEach(m => m !== uid && watchUser(m)); else if (peer) watchUser(peer);
      if (!firstChatsSnap && c.type !== 'removed' && d.lastFrom && d.lastFrom !== uid && !isBlocked(d.lastFrom) && d.lastTs > (chats[c.doc.id]?.lastTs || 0)) {
        const viewing = c.doc.id === chatId && document.visibilityState === 'visible';
        ledFlash();
        const pref = notifPref(chatCat(d)), away = arrivedWhileAway(d.lastTs);
        if (away) { /* الإشعار نبّه عليها */ }
        else if (d.lastKind === 'ping') { nudgeEffect(); if (!pref.mute) playMsgTone(pref.tone); }
        else if (!viewing && !pref.mute) { playMsgTone(pref.tone); buzz(200); }
      }
    });
    chats = {}; s.docs.forEach(d => chats[d.id] = d.data());
    groups = {}; Object.entries(chats).forEach(([id, c]) => { if (c.isGroup) groups[id] = c; });
    cleanupInactiveChats();
    firstChatsSnap = false;
    renderHomeSoon();
  });
}

/* ---------- الرئيسية ---------- */
let homeTimer = null;
function renderHomeSoon(){ clearTimeout(homeTimer); homeTimer = setTimeout(renderHome, 30); }
const unreadOf = c => c.lastTs > Date.now()-MESSAGE_LIFETIME && c.lastFrom && c.lastFrom !== uid && c.lastTs > ((c.read || {})[uid] || 0);

function renderHome(){
  if (!me) return;
  buildMenu();
  $('meHeadAvatar').replaceChildren(avatar(uid, 'sm'));
  $('meHeadName').textContent = me.name;
  $('meHeadMsg').textContent = me.msg || statusLabel(me);
  $('meHeadStatus').className = 'st-icon' + (me.busy ? ' busy' : '');
  const contactIds = Object.keys(contacts).filter(id => !gone[id]);
  $('classicChatsCount').textContent = '(' + Object.values(chats).filter(c => c.lastTs && (c.isGroup || (!isBlocked(c.members.find(m => m !== uid)) && !gone[c.members.find(m => m !== uid)]))).length + ')';
  $('classicNamesCount').textContent = '(' + contactIds.length + ')';
  $('classicFriendsCount').textContent = '(' + contactIds.filter(id => !isBlocked(id)).length + ')';
  if (tab === 'chats') renderChats(); else if (tab === 'contacts' || tab === 'friends') renderContacts(); else if (tab === 'updates') renderUpdates(); else if (tab === 'pending') renderPending(); else if (tab === 'groups') renderGroups(); else if (tab && tab.startsWith('cat:')) renderCatPanel(tab);
  $('classicUpdatesCount').textContent = '(' + recentUpdates().length + ')';
  $('classicGroupsCount').textContent = '(' + Object.keys(groups).length + ')';
  $('classicPendingCount').textContent = requestsReadable ? '(' + pendingRequests().length + ')' : '(—)';
  const ups = recentUpdates().filter(id => users[id].updatedAt > seenUpdates).length;
  $('updDot').hidden = !ups || tab === 'updates';
  // نجمة حمراء مثل BBM: فيه جديد في هذا القسم
  const unreadChats = Object.values(chats).filter(c => unreadOf(c) && !isBlocked(c.lastFrom)).length;
  const incoming = requestsReadable ? pendingRequests().filter(([, r]) => r.to === uid).length : 0;
  setSplat('chats', unreadChats > 0);
  setSplat('updates', ups > 0 && tab !== 'updates');
  setSplat('pending', incoming > 0);
  setSplat('groups', Object.values(groups).some(g => unreadOf(g) && !isBlocked(g.lastFrom)));
  updateTitle();
}
function setSplat(section, on){
  const btn = document.querySelector('#s-home .classic-menu [data-section="' + section + '"]'); if (!btn) return;
  let s = btn.querySelector('.splat');
  if (!s) { s = el('span', 'splat'); s.setAttribute('aria-label', 'جديد'); s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#d81e1e" stroke="#fff" stroke-width="1.6"/><path d="M12 5.2l1.9 4.2 4.6.4-3.5 3 1.1 4.5L12 15l-4.1 2.3 1.1-4.5-3.5-3 4.6-.4z" fill="#fff"/></svg>'; btn.append(s); }
  s.hidden = !on;
}

function renderChats(){
  const list = $('chatList'); list.replaceChildren();
  const arr = Object.entries(chats).filter(([, c]) => { if (c.lastTs <= Date.now()-MESSAGE_LIFETIME) return false; if (c.isGroup) return true; const p = c.members.find(m => m !== uid); return !isBlocked(p) && !gone[p]; }).sort((a, b) => b[1].lastTs - a[1].lastTs);
  if (!arr.length) { list.append(el('div', 'empty', 'ما فيه دردشات. افتح جهات الاتصال واختر أحداً لبدء الدردشة.')); return; }
  arr.forEach(([id, c]) => {
    const peer = c.isGroup ? null : c.members.find(m => m !== uid), un = unreadOf(c);
    const row = el('button', 'row' + (un ? ' unread' : '')); row.type = 'button';
    const info = el('span', 'info');
    const nm = el('span', 'nm');
    if (c.isGroup) nm.append(el('span', '', c.name || 'مجموعة')); else nm.append(statusIcon(peer), el('span', '', nameOf(peer)));
    const who = c.lastFrom === uid ? 'أنت: ' : c.isGroup && c.lastFrom && c.lastKind !== 'system' ? nameOf(c.lastFrom) + ': ' : '';
    const last = c.lastKind === 'ping' ? who + 'PING!!!' : who + (c.lastKind === 'broadcast' ? '📢 ' : '') + (c.lastMsg || '');
    info.append(nm, el('span', 'sub' + (c.lastKind === 'broadcast' ? ' bc' : c.lastKind === 'ping' ? ' ping-preview' : ''), last));
    const side = el('span', 'side'); side.append(el('span', 'when', shortWhen(c.lastTs)));
    if (un) side.append(el('span', 'newpill', 'جديد'));
    row.append(c.isGroup ? groupAvatar(id, 'sm') : avatar(peer, 'sm'), info, side);
    row.addEventListener('click', () => c.isGroup ? openGroup(id) : openChat(peer));
    list.append(row);
  });
}

function renderContacts(){
  const friends = tab === 'friends';
  const list = $(friends ? 'friendsList' : 'contactList'); list.replaceChildren();
  const q = friends ? '' : $('search').value.trim().toLowerCase();
  const ids = Object.keys(contacts).filter(id => !gone[id] && (!friends || !isBlocked(id)));
  if (!ids.length) { list.append(el('div', 'empty', 'ما عندك جهات اتصال. اضغط "إضافة" تحت واكتب رمز PIN حق صاحبك.')); return; }
  const cats = friends ? [null] : [...new Set([...(me.cats || [DEFAULT_CAT]), ...ids.map(id => contacts[id].cat || DEFAULT_CAT)])];
  cats.forEach(cat => {
    const inCat = ids.filter(id => (cat === null || (contacts[id].cat || DEFAULT_CAT) === cat) && (!q || nameOf(id).toLowerCase().includes(q)))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ar'));
    if (!inCat.length && (q || cats.length > 1)) return;
    const open = cat === null || !closedCats[cat] || q;
    if (cat !== null) { const h = el('button', 'cathead'); h.type = 'button';
    h.append(el('span', 'grow', catLabel(cat)), el('span', 'n', inCat.length), el('span', 'tog', open ? '−' : '+'));
    h.addEventListener('click', () => { closedCats[cat] = !closedCats[cat]; saveLocal(); renderContacts(); });
    list.append(h); }
    if (!open) return;
    if (!inCat.length) { list.append(el('div', 'empty', 'الفئة فاضية.')); return; }
    const grid = el('div', 'grid');
    inCat.forEach(id => {
      const t = el('button', 'row classic-contact'); t.type = 'button';
      const info = el('span', 'info');
      const tn = el('span', 'nm'); tn.append(statusIcon(id), el('span', '', nameOf(id)));
      info.append(tn, el('span', 'sub', users[id]?.msg || statusText(id)));
      t.append(avatar(id, 'xs'), info);
      if (isBlocked(id)) { t.classList.add('blocked'); t.append(el('span', 'tblocked', 'محظور')); }
      else if (users[id]?.busy) t.append(el('span', 'tbusy', '−'));
      t.addEventListener('click', () => openProfile(id));
      grid.append(t);
    });
    list.append(grid);
  });
}
$('search').addEventListener('input', renderContacts);

/* ---------- القائمة القابلة للتعديل ---------- */
const BUILTIN = ['updates', 'chats', 'friends', 'groups', 'broadcast', 'pending']; const MAIN_CAT = 'cat:' + DEFAULT_CAT; // كل فئة قسم مستقل
const BUILTIN_LABEL = { chats: 'الدردشات', updates: 'التحديثات', contacts: 'الأسماء', friends: 'الأصدقاء', broadcast: '📢 برودكاست', groups: 'المجموعات', pending: 'المعلّق' };
const userCats = () => (me.cats || [DEFAULT_CAT]).filter(c => c !== DEFAULT_CAT);
const defaultLabel = k => k.startsWith('cat:') ? k.slice(4) : BUILTIN_LABEL[k];
function menuCfg(src = me.menu, cats = userCats()){
  const m = src || {}, all = [...BUILTIN, MAIN_CAT, ...cats.map(c => 'cat:' + c)];
  // ترتيب قديم (قبل فصل الأقسام) يرجع للترتيب الجديد الافتراضي
  const order = (m.order && !m.order.includes('contacts') ? m.order : []).filter(k => all.includes(k));
  all.forEach(k => {
    if (order.includes(k)) return;
    const lastCat = order.reduce((p, x, j) => x.startsWith('cat:') ? j : p, -1); const at = k.startsWith('cat:') ? (lastCat >= 0 ? lastCat + 1 : order.includes('friends') ? order.indexOf('friends') + 1 : -1) : k === 'broadcast' && order.includes('groups') ? order.indexOf('groups') + 1 : -1;
    at >= 0 ? order.splice(at, 0, k) : order.push(k);
  });
  return { order, labels: { ...(m.labels || {}) }, hidden: (m.hidden || []).filter(k => all.includes(k)) };
}
const labelOf = (k, cfg = menuCfg()) => (cfg.labels[k] || '').trim() || defaultLabel(k);
const catLabel = c => labelOf('cat:' + c);
const catDom = {};
function catSection(key){
  if (catDom[key]) return catDom[key];
  const i = Object.keys(catDom).length + 1 + '-' + Date.now().toString(36);
  const btn = el('button', 'classic-category'); btn.type = 'button'; btn.dataset.section = key;
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 't-cat' + i);
  const lab = el('span'); lab.append(el('span', 'cl'), ' ', el('span', 'cnt'));
  btn.append(lab, el('span', 'category-toggle', '+'));
  btn.addEventListener('click', () => setTab(tab === key ? null : key));
  const panel = el('div', 'classic-panel'); panel.id = 't-cat' + i; panel.hidden = true;
  const list = el('div', 'scroll'); panel.append(list);
  return catDom[key] = { btn, panel, list };
}
function buildMenu(){
  const cfg = menuCfg(), menu = document.querySelector('#s-home .classic-menu'), tail = $('menuEditBtn'); ['contacts'].forEach(k => { const b = menu.querySelector('[data-section="' + k + '"]'); if (b) { b.hidden = true; const p = document.getElementById(b.getAttribute('aria-controls')); if (p) p.hidden = true; } });
  Object.keys(catDom).forEach(k => { if (!cfg.order.includes(k)) { catDom[k].btn.remove(); catDom[k].panel.remove(); delete catDom[k]; } });
  cfg.order.forEach(k => {
    let btn, panel;
    if (k === 'broadcast') { btn = $('broadcastBtn'); btn.querySelector('.cl').textContent = labelOf(k, cfg); btn.hidden = cfg.hidden.includes(k); menu.insertBefore(btn, tail); return; }
    if (k.startsWith('cat:')) ({ btn, panel } = catSection(k));
    else { btn = menu.querySelector('[data-section="' + k + '"]'); panel = document.getElementById(btn.getAttribute('aria-controls')); }
    btn.querySelector('.cl').textContent = labelOf(k, cfg);
    if (k.startsWith('cat:')) btn.querySelector('.cnt').textContent = '(' + catMembers(k.slice(4)).length + ')';
    const off = cfg.hidden.includes(k);
    btn.hidden = off; if (off) panel.hidden = true;
    menu.insertBefore(btn, tail); menu.insertBefore(panel, tail);
  });
  if (tab && cfg.hidden.includes(tab)) tab = null;
}
function catMembers(cat){
  return Object.keys(contacts).filter(id => !gone[id] && (contacts[id].cat || DEFAULT_CAT) === cat).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ar'));
}
function renderCatPanel(key){
  const d = catDom[key]; if (!d) return;
  const list = d.list; list.replaceChildren();
  const ids = catMembers(key.slice(4));
  if (!ids.length) { list.append(el('div', 'empty', 'الفئة فاضية. انقل لها أحداً من ملف تعريفه.')); return; }
  const grid = el('div', 'grid');
  ids.forEach(id => {
    const t = el('button', 'row classic-contact'); t.type = 'button';
    const info = el('span', 'info'), tn = el('span', 'nm');
    tn.append(statusIcon(id), el('span', '', nameOf(id)));
    info.append(tn, el('span', 'sub', users[id]?.msg || statusText(id)));
    t.append(avatar(id, 'xs'), info);
    if (isBlocked(id)) { t.classList.add('blocked'); t.append(el('span', 'tblocked', 'محظور')); }
    else if (users[id]?.busy) t.append(el('span', 'tbusy', '−'));
    t.addEventListener('click', () => openProfile(id));
    grid.append(t);
  });
  list.append(grid);
}

let menuDraft = null;
function openMenuEdit(){
  const cats = userCats(), c = menuCfg(me.menu, cats);
  menuDraft = { ...c, cats: [...cats], removed: [] };
  $('menuNewCat').value = '';
  renderMenuEdit(); show('s-menu');
}
function renderMenuEdit(){
  const box = $('menuEditList'); box.replaceChildren();
  const mk = (txt, cls, fn) => { const b = el('button', 'mb' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; b.addEventListener('click', fn); return b; };
  menuDraft.order.forEach((k, i) => {
    const off = menuDraft.hidden.includes(k), row = el('div', 'medit' + (off ? ' off' : ''));
    const inp = el('input'); inp.maxLength = 40; inp.value = menuDraft.labels[k] || ''; inp.placeholder = defaultLabel(k);
    inp.addEventListener('input', () => { menuDraft.labels[k] = inp.value; });
    const move = dir => { const j = i + dir; if (j < 0 || j >= menuDraft.order.length) return; [menuDraft.order[i], menuDraft.order[j]] = [menuDraft.order[j], menuDraft.order[i]]; renderMenuEdit(); };
    row.append(inp, mk('▲', '', () => move(-1)), mk('▼', '', () => move(1)),
      mk(off ? 'إظهار' : 'إخفاء', '', () => { menuDraft.hidden = off ? menuDraft.hidden.filter(x => x !== k) : [...menuDraft.hidden, k]; renderMenuEdit(); }));
    if (k.startsWith('cat:') && k !== MAIN_CAT) row.append(mk('حذف', 'del', () => {
      const name = k.slice(4);
      menuDraft.order = menuDraft.order.filter(x => x !== k); menuDraft.hidden = menuDraft.hidden.filter(x => x !== k);
      delete menuDraft.labels[k]; menuDraft.cats = menuDraft.cats.filter(c => c !== name); menuDraft.removed.push(name);
      renderMenuEdit();
    }));
    else if (k === MAIN_CAT || k === 'chats') row.append(el('span', 'tag', 'أساسي'));
    box.append(row);
  });
}
$('menuAddCat').addEventListener('click', () => {
  const name = $('menuNewCat').value.trim();
  if (!name) return;
  if (name === DEFAULT_CAT || menuDraft.cats.includes(name)) { toast('الفئة موجودة'); return; }
  menuDraft.cats.push(name); menuDraft.removed = menuDraft.removed.filter(c => c !== name);
  const lastCat = menuDraft.order.reduce((p, x, j) => x.startsWith('cat:') ? j : p, -1); menuDraft.order.splice(lastCat >= 0 ? lastCat + 1 : menuDraft.order.length, 0, 'cat:' + name);
  $('menuNewCat').value = ''; renderMenuEdit();
});
$('menuReset').addEventListener('click', () => {
  menuDraft.labels = {}; menuDraft.hidden = [];
  menuDraft.order = menuCfg({}, menuDraft.cats).order; renderMenuEdit();
});
$('menuSave').addEventListener('click', async () => {
  // الأساسية ما تنخفي كلها: لازم تبقى الدردشات أو الأسماء ظاهرة
  if (menuDraft.hidden.includes('chats') && menuDraft.hidden.includes(MAIN_CAT)) { toast('خلّ الدردشات أو جهات الاتصال ظاهرة'); return; }
  const labels = {};
  Object.entries(menuDraft.labels).forEach(([k, v]) => { v = (v || '').trim().slice(0, 40); if (v && v !== defaultLabel(k)) labels[k] = v; });
  const menu = { order: menuDraft.order, labels, hidden: menuDraft.hidden };
  try {
    await fs.doc('users/' + uid).update({ menu, cats: [DEFAULT_CAT, ...menuDraft.cats] });
    await Promise.all(Object.keys(contacts).filter(id => menuDraft.removed.includes(contacts[id].cat))
      .map(id => fs.doc('users/' + uid + '/contacts/' + id).set({ cat: DEFAULT_CAT }, { merge: true })));
    toast('تم حفظ القائمة'); back();
  } catch { toast('ما قدرنا نحفظ القائمة'); }
});
$('menuEditBtn').addEventListener('click', openMenuEdit);

const CHANGE_TEXT = { msg: 'غيّر رسالته الشخصية', name: 'غيّر اسم العرض', photo: 'غيّر صورة العرض', status: 'غيّر حالته', join: 'صار من جهات الاتصال', country: 'غيّر موقعه' };
function recentUpdates(){
  const week = Date.now() - 7 * 864e5;
  return Object.keys(contacts).filter(id => users[id]?.updatedAt > week && !isBlocked(id)).sort((a, b) => users[b].updatedAt - users[a].updatedAt);
}
function renderUpdates(){
  const list = $('updatesList'); list.replaceChildren();
  const ids = recentUpdates();
  if (!ids.length) { list.append(el('div', 'empty', 'ما فيه تحديثات خلال آخر أسبوع.')); return; }
  ids.forEach(id => {
    const d = users[id], row = el('button', 'row upd'); row.type = 'button';
    const info = el('span', 'info');
    const line = el('span', 'nm'); line.style.whiteSpace = 'normal';
    const t = el('span'); t.append(el('b', '', d.name), ' ' + (CHANGE_TEXT[d.change] || 'حدّث ملفه'));
    if (d.change === 'msg' && d.msg) t.append(': ' + d.msg);
    if (d.change === 'status') t.append(': ' + statusLabel(d));
    if (d.change === 'country') t.append(': ' + flagOf(d.country) + ' ' + countryName(d.country));
    line.append(t);
    info.append(line, el('span', 'sub', ago(d.updatedAt)));
    row.append(avatar(id, 'sm'), info);
    row.addEventListener('click', () => openProfile(id));
    list.append(row);
  });
}

function updateTitle(){
  const n = Object.values(chats).filter(c => unreadOf(c) && !isBlocked(c.lastFrom)).length;
  document.title = (n ? '(' + n + ') ' : '') + APP_NAME;
  $('unreadBadge').hidden = !n; $('unreadBadge').textContent = n;
}

/* ---------- طلبات الإضافة والمجموعات ---------- */
function pendingRequests(){
  return Object.entries({ ...outgoingRequests, ...incomingRequests }).filter(([, r]) => r.status === 'pending').sort((a,b) => b[1].createdAt - a[1].createdAt);
}
async function respondRequest(id, accept){
  try {
    const ref = fs.doc('contactRequests/' + id);
    if (!accept) { await ref.delete(); return; }
    await fs.runTransaction(async tx => {
      const snap = await tx.get(ref), r = snap.data();
      if (!snap.exists || r.to !== uid || r.status !== 'pending' || isBlocked(r.from)) throw Error('invalid request');
      tx.update(ref, { status: 'accepted' });
      tx.set(fs.doc('users/' + uid + '/contacts/' + r.from), { at: Date.now(), cat: DEFAULT_CAT }, { merge: true });
      tx.set(fs.doc('users/' + r.from + '/contacts/' + uid), { at: Date.now(), cat: r.cat || DEFAULT_CAT }, { merge: true });
    });
    toast('تم قبول طلب الإضافة'); play('contact');
  } catch { toast('تعذر تحديث الطلب. تحقق من الاتصال وقواعد Firebase'); }
}
function renderPending(){
  const list = $('pendingList'); list.replaceChildren();
  if (!requestsReadable) { list.append(el('div','empty','تعذر قراءة الطلبات. يجب نشر قواعد Firebase الجديدة.')); return; }
  const entries = pendingRequests();
  if (!entries.length) { list.append(el('div','empty','لا توجد طلبات إضافة معلّقة')); return; }
  entries.forEach(([id,r]) => {
    const sent = r.from === uid, peer = sent ? r.to : r.from;
    const row = el('div','row request-row'), info = el('span','info');
    info.append(el('span','nm',nameOf(peer)),el('span','sub',sent ? 'بانتظار قبول الإضافة' : 'طلب إضافة وارد'));
    const actions = el('span','request-actions');
    if (!sent && !isBlocked(peer)) { const accept = el('button','btn sm','قبول'); accept.type='button'; accept.onclick=async()=>{accept.disabled=true; await respondRequest(id,true); accept.disabled=false;}; actions.append(accept); }
    const cancel = el('button','btn sm',sent ? 'إلغاء الطلب' : 'رفض'); cancel.type='button'; cancel.onclick=async()=>{cancel.disabled=true; await respondRequest(id,false); cancel.disabled=false;}; actions.append(cancel);
    row.append(avatar(peer,'xs'),info,actions); list.append(row);
  });
}
function renderGroups(){
  const list = $('groupsList'); list.replaceChildren();
  const add = el('button', 'row group-new'); add.type = 'button';
  add.append(el('span', 'info', '➕ مجموعة جديدة')); add.addEventListener('click', () => openGroupEditor(null));
  list.append(add);
  const entries = Object.entries(groups).sort((a, b) => (b[1].lastTs || 0) - (a[1].lastTs || 0));
  if (!entries.length) { list.append(el('div', 'empty', 'ما عندك مجموعات. اضغط «مجموعة جديدة» واختر أصدقاءك.')); return; }
  entries.forEach(([id, g]) => {
    const un = unreadOf(g), row = el('button', 'row' + (un ? ' unread' : '')); row.type = 'button';
    const info = el('span', 'info');
    info.append(el('span', 'nm', g.name || 'مجموعة'), el('span', 'sub', (g.members?.length || 0) + ' أعضاء' + (g.owner === uid ? ' · أنت المالك' : '')));
    const side = el('span', 'side'); if (g.lastTs) side.append(el('span', 'when', shortWhen(g.lastTs))); if (un) side.append(el('span', 'newpill', 'جديد'));
    row.append(groupAvatar(id, 'sm'), info, side);
    row.addEventListener('click', () => openGroup(id));
    list.append(row);
  });
}

/* ---------- إضافة جهة اتصال ---------- */
function fillCatSelect(sel, value){
  sel.replaceChildren();
  (me.cats || [DEFAULT_CAT]).forEach(c => { const o = el('option', '', catLabel(c)); o.value = c; sel.append(o); });
  sel.value = value || DEFAULT_CAT;
}
$('addContactBtn').addEventListener('click', () => { fillCatSelect($('addCat')); $('addPin').value = ''; show('s-add'); setTimeout(() => $('addPin').focus(), 50); });
$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pin = $('addPin').value.trim().toUpperCase();
  if (!/^[0-9A-Z]{8}$/.test(pin)) { toast('رمز PIN لازم يكون 8 خانات (أرقام وحروف إنجليزية)'); return; }
  if (pin === me.pin) { toast('هذا رمزك أنت'); return; }
  try {
    const p = await fs.doc('pins/' + pin).get();
    if (!p.exists) { toast('ما لقينا أحد بهذا الرمز'); return; }
    const cid = p.data().uid;
    if (cid === uid || contacts[cid]) { toast('هذا الشخص مضاف عندك'); return; }
    if (isBlocked(cid)) { toast('ألغ الحظر قبل إرسال طلب'); return; }
    const reverse = Object.entries(incomingRequests).find(([, r]) => r.from === cid && r.status === 'pending');
    if (reverse) { show('s-home'); setTab('pending'); toast('لديك طلب وارد من هذا الشخص'); return; }
    const existing = Object.values(outgoingRequests).find(r => r.to === cid && r.status === 'pending');
    if (existing) { toast('الطلب معلّق بالفعل'); return; }
    await fs.doc('contactRequests/' + uid + '_' + cid).set({ from: uid, to: cid, cat: $('addCat').value, status: 'pending', createdAt: Date.now() });
    toast('تم إرسال طلب الإضافة'); show('s-home'); setTab('pending');
  } catch (err) { console.error(err); toast('ما قدرنا نضيفه، جرّب مرة ثانية'); }
});

function askText(title, value){
  return new Promise(resolve => {
    $('modalTitle').textContent = title; $('modalInput').value = value || ''; $('modal').hidden = false;
    setTimeout(() => $('modalInput').focus(), 50);
    const done = v => { $('modal').hidden = true; $('modalForm').onsubmit = null; $('modalCancel').onclick = null; resolve(v); };
    $('modalForm').onsubmit = e => { e.preventDefault(); done($('modalInput').value.trim()); };
    $('modalCancel').onclick = () => done(null);
  });
}
$('addCatBtn').addEventListener('click', async () => {
  const name = await askText('اسم الفئة الجديدة');
  if (!name) return;
  if ((me.cats || []).includes(name)) { toast('الفئة موجودة'); return; }
  try { await fs.doc('users/' + uid).update({ cats: firebase.firestore.FieldValue.arrayUnion(name) }); fillCatSelect($('addCat'), name); }
  catch { toast('ما قدرنا نضيف الفئة'); }
});

/* ---------- ملف التعريف ---------- */
function openProfile(id){ profileId = id; renderProfile(); show('s-profile'); }
$('meHead').addEventListener('click', () => openProfile(uid));

/* رمز PIN الشريطي (Code 39) */
const C39 = {'0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn','A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','*':'nwnnwnwnn'};
function pinBarcode(pin){
  const code = '*' + String(pin || '').toUpperCase().replace(/[^0-9A-F]/g, '') + '*';
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  let x = 0;
  for (const ch of code) {
    [...C39[ch]].forEach((w, i) => {
      const width = w === 'w' ? 3 : 1;
      if (i % 2 === 0) { const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', 0); r.setAttribute('width', width); r.setAttribute('height', 40); r.setAttribute('fill', '#000'); svg.append(r); }
      x += width;
    });
    x += 1;
  }
  svg.setAttribute('viewBox', '0 0 ' + x + ' 40'); svg.setAttribute('preserveAspectRatio', 'none');
  return svg;
}
$('pfBarcodeBtn').addEventListener('click', () => {
  const box = $('pfBarcode'), pin = $('pfPin').textContent.trim();
  if (box.hidden) { box.replaceChildren(pinBarcode(pin), el('div', 'bc-txt', pin)); box.hidden = false; $('pfBarcodeBtn').textContent = 'إخفاء'; }
  else { box.hidden = true; box.replaceChildren(); $('pfBarcodeBtn').textContent = 'إظهار'; }
});

function renderProfile(){
  const id = profileId, d = dataOf(id) || {}, mine = id === uid;
  $('pfTitle').textContent = mine ? 'ملف التعريف الخاص بي' : 'ملف تعريف جهة الاتصال';
  $('pfBarcode').hidden = true; $('pfBarcode').replaceChildren(); $('pfBarcodeBtn').textContent = 'إظهار';
  $('pfAvatar').replaceChildren(avatar(id, 'lg')); $('pfAvatar').title = mine ? 'اضغط لتغيير الصورة' : ''; $('pfName').title = mine ? 'اضغط لتغيير الاسم' : '';
  $('pfPinSmall').textContent = d.pin || '';
  $('pfName').textContent = d.name || '';
  $('pfPin').textContent = d.pin || '';
  $('pfMsg').textContent = d.msg || '';
  $('pfStatus').replaceChildren(statusIcon(id), ' ', statusText(id));
  $('pfFlag').textContent = flagOf(d.country) + ' ' + countryName(d.country);
  $('pfTz').textContent = d.tz ? (d.tz.split('/').pop().replace(/_/g, ' ') + ' (' + tzOffset(d.tz) + ')') : '';
  $('pfTime').textContent = d.tz ? fmtTime(Date.now(), d.tz) : '';
  $('pfActions').hidden = mine; $('meEdit').hidden = !mine; $('s-profile').classList.toggle('is-mine', mine);
  if (mine) {
    if (!document.activeElement?.closest('#meEdit, .mine-only')) {
      $('edMsg').value = me.msg || ''; $('edMute').checked = !!me.mute;
      const sel = $('edCountry'); if (!sel.options.length) COUNTRIES.forEach(([cc, n]) => { const o = el('option', '', (cc ? flagOf(cc) + ' ' : '') + n); o.value = cc; sel.append(o); });
      sel.value = me.country || '';
    }
    $('setAvail').setAttribute('aria-pressed', !me.busy && !me.stText); $('setBusy').setAttribute('aria-pressed', !!me.busy && !me.stText);
    renderCustomStatuses();
    $('photoDel').hidden = !me.photo;
    renderTonePicker(); renderNotifSettings();
    renderAccount();
  } else {
    fillCatSelect($('pfCat'), contacts[id]?.cat);
    const b = isBlocked(id);
    $('pfBlock').textContent = b ? 'إلغاء الحظر' : 'حظر';
    $('pfChat').hidden = b; $('pfPing').hidden = b;
    $('pfBlockedNote').hidden = !b;
  }
}

async function saveMe(fields, change, msg){
  try { await fs.doc('users/' + uid).update(change ? { ...fields, updatedAt: Date.now(), change } : fields); if (msg) toast(msg); }
  catch (e) { console.error(e); toast('ما قدرنا نحفظ، جرّب مرة ثانية'); }
}
// ملف التعريف يتعدل مباشرة: كل خانة تنحفظ لحالها أول ما تخلص منها
// الاسم يتغير بالضغط عليه
$('pfName').addEventListener('click', async () => {
  if (profileId !== uid) return;
  $('modalInput').maxLength = 40;
  const v = await askText('اسم العرض', me.name);
  $('modalInput').maxLength = 30;
  if (v == null) return;
  const name = v.replace(/\s+/g, ' ').trim();
  if (!name) { toast('اسم العرض ما يصير فاضي'); return; }
  if (name !== me.name) saveMe({ name }, 'name', 'تم حفظ الاسم');
});
$('edMsg').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
$('edMsg').addEventListener('change', () => {
  const msg = $('edMsg').value.trim();
  if (msg !== (me.msg || '')) saveMe({ msg }, 'msg', 'تم حفظ الرسالة الشخصية');
});
$('edCountry').addEventListener('change', () => {
  if ($('edCountry').value !== (me.country || '')) saveMe({ country: $('edCountry').value }, 'country', 'تم حفظ الدولة');
});
try { $('typingSound').checked = typingSoundOn(); } catch {}
$('typingSound').addEventListener('change', () => {
  try { localStorage.setItem('marasil-typing-sound', $('typingSound').checked ? 'on' : 'off'); } catch {}
  if ($('typingSound').checked) keyClick();
  toast($('typingSound').checked ? 'صوت الكتابة شغال' : 'تم إيقاف صوت الكتابة');
});
$('edMute').addEventListener('change', () => saveMe({ mute: $('edMute').checked }, null, $('edMute').checked ? 'تم كتم النغمات' : 'النغمات شغالة'));
$('setAvail').addEventListener('click', () => (me.busy || me.stText) && saveMe({ busy: false, stText: '' }, 'status', 'حالتك: متوفر'));
$('setBusy').addEventListener('click', () => (!me.busy || me.stText) && saveMe({ busy: true, stText: '' }, 'status', 'حالتك: مشغول'));

/* الحالات المخصصة */
function renderCustomStatuses(){
  const box = $('customStatusList'); box.replaceChildren();
  (me.statuses || []).forEach((st, i) => {
    const row = el('div', 'stitem');
    const b = el('button', 'btn'); b.type = 'button';
    const ic = el('span', 'st-icon' + (st.busy ? ' busy' : ''));
    b.append(ic, ' ', st.t);
    b.setAttribute('aria-pressed', String(me.stText === st.t && !!me.busy === !!st.busy));
    b.addEventListener('click', () => saveMe({ busy: !!st.busy, stText: st.t }, 'status', 'حالتك: ' + st.t));
    const x = el('button', 'btn x', '✕'); x.type = 'button'; x.title = 'حذف';
    x.addEventListener('click', () => {
      const list = (me.statuses || []).filter((_, j) => j !== i), f = { statuses: list };
      if (me.stText === st.t) { f.stText = ''; }
      saveMe(f, me.stText === st.t ? 'status' : null);
    });
    row.append(b, x); box.append(row);
  });
}
$('stAdd').addEventListener('click', () => {
  const t = $('stNew').value.trim().slice(0, 30), busy = $('stNewType').value === '1';
  if (!t) return;
  const list = (me.statuses || []).filter(s => s.t !== t);
  if (list.length >= 12) { toast('الحد 12 حالة'); return; }
  list.push({ t, busy });
  $('stNew').value = '';
  saveMe({ statuses: list, stText: t, busy }, 'status', 'حالتك: ' + t);
});
$('copyPin').addEventListener('click', async () => { try { await navigator.clipboard.writeText(me.pin); toast('تم نسخ رمز PIN'); } catch { toast('رمزك: ' + me.pin); } });
// تغيير رمز PIN: نحجز الرمز الجديد، نحدّث الملف، ثم نحذف القديم
async function changePin(pin){
  pin = pin.toUpperCase();
  if (!/^[0-9A-Z]{8}$/.test(pin)) { toast('الرمز لازم يكون 8 خانات: أرقام وحروف إنجليزية'); return; }
  if (pin === me.pin) { toast('هذا رمزك الحالي'); return; }
  const old = me.pin;
  try {
    if ((await fs.doc('pins/' + pin).get()).exists) { toast('هذا الرمز مأخوذ، جرّب غيره'); return; }
    await fs.doc('pins/' + pin).set({ uid });
    await fs.doc('users/' + uid).update({ pin });
    fs.doc('pins/' + old).delete().catch(() => {});
    $('newPinInput').value = '';
    toast('رمزك الجديد: ' + pin);
  } catch (e) { console.error(e); toast('ما قدرنا نغيّر الرمز، جرّب مرة ثانية'); }
}
$('setPinBtn').addEventListener('click', () => changePin($('newPinInput').value.trim()));
$('randPinBtn').addEventListener('click', async () => {
  for (let i = 0; i < 5; i++) { const p = newPin(); if (!(await fs.doc('pins/' + p).get()).exists) return changePin(p); }
  toast('جرّب مرة ثانية');
});

$('pfAvatar').addEventListener('click', () => { if (profileId === uid) $('photoInput').click(); else zoomPhoto(profileId); });
// تكبير الصورة الشخصية فقط بدون حفظ: تُعرض كخلفية مع طبقة شفافة فوقها
function zoomPhoto(id){
  const p = photoOf(id); if (!p) return;
  let v = $('photoZoom');
  if (!v) {
    v = el('div', 'photo-zoom'); v.id = 'photoZoom'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'الصورة الشخصية');
    v.append(el('div', 'pz-img'), el('div', 'pz-shield'));
    v.addEventListener('click', () => { v.hidden = true; v.querySelector('.pz-img').style.backgroundImage = ''; });
    document.body.append(v);
  }
  v.querySelector('.pz-img').style.backgroundImage = 'url("' + String(p).replace(/"/g, '%22') + '")';
  v.hidden = false;
}
$('chAvatar').addEventListener('click', e => { if (chatGroup || !chatPeer || !photoOf(chatPeer)) return; e.stopPropagation(); e.preventDefault(); zoomPhoto(chatPeer); });
document.addEventListener('contextmenu', e => { if (e.target.closest?.('.avatar, .photo-zoom')) e.preventDefault(); });
document.addEventListener('dragstart', e => { if (e.target.closest?.('.avatar, .photo-zoom')) e.preventDefault(); });
$('photoDel').addEventListener('click', () => saveMe({ photo: '' }, 'photo', 'تمت إزالة الصورة'));
$('photoInput').addEventListener('change', async e => {
  const file = e.target.files?.[0]; e.target.value = '';
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const S = 160, side = Math.min(img.width, img.height), c = document.createElement('canvas');
    c.width = c.height = S;
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
    URL.revokeObjectURL(url);
    saveMe({ photo: c.toDataURL('image/jpeg', 0.8) }, 'photo', 'تم تغيير صورة العرض');
  } catch { toast('ما قدرنا نقرأ الصورة'); }
});

$('pfChat').addEventListener('click', () => openChat(profileId));
$('pfBlock').addEventListener('click', async () => {
  const id = profileId, b = isBlocked(id);
  if (!b) { const ok = await askText('حظر ' + nameOf(id) + '؟ ما راح يقدر يراسلك أو يضيفك. اكتب "حظر" للتأكيد'); if (ok !== 'حظر') return; }
  setBlocked(id, !b);
});
$('pfReport').addEventListener('click', () => reportUser(profileId));
$('chUnblock').addEventListener('click', () => chatPeer && setBlocked(chatPeer, false));
$('pfPing').addEventListener('click', async () => { await openChat(profileId); sendMsg({ kind: 'ping' }); });
$('pfCat').addEventListener('change', () => fs.doc('users/' + uid + '/contacts/' + profileId).set({ cat: $('pfCat').value }, { merge: true }).then(() => toast('تم النقل')));
$('pfDelete').addEventListener('click', async () => {
  const ok = await askText('اكتب "حذف" لتأكيد حذف ' + nameOf(profileId));
  if (ok !== 'حذف') return;
  await fs.doc('users/' + uid + '/contacts/' + profileId).delete().catch(() => {});
  toast('تم الحذف'); show('s-home');
});

/* ---------- الدردشة ---------- */
async function openChat(peer){
  if (chatPeer === peer && !$('s-chat').hidden) return;
  const id = chatIdWith(peer);
  try { await fs.doc('chats/' + id).set({ members: [uid, peer].sort() }, { merge: true }); }
  catch (e) { console.error(e); toast('ما قدرنا نفتح الدردشة'); return; }
  show('s-chat');
  chatId = id; chatPeer = peer; chatGroup = null; lastChat = { id: peer, group: false }; msgs = []; curChat = null; firstMsgsSnap = true;
  watchUser(peer); renderChatHead();
  $('msgList').replaceChildren(el('div', 'empty', 'جاري التحميل…'));
  unsubChat = fs.doc('chats/' + id).onSnapshot(s => { const k = msgsKey(curChat); curChat = s.data() || {}; if (msgsKey(curChat) !== k) renderMsgsSoon(); renderTyping(); });
  cleanExpiredMessages(id);
  unsubMsgs = fs.collection('chats/' + id + '/messages').where('ts','>',Date.now()-MESSAGE_LIFETIME).orderBy('ts', 'desc').limit(30)
    .onSnapshot({ includeMetadataChanges: true }, s => {
      msgs = s.docs.map(d => ({ id: d.id, pending: d.metadata.hasPendingWrites, ...d.data() })).reverse();
      if (!firstMsgsSnap) {
        const fresh = s.docChanges().filter(c => c.type === 'added' && c.doc.data().from !== uid && !arrivedWhileAway(c.doc.data().ts));
        const nw = fresh.find(c => c.doc.data().kind !== 'ping');
        if (!isBlocked(peer) && nw) { const p = notifPref(nw.doc.data().broadcast ? 'broadcast' : 'friends'); if (!p.mute) { playMsgTone(p.tone); buzz(120); } }
      }
      firstMsgsSnap = false;
      renderMsgsSoon(true);
    });
}
function closeChat(){ chatGroup = null; cancelVoice(); closeOncePhoto(); clearDraftSticker(); toggleFaces(false); unsubMsgs?.(); unsubChat?.(); unsubMsgs = unsubChat = null; chatId = chatPeer = null; }
function renderChatHead(){
  if (chatGroup) {
    const g = curChat || chats[chatGroup] || {}, others = (g.members || []).filter(m => m !== uid);
    $('chAvatar').replaceChildren(groupAvatar(chatGroup, 'sm'));
    $('chName').textContent = g.name || 'مجموعة';
    $('chStatus').className = 'st-icon group';
    $('chMsg').textContent = others.length ? 'أنت، ' + others.slice(0, 4).map(nameOf).join('، ') + (others.length > 4 ? ' و' + (others.length - 4) + ' غيرهم' : '') : 'أنت فقط';
    const out = g.members && !g.members.includes(uid);
    $('composer').hidden = !!out; $('pingBtn').hidden = !!out; $('cameraBtn').hidden = true; updateComposer();
    $('blockedBar').hidden = true;
    return;
  }
  $('cameraBtn').hidden = false;
  if (!chatPeer) return;
  const d = users[chatPeer] || {};
  $('chAvatar').replaceChildren(avatar(chatPeer, 'sm'));
  $('chName').textContent = d.name || 'جهة اتصال';
  $('chStatus').className = 'st-icon' + (d.busy ? ' busy' : isOnline(chatPeer) ? '' : ' off');
  $('chMsg').textContent = d.msg || statusText(chatPeer);
  const b = isBlocked(chatPeer);
  $('composer').hidden = b; $('pingBtn').hidden = b; updateComposer();
  $('blockedBar').hidden = !b;
}
$('chInfo').addEventListener('click', () => chatGroup ? openGroupEditor(chatGroup) : chatPeer && openProfile(chatPeer));

// نجمع طلبات الرسم في إطار واحد، ونعيد رسم الرسائل فقط إذا تغيّر شي يأثر عليها
let msgsRaf = 0, msgsFrom = false;
function renderMsgsSoon(fromMsgs){
  msgsFrom = msgsFrom || !!fromMsgs;
  if (msgsRaf) return;
  msgsRaf = requestAnimationFrame(() => { msgsRaf = 0; const f = msgsFrom; msgsFrom = false; renderMsgs(f); });
}
const msgsKey = c => JSON.stringify([(c || {}).read || {}, (c || {}).members || [], (c || {}).name || '']);
function renderMsgs(fromMsgs){
  if (!chatPeer && !chatGroup) return;
  const list = $('msgList'), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.replaceChildren();
  if (!msgs.length) { list.append(el('div', 'empty', chatGroup ? 'ابدأ الدردشة في «' + ((curChat || {}).name || 'المجموعة') + '».' : 'ابدأ الدردشة مع ' + nameOf(chatPeer) + '.')); return; }
  const readers = chatGroup ? ((curChat || {}).members || []).filter(m => m !== uid) : [chatPeer];
  const peerRead = readers.length ? Math.min(...readers.map(r => (curChat?.read || {})[r] || 0)) : 0;
  let lastDay = '', card = null, cardFrom = null, cardTs = 0;
  msgs.forEach(m => {
    if(m.ts <= Date.now()-MESSAGE_LIFETIME) return;
    const day = fmtDay(m.ts);
    if (day !== lastDay) { list.append(el('div', 'day', day)); lastDay = day; card = null; }
    const mine = m.from === uid;
    if (!card || cardFrom !== m.from || m.ts - cardTs > GROUP_MS) {
      card = el('div', 'bubble' + (mine ? ' mine' : ''));
      const content = el('div', 'content'), head = el('div', 'head');
      head.append(el('span', 'who', nameOf(m.from)), el('span', 'time', fmtTime(m.ts)));
      content.append(head); card.append(content, avatar(m.from, 'xs'));
      list.append(card); cardFrom = m.from;
    }
    cardTs = m.ts;
    const line = el('div', 'line' + (m.broadcast ? ' bc' : ''));
    let mark;
    if (!mine) mark = el('span', 'mark dot');
    else if (m.pending) { mark = el('span', 'mark p'); mark.title = 'جاري الإرسال'; }
    else if (peerRead >= m.ts) { mark = el('span', 'mark r', 'R'); mark.title = 'تمت القراءة'; }
    else { mark = el('span', 'mark d', 'D'); mark.title = 'تم التسليم'; }
    const txt = el('span', 'txt');
    if (m.broadcast) txt.append(el('span', 'bctag', '📢'));
    if(m.kind === 'richtext' && Array.isArray(m.parts)) {
      for(const part of m.parts.slice(0,128)){
        if(typeof part.text==='string') txt.append(document.createTextNode(part.text));
        else if(Number.isInteger(part.sticker)&&part.sticker>=0&&part.sticker<48) txt.append(stickerFace(part.sticker));
      }
    }
    else if (m.kind === 'sticker' && Number.isInteger(m.sticker) && m.sticker >= 0 && m.sticker < 48) {
      txt.classList.add('sticker-message');
      txt.append(stickerFace(m.sticker));
      if (m.text && m.text !== 'ملصق بلاك بيري') txt.append(el('span', 'sticker-caption', m.text));
    }
    else if (m.kind === 'voice') {
      const targetChat=chatId, button=el('button','once-photo','تشغيل الرسالة الصوتية');button.type='button';
      button.onclick=async()=>{button.disabled=true;try{const doc=await fs.doc('chats/'+targetChat+'/voiceClips/'+m.id).get();if(!doc.exists||doc.data().expiresAt.toMillis()<=Date.now()){button.textContent='انتهت صلاحية الصوت';return;}const data=doc.data().audio;if(!/^data:audio\/(mp4|webm|ogg)(;codecs=[^;,]+)?;base64,/.test(data))throw new Error('Invalid audio');const audio=el('audio','chat-audio');audio.controls=true;audio.src=data;button.replaceWith(audio);audio.play().catch(()=>{});}catch(error){button.disabled=false;toast('تعذّر تحميل الصوت');}};txt.append(button);
    }
    else if (m.kind === 'once-photo') {
      const button = el('button', 'once-photo', m.opened ? 'تمت مشاهدة الصورة' : mine ? 'صورة لمرة واحدة' : 'فتح الصورة · مرة واحدة');
      button.type = 'button'; button.disabled = !!m.opened || mine;
      const targetChat = chatId; button.onclick = () => openOncePhoto(targetChat, m.id, button); txt.append(button);
    }
    else if (m.kind === 'ping') { txt.classList.add('ping-text'); txt.textContent = 'PING!!!'; }
    else txt.append(m.text || '');
    line.append(mark, txt);
    card.firstChild.append(line);
  });
  if (atBottom || fromMsgs) list.scrollTop = list.scrollHeight;
  markRead();
}

function markRead(){
  if (!chatId || !msgs.length || document.visibilityState !== 'visible') return;
  const latest = msgs.filter(m => m.from !== uid).pop()?.ts || 0;
  if (!latest || ((curChat?.read || {})[uid] || 0) >= latest) return;
  clearTimeout(readTimer);
  const id = chatId;
  readTimer = setTimeout(() => fs.doc('chats/' + id).update({ ['read.' + uid]: latest }).catch(() => {}), 500);
}

function renderTyping(){
  const typing = curChat?.typing || {};
  if (chatGroup) {
    const who = ((curChat || {}).members || []).filter(m => m !== uid && Date.now() - (typing[m] || 0) < 5000);
    $('typing').textContent = who.length ? who.slice(0, 2).map(nameOf).join('، ') + (who.length > 1 ? ' يكتبون…' : ' يكتب…') : '';
    return;
  }
  const t = typing[chatPeer] || 0, txt = chatPeer && Date.now() - t < 5000 ? nameOf(chatPeer) + ' يكتب…' : '';
  if ($('typing').textContent !== txt) $('typing').textContent = txt;
}
setInterval(() => { if (!document.hidden && chatId) renderTyping(); }, 1500);

async function sendMsg(data, expectedChat = chatId){
  if (!chatId || chatId !== expectedChat || $('composer').hidden) return false;
  const ts = Date.now(), id = chatId;
  const b = fs.batch();
  const message=fs.collection('chats/' + id + '/messages').doc(), expiresAt=firebase.firestore.Timestamp.fromMillis(ts + MESSAGE_LIFETIME);
  const messageData={from:uid,ts,kind:'text',...data,expiresAt};
  if(data.kind==='voice'){delete messageData.audio;b.set(fs.doc('chats/'+id+'/voiceClips/'+message.id),{from:uid,audio:data.audio,expiresAt});}
  b.set(message,messageData);
  b.update(fs.doc('chats/' + id), { lastMsg: data.kind === 'ping' ? 'PING!!!' : data.kind === 'voice' ? 'رسالة صوتية' : data.kind === 'sticker' ? 'فيس بلاك بيري' : (data.text || '').slice(0, 80), lastTs: ts, lastFrom: uid, lastKind: data.kind || 'text', ['read.' + uid]: ts, ['typing.' + uid]: 0 });
  if (data.kind === 'ping') nudgeEffect(); // الإرسال بدون صوت؛ الوكزة تهز جوال المرسل بس
  try { await b.commit(); notifyPush(id); return true; }
  catch (e) { console.error(e); toast('ما وصلت الرسالة، تأكد من الاتصال'); return false; }
}
let draftSticker = null;
let editorRange = null, lastEditorParts = [];
let voiceState = null, voiceDraftUrl = null, voiceBusy = false, photoBusy = false;
const MESSAGE_LIFETIME = 24 * 60 * 60 * 1000;
const cleanedChats = new Set();
let inactiveCleanupRunning = false;
async function cleanupInactiveChats(){
  if(inactiveCleanupRunning || document.hidden) return;
  inactiveCleanupRunning=true;
  try {
    const stale=Object.entries(chats).filter(([id,c])=>c.lastTs && c.lastTs<=Date.now()-MESSAGE_LIFETIME&&!cleanedChats.has(id)).slice(0,10);
    for(const [id] of stale){cleanedChats.add(id);await cleanExpiredMessages(id);}
  } finally {inactiveCleanupRunning=false;}
}
function mediaData(blob){ return new Promise((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(blob); }); }
function closeOncePhoto(){ const image=$('onceImage'); if(image) image.removeAttribute('src'); if($('onceViewer')) $('onceViewer').hidden=true; }
async function openOncePhoto(id, messageId, button){
  if(id!==chatId || $('composer').hidden) return;
  button.disabled=true;
  try {
    const messageRef=fs.doc('chats/'+id+'/messages/'+messageId), photoRef=fs.doc('chats/'+id+'/oncePhotos/'+messageId);
    const data=await fs.runTransaction(async tx=>{
      const message=await tx.get(messageRef), photo=await tx.get(photoRef);
      if(!message.exists || message.data().opened || !photo.exists) return null;
      const payload=photo.data();
      if(payload.to!==uid || payload.expiresAt.toMillis()<=Date.now()) return null;
      tx.delete(photoRef); tx.update(messageRef,{opened:true}); return payload.image;
    });
    if(!data) { button.textContent='الصورة غير متاحة'; return; }
    if(id!==chatId || document.hidden) return;
    $('onceImage').src=data; $('onceViewer').hidden=false;
  } catch(error){ console.error(error); button.disabled=false; toast('تعذّر فتح الصورة، تأكد من الاتصال'); }
}
function cancelVoice(){
  if(voiceState){ voiceState.cancelled=true; clearTimeout(voiceState.timer); if(voiceState.recorder?.state==='recording') voiceState.recorder.stop(); voiceState.stream?.getTracks().forEach(t=>t.stop()); voiceState=null; }
  if(voiceDraftUrl) URL.revokeObjectURL(voiceDraftUrl); voiceDraftUrl=null;
  $('voiceDraft')?.replaceChildren(); if($('voiceDraft')) $('voiceDraft').hidden=true;
  $('voiceSendBtn')?.classList.remove('recording');
}
async function startVoice(){
  if(!chatId || $('composer').hidden || voiceBusy || voiceState) return;
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){ toast('التسجيل الصوتي غير متاح على هذا الجهاز'); return; }
  cancelVoice(); const state={id:chatId,cancelled:false}; voiceState=state;
  try {
    state.stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(state.cancelled || state.id!==chatId){ state.stream.getTracks().forEach(t=>t.stop()); return; }
    const mime=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mime) throw new Error('Unsupported audio format');
    state.recorder=new MediaRecorder(state.stream,{mimeType:mime,audioBitsPerSecond:24000}); const chunks=[];
    state.recorder.ondataavailable=e=>{if(e.data.size) chunks.push(e.data);};
    state.recorder.onerror=()=>{if(voiceState===state){cancelVoice();updateComposer();toast('تعذّر تسجيل الصوت');}};
    state.recorder.onstop=async()=>{
      clearTimeout(state.timer); state.stream.getTracks().forEach(t=>t.stop());
      if(state.cancelled || state.id!==chatId) return;
      voiceState=null; $('voiceSendBtn').classList.remove('recording'); updateComposer();
      const blob=new Blob(chunks,{type:mime});
      if(!blob.size || blob.size>450000){toast('التسجيل طويل جدًا، جرّب مقطعًا أقصر');return;}
      voiceDraftUrl=URL.createObjectURL(blob); const audio=el('audio');audio.controls=true;audio.src=voiceDraftUrl;
      const send=el('button','','إرسال'), discard=el('button','','إلغاء');send.type=discard.type='button';
      send.onclick=async()=>{if(voiceBusy || state.id!==chatId || $('composer').hidden)return;voiceBusy=true;send.disabled=true;try{if(await sendMsg({kind:'voice',audio:await mediaData(blob)},state.id)) cancelVoice();}finally{voiceBusy=false;send.disabled=false;}};
      discard.onclick=()=>{cancelVoice();updateComposer();};$('voiceDraft').replaceChildren(audio,send,discard);$('voiceDraft').hidden=false;
    };
    state.recorder.start(); $('voiceSendBtn').classList.add('recording');$('voiceSendBtn').setAttribute('aria-label','إيقاف التسجيل');
    $('voiceDraft').replaceChildren(el('span','','جاري التسجيل · اضغط المايك للإيقاف · 30 ثانية كحد أقصى'));$('voiceDraft').hidden=false;
    state.timer=setTimeout(()=>{if(state.recorder.state==='recording')state.recorder.stop();},30000);
  } catch(error){if(voiceState===state){cancelVoice();updateComposer();toast('اسمح باستخدام المايك من إعدادات الجهاز لتسجيل الصوت');}}
}
async function sendOncePhoto(file){
  if(photoBusy || !chatId || $('composer').hidden) return;
  if(!file.type.startsWith('image/') || file.size>20000000){toast('اختر صورة بحجم أقل من 20 ميجابايت');return;}
  photoBusy=true; const id=chatId, recipient=chatPeer; let objectUrl;
  try {
    objectUrl=URL.createObjectURL(file);const image=new Image();image.src=objectUrl;await image.decode();
    const scale=Math.min(1,960/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    let payload=canvas.toDataURL('image/jpeg',.65);
    if(payload.length>600000) payload=canvas.toDataURL('image/jpeg',.4);
    if(payload.length>600000) throw new Error('Photo too large');
    if(id!==chatId || $('composer').hidden) return;
    const ts=Date.now(),expiresAt=firebase.firestore.Timestamp.fromMillis(ts+MESSAGE_LIFETIME);
    const message=fs.collection('chats/'+id+'/messages').doc(),batch=fs.batch();
    batch.set(message,{from:uid,ts,kind:'once-photo',opened:false,expiresAt});
    batch.set(fs.doc('chats/'+id+'/oncePhotos/'+message.id),{from:uid,to:recipient,image:payload,expiresAt});
    batch.update(fs.doc('chats/'+id),{lastMsg:'صورة لمرة واحدة',lastTs:ts,lastFrom:uid,lastKind:'once-photo',['read.'+uid]:ts});
    await batch.commit(); notifyPush(id);
  } catch(error){console.error(error);toast('تعذّر إرسال الصورة، تأكد من الاتصال والصلاحيات');}
  finally {if(objectUrl)URL.revokeObjectURL(objectUrl);photoBusy=false;}
}
async function cleanExpiredMessages(id){
  try {
    const expired=await fs.collection('chats/'+id+'/messages').where('ts','<=',Date.now()-MESSAGE_LIFETIME).limit(100).get();
    if(expired.empty)return;
    const batch=fs.batch();expired.docs.forEach(d=>{batch.delete(d.ref);if(d.data().kind==='once-photo')batch.delete(fs.doc('chats/'+id+'/oncePhotos/'+d.id));if(d.data().kind==='voice')batch.delete(fs.doc('chats/'+id+'/voiceClips/'+d.id));});await batch.commit();
  } catch(error){console.warn('Message cleanup unavailable',error.code);}
}
$('voiceSendBtn').onclick=()=>{if(voiceState?.recorder?.state==='recording')voiceState.recorder.stop();else if($('voiceSendBtn').dataset.mode==='send')sendText();else startVoice();};
$('cameraBtn').onclick=()=>{if(chatId&&!$('composer').hidden)$('chatCameraInput').click();};
$('chatCameraInput').onchange=()=>{const file=$('chatCameraInput').files[0];$('chatCameraInput').value='';if(file)sendOncePhoto(file);};
$('closeOnceViewer').onclick=closeOncePhoto;
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelVoice();closeOncePhoto();updateComposer();}});
setInterval(()=>{if(!document.hidden){if(chatId)renderMsgsSoon();renderChats();}},60000);
function editorParts(){
  const parts=[];
  const text=value=>{value=value.replace(/\u200b/g,'');if(!value)return;const last=parts[parts.length-1];if(last&&typeof last.text==='string')last.text+=value;else parts.push({text:value});};
  const walk=node=>{
    if(node.nodeType===Node.TEXT_NODE){text(node.nodeValue);return;}
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    if(node.hasAttribute('data-sticker')){const index=Number(node.dataset.sticker);if(Number.isInteger(index)&&index>=0&&index<48)parts.push({sticker:index});return;}
    if(node.tagName==='BR'){text('\n');return;}
    if((node.tagName==='DIV'||node.tagName==='P')&&parts.length)text('\n');
    node.childNodes.forEach(walk);
  };
  $('msgInput').childNodes.forEach(walk);return parts;
}
function partsText(parts){return parts.map(p=>typeof p.text==='string'?p.text:'☺').join('');}
function restoreEditor(parts){
  const input=$('msgInput');input.replaceChildren();
  parts.forEach(p=>{if(typeof p.text==='string')input.append(document.createTextNode(p.text));else{const face=stickerFace(p.sticker);face.dataset.sticker=p.sticker;face.contentEditable='false';input.append(face,document.createTextNode('\u200b'));}});
  editorRange=null;
}
function rememberEditorRange(){
  const selection=window.getSelection();if(!selection?.rangeCount)return;
  const range=selection.getRangeAt(0), input=$('msgInput');
  if(input.contains(range.startContainer)&&input.contains(range.endContainer))editorRange=range.cloneRange();
}
function insertEditorNode(node){
  const input=$('msgInput'); input.focus({preventScroll:true});
  let range=editorRange;
  if(!range || !input.contains(range.startContainer)||!input.contains(range.endContainer)){range=document.createRange();range.selectNodeContents(input);range.collapse(false);}
  range.deleteContents();range.insertNode(node);
  const tail=document.createTextNode('\u200b');node.after(tail);range.setStart(tail,1);range.collapse(true);
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);editorRange=range.cloneRange();
  input.dispatchEvent(new Event('input',{bubbles:true}));
}
function clearDraftSticker(){ draftSticker=null; $('msgInput').replaceChildren();editorRange=null;lastEditorParts=[];updateComposer(); }
function selectSticker(index){
  if ($('composer').hidden) return;
  if(partsText(editorParts()).length>=2000||editorParts().length>=127)return;
  const face=stickerFace(index);face.dataset.sticker=index;face.contentEditable='false';insertEditorNode(face);toggleFaces(false);
}
function updateComposer(){
  if ($('composer').hidden) { toggleFaces(false); if ($('msgInput').childNodes.length) clearDraftSticker(); cancelVoice(); }
  const button = $('voiceSendBtn'); if (!button) return;
  const sending = !!partsText(editorParts()).trim();
  button.setAttribute('aria-label', sending ? 'إرسال' : 'تسجيل صوتي');
  button.dataset.mode = sending ? 'send' : 'voice';
  if (!button.classList.contains('recording')) button.innerHTML = sending ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 3 17 9-17 9 3-9zM7 12h14"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v2a6 6 0 0 0 12 0v-2M12 19v3"/></svg>';
}
function sendText(){
  const input = $('msgInput');
  const parts=editorParts(),text=partsText(parts).trim();if(!text||$('composer').hidden)return;
  if(text.length>2000||parts.length>128){toast('الرسالة طويلة جدًا');return;}
  const data=parts.some(p=>Number.isInteger(p.sticker))?{kind:'richtext',text,parts}:{kind:'text',text};
  clearDraftSticker(); updateComposer(); sendMsg(data);
  input.focus({ preventScroll: true });
}
$('composer').addEventListener('submit', e => { e.preventDefault(); sendText(); });
// الوجوه: زر الوجه مكان زر الإرسال، والإرسال من زر "إرسال" في الكيبورد
const FACES = ['🙂','😃','😁','😂','😉','😊','😍','😘','😜','😛','😎','😇','😏','😮','😳','😢','😭','😡','😤','😴','🤔','🙄','😬','🤐','🤗','🤭','😷','🤒','👍','👎','👏','🙏','💪','👌','✌️','👋','❤️','💔','💜','💙','🌹','⭐','🔥','🎉','🎂','☕','🍀','🌙'];
function stickerFace(index){
  const face = el('span', 'bb-sticker');
  if (![4,9,19,23,28,29,33,34,38,40,46].includes(index)) face.classList.add('round-sticker');
  face.setAttribute('role', 'img'); face.setAttribute('aria-label', 'ملصق بلاك بيري ' + (index + 1));
  face.style.setProperty('--sticker-x', String(index % 6));
  face.style.setProperty('--sticker-y', String(Math.floor(index / 6)));
  return face;
}
function toggleFaces(open){
  const p = $('facePanel'); if (!p) return;
  if (open == null) open = p.hidden;
  if (open && !p.childElementCount) {
    for (let index = 0; index < 48; index++) {
      const b = el('button', 'face sticker-button'); b.type = 'button';
      b.setAttribute('aria-label', 'إرسال ملصق بلاك بيري ' + (index + 1));
      b.append(stickerFace(index));
      b.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') e.preventDefault(); });
      b.addEventListener('click', () => selectSticker(index));
      p.append(b);
    }
    FACES.forEach(f => {
    const b = el('button', 'face', f); b.type = 'button'; b.setAttribute('aria-label', f);
    b.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') e.preventDefault(); });
    b.addEventListener('click', () => insertFace(f));
    p.append(b);
  });
  }
  p.hidden = !open; $('faceBtn').setAttribute('aria-expanded', String(open));
  scheduleViewport?.();
}
function insertFace(f){
  if(partsText(editorParts()).length+f.length>2000)return;insertEditorNode(document.createTextNode(f));toggleFaces(false);
}
document.addEventListener('selectionchange',rememberEditorRange);
$('msgInput').addEventListener('input', keyClick);
$('msgInput').addEventListener('beforeinput',e=>{
  if(e.inputType!=='deleteContentBackward')return;
  const selection=window.getSelection();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);if(!range.collapsed)return;
  const node=range.startContainer;let chip=null;
  if(node.nodeType===Node.TEXT_NODE&&!node.nodeValue.slice(0,range.startOffset).replace(/\u200b/g,''))chip=node.previousSibling;
  else if(node===$('msgInput'))chip=node.childNodes[range.startOffset-1];
  if(chip?.nodeType===Node.ELEMENT_NODE&&chip.hasAttribute('data-sticker')){e.preventDefault();range.setStartBefore(chip);range.collapse(true);chip.remove();selection.removeAllRanges();selection.addRange(range);editorRange=range.cloneRange();$('msgInput').dispatchEvent(new Event('input',{bubbles:true}));}
});
$('msgInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendText();}});
$('msgInput').addEventListener('paste',e=>{e.preventDefault();const text=e.clipboardData?.getData('text/plain')||'';if(partsText(editorParts()).length+text.length<=2000)insertEditorNode(document.createTextNode(text));});
$('msgInput').addEventListener('drop',e=>e.preventDefault());
$('faceBtn').addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') e.preventDefault(); });
$('faceBtn').addEventListener('click', () => toggleFaces());
$('msgInput').addEventListener('input', () => {
  const parts=editorParts();if(partsText(parts).length>2000||parts.length>128)restoreEditor(lastEditorParts);else {lastEditorParts=parts;if(!parts.length){$('msgInput').replaceChildren();editorRange=null;}}
  updateComposer();
  if (!chatId || Date.now() - typingSent < 3000) return;
  typingSent = Date.now();
  fs.doc('chats/' + chatId).update({ ['typing.' + uid]: typingSent }).catch(() => {});
});
let lastPing = 0;
$('pingBtn').addEventListener('click', () => {
  if (Date.now() - lastPing < 5000) { toast('استنى شوي قبل الوكزة الثانية'); return; }
  lastPing = Date.now(); sendMsg({ kind: 'ping' });
});

// الوجوه التعبيرية
updateComposer();

/* ---------- رسالة جماعية (Broadcast) ---------- */
let bcSel = {};
function bcTargets(){ return Object.keys(contacts).filter(id => !gone[id] && !isBlocked(id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ar')); }
function renderBroadcast(){
  const list = $('bcList'), ids = bcTargets(); list.replaceChildren();
  Object.keys(bcSel).forEach(id => { if (!ids.includes(id)) delete bcSel[id]; });
  if (!ids.length) list.append(el('div', 'empty', 'ما عندك أصدقاء تراسلهم. أضف أحد برمز PIN أول.'));
  ids.forEach(id => {
    const row = el('label', 'bc-row'), cb = el('input');
    cb.type = 'checkbox'; cb.checked = !!bcSel[id];
    cb.addEventListener('change', () => { if (cb.checked) bcSel[id] = true; else delete bcSel[id]; bcCount(); });
    row.append(cb, avatar(id, 'xs'), el('span', 'nm', nameOf(id)));
    list.append(row);
  });
  bcCount();
}
function bcCount(){
  const n = Object.keys(bcSel).length, all = bcTargets().length;
  $('bcCount').textContent = '(' + n + ')';
  $('bcAll').textContent = n && n === all ? 'إلغاء التحديد' : 'تحديد الكل';
}
$('broadcastBtn').addEventListener('click', () => { $('bcTitle').textContent = labelOf('broadcast'); bcSel = {}; $('bcText').value = ''; renderBroadcast(); show('s-broadcast'); });
$('bcAll').addEventListener('click', () => {
  const ids = bcTargets(), allOn = ids.length && ids.every(id => bcSel[id]);
  bcSel = {}; if (!allOn) ids.forEach(id => bcSel[id] = true);
  renderBroadcast();
});
let bcBusy = false;
$('bcForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (bcBusy) return;
  const text = $('bcText').value.trim(), ids = Object.keys(bcSel);
  if (!text) { toast('اكتب الرسالة أول'); return; }
  if (!ids.length) { toast('اختر صديق واحد على الأقل'); return; }
  bcBusy = true; $('bcSend').disabled = true; $('bcSend').textContent = 'جاري الإرسال…';
  let ok = 0;
  for (const peer of ids) {
    const id = chatIdWith(peer), ts = Date.now();
    try {
      await fs.doc('chats/' + id).set({ members: [uid, peer].sort() }, { merge: true });
      const b = fs.batch();
      b.set(fs.collection('chats/' + id + '/messages').doc(), { from: uid, ts, kind: 'text', text, broadcast: true, expiresAt: firebase.firestore.Timestamp.fromMillis(ts + MESSAGE_LIFETIME) });
      b.update(fs.doc('chats/' + id), { lastMsg: text.slice(0, 80), lastTs: ts, lastFrom: uid, lastKind: 'broadcast', ['read.' + uid]: ts });
      await b.commit(); ok++; notifyPush(id);
    } catch (err) { console.error(err); }
  }
  bcBusy = false; $('bcSend').disabled = false; $('bcSend').textContent = '📢 إرسال';
  if (ok === ids.length) { toast('وصل البرودكاست لـ ' + ok + ' ✅'); show('s-home'); }
  else toast('وصلت لـ ' + ok + ' من ' + ids.length + '، الباقي ما وصل');
});

$('accIdCopy').addEventListener('click', async () => { const t = $('accId').textContent; try { await navigator.clipboard.writeText(t); toast('تم نسخ معرّف الحساب'); } catch { toast(t); } });

async function createMe(name, pin){
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  await fs.doc('users/' + uid).set({ name, pin, msg: '', busy: false, photo: '', country: tz === 'Asia/Riyadh' ? 'SA' : '', tz, cats: [DEFAULT_CAT], mute: false, lastSeen: Date.now(), updatedAt: Date.now(), change: 'join' });
}

/* ---------- طلبات الانضمام: المستخدم يطلب، والمالك يوافق ويحدد رمز PIN ---------- */
let myJoinUnsub = null, creatingMe = false;
function setupState(form, text, retry){
  $('setupForm').hidden = !form; $('setupWait').hidden = form;
  $('setupWaitText').textContent = text || ''; $('setupRetry').hidden = !retry;
}
function watchMyJoin(){
  if (myJoinUnsub || isOwner(uid) || !auth.currentUser?.isAnonymous) { setupState(true); return; }
  myJoinUnsub = fs.doc('joinRequests/' + uid).onSnapshot(async s => {
    const r = s.exists ? s.data() : null;
    if (!r) { setupState(true); return; }
    if (r.status === 'pending') { setupState(false, '⏳ طلبك وصل للمالك باسم «' + (r.name || '') + '». أول ما يوافق بيوصلك رمز PIN وتدخل التطبيق تلقائياً.'); return; }
    if (r.status === 'rejected') { setupState(false, 'للأسف انرفض طلب الانضمام.', true); return; }
    if (r.status === 'approved' && r.pin && !me && !creatingMe) {
      creatingMe = true; setupState(false, '✅ تمت الموافقة! رمزك: ' + r.pin + ' … جاري تجهيز حسابك');
      try { await createMe(r.name || 'مستخدم', r.pin); myJoinUnsub?.(); myJoinUnsub = null; }
      catch (e) { console.error(e); creatingMe = false; setupState(false, 'صار خطأ أثناء تجهيز الحساب، افتح التطبيق مرة ثانية.'); }
    }
  }, e => { console.error(e); setupState(true); });
}
$('setupRetry').addEventListener('click', async () => {
  try { await fs.doc('joinRequests/' + uid).delete(); } catch (e) { console.error(e); toast('ما قدرنا نرسل طلب جديد'); }
});

let joinReqs = {}, joinDraft = {}, joinSeen = null;
function watchJoinRequests(){
  fs.collection('joinRequests').where('status', '==', 'pending').onSnapshot(s => {
    joinReqs = {}; s.docs.forEach(d => joinReqs[d.id] = d.data());
    const ids = Object.keys(joinReqs);
    if (joinSeen && ids.some(id => !joinSeen.has(id))) { toast('👑 طلب انضمام جديد'); play('incoming'); }
    joinSeen = new Set(ids);
    $('joinReqBtn').hidden = !ids.length; $('joinReqCount').textContent = '(' + ids.length + ')';
    renderJoinRequests();
  }, e => console.error(e));
}
function renderJoinRequests(){
  const box = $('joinReqList'); $('joinReqCard').hidden = !isOwner(uid);
  if (box.contains(document.activeElement)) return;   // لا نمسح الرمز وأنت تكتبه
  box.replaceChildren();
  const ids = Object.keys(joinReqs).sort((a, b) => (joinReqs[a].at || 0) - (joinReqs[b].at || 0));
  if (!ids.length) { box.append(el('div', 'hint', 'ما فيه طلبات جديدة.')); return; }
  ids.forEach(id => {
    const r = joinReqs[id], row = el('div', 'join-row');
    const info = el('div', 'join-info'); info.append(el('b', '', r.name || 'بدون اسم'), el('span', 'hint', ' · ' + ago(r.at || Date.now())));
    const inp = el('input', 'pininput'); inp.maxLength = 8; inp.autocomplete = 'off'; inp.setAttribute('autocapitalize', 'characters');
    inp.value = joinDraft[id] || ''; inp.placeholder = 'اكتب 8 خانات، مثل 2A2A2A2A';
    inp.addEventListener('input', () => { joinDraft[id] = inp.value.toUpperCase(); });
    const ok = el('button', 'btn primary sm', 'قبول'), no = el('button', 'btn danger sm', 'رفض'); ok.type = no.type = 'button';
    ok.addEventListener('click', () => approveJoin(id, inp.value, ok));
    no.addEventListener('click', () => rejectJoin(id));
    const line = el('div', 'line'); line.append(inp, ok, no);
    row.append(info, line); box.append(row);
  });
}
async function approveJoin(id, pin, btn){
  pin = String(pin || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{8}$/.test(pin)) { toast('الرمز لازم يكون 8 خانات: أرقام وحروف إنجليزية'); return; }
  btn.disabled = true;
  try {
    if ((await fs.doc('pins/' + pin).get()).exists) { toast('هذا الرمز مأخوذ، اختر غيره'); btn.disabled = false; return; }
    const b = fs.batch();
    b.set(fs.doc('pins/' + pin), { uid: id });
    b.update(fs.doc('joinRequests/' + id), { status: 'approved', pin, decidedAt: Date.now() });
    await b.commit();
    delete joinDraft[id];
    toast('✅ تمت الموافقة، رمزه: ' + pin);
  } catch (e) { console.error(e); toast('ما قدرنا نوافق، تأكد من قواعد Firebase'); btn.disabled = false; }
}
async function rejectJoin(id){
  const ok = await askText('اكتب "رفض" لتأكيد رفض طلب ' + (joinReqs[id]?.name || ''));
  if (ok !== 'رفض') return;
  try { await fs.doc('joinRequests/' + id).update({ status: 'rejected', decidedAt: Date.now() }); toast('تم رفض الطلب'); }
  catch (e) { console.error(e); toast('ما قدرنا نرفض الطلب'); }
}
$('joinReqBtn').addEventListener('click', () => { openProfile(uid); setTimeout(() => $('joinReqCard').scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); });

/* ---------- المجموعات ---------- */
function groupAvatar(id, size = ''){
  const a = el('div', 'avatar group-av' + (size ? ' ' + size : '')); a.style.background = COLORS[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % COLORS.length];
  a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="3.2" fill="#fff"/><circle cx="16.5" cy="9.5" r="2.7" fill="#fff" opacity=".85"/><path d="M2.5 19c.6-3.3 2.9-5 5.5-5s4.9 1.7 5.5 5z" fill="#fff"/><path d="M13.6 14.6c.9-.5 1.9-.8 2.9-.8 2.3 0 4.3 1.5 4.9 4.6h-6.2" fill="#fff" opacity=".85"/></svg>';
  return a;
}
async function openGroup(gid){
  if (chatId === gid && !$('s-chat').hidden) return;
  show('s-chat');
  chatId = gid; chatPeer = null; chatGroup = gid; lastChat = { id: gid, group: true }; msgs = []; curChat = chats[gid] || {}; firstMsgsSnap = true;
  (curChat.members || []).forEach(m => m !== uid && watchUser(m));
  renderChatHead();
  $('msgList').replaceChildren(el('div', 'empty', 'جاري التحميل…'));
  unsubChat = fs.doc('chats/' + gid).onSnapshot(s => {
    if (!s.exists) { toast('المجموعة انحذفت'); lastChat = null; show('s-home'); return; }
    const k = msgsKey(curChat); curChat = s.data() || {};
    if (!(curChat.members || []).includes(uid)) { toast('ما عدت عضو في هذي المجموعة'); lastChat = null; show('s-home'); return; }
    (curChat.members || []).forEach(m => m !== uid && watchUser(m));
    if (msgsKey(curChat) !== k) { renderChatHead(); renderMsgsSoon(); }
    renderTyping();
  }, () => { toast('ما قدرنا نفتح المجموعة'); lastChat = null; show('s-home'); });
  cleanExpiredMessages(gid);
  unsubMsgs = fs.collection('chats/' + gid + '/messages').where('ts','>',Date.now()-MESSAGE_LIFETIME).orderBy('ts', 'desc').limit(30)
    .onSnapshot({ includeMetadataChanges: true }, s => {
      msgs = s.docs.map(d => ({ id: d.id, pending: d.metadata.hasPendingWrites, ...d.data() })).reverse();
      if (!firstMsgsSnap) {
        const fresh = s.docChanges().filter(c => c.type === 'added' && c.doc.data().from !== uid && !isBlocked(c.doc.data().from) && !arrivedWhileAway(c.doc.data().ts));
        if (fresh.some(c => c.doc.data().kind !== 'ping')) { const p = notifPref('groups'); if (!p.mute) { playMsgTone(p.tone); buzz(120); } }
      }
      firstMsgsSnap = false;
      renderMsgsSoon(true);
    }, e => console.error(e));
}

let grEdit = null, grSel = {}, grBusy = false;
function openGroupEditor(gid){
  grEdit = gid || null;
  const g = gid ? (chatGroup === gid && curChat ? curChat : chats[gid]) : null, owner = !g || g.owner === uid;
  $('grTitle').textContent = !g ? 'مجموعة جديدة' : owner ? 'إدارة المجموعة' : 'معلومات المجموعة';
  $('grName').value = g?.name || ''; $('grName').disabled = !owner;
  grSel = {}; (g?.members || []).forEach(m => { if (m !== uid) grSel[m] = true; });
  $('grSave').hidden = !owner; $('grSave').textContent = g ? 'حفظ التعديلات' : 'إنشاء المجموعة';
  $('grLeave').hidden = !g || owner; $('grDelete').hidden = !g || !owner;
  renderGroupMembers(); show('s-group');
}
function renderGroupMembers(){
  const g = grEdit ? chats[grEdit] : null, owner = !g || g.owner === uid, list = $('grList'); list.replaceChildren();
  const ids = [...new Set([...Object.keys(contacts).filter(id => !gone[id] && !isBlocked(id)), ...(g?.members || []).filter(m => m !== uid)])]
    .filter(id => owner || (g?.members || []).includes(id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ar'));
  const me1 = el('div', 'bc-row'); me1.append(avatar(uid, 'xs'), el('span', 'nm', 'أنت' + ((!g || g.owner === uid) ? ' (المالك)' : '')));
  list.append(me1);
  if (!ids.length) list.append(el('div', 'empty', 'أضف أصدقاء أول عشان تقدر تضيفهم للمجموعة.'));
  ids.forEach(id => {
    const row = el(owner ? 'label' : 'div', 'bc-row');
    if (owner) { const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!grSel[id]; cb.addEventListener('change', () => { if (cb.checked) grSel[id] = true; else delete grSel[id]; grCount(); }); row.append(cb); }
    row.append(avatar(id, 'xs'), el('span', 'nm', nameOf(id) + (g?.owner === id ? ' (المالك)' : '')));
    list.append(row);
  });
  grCount();
}
function grCount(){ $('grCount').textContent = '(' + (Object.keys(grSel).length + 1) + ')'; }
$('grSave').addEventListener('click', async () => {
  if (grBusy) return;
  const name = $('grName').value.replace(/\s+/g, ' ').trim(), sel = Object.keys(grSel);
  if (!name) { toast('اكتب اسم المجموعة'); return; }
  if (!sel.length) { toast('اختر صديق واحد على الأقل'); return; }
  if (sel.length > 49) { toast('الحد 50 عضو'); return; }
  grBusy = true; $('grSave').disabled = true;
  try {
    const now = Date.now();
    if (!grEdit) {
      const ref = fs.collection('chats').doc();
      await ref.set({ isGroup: true, name, owner: uid, members: [uid, ...sel], createdAt: now, lastTs: now, lastMsg: 'أُنشئت المجموعة', lastFrom: uid, lastKind: 'system', read: { [uid]: now } });
      toast('تم إنشاء المجموعة ✅'); show('s-home', false); openGroup(ref.id);
    } else {
      await fs.doc('chats/' + grEdit).update({ name, members: [uid, ...sel] });
      toast('تم حفظ المجموعة'); back();
    }
  } catch (e) { console.error(e); toast('ما قدرنا نحفظ المجموعة، تأكد من الاتصال'); }
  grBusy = false; $('grSave').disabled = false;
});
$('grLeave').addEventListener('click', async () => {
  const ok = await askText('اكتب "مغادرة" لتأكيد الخروج من المجموعة'); if (ok !== 'مغادرة') return;
  try { await fs.doc('chats/' + grEdit).update({ members: firebase.firestore.FieldValue.arrayRemove(uid) }); lastChat = null; toast('طلعت من المجموعة'); show('s-home'); }
  catch (e) { console.error(e); toast('ما قدرنا نطلعك من المجموعة'); }
});
$('grDelete').addEventListener('click', async () => {
  const ok = await askText('اكتب "حذف" لتأكيد حذف المجموعة لكل الأعضاء'); if (ok !== 'حذف') return;
  try { const id = grEdit; lastChat = null; await fs.doc('chats/' + id).delete(); toast('انحذفت المجموعة'); show('s-home'); }
  catch (e) { console.error(e); toast('ما قدرنا نحذف المجموعة'); }
});

boot();

