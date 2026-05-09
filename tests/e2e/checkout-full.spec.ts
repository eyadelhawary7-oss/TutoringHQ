import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'https://centerhq.app';

const OPEN_CART_PAYLOAD = {
  cart: {
    id: '11111111-1111-1111-1111-111111111111',
    status: 'open',
    card_style: 'dark',
    delivery_governorate: 'cairo',
    delivery_address: '123 Nile Street, Cairo',
    delivery_phone: '+201012345678',
    notes: null,
    vendor_notes: null,
    version: 3,
    created_at: '2026-05-09T12:00:00.000Z',
    updated_at: '2026-05-09T12:00:00.000Z',
    last_modified_by: null,
    last_modified_by_name: null,
    submitted_at: null,
    abandoned_at: null,
    card_order_id: null,
  },
  items: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      cart_id: '11111111-1111-1111-1111-111111111111',
      kind: 'student',
      student_id: '33333333-3333-3333-3333-333333333333',
      quantity: 1,
      saved_for_later: false,
      added_at: '2026-05-09T12:00:00.000Z',
      student: {
        name: 'Playwright Student',
        student_number: '101',
        is_active: true,
        center_id: '44444444-4444-4444-4444-444444444444',
      },
      stale: false,
    },
  ],
  minimumQuantity: 1,
};

test.describe('checkout routes', () => {
  test('redirects when GET cart is empty (no open cart)', async ({ page }) => {
    await page.route('**/api/card-order-cart', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cart: null, items: [], minimumQuantity: 1 }),
      });
    });

    await gotoWithRetry(page, `${BASE}/en/orders/checkout`);
    await page.waitForURL(/\/orders\?checkout_error=no_cart/, { timeout: 45_000 });
    await expect(page).toHaveURL(/checkout_error=no_cart/);
  });

  test('redirects when active quantity is below minimum', async ({ page }) => {
    await page.route('**/api/card-order-cart', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cart: OPEN_CART_PAYLOAD.cart,
          items: OPEN_CART_PAYLOAD.items.map((i) => ({ ...i, saved_for_later: true })),
          minimumQuantity: 5,
        }),
      });
    });

    await gotoWithRetry(page, `${BASE}/en/orders/checkout`);
    await page.waitForURL(/\/orders\?checkout_error=below_minimum/, { timeout: 45_000 });
    await expect(page).toHaveURL(/checkout_error=below_minimum/);
  });

  test('delivery step: missing governorate shows validation error', async ({ page }) => {
    const payload = {
      ...OPEN_CART_PAYLOAD,
      cart: {
        ...OPEN_CART_PAYLOAD.cart,
        delivery_governorate: null,
        delivery_address: null,
        delivery_phone: null,
      },
    };

    await page.route('**/api/card-order-cart', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });

    await gotoWithRetry(page, `${BASE}/en/orders/checkout`);
    await expect(page.getByTestId('checkout-delivery')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('checkout-governorate').selectOption('');
    await page.getByTestId('checkout-address').fill('12345 Valid length address here');
    await page.getByTestId('checkout-phone').fill('+20 1012345678');
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page.getByTestId('checkout-delivery')).toBeVisible();
    await expect(page.locator('.text-red-600').first()).toBeVisible();
  });

  test('review: place order stays disabled until terms accepted', async ({ page }) => {
    await page.route('**/api/card-order-cart', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(OPEN_CART_PAYLOAD),
      });
    });

    await gotoWithRetry(page, `${BASE}/en/orders/checkout/review`);
    await expect(page.getByTestId('checkout-review')).toBeVisible({ timeout: 30_000 });
    const cta = page.getByTestId('checkout-place-order');
    await expect(cta).toBeDisabled();
    await page.getByTestId('checkout-terms').check();
    await expect(cta).toBeEnabled();
  });
});
