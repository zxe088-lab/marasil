/* Private photo stories. No storage credentials or public R2 URLs reach the app. */
'use strict';
window.BPBStories = (() => {
  const base = window.STORIES_URL || 'https://51-254-218-100.sslip.io/api/stories';
  let feed=[],offset=0,lastFetch=0,loading=false,account='',queue=[],position=0,sequence=0,blobUrl=null,timer=null,deadline=0,busy=false,focusBefore=null,open=false,menuItems=[],holding=false,holdTimer=0,ignoreClick=0,camStream=null,camFront=true,camToken=0,audioEl=null,audioUrl=null,muted=false,videoEl=null,videoDraft=null;
  /* الستوري اللي شفته: الإطار البنفسجي يختفي بعد المشاهدة (محفوظ في الجهاز) */
  const SEEN_KEY='bpb-seen-stories';let seen;try{seen=new Set(JSON.parse(localStorage.getItem(SEEN_KEY)||'[]'));}catch{seen=new Set();}
  function markSeen(id){if(!id||seen.has(id))return;seen.add(id);try{localStorage.setItem(SEEN_KEY,JSON.stringify([...seen].slice(-600)));}catch{}}
  const cache=new Map();const MAX_VIDEO=30*1024*1024,MAX_VIDEO_SEC=30;
  const withTimeout=(p,ms,msg)=>Promise.race([p,new Promise((_,no)=>setTimeout(()=>no(new Error(msg||'انتهت مهلة الاتصال')),ms))]);
  const now=()=>Date.now()+offset;
  const alive=s=>s && s.expiresAt>now();
  const strip=document.createElement('section');strip.className='stories-strip';strip.setAttribute('aria-label','الستوري');
  {const after=document.getElementById('t-updates'),menuEl=document.querySelector('#s-home .classic-menu');if(after&&after.parentNode)after.after(strip);else menuEl.prepend(strip);} /* خانة ستوري ثابتة تحت التحديثات */
  const modal=document.createElement('div');modal.className='story-modal';modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','الستوري');
  modal.innerHTML=`<div class="story-progress" aria-hidden="true"></div><header><strong class="story-name"></strong><button type="button" data-action="close" aria-label="إغلاق الستوري">×</button></header><div class="story-stage"><img alt="صورة الستوري"><button type="button" class="story-prev" aria-label="الستوري السابقة">‹</button><button type="button" class="story-next" aria-label="الستوري التالية">›</button><p class="story-status" role="status"></p></div><div class="story-tools"></div><form class="story-reply"><input maxlength="2000" placeholder="رد خاص على الستوري…" aria-label="الرد على الستوري"><button type="button" data-action="photo">صورة</button><button type="submit">إرسال</button></form>`;
  modal.insertAdjacentHTML('beforeend','<button type="button" class="story-dots" aria-label="خيارات الستوري" hidden>⋯</button><div class="story-menu" hidden><div class="story-menu-box"></div></div>');
  document.body.append(modal);
  modal.insertAdjacentHTML('beforeend','<div class="story-cam" hidden><video playsinline muted autoplay></video><div class="story-cam-bar"><button type="button" data-cam="gallery" aria-label="الاستوديو"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg><small>الاستوديو</small></button><button type="button" data-cam="shutter" aria-label="التقاط صورة"></button><button type="button" data-cam="flip" aria-label="قلب الكاميرا"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/></svg><small>قلب</small></button></div></div>');
  const cam=modal.querySelector('.story-cam'),camVideo=cam.querySelector('video');
  const dots=modal.querySelector('.story-dots'),menu=modal.querySelector('.story-menu'),menuBox=menu.querySelector('.story-menu-box');
  const img=modal.querySelector('img'),status=modal.querySelector('.story-status'),tools=modal.querySelector('.story-tools'),form=modal.querySelector('form'),input=form.querySelector('input');
  const picker=document.createElement('input');picker.type='file';picker.accept='image/*,video/*';picker.hidden=true;document.body.append(picker);
  const photoReply=document.createElement('input');photoReply.type='file';photoReply.accept='image/*';photoReply.hidden=true;document.body.append(photoReply);
  const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;return b;};
  function openMenu(){
    if(!menuItems.length)return;
    menuBox.replaceChildren(...menuItems.map(([label,fn,danger])=>{const b=button(label,()=>{menu.hidden=true;fn();});if(danger)b.className='danger';return b;}),button('إلغاء',()=>{menu.hidden=true;}));
    menu.hidden=false;menuBox.querySelector('button')?.focus();
  }
  dots.onclick=openMenu;menu.addEventListener('click',e=>{if(e.target===menu)menu.hidden=true;});
  function message(e){toast(e.message||'تعذّر الاتصال بخدمة الستوري');}
  async function api(suffix='',options={}) {
    const user=auth?.currentUser;if(!user)throw new Error('سجل الدخول أولًا');
    const token=await withTimeout(user.getIdToken(),15000,'تعذّر الاتصال، تأكد من الإنترنت'), controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),options.media?45000:30000);
    try{
      const response=await fetch(base+suffix,{...options,cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})}});
      if(!response.ok){let text='تعذّر الاتصال بخدمة الستوري';try{text=(await response.json()).error||text;}catch{}throw new Error(text);}
      if(auth.currentUser?.uid!==user.uid)throw new Error('تغيّر الحساب');
      if(options.media)return response.blob();return response.json();
    }catch(e){if(e.name==='AbortError')throw new Error('الاتصال بطيء، حاول مرة ثانية');throw e;}finally{clearTimeout(timeout);}
  }
  function stopAudio(){if(audioEl){audioEl.pause();audioEl.removeAttribute('src');audioEl=null;}if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null;}}
  function stopVideo(){if(videoEl){videoEl.pause();videoEl.removeAttribute('src');videoEl.load?.();videoEl.remove();videoEl=null;}}
  function clearMedia(){stopAudio();stopVideo();img.hidden=false;img.removeAttribute('src');if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=null;}
  function close(){editor.close();stopCamera();clearTimeout(holdTimer);holding=false;modal.classList.remove('holding');menu.hidden=true;dots.hidden=true;modal.classList.remove('viewing');sequence++;clearInterval(timer);timer=null;modal.hidden=true;clearMedia();videoDraft=null;form.reset();busy=false;focusBefore?.focus();paint();}
  function showModal(){focusBefore=document.activeElement;modal.hidden=false;modal.querySelector('[data-action="close"]').focus();}
  function circle(label,ring,child,fn,seenAll){
    const b=button('',fn);b.className='story-circle';b.setAttribute('aria-label',label);
    const r=document.createElement('span');r.className='story-ring'+(ring?'':' add')+(seenAll?' seen':'');r.append(child);
    const l=document.createElement('span');l.className='story-label';l.textContent=label;b.append(r,l);return b;
  }
  function paint(){
    const grouped=new Map();for(const s of feed.filter(alive)){if(s.owner!==uid && (!contacts[s.owner]||isBlocked(s.owner)))continue;if(!grouped.has(s.owner))grouped.set(s.owner,[]);grouped.get(s.owner).push(s);}
    const allSeen=o=>grouped.get(o).every(s=>seen.has(s.id));
    const owners=[...grouped.keys()].sort((x,y)=>((y===uid)-(x===uid))||(allSeen(x)-allSeen(y)));
    const head=document.createElement('button');head.type='button';head.className='classic-category story-category'+(open?' selected':'');head.setAttribute('aria-expanded',String(open));head.setAttribute('aria-label','ستوري');
    head.innerHTML='<span><span class="cl">ستوري</span> <span class="story-count"></span></span><span class="category-toggle" aria-hidden="true"></span>';
    head.querySelector('.story-count').textContent='('+owners.length+')';head.querySelector('.category-toggle').textContent=open?'−':'+';
    head.onclick=()=>{open=!open;paint();};
    const panel=document.createElement('div');panel.className='story-panel';panel.hidden=!open;
    const row=document.createElement('div');row.className='story-circles';
    const plus=document.createElement('span');plus.className='story-plus';plus.textContent='+';plus.setAttribute('aria-hidden','true');
    row.append(circle('إضافة ستوري',false,plus,()=>choose()));
    for(const owner of owners){const items=grouped.get(owner),done=allSeen(owner);row.append(circle(owner===uid?'أنت':nameOf(owner),true,avatar(owner,'sm'),()=>{queue=items;const first=items.findIndex(s=>!seen.has(s.id));position=first<0?0:first;showModal();view();},done));}
    panel.append(row);strip.replaceChildren(head,panel);
  }
  async function refresh(force=false){
    if(!auth?.currentUser||!me)return;
    if(account!==uid){account=uid;feed=[];lastFetch=0;close();}
    paint();if(loading||(!force&&Date.now()-lastFetch<30000))return;loading=true;lastFetch=Date.now();const current=uid;
    try{const data=await api();if(uid!==current)return;offset=data.serverNow-Date.now();feed=data.stories;paint();}
    catch(e){if(!feed.length){const retry=button('الستوري غير متاح · إعادة المحاولة',()=>refresh(true));retry.className='story-retry';strip.append(retry);}}
    finally{loading=false;}
  }
  function stopCamera(){
    camToken++;if(camStream)camStream.getTracks().forEach(tr=>tr.stop());camStream=null;camVideo.srcObject=null;
    modal.classList.remove('camera');cam.hidden=true;
  }
  /* الضغط على «إضافة ستوري» يفتح الكاميرا الأمامية مباشرة؛ الاستوديو زر جانبي، وإن تعذّرت الكاميرا تظهر الأزرار القديمة */
  async function openCamera(){
    const token=++camToken;
    if(camStream){camStream.getTracks().forEach(tr=>tr.stop());camStream=null;}
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){status.textContent='الكاميرا غير متاحة، اختر من الأسفل';return;}
    modal.classList.add('camera');cam.hidden=false;camVideo.classList.toggle('mirror',camFront);
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:camFront?'user':{ideal:'environment'},width:{ideal:1080},height:{ideal:1920}},audio:false});
      if(token!==camToken||modal.hidden){stream.getTracks().forEach(tr=>tr.stop());return;}
      camStream=stream;camVideo.srcObject=stream;camVideo.classList.toggle('mirror',camFront);
      try{await camVideo.play();}catch{}
    }catch(e){
      if(token!==camToken)return;
      modal.classList.remove('camera');cam.hidden=true;status.textContent='تعذّر فتح الكاميرا (تحقق من الصلاحيات) · اختر من الأسفل';
    }
  }
  function snap(){
    if(!camStream||!camVideo.videoWidth)return;
    const W=1080,H=1920,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
    const vw=camVideo.videoWidth,vh=camVideo.videoHeight,scale=Math.max(W/vw,H/vh),w=vw*scale,h=vh*scale;
    ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
    if(camFront){ctx.translate(W,0);ctx.scale(-1,1);}
    ctx.drawImage(camVideo,(W-w)/2,(H-h)/2,w,h);
    startEdit(canvas);
  }
  cam.querySelector('[data-cam="shutter"]').onclick=snap;
  cam.querySelector('[data-cam="flip"]').onclick=()=>{camFront=!camFront;openCamera();};
  cam.querySelector('[data-cam="gallery"]').onclick=()=>{picker.accept='image/*,video/*';picker.removeAttribute('capture');picker.click();};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!modal.hidden&&modal.classList.contains('camera')&&(!camStream||camStream.getVideoTracks().every(tr=>tr.readyState!=='live')))openCamera();});
  function choose(){
    modal.classList.remove('viewing','holding');holding=false;dots.hidden=true;menu.hidden=true;showModal();clearMedia();form.hidden=true;tools.replaceChildren();status.textContent='صورة أو فيديو (حتى 30 ثانية) للأصدقاء فقط · يختفي بعد 24 ساعة';modal.querySelector('.story-name').textContent='إضافة ستوري';
    modal.querySelector('.story-progress').replaceChildren();modal.querySelectorAll('.story-prev,.story-next').forEach(b=>b.hidden=true);
    tools.append(button('التقاط صورة',()=>{picker.accept='image/*';picker.setAttribute('capture','user');picker.click();}),button('اختيار من الألبوم',()=>{picker.accept='image/*,video/*';picker.removeAttribute('capture');picker.click();}),button('تصوير فيديو',()=>{picker.accept='video/*';picker.setAttribute('capture','user');picker.click();}));
    openCamera();
  }
  async function withImage(file,use){
    if(!file.type.startsWith('image/')||file.size>20*1024*1024)throw new Error('اختر صورة أصغر من 20 ميجابايت');
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;await image.decode();
      if(image.naturalWidth*image.naturalHeight>25000000)throw new Error('أبعاد الصورة كبيرة جدًا');
      const result=use(image);image.removeAttribute('src');return result;
    }finally{URL.revokeObjectURL(url);}
  }
  /* الستوري بحجم شاشة الآيفون كاملة (9:16): الصورة تُقصّ لتملأ الشاشة */
  const load=file=>withImage(file,image=>{
    const W=1080,H=1920,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
    const iw=image.naturalWidth,ih=image.naturalHeight,ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
    const portrait=Math.abs(iw/ih-W/H)<0.12&&iw>=540;
    if(portrait){const scale=Math.max(W/iw,H/ih),w=iw*scale,h=ih*scale;ctx.drawImage(image,(W-w)/2,(H-h)/2,w,h);return canvas;}
    /* صورة مربعة أو صغيرة أو عرضية: تظهر كاملة بحجمها (بدون تكبير) في الوسط */
    /* الفراغ فوق وتحت الصورة أسود */
    ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
    const fit=Math.min(W*0.94/iw,H*0.8/ih,1),w=iw*fit,h=ih*fit;ctx.imageSmoothingQuality='high';ctx.drawImage(image,(W-w)/2,(H-h)/2,w,h);return canvas;
  });
  const compress=file=>withImage(file,image=>{
    const scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/jpeg',.85);if(data.length>5*1024*1024)throw new Error('الصورة كبيرة، اختر صورة أصغر');return data;
  });
  /* محرر الستوري (شبيه بسناب شات) في story-editor.js */
  const editor=window.BPBStoryEditor.create({host:modal,toast:t=>toast(t),onPublish:publish,onExit:()=>choose()});
  function startEdit(base){
    stopCamera();
    try{img.removeAttribute('src');editor.open(base);status.textContent='';}
    catch(e){console.error('story editor',e);editor.close();message(e);choose();}
  }
  picker.onchange=async()=>{
    const file=picker.files[0];picker.value='';picker.accept='image/*,video/*';if(!file)return;const seq=sequence;
    try{
      if(file.type.startsWith('video/')||/\.(mov|mp4|m4v)$/i.test(file.name||'')){await prepareVideo(file,seq);return;}
      const base=await load(file);if(seq!==sequence||modal.hidden)return;startEdit(base);
    }catch(e){message(e);}
  };
  /* فيديو الستوري: حتى 30 ثانية، نعرضه للمعاينة ثم ننشره مع صورة غلاف من أول لقطة */
  const fileData=blob=>new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=()=>no(new Error('تعذّر قراءة الفيديو'));fr.readAsDataURL(blob);});
  async function prepareVideo(file,seq){
    if(file.size>MAX_VIDEO)throw new Error('الفيديو كبير، اختر مقطع أقصر (أقل من 30 ميجا)');
    stopCamera();clearMedia();tools.replaceChildren();status.textContent='جاري تجهيز الفيديو…';
    const url=URL.createObjectURL(file),v=document.createElement('video');v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');v.preload='auto';v.src=url;
    try{
      await withTimeout(new Promise((ok,no)=>{v.onloadeddata=ok;v.onerror=()=>no(new Error('صيغة الفيديو غير مدعومة'));}),20000,'تعذّر فتح الفيديو');
      if(!isFinite(v.duration)||v.duration>MAX_VIDEO_SEC+0.5)throw new Error('الفيديو لازم يكون 30 ثانية أو أقل');
      await new Promise(ok=>{v.onseeked=ok;try{v.currentTime=Math.min(0.1,v.duration/2);}catch{ok();}setTimeout(ok,1500);});
      const W=1080,H=1920,c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
      const sc=Math.max(W/(v.videoWidth||W),H/(v.videoHeight||H)),w=(v.videoWidth||W)*sc,h=(v.videoHeight||H)*sc;try{ctx.drawImage(v,(W-w)/2,(H-h)/2,w,h);}catch{}
      const poster=c.toDataURL('image/jpeg',.8),data=await fileData(file);
      if(seq!==sequence||modal.hidden){URL.revokeObjectURL(url);return;}
      videoDraft={poster,data,dur:Math.round(v.duration*10)/10,url};
      v.muted=false;v.loop=true;v.controls=false;v.className='story-video';img.hidden=true;videoEl=v;modal.querySelector('.story-stage').prepend(v);v.currentTime=0;v.play().catch(()=>{v.muted=true;v.play().catch(()=>{});});
      status.textContent='معاينة الفيديو · '+Math.round(v.duration)+' ث';
      const pub=button('نشر الفيديو',()=>publishVideo());pub.className='primary';
      tools.append(pub,button('إلغاء',()=>{URL.revokeObjectURL(url);videoDraft=null;choose();}));
    }catch(e){URL.revokeObjectURL(url);videoDraft=null;status.textContent='';throw e;}
  }
  async function publishVideo(){
    if(busy||!videoDraft)return;busy=true;const d=videoDraft;status.textContent='جاري رفع الفيديو…';tools.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{
      const out=await api('',{method:'POST',body:JSON.stringify({image:d.poster,video:d.data,videoDur:d.dur})});
      URL.revokeObjectURL(d.url);videoDraft=null;close();
      toast(out?.story?.video?'نُشر الفيديو للأصدقاء':'نُشر كصورة فقط: خدمة الستوري تحتاج تحديث لدعم الفيديو');await refresh(true);
    }catch(e){message(e);status.textContent='';tools.querySelectorAll('button').forEach(b=>b.disabled=false);}
    finally{busy=false;}
  }
  async function publish(payload){
    if(busy)return;busy=true;editor.busy(true,'جاري النشر…');
    try{await api('',{method:'POST',body:JSON.stringify(payload)});editor.close();close();toast('نُشر الستوري للأصدقاء');await refresh(true);}
    catch(e){editor.busy(false);throw e;}
    finally{busy=false;}
  }
  function move(n){position+=n;if(position<0)position=0;if(position>=queue.length){close();return;}view();}
  async function view(){
    clearInterval(timer);clearMedia();form.reset();tools.replaceChildren();menu.hidden=true;holding=false;stopCamera();modal.classList.remove('holding');modal.classList.add('viewing');const s=queue[position],seq=++sequence;if(!alive(s)){move(1);return;}
    form.hidden=s.owner===uid;status.textContent='جاري التحميل…';modal.querySelector('.story-name').textContent=nameOf(s.owner);
    modal.querySelectorAll('.story-prev,.story-next').forEach(b=>b.hidden=false);
    const progress=modal.querySelector('.story-progress');progress.replaceChildren(...queue.map((_,i)=>{const p=document.createElement('progress');p.max=1;p.value=i<position?1:0;return p;}));
    menuItems=s.owner===uid?[
      ['المشاهدات',async()=>{try{const data=await api('/'+s.id+'/views');if(seq!==sequence)return;status.textContent=data.viewers.length?data.viewers.map(v=>nameOf(v.uid)).join('، '):'لا توجد مشاهدات بعد';}catch(e){message(e);}}],
      ['حذف الستوري',async()=>{if(!confirm('حذف هذا الستوري؟'))return;try{await api('/'+s.id,{method:'DELETE'});close();await refresh(true);}catch(e){message(e);}},true]
    ]:[['إبلاغ',async()=>{const reason=prompt('سبب الإبلاغ عن الستوري');if(!reason)return;try{await api('/'+s.id+'/report',{method:'POST',body:JSON.stringify({reason})});toast('تم إرسال البلاغ');}catch(e){message(e);}},true]];
    dots.hidden=false;
    try{
      const kind=s.video?'video':'media',blob=await fetchMedia(s,kind);if(seq!==sequence||modal.hidden||!alive(s))return;
      blobUrl=URL.createObjectURL(blob);
      if(s.video){
        const v=document.createElement('video');v.className='story-video';v.playsInline=true;v.setAttribute('playsinline','');v.muted=muted;v.src=blobUrl;img.hidden=true;videoEl=v;modal.querySelector('.story-stage').prepend(v);
        await withTimeout(new Promise((ok,no)=>{v.onloadeddata=ok;v.onerror=()=>no(new Error('تعذّر تشغيل الفيديو'));}),20000,'تعذّر تشغيل الفيديو');
        if(seq!==sequence)return;v.play().catch(()=>{v.muted=true;v.play().catch(()=>{});});
        menuItems.unshift(['كتم / تشغيل الصوت',()=>{muted=!muted;if(videoEl)videoEl.muted=muted;}]);
      }else img.src=blobUrl;
      status.textContent='';markSeen(s.id);prefetch(position+1);
      const vdur=s.video?Math.min(MAX_VIDEO_SEC,(isFinite(videoEl?.duration)&&videoEl.duration)||s.videoDur||MAX_VIDEO_SEC):0;
      const span=s.video?vdur*1000+300:s.audio&&s.audioDur?Math.min(15000,Math.max(6000,s.audioDur*1000)):6000;deadline=Date.now()+span;
      if(s.audio){
        menuItems.unshift(['كتم / تشغيل الصوت',()=>{muted=!muted;if(audioEl)audioEl.muted=muted;}]);
        api('/'+s.id+'/audio',{media:true}).then(ab=>{if(seq!==sequence||modal.hidden)return;stopAudio();audioUrl=URL.createObjectURL(ab);audioEl=new Audio(audioUrl);audioEl.muted=muted;audioEl.loop=true;audioEl.play().catch(()=>{});}).catch(()=>{});
      }
      api('/'+s.id+'/views',{method:'POST'}).catch(()=>{});
      let frozen=false,left=span;
      timer=setInterval(()=>{
        if(!alive(s)){move(1);return;}
        const paused=busy||holding||!menu.hidden||document.activeElement===input||input.value;
        if(paused){if(!frozen){frozen=true;left=Math.max(0,deadline-Date.now());if(audioEl)audioEl.pause();if(videoEl)videoEl.pause();}deadline=Date.now()+left;return;}
        if(frozen&&audioEl)audioEl.play().catch(()=>{});if(frozen&&videoEl)videoEl.play().catch(()=>{});
        frozen=false;
        progress.children[position].value=1-Math.max(0,deadline-Date.now())/span;
        if(Date.now()>=deadline)move(1);
      },100);
    }catch(e){
      if(seq!==sequence)return;clearMedia();status.textContent=e.message||'تعذّر تحميل الستوري';
      tools.replaceChildren(button('إعادة المحاولة',()=>{cache.delete(s.id+':'+(s.video?'video':'media'));view();}),button('التالي',()=>move(1)));
    }
  }
  /* تحميل الوسائط مع ذاكرة مؤقتة ومحاولة ثانية تلقائية، عشان ما يعلق على «جاري التحميل» */
  async function fetchMedia(s,kind){
    const key=s.id+':'+kind;if(cache.has(key))return cache.get(key);
    let last;for(let i=0;i<2;i++){try{const b=await withTimeout(api('/'+s.id+'/'+kind,{media:true}),kind==='video'?60000:25000,'الاتصال بطيء، حاول مرة ثانية');cache.set(key,b);if(cache.size>24)cache.delete(cache.keys().next().value);return b;}catch(e){last=e;if(/انتهت|للأصدقاء/.test(e.message||''))break;}}
    throw last;
  }
  function prefetch(i){const n=queue[i];if(n&&alive(n))fetchMedia(n,n.video?'video':'media').catch(()=>{});}
  async function reply(image){
    const s=queue[position];if(busy||!alive(s))return;const text=input.value.trim();if(!image&&!text)return;busy=true;
    try{const data=await api('/'+s.id+'/reply',{method:'POST',body:JSON.stringify({text,...(image?{image}:{})})});close();await openChat(data.peer);notifyPush(data.chatId);toast('تم إرسال الرد في الدردشة');}catch(e){message(e);}finally{busy=false;}
  }
  form.onsubmit=e=>{e.preventDefault();reply();};
  photoReply.onchange=async()=>{const file=photoReply.files[0];photoReply.value='';if(!file)return;const seq=sequence;try{const data=await compress(file);if(seq!==sequence||modal.hidden)return;if(confirm('إرسال هذه الصورة كرد في الدردشة الخاصة؟'))await reply(data);}catch(e){message(e);}};
  modal.querySelector('[data-action="photo"]').onclick=()=>photoReply.click();
  modal.querySelector('[data-action="close"]').onclick=close;
  const go=n=>{if(Date.now()<ignoreClick)return;move(n);};
  modal.querySelector('.story-prev').onclick=()=>go(-1);modal.querySelector('.story-next').onclick=()=>go(1);
  let touchX=0;const stageEl=modal.querySelector('.story-stage');stageEl.addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX;},{passive:true});stageEl.addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientX-touchX;if(holding||Date.now()<ignoreClick)return;if(Math.abs(delta)>60)move(delta<0?1:-1);},{passive:true});
  /* ضغطة مطوّلة على الستوري تثبّته (يتوقف العدّاد وتختفي الأزرار) وتركها يكمل */
  const endHold=()=>{clearTimeout(holdTimer);if(holding){holding=false;ignoreClick=Date.now()+350;modal.classList.remove('holding');}};
  stageEl.addEventListener('pointerdown',()=>{if(!modal.classList.contains('viewing'))return;clearTimeout(holdTimer);holdTimer=setTimeout(()=>{holding=true;modal.classList.add('holding');},300);});
  for(const type of['pointerup','pointercancel','pointerleave'])stageEl.addEventListener(type,endHold);
  stageEl.addEventListener('contextmenu',e=>e.preventDefault());
  modal.addEventListener('keydown',e=>{
    if(e.key==='Escape'){close();return;}
    if(e.key==='Tab'){const nodes=[...modal.querySelectorAll('button,input')].filter(n=>!n.hidden&&n.offsetParent!==null);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)close();else refresh(true);});
  auth?.onAuthStateChanged(()=>{feed=[];lastFetch=0;account='';close();strip.replaceChildren();});
  setInterval(()=>{if(!document.hidden){paint();if(!$('s-home').hidden)refresh();}},15000);
  function renderReply(m,target){
    const quote=button('رد على ستوري',async()=>{if(!alive(m.story)){quote.textContent='انتهى الستوري';return;}queue=[m.story];position=0;showModal();view();});
    quote.className='story-quote';if(!alive(m.story))quote.textContent='انتهى الستوري';target.append(quote);
    if(m.text)target.append(document.createTextNode(m.text));
    if(typeof m.image==='string'&&m.image.length<700000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(m.image)){const photo=document.createElement('img');photo.className='story-reply-image';photo.alt='صورة رد على الستوري';photo.src=m.image;target.append(photo);}
  }
  return {refresh,renderReply};
})();
