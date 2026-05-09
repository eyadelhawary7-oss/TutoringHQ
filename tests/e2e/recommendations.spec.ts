import { test, expect } from '@playwright/test';

/** Needs centre with ≥1 student without blocking card order + empty cart. */
test.describe.skip('cart recommendations', () => {
  test('empty cart shows recommendations section', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/en/orders');
    await expect(page.getByTestId('cart-rec-without-cards')).toBeVisible();
  });
});
