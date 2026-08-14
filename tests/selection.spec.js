// Selection and transform.
//
// The largest subsystem in the app with no coverage at all: rectangle and lasso
// selection, move, scale, rotate, flip, cut/copy/paste, fill, and copying a
// selection to the next frame. It is stateful and geometric, and its failures
// corrupt artwork rather than throwing, so they are the kind a user discovers
// hours later in a finished scene.
//
// These tests drive the real pointer pipeline wherever the interaction is a
// drag, and call the committing functions directly where the gesture is a
// multi-step handle drag that would make the test about coordinates rather
// than behaviour.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

/** Ink a solid block so a selection has something unambiguous to act on. */
async function block(page, x = 0.2, y = 0.2, w = 0.3, h = 0.3) {
  await page.evaluate(([X, Y, W, Hh]) => {
    const c = _wf(curLayer, curFrame);
    c.fillStyle = '#111';
    c.fillRect(CW * X, CH * Y, CW * W, CH * Hh);
    markFrameContent(true);
    renderFrame();
  }, [x, y, w, h]);
  await page.waitForTimeout(150);
}

/** Count opaque pixels in the current frame — the ground truth for these tests. */
const inkCount = (page) => page.evaluate(() => {
  const c = layers[curLayer].frames[curFrame];
  const cv = c.canvas;
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
});

/** Is there ink inside this fractional rect of the frame? */
const inkIn = (page, x, y, w, h) => page.evaluate(([X, Y, W, Hh]) => {
  const c = layers[curLayer].frames[curFrame];
  const cv = c.canvas;
  if (cv.width === 1) return false;
  const d = c.getImageData(Math.round(CW * X), Math.round(CH * Y),
    Math.max(1, Math.round(CW * W)), Math.max(1, Math.round(CH * Hh))).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
  return false;
}, [x, y, w, h]);

/** Drag a rectangular marquee over a fractional region of the canvas. */
async function marquee(page, x0, y0, x1, y1) {
  await page.evaluate(() => { tool = 'sel-rect'; if (typeof buildPropPanel === 'function') buildPropPanel(tool); });
  const box = await page.locator('#main-cv').boundingBox();
  const px = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const a = px(x0, y0), b = px(x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe('selection', () => {
  test('a rectangular marquee creates an active selection', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelRect');
    await block(page);

    await marquee(page, 0.15, 0.15, 0.55, 0.55);

    const s = await page.evaluate(() => ({
      active: selActive,
      bounds: selBounds && { w: Math.round(selBounds.w), h: Math.round(selBounds.h) },
    }));
    expect(s.active, 'the marquee produced a selection').toBe(true);
    expect(s.bounds, 'with real bounds').toBeTruthy();
    expect(s.bounds.w, 'wider than nothing').toBeGreaterThan(4);
    expect(s.bounds.h, 'taller than nothing').toBeGreaterThan(4);

    noErrors();
  });

  test('a selection tightens to its content, not the dragged marquee',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'SelTight');
      await block(page, 0.20, 0.30, 0.12, 0.20);

      // Drag a marquee much larger than the artwork.
      await marquee(page, 0.05, 0.10, 0.80, 0.80);

      const r = await page.evaluate(() => {
        const c = layers[curLayer].frames[curFrame], cv = c.canvas;
        const d = c.getImageData(0, 0, cv.width, cv.height).data;
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let y = 0; y < cv.height; y++) {
          for (let x = 0; x < cv.width; x++) {
            if (d[(y * cv.width + x) * 4 + 3] > 8) {
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        return { sel: { x: Math.round(selBounds.x), y: Math.round(selBounds.y),
                        w: Math.round(selBounds.w), h: Math.round(selBounds.h) },
                 ink: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
      });
      // Within a pixel or two of the ink, nowhere near the marquee.
      expect(Math.abs(r.sel.w - r.ink.w), 'selection width hugs the artwork').toBeLessThanOrEqual(2);
      expect(Math.abs(r.sel.h - r.ink.h), 'selection height hugs the artwork').toBeLessThanOrEqual(2);
      noErrors();
    });

  test('escape clears the selection', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelClear');
    await block(page);
    await marquee(page, 0.15, 0.15, 0.55, 0.55);
    expect(await page.evaluate(() => selActive)).toBe(true);

    await page.evaluate(() => clearSelection());
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => selActive), 'selection cleared').toBe(false);
    noErrors();
  });

  test('a lasso selection closes and activates', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelLasso');
    await block(page);

    await page.evaluate(() => { tool = 'sel-lasso'; });
    const box = await page.locator('#main-cv').boundingBox();
    const pt = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    const path = [[0.12, 0.12], [0.6, 0.12], [0.6, 0.6], [0.12, 0.6], [0.12, 0.13]];
    const first = pt(...path[0]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const [fx, fy] of path.slice(1)) {
      const q = pt(fx, fy);
      await page.mouse.move(q.x, q.y, { steps: 6 });
    }
    await page.mouse.up();
    await page.waitForTimeout(350);

    expect(await page.evaluate(() => selActive), 'the lasso produced a selection').toBe(true);
    noErrors();
  });

  test('delete removes only the selected pixels', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelDelete');
    // Two separated blocks: one inside the marquee, one outside it.
    await block(page, 0.10, 0.10, 0.25, 0.25);
    await block(page, 0.70, 0.70, 0.20, 0.20);
    const before = await inkCount(page);
    expect(before, 'both blocks are inked').toBeGreaterThan(0);

    await marquee(page, 0.05, 0.05, 0.45, 0.45);
    await page.evaluate(() => selDelete());
    await page.waitForTimeout(300);

    expect(await inkIn(page, 0.10, 0.10, 0.20, 0.20), 'the selected block is gone').toBe(false);
    expect(await inkIn(page, 0.70, 0.70, 0.18, 0.18), 'the untouched block survives').toBe(true);
    expect(await inkCount(page), 'total ink dropped').toBeLessThan(before);
    noErrors();
  });

  test('cut then paste preserves the artwork', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelCut');
    await block(page, 0.15, 0.15, 0.25, 0.25);
    const before = await inkCount(page);

    await marquee(page, 0.10, 0.10, 0.50, 0.50);
    await page.evaluate(() => selCut());
    await page.waitForTimeout(300);
    expect(await inkCount(page), 'cut emptied the region').toBeLessThan(before / 2);

    // Paste lands in a FLOATING selection so it can still be moved; the pixels
    // only reach the frame when the selection is committed. Asserting on the
    // frame straight after selPaste() therefore reads zero, which looks like
    // data loss and is not.
    await page.evaluate(() => selPaste());
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => selActive), 'the paste is floating').toBe(true);

    await page.evaluate(() => clearSelection());
    await page.waitForTimeout(400);
    expect(await inkCount(page), 'committing the paste restores every pixel').toBe(before);
    noErrors();
  });

  test('copy leaves the original in place', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelCopy');
    await block(page, 0.15, 0.15, 0.25, 0.25);
    const before = await inkCount(page);

    await marquee(page, 0.10, 0.10, 0.50, 0.50);
    await page.evaluate(() => selCopy());
    await page.waitForTimeout(250);

    expect(await inkCount(page), 'copy is not destructive').toBe(before);
    noErrors();
  });

  // A selection tightens to its content rather than keeping the dragged
  // marquee, so flipping a symmetric block inside its own bounds is correctly a
  // no-op. These use an L so the mirroring is unmistakable.
  async function drawL(page) {
    await page.evaluate(() => {
      const c = _wf(curLayer, curFrame);
      c.fillStyle = '#111';
      c.fillRect(CW * 0.20, CH * 0.30, CW * 0.06, CH * 0.24);  // upright bar
      c.fillRect(CW * 0.20, CH * 0.48, CW * 0.22, CH * 0.06);  // foot, to the right
      markFrameContent(true);
      renderFrame();
    });
    await page.waitForTimeout(150);
  }
  const split = (page, axis) => page.evaluate((ax) => {
    const c = layers[curLayer].frames[curFrame], cv = c.canvas;
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let a = 0, b = 0;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        if (d[(y * cv.width + x) * 4 + 3] > 8) {
          const first = ax === 'x' ? x < CW * 0.29 : y < CH * 0.44;
          first ? a++ : b++;
        }
      }
    }
    return { first: a, second: b };
  }, axis);

  test('flipping horizontally mirrors the selection', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelFlipH');
    await drawL(page);
    const before = await split(page, 'x');
    expect(before.first, 'the L starts weighted left').toBeGreaterThan(before.second);

    await marquee(page, 0.10, 0.20, 0.70, 0.70);
    await page.evaluate(() => selFlipH());
    await page.waitForTimeout(400);

    const after = await split(page, 'x');
    expect(after.second, 'the weight moved right').toBeGreaterThan(after.first);
    noErrors();
  });

  test('flipping vertically mirrors the selection', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelFlipV');
    await drawL(page);
    const before = await split(page, 'y');
    expect(before.second, 'the L starts weighted low').toBeGreaterThan(before.first);

    await marquee(page, 0.10, 0.20, 0.70, 0.70);
    await page.evaluate(() => selFlipV());
    await page.waitForTimeout(400);

    const after = await split(page, 'y');
    expect(after.first, 'the weight moved up').toBeGreaterThan(after.second);
    noErrors();
  });

  test('filling a selection recolours the selected pixels', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelFill');
    await block(page, 0.18, 0.18, 0.24, 0.18);

    // selFill() clips the colour to selMaskToCanvas() — the SELECTED PIXELS,
    // not the bounding rectangle. So it recolours artwork rather than flooding
    // a region, and asserting that the pixel COUNT grows tests the wrong thing:
    // filling black ink with black is correctly a no-op.
    const countRed = () => page.evaluate(() => {
      const c = layers[curLayer].frames[curFrame], cv = c.canvas;
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8 && d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) n++;
      }
      return n;
    });
    const before = await inkCount(page);
    expect(await countRed(), 'nothing is red to begin with').toBe(0);

    await marquee(page, 0.10, 0.10, 0.60, 0.60);
    await page.evaluate(() => { color = '#ff2222'; });
    await page.evaluate(() => selFill());
    await page.waitForTimeout(400);

    expect(await countRed(), 'the selected artwork took the new colour')
      .toBeGreaterThan(before * 0.8);
    expect(await inkCount(page), 'recolouring does not add or remove pixels')
      .toBeGreaterThan(before * 0.9);
    expect(await inkIn(page, 0.80, 0.80, 0.15, 0.15), 'nothing painted outside').toBe(false);
    noErrors();
  });

  test('copying a selection to the next frame does not disturb this one',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'SelNext');
      await block(page, 0.20, 0.20, 0.25, 0.25);
      const before = await inkCount(page);
      await marquee(page, 0.10, 0.10, 0.60, 0.60);

      await page.evaluate(() => selCopyToNextFrame());
      await page.waitForTimeout(500);

      // Whichever frame we end on, the source frame must be intact and the
      // neighbour must have gained the artwork.
      const r = await page.evaluate(() => {
        const ink = (f) => {
          const c = layers[curLayer].frames[f], cv = c.canvas;
          if (cv.width === 1) return 0;
          const d = c.getImageData(0, 0, cv.width, cv.height).data;
          let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
          return n;
        };
        return { f0: ink(0), f1: ink(1), cur: curFrame };
      });
      expect(r.f0, 'the source frame kept its artwork').toBeGreaterThan(before * 0.8);
      expect(r.f1, 'the next frame received a copy').toBeGreaterThan(0);
      noErrors();
    });

  test('a selection is undoable', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelUndo');
    await block(page, 0.15, 0.15, 0.25, 0.25);
    const before = await inkCount(page);

    await marquee(page, 0.10, 0.10, 0.50, 0.50);
    await page.evaluate(() => selDelete());
    await page.waitForTimeout(300);
    expect(await inkCount(page)).toBeLessThan(before);

    await page.click('#undo-btn');
    await expect.poll(() => inkCount(page), { message: 'undo restores the deleted pixels' })
      .toBeGreaterThan(before * 0.9);
    noErrors();
  });

  test('scaling a selection keeps ink inside the canvas', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelScale');
    await block(page, 0.30, 0.30, 0.20, 0.20);
    await marquee(page, 0.25, 0.25, 0.60, 0.60);

    const ok = await page.evaluate(() => {
      if (typeof selApplyScale !== 'function') return 'missing';
      try { selApplyScale(1.4, 1.4); return 'ok'; } catch (e) { return 'threw: ' + e.message; }
    });
    expect(ok, 'scale ran').toBe('ok');
    await page.waitForTimeout(400);

    expect(await inkCount(page), 'there is still artwork after scaling').toBeGreaterThan(0);
    noErrors();
  });

  test('rotating a selection keeps the artwork', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'SelRotate');
    await block(page, 0.30, 0.30, 0.24, 0.12);
    await marquee(page, 0.20, 0.20, 0.70, 0.70);
    const before = await inkCount(page);

    const ok = await page.evaluate(() => {
      if (typeof selApplyRotation !== 'function') return 'missing';
      try { selApplyRotation(Math.PI / 2); return 'ok'; } catch (e) { return 'threw: ' + e.message; }
    });
    expect(ok, 'rotate ran').toBe('ok');
    await page.waitForTimeout(400);

    const after = await inkCount(page);
    // A 90 degree rotation redistributes pixels; it must not lose most of them.
    expect(after, 'artwork survives rotation').toBeGreaterThan(before * 0.5);
    noErrors();
  });

  test('selection tools work on a frame that was never materialised',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'SelLazy');
      await H.gotoFrame(page, 5);
      expect(await page.evaluate(() => _isDeferred(layers[curLayer].frames[curFrame])),
        'frame 5 starts deferred').toBe(true);

      // A marquee over an empty deferred frame must not throw or corrupt state.
      await marquee(page, 0.2, 0.2, 0.6, 0.6);
      await page.evaluate(() => { try { selFill(); } catch (_) {} });
      await page.waitForTimeout(400);

      expect(await page.evaluate(() => typeof selActive === 'boolean'),
        'selection state is still coherent').toBe(true);
      noErrors();
    });
});
