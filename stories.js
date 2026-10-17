/* Private photo stories. No storage credentials or public R2 URLs reach the app. */
'use strict';
window.BPBStories = (() => {
  const base = window.STORIES_URL || 'https://51-254-218-100.sslip.io/api/stories';
  let feed=[],offset=0,lastFetch=0,loading=false,account='',queue=[],position=0,sequence=0,blobUrl=null,timer=null,deadline=0,busy=false,preview=null,focusBefore=null,editCanvas=null,open=false,menuItems=[];
  const now=()=>Date.now()+offset;
  const alive=s=>s && s.expiresAt>now();
  const strip=document.createElement('section');strip.className='stories-strip';strip.setAttribute('aria-label','الستوري');
  document.querySelector('#s-home .classic-menu').prepend(strip);
  const modal=document.createElement('div');modal.className='story-modal';modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','الستوري');
  modal.innerHTML=`<div class="story-progress" aria-hidden="true"></div><header><strong class="story-name"></strong><button type="button" data-action="close" aria-label="إغلاق الستوري">×</button></header><div class="story-stage"><img alt="صورة الستوري"><button type="button" class="story-prev" aria-label="الستوري السابقة">‹</button><button type="button" class="story-next" aria-label="الستوري التالية">›</button><p class="story-status" role="status"></p></div><div class="story-tools"></div><form class="story-reply"><input maxlength="2000" placeholder="رد خاص على الستوري…" aria-label="الرد على الستوري"><button type="button" data-action="photo">صورة</button><button type="submit">إرسال</button></form>`;
  modal.insertAdjacentHTML('beforeend','<button type="button" class="story-dots" aria-label="خيارات الستوري" hidden>⋯</button><div class="story-menu" hidden><div class="story-menu-box"></div></div>');
  document.body.append(modal);
  const dots=modal.querySelector('.story-dots'),menu=modal.querySelector('.story-menu'),menuBox=menu.querySelector('.story-menu-box');
  const img=modal.querySelector('img'),status=modal.querySelector('.story-status'),tools=modal.querySelector('.story-tools'),form=modal.querySelector('form'),input=form.querySelector('input');
  editCanvas=document.createElement('canvas');editCanvas.className='story-edit';editCanvas.hidden=true;editCanvas.setAttribute('aria-label','معاينة الستوري');modal.querySelector('.story-stage').prepend(editCanvas);
  const picker=document.createElement('input');picker.type='file';picker.accept='image/*';picker.hidden=true;document.body.append(picker);
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
    const token=await user.getIdToken(), controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(base+suffix,{...options,cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})}});
      if(!response.ok){let text='تعذّر الاتصال بخدمة الستوري';try{text=(await response.json()).error||text;}catch{}throw new Error(text);}
      if(auth.currentUser?.uid!==user.uid)throw new Error('تغيّر الحساب');
      if(options.media)return response.blob();return response.json();
    }finally{clearTimeout(timeout);}
  }
  function clearMedia(){preview=null;editCanvas.hidden=true;tools.classList.remove('editing');img.removeAttribute('src');if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=null;}
  function close(){menu.hidden=true;dots.hidden=true;modal.classList.remove('viewing');sequence++;clearInterval(timer);timer=null;modal.hidden=true;clearMedia();preview=null;form.reset();busy=false;focusBefore?.focus();}
  function showModal(){focusBefore=document.activeElement;modal.hidden=false;modal.querySelector('[data-action="close"]').focus();}
  function circle(label,ring,child,fn){
    const b=button('',fn);b.className='story-circle';b.setAttribute('aria-label',label);
    const r=document.createElement('span');r.className='story-ring'+(ring?'':' add');r.append(child);
    const l=document.createElement('span');l.className='story-label';l.textContent=label;b.append(r,l);return b;
  }
  function paint(){
    const grouped=new Map();for(const s of feed.filter(alive)){if(s.owner!==uid && (!contacts[s.owner]||isBlocked(s.owner)))continue;if(!grouped.has(s.owner))grouped.set(s.owner,[]);grouped.get(s.owner).push(s);}
    const owners=[...grouped.keys()].sort((x,y)=>(y===uid)-(x===uid));
    const head=document.createElement('button');head.type='button';head.className='classic-category story-category'+(open?' selected':'');head.setAttribute('aria-expanded',String(open));head.setAttribute('aria-label','ستوري');
    head.innerHTML='<span><span class="cl">ستوري</span> <span class="story-count"></span></span><span class="category-toggle" aria-hidden="true"></span>';
    head.querySelector('.story-count').textContent='('+owners.length+')';head.querySelector('.category-toggle').textContent=open?'−':'+';
    head.onclick=()=>{open=!open;paint();};
    const panel=document.createElement('div');panel.className='story-panel';panel.hidden=!open;
    const row=document.createElement('div');row.className='story-circles';
    const plus=document.createElement('span');plus.className='story-plus';plus.textContent='+';plus.setAttribute('aria-hidden','true');
    row.append(circle('إضافة ستوري',false,plus,()=>choose()));
    for(const owner of owners){const items=grouped.get(owner);row.append(circle(owner===uid?'أنت':nameOf(owner),true,avatar(owner,'sm'),()=>{queue=items;position=0;showModal();view();}));}
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
  function choose(){
    modal.classList.remove('viewing');dots.hidden=true;menu.hidden=true;showModal();clearMedia();form.hidden=true;tools.replaceChildren();status.textContent='صورة للأصدقاء فقط · تختفي بعد 24 ساعة';modal.querySelector('.story-name').textContent='إضافة ستوري';
    modal.querySelector('.story-progress').replaceChildren();modal.querySelectorAll('.story-prev,.story-next').forEach(b=>b.hidden=true);
    tools.append(button('التقاط صورة',()=>{picker.setAttribute('capture','environment');picker.click();}),button('اختيار من الألبوم',()=>{picker.removeAttribute('capture');picker.click();}));
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
    const scale=Math.max(W/image.naturalWidth,H/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale,ctx=canvas.getContext('2d');
    ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);ctx.drawImage(image,(W-w)/2,(H-h)/2,w,h);return canvas;
  });
  const compress=file=>withImage(file,image=>{
    const scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/jpeg',.85);if(data.length>5*1024*1024)throw new Error('الصورة كبيرة، اختر صورة أصغر');return data;
  });
  /* تحرير الصورة: فلاتر بالبكسل (تعمل على كل الأجهزة) + نص قابل للسحب */
  const FILTERS=[['none','أصلي'],['bw','أبيض وأسود'],['sepia','سيبيا'],['vivid','حيوي'],['warm','دافئ'],['cool','بارد'],['fade','باهت'],['drama','درامي']];
  const PARAMS={none:{},bw:{s:0},sepia:{sepia:1},vivid:{s:1.45,c:1.1},warm:{m:[1.08,1,.9],b:6},cool:{m:[.9,1,1.1],b:4},fade:{c:.8,b:28,s:.85},drama:{c:1.35,s:.8,b:-12}};
  const COLORS=['#ffffff','#111111','#ffd400','#ff4d4d','#3ec9ff','#7dff7a'];
  function grade(canvas,filter,bright){
    if(filter==='none'&&!bright)return;
    const p=PARAMS[filter]||{},ctx=canvas.getContext('2d'),d=ctx.getImageData(0,0,canvas.width,canvas.height),a=d.data;
    const s=p.s??1,c=p.c??1,b=(p.b||0)+bright,m=p.m||[1,1,1];
    for(let i=0;i<a.length;i+=4){
      let r=a[i],g=a[i+1],bl=a[i+2];
      if(p.sepia){const R=.393*r+.769*g+.189*bl,G=.349*r+.686*g+.168*bl,B=.272*r+.534*g+.131*bl;r=R;g=G;bl=B;}
      else if(s!==1){const l=.299*r+.587*g+.114*bl;r=l+(r-l)*s;g=l+(g-l)*s;bl=l+(bl-l)*s;}
      if(c!==1){r=(r-128)*c+128;g=(g-128)*c+128;bl=(bl-128)*c+128;}
      a[i]=r*m[0]+b;a[i+1]=g*m[1]+b;a[i+2]=bl*m[2]+b;
    }
    ctx.putImageData(d,0,0);
  }
  function drawText(ctx,W,H,st){
    const raw=st.text.trim();if(!raw)return;
    const px=Math.round(W*st.size/100),family=getComputedStyle(document.body).fontFamily||'sans-serif';
    ctx.save();ctx.font='700 '+px+'px '+family;ctx.textAlign='center';ctx.textBaseline='middle';ctx.direction=/[؀-ۿ]/.test(raw)?'rtl':'ltr';
    const maxW=W*.86,lines=[];
    for(const para of raw.split(/\r?\n/)){let line='';for(const word of para.split(/\s+/).filter(Boolean)){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>maxW){lines.push(line);line=word;}else line=next;}lines.push(line);}
    const lh=px*1.35,top=st.y*H-lines.length*lh/2,cx=st.x*W;
    if(st.bg){
      let w=0;for(const l of lines)w=Math.max(w,Math.min(maxW,ctx.measureText(l).width));
      const pad=px*.45,x=cx-w/2-pad,y=top-pad*.4,bw=w+pad*2,bh=lines.length*lh+pad*.8,r=Math.min(px*.5,bh/2);
      ctx.fillStyle='rgba(0,0,0,.58)';ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+bw,y,x+bw,y+bh,r);ctx.arcTo(x+bw,y+bh,x,y+bh,r);ctx.arcTo(x,y+bh,x,y,r);ctx.arcTo(x,y,x+bw,y,r);ctx.closePath();ctx.fill();
    }
    lines.forEach((l,i)=>{const y=top+lh*(i+.5);if(!st.bg){ctx.lineJoin='round';ctx.lineWidth=px*.14;ctx.strokeStyle='rgba(0,0,0,.65)';ctx.strokeText(l,cx,y);}ctx.fillStyle=st.color;ctx.fillText(l,cx,y);});
    ctx.restore();
  }
  let reported=false;
  function fault(e){console.error('story editor',e);if(!reported){reported=true;toast('تعذّر تطبيق التعديل: '+((e&&e.message)||e));}}
  function draw(){
    const st=preview;if(!st)return;
    try{
      const g=st.graded;
      if(editCanvas.width!==g.width||editCanvas.height!==g.height){editCanvas.width=g.width;editCanvas.height=g.height;}
      const ctx=editCanvas.getContext('2d');ctx.drawImage(g,0,0);drawText(ctx,g.width,g.height,st);
    }catch(e){fault(e);}
  }
  function regrade(){
    const st=preview;if(!st)return;
    try{
      const w=Math.min(st.base.width,540),g=st.graded;
      g.width=w;g.height=Math.round(w*st.base.height/st.base.width);g.getContext('2d',{willReadFrequently:true}).drawImage(st.base,0,0,g.width,g.height);grade(g,st.filter,st.bright);
    }catch(e){fault(e);}
    draw();
  }
  function exportImage(st){
    const c=document.createElement('canvas');c.width=st.base.width;c.height=st.base.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(st.base,0,0);grade(c,st.filter,st.bright);drawText(ctx,c.width,c.height,st);
    const data=c.toDataURL('image/jpeg',.85);if(data.length>5*1024*1024)throw new Error('الصورة كبيرة، اختر صورة أصغر');return data;
  }
  let dragging=false;
  const place=e=>{if(!preview)return;const r=editCanvas.getBoundingClientRect();preview.x=Math.min(.92,Math.max(.08,(e.clientX-r.left)/r.width));preview.y=Math.min(.95,Math.max(.05,(e.clientY-r.top)/r.height));draw();};
  editCanvas.addEventListener('pointerdown',e=>{if(!preview||!preview.text.trim())return;dragging=true;try{editCanvas.setPointerCapture(e.pointerId);}catch{}place(e);});
  editCanvas.addEventListener('pointermove',e=>{if(dragging)place(e);});
  for(const type of['pointerup','pointercancel'])editCanvas.addEventListener(type,()=>{dragging=false;});
  function editor(){
    const box=document.createElement('div');box.className='story-editor';
    const filters=document.createElement('div');filters.className='story-filters';filters.setAttribute('aria-label','الفلاتر');
    const mark=()=>filters.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.filter===preview.filter));
    for(const [key,label]of FILTERS){const b=button(label,()=>{preview.filter=key;regrade();mark();});b.dataset.filter=key;filters.append(b);}
    mark();
    const text=document.createElement('textarea');text.rows=2;text.maxLength=200;text.placeholder='اكتب أو الصق نصًا على الصورة…';text.setAttribute('aria-label','نص على الصورة');
    text.addEventListener('focus',()=>{for(const ms of[100,350])setTimeout(()=>{modal.scrollTop=0;window.scrollTo(0,0);},ms);});
    text.oninput=()=>{preview.text=text.value;status.textContent=text.value.trim()?'اسحب النص لتحريكه':'';draw();};
    const colors=document.createElement('div');colors.className='story-colors';colors.setAttribute('aria-label','لون النص');
    const paintColors=()=>colors.querySelectorAll('.story-swatch').forEach(b=>b.classList.toggle('on',b.dataset.color===preview.color));
    for(const color of COLORS){const b=button('',()=>{preview.color=color;paintColors();draw();});b.className='story-swatch';b.dataset.color=color;b.style.background=color;b.setAttribute('aria-label','لون '+color);colors.append(b);}
    paintColors();
    const smaller=button('A−',()=>{preview.size=Math.max(3,preview.size-1);draw();}),bigger=button('A+',()=>{preview.size=Math.min(16,preview.size+1);draw();});
    smaller.setAttribute('aria-label','تصغير النص');bigger.setAttribute('aria-label','تكبير النص');
    const bg=button('خلفية',()=>{preview.bg=!preview.bg;bg.classList.toggle('on',preview.bg);draw();});bg.setAttribute('aria-label','خلفية خلف النص');
    colors.append(smaller,bigger,bg);
    const light=document.createElement('label');light.className='story-light';light.append('السطوع ');
    const range=document.createElement('input');range.type='range';range.min='-60';range.max='60';range.value='0';range.setAttribute('aria-label','السطوع');let frame=0;range.oninput=()=>{if(!preview)return;preview.bright=Number(range.value);if(frame)return;frame=requestAnimationFrame(()=>{frame=0;regrade();});};light.append(range);
    const actions=document.createElement('div');actions.className='story-actions';actions.append(button('نشر الستوري',publish),button('اختيار صورة أخرى',choose));
    box.append(filters,text,colors,light,actions);return box;
  }
  function startEdit(base){
    reported=false;
    preview={base,filter:'none',bright:0,text:'',color:'#ffffff',size:7,x:.5,y:.5,bg:false,graded:document.createElement('canvas')};
    try{img.removeAttribute('src');editCanvas.hidden=false;regrade();tools.classList.add('editing');tools.replaceChildren(editor());status.textContent='';}
    catch(e){console.error('story editor',e);message(e);choose();}
  }
  picker.onchange=async()=>{
    const file=picker.files[0];picker.value='';if(!file)return;const seq=sequence;
    try{const base=await load(file);if(seq!==sequence||modal.hidden)return;startEdit(base);}catch(e){message(e);}
  };
  async function publish(){if(busy||!preview)return;busy=true;status.textContent='جاري النشر…';try{await api('',{method:'POST',body:JSON.stringify({image:exportImage(preview)})});close();toast('نُشر الستوري للأصدقاء');await refresh(true);}catch(e){message(e);status.textContent='تعذّر النشر، حاول مجددًا';}finally{busy=false;}}
  function move(n){position+=n;if(position<0)position=0;if(position>=queue.length){close();return;}view();}
  async function view(){
    clearInterval(timer);clearMedia();preview=null;form.reset();tools.replaceChildren();menu.hidden=true;modal.classList.add('viewing');const s=queue[position],seq=++sequence;if(!alive(s)){move(1);return;}
    form.hidden=s.owner===uid;status.textContent='جاري التحميل…';modal.querySelector('.story-name').textContent=nameOf(s.owner);
    modal.querySelectorAll('.story-prev,.story-next').forEach(b=>b.hidden=false);
    const progress=modal.querySelector('.story-progress');progress.replaceChildren(...queue.map((_,i)=>{const p=document.createElement('progress');p.max=1;p.value=i<position?1:0;return p;}));
    menuItems=s.owner===uid?[
      ['المشاهدات',async()=>{try{const data=await api('/'+s.id+'/views');if(seq!==sequence)return;status.textContent=data.viewers.length?data.viewers.map(v=>nameOf(v.uid)).join('، '):'لا توجد مشاهدات بعد';}catch(e){message(e);}}],
      ['حذف الستوري',async()=>{if(!confirm('حذف هذا الستوري؟'))return;try{await api('/'+s.id,{method:'DELETE'});close();await refresh(true);}catch(e){message(e);}},true]
    ]:[['إبلاغ',async()=>{const reason=prompt('سبب الإبلاغ عن الستوري');if(!reason)return;try{await api('/'+s.id+'/report',{method:'POST',body:JSON.stringify({reason})});toast('تم إرسال البلاغ');}catch(e){message(e);}},true]];
    dots.hidden=false;
    try{
      const blob=await api('/'+s.id+'/media',{media:true});if(seq!==sequence||modal.hidden||!alive(s))return;
      blobUrl=URL.createObjectURL(blob);img.src=blobUrl;status.textContent='';deadline=Date.now()+6000;
      api('/'+s.id+'/views',{method:'POST'}).catch(()=>{});
      timer=setInterval(()=>{
        if(!alive(s)){move(1);return;}
        const paused=busy||!menu.hidden||document.activeElement===input||input.value;
        if(paused){deadline=Date.now()+6000;return;}
        progress.children[position].value=1-Math.max(0,deadline-Date.now())/6000;
        if(Date.now()>=deadline)move(1);
      },100);
    }catch(e){if(seq===sequence){status.textContent=e.message;clearMedia();}}
  }
  async function reply(image){
    const s=queue[position];if(busy||!alive(s))return;const text=input.value.trim();if(!image&&!text)return;busy=true;
    try{const data=await api('/'+s.id+'/reply',{method:'POST',body:JSON.stringify({text,...(image?{image}:{})})});close();await openChat(data.peer);notifyPush(data.chatId);toast('تم إرسال الرد في الدردشة');}catch(e){message(e);}finally{busy=false;}
  }
  form.onsubmit=e=>{e.preventDefault();reply();};
  photoReply.onchange=async()=>{const file=photoReply.files[0];photoReply.value='';if(!file)return;const seq=sequence;try{const data=await compress(file);if(seq!==sequence||modal.hidden)return;if(confirm('إرسال هذه الصورة كرد في الدردشة الخاصة؟'))await reply(data);}catch(e){message(e);}};
  modal.querySelector('[data-action="photo"]').onclick=()=>photoReply.click();
  modal.querySelector('[data-action="close"]').onclick=close;
  modal.querySelector('.story-prev').onclick=()=>move(-1);modal.querySelector('.story-next').onclick=()=>move(1);
  let touchX=0;const stageEl=modal.querySelector('.story-stage');stageEl.addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX;},{passive:true});stageEl.addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientX-touchX;if(Math.abs(delta)>60)move(delta<0?1:-1);},{passive:true});
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
