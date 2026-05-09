import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'https://centerhq.app';

const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const MOCK_ORDER = {
  id: ORDER_ID,
  status: 'paid',
  payment_status: 'paid',
  refund_status: null,
  total_amount: 120,
  quantity: 2,
  price_per_card: 62,
  delivery_fee: 10,
  shipping_zone: null,
  delivery_address: '1 Test St',
  delivery_governorate: 'cairo',
  delivery_phone: '+201012345678',
  notes: null,
  card_style: 'dark',
  created_at: '2026-05-09T12:00:00.000Z',
  items: [
    { kind: 'student', student_name: 'Playwright Student', student_number: '101', quantity: 1 },
    { kind: 'blank', quantity: 1 },
  ],
  transitions: [{ to_status: 'paid', created_at: '2026-05-09T12:05:00.000Z' }],
  bosta_tracking_number: null,
  bosta_estimated_delivery_at: null,
  ehg_tax_registration: null,
  receipt_center_name: 'Test Centre',
  receipt_center_address: null,
};

/** Full flow needs a signed-in centre owner + real order; keep mocked API coverage for local iteration. */
test.describe.skip('order detail (requires centre auth — enable when E2E auth storage exists)', () => {
  test('timeline renders for paid order (mocked API)', async ({ page }) => {
    await page.route(`**/api/orders/${ORDER_ID}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ORDER),
      });
    });

    await page.route(`**/api/orders/${ORDER_ID}/receipt`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: {
          'Content-Disposition': 'attachment; filename="centerhq-order-EEEEEEEE.pdf"',
        },
        body: Buffer.from('%PDF-1.4 mock'),
      });
    });

    await gotoWithRetry(page, `${BASE}/en/orders/${ORDER_ID}`);
    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 45_000 });
  });
});
