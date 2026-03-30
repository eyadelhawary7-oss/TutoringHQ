import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',

  // Tests within a file run sequentially — prevents auth state collisions
  fullyParallel: false,

  // Fail fast in CI — stop on first failure to save time and credits
  forbidOnly: !!process.env.CI,

  // No retries — flaky tests must be fixed, not hidden
  retries: 0,

  // Single worker in CI to avoid rate limiting on the login endpoint
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: process.env.BASE_URL ?? 'https://center-hq.vercel.app',

    // Screenshot on failure only
    screenshot: 'only-on-failure',

    // Trace on failure for debugging
    trace: 'retain-on-failure',

    // Arabic locale — matches app default
    locale: 'ar-EG',

    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  timeout: 90_000,
})
