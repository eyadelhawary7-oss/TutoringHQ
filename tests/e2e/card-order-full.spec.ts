import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

test.describe('admin card orders page', () => {
  test('orders console loads for authenticated admin session', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await gotoWithRetry(page, '/ar/admin/orders');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/(ar|en)\/admin\/orders/);
    expect(errors).toHaveLength(0);
  });
});
