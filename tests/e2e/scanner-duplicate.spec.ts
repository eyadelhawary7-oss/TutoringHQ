import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

test.describe('scanner duplicate / history surface', () => {
  test('today history section renders empty state (duplicate rows show ⋈ in-app)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await gotoWithRetry(page, '/ar/scan');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('سجل المسح اليوم')).toBeVisible();
    await expect(page.getByText('لا توجد مسحات بعد')).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
