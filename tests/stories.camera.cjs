const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try{
 const context=await browser.newContext({permissions:['camera'],viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://app.test/**',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="s-home"><div class="classic-menu"></div></div><div id="quote"></div>'}));
 await page.goto('https://app.test/');
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
 await page.addScriptTag({content:fs.readFileSync('story-editor.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync('stories.js','utf8')});
 await page.evaluate(()=>BPBStories.refresh(true));
 await page.locator('.story-category').click();
 await page.getByRole('button',{name:'إضافة ستوري',exact:true}).click();
 // the front camera opens immediately
 await page.waitForFunction(()=>{const v=document.querySelector('.story-cam video');return v&&v.srcObject&&v.videoWidth>0;},{timeout:10000});
 assert.equal(await page.locator('.story-cam video').evaluate(v=>v.classList.contains('mirror')),true);
 // flip to the back camera and back again
 await page.getByRole('button',{name:'قلب الكاميرا'}).click();
 await page.waitForFunction(()=>{const v=document.querySelector('.story-cam video');return v&&v.srcObject&&v.videoWidth>0&&!v.classList.contains('mirror');},{timeout:10000});
 await page.getByRole('button',{name:'قلب الكاميرا'}).click();
 await page.waitForFunction(()=>document.querySelector('.story-cam video').classList.contains('mirror'),{timeout:10000});
 await page.waitForFunction(()=>document.querySelector('.story-cam video').videoWidth>0);
 fs.mkdirSync('browser-results',{recursive:true});await page.screenshot({path:'browser-results/camera.png'});
 const tracks=await page.evaluate(()=>{window.__s=document.querySelector('.story-cam video').srcObject;return window.__s.getTracks().length;});
 assert.ok(tracks>0);
 await page.getByRole('button',{name:'التقاط صورة',exact:true}).click();
 await page.getByRole('button',{name:'نشر الستوري',exact:true}).waitFor();
 // the camera is released once the photo is taken
 assert.equal(await page.evaluate(()=>window.__s.getTracks().every(t=>t.readyState==='ended')),true);
 assert.equal(await page.locator('.story-cam').isVisible(),false);
 // the gallery button is available from the camera
 await page.getByRole('button',{name:'إغلاق المحرر',exact:true}).click();
 await page.getByRole('button',{name:'الاستوديو'}).waitFor();
 await page.getByRole('button',{name:'إغلاق الستوري'}).click();
 assert.equal(await page.evaluate(()=>window.__s.getTracks().length>=0&&!document.querySelector('.story-cam video').srcObject),true);
 assert.deepEqual(errors,[]);console.log('Stories camera: front camera opens directly, flip, capture, release, gallery passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
