import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

/** Needs centre with students without blocking paid student lines + recommendations API data. */
test.describe('cart recommendations', () => {
  test('empty cart shows recommendations section', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await gotoWithRetry(page, '/en/orders');
    await expect(page.getByTestId('cart-rec-without-cards')).toBeVisible();
  });
});
