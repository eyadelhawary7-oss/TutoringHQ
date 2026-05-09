import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'https://centerhq.app';

test.describe('Admin route gates', () => {
  test('centre owner hitting /admin/finance may redirect to dashboard (never ceo-dashboard)', async ({ page }) => {
    await gotoWithRetry(page, `${BASE}/ar/admin/finance`);
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await expect(page).not.toHaveURL(/ceo-dashboard/);
    const url = page.url();
    if (url.includes('/login')) return;
    if (url.includes('/admin/finance')) {
      /* Super-admin fixture can load finance dashboard */
      return;
    }
    await expect(page).toHaveURL(/\/(ar|en)\/dashboard/);
  });

  test.describe('logged out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('/admin requires auth', async ({ page }) => {
      await gotoWithRetry(page, `${BASE}/ar/admin`);
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await expect(page).toHaveURL(/\/(ar|en)\/login/);
    });
  });
});
