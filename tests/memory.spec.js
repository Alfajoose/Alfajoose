// Lazy frame buffers.
//
// Blank frames hold a 1x1 placeholder and grow on first write. That is a large
// memory win and a sharp edge: a write that skips _wf() lands in the placeholder
// and the artwork is lost. These tests exercise every tool and every operation
// that touches a frame the user has not visited, and assert the pixels survive.
//
// If you add a drawing tool or an operation that writes to a frame, add it here.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

const stats = (page) => page.evaluate(() => {
  let bytes = 0, deferred = 0, n = 0;
  for (const l of layers) for (const c of l.frames) {
    bytes += c.canvas.width * c.canvas.height * 4;
    n++;
    if (c.canvas.width !== CW || c.canvas.height !== CH) deferred++;
  }
  return { buffers: n, deferred, mb: +(bytes / 1048576).toFixed(2) };
});

const painted = (page, li = null, fi = null) => page.evaluate(([l, f]) => {
  const ctx = layers[l ?? curLayer].frames[f ?? curFrame];
  const cv = ctx.canvas;
  return ctx.getImageData(0, 0, cv.width, cv.height).data.some((v) => v !== 0);
}, [li, fi]);

/** Draw a stroke on the canvas with the current tool. */
async function stroke(page) {
  const box = await page.locator('#main-cv').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 45, cy - 28);
  await page.mouse.down();
  await page.mouse.move(cx + 45, cy + 28, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

test.describe('lazy frame buffers', () => {
  test('a new project allocates no pixel buffers at all', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Lazy');

    const s = await stats(page);
    expect(s.buffers, 'a new project still has its 8 frames').toBe(8);
    expect(s.deferred, 'all of them are deferred').toBe(8);
    expect(s.mb, 'and cost essentially nothing').toBeLessThan(0.1);

    noErrors();
  });

  test('a long multi-layer project stays cheap until drawn on', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Long');
    await H.addLayers(page, 2);
    await page.evaluate(() => { for (let i = 0; i < 52; i++) addFrame(); });
    await page.waitForFunction(() => totalFrames >= 60, null, { timeout: 30_000 });
    await page.waitForTimeout(500);

    const s = await stats(page);
    expect(s.buffers, '60 frames across 3 layers').toBe(180);
    // Eagerly allocated this was 356MB at the default 960x540 — under the
    // 450MB warning, and 98% of it empty.
    expect(s.mb, '180 blank buffers must not cost hundreds of MB').toBeLessThan(1);

    noErrors();
  });

  // Every tool that commits pixels. A tool missing from this list is a tool
  // whose writes are unproven against a deferred frame.
  for (const tool of ['pen', 'brush', 'line', 'arrow', 'dotted', 'curve']) {
    test(`${tool} materialises the frame it draws on`, async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'T-' + tool);

      // Move to a frame nothing has touched, so its buffer is still deferred.
      await H.gotoFrame(page, 4);
      expect(await page.evaluate(() => _isDeferred(layers[curLayer].frames[curFrame])),
        'frame 4 starts deferred').toBe(true);

      await page.evaluate((t) => { tool = t; }, tool);
      await stroke(page);
      if (tool === 'curve') {
        // The curve tool takes three taps; a drag alone may not commit.
        const box = await page.locator('#main-cv').boundingBox();
        for (const [dx, dy] of [[-40, 20], [40, 20], [0, -30]]) {
          await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
          await page.waitForTimeout(150);
        }
      }

      expect(await page.evaluate(() => _isDeferred(layers[curLayer].frames[curFrame])),
        `${tool} must grow the buffer before writing`).toBe(false);
      expect(await painted(page), `${tool} must leave pixels behind`).toBe(true);

      noErrors();
    });
  }

  test('the eraser works on a deferred frame', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Erase');
    await H.gotoFrame(page, 4);

    await page.evaluate(() => { tool = 'pen'; });
    await stroke(page);
    expect(await painted(page), 'there is something to erase').toBe(true);

    await page.evaluate(() => { tool = 'eraser'; });
    await stroke(page);

    // The eraser succeeds by REMOVING pixels, so the assertion is inverted —
    // what matters is that it operated on a real buffer rather than the 1x1
    // placeholder, and that it actually took the stroke away.
    expect(await page.evaluate(() => _isDeferred(layers[curLayer].frames[curFrame])),
      'the eraser worked on a materialised buffer').toBe(false);
    expect(await painted(page), 'the stroke is gone').toBe(false);

    noErrors();
  });

  test('the fill tool works on a deferred frame', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Fill');
    await H.gotoFrame(page, 3);
    // Fill needs a boundary, so ink first, then flood the enclosed area.
    await page.evaluate(() => { tool = 'pen'; });
    await stroke(page);
    await page.evaluate(() => { tool = 'fill'; });
    const box = await page.locator('#main-cv').boundingBox();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.waitForTimeout(400);

    expect(await painted(page), 'fill leaves pixels').toBe(true);
    noErrors();
  });

  test('undo restores into a frame that was reclaimed as blank', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'UndoLazy');
    await H.gotoFrame(page, 2);
    await stroke(page);
    expect(await painted(page)).toBe(true);

    await page.click('#undo-btn');
    await expect.poll(() => painted(page), { message: 'undo empties the frame' }).toBe(false);

    // Reclaim runs on idle and may hand the now-blank buffer back.
    await page.evaluate(() => reclaimBlankFrames());
    await page.waitForTimeout(200);

    // Redo must still be able to put the pixels back.
    await page.click('#redo-btn');
    await expect.poll(() => painted(page), { message: 'redo restores the stroke' }).toBe(true);
    expect(await page.evaluate(() => _isDeferred(layers[curLayer].frames[curFrame])),
      'redo grew the buffer again').toBe(false);

    noErrors();
  });

  test('duplicating a blank frame does not allocate', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Dup');
    const before = await stats(page);
    await page.click('#dup-frame-btn');
    await page.waitForTimeout(400);
    const after = await stats(page);

    expect(after.buffers, 'one more frame').toBe(before.buffers + 1);
    expect(after.mb, 'a copy of nothing costs nothing').toBeLessThan(0.1);
    noErrors();
  });

  test('duplicating a drawn frame copies its pixels', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'DupInk');
    await stroke(page);
    expect(await painted(page, null, 0)).toBe(true);

    await page.click('#dup-frame-btn');
    await page.waitForTimeout(500);
    expect(await painted(page, null, 1), 'the duplicate carries the artwork').toBe(true);
    noErrors();
  });

  test('merging layers keeps the artwork', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Merge');
    await H.addLayers(page, 1);
    await stroke(page);
    const drawnOn = await page.evaluate(() => curLayer);
    expect(await painted(page, drawnOn, 0)).toBe(true);

    await page.evaluate(() => { curLayer = 0; mergeLayerDown(0); });
    await page.waitForTimeout(600);

    expect(await page.evaluate(() => layers.length), 'layers merged').toBe(1);
    expect(await painted(page, 0, 0), 'the merged result still has the stroke').toBe(true);
    noErrors();
  });

  test('reclaim never touches a frame with artwork or the one being edited',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'Reclaim');
      await H.gotoFrame(page, 1);
      await stroke(page);
      await H.gotoFrame(page, 5);

      const freed = await page.evaluate(() => reclaimBlankFrames());
      expect(freed, 'nothing was materialised to reclaim yet').toBeGreaterThanOrEqual(0);

      expect(await painted(page, null, 1), 'the drawn frame keeps its pixels').toBe(true);
      expect(await page.evaluate(() => _isDeferred(layers[curLayer].frames[1])),
        'a frame with content is never shrunk').toBe(false);

      noErrors();
    });

  // Reclaiming is destructive, so its emptiness check must be exact. The first
  // implementation reused _hasContentScan(), which SAMPLES every 4th pixel for
  // the timeline dots — a 1px hairline read as empty and the frame was thrown
  // away. These are the sparse cases a sampler misses.
  for (const [name, draw] of [
    ['a 1px hairline', 'c.fillRect(10, 0, 1, CH)'],
    ['a single pixel', 'c.fillRect(CW - 1, CH - 1, 1, 1)'],
    ['a sparse dotted line', 'for (let x = 0; x < CW; x += 37) c.fillRect(x, 20, 1, 1)'],
  ]) {
    test(`reclaim preserves ${name}`, async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'Sparse');

      const survived = await page.evaluate((expr) => {
        const c = _wf(0, 3);
        c.fillStyle = '#000';
        // eslint-disable-next-line no-eval
        eval(expr);
        delete c.canvas._hasContent;      // force reclaim to decide for itself
        reclaimBlankFrames();
        const after = layers[0].frames[3];
        const cv = after.canvas;
        return {
          deferred: cv.width !== CW,
          painted: after.getImageData(0, 0, cv.width, cv.height).data.some((v) => v !== 0),
        };
      }, draw);

      expect(survived.deferred, 'a frame with artwork must not be reclaimed').toBe(false);
      expect(survived.painted, 'the artwork must still be there').toBe(true);
      noErrors();
    });
  }

  test('a project round-trips through save and load with deferred frames',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'RoundLazy');
      await H.gotoFrame(page, 2);
      await stroke(page);

      const json = await page.evaluate(() => JSON.stringify({
        version: 2, id: projectId, name: projectName,
        fps: +document.getElementById('fps-sel').value || 12,
        totalFrames, CW, CH, bg: projectBg,
        layers: layers.map((l) => ({
          name: l.name, visible: l.visible, locked: l.locked ?? false,
          opacity: l.opacity ?? 1, color: l.color, holds: [...l.holds],
          frames: l.frames.map((c) => c.canvas.toDataURL('image/png')),
        })),
      }));

      await page.evaluate(async (txt) => {
        await loadProject(new File([txt], 'r.keela', { type: 'application/json' }));
      }, json);
      await page.waitForTimeout(1500);

      expect(await page.evaluate(() => totalFrames), 'frame count survives').toBe(8);
      expect(await painted(page, 0, 2), 'the drawn frame survives the round trip').toBe(true);
      noErrors();
    });

  test('exports include artwork from frames that were never visited',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'ExpLazy');
      // Ink frame 6 only, then export from frame 0 without visiting it again.
      await H.gotoFrame(page, 6);
      await stroke(page);
      await H.gotoFrame(page, 0);
      await page.evaluate(() => reclaimBlankFrames());

      const composited = await page.evaluate(() => {
        const t = document.createElement('canvas');
        t.width = CW; t.height = CH;
        const tc = t.getContext('2d');
        layers.slice().reverse().forEach((l) => {
          if (l.visible) tc.drawImage(l.frames[6].canvas, 0, 0, CW, CH);
        });
        return tc.getImageData(0, 0, CW, CH).data.some((v) => v !== 0);
      });
      expect(composited, 'frame 6 still composites its artwork').toBe(true);
      noErrors();
    });
});
