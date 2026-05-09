import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'https://centerhq.app';

test.describe('Login preserves locale and next param', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(({ }, testInfo) => {
    test.skip(!process.env.TEST_PHONE || !process.env.TEST_PIN, 'TEST_PHONE / TEST_PIN required');
  });

  test('en/login → /en/dashboard (no duplicated locale segment)', async ({ page }) => {
    await gotoWithRetry(page, `${BASE}/en/login`);
    await page.locator('input[type="tel"]').fill(process.env.TEST_PHONE!);
    await page.locator('input[type="password"]').fill(process.env.TEST_PIN!);
    await page.getByRole('button', { name: /Submit|إرسال|تسجيل|Sign/i }).click();
    await page.waitForURL(/\/en\/(dashboard|admin)/, { timeout: 60_000 });
    expect(page.url()).not.toMatch(/\/en\/en\//);
    expect(page.url()).toMatch(/\/en\/(dashboard|admin)/);
  });

  test('ar/login → /ar/dashboard', async ({ page }) => {
    await gotoWithRetry(page, `${BASE}/ar/login`);
    await page.locator('input[type="tel"]').fill(process.env.TEST_PHONE!);
    await page.locator('input[type="password"]').fill(process.env.TEST_PIN!);
    await page.getByRole('button', { name: /Submit|إرسال|تسجيل|Sign/i }).click();
    await page.waitForURL(/\/ar\/(dashboard|admin)/, { timeout: 60_000 });
    expect(page.url()).toMatch(/\/ar\/(dashboard|admin)/);
  });

  test('en/login?next=/scan → /en/scan', async ({ page }) => {
    await gotoWithRetry(page, `${BASE}/en/login?next=%2Fscan`);
    await page.locator('input[type="tel"]').fill(process.env.TEST_PHONE!);
    await page.locator('input[type="password"]').fill(process.env.TEST_PIN!);
    await page.getByRole('button', { name: /Submit|إرسال|تسجيل|Sign/i }).click();
    await page.waitForURL(/\/en\/scan/, { timeout: 60_000 });
  });
});
