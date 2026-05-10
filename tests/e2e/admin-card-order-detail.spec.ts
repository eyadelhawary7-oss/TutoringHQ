import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

/** Matches seed paid row in tests/e2e/setup/seed.ts */
const SEED_PAID_ORDER_ID = 'e2eca501-2001-4001-8001-000000000001';

test.describe('admin card order detail', () => {
  test.beforeEach(() => {
    test.skip(!process.env.TEST_SUPER_ADMIN_PHONE?.trim(), 'TEST_SUPER_ADMIN_PHONE not configured');
  });

  test('renders detail and can apply manual transition with reason', async ({ page }) => {
    await gotoWithRetry(page, `/ar/admin/card-orders/${SEED_PAID_ORDER_ID}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('admin-card-order-detail')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await expect(page.getByTestId('admin-card-order-transitions')).toBeVisible();
    await expect(page.getByTestId('admin-card-order-actions')).toBeVisible();

    const select = page.getByTestId('admin-card-order-advance-select');
    const optionCount = await select.locator('option').count();
    test.skip(optionCount <= 1, 'No manual transition available for this order');

    const post = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes('/api/admin/card-orders/') &&
        r.url().endsWith('/transition'),
    );

    await select.selectOption({ index: 1 });

    const reason =
      'E2E manual advance from paid to vendor_assigned with sufficient length for validation.';
    await page.locator('textarea').fill(reason);

    void page.getByTestId('admin-card-order-transition-confirm').click();
    const res = await post;
    expect([200, 409]).toContain(res.status());
  });
});
