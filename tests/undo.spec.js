// Undo, per input device.
//
// These exist because of a real bug: the mouse/stylus pointerup handler never
// called finalizeUndoDraw(), so a finished stroke left its before-image pending
// and pushed no undo entry. The Undo button stayed disabled and the FIRST stroke
// on a frame could not be undone at all — undo was permanently one stroke
// behind. Finger input was fine, which is why it went unnoticed: the two devices
// take different code paths and only one of them finalized.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

const undoState = (page) => page.evaluate(() => ({
  entries: undoStack.length,
  pendingCapture: !!_pendingUndoBefore,
  buttonDisabled: document.getElementById('undo-btn').disabled,
}));

test.describe('undo', () => {
  test('a mouse stroke is immediately undoable', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'M');

    expect(await undoState(page)).toEqual(
      { entries: 0, pendingCapture: false, buttonDisabled: true });

    await H.ink(page);

    // The whole bug in one assertion: one finished stroke, one undo entry, and
    // a button the user can actually press.
    expect(await undoState(page)).toEqual(
      { entries: 1, pendingCapture: false, buttonDisabled: false });

    noErrors();
  });

  test('a finger stroke is immediately undoable', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch injection needs CDP');
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'T');

    await H.inkTouch(page);

    expect(await undoState(page)).toEqual(
      { entries: 1, pendingCapture: false, buttonDisabled: false });

    noErrors();
  });

  test('the undo stack does not lag behind the strokes', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Lag');

    for (let n = 1; n <= 3; n++) {
      await H.ink(page);
      const { entries } = await undoState(page);
      expect(entries, `after stroke ${n} there should be ${n} undo entries`).toBe(n);
    }

    noErrors();
  });

  test('the first stroke can be undone with the button alone', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'First');
    const painted = () => page.evaluate(() =>
      layers[0].frames[0].getImageData(0, 0, CW, CH).data.some((v) => v !== 0));

    await H.ink(page);
    expect(await painted()).toBe(true);

    // Deliberately the button, not Ctrl+Z: undo() finalizes lazily on its own,
    // so the keyboard path masked this bug entirely.
    await expect(page.locator('#undo-btn')).toBeEnabled();
    await page.click('#undo-btn');
    await expect.poll(painted, { message: 'the first stroke must undo' }).toBe(false);

    noErrors();
  });

  test('shape tools are undoable too', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Shapes');

    // The shape branch is a separate early return in the same handler, so it
    // needs its own coverage.
    await page.evaluate(() => { tool = 'line'; });
    const box = await page.locator('#main-cv').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx - 50, cy - 20);
    await page.mouse.down();
    await page.mouse.move(cx + 50, cy + 20, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const painted = () => page.evaluate(() =>
      layers[0].frames[0].getImageData(0, 0, CW, CH).data.some((v) => v !== 0));
    expect(await painted(), 'line tool drew something').toBe(true);
    expect((await undoState(page)).entries, 'the line produced an undo entry').toBeGreaterThan(0);

    await page.click('#undo-btn');
    await expect.poll(painted, { message: 'the line must undo' }).toBe(false);

    noErrors();
  });

  test('undo is capped and never grows without bound', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Cap');
    const cap = await page.evaluate(() => MAX_UNDO);
    expect(cap).toBeGreaterThan(0);

    // Structural ops are cheap to repeat and each pushes one entry.
    await page.evaluate((n) => {
      for (let i = 0; i < n + 5; i++) { saveUndoFrame(0, 0); }
    }, cap);

    expect(await page.evaluate(() => undoStack.length),
      'the stack must respect MAX_UNDO').toBeLessThanOrEqual(cap);
    noErrors();
  });
});
