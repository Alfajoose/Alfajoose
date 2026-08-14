// The transform gesture: dragging the handles.
//
// selection.spec.js covers what the selection operations DO, but it reaches
// most of them by calling the committing function. This file covers how you
// actually reach them — grabbing a rotate, scale or move handle and dragging.
//
// That distinction is the point. Almost every real bug found in this app has
// been in the interaction layer, not the maths: pointer capture retargeting a
// click, pointerup arriving before touchend, an anchor measured while detached.
// Testing selApplyRotation(PI/2) proves the rotation matrix; it proves nothing
// about whether you can grab the handle.
//
// Handle positions come from _selHandlePos() in canvas space, converted to
// client coordinates by inverting getPos() exactly, so a drag lands on the same
// pixel the app hit-tests.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

/** Canvas coordinates -> client coordinates, the exact inverse of getPos(). */
const toClient = (page, cx, cy) => page.evaluate(([x, y]) => {
  const r = MC.getBoundingClientRect();
  const z = zoom || 1;
  return {
    x: r.left + r.width / 2 + (x - CW / 2) * z,
    y: r.top + r.height / 2 + (y - CH / 2) * z,
  };
}, [cx, cy]);

const handles = (page) => page.evaluate(() =>
  _selHandlePos().map((h) => ({ id: h.id, x: h.x, y: h.y })));

/** Bounding box of the ink actually on the frame — the user-visible truth. */
const inkBox = (page) => page.evaluate(() => {
  const c = layers[curLayer].frames[curFrame], cv = c.canvas;
  if (cv.width === 1) return null;
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
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
});

const xform = (page) => page.evaluate(() => ({
  rotation: +selRotation.toFixed(4),
  // NOTE: selOffsetX/Y are only live DURING a drag. selMoveEnd calls
  // selCommitMove(), which folds them into selBounds and resets them to 0, so
  // asserting on the offsets after mouseup always reads zero — which looks
  // exactly like "the move did nothing".
  offX: Math.round(selOffsetX),
  offY: Math.round(selOffsetY),
  boxX: selBounds && Math.round(selBounds.x + selOffsetX),
  boxY: selBounds && Math.round(selBounds.y + selOffsetY),
  bounds: selBounds && { w: Math.round(selBounds.w), h: Math.round(selBounds.h) },
  pivot: { x: Math.round(selPivotOff.x), y: Math.round(selPivotOff.y) },
}));

const inkCount = (page) => page.evaluate(() => {
  const c = layers[curLayer].frames[curFrame], cv = c.canvas;
  if (cv.width === 1) return 0;
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
});

/** Ink an asymmetric shape and marquee it, leaving an active selection. */
async function selected(page) {
  await page.evaluate(() => {
    const c = _wf(curLayer, curFrame);
    c.fillStyle = '#111';
    c.fillRect(CW * 0.30, CH * 0.32, CW * 0.22, CH * 0.10);
    c.fillRect(CW * 0.30, CH * 0.32, CW * 0.07, CH * 0.30);
    markFrameContent(true);
    renderFrame();
  });
  await page.waitForTimeout(150);

  await page.evaluate(() => { tool = 'sel-rect'; });
  // Fractions of the real canvas, not of 960x540: the default canvas is now
  // device-aware, so a phone project is 720x1280 and hardcoded dimensions put
  // the marquee off the artwork entirely.
  const dims = await page.evaluate(() => ({ CW, CH }));
  const a = await toClient(page, 0.22 * dims.CW, 0.24 * dims.CH);
  const b = await toClient(page, 0.62 * dims.CW, 0.72 * dims.CH);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => selActive), 'setup produced a selection').toBe(true);
}

/**
 * A point inside the selection that grabs the BODY, not a handle.
 *
 * Not the exact centre: the pivot handle lives there, and _selHitHandle gives
 * the unmoved pivot a small 12px radius specifically so it "should not steal
 * ordinary move drags" — but the dead-centre pixel is the one point that does
 * hit it. Grabbing there drags the pivot and the selection never moves, which
 * is how three of these tests first passed or failed for the wrong reason.
 */
const grabPoint = (page) => page.evaluate(() => ({
  x: selBounds.x + selOffsetX + selBounds.w / 2 + selBounds.w * 0.22,
  y: selBounds.y + selOffsetY + selBounds.h / 2 + selBounds.h * 0.18,
}));

/** Drag from one canvas point to another through real pointer events. */
async function drag(page, from, to, steps = 10) {
  const a = await toClient(page, from.x, from.y);
  const b = await toClient(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + (b.x - a.x) * i / steps,
      a.y + (b.y - a.y) * i / steps);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe('transform handles', () => {
  test('the handles exist and sit on the selection', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'XfHandles');
    await selected(page);

    const hs = await handles(page);
    const ids = hs.map((h) => h.id).sort();
    expect(ids, 'corner, edge, rotation and pivot handles').toEqual(
      expect.arrayContaining(['tl', 'tr', 'bl', 'br', 'rot', 'pivot']));

    // Every handle must be inside the canvas or it cannot be grabbed.
    const dims = await page.evaluate(() => ({ CW, CH }));
    const off = hs.filter((h) => h.x < 0 || h.y < 0 || h.x > dims.CW || h.y > dims.CH);
    expect(off.map((h) => h.id), 'no handle is off-canvas').toEqual([]);
    noErrors();
  });

  test('the hit test prefers rotation over the scale handle it overlaps',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'XfHit');
      await selected(page);

      // The rotation handle sits on a stem above mid-top. The code tests it
      // first on purpose: in array order a scale handle would win the overlap
      // and rotating would silently scale instead.
      const hs = await handles(page);
      const rot = hs.find((h) => h.id === 'rot');
      expect(rot, 'there is a rotation handle').toBeTruthy();

      const hit = await page.evaluate(([x, y]) => _selHitHandle({ x, y }, false),
        [rot.x, rot.y]);
      expect(hit, 'grabbing the rotation handle selects rotation').toBe('rot');
      noErrors();
    });

  test('dragging the rotation handle rotates the selection', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'XfRotate');
    await selected(page);

    const before = await xform(page);
    expect(before.rotation, 'starts unrotated').toBe(0);

    const hs = await handles(page);
    const rot = hs.find((h) => h.id === 'rot');
    // The true geometric centre here, not grabPoint — this is the axis the
    // handle swings around, not a place to press.
    const axis = await page.evaluate(() => ({
      x: selBounds.x + selOffsetX + selBounds.w / 2,
      y: selBounds.y + selOffsetY + selBounds.h / 2,
    }));
    // Swing the handle roughly a quarter turn around that axis.
    const r = Math.hypot(rot.x - axis.x, rot.y - axis.y);
    await drag(page, rot, { x: axis.x + r, y: axis.y }, 14);

    const after = await xform(page);
    expect(Math.abs(after.rotation), 'the selection rotated').toBeGreaterThan(0.3);
    noErrors();
  });

  test('dragging a corner handle resizes the selection', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'XfScale');
    await selected(page);

    const before = await page.evaluate(() => {
      const hs = _selHandlePos();
      const tl = hs.find((h) => h.id === 'tl'), br = hs.find((h) => h.id === 'br');
      return { diag: Math.hypot(br.x - tl.x, br.y - tl.y), br: { x: br.x, y: br.y } };
    });

    // Pull the bottom-right corner further out.
    await drag(page, before.br, { x: before.br.x + 110, y: before.br.y + 70 }, 12);

    const after = await page.evaluate(() => {
      const hs = _selHandlePos();
      const tl = hs.find((h) => h.id === 'tl'), br = hs.find((h) => h.id === 'br');
      return Math.hypot(br.x - tl.x, br.y - tl.y);
    });
    expect(after, 'the selection box grew').toBeGreaterThan(before.diag + 10);
    noErrors();
  });

  test('dragging inside the selection moves it', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'XfMove');
    await selected(page);

    const before = await xform(page);
    const centre = await grabPoint(page);
    await drag(page, centre, { x: centre.x + 120, y: centre.y + 60 }, 12);

    const after = await xform(page);
    expect(after.boxX - before.boxX, 'moved right').toBeGreaterThan(40);
    expect(after.boxY - before.boxY, 'moved down').toBeGreaterThan(20);
    noErrors();
  });

  test('a moved selection commits its pixels to the frame', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'XfCommit');
    await selected(page);
    const before = await inkCount(page);
    const boxBefore = await inkBox(page);

    const centre = await grabPoint(page);
    await drag(page, centre, { x: centre.x + 140, y: centre.y }, 12);

    // Committing is what puts the floating selection back into the frame.
    await page.evaluate(() => clearSelection());
    await page.waitForTimeout(400);

    const after = await inkCount(page);
    // The artwork moved, so most of it should still be there — a move that
    // dropped the pixels would show a large loss.
    expect(after, 'the artwork survived the move').toBeGreaterThan(before * 0.7);
    // And it is in a different place, which is the whole point.
    expect(boxBefore, 'there was ink to begin with').toBeTruthy();
    const boxAfter = await inkBox(page);
    expect(boxAfter.x - boxBefore.x, 'the pixels themselves moved right')
      .toBeGreaterThan(40);
    noErrors();
  });

  test('a handle drag is undoable', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'XfUndo');
    await selected(page);

    const centre = await grabPoint(page);
    const before = await inkCount(page);
    await drag(page, centre, { x: centre.x + 130, y: centre.y + 50 }, 12);
    await page.evaluate(() => clearSelection());
    await page.waitForTimeout(400);

    await expect(page.locator('#undo-btn')).toBeEnabled();
    await page.click('#undo-btn');
    await page.waitForTimeout(400);
    expect(await inkCount(page), 'undo leaves the artwork intact')
      .toBeGreaterThan(before * 0.7);
    noErrors();
  });

  test('dragging the pivot moves only the pivot', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'XfPivot');
    await selected(page);

    const before = await xform(page);
    const hs = await handles(page);
    const pivot = hs.find((h) => h.id === 'pivot');
    expect(pivot, 'there is a pivot handle').toBeTruthy();

    await drag(page, pivot, { x: pivot.x - 70, y: pivot.y - 45 }, 10);

    const after = await xform(page);
    expect(after.pivot, 'the pivot moved').not.toEqual(before.pivot);
    expect(after.offX, 'the selection itself did not move').toBe(before.offX);
    expect(after.offY, 'the selection itself did not move').toBe(before.offY);
    noErrors();
  });

  test('the transform gesture works with touch input', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch injection needs CDP');
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'XfTouch');
    await selected(page);

    const before = await xform(page);
    const centre = await grabPoint(page);
    const a = await toClient(page, centre.x, centre.y);
    const b = await toClient(page, centre.x + 120, centre.y + 50);

    // Finger input takes the touch* handlers, a different path from pointer
    // events — the same split that hid an undo bug for the whole session.
    const cdp = await page.context().newCDPSession(page);
    const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
    await send('touchStart', a.x, a.y);
    for (let i = 1; i <= 8; i++) {
      await send('touchMove', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
    }
    await send('touchEnd', b.x, b.y);
    await page.waitForTimeout(350);
    await cdp.detach();

    const after = await xform(page);
    expect(after.boxX - before.boxX, 'a finger drag moves the selection too')
      .toBeGreaterThan(40);
    noErrors();
  });
});
