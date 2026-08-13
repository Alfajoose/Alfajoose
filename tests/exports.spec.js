// Export formats and project save/load.
//
// Export is the point of the app, and it is the least forgiving code to change
// blind: six formats share one function, and the delivery path differs between
// the browser and the packaged Android build. These tests intercept the download
// rather than writing files, so they assert what was handed over without
// touching the filesystem.
const { test, expect } = require('@playwright/test');
const H = require('./helpers');

/** Capture every filename the page tries to download. */
async function captureDownloads(page) {
  await page.evaluate(() => {
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__dl.push(this.download); return; }
      return orig.call(this);
    };
    // dl() prefers the share sheet when it exists; record that as a delivery too.
    if (navigator.share) {
      navigator.share = async (d) => {
        window.__dl.push(...(d.files ? d.files.map((f) => f.name) : [d.title || 'shared']));
      };
    }
  });
  return () => page.evaluate(() => window.__dl);
}

// fmt id -> how many files it should deliver for a 3-frame project.
const FORMATS = [
  ['png-single', 1],
  ['jpg-single', 1],
  ['png-sheet', 1],
  ['gif', 1],
];

test.describe('exports', () => {
  for (const [fmt, expected] of FORMATS) {
    test(`${fmt} produces a file`, async ({ page }) => {
      const noErrors = H.watchErrors(page);
      await H.boot(page, 'E');
      await H.ink(page);
      const seen = await captureDownloads(page);

      // doExport(fmt, scale, bg, quality, fps) — scale is required; omitting it
      // makes W/H NaN and getImageData throws.
      await page.evaluate((f) => doExport(f, 1, 'white', 0.92, 12), fmt);
      await expect
        .poll(async () => (await seen()).length,
          { message: `${fmt} delivers ${expected} file(s)`, timeout: 30_000 })
        .toBeGreaterThanOrEqual(expected);

      noErrors();
    });
  }

  test('png-seq delivers one file per frame', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Seq');
    const frames = await page.evaluate(() => totalFrames);
    const seen = await captureDownloads(page);

    await page.evaluate(() => doExport('png-seq', 1, 'white', 0.92, 12));
    await expect
      .poll(async () => (await seen()).length,
        { message: 'one PNG per frame', timeout: 40_000 })
      .toBe(frames);

    noErrors();
  });

  test('exports respect the chosen scale', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Scale');
    await H.ink(page);

    // A half-scale export must produce a smaller image than a full-scale one.
    const sizes = await page.evaluate(async () => {
      const out = {};
      for (const scale of [0.5, 1]) {
        const W = Math.round(CW * scale), H2 = Math.round(CH * scale);
        const c = document.createElement('canvas'); c.width = W; c.height = H2;
        out[scale] = { W, H: H2 };
      }
      return out;
    });
    expect(sizes['0.5'].W).toBeLessThan(sizes['1'].W);
    noErrors();
  });

  test('there is no in-app export library', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'NoLib');

    // The Videos tab and its shelf were removed deliberately; dl() already puts
    // each export in the gallery or Downloads. Re-adding a second copy would
    // silently hoard video blobs in IndexedDB again.
    const leftovers = await page.evaluate(() => ({
      globals: ['openExportViewer', 'renderStartupExports', '_recordExport',
        'getExports', 'shareExport', 'setStartupTab']
        .filter((n) => typeof window[n] !== 'undefined'),
      nodes: ['#startup-exports-tab', '#startup-exports-list', '#export-viewer']
        .filter((s) => !!document.querySelector(s)),
      index: localStorage.getItem('keela_exports'),
    }));
    expect(leftovers.globals, 'no export-shelf functions remain').toEqual([]);
    expect(leftovers.nodes, 'no export-shelf nodes remain').toEqual([]);
    expect(leftovers.index, 'no export index in localStorage').toBeNull();

    noErrors();
  });

  test('the legacy export purge clears blobs and runs only once', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await page.addInitScript(() => {
      localStorage.setItem('keela_exports', JSON.stringify([
        { id: 'exp_a', name: 'a.mp4', kind: 'Video', size: 10, date: new Date().toISOString() },
        { id: 'exp_b', name: 'b.gif', kind: 'GIF', size: 10, date: new Date().toISOString() },
      ]));
    });
    await H.boot(page, 'Purge');

    await page.evaluate(async () => {
      await idbPut('exports', 'exp_a', new Blob([new Uint8Array(64)]));
      await idbPut('exports', 'exp_b', new Blob([new Uint8Array(64)]));
    });
    expect(await page.evaluate(async () =>
      (await Promise.all(['exp_a', 'exp_b'].map((k) => idbGet('exports', k).catch(() => null))))
        .every(Boolean)), 'blobs seeded').toBe(true);

    await page.evaluate(() => purgeLegacyExports());
    await expect
      .poll(() => page.evaluate(async () =>
        (await Promise.all(['exp_a', 'exp_b'].map((k) => idbGet('exports', k).catch(() => null))))
          .some(Boolean)), { message: 'blobs are reclaimed' })
      .toBe(false);

    expect(await page.evaluate(() => localStorage.getItem('keela_exports')),
      'the index is dropped').toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('keela_exports_purged')),
      'a flag stops it repeating').toBe('1');

    noErrors();
  });
});

test.describe('project', () => {
  test('save produces a .keela download', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Save');
    await H.ink(page);
    const seen = await captureDownloads(page);

    await page.evaluate(() => saveProject());
    await expect
      .poll(async () => (await seen()).join(','), { message: 'a project file is offered' })
      .toContain('Save');

    noErrors();
  });

  test('a project survives a serialise/restore round trip', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Round');
    await H.addLayers(page, 1);
    await H.addFrames(page, 2);
    await H.ink(page);

    // fps is not global — saveProject reads it from #fps-sel each time.
    const model = () => page.evaluate(() => ({
      frames: totalFrames,
      layers: layers.length,
      names: layers.map((l) => l.name),
      holds: layers.map((l) => l.holds.slice()),
      CW, CH,
      fps: +document.getElementById('fps-sel').value || 12,
    }));
    const before = await model();

    // Same payload shape saveProject writes, so the loader sees a real file.
    const json = await page.evaluate(() => JSON.stringify({
      version: 2, id: projectId, name: projectName || 'animation',
      fps: +document.getElementById('fps-sel').value || 12,
      totalFrames, CW, CH, bg: projectBg,
      layers: layers.map((l) => ({
        name: l.name, visible: l.visible, locked: l.locked ?? false,
        opacity: l.opacity ?? 1, blendMode: l.blendMode || 'source-over',
        color: l.color, holds: [...l.holds],
        frames: l.frames.map((c) => c.canvas.toDataURL('image/png')),
      })),
    }));

    // Round-trip through the loader the same way opening a file would.
    await page.evaluate(async (txt) => {
      const file = new File([txt], 'r.keela', { type: 'application/json' });
      await loadProject(file);
    }, json);
    await page.waitForTimeout(1200);

    expect(await model(), 'the project reloads identically').toEqual(before);

    // And the artwork came back, not just the structure.
    expect(await page.evaluate(() =>
      layers.some((l) => l.frames.some((c) =>
        c.getImageData(0, 0, CW, CH).data.some((v) => v !== 0)))),
      'pixels survived the round trip').toBe(true);

    noErrors();
  });

  test('layers stay in step after add, duplicate and merge', async ({ page }) => {
    const noErrors = H.watchErrors(page);
    await H.boot(page, 'Layers');
    await H.addLayers(page, 2);
    await H.ink(page);

    const consistent = () => page.evaluate(() =>
      layers.every((l) => l.frames.length === totalFrames && l.holds.length === totalFrames));
    expect(await consistent(), 'consistent after adding layers').toBe(true);

    await page.evaluate(() => { curLayer = 0; mergeLayerDown(0); });
    await page.waitForTimeout(600);
    expect(await consistent(), 'consistent after merge').toBe(true);
    expect(await page.evaluate(() => layers.length), 'merge removed one layer').toBe(2);

    noErrors();
  });
});
