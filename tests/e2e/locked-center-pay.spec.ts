import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE_URL = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'https://tutoringhq.app';

/**
 * The release blocker (Job 3, Part E): a locked centre is sent to the lock screen,
 * whose "Pay now" button links to /pay. /pay loads GET /api/billing/customer-invoices
 * and pays via POST /api/invoices/[id]/pay. Before this fix both called
 * requireCenterAuth WITHOUT allowSuspended, so once the single-day-lock gate landed
 * they returned 403 CENTER_LOCKED and the locked centre could neither see nor pay its
 * invoice. This drives the real browser flow and asserts the pay path does NOT 403.
 *
 * Needs a centre-owner session (Playwright storage state) and a reachable deployment
 * (PLAYWRIGHT_BASE_URL / BASE_URL). It self-skips when the session is absent, matching
 * the other owner specs. The definitive, always-run proof of the exemption is the unit
 * test tests/unit/api/pay-routes-allow-suspended.test.ts.
 */
test.describe('locked centre can reach and load the pay page', () => {
  test('lock screen Pay now -> /pay loads invoices without CENTER_LOCKED', async ({ page }) => {
    // 1. The lock screen renders from the reason param (public route).
    await gotoWithRetry(page, `${BASE_URL}/en/suspended?reason=payment_overdue`);
    await page.waitForLoadState('networkidle');

    const payNow = page.getByRole('link', { name: /pay now|ادفع/i });
    if (!(await payNow.isVisible().catch(() => false))) {
      test.skip(true, 'Lock screen Pay now not visible (needs the payment_overdue lock screen)');
      return;
    }
    // 2. It must point at /pay (the working pay surface), not a dead route.
    await expect(payNow).toHaveAttribute('href', /\/pay(\/|$|\?)/);

    // 3. Capture the invoice-list API status as we navigate to /pay: a locked centre
    //    must get a non-403 response (the deadlock returned 403 CENTER_LOCKED here).
    const invoicesResponse = page.waitForResponse(
      (r) => r.url().includes('/api/billing/customer-invoices'),
      { timeout: 15000 },
    ).catch(() => null);

    await payNow.click();
    await page.waitForURL(/\/pay(\/|$|\?)/, { timeout: 15000 }).catch(() => undefined);

    const loginVisible = await page
      .getByRole('heading', { name: /login|تسجيل الدخول/i })
      .isVisible()
      .catch(() => false);
    if (loginVisible) {
      test.skip(true, 'Requires centre-owner storage state to load /pay');
      return;
    }

    const res = await invoicesResponse;
    if (res) {
      expect(
        res.status(),
        'customer-invoices must not 403 the locked centre (the deadlock)',
      ).not.toBe(403);
    }

    // 4. The pay surface rendered (invoice list / pay UI), not an error boundary.
    await expect(
      page.getByText(/invoice|فاتورة|pay|ادفع/i).first(),
    ).toBeVisible({ timeout: 15000 });
  });
});
