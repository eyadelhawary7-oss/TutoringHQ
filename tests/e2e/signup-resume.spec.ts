import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const SESSION_SNAPSHOT = JSON.stringify({
  stage: 'payment',
  centerName: 'E2E Resume Center',
  ownerName: 'E2E Owner',
  phone: '+201109998877',
  email: 'e2e-resume@test.invalid',
  city: 'cairo',
  plan: 'starter',
  billingPeriod: 'quarterly',
  referralCode: '',
  notes: '',
});

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('signup resume after payment failure (mocked)', () => {
  test('shows card declined message when payment_unavailable invalid_card', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript((snap: string) => {
      sessionStorage.setItem('chq_pending_signup_v1', snap);
    }, SESSION_SNAPSHOT);

    await page.route('**/api/signup/persist', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000022' }),
      });
    });

    await page.route('**/api/signup', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'payment_unavailable', paymob_code: 'invalid_card' }),
      });
    });

    await gotoWithRetry(page, '/ar/signup');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'تأكيد طلبك' })).toBeVisible({ timeout: 30_000 });

    await page.locator('#terms').click();
    await page.getByRole('button', { name: /تأكيد الدفع/ }).click();

    await expect(page.getByText(/تم رفض البطاقة/)).toBeVisible({ timeout: 30_000 });
    expect(errors).toHaveLength(0);
  });
});
