// Shared setup for the Frame Twelve suite.
//
// Every spec goes through boot(): load the file, create a project, land in the
// editor. Doing it here keeps the specs about behaviour rather than ceremony,
// and means a change to the startup flow breaks in one place instead of twelve.
const path = require('path');
const { expect } = require('@playwright/test');

const APP = 'file://' + path.resolve(__dirname, '..', 'web', 'frame-twelve.html');

// The app switches timeline metrics at this width. Specs that assert sizes need
// to know which side of it they are on.
const COMPACT_MAX = 560;

/**
 * Collect page errors and console errors for the life of the page. Call the
 * returned function to assert none happened — a silent exception is exactly the
 * kind of failure this suite exists to catch, so specs should end with it.
 */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message ? e.message : e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // file:// pages have no favicon and no server; that 404 is not a defect.
    if (/favicon|net::ERR_FILE_NOT_FOUND/i.test(t)) return;
    errors.push('console: ' + t);
  });
  return () => expect(errors, 'page and console errors').toEqual([]);
}

/** Load the app and wait for the startup screen to be interactive. */
async function open(page) {
  await page.goto(APP, { waitUntil: 'load' });
  await expect(page.locator('#startup-fab')).toBeVisible();
  // The startup screen restores recents and recovery snapshots asynchronously.
  await page.waitForFunction(() => typeof window.startupNew === 'function');
  return page;
}

/** Load the app, create a named project, and wait for the editor to settle. */
async function boot(page, name = 'Test') {
  await open(page);
  await page.click('#startup-fab');
  const nameField = page.getByPlaceholder('Project name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  // The editor is ready once the timeline has built its first cell.
  await expect(page.locator('#tl [data-f="0"]').first()).toBeVisible();
  // NB: bare identifiers, not window.*. The app's top-level state uses `let`,
  // which creates global *lexical* bindings — reachable as free variables from
  // an injected script, but never properties of window.
  await page.waitForFunction(() => typeof buildTL === 'function' && Array.isArray(layers));
  return page;
}

/** Append n blank frames across all layers, waiting for each to land. */
async function addFrames(page, n) {
  for (let i = 0; i < n; i++) {
    const before = await page.evaluate(() => totalFrames);
    await page.evaluate(() => addFrame());
    await page.waitForFunction((b) => totalFrames === b + 1, before);
  }
}

/** Draw one stroke on the canvas so frames are not blank. */
async function ink(page, frame = null) {
  if (frame !== null) await gotoFrame(page, frame);
  const box = await page.locator('#main-cv').boundingBox();
  expect(box, '#main-cv must be laid out').toBeTruthy();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 40, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/**
 * Draw one stroke with real touch events, via CDP.
 *
 * This is not interchangeable with ink(): page.mouse produces pointer events
 * with pointerType 'mouse', and the app handles finger input in a separate
 * touchend path. An undo bug lived in the pointer path for exactly this reason —
 * the mouse tests were green while finger input worked, and vice versa. Cover
 * both or cover neither.
 */
async function inkTouch(page) {
  const box = await page.locator('#main-cv').boundingBox();
  expect(box, '#main-cv must be laid out').toBeTruthy();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
  });
  await send('touchStart', cx - 40, cy - 30);
  for (let i = 1; i <= 8; i++) await send('touchMove', cx - 40 + i * 10, cy - 30 + i * 7);
  await send('touchEnd', cx + 40, cy + 26);
  await page.waitForTimeout(200);
  await cdp.detach();
}

/** Move the playhead without going through the UI. */
async function gotoFrame(page, f) {
  await page.evaluate((n) => {
    curFrame = n;
    if (typeof updateTLHighlight === 'function') updateTLHighlight(n);
    if (typeof updateScrubber === 'function') updateScrubber();
    if (typeof renderFrame === 'function') renderFrame();
  }, f);
  await page.waitForFunction((n) => curFrame === n, f);
}

/** Add n extra layers via the timeline dropdown's own controls. */
async function addLayers(page, n) {
  for (let i = 0; i < n; i++) {
    const before = await page.evaluate(() => layers.length);
    await page.evaluate(() => addLayer());
    await page.waitForFunction((b) => layers.length === b + 1, before);
  }
}

/** Timeline metrics and the widths that must agree with them. */
function metrics(page) {
  return page.evaluate(() => {
    const tl = document.getElementById('tl');
    const lbl = document.querySelector('.tlbl');
    const sr = document.getElementById('scrubber-row');
    const cv = document.getElementById('scrubber-ruler-cv');
    const thumb = document.getElementById('scrubber-thumb');
    const cell = document.querySelector(`[data-f="${curFrame}"]`);
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const L = r(lbl), C = r(cv), T = r(thumb), K = r(cell), S = r(sr);
    return {
      TLFW, TLLBLW,
      innerWidth: window.innerWidth,
      labelW: L ? +L.width.toFixed(1) : null,
      gutterW: sr ? +r(sr.firstElementChild).width.toFixed(1) : null,
      // The three alignments that broke when cells were enlarged.
      rulerVsCells: L && C ? +(C.left - L.right).toFixed(1) : null,
      thumbVsCell: T && K ? +(T.left + T.width / 2 - (K.left + K.width / 2)).toFixed(1) : null,
      canvasVsRow: C && S ? +(C.height - S.height).toFixed(1) : null,
      trackH: r(document.querySelector('.track')) ? +r(document.querySelector('.track')).height.toFixed(1) : null,
      tlRect: r(tl) ? { w: +r(tl).width.toFixed(1) } : null,
    };
  });
}

/** Every element that must sit fully inside the viewport when open. */
async function boxOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: +r.left.toFixed(1), top: +r.top.toFixed(1),
      right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
      width: +r.width.toFixed(1), height: +r.height.toFixed(1),
      vw: window.innerWidth, vh: window.innerHeight,
    };
  }, selector);
}

/**
 * Assert an open popup is fully on screen. Four separate popups landed in the
 * top-left corner during development because they were measured while detached,
 * and "left: 0, top: 0" is the signature of exactly that bug.
 */
function expectOnScreen(box, label) {
  expect(box, `${label} must exist`).toBeTruthy();
  expect(box.width, `${label} must have width`).toBeGreaterThan(0);
  expect(box.height, `${label} must have height`).toBeGreaterThan(0);
  expect(box.left, `${label} off the left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.top, `${label} off the top edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.right, `${label} off the right edge`).toBeLessThanOrEqual(box.vw + 0.5);
  expect(box.bottom, `${label} off the bottom edge`).toBeLessThanOrEqual(box.vh + 0.5);
}

module.exports = {
  APP, COMPACT_MAX,
  watchErrors, open, boot, addFrames, addLayers, ink, inkTouch, gotoFrame,
  metrics, boxOf, expectOnScreen,
};
