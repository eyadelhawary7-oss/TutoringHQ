import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

test.describe('scanner manual path (fee-zero coverage surface)', () => {
  test('manual mode shows student number entry (zero-fee flows use this path)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await gotoWithRetry(page, '/ar/scan');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'يدوي' }).click();
    await expect(page.locator('#scan-manual-student-id')).toBeVisible();
    await expect(page.getByText('أدخل رقم الطالب')).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
