import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

// Trial-first signup: no payment step. Submitting a valid form provisions the owner
// and redirects the browser to /set-pin (owner PIN setup). This spec drives the
// resumed 'payment' stage, accepts both PDPL consents, clicks "Start free trial",
// and asserts the redirect to /set-pin (the signup API is mocked to succeed).
const SESSION_SNAPSHOT = JSON.stringify({
  stage: 'payment',
  centerName: 'E2E Center',
  ownerName: 'E2E Owner',
  phone: '+201112223344',
  email: 'e2e-signup@test.invalid',
  city: 'cairo',
  plan: 'starter',
  billingPeriod: 'monthly',
  referralCode: '',
  notes: '',
});

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('signup happy path (trial-first, mocked signup API)', () => {
  test('accepting consents + Start free trial redirects to /set-pin', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript((snap: string) => {
      sessionStorage.setItem('chq_pending_signup_v1', snap);
    }, SESSION_SNAPSHOT);

    await page.route('**/api/signup/persist', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000011' }),
      });
    });

    await page.route('**/api/signup', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          pinSetup: true,
          center_id: '00000000-0000-4000-8000-000000000011',
        }),
      });
    });

    await gotoWithRetry(page, '/ar/signup');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'تأكيد طلبك' })).toBeVisible({ timeout: 30_000 });

    // Both PDPL consents are mandatory (terms + data-processing).
    await page.locator('#consent-terms').click();
    await page.locator('#consent-privacy').click();
    await page.getByRole('button', { name: /ابدأ التجربة المجانية/ }).click();

    // Trial-first redirects to the owner PIN-setup page (no success screen, no payment).
    await page.waitForURL('**/set-pin', { timeout: 30_000 });
    expect(page.url()).toContain('/set-pin');
    expect(errors).toHaveLength(0);
  });
});
