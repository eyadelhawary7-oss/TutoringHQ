import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

/** Cart with at least one line — centre-owner storage + seeded students. */
test.describe('mobile cart swipe + sticky footer', () => {
  test('sticky footer visible at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await gotoWithRetry(page, '/en/orders');
    await expect(page.getByTestId('card-order-mobile-sticky-footer')).toBeVisible();
  });
});
