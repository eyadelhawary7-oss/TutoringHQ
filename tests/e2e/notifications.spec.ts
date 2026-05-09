import { test, expect } from '@playwright/test';

/**
 * Requires authenticated centre session + seeded order that triggers in_app_notifications.
 * Enable when Playwright auth storage state is available for a test centre.
 */
test.describe.skip('notifications bell', () => {
  test('badge and navigation', async ({ page }) => {
    await page.goto('/en/orders');
    await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible();
  });
});
