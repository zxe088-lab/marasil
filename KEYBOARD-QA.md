# iOS keyboard review

This branch does not change the marketing version. The owner approved an internal
TestFlight upload, with no App Store submission or replacement of the build under
review. Complete browser checks before starting the next iOS build. Codemagic is
restricted to this fix branch and exports for internal TestFlight testing only.

The send control is now one 44px white circle with a black arrow inside the
composer. It appears for non-whitespace text or an emoji, sends via form submission
once, clears/hides afterward and refocuses the field without scrolling. The old
actionbar send button is removed; Ping stays in the actionbar. Blocked chats cannot
use the composer. Keyboard/safe-area behavior continues to use the viewport fix.

The manual `Composer browser checks` workflow runs controller and isolated
Chromium integration tests, then saves screenshots as `composer-browser-preview`.
The browser fixture uses production markup/styles/composer controller with a
local fake send function, so no Firebase account or real messages are used.

## Design

- The fixed app frame follows `visualViewport.height` and `offsetTop` on both
  resize and scroll, with updates combined in one animation frame.
- Root scrolling is locked. Messages scroll within `main`; classic menu panels
  share the menu's scroller instead of nesting independent scrollers.
- Top safe area accounts for viewport panning; the bottom inset is zero while
  the keyboard is open and restored afterward.
- Capacitor 6 Keyboard uses `resize: native`. JS uses the already resized
  viewport and never subtracts keyboard height. Native keyboard events track
  visibility even when `innerHeight` and the visual viewport shrink together.
- iOS outer WebView scrolling is disabled through Keyboard.setScroll; CSS
  message and form scrollers remain available.
- Existing viewport-fit=cover and 16px input sizing are preserved. Web asset
  query versions change to 12 to avoid using the old CSS/JS from cache.

## Automated checks

Run `node --check app.js` and `node --test tests/viewport.test.cjs`.
The controller tests simulate Safari panning, scroll-only events, native resize,
keyboard close, rotation/restore, zoom, missing VisualViewport and reading history.
These are simulations, not proof of UIKit or real Safari keyboard behavior.
Headless Chromium layout checks also passed five visible-frame scenarios
(844/0, 440/64, 410/105, 450/0, then 844/0 for height/top in pixels):
composer and Send/Ping remain inside the frame, messages overflow internally,
and the document has no vertical scroll range. Safe-area hardware behavior
still requires an iPhone.

## Required device checks before merging

Use an iPhone with a home indicator and, if available, a smaller iPhone. Test both
Safari and a locally installed Capacitor build. On a Mac, install dependencies,
prepare `www` using the repository workflow, then run `npx cap sync ios` to register
Keyboard. The repository generates its iOS project during the build.

1. Open a long chat; tap the message field. Input and Send/Ping must remain
   together directly above the keyboard, without a large empty strip.
2. Scroll old messages with the keyboard open. Only messages should scroll;
   the header/composer/buttons must stay in the visible frame.
3. Switch Arabic/English keyboards and predictive text, then dismiss/reopen
   repeatedly. Verify bottom safe area returns after dismissal.
4. Rotate with the keyboard open and closed; background/return to the app.
5. Show emojis, send a message, send a ping, and navigate back with keyboard open.
6. Check login/setup/profile/modal fields on a small screen and landscape.
7. In Safari, expand/collapse browser bars and verify the menu uses one scroller.

References: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
and https://capacitorjs.com/docs/v6/apis/keyboard .
