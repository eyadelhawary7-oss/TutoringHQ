import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'https://centerhq.app';

/**
 * Requires authenticated centre session + optional notifications in DB.
 */
test.describe('notifications bell', () => {
  test('badge and navigation', async ({ page }) => {
    await gotoWithRetry(page, `${BASE}/en/orders`);
    await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible();
  });
});
