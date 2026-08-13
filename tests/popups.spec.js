// Every floating panel, opened and measured.
//
// Four separate popups shipped broken during development, all the same way: the
// anchor was measured while it was detached from the document (or after a
// rebuild replaced it), getBoundingClientRect returned zeros, and the panel
// landed in the top-left corner. A panel at left:0/top:0 is the signature, so
// these tests assert real placement rather than mere visibility.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

/** Open the timeline's layer dropdown by tapping the layer label. */
async function openLayerDropdown(page) {
  const label = page.locator('#tl .tlbl').first();
  await label.scrollIntoViewIfNeeded();
  await label.click();
  await expect(page.locator('#layer-dropdown')).toHaveClass(/show/);
  await page.waitForTimeout(200);
}

test.describe('popups', () => {
  test('the layer dropdown opens fully on screen', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'DD');
    await H.addLayers(page, 2);

    await openLayerDropdown(page);
    H.expectOnScreen(await H.boxOf(page, '#layer-dropdown'), 'layer dropdown');

    // It must be anchored near the label it belongs to, not parked at the origin.
    const { dropdownLeft, labelLeft } = await page.evaluate(() => ({
      dropdownLeft: document.getElementById('layer-dropdown').getBoundingClientRect().left,
      labelLeft: document.querySelector('#tl .tlbl').getBoundingClientRect().left,
    }));
    expect(Math.abs(dropdownLeft - labelLeft),
      'dropdown is anchored to its label').toBeLessThan(120);

    noErrors();
  });

  test('the per-layer options menu opens fully on screen', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'More');
    await H.addLayers(page, 2);
    await openLayerDropdown(page);

    const more = page.locator('#layer-dropdown .ld-more').first();
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.locator('.lyr-more-pop')).toBeVisible();
    await page.waitForTimeout(250);

    H.expectOnScreen(await H.boxOf(page, '.lyr-more-pop'), 'layer options menu');

    // And it must actually contain its actions.
    const items = await page.locator('.lyr-more-pop .lyr-more-item').allTextContents();
    expect(items.length, 'the menu has items').toBeGreaterThan(0);

    noErrors();
  });

  test('opening the options menu does not close the dropdown out from under it',
    async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'Chain');
      await H.addLayers(page, 1);
      await openLayerDropdown(page);

      await page.locator('#layer-dropdown .ld-more').first().click();
      await expect(page.locator('.lyr-more-pop')).toBeVisible();
      await page.waitForTimeout(250);

      // Regression: tapping the three dots used to dismiss the panel, which
      // detached the anchor and threw the menu into the corner.
      H.expectOnScreen(await H.boxOf(page, '.lyr-more-pop'), 'options menu after chaining');
      noErrors();
    });

  test('the fps menu opens fully on screen', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Fps');

    await page.click('#fps-btn');
    await expect(page.locator('#fps-menu')).toHaveClass(/show/);
    await page.waitForTimeout(250);

    H.expectOnScreen(await H.boxOf(page, '#fps-menu'), 'fps menu');
    noErrors();
  });

  test('the timeline more menu opens fully on screen', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'TlMore');

    await page.click('#tl-more-btn');
    await page.waitForTimeout(300);

    // Find whichever panel the button revealed.
    const sel = await page.evaluate(() => {
      const cands = ['#tl-more-menu', '#tl-more-pop', '.tl-more-pop', '#ctx-menu'];
      for (const s of cands) {
        const el = document.querySelector(s);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return s;
        }
      }
      return null;
    });
    expect(sel, 'the more button opened a panel').toBeTruthy();
    H.expectOnScreen(await H.boxOf(page, sel), 'timeline more menu');
    noErrors();
  });

  test('the colour picker opens fully on screen', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Color');

    await page.click('#cp-open-btn');
    await page.waitForTimeout(350);

    const sel = await page.evaluate(() => {
      for (const s of ['#color-panel', '#cp-panel', '.cp-panel', '#colorpicker']) {
        const el = document.querySelector(s);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return s;
        }
      }
      return null;
    });
    expect(sel, 'the colour chip opened a panel').toBeTruthy();
    H.expectOnScreen(await H.boxOf(page, sel), 'colour picker');
    noErrors();
  });

  test('the export dialog opens fully on screen', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Exp');

    await page.click('#export-btn');
    await expect(page.locator('#modal-bg')).toHaveClass(/show/);
    await page.waitForTimeout(300);

    H.expectOnScreen(await H.boxOf(page, '#modal'), 'export dialog');
    noErrors();
  });

  test('no panel is ever parked at the origin', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Origin');
    await H.addLayers(page, 1);

    // Open everything in turn and check the whole set at once — a broad net for
    // the same failure mode in panels these tests do not name individually.
    const steps = [
      async () => { await page.click('#fps-btn'); },
      async () => { await page.click('#cp-open-btn'); },
      async () => { await page.click('#tl-more-btn'); },
      async () => { await openLayerDropdown(page); },
    ];
    for (const step of steps) {
      await step();
      await page.waitForTimeout(250);
      const parked = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('div,section,aside,ul')) {
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 40) continue;
          const cs = getComputedStyle(el);
          if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
          if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
          // A floating panel flush against both edges is the corner bug.
          if (r.left <= 0.5 && r.top <= 0.5 && r.width < window.innerWidth * 0.9) {
            out.push((el.id || el.className || el.tagName) + ` ${r.width}x${r.height}`);
          }
        }
        return out;
      });
      expect(parked, 'no floating panel is stuck in the top-left corner').toEqual([]);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }

    noErrors();
  });
});
