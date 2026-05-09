import { test, expect } from '@playwright/test';

/** Requires cart with at least one student line. */
test.describe.skip('mobile cart swipe + sticky footer', () => {
  test('sticky footer visible at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/en/orders');
    await expect(page.getByTestId('card-order-mobile-sticky-footer')).toBeVisible();
  });
});
