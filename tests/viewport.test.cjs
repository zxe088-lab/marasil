const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

// Run the production viewport controller without Firebase or a signed-in user.
const source = readFileSync(require.resolve('../app.js'), 'utf8');
const controller = source.slice(source.indexOf('// One layout owner:'), source.indexOf('const COLORS'));
function setup({ viewport = { height: 800, offsetTop: 0, scale: 1 }, focused = false, bottom = true } = {}) {
  const values = {}, classes = {}, events = {}, frames = [];
  const list = { scrollHeight: 1400, clientHeight: 600, scrollTop: bottom ? 800 : 100 };
  const document = {
    documentElement: {
      style: { setProperty: (key, value) => values[key] = value },
      classList: { toggle: (key, value) => classes[key] = value }
    },
    activeElement: { matches: () => focused },
    getElementById: () => list,
    addEventListener: (key, fn) => events['document:' + key] = fn
  };
  if (viewport) viewport.addEventListener = (key, fn) => events['viewport:' + key] = fn;
  const window = { innerHeight: 800, visualViewport: viewport,
    addEventListener: (key, fn) => events[key] = fn };
  runInNewContext(controller, { window, document,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; } });
  const flush = () => { while (frames.length) frames.shift()(); };
  return { values, classes, events, frames, window, list, flush };
}

test('Safari keyboard follows visible height and focus pan, including scroll-only changes', () => {
  const s = setup({ focused: true });
  Object.assign(s.window.visualViewport, { height: 450, offsetTop: 50 });
  s.events['viewport:resize'](); s.events['viewport:scroll']();
  assert.equal(s.frames.length, 1);
  s.flush();
  assert.equal(s.values['--app-height'], '450px');
  assert.equal(s.values['--app-top'], '50px');
  assert.equal(s.classes['keyboard-open'], true);
  s.window.visualViewport.offsetTop = 90;
  s.events['viewport:scroll'](); s.flush();
  assert.equal(s.values['--app-top'], '90px');
  Object.assign(s.window.visualViewport, { height: 800, offsetTop: 0 });
  s.events['viewport:resize'](); s.flush();
  assert.equal(s.classes['keyboard-open'], false);
  assert.equal(s.values['--app-top'], '0px');
});
test('native resizing is applied once and safe area persists until keyboard did hide', () => {
  const s = setup({ focused: true });
  s.events.keyboardWillShow({ keyboardHeight: 350 });
  s.window.innerHeight = s.window.visualViewport.height = 450;
  s.events.resize(); s.flush();
  assert.equal(s.values['--app-height'], '450px');
  assert.equal(s.classes['keyboard-open'], true);
  s.events.keyboardWillHide(); s.flush();
  assert.equal(s.classes['keyboard-open'], true);
  s.window.innerHeight = s.window.visualViewport.height = 800;
  s.events.keyboardDidHide(); s.flush();
  assert.equal(s.classes['keyboard-open'], false);
  assert.equal(s.values['--app-height'], '800px');
});
test('browser without VisualViewport follows innerHeight', () => {
  const s = setup({ viewport: null });
  s.window.innerHeight = 500; s.events.resize(); s.flush();
  assert.equal(s.values['--app-height'], '500px');
  assert.equal(s.values['--app-top'], '0px');
});
test('rotation, restored pages and returning to the app refresh geometry', () => {
  const s = setup();
  for (const event of ['orientationchange', 'pageshow', 'document:visibilitychange']) {
    s.window.visualViewport.height -= 10;
    s.events[event](); s.flush();
    assert.equal(s.values['--app-height'], s.window.visualViewport.height + 'px');
  }
});
test('pinch zoom and zero-height transitional frames do not corrupt geometry', () => {
  const s = setup();
  Object.assign(s.window.visualViewport, { height: 300, scale: 2 });
  s.events['viewport:resize'](); s.flush();
  assert.equal(s.values['--app-height'], '800px');
  Object.assign(s.window.visualViewport, { height: 0, scale: 1 });
  s.events['viewport:resize'](); s.flush();
  assert.equal(s.values['--app-height'], '800px');
});
test('viewport updates preserve a reader scrolling through older messages', () => {
  const s = setup({ bottom: false });
  s.window.visualViewport.height = 450;
  s.events['viewport:resize'](); s.flush();
  assert.equal(s.list.scrollTop, 100);
});
test('browser toolbar changes without a focused input keep the bottom safe area', () => {
  const s = setup();
  s.window.visualViewport.height = 680;
  s.events['viewport:resize'](); s.flush();
  assert.equal(s.classes['keyboard-open'], false);
});

test('native will-show moves the composer before delayed WebView resize without double subtraction', () => {
  const s = setup({ focused: true });
  s.events.keyboardWillShow({ detail: { keyboardHeight: 350 } });
  assert.equal(s.values['--app-height'], '450px');
  assert.equal(s.classes['keyboard-open'], true);
  s.window.innerHeight = s.window.visualViewport.height = 450;
  s.events.resize(); s.flush();
  assert.equal(s.values['--app-height'], '450px');
  s.events.keyboardWillShow({ keyboardHeight: 400 });
  assert.equal(s.values['--app-height'], '400px');
  s.window.innerHeight = s.window.visualViewport.height = 800;
  s.events.keyboardDidHide(); s.flush();
  assert.equal(s.values['--app-height'], '800px');
});
