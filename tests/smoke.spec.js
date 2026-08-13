// Does it boot, draw, and survive? If this file is red nothing else matters.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

test.describe('smoke', () => {
  test('startup screen loads with a single Projects section', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.open(page);

    await expect(page.locator('#startup-title')).toHaveText('FrameTwelve');
    // The Videos tab was removed; a second tab reappearing is a regression.
    const tabs = page.locator('#startup-tabs .startup-tab');
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveText('Projects');
    await expect(page.locator('#startup-exports-tab')).toHaveCount(0);
    await expect(page.locator('#startup-exports-list')).toHaveCount(0);

    noErrors();
  });

  test('creating a project lands in the editor with one frame and one layer', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Smoke');

    // A new project seeds 8 blank frames on one layer (frame-twelve.html:4607).
    expect(await page.evaluate(() => ({
      frames: totalFrames,
      layers: layers.length,
      cur: curFrame,
      name: projectName,
      framesBuilt: layers[0].frames.length,
      holds: layers[0].holds.length,
    }))).toEqual({ frames: 8, layers: 1, cur: 0, name: 'Smoke', framesBuilt: 8, holds: 8 });

    await expect(page.locator('#startup')).toHaveClass(/hide/);
    await expect(page.locator('#main-cv')).toBeVisible();
    noErrors();
  });

  test('a project cannot be created without a name', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.open(page);
    await page.click('#startup-fab');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    // Still on the startup screen, with the field flagged.
    await expect(page.locator('#np-name')).toHaveClass(/err/);
    noErrors();
  });

  test('drawing marks the frame dirty and fills pixels', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Ink');

    const blank = await page.evaluate(() => {
      const c = layers[0].frames[0];
      return c.getImageData(0, 0, CW, CH).data.some((v) => v !== 0);
    });
    expect(blank, 'frame starts empty').toBe(false);

    await H.ink(page);

    const painted = await page.evaluate(() => {
      const c = layers[0].frames[0];
      return c.getImageData(0, 0, CW, CH).data.some((v) => v !== 0);
    });
    expect(painted, 'stroke reached the layer canvas').toBe(true);
    noErrors();
  });

  test('undo and redo round-trip a stroke', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Undo');
    const painted = () => page.evaluate(() =>
      layers[0].frames[0].getImageData(0, 0, CW, CH).data.some((v) => v !== 0));

    await H.ink(page);
    expect(await painted()).toBe(true);

    await page.click('#undo-btn');
    await expect.poll(painted, { message: 'undo clears the stroke' }).toBe(false);

    await page.click('#redo-btn');
    await expect.poll(painted, { message: 'redo restores the stroke' }).toBe(true);

    noErrors();
  });
});
