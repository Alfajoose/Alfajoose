// The timeline: frame navigation, scrubber alignment, and add-frame semantics.
//
// Every assertion here corresponds to something that actually broke. The
// scrubber alignment checks in particular guard a class of bug that recurred:
// the cell width and label gutter are used by several independent code paths,
// and when one of them kept its own copy of the number they silently disagreed.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

test.describe('timeline', () => {
  test('clicking a frame cell moves the current frame', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Nav');

    // Regression: taking pointer capture on #tl retargeted the click to the
    // container, so a plain tap on a cell never reached its handler and the
    // playhead did not move.
    for (const target of [3, 1, 5, 0]) {
      const cell = page.locator(`#tl [data-f="${target}"]`).first();
      await cell.scrollIntoViewIfNeeded();
      await cell.click();
      await expect
        .poll(() => page.evaluate(() => curFrame),
          { message: `clicking cell ${target} must select frame ${target}` })
        .toBe(target);
    }

    noErrors();
  });

  test('the selected cell is the one visually marked current', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Mark');

    const cell = page.locator('#tl [data-f="4"]').first();
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await expect.poll(() => page.evaluate(() => curFrame)).toBe(4);

    // updateTLHighlight marks the current cell with an inline outline rather
    // than a class, so assert on the thing the user actually sees.
    const marked = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('#tl [data-f]')];
      const cur = cells.filter((c) => c.style.outline && c.style.outline !== 'none');
      return { count: cur.length, frames: cur.map((c) => +c.dataset.f) };
    });
    expect(marked.count, 'exactly one cell is outlined as current').toBe(1);
    expect(marked.frames[0], 'the outlined cell is the current frame').toBe(4);

    noErrors();
  });

  test('the scrubber lines up with the frame cells', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Align');
    await H.addFrames(page, 4);
    await H.gotoFrame(page, 3);

    const m = await H.metrics(page);
    // The label gutter and the scrubber gutter are the same measurement; a
    // second hardcoded copy is what slid the ruler 16px off on phones.
    expect(m.gutterW, 'scrubber gutter equals the layer label width').toBe(m.labelW);
    expect(m.labelW, 'label width tracks TLLBLW').toBe(m.TLLBLW);
    expect(m.rulerVsCells, 'ruler starts where the cells start').toBe(0);
    expect(m.thumbVsCell, 'thumb sits on the current cell centre').toBe(0);
    // The row has a 1px bottom border, so the canvas is 1px shorter. More than
    // that means the ruler is floating in a dead band.
    expect(Math.abs(m.canvasVsRow), 'ruler canvas fills the row').toBeLessThanOrEqual(1);

    noErrors();
  });

  test('clicking the scrubber above a cell selects that cell', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Scrub');
    await H.addFrames(page, 4);

    for (const target of [0, 2, 5]) {
      const pos = await page.evaluate((f) => {
        const c = document.querySelector(`[data-f="${f}"]`);
        if (!c) return null;
        c.scrollIntoView({ inline: 'center', block: 'nearest' });
        const r = c.getBoundingClientRect();
        const sr = document.getElementById('scrubber-row').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: sr.top + sr.height / 2 };
      }, target);
      expect(pos, `cell ${target} exists`).toBeTruthy();
      await page.mouse.click(pos.x, pos.y);
      await expect
        .poll(() => page.evaluate(() => curFrame),
          { message: `scrubbing above cell ${target} selects frame ${target}` })
        .toBe(target);
    }

    noErrors();
  });

  test('alignment survives focus mode', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Focus');
    await H.addFrames(page, 3);

    await page.evaluate(() => toggleFocusMode(true));
    await expect(page.locator('body')).toHaveClass(/focus-mode/);
    await page.waitForTimeout(400);

    const m = await H.metrics(page);
    expect(m.rulerVsCells, 'ruler aligned in focus mode').toBe(0);
    expect(m.thumbVsCell, 'thumb aligned in focus mode').toBe(0);
    expect(Math.abs(m.canvasVsRow), 'ruler fills the slimmer focus row')
      .toBeLessThanOrEqual(1);

    noErrors();
  });

  test('alignment survives an orientation flip across the breakpoint', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Rotate');
    await H.addFrames(page, 3);

    // Crossing 560px changes TLFW/TLLBLW, but the cell and scrubber widths are
    // inline styles from buildTL — they used to go stale after a rotation.
    for (const [w, h] of [[915, 412], [412, 915], [1280, 860], [412, 915]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      const m = await H.metrics(page);
      const at = `${w}x${h}`;
      expect(m.labelW, `label matches TLLBLW at ${at}`).toBe(m.TLLBLW);
      expect(m.gutterW, `gutter matches label at ${at}`).toBe(m.labelW);
      expect(m.rulerVsCells, `ruler aligned at ${at}`).toBe(0);
      expect(m.thumbVsCell, `thumb aligned at ${at}`).toBe(0);
    }

    noErrors();
  });

  test('the header add-frame button adds to the current layer only', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'AddOne');
    await H.addLayers(page, 2);

    const lengths = () => page.evaluate(() => layers.map((l) => l.frames.length));
    const before = await lengths();
    expect(before.length).toBe(3);

    await page.click('#add-frame-btn');
    await page.waitForTimeout(400);
    const after = await lengths();

    // Only the active layer gains a frame; the others are padded to match
    // length but the request is per-layer, so the current layer must differ
    // from where it started.
    expect(after[await page.evaluate(() => curLayer)],
      'the current layer gained a frame').toBe(before[await page.evaluate(() => curLayer)] + 1);
    expect(new Set(after).size, 'layer lengths stay consistent').toBe(1);

    noErrors();
  });

  test('the trailing + adds a frame across every layer', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'AddAll');
    await H.addLayers(page, 2);

    const before = await page.evaluate(() => totalFrames);
    const add = page.locator('#tl .addfc').first();
    await add.scrollIntoViewIfNeeded();
    await add.click();

    await expect
      .poll(() => page.evaluate(() => totalFrames),
        { message: 'the trailing + extends all layers' })
      .toBe(before + 1);
    expect(await page.evaluate(() => layers.every((l) => l.frames.length === totalFrames)),
      'every layer matches totalFrames').toBe(true);

    noErrors();
  });

  test('duplicate and delete keep every layer the same length', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'DupDel');
    await H.addLayers(page, 1);
    await H.ink(page);

    const consistent = () => page.evaluate(() =>
      layers.every((l) => l.frames.length === totalFrames && l.holds.length === totalFrames));

    await page.click('#dup-frame-btn');
    await page.waitForTimeout(400);
    expect(await consistent(), 'consistent after duplicate').toBe(true);

    await page.click('#del-frame-btn');
    await page.waitForTimeout(400);
    expect(await consistent(), 'consistent after delete').toBe(true);
    expect(await page.evaluate(() => totalFrames), 'never drops below one frame')
      .toBeGreaterThanOrEqual(1);

    noErrors();
  });

  test('the frame count label matches the model', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Count');
    await H.addFrames(page, 3);

    const shown = await page.locator('#total-f').textContent();
    const actual = await page.evaluate(() => totalFrames);
    expect(shown.trim(), 'the label reports the real frame count')
      .toBe(`${actual} frames`);

    noErrors();
  });
});
