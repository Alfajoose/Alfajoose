// Frame Twelve test configuration.
//
// The app is a single self-contained HTML file with no build step and no server,
// so every spec loads it over file:// straight from web/. Nothing to start, and
// the suite tests exactly the bytes that ship.
//
// Two projects, because almost every bug this suite exists to catch was
// width-dependent: the app switches metrics at 560px, and the desktop and phone
// paths disagreed more than once. Running both is the point.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Canvas work and GIF encoding are genuinely slow; a stingy timeout here just
  // produces flakes that get ignored.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    // Diagnostics only on failure — a green run should leave no artifacts.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 860 },
      },
    },
  ],
});
