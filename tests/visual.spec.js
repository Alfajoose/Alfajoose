// Pixel baselines.
//
// These exist to make stylesheet work safe. The functional suite happily passes
// while the app looks wrong — it asserts that a panel is on screen and big
// enough, not that it still looks like itself. Before restructuring the cascade
// these lock in what every important state renders as, so a refactor that is
// meant to change nothing visually can be proven to have changed nothing.
//
// Baselines are rendered by the local Chromium and are not portable: font
// rasterisation differs between machines and between CI images. So they are
// skipped under CI rather than made into a source of red builds nobody trusts.
// Regenerate deliberately after an intended visual change:
//
//   npm test -- visual --update-snapshots
//
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

test.skip(!!process.env.CI, 'baselines are machine-specific; local use only');

// Screenshot options shared by every check. Animations off and caret hidden,
// otherwise a transition mid-capture produces a one-pixel diff and a lost hour.
// The toast is masked because it is time-dependent by nature: "New project"
// fades on its own schedule and caught two baselines mid-fade.
function shot(page) {
  return {
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('#toast')],
    // Anti-aliasing on text and gradients differs by a hair between runs.
    maxDiffPixelRatio: 0.002,
  };
}

/** Wait for any toast to finish, so it cannot bleed into a capture. */
async function settle(page) {
  await page.waitForFunction(() => {
    const t = document.getElementById('toast');
    return !t || !t.classList.contains('show');
  }, null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(350);
}

/** A project with enough structure that the timeline and layers are populated. */
async function scene(page) {
  await H.boot(page, 'Visual');
  await H.addLayers(page, 2);
  await H.addFrames(page, 2);
  // Deterministic artwork: a fixed shape drawn straight into the layer, so the
  // baseline does not depend on pointer interpolation.
  await page.evaluate(() => {
    // _wf() materialises the frame's buffer. Blank frames are 1x1 placeholders,
    // so a raw layers[..].frames[..] write would land nowhere.
    const c = _wf(0, 0);
    c.save();
    c.strokeStyle = '#1b3a6b';
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(CW * 0.25, CH * 0.7);
    c.lineTo(CW * 0.5, CH * 0.25);
    c.lineTo(CW * 0.75, CH * 0.7);
    c.stroke();
    c.restore();
    renderFrame(); updateThumb(); buildTL();
  });
  await settle(page);
}

test.describe('visual', () => {
  test('startup screen', async ({ page }) => {
    await H.open(page);
    await page.waitForTimeout(500);
    await settle(page);
    await expect(page).toHaveScreenshot('startup.png', { ...shot(page), fullPage: true });
  });

  test('editor', async ({ page }) => {
    await scene(page);
    await settle(page);
    await expect(page).toHaveScreenshot('editor.png', shot(page));
  });

  test('editor in focus mode', async ({ page }) => {
    await scene(page);
    await page.evaluate(() => toggleFocusMode(true));
    await page.waitForTimeout(600);
    await settle(page);
    await expect(page).toHaveScreenshot('editor-focus.png', shot(page));
  });

  test('timeline strip', async ({ page }) => {
    await scene(page);
    // The region that has been changed most often, captured on its own so a
    // diff points at the timeline rather than the whole screen.
    await settle(page);
    await expect(page.locator('#bottom')).toHaveScreenshot('timeline.png', shot(page));
  });

  test('layer dropdown open', async ({ page }) => {
    await scene(page);
    const label = page.locator('#tl .tlbl').first();
    await label.scrollIntoViewIfNeeded();
    await label.click();
    await expect(page.locator('#layer-dropdown')).toHaveClass(/show/);
    await page.waitForTimeout(400);
    await settle(page);
    await expect(page).toHaveScreenshot('layer-dropdown.png', shot(page));
  });

  test('layer options menu open', async ({ page }) => {
    await scene(page);
    const label = page.locator('#tl .tlbl').first();
    await label.scrollIntoViewIfNeeded();
    await label.click();
    await page.waitForTimeout(300);
    await page.locator('#layer-dropdown .ld-more').first().click();
    await expect(page.locator('.lyr-more-pop')).toBeVisible();
    await page.waitForTimeout(400);
    await settle(page);
    await expect(page).toHaveScreenshot('layer-options.png', shot(page));
  });

  test('fps menu open', async ({ page }) => {
    await scene(page);
    await page.click('#fps-btn');
    await expect(page.locator('#fps-menu')).toHaveClass(/show/);
    await page.waitForTimeout(400);
    await settle(page);
    await expect(page).toHaveScreenshot('fps-menu.png', shot(page));
  });

  test('colour picker open', async ({ page }) => {
    await scene(page);
    await page.click('#cp-open-btn');
    await page.waitForTimeout(500);
    await settle(page);
    await expect(page).toHaveScreenshot('color-picker.png', shot(page));
  });

  test('export dialog open', async ({ page }) => {
    await scene(page);
    await page.click('#export-btn');
    await expect(page.locator('#modal-bg')).toHaveClass(/show/);
    await page.waitForTimeout(400);
    await settle(page);
    await expect(page).toHaveScreenshot('export-dialog.png', shot(page));
  });

  test('narrow at 320px', async ({ page }) => {
    await scene(page);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(600);
    await settle(page);
    await expect(page).toHaveScreenshot('narrow-320.png', shot(page));
  });

  test('landscape', async ({ page }) => {
    await scene(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.waitForTimeout(600);
    await settle(page);
    await expect(page).toHaveScreenshot('landscape.png', shot(page));
  });

  test('onion skin on', async ({ page }) => {
    await scene(page);
    // Ink two neighbouring frames so onion skinning has something to tint.
    await page.evaluate(() => {
      [0, 1, 2].forEach((f) => {
        const c = _wf(0, f);
        c.save(); c.fillStyle = '#333';
        c.fillRect(CW * (0.2 + f * 0.15), CH * 0.35, CW * 0.12, CH * 0.3);
        c.restore();
      });
      curFrame = 2; renderFrame(); renderOnion(); buildTL();
    });
    await page.waitForTimeout(500);
    await settle(page);
    await expect(page).toHaveScreenshot('onion.png', shot(page));
  });
});
