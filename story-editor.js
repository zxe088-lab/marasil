/* Snapchat-style photo story editor.
   Tools: text (Arabic fonts), drawing, emoji stickers, crop/zoom/rotate, filters + adjustments, sound.
   Everything is drawn on one canvas; the final 1080x1920 JPEG is rendered at publish time. */
'use strict';
window.BPBStoryEditor = (() => {
  const PW = 720, PH = 1280, EW = 1080, EH = 1920;
  const FONTS = [['sys', 'النظام', null, 700], ['cairo', 'القاهرة', 'Story Cairo', 700], ['tajawal', 'تجوّل', 'Story Tajawal', 700], ['almarai', 'المراعي', 'Story Almarai', 700], ['amiri', 'أميري', 'Story Amiri', 700], ['ruqaa', 'رقعة', 'Story Aref Ruqaa', 700], ['kufi', 'كوفي', 'Story Reem Kufi', 700], ['messiri', 'المسيري', 'Story El Messiri', 700], ['changa', 'شنجة', 'Story Changa', 700], ['lalezar', 'لالزار', 'Story Lalezar', 400], ['rakkas', 'رقّاص', 'Story Rakkas', 400], ['katibeh', 'كتيبة', 'Story Katibeh', 400], ['nkufi','نوتو كوفي','Story Noto Kufi',700], ['nnaskh','نسخ','Story Noto Naskh',700], ['plex','بليكس','Story IBM Plex',700], ['readex','ريدكس','Story Readex',700], ['lemonada','ليمونادا','Story Lemonada',700], ['jomhuria','جمهورية','Story Jomhuria',400], ['mada','مدى','Story Mada',700], ['schehe','شهرزاد','Story Scheherazade',700], ['markazi','مركزي','Story Markazi',700], ['lateef','لطيف','Story Lateef',700], ['vibes','فايبز','Story Vibes',400], ['baloo','بالو','Story Baloo',700], ['harmattan','هرمتان','Story Harmattan',700], ['mirza','ميرزا','Story Mirza',700]];
  const COLORS = ['#ffffff', '#111111', '#ffd400', '#ff4d4d', '#ff7ac8', '#3ec9ff', '#7dff7a', '#a06bff'];
  const FILTERS = [['none', 'أصلي'], ['bw', 'أبيض وأسود'], ['sepia', 'سيبيا'], ['vivid', 'حيوي'], ['warm', 'دافئ'], ['cool', 'بارد'], ['fade', 'باهت'], ['drama', 'درامي'], ['noir', 'نوار'], ['vintage', 'قديم'], ['golden', 'ذهبي'], ['sunset', 'غروب'], ['rose', 'وردي'], ['mint', 'نعناعي'], ['night', 'ليلي'], ['cinema', 'سينمائي'], ['pop', 'ملوّن'], ['soft', 'ناعم']];
  const PARAMS = { none: {}, bw: { s: 0 }, sepia: { sepia: 1 }, vivid: { s: 1.45, c: 1.1 }, warm: { m: [1.08, 1, .9], b: 6 }, cool: { m: [.9, 1, 1.1], b: 4 }, fade: { c: .8, b: 28, s: .85 }, drama: { c: 1.35, s: .8, b: -12 }, noir: { s: 0, c: 1.5, b: -10 }, vintage: { sepia: 1, c: .9, b: 8 }, golden: { m: [1.15, 1.03, .8], s: 1.2, b: 8 }, sunset: { m: [1.15, .95, .85], s: 1.3, c: 1.05 }, rose: { m: [1.1, .92, 1.05], s: 1.1, b: 10 }, mint: { m: [.9, 1.08, 1.02], s: 1.15 }, night: { m: [.8, .9, 1.2], c: 1.2, b: -25 }, cinema: { m: [.95, 1, 1.08], c: 1.25, s: .85, b: -6 }, pop: { s: 1.8, c: 1.2 }, soft: { c: .85, b: 14, s: 1.05 } };
  const EMOJIS = ['😀', '😂', '🥹', '😍', '🥰', '😎', '🤩', '😜', '🤪', '😇', '🥳', '😭', '😡', '🤯', '😱', '🤔', '🙄', '😴', '🤗', '🫶', '👍', '👎', '👏', '🙏', '💪', '✌️', '🤝', '👋', '🔥', '❤️', '💔', '💯', '✨', '🎉', '🎂', '🎁', '⭐', '🌟', '☀️', '🌙', '⚡', '🌈', '☕', '🍕', '🍔', '🍟', '🍉', '🍓', '🌹', '🌸', '🌴', '🚗', '✈️', '⚽', '🏀', '🎮', '🎧', '🎵', '📸', '💎', '👑', '🕌', '🤲', '📿', '☪️', '🇸🇦'];
  const AUDIO_TYPES = ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav'];
  const MAX_AUDIO = 3 * 1024 * 1024, MAX_RECORD = 20;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ICONS = {
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    draw: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>',
    sticker: '<path d="M20 12a8 8 0 1 1-8-8h4a4 4 0 0 1 4 4z"/><path d="M9 10h.01M14 10h.01M8.5 14.5a4.5 4.5 0 0 0 7 0"/>',
    crop: '<path d="M7 2v15h15M2 7h15v15"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    adjust: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    save: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    send: '<path d="M4 12l16-8-6 16-3-7z"/>',
    place: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>',
    trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    rotate: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>'
  };
  const icon = (name, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  /* ---------- rendering helpers (pure drawing, shared by preview and export) ---------- */
  const fontSpec = (t, px) => {
    const f = FONTS[t.font] || FONTS[0];
    return f[2] ? f[3] + ' ' + px + 'px "' + f[2] + '", "Geeza Pro", "Noto Naskh Arabic", sans-serif' : '700 ' + px + 'px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
  };
  async function ensureFont(t) {
    const f = FONTS[t.font];
    if (!f || !f[2] || !document.fonts) return;
    try { await document.fonts.load(f[3] + ' 40px "' + f[2] + '"', t.value || 'ابجد'); } catch { /* fall back to the system font */ }
  }
  const minZoom = v => (v.rot % 2 ? EH / EW : 1);
  function clampView(v) {
    v.zoom = clamp(v.zoom, minZoom(v), 4);
    const rw = (v.rot % 2 ? EH : EW) * v.zoom, rh = (v.rot % 2 ? EW : EH) * v.zoom;
    const mx = Math.max(0, (rw - EW) / 2) / EW, my = Math.max(0, (rh - EH) / 2) / EH;
    v.x = clamp(v.x, -mx, mx); v.y = clamp(v.y, -my, my);
  }
  function drawBase(ctx, W, H, base, v) {
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2 + v.x * W, H / 2 + v.y * H); ctx.rotate(v.rot * Math.PI / 2); ctx.scale(v.zoom, v.zoom);
    ctx.drawImage(base, -W / 2, -H / 2, W, H);
    ctx.restore();
  }
  function grade(canvas, st) {
    const p = PARAMS[st.filter] || {};
    if (st.filter === 'none' && !st.bright && !st.contrast && !st.sat) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }), d = ctx.getImageData(0, 0, canvas.width, canvas.height), a = d.data;
    const s = (p.s ?? 1) * (1 + st.sat / 100), c = (p.c ?? 1) * (1 + st.contrast / 100), b = (p.b || 0) + st.bright, m = p.m || [1, 1, 1];
    for (let i = 0; i < a.length; i += 4) {
      let r = a[i], g = a[i + 1], bl = a[i + 2];
      if (p.sepia) { const R = .393 * r + .769 * g + .189 * bl, G = .349 * r + .686 * g + .168 * bl, B = .272 * r + .534 * g + .131 * bl; r = R; g = G; bl = B; }
      else if (s !== 1) { const l = .299 * r + .587 * g + .114 * bl; r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s; }
      if (c !== 1) { r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128; }
      a[i] = r * m[0] + b; a[i + 1] = g * m[1] + b; a[i + 2] = bl * m[2] + b;
    }
    ctx.putImageData(d, 0, 0);
  }
  function drawStrokes(ctx, W, H, strokes) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineWidth = s.w * W;
      if (s.pts.length === 1) { ctx.beginPath(); ctx.arc(s.pts[0][0] * W, s.pts[0][1] * H, s.w * W / 2, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.beginPath(); ctx.moveTo(s.pts[0][0] * W, s.pts[0][1] * H);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0] * W, s.pts[i][1] * H);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawStickers(ctx, W, H, stickers, selected) {
    stickers.forEach((s, i) => {
      ctx.save(); ctx.translate(s.x * W, s.y * H); ctx.rotate(s.r);
      let hw, hh;
      if (s.pill) {
        /* location / time / weather label in the style of Snapchat geo-filters */
        const px = Math.round(s.s * W);
        ctx.font = '800 ' + px + 'px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.direction = /[؀-ۿ]/.test(s.e) ? 'rtl' : 'ltr';
        const w = ctx.measureText(s.e).width + px * 1.3, h = px * 1.9, r = h / 2;
        ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.beginPath(); ctx.moveTo(-w / 2 + r, -h / 2); ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r); ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r); ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r); ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#111'; ctx.fillText(s.e, 0, px * .04);
        hw = w / 2; hh = h / 2; s.bw = hw / W; s.bh = hh / W;
      } else {
        ctx.font = Math.round(s.s * W) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.e, 0, 0); hw = hh = s.s * W * .62;
      }
      if (selected === i) { ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeRect(-hw, -hh, hw * 2, hh * 2); }
      ctx.restore();
    });
  }
  /* Returns the text box (in 0..1 units) so the gesture layer can hit-test it. */
  function drawText(ctx, W, H, t) {
    const raw = t.value.trim(); if (!raw) return null;
    const px = Math.round(W * t.size / 100);
    ctx.save(); ctx.font = fontSpec(t, px); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = /[؀-ۿ]/.test(raw) ? 'rtl' : 'ltr';
    const maxW = W * .86, lines = [];
    for (const para of raw.split(/\r?\n/)) { let line = ''; for (const word of para.split(/\s+/).filter(Boolean)) { const next = line ? line + ' ' + word : word; if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word; } else line = next; } lines.push(line); }
    const lh = px * 1.35, top = t.y * H - lines.length * lh / 2, cx = t.x * W;
    let w = 0; for (const l of lines) w = Math.max(w, Math.min(maxW, ctx.measureText(l).width));
    const pad = px * .45, bx = cx - w / 2 - pad, by = top - pad * .4, bw = w + pad * 2, bh = lines.length * lh + pad * .8;
    if (t.bg) {
      const r = Math.min(px * .5, bh / 2);
      ctx.fillStyle = 'rgba(0,0,0,.58)'; ctx.beginPath(); ctx.moveTo(bx + r, by); ctx.arcTo(bx + bw, by, bx + bw, by + bh, r); ctx.arcTo(bx + bw, by + bh, bx, by + bh, r); ctx.arcTo(bx, by + bh, bx, by, r); ctx.arcTo(bx, by, bx + bw, by, r); ctx.closePath(); ctx.fill();
    }
    lines.forEach((l, i) => { const y = top + lh * (i + .5); if (!t.bg) { ctx.lineJoin = 'round'; ctx.lineWidth = px * .14; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(l, cx, y); } ctx.fillStyle = t.color; ctx.fillText(l, cx, y); });
    ctx.restore();
    return { x: bx / W, y: by / H, w: bw / W, h: bh / H };
  }

  /* ---------- the editor UI ---------- */
  function create(hooks) {
    const host = hooks.host, toast = hooks.toast || (() => {});
    const root = document.createElement('div');
    root.className = 'se'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'تحرير الستوري');
    root.innerHTML = '<div class="se-stage"><canvas class="se-canvas" aria-label="معاينة الستوري"></canvas></div>' +
      '<button type="button" class="se-close" aria-label="إغلاق المحرر">' + icon('close', 26) + '</button>' +
      '<div class="se-tools" role="toolbar" aria-label="أدوات التحرير"></div>' +
      '<div class="se-panel" hidden></div>' +
      '<div class="se-bar"><button type="button" class="se-save" aria-label="حفظ في الجهاز">' + icon('save') + '</button><button type="button" class="se-post" aria-label="نشر الستوري"><span>نشر الستوري</span>' + icon('send', 22) + '</button></div>' +
      '<div class="se-busy" hidden role="status"></div>';
    host.append(root);
    const cv = root.querySelector('.se-canvas'), panel = root.querySelector('.se-panel'), toolsEl = root.querySelector('.se-tools'), busyEl = root.querySelector('.se-busy');
    cv.width = PW; cv.height = PH;
    const ctx = cv.getContext('2d');

    let st = null, tool = null, graded = null, textBox = null, raf = 0, previewAudio = null, rec = null, recTimer = 0;
    const newState = base => ({
      base, view: { zoom: 1, x: 0, y: 0, rot: 0 }, filter: 'none', bright: 0, contrast: 0, sat: 0,
      strokes: [], stickers: [], sel: -1, text: { value: '', font: 1, color: '#ffffff', size: 7, x: .5, y: .5, bg: false },
      brush: { color: '#ffffff', size: .012 }, audio: null, dirty: false
    });

    function overlay(c, W, H, forPreview) {
      drawStrokes(c, W, H, st.strokes);
      drawStickers(c, W, H, st.stickers, forPreview ? st.sel : -1);
      const box = drawText(c, W, H, st.text);
      if (forPreview) textBox = box;
    }
    function draw() {
      if (!st) return;
      try { ctx.drawImage(graded, 0, 0); overlay(ctx, PW, PH, true); } catch (e) { fault(e); }
    }
    function regrade() {
      if (!st) return;
      try { clampView(st.view); drawBase(graded.getContext('2d', { willReadFrequently: true }), PW, PH, st.base, st.view); grade(graded, st); } catch (e) { fault(e); }
      draw();
    }
    const later = fn => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; fn(); }); };
    let reported = false;
    function fault(e) { console.error('story editor', e); if (!reported) { reported = true; toast('تعذّر تطبيق التعديل: ' + ((e && e.message) || e)); } }

    /* ----- gestures: one pointer draws/pans/drags, two pointers pinch ----- */
    const ptrs = new Map(); let mode = null, drag = null, pinch = null, stroke = null;
    const point = e => { const r = cv.getBoundingClientRect(); return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height }; };
    const hitSticker = p => { for (let i = st.stickers.length - 1; i >= 0; i--) { const s = st.stickers[i], dx = (p.u - s.x) * PW, dy = (p.v - s.y) * PH; if (s.pill ? (Math.abs(dx) < (s.bw || .2) * PW && Math.abs(dy) < (s.bh || .04) * PW) : Math.hypot(dx, dy) < s.s * PW * .62) return i; } return -1; };
    const hitText = p => textBox && p.u >= textBox.x && p.u <= textBox.x + textBox.w && p.v >= textBox.y && p.v <= textBox.y + textBox.h;
    function beginPinch() {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot((a.u - b.u) * PW, (a.v - b.v) * PH) || 1, a: Math.atan2((b.v - a.v) * PH, (b.u - a.u) * PW) };
      if (stroke) { st.strokes.pop(); stroke = null; }
      if (tool === 'crop' || mode === 'pan') { mode = 'zoom'; pinch.z = st.view.zoom; }
      else if (mode === 'sticker' && st.sel >= 0) { const s = st.stickers[st.sel]; pinch.s = s.s; pinch.r = s.r; }
      else if (mode === 'text') pinch.t = st.text.size;
      else mode = null;
    }
    cv.addEventListener('pointerdown', e => {
      if (!st) return; e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      ptrs.set(e.pointerId, point(e));
      if (ptrs.size === 2) { beginPinch(); return; }
      if (ptrs.size > 2) return;
      const p = point(e);
      if (tool === 'draw') { stroke = { c: st.brush.color, w: st.brush.size, pts: [[p.u, p.v]] }; st.strokes.push(stroke); st.dirty = true; mode = 'draw'; draw(); return; }
      if (tool === 'crop') { mode = 'pan'; drag = { u: p.u, v: p.v, x: st.view.x, y: st.view.y }; return; }
      const si = hitSticker(p);
      if (si >= 0) {
        const s = st.stickers[si]; st.stickers.push(st.stickers.splice(si, 1)[0]); st.sel = st.stickers.length - 1; mode = 'sticker'; drag = { du: p.u - s.x, dv: p.v - s.y };
        if (tool === 'sticker') showPanel(); draw(); return;
      }
      if (hitText(p)) { mode = 'text'; drag = { du: p.u - st.text.x, dv: p.v - st.text.y }; return; }
      if (st.sel !== -1) { st.sel = -1; if (tool === 'sticker') showPanel(); draw(); }
      mode = null;
    });
    cv.addEventListener('pointermove', e => {
      if (!st || !ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, point(e));
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()], d = Math.hypot((a.u - b.u) * PW, (a.v - b.v) * PH) || 1, ang = Math.atan2((b.v - a.v) * PH, (b.u - a.u) * PW), k = d / pinch.d;
        if (mode === 'zoom') { st.view.zoom = pinch.z * k; later(regrade); }
        else if (mode === 'sticker' && st.sel >= 0) { const s = st.stickers[st.sel]; s.s = clamp(pinch.s * k, .05, .9); s.r = pinch.r + (ang - pinch.a); st.dirty = true; later(draw); }
        else if (mode === 'text') { st.text.size = clamp(pinch.t * k, 3, 20); later(draw); }
        return;
      }
      if (ptrs.size !== 1) return;
      const p = point(e);
      if (mode === 'draw' && stroke) { stroke.pts.push([p.u, p.v]); later(draw); }
      else if (mode === 'pan' && drag) { st.view.x = drag.x + (p.u - drag.u); st.view.y = drag.y + (p.v - drag.v); st.dirty = true; later(regrade); }
      else if (mode === 'sticker' && st.sel >= 0) { const s = st.stickers[st.sel]; s.x = clamp(p.u - drag.du, 0, 1); s.y = clamp(p.v - drag.dv, 0, 1); st.dirty = true; later(draw); }
      else if (mode === 'text') { st.text.x = clamp(p.u - drag.du, .08, .92); st.text.y = clamp(p.v - drag.dv, .05, .95); later(draw); }
    });
    const lift = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) { mode = null; stroke = null; } else if (ptrs.size === 1) mode = null; };
    for (const type of ['pointerup', 'pointercancel']) cv.addEventListener(type, lift);

    /* ----- panels ----- */
    const mk = (tag, cls, html) => { const el = document.createElement(tag); if (cls) el.className = cls; if (html != null) el.innerHTML = html; return el; };
    const btn = (label, fn, cls) => { const b = mk('button', cls || '', ''); b.type = 'button'; b.textContent = label; b.onclick = fn; return b; };
    const iconBtn = (name, label, fn, cls) => { const b = mk('button', cls || 'se-ic', icon(name, 22)); b.type = 'button'; b.setAttribute('aria-label', label); b.onclick = fn; return b; };
    const slider = (label, min, max, value, oninput) => {
      const row = mk('label', 'se-row'); row.append(label + ' '); const input = mk('input'); input.type = 'range'; input.min = min; input.max = max; input.value = value; input.setAttribute('aria-label', label);
      let f = 0; input.oninput = () => { if (f) return; f = requestAnimationFrame(() => { f = 0; oninput(Number(input.value)); }); }; row.append(input); return row;
    };
    const swatches = (current, onpick) => {
      const row = mk('div', 'se-colors'); row.setAttribute('aria-label', 'الألوان');
      for (const c of COLORS) { const b = mk('button', 'se-swatch' + (c === current ? ' on' : '')); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', 'لون ' + c); b.onclick = () => { row.querySelectorAll('.se-swatch').forEach(x => x.classList.toggle('on', x === b)); onpick(c); }; row.append(b); }
      return row;
    };

    function textPanel() {
      const t = st.text, box = mk('div', 'se-box');
      const ta = mk('textarea'); ta.rows = 2; ta.maxLength = 200; ta.value = t.value; ta.placeholder = 'اكتب أو الصق نصًا…'; ta.setAttribute('aria-label', 'نص على الصورة');
      ta.oninput = () => { t.value = ta.value; st.dirty = true; draw(); };
      const fonts = mk('div', 'se-fonts'); fonts.setAttribute('aria-label', 'الخطوط');
      const mark = () => fonts.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.font) === t.font));
      FONTS.forEach((f, i) => { const b = btn(f[1], () => { t.font = i; mark(); draw(); ensureFont(t).then(draw); }); b.dataset.font = i; if (f[2]) { b.style.fontFamily = '"' + f[2] + '", sans-serif'; b.style.fontWeight = f[3]; } fonts.append(b); });
      mark();
      const row = mk('div', 'se-actions');
      const bg = btn('خلفية', () => { t.bg = !t.bg; bg.classList.toggle('on', t.bg); draw(); }); bg.setAttribute('aria-label', 'خلفية خلف النص'); bg.classList.toggle('on', t.bg);
      const small = btn('A−', () => { t.size = Math.max(3, t.size - 1); draw(); }), big = btn('A+', () => { t.size = Math.min(20, t.size + 1); draw(); });
      small.setAttribute('aria-label', 'تصغير النص'); big.setAttribute('aria-label', 'تكبير النص');
      row.append(small, big, bg);
      box.append(ta, fonts, swatches(t.color, c => { t.color = c; draw(); }), row);
      const hint = mk('p', 'se-hint', 'اسحب النص لتحريكه وقرّب بإصبعين لتكبيره'); box.append(hint);
      return box;
    }
    function drawPanel() {
      const box = mk('div', 'se-box');
      box.append(swatches(st.brush.color, c => { st.brush.color = c; }));
      box.append(slider('سمك الفرشاة', 4, 40, Math.round(st.brush.size * 1000), v => { st.brush.size = v / 1000; }));
      const row = mk('div', 'se-actions');
      row.append(iconBtn('undo', 'تراجع', () => { st.strokes.pop(); draw(); }), btn('مسح الرسم', () => { st.strokes = []; draw(); }));
      box.append(row, mk('p', 'se-hint', 'ارسم بإصبعك على الصورة'));
      return box;
    }
    function stickerPanel() {
      const box = mk('div', 'se-box'), grid = mk('div', 'se-emoji');
      EMOJIS.forEach(e => { const b = btn(e, () => { st.stickers.push({ e, x: .5, y: .45, s: .2, r: 0 }); st.sel = st.stickers.length - 1; st.dirty = true; draw(); showPanel(); }); b.setAttribute('aria-label', 'ملصق ' + e); grid.append(b); });
      box.append(grid);
      if (st.sel >= 0) {
        const s = st.stickers[st.sel], row = mk('div', 'se-actions');
        row.append(btn('A−', () => { s.s = s.pill ? Math.max(.03, s.s * .87) : Math.max(.05, s.s - .04); draw(); }), btn('A+', () => { s.s = s.pill ? Math.min(.14, s.s * 1.15) : Math.min(.9, s.s + .04); draw(); }), iconBtn('rotate', 'تدوير الملصق', () => { s.r += Math.PI / 12; draw(); }), iconBtn('trash', 'حذف الملصق', () => { st.stickers.splice(st.sel, 1); st.sel = -1; draw(); showPanel(); }));
        box.append(row);
      }
      box.append(mk('p', 'se-hint', 'اسحب الملصق لتحريكه وقرّب بإصبعين لتكبيره وتدويره'));
      return box;
    }
    function cropPanel() {
      const box = mk('div', 'se-box'), v = st.view, row = mk('div', 'se-actions');
      const zoom = slider('التقريب', 100, 400, Math.round(v.zoom * 100), n => { v.zoom = n / 100; st.dirty = true; regrade(); });
      row.append(btn('تدوير ٩٠°', () => { v.rot = (v.rot + 1) % 4; clampView(v); st.dirty = true; regrade(); showPanel(); }), btn('إعادة الضبط', () => { st.view = { zoom: 1, x: 0, y: 0, rot: 0 }; regrade(); showPanel(); }));
      box.append(zoom, row, mk('p', 'se-hint', 'اسحب الصورة لتحريكها وقرّب بإصبعين'));
      return box;
    }
    function adjustPanel() {
      const box = mk('div', 'se-box'), filters = mk('div', 'se-fonts'); filters.setAttribute('aria-label', 'الفلاتر');
      const mark = () => filters.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.filter === st.filter));
      for (const [key, label] of FILTERS) { const b = btn(label, () => { st.filter = key; st.dirty = true; regrade(); mark(); }); b.dataset.filter = key; filters.append(b); }
      mark();
      box.append(filters, slider('السطوع', -60, 60, st.bright, n => { st.bright = n; st.dirty = true; regrade(); }), slider('التباين', -40, 60, st.contrast, n => { st.contrast = n; st.dirty = true; regrade(); }), slider('التشبّع', -80, 80, st.sat, n => { st.sat = n; st.dirty = true; regrade(); }));
      return box;
    }

    /* ----- sound ----- */
    function stopPreview() { if (previewAudio) { previewAudio.pause(); URL.revokeObjectURL(previewAudio.src); previewAudio = null; } }
    function stopRecording() { clearTimeout(recTimer); if (rec && rec.state !== 'inactive') rec.stop(); }
    const readDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
    const typeOf = (blob, name) => {
      let t = String(blob.type || '').split(';')[0].toLowerCase();
      if (!AUDIO_TYPES.includes(t)) { const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1]; t = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm' }[(ext || '').toLowerCase()] || ''; }
      return AUDIO_TYPES.includes(t) ? t : '';
    };
    async function setAudio(blob, name, seconds) {
      const mime = typeOf(blob, name); if (!mime) throw new Error('نوع الملف الصوتي غير مدعوم');
      if (blob.size > MAX_AUDIO) throw new Error('الملف الصوتي كبير (الحد ٣ ميجابايت)');
      let dur = seconds;
      if (!dur) dur = await new Promise(res => { const a = new Audio(), u = URL.createObjectURL(blob); a.preload = 'metadata'; a.onloadedmetadata = () => { URL.revokeObjectURL(u); res(a.duration); }; a.onerror = () => { URL.revokeObjectURL(u); res(0); }; a.src = u; });
      if (Number.isFinite(dur) && dur > 120) throw new Error('الملف الصوتي طويل (الحد دقيقتان)');
      const data = await readDataUrl(blob);
      st.audio = { blob, name, mime, dur: Number.isFinite(dur) ? Math.round(dur) : 0, dataUrl: data.replace(/^data:[^;,]*/, 'data:' + mime) }; st.dirty = true;
    }
    function audioPanel() {
      const box = mk('div', 'se-box'), info = mk('p', 'se-hint'), row = mk('div', 'se-actions');
      const refresh = () => { info.textContent = st.audio ? '🎵 ' + st.audio.name + (st.audio.dur ? ' · ' + st.audio.dur + ' ث' : '') : 'أضف صوتًا يُشغَّل مع الستوري لأصدقائك (حتى ١٥ ثانية)'; };
      refresh();
      const recBtn = btn('', async () => {
        if (rec && rec.state === 'recording') { stopRecording(); return; }
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) throw new Error('التسجيل الصوتي غير متاح على هذا الجهاز');
          stopPreview();
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m)), chunks = [], started = Date.now();
          rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
          rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
          rec.onstop = async () => {
            stream.getTracks().forEach(tr => tr.stop()); recBtn.classList.remove('rec'); recBtn.textContent = ''; recBtn.append(...recContent());
            try { await setAudio(new Blob(chunks, { type: rec.mimeType || mime || 'audio/mp4' }), 'تسجيل صوتي', Math.max(1, Math.round((Date.now() - started) / 1000))); refresh(); showPanel(); } catch (err) { toast(err.message); }
          };
          rec.start(); recBtn.classList.add('rec'); recBtn.textContent = 'إيقاف التسجيل'; recTimer = setTimeout(stopRecording, MAX_RECORD * 1000);
        } catch (err) { toast(err.message || 'تعذّر فتح المايكروفون'); }
      });
      const recContent = () => { const wrap = document.createDocumentFragment(); const s = mk('span', '', icon('mic', 20)); wrap.append(s, document.createTextNode(' تسجيل صوتك')); return wrap.childNodes; };
      recBtn.append(...recContent());
      const picker = mk('input'); picker.type = 'file'; picker.accept = 'audio/*'; picker.hidden = true;
      picker.onchange = async () => { const f = picker.files[0]; picker.value = ''; if (!f) return; try { await setAudio(f, f.name.replace(/\.[^.]+$/, ''), 0); refresh(); showPanel(); } catch (err) { toast(err.message); } };
      const pick = btn('', () => picker.click()); pick.append(mk('span', '', icon('file', 20)), document.createTextNode(' ملف صوتي'));
      row.append(recBtn, pick, picker);
      if (st.audio) {
        const play = iconBtn('play', 'معاينة الصوت', () => {
          if (previewAudio) { stopPreview(); return; }
          previewAudio = new Audio(URL.createObjectURL(st.audio.blob)); previewAudio.onended = stopPreview; previewAudio.play().catch(() => toast('تعذّر تشغيل الصوت'));
        });
        row.append(play, iconBtn('trash', 'إزالة الصوت', () => { stopPreview(); st.audio = null; showPanel(); }));
      }
      box.append(row, info);
      return box;
    }

    /* ----- location filters (place name, time, date, temperature) ----- */
    let geo = null;
    const getJson = async url => { const c = new AbortController(), t = setTimeout(() => c.abort(), 8000); try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('http'); return await r.json(); } finally { clearTimeout(t); } };
    async function locate() {
      if (geo) return geo;
      if (!navigator.geolocation) throw new Error('تحديد الموقع غير متاح على هذا الجهاز');
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, () => rej(new Error('اسمح للتطبيق بالوصول إلى الموقع من الإعدادات')), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }));
      const { latitude: lat, longitude: lon } = pos.coords; geo = { lat, lon };
      try { const g = await getJson('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=ar'); geo.place = g.city || g.locality || g.principalSubdivision || ''; geo.country = g.countryName || ''; } catch { /* name stays empty */ }
      return geo;
    }
    const addPill = (text, y) => { st.stickers.push({ e: text, pill: true, x: .5, y: y || .3, s: .055, r: 0 }); st.sel = st.stickers.length - 1; st.dirty = true; draw(); showPanel(); };
    function placePanel() {
      const box = mk('div', 'se-box'), row = mk('div', 'se-actions'), custom = mk('div', 'se-actions');
      const run = fn => async () => { try { await fn(); } catch (e) { toast(e.message || 'تعذّر تحديد الموقع'); } };
      const now = new Date();
      row.append(
        btn('📍 موقعي', run(async () => { const g = await locate(); if (!g.place) throw new Error('تعذّر معرفة اسم المكان'); addPill('📍 ' + g.place, .3); })),
        btn('🏙️ المدينة والدولة', run(async () => { const g = await locate(); if (!g.place) throw new Error('تعذّر معرفة اسم المكان'); addPill(g.place + (g.country ? '، ' + g.country : ''), .3); })),
        btn('🌡️ الحرارة', run(async () => { const g = await locate(); const w = await getJson('https://api.open-meteo.com/v1/forecast?latitude=' + g.lat + '&longitude=' + g.lon + '&current=temperature_2m'); const t = w && w.current && w.current.temperature_2m; if (typeof t !== 'number') throw new Error('تعذّر جلب الحرارة'); addPill(Math.round(t) + '° ' + (t >= 30 ? '☀️' : t <= 12 ? '❄️' : '🌤️'), .22); })),
        btn('🕒 الوقت', () => addPill(now.toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' }), .22)),
        btn('📅 التاريخ', () => addPill(now.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' }), .22))
      );
      const field = mk('input'); field.maxLength = 40; field.placeholder = 'اكتب اسم مكان…'; field.setAttribute('aria-label', 'اسم مكان مخصص');
      custom.append(field, btn('إضافة', () => { const v = field.value.trim(); if (v) { addPill('📍 ' + v, .3); } }));
      box.append(row, custom, mk('p', 'se-hint', 'اسحب الملصق لتحريكه وقرّب بإصبعين لتكبيره'));
      return box;
    }

    const PANELS = { text: textPanel, draw: drawPanel, sticker: stickerPanel, crop: cropPanel, adjust: adjustPanel, music: audioPanel, place: placePanel };
    const TOOLS = [['text', 'نص'], ['draw', 'رسم'], ['sticker', 'ملصقات'], ['place', 'فلاتر الموقع'], ['crop', 'قص وتدوير'], ['music', 'موسيقى وصوت'], ['adjust', 'تعديل وفلاتر']];
    TOOLS.forEach(([key, label]) => { const b = mk('button', 'se-tool', icon(key === 'music' ? 'music' : key, 24)); b.type = 'button'; b.dataset.tool = key; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', 'false'); b.onclick = () => setTool(tool === key ? null : key); toolsEl.append(b); });
    function showPanel() {
      panel.replaceChildren();
      if (!tool) { panel.hidden = true; return; }
      panel.append(PANELS[tool]()); panel.hidden = false;
    }
    function setTool(key) {
      if (rec && rec.state === 'recording') stopRecording();
      stopPreview(); tool = key; mode = null;
      toolsEl.querySelectorAll('.se-tool').forEach(b => { const on = b.dataset.tool === key; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      root.classList.toggle('drawing', key === 'draw'); root.classList.toggle('cropping', key === 'crop');
      showPanel();
      if (key === 'text') { const ta = panel.querySelector('textarea'); if (ta) setTimeout(() => ta.focus(), 50); }
    }

    /* ----- export / publish ----- */
    async function exportImage() {
      await ensureFont(st.text);
      const c = document.createElement('canvas'); c.width = EW; c.height = EH;
      drawBase(c.getContext('2d', { willReadFrequently: true }), EW, EH, st.base, st.view); grade(c, st); overlay(c.getContext('2d'), EW, EH, false);
      const data = c.toDataURL('image/jpeg', .85); if (data.length > 5 * 1024 * 1024) throw new Error('الصورة كبيرة، اختر صورة أصغر');
      return { canvas: c, data };
    }
    function setBusy(on, text) { busyEl.hidden = !on; busyEl.textContent = text || ''; root.classList.toggle('busy', !!on); }
    root.querySelector('.se-post').onclick = async () => {
      if (!st || root.classList.contains('busy')) return;
      setBusy(true, 'جاري التجهيز…');
      try {
        const { data } = await exportImage();
        const payload = { image: data };
        if (st.audio) { payload.audio = st.audio.dataUrl; payload.audioDur = st.audio.dur; }
        await hooks.onPublish(payload);
      } catch (e) { setBusy(false); toast(e.message || 'تعذّر النشر'); }
    };
    root.querySelector('.se-save').onclick = async () => {
      if (!st) return;
      try {
        const { canvas } = await exportImage();
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', .9)), file = new File([blob], 'story.jpg', { type: 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); }
        else toast('الحفظ في الجهاز غير متاح هنا');
      } catch (e) { if (e && e.name !== 'AbortError') toast('تعذّر الحفظ'); }
    };
    root.querySelector('.se-close').onclick = () => {
      const dirty = st && (st.dirty || st.text.value.trim() || st.filter !== 'none');
      if (dirty && !confirm('تجاهل التعديلات والعودة؟')) return;
      api.close(); if (hooks.onExit) hooks.onExit();
    };

    const api = {
      get active() { return !root.hidden; },
      open(base) {
        st = newState(base); reported = false; tool = null; textBox = null; mode = null; ptrs.clear();
        graded = document.createElement('canvas'); graded.width = PW; graded.height = PH;
        root.hidden = false; setBusy(false); setTool(null); regrade(); ensureFont(st.text).then(draw);
        host.classList.add('editing');
      },
      close() { stopPreview(); stopRecording(); root.hidden = true; host.classList.remove('editing'); setBusy(false); st = null; graded = null; tool = null; },
      busy: setBusy
    };
    return api;
  }
  return { create, FONTS, EMOJIS };
})();
