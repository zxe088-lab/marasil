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
const composerController = source.slice(source.indexOf('function updateComposer(){'), source.indexOf('\nboot();'));
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
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent(html);
    await page.addStyleTag({ content: style });
    await page.addScriptTag({ content: setup + viewportController + composerController });
    const input = page.locator('#msgInput'), send = page.locator('#sendBtn');
    assert.equal(await send.count(), 1, 'Only one send button exists');
    assert.equal(await page.locator('.actionbar #sendBtn').count(), 0);
    assert.equal(await send.isVisible(), false, 'Empty message hides send');
    await input.fill('   ');
    assert.equal(await send.isVisible(), false, 'Whitespace hides send');
    await input.fill('رسالة اختبار');
    assert.equal(await send.isVisible(), true);
    await send.tap();
    assert.deepEqual(await page.evaluate(() => window.sent), [{ kind: 'text', text: 'رسالة اختبار' }]);
    assert.equal(await input.inputValue(), '');
    assert.equal(await send.isVisible(), false);
    assert.equal(await input.evaluate(e => document.activeElement === e), true, 'Input stays focused after sending');
    await input.fill('رسالة بلوحة المفاتيح');
    await input.press('Enter');
    assert.equal(await page.evaluate(() => window.sent.length), 2, 'Enter sends once');
    assert.equal(await page.locator('#emojiBtn').count(), 0);
    await input.fill('😊');
    assert.equal(await send.isVisible(), true, 'Emoji reveals send');
    await send.tap();
    assert.equal(await page.evaluate(() => window.sent[2].text), '😊');
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
          const buttonStyle = getComputedStyle(document.getElementById('sendBtn'));
          return {app:rect('app'),input:rect('msgInput'),send:rect('sendBtn'),ping:rect('pingBtn'),list:rect('msgList'),
            rootScroll:document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight,
            background:buttonStyle.backgroundColor,color:buttonStyle.color,radius:buttonStyle.borderRadius};
        });
        assert.equal(layout.app.top, top); assert.equal(layout.app.height, height);
        assert.equal(layout.send.width, 44); assert.equal(layout.send.height, 44);
        assert.equal(layout.background, 'rgb(255, 255, 255)'); assert.equal(layout.color, 'rgb(0, 0, 0)');
        assert.equal(layout.radius, '50%');
        assert.ok(layout.send.left >= layout.input.right && layout.send.left - layout.input.right <= 9, 'Send sits right of input');
        assert.ok(layout.ping.right <= layout.input.left, 'Ping sits left of input');
        assert.ok(layout.send.bottom <= top+height && layout.ping.bottom <= top+height);
        assert.ok(layout.input.bottom <= top+height && layout.list.height > 0);
        assert.equal(layout.rootScroll, 0, 'No document scroll');
        await page.screenshot({path:path.join(root,'browser-results',`composer-${width}-${height}-${top}.png`)});
        console.log(`PASS composer layout ${width}px, visible height ${height}, top ${top}`);
      }
    }
    await page.evaluate(() => {document.getElementById('composer').hidden=true;updateComposer();});
    assert.equal(await send.isVisible(), false, 'Blocked composer hides send');
    await page.evaluate(() => sendText());
    assert.equal(await page.evaluate(() => window.sent.length), 3, 'Blocked composer cannot send');
    assert.deepEqual(errors, []);
    console.log('PASS empty/text/emoji visibility, touch and Enter send exactly once, focus, blocked composer and Ping retained');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
