import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'line',
  // REBAKE_URL points the suite at a deployed site instead of the local build.
  use: { baseURL: process.env.REBAKE_URL ?? 'http://127.0.0.1:4319', acceptDownloads: true },
  ...(process.env.REBAKE_URL ? {} : {
    webServer: {
      command: 'node scripts/serve.mjs',
      url: 'http://127.0.0.1:4319',
      reuseExistingServer: false,
    },
  }),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Safari never runs on Linux, and WebKit's GStreamer codecs there aren't Safari's.
    // CI runs these two on macOS instead, in the webkit-media job.
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, ...(process.platform === 'linux' ? { testIgnore: /(media|hdr)\.spec\.ts$/ } : {}) },
    // Playwright's Chromium ships no HEVC, so real HEVC behaviour needs real Chrome.
    ...(process.env.CI ? [] : [{ name: 'chrome', testMatch: /(media|hdr|drawer|batch)\.spec\.ts$/, use: { ...devices['Desktop Chrome'], channel: 'chrome' } }]),
  ],
});
