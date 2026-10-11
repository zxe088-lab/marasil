/* BPB OLD — تطبيق محادثة على طريقة الماسنجر الكلاسيكي، يعمل على Firebase (الخطة المجانية) */
'use strict';

const $ = id => document.getElementById(id);
// One layout owner: follow the visible viewport, including Safari's focus pan.
// Capacitor resizes the native WebView; never subtract keyboardHeight again.
let viewportFrame = 0, nativeKeyboardOpen = false;
function syncViewport(){
  const viewport = window.visualViewport;
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
  const root = document.documentElement;
  const height = viewport?.height ?? window.innerHeight;
  const top = Math.max(0, viewport?.offsetTop ?? 0);
  if (height <= 0) return; // Ignore transient measurements during rotation.
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
window.addEventListener('keyboardWillShow', () => { nativeKeyboardOpen = true; scheduleViewport(); });
window.addEventListener('keyboardDidShow', scheduleViewport);
window.addEventListener('keyboardWillHide', scheduleViewport);
window.addEventListener('keyboardDidHide', () => { nativeKeyboardOpen = false; scheduleViewport(); });
syncViewport();
const COLORS = ['#c0392b','#2e86c1','#239b56','#b9770e','#7d3c98','#148f77','#a04000','#2c3e8f'];
const COUNTRIES = [
  ['SA','السعودية'],['KW','الكويت'],['AE','الإمارات'],['QA','قطر'],['BH','البحرين'],['OM','عُمان'],
  ['YE','اليمن'],['IQ','العراق'],['JO','الأردن'],['EG','مصر'],['SY','سوريا'],['LB','لبنان'],
  ['PS','فلسطين'],['SD','السودان'],['LY','ليبيا'],['TN','تونس'],['DZ','الجزائر'],['MA','المغرب'],['','أخرى']
];
const DEFAULT_CAT = 'جهات الاتصال';
const OWNER_UID = '7KzlcizFv8TrIeqRVqi6BjNoCue2';   // صاحب التطبيق: الوحيد اللي يقدر يغيّر رمز PIN
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
let chatId = null, chatPeer = null, unsubMsgs = null, unsubChat = null, curChat = null, msgs = [];
let firstChatsSnap = true, firstMsgsSnap = true, typingSent = 0, readTimer = null, seenUpdates = 0;

try { closedCats = JSON.parse(localStorage.getItem('marasil-closed') || '{}'); seenUpdates = +localStorage.getItem('marasil-seen') || 0; } catch {}
const saveLocal = () => { try { localStorage.setItem('marasil-closed', JSON.stringify(closedCats)); localStorage.setItem('marasil-seen', seenUpdates); } catch {} };

/* ---------- أدوات ---------- */
function toast(t){ const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(e._t); e._t = setTimeout(() => e.hidden = true, 2800); }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const newPin = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
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
document.addEventListener('pointerdown', audio, { once: true });
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
const SOUNDS = {
  incoming: () => tone([[1046.5, .12, 'triangle'], [1318.5, .12, 'triangle'], [1568, .22, 'triangle']]),
  sent:     () => tone([[880, .07, 'sine', .08], [1174.7, .1, 'sine', .08]]),
  ping:     () => tone([[1760, .08, 'square', .1], [0, .05], [1760, .08, 'square', .1], [0, .05], [1760, .08, 'square', .1], [0, .12], [2093, .25, 'square', .1]]),
  contact:  () => tone([[659.3, .15, 'sine'], [987.8, .3, 'sine']]),
};
/* نغمات خاصة: 1) ملف يختاره الشخص من جواله (محفوظ في جهازه)  2) ملف في مجلد sounds على السيرفر  3) النغمة الافتراضية */
const TONE_NAMES = { incoming: 'رسالة واردة', ping: 'الوكزة PING', sent: 'إرسال رسالة', contact: 'تحديثات الأصحاب' };
// تشغيل ملفات النغمات عبر عنصر audio، مع احترام قيود التشغيل في النظام.
const toneEls = {};      // name -> Audio
const toneOrigin = {};   // 'device' | 'site'
async function loadTone(name){
  delete toneEls[name]; delete toneOrigin[name];
  let src = null;
  try { src = localStorage.getItem('marasil-tone-' + name); } catch {}
  if (src) toneOrigin[name] = 'device';
  else if (name === 'incoming' || name === 'ping') {
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
const play = name => { if (me?.mute) return; if (playFile(name)) return; SOUNDS[name]?.(); };
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
    const refresh = () => { st.textContent = toneOrigin[name] === 'device' ? 'نغمة من جهازك' : toneOrigin[name] === 'site' ? 'نغمة التطبيق' : 'افتراضية'; };
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
const buzz = pattern => {
  try {
    if (Haptics) {
      const ms = Array.isArray(pattern) ? pattern.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) : pattern;
      Haptics.vibrate({ duration: Math.min(ms, 1500) });
      return;
    }
    navigator.vibrate?.(pattern);
  } catch {}
};
function shake(){ const a = $('app'); a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake'); }
function nudgeEffect(){
  play('ping'); buzz([400, 100, 400, 100, 400, 100, 800]); shake(); setTimeout(shake, 600);
  try { Haptics?.notification({ type: 'WARNING' }); } catch {}
}

/* ---------- التنقل ---------- */
const SCREENS = ['s-loading','s-error','s-login','s-setup','s-home','s-add','s-menu','s-broadcast','s-profile','s-chat'];
function show(id, push = true){
  const cur = SCREENS.find(s => !$(s).hidden);
  if (push && cur && cur !== id && !['s-loading','s-error','s-login','s-setup'].includes(cur)) stack.push(cur);
  SCREENS.forEach(s => $(s).hidden = s !== id);
  if (id !== 's-chat') closeChat();
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
document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
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
  auth.onAuthStateChanged(u => { if (u) start(u.uid); else if (IS_NATIVE) anonSignIn(); else show('s-login', false); });
  if (!IS_NATIVE) auth.getRedirectResult?.().then(r => { if (r?.operationType === 'link') toast('تم ربط حسابك بقوقل ✅'); }).catch(authError);
}

/* ---------- تسجيل الدخول بقوقل ---------- */
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
async function googleSignIn(){
  try { await auth.signInWithPopup(gProvider()); }
  catch (e) { if (popupIssue(e)) return auth.signInWithRedirect(gProvider()).catch(authError); authError(e); }
}
async function anonSignIn(){
  try { await auth.signInAnonymously(); }
  catch (e) { $('errText').textContent = 'ما قدرنا نسجل الدخول. تأكد أنك فعّلت الدخول المجهول (Anonymous) في Firebase.'; show('s-error'); console.error(e); }
}
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
async function signOutNow(){
  const u = auth.currentUser;
  if (u?.isAnonymous) {
    const ok = await askText('حسابك مو مربوط بقوقل، لو طلعت بيضيع نهائياً. اكتب "خروج" للتأكيد');
    if (ok !== 'خروج') return;
  }
  await auth.signOut(); location.reload();
}
function renderAccount(){
  const u = auth?.currentUser; if (!u) return;
  if (IS_NATIVE) {
    $('accState').textContent = 'حسابك محفوظ في هذا الجهاز. إذا حذفت التطبيق بيضيع الحساب.';
    $('linkGoogleBtn').hidden = true; $('signOutBtn').hidden = true;
    return;
  }
  const g = (u.providerData || []).find(p => p.providerId === 'google.com');
  $('accState').textContent = g ? 'مربوط بقوقل: ' + (g.email || u.email || '') : 'حسابك مو مربوط. لو مسحت بيانات المتصفح أو غيّرت جوالك بيضيع حسابك.';
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
$('googleLoginBtn').addEventListener('click', googleSignIn);
$('anonLoginBtn').addEventListener('click', anonSignIn);
$('linkGoogleBtn').addEventListener('click', linkGoogle);
$('signOutBtn').addEventListener('click', signOutNow);

function start(id){
  if (uid) return; uid = id;
  fs.doc('users/' + uid).onSnapshot(s => {
    const had = !!me; me = s.exists ? s.data() : null;
    if (!me) { show('s-setup', false); return; }
    if (!had) {
      show('s-home', false); listen(); heartbeat();
      // ميزة تغيير الرمز لصاحب التطبيق فقط (مسجّل في مجموعة admins)
      $('pinAdminCard').hidden = uid !== OWNER_UID;
    }
    renderHomeSoon(); if (profileId === uid && !$('s-profile').hidden) renderProfile();
  }, err => { $('errText').textContent = 'ما عندك صلاحية. تأكد من نسخ قواعد الأمان (firestore.rules) في Firebase.'; show('s-error'); console.error(err); });
}

$('setupBtn').addEventListener('click', async () => {
  const name = $('setupName').value.trim();
  if (!name) { toast('اكتب اسم العرض'); return; }
  if (!$('agreeTerms').checked) { toast('لازم توافق على شروط الاستخدام'); return; }
  $('setupBtn').disabled = true;
  try {
    let pin;
    for (let i = 0; i < 5; i++) { pin = newPin(); if (!(await fs.doc('pins/' + pin).get()).exists) break; }
    await fs.doc('pins/' + pin).set({ uid });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    await fs.doc('users/' + uid).set({ name, pin, msg: '', busy: false, photo: '', country: tz === 'Asia/Riyadh' ? 'SA' : '', tz, cats: [DEFAULT_CAT], mute: false, lastSeen: Date.now(), updatedAt: Date.now(), change: 'join' });
  } catch (e) { console.error(e); toast('صار خطأ، جرّب مرة ثانية'); }
  $('setupBtn').disabled = false;
});

function heartbeat(){
  const beat = () => { if (document.visibilityState === 'visible') fs.doc('users/' + uid).update({ lastSeen: Date.now() }).catch(() => {}); };
  beat(); setInterval(beat, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { beat(); markRead(); updateTitle(); });
  setInterval(() => { renderHomeSoon(); if (!$('s-profile').hidden) renderProfile(); if (chatPeer) renderChatHead(); }, 30000);
}

function watchUser(id){
  if (userSubs[id]) return;
  userSubs[id] = fs.doc('users/' + id).onSnapshot(s => {
    const prev = users[id];
    if (s.exists) { users[id] = s.data(); delete gone[id]; } else { delete users[id]; gone[id] = true; }
    if (prev && users[id] && prev.updatedAt !== users[id].updatedAt && contacts[id]) play('contact');
    renderHomeSoon();
    if (profileId === id && !$('s-profile').hidden) renderProfile();
    if (chatPeer === id) { renderChatHead(); renderMsgs(); }
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
  fs.collection('groups').where('members', 'array-contains', uid).onSnapshot(s => {
    groups = {}; s.docs.forEach(d => groups[d.id] = d.data()); groupsReadable = true; renderHomeSoon();
  }, () => { groupsReadable = false; renderHomeSoon(); });
  fs.collection('users/' + uid + '/blocked').onSnapshot(s => {
    blocked = {}; s.docs.forEach(d => blocked[d.id] = true);
    renderHomeSoon();
    if (chatPeer) { renderChatHead(); renderMsgs(); }
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
      if (peer) watchUser(peer);
      if (!firstChatsSnap && c.type !== 'removed' && d.lastFrom && d.lastFrom !== uid && !isBlocked(d.lastFrom) && d.lastTs > (chats[c.doc.id]?.lastTs || 0)) {
        const viewing = c.doc.id === chatId && document.visibilityState === 'visible';
        if (d.lastKind === 'ping') nudgeEffect();
        else if (!viewing) { play('incoming'); buzz(200); }
      }
    });
    chats = {}; s.docs.forEach(d => chats[d.id] = d.data());
    firstChatsSnap = false;
    renderHomeSoon();
  });
}

/* ---------- الرئيسية ---------- */
let homeTimer = null;
function renderHomeSoon(){ clearTimeout(homeTimer); homeTimer = setTimeout(renderHome, 30); }
const unreadOf = c => c.lastFrom && c.lastFrom !== uid && c.lastTs > ((c.read || {})[uid] || 0);

function renderHome(){
  if (!me) return;
  buildMenu();
  $('meHeadAvatar').replaceChildren(avatar(uid, 'sm'));
  $('meHeadName').textContent = me.name;
  $('meHeadMsg').textContent = me.msg || statusLabel(me);
  $('meHeadStatus').className = 'st-icon' + (me.busy ? ' busy' : '');
  const contactIds = Object.keys(contacts).filter(id => !gone[id]);
  $('classicChatsCount').textContent = '(' + Object.values(chats).filter(c => c.lastTs && !isBlocked(c.members.find(m => m !== uid)) && !gone[c.members.find(m => m !== uid)]).length + ')';
  $('classicNamesCount').textContent = '(' + contactIds.length + ')';
  $('classicFriendsCount').textContent = '(' + contactIds.filter(id => !isBlocked(id)).length + ')';
  if (tab === 'chats') renderChats(); else if (tab === 'contacts' || tab === 'friends') renderContacts(); else if (tab === 'updates') renderUpdates(); else if (tab === 'pending') renderPending(); else if (tab === 'groups') renderGroups(); else if (tab && tab.startsWith('cat:')) renderCatPanel(tab);
  $('classicUpdatesCount').textContent = '(' + recentUpdates().length + ')';
  $('classicGroupsCount').textContent = groupsReadable ? '(' + Object.keys(groups).length + ')' : '(—)';
  $('classicPendingCount').textContent = requestsReadable ? '(' + pendingRequests().length + ')' : '(—)';
  const ups = recentUpdates().filter(id => users[id].updatedAt > seenUpdates).length;
  $('updDot').hidden = !ups || tab === 'updates';
  updateTitle();
}

function renderChats(){
  const list = $('chatList'); list.replaceChildren();
  const arr = Object.entries(chats).filter(([, c]) => { const p = c.members.find(m => m !== uid); return c.lastTs && !isBlocked(p) && !gone[p]; }).sort((a, b) => b[1].lastTs - a[1].lastTs);
  if (!arr.length) { list.append(el('div', 'empty', 'ما فيه دردشات. افتح جهات الاتصال واختر أحداً لبدء الدردشة.')); return; }
  arr.forEach(([, c]) => {
    const peer = c.members.find(m => m !== uid), un = unreadOf(c);
    const row = el('button', 'row' + (un ? ' unread' : '')); row.type = 'button';
    const info = el('span', 'info');
    const nm = el('span', 'nm'); nm.append(statusIcon(peer), el('span', '', nameOf(peer)));
    const last = c.lastKind === 'ping' ? 'وكزة PING!!!' : (c.lastFrom === uid ? 'أنت: ' : '') + (c.lastKind === 'broadcast' ? '📢 ' : '') + (c.lastMsg || '');
    info.append(nm, el('span', 'sub' + (c.lastKind === 'broadcast' ? ' bc' : ''), last));
    const side = el('span', 'side'); side.append(el('span', 'when', shortWhen(c.lastTs)));
    if (un) side.append(el('span', 'newpill', 'جديد'));
    row.append(avatar(peer, 'sm'), info, side);
    row.addEventListener('click', () => openChat(peer));
    list.append(row);
  });
}

function renderContacts(){
  const friends = tab === 'friends';
  const list = $(friends ? 'friendsList' : 'contactList'); list.replaceChildren();
  const q = friends ? '' : $('search').value.trim().toLowerCase();
  const ids = Object.keys(contacts).filter(id => !gone[id] && (!friends || !isBlocked(id)));
  if (!ids.length) { list.append(el('div', 'empty', 'ما عندك جهات اتصال. اضغط "إضافة" تحت واكتب رمز PIN حق صاحبك.')); return; }
  const cats = [...new Set([...(me.cats || [DEFAULT_CAT]), ...ids.map(id => contacts[id].cat || DEFAULT_CAT)])];
  cats.forEach(cat => {
    const inCat = ids.filter(id => (contacts[id].cat || DEFAULT_CAT) === cat && (!q || nameOf(id).toLowerCase().includes(q)))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ar'));
    if (!inCat.length && (q || cats.length > 1)) return;
    const open = !closedCats[cat] || q;
    const h = el('button', 'cathead'); h.type = 'button';
    h.append(el('span', 'grow', catLabel(cat)), el('span', 'n', inCat.length), el('span', 'tog', open ? '−' : '+'));
    h.addEventListener('click', () => { closedCats[cat] = !closedCats[cat]; saveLocal(); renderContacts(); });
    list.append(h);
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
const BUILTIN = ['chats', 'updates', 'contacts', 'friends', 'groups', 'broadcast', 'pending'];
const BUILTIN_LABEL = { chats: 'الدردشات', updates: 'التحديثات', contacts: 'الأسماء', friends: 'الأصدقاء', broadcast: '📢 بودكاست', groups: 'المجموعات', pending: 'المعلّق' };
const userCats = () => (me.cats || [DEFAULT_CAT]).filter(c => c !== DEFAULT_CAT);
const defaultLabel = k => k.startsWith('cat:') ? k.slice(4) : BUILTIN_LABEL[k];
function menuCfg(src = me.menu, cats = userCats()){
  const m = src || {}, all = [...BUILTIN, ...cats.map(c => 'cat:' + c)];
  const order = (m.order || []).filter(k => all.includes(k));
  all.forEach(k => {
    if (order.includes(k)) return;
    const at = k.startsWith('cat:') ? order.indexOf('contacts') : k === 'broadcast' && order.includes('groups') ? order.indexOf('groups') + 1 : -1;
    at >= 0 ? order.splice(at, 0, k) : order.push(k);
  });
  return { order, labels: { ...(m.labels || {}) }, hidden: (m.hidden || []).filter(k => all.includes(k)) };
}
const labelOf = (k, cfg = menuCfg()) => (cfg.labels[k] || '').trim() || defaultLabel(k);
const catLabel = c => c === DEFAULT_CAT ? c : labelOf('cat:' + c);
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
  const cfg = menuCfg(), menu = document.querySelector('#s-home .classic-menu'), tail = $('menuEditBtn');
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
    if (k.startsWith('cat:')) row.append(mk('حذف', 'del', () => {
      const name = k.slice(4);
      menuDraft.order = menuDraft.order.filter(x => x !== k); menuDraft.hidden = menuDraft.hidden.filter(x => x !== k);
      delete menuDraft.labels[k]; menuDraft.cats = menuDraft.cats.filter(c => c !== name); menuDraft.removed.push(name);
      renderMenuEdit();
    }));
    else if (k === 'contacts' || k === 'chats') row.append(el('span', 'tag', 'أساسي'));
    box.append(row);
  });
}
$('menuAddCat').addEventListener('click', () => {
  const name = $('menuNewCat').value.trim();
  if (!name) return;
  if (name === DEFAULT_CAT || menuDraft.cats.includes(name)) { toast('الفئة موجودة'); return; }
  menuDraft.cats.push(name); menuDraft.removed = menuDraft.removed.filter(c => c !== name);
  const at = menuDraft.order.indexOf('contacts'); menuDraft.order.splice(at >= 0 ? at : menuDraft.order.length, 0, 'cat:' + name);
  $('menuNewCat').value = ''; renderMenuEdit();
});
$('menuReset').addEventListener('click', () => {
  menuDraft.labels = {}; menuDraft.hidden = [];
  menuDraft.order = menuCfg({}, menuDraft.cats).order; renderMenuEdit();
});
$('menuSave').addEventListener('click', async () => {
  // الأساسية ما تنخفي كلها: لازم تبقى الدردشات أو الأسماء ظاهرة
  if (menuDraft.hidden.includes('chats') && menuDraft.hidden.includes('contacts')) { toast('خلّ الدردشات أو الأسماء ظاهرة'); return; }
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
  $('led').classList.toggle('on', n > 0);
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
  if (!groupsReadable) { list.append(el('div','empty','تعذر قراءة المجموعات. تحقق من قواعد Firebase.')); return; }
  const entries = Object.values(groups);
  if (!entries.length) { list.append(el('div','empty','لا توجد مجموعات')); return; }
  entries.forEach(g=>{const row=el('div','row'),info=el('span','info'); info.append(el('span','nm',g.name || 'مجموعة'),el('span','sub',(g.members?.length || 0)+' أعضاء'));row.append(info);list.append(row);});
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
    renderTonePicker();
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

$('pfAvatar').addEventListener('click', () => { if (profileId === uid) $('photoInput').click(); });
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
  chatId = id; chatPeer = peer; msgs = []; curChat = null; firstMsgsSnap = true;
  watchUser(peer); renderChatHead();
  $('msgList').replaceChildren(el('div', 'empty', 'جاري التحميل…'));
  unsubChat = fs.doc('chats/' + id).onSnapshot(s => { curChat = s.data() || {}; renderMsgs(); renderTyping(); });
  unsubMsgs = fs.collection('chats/' + id + '/messages').orderBy('ts', 'desc').limit(150)
    .onSnapshot({ includeMetadataChanges: true }, s => {
      msgs = s.docs.map(d => ({ id: d.id, pending: d.metadata.hasPendingWrites, ...d.data() })).reverse();
      if (!firstMsgsSnap) {
        const fresh = s.docChanges().filter(c => c.type === 'added' && c.doc.data().from !== uid);
        if (!isBlocked(peer) && fresh.some(c => c.doc.data().kind !== 'ping')) { play('incoming'); buzz(120); }
      }
      firstMsgsSnap = false;
      renderMsgs(true);
    });
}
function closeChat(){ clearDraftSticker(); toggleFaces(false); unsubMsgs?.(); unsubChat?.(); unsubMsgs = unsubChat = null; chatId = chatPeer = null; }
function renderChatHead(){
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
$('chInfo').addEventListener('click', () => chatPeer && openProfile(chatPeer));

function renderMsgs(fromMsgs){
  if (!chatPeer) return;
  const list = $('msgList'), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.replaceChildren();
  if (!msgs.length) { list.append(el('div', 'empty', 'ابدأ الدردشة مع ' + nameOf(chatPeer) + '.')); return; }
  const peerRead = (curChat?.read || {})[chatPeer] || 0;
  let lastDay = '', card = null, cardFrom = null, cardTs = 0;
  msgs.forEach(m => {
    const day = fmtDay(m.ts);
    if (day !== lastDay) { list.append(el('div', 'day', day)); lastDay = day; card = null; }
    const mine = m.from === uid;
    if (m.kind === 'ping') {
      const p = el('div', 'pingcard');
      p.append(mine ? 'وكزت ' : 'وكزك ', el('bdi', '', nameOf(mine ? chatPeer : m.from)), ' ', el('span', 'pw', 'PING!!!'), el('span', 't', fmtTime(m.ts)));
      list.append(p); card = null; return;
    }
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
    if (m.broadcast) txt.append(el('span', 'bctag', '📢 بودكاست'));
    if (m.kind === 'sticker' && Number.isInteger(m.sticker) && m.sticker >= 0 && m.sticker < 48) {
      txt.append(stickerFace(m.sticker));
      if (m.text && m.text !== 'ملصق بلاك بيري') txt.append(el('span', 'sticker-caption', m.text));
    }
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
  const t = (curChat?.typing || {})[chatPeer] || 0;
  $('typing').textContent = chatPeer && Date.now() - t < 5000 ? nameOf(chatPeer) + ' يكتب…' : '';
}
setInterval(renderTyping, 1500);

async function sendMsg(data){
  if (!chatId) return;
  const ts = Date.now(), id = chatId;
  const b = fs.batch();
  b.set(fs.collection('chats/' + id + '/messages').doc(), { from: uid, ts, kind: 'text', ...data });
  b.update(fs.doc('chats/' + id), { lastMsg: data.kind === 'ping' ? 'PING!!!' : data.kind === 'sticker' ? 'ملصق بلاك بيري' : (data.text || '').slice(0, 80), lastTs: ts, lastFrom: uid, lastKind: data.kind || 'text', ['read.' + uid]: ts, ['typing.' + uid]: 0 });
  try { await b.commit(); if (data.kind === 'ping') { play('ping'); shake(); } else play('sent'); }
  catch (e) { console.error(e); toast('ما وصلت الرسالة، تأكد من الاتصال'); }
}
let draftSticker = null;
function clearDraftSticker(){ draftSticker = null; $('stickerDraft')?.replaceChildren(); if ($('stickerDraft')) $('stickerDraft').hidden = true; }
function selectSticker(index){
  if ($('composer').hidden) return;
  draftSticker = index;
  const draft = $('stickerDraft');
  const remove = el('button', 'remove-sticker', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'إزالة الملصق');
  remove.onclick = clearDraftSticker;
  draft.replaceChildren(stickerFace(index), remove); draft.hidden = false;
  $('msgInput').focus({preventScroll:true});
}
function updateComposer(){
  if ($('composer').hidden) { toggleFaces(false); clearDraftSticker(); }
}
function sendText(){
  const input = $('msgInput');
  const text = input.value.trim(); if ((!text && draftSticker == null) || $('composer').hidden) return;
  const data = draftSticker == null ? {kind:'text', text} : {kind:'sticker', sticker:draftSticker, text};
  input.value = ''; clearDraftSticker(); updateComposer(); sendMsg(data);
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
  const input = $('msgInput'), v = input.value;
  const a = input.selectionStart ?? v.length, b = input.selectionEnd ?? v.length;
  if ((v.length - (b - a) + f.length) > input.maxLength) return;
  input.value = v.slice(0, a) + f + v.slice(b);
  const pos = a + f.length; try { input.setSelectionRange(pos, pos); } catch {}
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
$('faceBtn').addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') e.preventDefault(); });
$('faceBtn').addEventListener('click', () => toggleFaces());
$('msgInput').addEventListener('input', () => {
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
      b.set(fs.collection('chats/' + id + '/messages').doc(), { from: uid, ts, kind: 'text', text, broadcast: true });
      b.update(fs.doc('chats/' + id), { lastMsg: text.slice(0, 80), lastTs: ts, lastFrom: uid, lastKind: 'broadcast', ['read.' + uid]: ts });
      await b.commit(); ok++;
    } catch (err) { console.error(err); }
  }
  bcBusy = false; $('bcSend').disabled = false; $('bcSend').textContent = '📢 إرسال';
  if (ok) play('sent');
  if (ok === ids.length) { toast('وصل البودكاست لـ ' + ok + ' ✅'); show('s-home'); }
  else toast('وصلت لـ ' + ok + ' من ' + ids.length + '، الباقي ما وصل');
});

boot();
