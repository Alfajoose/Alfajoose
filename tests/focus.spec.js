// Focus mode: the promise is "more canvas, fewer controls". Both halves broke in
// ways that a screenshot showed instantly and no assertion had ever looked for —
// the canvas stayed exactly the size it was, and the radial tool dial piled its
// wedges up in the corner it was parked in. These tests pin the geometry.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

/** Rect of the artboard, which is what the user actually draws on. */
async function artboard(page) {
  return page.evaluate(() => {
    const r = document.getElementById('canvas-wrap').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
}

/** Clear space between two round wedges: centre distance minus both radii. */
function gap(a, b) {
  const ar = (a.right - a.left) / 2, br = (b.right - b.left) / 2;
  const ax = a.left + ar, ay = a.top + ar, bx = b.left + br, by = b.top + br;
  return Math.hypot(ax - bx, ay - by) - ar - br;
}

/** Where the free area ends: the timeline dock floats over the canvas. */
async function freeArea(page) {
  return page.evaluate(() => ({
    w: window.innerWidth,
    floor: document.getElementById('bottom').getBoundingClientRect().top,
  }));
}

test.describe('focus mode', () => {
  test('entering focus mode enlarges the drawing surface', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'FocusGrow');

    const before = await artboard(page);
    await page.click('#focus-btn');
    await expect(page.locator('body')).toHaveClass(/focus-mode/);
    await page.waitForTimeout(400);
    const after = await artboard(page);

    // The regression: _fitBox() kept reserving the tool rail's width even though
    // focus mode had faded it out and switched off its hit-testing. The fit is
    // width-limited on a phone and on a 1280px desktop alike, so focus mode
    // returned a canvas of byte-identical size — 298x530 before and after.
    expect(after.w * after.h, 'focus mode gives more drawing area')
      .toBeGreaterThan(before.w * before.h * 1.05);

    // And it must not spill off the screen to get there.
    const free = await freeArea(page);
    const box = await page.evaluate(() => {
      const r = document.getElementById('canvas-wrap').getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    expect(box.left, 'artboard stays on screen (left)').toBeGreaterThan(-1);
    expect(box.right, 'artboard stays on screen (right)').toBeLessThan(free.w + 1);
    expect(box.top, 'artboard stays on screen (top)').toBeGreaterThan(-1);
    expect(box.bottom, 'artboard clears the timeline dock').toBeLessThan(free.floor + 1);

    noErrors();
  });

  test('leaving focus mode restores the original fit', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'FocusRestore');

    const before = await artboard(page);
    await page.click('#focus-btn');
    await page.waitForTimeout(400);
    await page.click('#focus-exit-btn');
    await expect(page.locator('body')).not.toHaveClass(/focus-mode/);
    await page.waitForTimeout(400);
    const after = await artboard(page);

    expect(after.w, 'width comes back').toBeCloseTo(before.w, -0.5);
    expect(after.h, 'height comes back').toBeCloseTo(before.h, -0.5);
    noErrors();
  });

  test('a manual zoom survives the focus toggle', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'FocusZoom');

    // openZoomForNewProject() re-fits at 60/200/400ms after a project opens, so a
    // zoom applied before that chain finishes is simply overwritten — wait it out
    // or the test measures the settle, not the toggle.
    await page.waitForTimeout(600);

    // Zoom in twice, then toggle focus on and off. The magnification is relative
    // to the fit, so the percentage is what has to hold — not the pixel size.
    await page.evaluate(() => { zoomIn(); zoomIn(); });
    const pct = await page.evaluate(() => displayZoomPct());
    expect(pct, 'zoomed in').toBeGreaterThan(110);

    await page.click('#focus-btn');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => displayZoomPct()),
      'focus mode keeps the magnification, not the pixel size').toBe(pct);

    await page.click('#focus-exit-btn');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => displayZoomPct()), 'and gives it back').toBe(pct);
    noErrors();
  });

  test('undo is reachable without leaving focus mode', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'FocusUndo');

    await page.click('#focus-btn');
    await page.waitForTimeout(300);

    // Focus mode hides the top bar, so for a mode built for drawing there was no
    // way to take a stroke back without leaving it first.
    await expect(page.locator('#focus-undo')).toBeVisible();
    await expect(page.locator('#focus-undo')).toBeDisabled();

    await H.ink(page);
    await expect(page.locator('#focus-undo')).toBeEnabled();
    const after = await page.evaluate(() => undoStack.length);
    expect(after, 'a stroke landed').toBeGreaterThan(0);

    await page.click('#focus-undo');
    expect(await page.evaluate(() => undoStack.length), 'undo ran').toBe(after - 1);
    await expect(page.locator('#focus-redo')).toBeEnabled();
    noErrors();
  });

  test('every dial wedge opens inside the free area', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'FocusDial');

    await page.click('#focus-btn');
    await page.waitForTimeout(300);
    await page.click('#fdial-center');
    await page.waitForTimeout(450);

    const free = await freeArea(page);
    const wedges = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.fdial-wedge').forEach((w) => {
        const r = w.getBoundingClientRect();
        const l = w.querySelector('.fdial-label').getBoundingClientRect();
        out.push({
          id: w.id,
          left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          label: { left: l.left, right: l.right, top: l.top, bottom: l.bottom },
        });
      });
      return out;
    });
    expect(wedges.length, 'the dial has wedges').toBe(4);

    for (const w of wedges) {
      expect(w.left, `${w.id} clears the left edge`).toBeGreaterThan(-1);
      expect(w.right, `${w.id} clears the right edge`).toBeLessThan(free.w + 1);
      expect(w.top, `${w.id} clears the top edge`).toBeGreaterThan(-1);
      // The regression: clamping dx and dy independently against this floor drags
      // a point off its own circle, so one wedge ended up under the dock.
      expect(w.bottom, `${w.id} clears the timeline dock`).toBeLessThan(free.floor + 1);
      expect(w.label.left, `${w.id}'s label stays on screen`).toBeGreaterThan(-1);
      expect(w.label.right, `${w.id}'s label stays on screen`).toBeLessThan(free.w + 1);
    }

    // And no two wedges may overlap — the independent clamp used to land
    // neighbours on the same pixel, which read as one button, not four. The
    // wedges are circles, so compare centre distance against the sum of the
    // radii: two circles on a diagonal have intersecting bounding boxes long
    // before they actually touch.
    for (let i = 0; i < wedges.length; i++) {
      for (let j = i + 1; j < wedges.length; j++) {
        const a = wedges[i], b = wedges[j];
        expect(gap(a, b), `${a.id} and ${b.id} do not overlap`).toBeGreaterThan(0);
      }
    }

    // Labels are what actually collided on screen: "Fill" read as "Fi" behind
    // the ruler wedge.
    for (let i = 0; i < wedges.length; i++) {
      for (let j = i + 1; j < wedges.length; j++) {
        const a = wedges[i].label, b = wedges[j].label;
        const overlap = a.left < b.right && b.left < a.right
                     && a.top < b.bottom && b.top < a.bottom;
        expect(overlap, `${wedges[i].id} and ${wedges[j].id} labels do not overlap`).toBe(false);
      }
    }

    noErrors();
  });

  test('the dial fits from every corner it can be dragged to', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'FocusDialCorners');
    await page.click('#focus-btn');
    await page.waitForTimeout(300);

    const free = await freeArea(page);
    // The colour chip has its own home in the bottom-right; parking the dial on
    // top of it is a fight between two draggable things, not a geometry case.
    await page.evaluate(() => {
      document.getElementById('focus-color').style.display = 'none';
    });
    // Park the dial in each corner of the free area and re-open. The dial is
    // draggable, so "it fits where we happened to put it" is not enough.
    const spots = [
      { name: 'top-left', x: 40, y: 60 },
      { name: 'top-right', x: free.w - 40, y: 60 },
      { name: 'bottom-left', x: 40, y: free.floor - 50 },
      { name: 'bottom-right', x: free.w - 40, y: free.floor - 50 },
    ];

    for (const s of spots) {
      await page.evaluate(({ x, y }) => {
        const d = document.getElementById('focus-dial');
        d.style.left = (x - 30) + 'px';
        d.style.top = (y - 30) + 'px';
        d.style.bottom = 'auto';
        fdialClose();
      }, s);
      await page.click('#fdial-center');
      await page.waitForTimeout(400);

      const wedges = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.fdial-wedge').forEach((w) => {
          const r = w.getBoundingClientRect();
          out.push({ id: w.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        });
        return out;
      });
      for (const w of wedges) {
        expect(w.left, `${s.name}: ${w.id} left`).toBeGreaterThan(-1);
        expect(w.right, `${s.name}: ${w.id} right`).toBeLessThan(free.w + 1);
        expect(w.top, `${s.name}: ${w.id} top`).toBeGreaterThan(-1);
        expect(w.bottom, `${s.name}: ${w.id} bottom`).toBeLessThan(free.floor + 1);
      }
      for (let i = 0; i < wedges.length; i++) {
        for (let j = i + 1; j < wedges.length; j++) {
          const a = wedges[i], b = wedges[j];
          expect(gap(a, b), `${s.name}: ${a.id} and ${b.id} clear each other`)
            .toBeGreaterThan(0);
        }
      }
      await page.evaluate(() => fdialClose());
    }
    noErrors();
  });

  test('the open dial shows a way out instead of a second copy of the tool',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'FocusDialClose');
      await page.click('#focus-btn');
      await page.waitForTimeout(300);

      const closedIcon = await page.innerHTML('#fdial-center');
      await page.click('#fdial-center');
      await page.waitForTimeout(400);
      const openIcon = await page.innerHTML('#fdial-center');

      expect(openIcon, 'the puck changes glyph when open').not.toBe(closedIcon);
      expect(await page.getAttribute('#fdial-center', 'title')).toBe('Close');

      await page.click('#fdial-center');
      await page.waitForTimeout(300);
      expect(await page.innerHTML('#fdial-center'), 'and changes back')
        .toBe(closedIcon);
      noErrors();
    });
});
