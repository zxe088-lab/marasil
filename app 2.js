/* مراسيل — تطبيق محادثة على طريقة الماسنجر الكلاسيكي، يعمل على Firebase (الخطة المجانية) */
'use strict';

const $ = id => document.getElementById(id);
const COLORS = ['#c0392b','#2e86c1','#239b56','#b9770e','#7d3c98','#148f77','#a04000','#2c3e8f'];
const COUNTRIES = [
  ['SA','السعودية'],['KW','الكويت'],['AE','الإمارات'],['QA','قطر'],['BH','البحرين'],['OM','عُمان'],
  ['YE','اليمن'],['IQ','العراق'],['JO','الأردن'],['EG','مصر'],['SY','سوريا'],['LB','لبنان'],
  ['PS','فلسطين'],['SD','السودان'],['LY','ليبيا'],['TN','تونس'],['DZ','الجزائر'],['MA','المغرب'],['','أخرى']
];
const EMOJIS = '😊😄😁😂🤣😅😉😍😘🥰😋😜🤪😎🤩🥳😏😌🤔🤨😐😶🙄😴😢😭😤😡🤬😱😳🥺😇🤗🤭🤫👍👎👌✌️🤝🙏👏💪❤️💔💯🔥⭐🎉🌹☕🚗✈️🏕️⚽'.match(/\p{Extended_Pictographic}️?/gu);
const DEFAULT_CAT = 'جهات الاتصال';
const OWNER_UID = '7KzlcizFv8TrIeqRVqi6BjNoCue2';   // صاحب التطبيق: الوحيد اللي يقدر يغيّر رمز PIN
const ONLINE_MS = 2 * 60 * 1000;
const GROUP_MS = 5 * 60 * 1000;   // رسائل نفس الشخص خلال 5 دقائق تنجمع في بطاقة وحدة

let auth, fs, uid = null, me = null, tab = 'chats';
const users = {}, userSubs = {};
let contacts = {}, chats = {}, closedCats = {};
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
  s.title = d?.busy ? 'مشغول' : 'متوفر';
  return s;
}

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
const toneBuffers = {};
async function decodeTone(name, arrayBuf){
  const ctx = audio(); if (!ctx) return;
  try { toneBuffers[name] = await ctx.decodeAudioData(arrayBuf); } catch { delete toneBuffers[name]; }
}
async function loadTone(name){
  delete toneBuffers[name];
  let custom = null; try { custom = localStorage.getItem('marasil-tone-' + name); } catch {}
  try {
    if (custom) return decodeTone(name, await (await fetch(custom)).arrayBuffer());
    for (const ext of ['mp3', 'ogg', 'wav', 'm4a']) {
      const r = await fetch('sounds/' + name + '.' + ext, { cache: 'force-cache' });
      if (r.ok && (r.headers.get('content-type') || '').startsWith('audio')) return decodeTone(name, await r.arrayBuffer());
    }
  } catch {}
}
Object.keys(TONE_NAMES).forEach(loadTone);
function playBuffer(buf){
  const ctx = audio(); if (!ctx) return false;
  const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start(); return true;
}
const play = name => { if (me?.mute) return; if (toneBuffers[name] && playBuffer(toneBuffers[name])) return; SOUNDS[name]?.(); };

function renderTonePicker(){
  const box = $('toneList'); if (!box || box.childElementCount) return;
  Object.entries(TONE_NAMES).forEach(([name, label]) => {
    const row = el('div', 'tonerow');
    const lab = el('span', 'tn-label', label);
    const st = el('span', 'tn-state');
    const refresh = () => { let c = null; try { c = localStorage.getItem('marasil-tone-' + name); } catch {} st.textContent = c ? 'نغمة من جهازك' : 'افتراضية'; };
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
        if (!toneBuffers[name]) { try { localStorage.removeItem('marasil-tone-' + name); } catch {} toast('ما قدرنا نشغّل هذا الملف، جرّب mp3'); }
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
const buzz = pattern => { try { navigator.vibrate?.(pattern); } catch {} };
function shake(){ const a = $('app'); a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake'); }
function nudgeEffect(){ play('ping'); buzz([400, 100, 400, 100, 400, 100, 800]); shake(); setTimeout(shake, 600); }

/* ---------- التنقل ---------- */
const SCREENS = ['s-loading','s-error','s-setup','s-home','s-add','s-profile','s-chat'];
function show(id, push = true){
  const cur = SCREENS.find(s => !$(s).hidden);
  if (push && cur && cur !== id && !['s-loading','s-error','s-setup'].includes(cur)) stack.push(cur);
  SCREENS.forEach(s => $(s).hidden = s !== id);
  if (id !== 's-chat') closeChat();
  if (id === 's-home') { stack = []; renderHome(); }
  updateTitle();
}
function back(){ show(stack.pop() || 's-home', false); }
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));

function setTab(t){
  tab = t;
  ['updates','chats','contacts'].forEach(k => $('t-' + k).hidden = k !== t);
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'updates') { seenUpdates = Date.now(); saveLocal(); }
  renderHome();
}
document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

/* ---------- Firebase ---------- */
function boot(){
  const cfg = window.FIREBASE_CONFIG;
  if (!window.firebase || !cfg || String(cfg.apiKey).includes('ضع')) {
    $('errText').textContent = 'لازم تحط إعدادات مشروعك في ملف firebase-config.js. الخطوات موجودة في ملف README.';
    show('s-error'); return;
  }
  firebase.initializeApp(cfg);
  auth = firebase.auth(); fs = firebase.firestore();
  auth.onAuthStateChanged(u => { if (u) start(u.uid); });
  auth.signInAnonymously().catch(e => {
    $('errText').textContent = 'ما قدرنا نسجل الدخول. تأكد أنك فعّلت الدخول المجهول (Anonymous) في Firebase.';
    show('s-error'); console.error(e);
  });
}

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
  beat(); setInterval(beat, 60000);
  document.addEventListener('visibilitychange', () => { beat(); markRead(); updateTitle(); });
  setInterval(() => { renderHomeSoon(); if (!$('s-profile').hidden) renderProfile(); if (chatPeer) renderChatHead(); }, 30000);
}

function watchUser(id){
  if (userSubs[id]) return;
  userSubs[id] = fs.doc('users/' + id).onSnapshot(s => {
    const prev = users[id];
    if (s.exists) users[id] = s.data(); else delete users[id];
    if (prev && users[id] && prev.updatedAt !== users[id].updatedAt && contacts[id]) play('contact');
    renderHomeSoon();
    if (profileId === id && !$('s-profile').hidden) renderProfile();
    if (chatPeer === id) { renderChatHead(); renderMsgs(); }
  });
}

function listen(){
  fs.collection('users/' + uid + '/contacts').onSnapshot(s => {
    contacts = {};
    s.docs.forEach(d => { contacts[d.id] = d.data(); watchUser(d.id); });
    renderHomeSoon();
  });
  fs.collection('chats').where('members', 'array-contains', uid).onSnapshot(s => {
    s.docChanges().forEach(c => {
      const d = c.doc.data(), peer = d.members.find(m => m !== uid);
      if (peer) watchUser(peer);
      if (!firstChatsSnap && c.type !== 'removed' && d.lastFrom && d.lastFrom !== uid && d.lastTs > (chats[c.doc.id]?.lastTs || 0)) {
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
  $('meHeadAvatar').replaceChildren(avatar(uid, 'sm'));
  $('meHeadName').textContent = me.name;
  $('meHeadMsg').textContent = me.msg || (me.busy ? 'مشغول' : 'متوفر');
  $('meHeadStatus').className = 'st-icon' + (me.busy ? ' busy' : '');
  if (tab === 'chats') renderChats(); else if (tab === 'contacts') renderContacts(); else renderUpdates();
  const ups = recentUpdates().filter(id => users[id].updatedAt > seenUpdates).length;
  $('updDot').hidden = !ups || tab === 'updates';
  updateTitle();
}

function renderChats(){
  const list = $('chatList'); list.replaceChildren();
  const arr = Object.entries(chats).filter(([, c]) => c.lastTs).sort((a, b) => b[1].lastTs - a[1].lastTs);
  if (!arr.length) { list.append(el('div', 'empty', 'ما فيه دردشات. افتح جهات الاتصال واختر أحداً لبدء الدردشة.')); return; }
  arr.forEach(([, c]) => {
    const peer = c.members.find(m => m !== uid), un = unreadOf(c);
    const row = el('button', 'row' + (un ? ' unread' : '')); row.type = 'button';
    const info = el('span', 'info');
    const nm = el('span', 'nm'); nm.append(statusIcon(peer), el('span', '', nameOf(peer)));
    const last = c.lastKind === 'ping' ? 'وكزة PING!!!' : (c.lastFrom === uid ? 'أنت: ' : '') + (c.lastMsg || '');
    info.append(nm, el('span', 'sub', last));
    const side = el('span', 'side'); side.append(el('span', 'when', shortWhen(c.lastTs)));
    if (un) side.append(el('span', 'newpill', 'جديد'));
    row.append(avatar(peer, 'sm'), info, side);
    row.addEventListener('click', () => openChat(peer));
    list.append(row);
  });
}

function renderContacts(){
  const list = $('contactList'); list.replaceChildren();
  const q = $('search').value.trim().toLowerCase();
  const ids = Object.keys(contacts);
  if (!ids.length) { list.append(el('div', 'empty', 'ما عندك جهات اتصال. اضغط "إضافة" تحت واكتب رمز PIN حق صاحبك.')); return; }
  const cats = [...new Set([...(me.cats || [DEFAULT_CAT]), ...ids.map(id => contacts[id].cat || DEFAULT_CAT)])];
  cats.forEach(cat => {
    const inCat = ids.filter(id => (contacts[id].cat || DEFAULT_CAT) === cat && (!q || nameOf(id).toLowerCase().includes(q)))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ar'));
    if (!inCat.length && (q || cats.length > 1)) return;
    const open = !closedCats[cat] || q;
    const h = el('button', 'cathead'); h.type = 'button';
    h.append(el('span', 'grow', cat), el('span', 'n', inCat.length), el('span', 'tog', open ? '−' : '+'));
    h.addEventListener('click', () => { closedCats[cat] = !closedCats[cat]; saveLocal(); renderContacts(); });
    list.append(h);
    if (!open) return;
    if (!inCat.length) { list.append(el('div', 'empty', 'الفئة فاضية.')); return; }
    const grid = el('div', 'grid');
    inCat.forEach(id => {
      const t = el('button', 'tile'); t.type = 'button'; t.style.background = colorOf(id);
      const p = photoOf(id);
      if (p) { const img = el('img'); img.src = p; img.alt = ''; t.append(img); } else t.append(initialOf(id));
      const tn = el('span', 'tn'); tn.append(statusIcon(id), el('span', '', nameOf(id))); t.append(tn);
      if (users[id]?.busy) t.append(el('span', 'tbusy', '−'));
      t.addEventListener('click', () => openProfile(id));
      grid.append(t);
    });
    list.append(grid);
  });
}
$('search').addEventListener('input', renderContacts);

const CHANGE_TEXT = { msg: 'غيّر رسالته الشخصية', name: 'غيّر اسم العرض', photo: 'غيّر صورة العرض', status: 'غيّر حالته', join: 'صار من جهات الاتصال', country: 'غيّر موقعه' };
function recentUpdates(){
  const week = Date.now() - 7 * 864e5;
  return Object.keys(contacts).filter(id => users[id]?.updatedAt > week).sort((a, b) => users[b].updatedAt - users[a].updatedAt);
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
    if (d.change === 'status') t.append(': ' + (d.busy ? 'مشغول' : 'متوفر'));
    if (d.change === 'country') t.append(': ' + flagOf(d.country) + ' ' + countryName(d.country));
    line.append(t);
    info.append(line, el('span', 'sub', ago(d.updatedAt)));
    row.append(avatar(id, 'sm'), info);
    row.addEventListener('click', () => openProfile(id));
    list.append(row);
  });
}

function updateTitle(){
  const n = Object.values(chats).filter(unreadOf).length;
  document.title = (n ? '(' + n + ') ' : '') + 'مراسيل';
  $('led').classList.toggle('on', n > 0);
  $('unreadBadge').hidden = !n; $('unreadBadge').textContent = n;
}

/* ---------- إضافة جهة اتصال ---------- */
function fillCatSelect(sel, value){
  sel.replaceChildren();
  (me.cats || [DEFAULT_CAT]).forEach(c => { const o = el('option', '', c); o.value = c; sel.append(o); });
  sel.value = value || DEFAULT_CAT;
}
$('addContactBtn').addEventListener('click', () => { fillCatSelect($('addCat')); $('addPin').value = ''; show('s-add'); setTimeout(() => $('addPin').focus(), 50); });
$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pin = $('addPin').value.trim().toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(pin)) { toast('رمز PIN لازم يكون 8 خانات (أرقام وحروف من A إلى F)'); return; }
  if (pin === me.pin) { toast('هذا رمزك أنت'); return; }
  try {
    const p = await fs.doc('pins/' + pin).get();
    if (!p.exists) { toast('ما لقينا أحد بهذا الرمز'); return; }
    const cid = p.data().uid;
    const b = fs.batch();
    b.set(fs.doc('users/' + uid + '/contacts/' + cid), { cat: $('addCat').value, at: Date.now() }, { merge: true });
    b.set(fs.doc('users/' + cid + '/contacts/' + uid), { at: Date.now() }, { merge: true });
    await b.commit();
    toast('تمت الإضافة'); play('contact'); show('s-home'); setTab('contacts');
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

function renderProfile(){
  const id = profileId, d = dataOf(id) || {}, mine = id === uid;
  $('pfTitle').textContent = mine ? 'ملفي الشخصي' : 'ملف تعريف جهة الاتصال';
  $('pfAvatar').replaceChildren(avatar(id, 'lg'));
  $('pfPinSmall').textContent = d.pin || '';
  $('pfName').textContent = d.name || '';
  $('pfPin').textContent = d.pin || '';
  $('pfMsg').textContent = d.msg || '';
  $('pfStatus').replaceChildren(statusIcon(id), ' ', d.busy ? 'مشغول' : (isOnline(id) ? 'متوفر' : 'غير متصل'));
  $('pfFlag').textContent = flagOf(d.country) + ' ' + countryName(d.country);
  $('pfTz').textContent = d.tz ? (d.tz.split('/').pop().replace(/_/g, ' ') + ' (' + tzOffset(d.tz) + ')') : '';
  $('pfTime').textContent = d.tz ? fmtTime(Date.now(), d.tz) : '';
  $('pfActions').hidden = mine; $('meEdit').hidden = !mine;
  if (mine) {
    if (!document.activeElement?.closest('#meEdit')) {
      $('edName').value = me.name || ''; $('edMsg').value = me.msg || ''; $('edMute').checked = !!me.mute;
      const sel = $('edCountry'); if (!sel.options.length) COUNTRIES.forEach(([cc, n]) => { const o = el('option', '', (cc ? flagOf(cc) + ' ' : '') + n); o.value = cc; sel.append(o); });
      sel.value = me.country || '';
    }
    $('setAvail').setAttribute('aria-pressed', !me.busy); $('setBusy').setAttribute('aria-pressed', !!me.busy);
    $('photoDel').hidden = !me.photo;
    renderTonePicker();
  } else fillCatSelect($('pfCat'), contacts[id]?.cat);
}

async function saveMe(fields, change, msg){
  try { await fs.doc('users/' + uid).update(change ? { ...fields, updatedAt: Date.now(), change } : fields); if (msg) toast(msg); }
  catch (e) { console.error(e); toast('ما قدرنا نحفظ، جرّب مرة ثانية'); }
}
$('edSave').addEventListener('click', () => {
  const name = $('edName').value.trim(); if (!name) { toast('اسم العرض ما يصير فاضي'); return; }
  const f = {}; let change = null;
  if (name !== me.name) { f.name = name; change = 'name'; }
  if ($('edMsg').value.trim() !== (me.msg || '')) { f.msg = $('edMsg').value.trim(); change = 'msg'; }
  if ($('edCountry').value !== (me.country || '')) { f.country = $('edCountry').value; change = change || 'country'; }
  if (!change) { toast('ما فيه تغيير'); return; }
  saveMe(f, change, 'تم الحفظ');
});
$('edMute').addEventListener('change', () => saveMe({ mute: $('edMute').checked }, null, $('edMute').checked ? 'تم كتم النغمات' : 'النغمات شغالة'));
$('setAvail').addEventListener('click', () => me.busy && saveMe({ busy: false }, 'status', 'حالتك: متوفر'));
$('setBusy').addEventListener('click', () => !me.busy && saveMe({ busy: true }, 'status', 'حالتك: مشغول'));
$('copyPin').addEventListener('click', async () => { try { await navigator.clipboard.writeText(me.pin); toast('تم نسخ رمز PIN'); } catch { toast('رمزك: ' + me.pin); } });
// تغيير رمز PIN: نحجز الرمز الجديد، نحدّث الملف، ثم نحذف القديم
async function changePin(pin){
  pin = pin.toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(pin)) { toast('الرمز لازم يكون 8 خانات: أرقام 0-9 وحروف A-F'); return; }
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

$('photoBtn').addEventListener('click', () => $('photoInput').click());
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
  $('emojiPanel').hidden = true;
  watchUser(peer); renderChatHead();
  $('msgList').replaceChildren(el('div', 'empty', 'جاري التحميل…'));
  unsubChat = fs.doc('chats/' + id).onSnapshot(s => { curChat = s.data() || {}; renderMsgs(); renderTyping(); });
  unsubMsgs = fs.collection('chats/' + id + '/messages').orderBy('ts', 'desc').limit(150)
    .onSnapshot({ includeMetadataChanges: true }, s => {
      msgs = s.docs.map(d => ({ id: d.id, pending: d.metadata.hasPendingWrites, ...d.data() })).reverse();
      if (!firstMsgsSnap) {
        const fresh = s.docChanges().filter(c => c.type === 'added' && c.doc.data().from !== uid);
        if (fresh.some(c => c.doc.data().kind !== 'ping')) { play('incoming'); buzz(120); }
      }
      firstMsgsSnap = false;
      renderMsgs(true);
    });
}
function closeChat(){ unsubMsgs?.(); unsubChat?.(); unsubMsgs = unsubChat = null; chatId = chatPeer = null; }
function renderChatHead(){
  if (!chatPeer) return;
  const d = users[chatPeer] || {};
  $('chAvatar').replaceChildren(avatar(chatPeer, 'sm'));
  $('chName').textContent = d.name || 'جهة اتصال';
  $('chStatus').className = 'st-icon' + (d.busy ? ' busy' : isOnline(chatPeer) ? '' : ' off');
  $('chMsg').textContent = d.msg || (d.busy ? 'مشغول' : isOnline(chatPeer) ? 'متوفر' : 'غير متصل');
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
    const line = el('div', 'line');
    let mark;
    if (!mine) mark = el('span', 'mark dot');
    else if (m.pending) { mark = el('span', 'mark p'); mark.title = 'جاري الإرسال'; }
    else if (peerRead >= m.ts) { mark = el('span', 'mark r', 'R'); mark.title = 'تمت القراءة'; }
    else { mark = el('span', 'mark d', 'D'); mark.title = 'تم التسليم'; }
    line.append(mark, el('span', 'txt', m.text || ''));
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
  b.update(fs.doc('chats/' + id), { lastMsg: data.kind === 'ping' ? 'PING!!!' : data.text.slice(0, 80), lastTs: ts, lastFrom: uid, lastKind: data.kind || 'text', ['read.' + uid]: ts, ['typing.' + uid]: 0 });
  try { await b.commit(); if (data.kind === 'ping') { play('ping'); shake(); } else play('sent'); }
  catch (e) { console.error(e); toast('ما وصلت الرسالة، تأكد من الاتصال'); }
}
function sendText(){
  const text = $('msgInput').value.trim(); if (!text) return;
  $('msgInput').value = ''; sendMsg({ kind: 'text', text });
}
$('composer').addEventListener('submit', e => { e.preventDefault(); sendText(); });
$('sendBtn').addEventListener('click', sendText);
$('msgInput').addEventListener('input', () => {
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
EMOJIS.forEach(e => { const b = el('button', '', e); b.type = 'button'; b.addEventListener('click', () => { const i = $('msgInput'); i.value += e; i.focus(); }); $('emojiPanel').append(b); });
$('emojiBtn').addEventListener('click', () => { $('emojiPanel').hidden = !$('emojiPanel').hidden; const l = $('msgList'); l.scrollTop = l.scrollHeight; });

boot();
