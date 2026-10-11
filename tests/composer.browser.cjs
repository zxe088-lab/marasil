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
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
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
    assert.equal(await page.locator('#sendBtn').count(), 0, 'Send button removed');
    assert.equal(await face.isVisible(), true, 'Face button replaces send');
    assert.equal(await panel.isVisible(), false, 'Faces hidden at start');
    await input.fill('رسالة بلوحة المفاتيح');
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
        assert.equal(layout.send.width, 44); assert.equal(layout.send.height, 44);
        assert.ok(layout.send.left >= layout.input.right && layout.send.left - layout.input.right <= 9, 'Face sits right of input');
        assert.ok(layout.ping.right <= layout.input.left, 'Ping sits left of input');
        assert.ok(layout.send.bottom <= top+height && layout.ping.bottom <= top+height);
        assert.ok(layout.input.bottom <= top+height && layout.list.height > 0);
        assert.equal(layout.rootScroll, 0, 'No document scroll');
        await page.screenshot({path:path.join(root,'browser-results',`composer-${width}-${height}-${top}.png`)});
        console.log(`PASS composer layout ${width}px, visible height ${height}, top ${top}`);
      }
    }
    await page.evaluate(() => {document.getElementById('composer').hidden=true;updateComposer();});
    await page.evaluate(() => sendText());
    assert.equal(await page.evaluate(() => window.sent.length), 3, 'Blocked composer cannot send');
    assert.deepEqual(errors, []);
    console.log('PASS face picker, Enter send exactly once, focus, blocked composer and Ping retained');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
