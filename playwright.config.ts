import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env.test') });
dotenv.config({ path: path.resolve(__dirname, '.env.local') });
dotenv.config({ path: path.resolve(__dirname, 'tests/e2e/.env.local') });

import { defineConfig, devices } from '@playwright/test';

/** Runs without saved session (signup mocks, pricing, locale login, etc.) */
const UNAUTH_SPECS =
  /(login-locale-redirect|pricing-page|signup-happy|signup-resume)\.spec\.ts$/;

/** Mobile viewport suite */
const MOBILE_SPECS = /(mobile-cart|responsive-375)\.spec\.ts$/;

/** Requires super-admin storage + TEST_SUPER_ADMIN_* env */
const ADMIN_SUPER_SPECS = /(admin-pages|card-order-full)\.spec\.ts$/;

/** Authenticated desktop projects exclude unauth-only, mobile-only, and super-admin-only specs */
const DESKTOP_IGNORE =
  /(login-locale-redirect|pricing-page|signup-happy|signup-resume|mobile-cart|responsive-375|admin-pages|card-order-full)\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/e2e',

  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  retries: 0,

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

    screenshot: 'only-on-failure',

    trace: 'retain-on-failure',

    locale: 'ar-EG',

    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'setup-super-admin',
      testMatch: /super-admin\.setup\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'desktop-chrome',
      testIgnore: DESKTOP_IGNORE,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/centre-owner.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-chrome',
      testMatch: MOBILE_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        storageState: 'tests/e2e/.auth/centre-owner.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'unauth-chrome',
      testMatch: UNAUTH_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: 'desktop-super-admin',
      testMatch: ADMIN_SUPER_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/super-admin.json',
      },
      dependencies: ['setup', 'setup-super-admin'],
    },
  ],

  timeout: 90_000,
});
