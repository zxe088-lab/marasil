/* Private photo stories. No storage credentials or public R2 URLs reach the app. */
'use strict';
window.BPBStories = (() => {
  const base = window.STORIES_URL || 'https://51-254-218-100.sslip.io/api/stories';
  let feed=[],offset=0,lastFetch=0,loading=false,account='',queue=[],position=0,sequence=0,blobUrl=null,timer=null,deadline=0,busy=false,preview=null,focusBefore=null;
  const now=()=>Date.now()+offset;
  const alive=s=>s && s.expiresAt>now();
  const strip=document.createElement('section');strip.className='stories-strip';strip.setAttribute('aria-label','اليوميات');
  document.querySelector('#s-home .classic-menu').prepend(strip);
  const modal=document.createElement('div');modal.className='story-modal';modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','اليوميات');
  modal.innerHTML=`<div class="story-progress" aria-hidden="true"></div><header><strong class="story-name"></strong><button type="button" data-action="close" aria-label="إغلاق اليومية">×</button></header><div class="story-stage"><img alt="صورة اليومية"><button type="button" class="story-prev" aria-label="اليومية السابقة">‹</button><button type="button" class="story-next" aria-label="اليومية التالية">›</button><p class="story-status" role="status"></p></div><div class="story-tools"></div><form class="story-reply"><input maxlength="2000" placeholder="رد خاص على اليومية…" aria-label="الرد على اليومية"><button type="button" data-action="photo">صورة</button><button type="submit">إرسال</button></form>`;
  document.body.append(modal);
  const img=modal.querySelector('img'),status=modal.querySelector('.story-status'),tools=modal.querySelector('.story-tools'),form=modal.querySelector('form'),input=form.querySelector('input');
  const picker=document.createElement('input');picker.type='file';picker.accept='image/*';picker.hidden=true;document.body.append(picker);
  const photoReply=document.createElement('input');photoReply.type='file';photoReply.accept='image/*';photoReply.hidden=true;document.body.append(photoReply);
  const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;return b;};
  function message(e){toast(e.message||'تعذّر الاتصال بخدمة اليوميات');}
  async function api(suffix='',options={}) {
    const user=auth?.currentUser;if(!user)throw new Error('سجل الدخول أولًا');
    const token=await user.getIdToken(), controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(base+suffix,{...options,cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})}});
      if(!response.ok){let text='تعذّر الاتصال بخدمة اليوميات';try{text=(await response.json()).error||text;}catch{}throw new Error(text);}
      if(auth.currentUser?.uid!==user.uid)throw new Error('تغيّر الحساب');
      if(options.media)return response.blob();return response.json();
    }finally{clearTimeout(timeout);}
  }
  function clearMedia(){img.removeAttribute('src');if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=null;}
  function close(){sequence++;clearInterval(timer);timer=null;modal.hidden=true;clearMedia();preview=null;form.reset();busy=false;focusBefore?.focus();}
  function showModal(){focusBefore=document.activeElement;modal.hidden=false;modal.querySelector('[data-action="close"]').focus();}
  function paint(){
    strip.replaceChildren(button('＋ يومياتي',()=>choose()));
    const grouped=new Map();for(const s of feed.filter(alive)){if(s.owner!==uid && (!contacts[s.owner]||isBlocked(s.owner)))continue;if(!grouped.has(s.owner))grouped.set(s.owner,[]);grouped.get(s.owner).push(s);}
    for(const [owner,items]of grouped){const b=button('',()=>{queue=items;position=0;showModal();view();});b.className='story-circle';b.setAttribute('aria-label',owner===uid?'يومياتي':nameOf(owner));b.append(avatar(owner,'sm'));const label=document.createElement('span');label.textContent=owner===uid?'يومياتي':nameOf(owner);b.append(label);strip.append(b);}
  }
  async function refresh(force=false){
    if(!auth?.currentUser||!me)return;
    if(account!==uid){account=uid;feed=[];lastFetch=0;close();}
    paint();if(loading||(!force&&Date.now()-lastFetch<30000))return;loading=true;lastFetch=Date.now();const current=uid;
    try{const data=await api();if(uid!==current)return;offset=data.serverNow-Date.now();feed=data.stories;paint();}
    catch(e){if(!feed.length){const retry=button('اليوميات غير متاحة · إعادة المحاولة',()=>refresh(true));retry.className='story-retry';strip.append(retry);}}
    finally{loading=false;}
  }
  function choose(){
    showModal();clearMedia();form.hidden=true;tools.replaceChildren();status.textContent='صورة للأصدقاء فقط · تختفي بعد 24 ساعة';modal.querySelector('.story-name').textContent='إضافة يومية';
    modal.querySelector('.story-progress').replaceChildren();modal.querySelectorAll('.story-prev,.story-next').forEach(b=>b.hidden=true);
    tools.append(button('التقاط صورة',()=>{picker.setAttribute('capture','environment');picker.click();}),button('اختيار من الألبوم',()=>{picker.removeAttribute('capture');picker.click();}));
  }
  async function compress(file){
    if(!file.type.startsWith('image/')||file.size>20*1024*1024)throw new Error('اختر صورة أصغر من 20 ميجابايت');
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;await image.decode();
      if(image.naturalWidth*image.naturalHeight>25000000)throw new Error('أبعاد الصورة كبيرة جدًا');
      const scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/jpeg',.85);if(data.length>5*1024*1024)throw new Error('الصورة كبيرة، اختر صورة أصغر');return data;
    }finally{URL.revokeObjectURL(url);}
  }
  picker.onchange=async()=>{
    const file=picker.files[0];picker.value='';if(!file)return;const seq=sequence;
    try{const data=await compress(file);if(seq!==sequence||modal.hidden)return;preview=data;img.src=data;status.textContent='جاهزة للنشر · للأصدقاء فقط';tools.replaceChildren(button('نشر اليومية',publish),button('اختيار صورة أخرى',choose));}catch(e){message(e);}
  };
  async function publish(){if(busy||!preview)return;busy=true;status.textContent='جاري النشر…';try{await api('',{method:'POST',body:JSON.stringify({image:preview})});close();toast('نُشرت يوميتك للأصدقاء');await refresh(true);}catch(e){message(e);status.textContent='تعذّر النشر، حاول مجددًا';}finally{busy=false;}}
  function move(n){position+=n;if(position<0)position=0;if(position>=queue.length){close();return;}view();}
  async function view(){
    clearInterval(timer);clearMedia();preview=null;form.reset();tools.replaceChildren();const s=queue[position],seq=++sequence;if(!alive(s)){move(1);return;}
    form.hidden=s.owner===uid;status.textContent='جاري التحميل…';modal.querySelector('.story-name').textContent=nameOf(s.owner);
    modal.querySelectorAll('.story-prev,.story-next').forEach(b=>b.hidden=false);
    const progress=modal.querySelector('.story-progress');progress.replaceChildren(...queue.map((_,i)=>{const p=document.createElement('progress');p.max=1;p.value=i<position?1:0;return p;}));
    if(s.owner===uid){tools.append(button('المشاهدات',async()=>{try{const data=await api('/'+s.id+'/views');if(seq!==sequence)return;status.textContent=data.viewers.length?data.viewers.map(v=>nameOf(v.uid)).join('، '):'لا توجد مشاهدات بعد';}catch(e){message(e);}}),button('حذف اليومية',async()=>{if(!confirm('حذف هذه اليومية؟'))return;try{await api('/'+s.id,{method:'DELETE'});close();await refresh(true);}catch(e){message(e);}}));}
    else tools.append(button('إبلاغ',async()=>{const reason=prompt('سبب الإبلاغ عن اليومية');if(!reason)return;try{await api('/'+s.id+'/report',{method:'POST',body:JSON.stringify({reason})});toast('تم إرسال البلاغ');}catch(e){message(e);}}));
    try{
      const blob=await api('/'+s.id+'/media',{media:true});if(seq!==sequence||modal.hidden||!alive(s))return;
      blobUrl=URL.createObjectURL(blob);img.src=blobUrl;status.textContent='';deadline=Date.now()+6000;
      api('/'+s.id+'/views',{method:'POST'}).catch(()=>{});
      timer=setInterval(()=>{
        if(!alive(s)){move(1);return;}
        const paused=busy||document.activeElement===input||input.value;
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
  let touchX=0;img.addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX;},{passive:true});img.addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientX-touchX;if(Math.abs(delta)>60)move(delta<0?1:-1);},{passive:true});
  modal.addEventListener('keydown',e=>{
    if(e.key==='Escape'){close();return;}
    if(e.key==='Tab'){const nodes=[...modal.querySelectorAll('button,input')].filter(n=>!n.hidden&&n.offsetParent!==null);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)close();else refresh(true);});
  auth?.onAuthStateChanged(()=>{feed=[];lastFetch=0;account='';close();strip.replaceChildren();});
  setInterval(()=>{if(!document.hidden){paint();if(!$('s-home').hidden)refresh();}},15000);
  function renderReply(m,target){
    const quote=button('رد على يومية',async()=>{if(!alive(m.story)){quote.textContent='انتهت اليومية';return;}queue=[m.story];position=0;showModal();view();});
    quote.className='story-quote';if(!alive(m.story))quote.textContent='انتهت اليومية';target.append(quote);
    if(m.text)target.append(document.createTextNode(m.text));
    if(typeof m.image==='string'&&m.image.length<700000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(m.image)){const photo=document.createElement('img');photo.className='story-reply-image';photo.alt='صورة رد على اليومية';photo.src=m.image;target.append(photo);}
  }
  return {refresh,renderReply};
})();
