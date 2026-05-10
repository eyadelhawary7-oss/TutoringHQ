import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE_URL = process.env.BASE_URL ?? 'https://centerhq.app';

test.describe('Centre billing page', () => {
  test('billing page loads for authenticated owner project', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text());
      }
    });

    await gotoWithRetry(page, `${BASE_URL}/ar/billing`);
    await page.waitForLoadState('networkidle');

    const loginVisible = await page.getByRole('heading', { name: /login/i }).isVisible().catch(() => false);
    if (loginVisible) {
      test.skip(true, 'Requires centre-owner storage state');
      return;
    }

    await expect(page.getByRole('heading', { name: /billing|الفوترة/i })).toBeVisible({ timeout: 15000 });
    expect(errors).toHaveLength(0);
  });
});
