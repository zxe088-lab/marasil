const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="s-home"><div class="classic-menu"></div></div><div id="quote"></div>');
 await page.addStyleTag({content:fs.readFileSync('style.css','utf8')});
 await page.evaluate(()=>{
 window.uid='bob';window.me={name:'Bob'};window.contacts={alice:{}};
 window.$=id=>document.getElementById(id);window.nameOf=id=>id==='alice'?'صديق الاختبار':id;
 window.avatar=()=>{const e=document.createElement('span');e.className='avatar';e.textContent='B';return e;};window.isBlocked=()=>false;
 window.toast=text=>window.lastToast=text;window.openChat=async peer=>{window.openedPeer=peer;};window.notifyPush=id=>{window.notified=id;};
 window.auth={currentUser:{uid:'bob',getIdToken:async()=>'test-only'},onAuthStateChanged:()=>{}};
 window.calls=[];window.fetch=async(url,options)=>{
 window.calls.push({url,options});const now=Date.now();
 if(url.endsWith('/media'))return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}});
 if(url.endsWith('/reply'))return new Response(JSON.stringify({peer:'alice',chatId:'alice_bob'}));
 if(url.endsWith('/views'))return new Response('{}');
 return new Response(JSON.stringify({serverNow:now,stories:[{id:'story1',owner:'alice',createdAt:now-1000,expiresAt:now+86400000}]}));
 };
 });
 await page.addScriptTag({content:fs.readFileSync('stories.js','utf8')});
 await page.evaluate(()=>BPBStories.refresh(true));
 await page.locator('.story-category').click();
 await page.getByRole('button',{name:'صديق الاختبار',exact:true}).click();
 await page.getByPlaceholder('رد خاص على الستوري…').fill('جميلة الصورة');
 await page.getByRole('button',{name:'إرسال',exact:true}).click();
 await page.waitForFunction(()=>window.openedPeer==='alice');
 assert.equal(await page.evaluate(()=>window.notified),'alice_bob');
 const payload=await page.evaluate(()=>JSON.parse(window.calls.find(c=>c.url.endsWith('/reply')).options.body));
 assert.equal(payload.text,'جميلة الصورة');
 await page.evaluate(()=>BPBStories.renderReply({text:'رد سابق',story:{id:'old',owner:'alice',expiresAt:Date.now()-60000}},document.getElementById('quote')));
 assert.match(await page.locator('#quote').textContent(),/انتهى الستوري/);
 assert.equal(await page.locator('#quote img').count(),0);
 await page.getByRole('button',{name:'إضافة ستوري',exact:true}).click();
 await page.getByRole('button',{name:'اختيار من الألبوم',exact:true}).click();
 // A real decodable PNG exercises canvas resize, preview and publish.
 const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=900;const ctx=c.getContext('2d');ctx.fillStyle='#236989';ctx.fillRect(0,0,600,900);ctx.fillStyle='#fff';ctx.font='40px sans-serif';ctx.fillText('BPB Stories',160,450);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await page.locator('input[type=file]').first().setInputFiles({name:'test.png',mimeType:'image/png',buffer:png});
 await page.getByRole('button',{name:'نشر الستوري',exact:true}).waitFor();
 await page.getByLabel('نص على الصورة').fill('صباح الخير');
 for(const name of ['سيبيا','أبيض وأسود','درامي','أصلي'])await page.getByRole('button',{name,exact:true}).click();
 await page.getByRole('button',{name:'خلفية خلف النص',exact:true}).click();
 await page.locator('.story-light input').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('canvas.story-edit').click({position:{x:60,y:80}});
 fs.mkdirSync('browser-results',{recursive:true});await page.screenshot({path:'browser-results/stories-preview.png'});
 await page.getByRole('button',{name:'نشر الستوري',exact:true}).click();
 const sent=await page.evaluate(()=>JSON.parse(window.calls.filter(c=>c.options&&c.options.method==='POST'&&!/\/(reply|views|report)$/.test(c.url)).pop().options.body).image);
 assert.match(sent,/^data:image\/jpeg;base64,/);
 const dims=await page.evaluate(src=>new Promise(r=>{const i=new Image();i.onload=()=>r([i.naturalWidth,i.naturalHeight]);i.src=src;}),sent);
 assert.deepEqual(dims,[1080,1920]);
 await page.waitForFunction(()=>window.lastToast==='نُشر الستوري للأصدقاء');
 assert.equal(await page.locator('.story-modal').isVisible(),false);
 // Verify hard expiry removes the displayed image even while a reply input is focused.
 await page.evaluate(()=>{window.fetch=async(url,options)=>{if(url.endsWith('/media'))return new Response(new Uint8Array([1,2,3]));if(url.endsWith('/views'))return new Response('{}');return new Response(JSON.stringify({serverNow:Date.now(),stories:[{id:'short',owner:'alice',expiresAt:Date.now()+1000}]}));};return BPBStories.refresh(true);});
 await page.getByRole('button',{name:'صديق الاختبار',exact:true}).click();
 await page.getByPlaceholder('رد خاص على الستوري…').focus();
 await page.waitForFunction(()=>document.querySelector('.story-modal').hidden,{timeout:5000});
 assert.equal(await page.locator('.story-stage img').getAttribute('src'),null);
 assert.deepEqual(errors,[]);console.log('Stories browser: text reply, quote expiry, image publication, viewer expiry passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
