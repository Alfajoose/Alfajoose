// Layout guarantees: touch targets, focus mode, safe areas, no overflow.
//
// These encode decisions that were made deliberately and then broken by a later
// change. The focus-mode case is the clearest: a rule meant to hide the frame
// count matched `span`, and the fps control is a span, so the whole control
// vanished. Nothing caught it because nothing was looking.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

/** Every control a finger is expected to hit. */
const CONTROLS = [
  '#undo-btn', '#redo-btn', '#projects-btn', '#export-btn', '#grid-toggle-btn',
  '#focus-btn', '#tr-grp-draw', '#tr-eraser', '#tr-fill', '#cp-open-btn',
  '#tr-ruler', '#tr-grp-sel', '#play-btn', '#add-frame-btn', '#dup-frame-btn',
  '#del-frame-btn', '#onion-toggle-btn', '#tl-more-btn', '#fps-btn',
];

async function sizes(page, selectors) {
  return page.evaluate((sels) => sels.map((s) => {
    const el = document.querySelector(s);
    if (!el) return { s, missing: true };
    const r = el.getBoundingClientRect();
    return { s, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  }), selectors);
}

test.describe('layout', () => {
  test('every control exists and is visible', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Ctl');

    const missing = (await sizes(page, CONTROLS)).filter((x) => x.missing || x.w === 0);
    expect(missing.map((m) => m.s), 'no control may be missing or zero-sized').toEqual([]);
    noErrors();
  });

  test('touch targets are big enough on a phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'touch sizing is phone-specific');
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Touch');

    // 32px is below the usual 44px guidance but is the floor this app committed
    // to after the cells and header buttons were enlarged; the old 28px buttons
    // were the actual complaint.
    const MIN = 32;
    const small = (await sizes(page, CONTROLS))
      .filter((x) => !x.missing && (x.w < MIN || x.h < MIN))
      .map((x) => `${x.s} ${x.w}x${x.h}`);
    expect(small, `controls under ${MIN}px`).toEqual([]);
    noErrors();
  });

  test('frame cells are big enough to tap on a phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'touch sizing is phone-specific');
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Cells');

    const cell = await page.evaluate(() => {
      const r = document.querySelector('#tl [data-f]').getBoundingClientRect();
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    });
    expect(cell.w, 'cell width').toBeGreaterThanOrEqual(44);
    expect(cell.h, 'cell height').toBeGreaterThanOrEqual(44);
    noErrors();
  });

  test('focus mode keeps the fps control and the play button', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'FocusCtl');

    await page.evaluate(() => toggleFocusMode(true));
    await expect(page.locator('body')).toHaveClass(/focus-mode/);
    await page.waitForTimeout(400);

    // The exact regression: a display:none on span swallowed the fps control.
    for (const sel of ['#fps-btn', '#play-btn', '#onion-toggle-btn']) {
      const box = await H.boxOf(page, sel);
      expect(box, `${sel} exists in focus mode`).toBeTruthy();
      expect(box.width, `${sel} is visible in focus mode`).toBeGreaterThan(0);
      expect(box.height, `${sel} is visible in focus mode`).toBeGreaterThan(0);
    }

    // And the fps button must still say something.
    expect((await page.locator('#fps-btn').textContent()).trim().length,
      'fps button keeps its label').toBeGreaterThan(0);

    noErrors();
  });

  test('focus mode can be left again', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'FocusExit');

    await page.evaluate(() => toggleFocusMode(true));
    await expect(page.locator('body')).toHaveClass(/focus-mode/);
    await page.evaluate(() => toggleFocusMode(false));
    await expect(page.locator('body')).not.toHaveClass(/focus-mode/);

    // Controls come back.
    const box = await H.boxOf(page, '#tr-grp-draw');
    expect(box.width, 'the tool rail returns').toBeGreaterThan(0);
    noErrors();
  });

  test('the page never scrolls horizontally', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Overflow');

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    // The timeline scrolls inside its own container; the document must not.
    expect(overflow.doc, 'document must not scroll horizontally').toBeLessThanOrEqual(1);
    expect(overflow.body, 'body must not scroll horizontally').toBeLessThanOrEqual(1);
    noErrors();
  });

  test('chrome clears the notch and gesture bar when insets are present',
    async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== 'chromium', 'inset override needs CDP');
      test.skip(testInfo.project.name !== 'phone', 'insets are phone-specific');
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'Safe');

      const cdp = await page.context().newCDPSession(page);
      const TOP = 48, BOTTOM = 24;
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: TOP, bottom: BOTTOM, left: 0, right: 0 },
      });
      await page.waitForTimeout(500);

      const geo = await page.evaluate(() => {
        const r = (s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1) };
        };
        return { topbar: r('#topbar'), tlscroll: r('#tlscroll'), vh: window.innerHeight };
      });

      // The regression: a phone media query hard-set top:16px, discarding the
      // inset, so the toolbar sat under the status bar on notched devices.
      expect(geo.topbar, '#topbar exists').toBeTruthy();
      expect(geo.topbar.top, 'top bar clears the status bar / notch')
        .toBeGreaterThanOrEqual(TOP - 1);

      // #bottom deliberately runs to the screen edge so its background sits
      // under the gesture bar; the inset is absorbed by its padding. So assert
      // on the last INTERACTIVE thing instead of the dock's outer box.
      expect(geo.tlscroll, '#tlscroll exists').toBeTruthy();
      expect(geo.vh - geo.tlscroll.bottom, 'the timeline clears the gesture bar')
        .toBeGreaterThanOrEqual(BOTTOM - 1);

      await cdp.detach();
      noErrors();
    });

  test('the layout holds together at 320px', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Narrow');

    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(500);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow at 320px').toBeLessThanOrEqual(1);

    // The header controls must still be reachable rather than clipped away.
    for (const sel of ['#play-btn', '#fps-btn', '#add-frame-btn']) {
      const b = await H.boxOf(page, sel);
      expect(b.width, `${sel} survives 320px`).toBeGreaterThan(0);
      expect(b.right, `${sel} is not clipped off the right edge`)
        .toBeLessThanOrEqual(b.vw + 0.5);
    }

    noErrors();
  });
});
