import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

test.describe('scanner offline banner', () => {
  test('health probe failure shows offline banner copy', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.route('**/api/health', async (route) => route.abort());

    await gotoWithRetry(page, '/ar/scan');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('غير متصل — الحضور يُحفظ محلياً')).toBeVisible({ timeout: 30_000 });
    expect(errors).toHaveLength(0);
  });
});
