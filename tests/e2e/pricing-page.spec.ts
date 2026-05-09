import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'https://centerhq.app';

/** `/pricing` redirects into the signup funnel (Prompt 7 PART D). Plan matrix lives at stage `plan`. */
test.describe('Pricing / signup plan matrix', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('seven rows: six tiers + Top Centers; Solo quarterly baseline visible', async ({ page }) => {
    await gotoWithRetry(page, `${BASE}/en/pricing`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/en\/signup/);

    await page.locator('#su-center').fill('E2E Pricing Center');
    await page.locator('#su-owner').fill('E2E Owner');
    await page.locator('#su-phone').fill('+201012345678');
    await page.locator('#su-city').selectOption('cairo');

    await page.getByRole('button', { name: /Continue to plans/i }).click();

    const planTiers = page.locator('button.group.relative.w-full.border-b');
    await expect(planTiers).toHaveCount(6, { timeout: 30_000 });

    await expect(page.getByRole('button', { name: /Top Centers/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Top Centers/i })).toContainText(/Custom pricing/i);

    await planTiers.first().click();
    await page.getByRole('button', { name: /^Quarterly$/ }).first().click();

    await expect(planTiers.first()).toContainText(/999/);
  });
});
