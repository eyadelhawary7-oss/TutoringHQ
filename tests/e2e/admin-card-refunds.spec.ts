import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'https://centerhq.app';

test.describe('Admin card refunds console', () => {
  test.beforeEach(() => {
    test.skip(!process.env.TEST_SUPER_ADMIN_PHONE?.trim(), 'TEST_SUPER_ADMIN_PHONE not configured');
  });

  test('card refunds page loads for super-admin session', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await gotoWithRetry(page, `${BASE}/en/admin/card-refunds`);
    await page.waitForLoadState('networkidle').catch(() => {});

    await expect(page).toHaveURL(/\/(ar|en)\/admin\/card-refunds/);
    await expect(page.getByRole('heading', { name: /Card order refunds|استرداد طلبات البطاقات/i })).toBeVisible({
      timeout: 30_000,
    });
    expect(errors).toHaveLength(0);
  });
});
