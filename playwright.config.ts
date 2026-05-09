import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '.env.test') })
dotenv.config({ path: path.resolve(__dirname, '.env.local') })

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
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ??
      process.env.BASE_URL ??
      'https://centerhq.app',

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
      name: 'setup',
      testMatch: '**/global.setup.ts',
    },
    {
      name: 'desktop-chrome',
      testIgnore: '**/responsive-375.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-chrome',
      testIgnore: '**/responsive-375.spec.ts',
      use: {
        ...devices['Pixel 5'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    /** Session 14 — iPhone SE-class viewport; same auth fixture as desktop smoke. */
    {
      name: '375-chrome',
      testMatch: '**/responsive-375.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  timeout: 90_000,
})
