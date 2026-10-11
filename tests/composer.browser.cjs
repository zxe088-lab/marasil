// Isolated browser regression test: production markup/styles/controllers, no Firebase.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<link\b[^>]*>/g, '');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8').replace("url('blackberry-48.png')", "url('data:image/png;base64,"+fs.readFileSync(path.join(root,'blackberry-48.png')).toString('base64')+"')");
const viewportController = source.slice(source.indexOf('// One layout owner:'), source.indexOf('const COLORS'));
const composerController = source.slice(source.indexOf('let draftSticker = null;'), source.indexOf('\nboot();'));
const setup = `
  const $ = id => document.getElementById(id);
  document.querySelectorAll('#app > .view').forEach(e => e.hidden = e.id !== 's-chat');
  $('chName').textContent = 'اختبار المحادثة';
  $('chMsg').textContent = 'معاينة زر الإرسال';
  $('msgList').innerHTML = Array.from({length:40},(_,i)=>'<div class="bubble"><div class="content"><div class="txt">رسالة اختبار '+i+'</div></div></div>').join('');
  window.fakeViewport = new EventTarget();
  Object.assign(window.fakeViewport,{height:844,offsetTop:0,scale:1});
  Object.defineProperty(window,'visualViewport',{value:window.fakeViewport});
  window.sent = [];
  function sendMsg(data){window.sent.push(data);}
  let chatId = null, typingSent = 0;
  let uid='receiver';
  function toast(text){window.lastToast=text;}
  function renderChats(){}
  const EMOJIS = ['😊'];
  const el = (tag,cls,text) => {const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
`;
async function frame(page){
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
(async () => {
  fs.mkdirSync(path.join(root, 'browser-results'), { recursive: true });
  const browser = await chromium.launch(process.env.TEST_BROWSER_PATH ? {executablePath:process.env.TEST_BROWSER_PATH} : {});
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent(html);
    await page.addStyleTag({ content: style });
    await page.addScriptTag({ content: setup + viewportController + composerController });
    const input = page.locator('#msgInput'), face = page.locator('#faceBtn'), panel = page.locator('#facePanel');
    assert.equal(await page.locator('#voiceSendBtn').getAttribute('aria-label'), 'تسجيل صوتي');
    assert.equal(await face.isVisible(), true, 'Face button replaces send');
    assert.equal(await panel.isVisible(), false, 'Faces hidden at start');
    await input.fill('رسالة بلوحة المفاتيح');
    assert.equal(await page.locator('#voiceSendBtn').getAttribute('aria-label'), 'إرسال');
    await input.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.sent), [{ kind: 'text', text: 'رسالة بلوحة المفاتيح' }], 'Enter sends once');
    assert.equal(await input.inputValue(), '');
    await face.tap();
    assert.equal(await panel.isVisible(), true, 'Face button opens faces');
    await panel.locator('.face:not(.sticker-button)').first().tap();
    assert.equal(await input.inputValue(), '🙂', 'Tapping a face inserts it');
    await input.press('Enter');
    assert.equal(await page.evaluate(() => window.sent[1].text), '🙂');
    assert.equal(await panel.locator('.sticker-button').count(), 48);
    await panel.locator('.sticker-button').first().tap();
    assert.equal(await page.evaluate(() => window.sent.length), 2, 'Selecting sticker does not send');
    assert.equal(await page.locator('#stickerDraft').isVisible(), true);
    await input.fill('مع الملصق');
    await input.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.sent[2]), {kind:'sticker',sticker:0,text:'مع الملصق'});
    assert.equal(await page.locator('#stickerDraft').isVisible(), false);
    await face.tap();
    assert.equal(await panel.isVisible(), false, 'Face button closes faces');
    assert.equal(await page.locator('#pingBtn').isVisible(), true, 'Ping is retained');
    await input.fill('اختبار لوحة المفاتيح');
    await face.tap();
    await panel.locator('.sticker-button').first().tap();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [height, top, native] of [[844,0,false],[440,64,false],[410,105,false],[450,0,true]]) {
        await page.evaluate(({height,top,native}) => {
          Object.assign(window.fakeViewport,{height,offsetTop:top});
          window.dispatchEvent(new Event(native ? 'keyboardWillShow' : 'keyboardDidHide'));
          window.fakeViewport.dispatchEvent(new Event('scroll'));
        }, {height,top,native});
        await frame(page);
        const layout = await page.evaluate(() => {
          const rect = id => {const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
          
          return {app:rect('app'),input:rect('msgInput'),send:rect('faceBtn'),ping:rect('pingBtn'),list:rect('msgList'),
            rootScroll:document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight};
        });
        assert.equal(layout.app.top, top); assert.equal(layout.app.height, height);
        assert.equal(layout.send.width, 38); assert.equal(layout.send.height, 42);
        assert.ok(layout.send.left >= layout.input.right && layout.send.left - layout.input.right <= 9, 'Face sits inside input on right');
        assert.ok(layout.ping.right <= layout.input.left, 'Ping sits left of input');
        assert.ok(layout.send.bottom <= top+height && layout.ping.bottom <= top+height);
        assert.ok(layout.input.bottom <= top+height && layout.list.height > 0);
        assert.equal(layout.rootScroll, 0, 'No document scroll');
        assert.ok(layout.input.width > 60, 'Writing area remains usable');
        await page.screenshot({path:path.join(root,'browser-results',`composer-${width}-${height}-${top}.png`)});
        console.log(`PASS composer layout ${width}px, visible height ${height}, top ${top}`);
      }
    }
    await page.evaluate(() => {document.getElementById('composer').hidden=true;updateComposer();});
    await page.evaluate(() => sendText());
    assert.equal(await page.evaluate(() => window.sent.length), 3, 'Blocked composer cannot send');
    await page.evaluate(() => {
      document.getElementById('composer').hidden=false;chatId='demo';
      window.photoExists=true;window.photoOperations=[];
      window.fs={doc:path=>({path}),runTransaction:async fn=>fn({
        get:async ref=>ref.path.includes('/messages/')?{exists:true,data:()=>({opened:false})}:{exists:window.photoExists,data:()=>({to:'receiver',image:'data:image/png;base64,iVBORw0KGgo=',expiresAt:{toMillis:()=>Date.now()+10000}})},
        delete:ref=>{window.photoOperations.push('delete');window.photoExists=false;},update:()=>window.photoOperations.push('opened')
      })};
    });
    await page.evaluate(() => openOncePhoto('demo','photo',document.createElement('button')));
    assert.deepEqual(await page.evaluate(() => window.photoOperations),['delete','opened']);
    assert.equal(await page.locator('#onceViewer').isVisible(),true,'Single-use photo opens after consumption');
    await page.locator('#closeOnceViewer').click();
    assert.equal(await page.locator('#onceImage').getAttribute('src'),null,'Closing clears image from viewer');
    await page.evaluate(() => openOncePhoto('demo','photo',document.createElement('button')));
    assert.equal(await page.locator('#onceViewer').isVisible(),false,'Consumed photo cannot reopen');
    await page.evaluate(() => {clearDraftSticker();document.getElementById('msgInput').value='';updateComposer();});
    await page.evaluate(() => {
      window.trackStopped=false;
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>window.trackStopped=true}]})},configurable:true});
      window.MediaRecorder=class {static isTypeSupported(){return true;} start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['sample'],{type:'audio/mp4'})});this.onstop();}};
    });
    await page.evaluate(() => startVoice());
    assert.equal(await page.locator('#voiceSendBtn').getAttribute('aria-label'),'إيقاف التسجيل');
    await page.locator('#voiceSendBtn').click();
    assert.equal(await page.evaluate(() => window.trackStopped),true,'Microphone released after stop');
    assert.equal(await page.locator('#voiceDraft audio').count(),1,'Recording is previewed before send');
    await page.locator('#voiceDraft button').last().click();
    assert.equal(await page.locator('#voiceDraft').isVisible(),false,'Recording can be discarded');
    assert.deepEqual(errors, []);
    console.log('PASS face picker, Enter send exactly once, focus, blocked composer and Ping retained');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
