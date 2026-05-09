import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './goto-with-retry';

const BASE_URL = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'https://centerhq.app';

function attachConsoleErrors(page: Page): string[] {
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
  return errors;
}

async function resetOpenCartIfNeeded(page: Page) {
  await gotoWithRetry(page, `${BASE_URL}/en/orders`);
  await page.waitForLoadState('networkidle');
  const addBtn = page.getByTestId('card-cart-add-students');
  if (await addBtn.isVisible()) return;

  const abandonTrigger = page.getByRole('button', { name: /^Abandon cart$/i }).first();
  await abandonTrigger.click();
  const dialog = page.getByRole('dialog').filter({ hasText: /discard/i });
  await dialog.getByRole('button', { name: /^Abandon cart$/i }).click();
  await expect(page.getByTestId('card-cart-add-students')).toBeVisible({ timeout: 25_000 });
}

test.describe('card order cart foundation', () => {
  test('orders page loads cart chrome without console errors', async ({ page }) => {
    const errors = attachConsoleErrors(page);
    await gotoWithRetry(page, `${BASE_URL}/en/orders`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('card-order-cart-header')).toBeVisible();
    await expect(page.getByTestId('card-order-cart-contents')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('picker, blanks, save-for-later, persistence, abandon', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = attachConsoleErrors(page);
    await resetOpenCartIfNeeded(page);

    await page.getByTestId('card-cart-add-students').click();
    const drawer = page.getByTestId('student-picker-drawer');
    await expect(drawer).toBeVisible();

    const selectable = drawer.locator('input[type="checkbox"]:enabled');
    const n = await selectable.count();
    test.skip(n < 3, 'Need at least 3 eligible students in the test centre');

    for (let i = 0; i < 3; i++) await selectable.nth(i).click();
    await drawer.getByTestId('student-picker-add-selected').click();
    await expect(drawer).toBeHidden({ timeout: 30_000 });

    const cart = page.getByTestId('card-order-cart-contents');
    await expect(cart.getByText(/^Active items$/i)).toBeVisible();
    await expect(cart.getByText(/Cards subtotal/i)).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(cart.getByText(/Cards subtotal/i)).toBeVisible();

    await page.getByRole('button', { name: /^\+ Add blank cards$/ }).click();
    await page.getByRole('dialog').locator('input[type="number"]').fill('2');
    await page.getByRole('dialog').getByRole('button', { name: /^Add blank cards$/ }).click();
    await expect(cart.getByText(/^Extra blank cards$/i)).toBeVisible();

    await cart.getByRole('button', { name: /^Save for later$/i }).first().click();
    await expect(cart.getByText(/^Saved for later$/i)).toBeVisible();

    await resetOpenCartIfNeeded(page);
    await expect(cart.getByText(/Your cart is empty/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Start a new order$/ })).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('students roster bulk add and student detail Order card', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = attachConsoleErrors(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    await resetOpenCartIfNeeded(page);
    await gotoWithRetry(page, `${BASE_URL}/en/orders`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('card-cart-add-students').click();
    const drawer = page.getByTestId('student-picker-drawer');
    await expect(drawer).toBeVisible();
    const selectable = drawer.locator('input[type="checkbox"]:enabled');
    const pick = Math.min(3, await selectable.count());
    test.skip(pick < 3, 'Need at least 3 eligible students');
    for (let i = 0; i < pick; i++) await selectable.nth(i).click();
    await drawer.getByTestId('student-picker-add-selected').click();
    await expect(drawer).toBeHidden({ timeout: 30_000 });

    await gotoWithRetry(page, `${BASE_URL}/en/students`);
    await page.waitForLoadState('networkidle');

    const rowChecks = page.locator('tbody input[type="checkbox"]:enabled');
    const bulkN = Math.min(5, await rowChecks.count());
    test.skip(bulkN < 1, 'No selectable students on roster');
    for (let i = 0; i < bulkN; i++) await rowChecks.nth(i).click();

    await page.getByTestId('students-bulk-add-cart').click();
    await page.waitForTimeout(800);

    await gotoWithRetry(page, `${BASE_URL}/en/orders`);
    await page.waitForLoadState('networkidle');
    const cart = page.getByTestId('card-order-cart-contents');
    await expect(cart.getByText(/Cards subtotal/i)).toBeVisible();

    await gotoWithRetry(page, `${BASE_URL}/en/students`);
    await page.waitForLoadState('networkidle');
    const profileLink = page.locator('tbody a[href*="/students/"]').first();
    await expect(profileLink).toBeVisible({ timeout: 15_000 });
    await profileLink.click();
    await page.waitForLoadState('networkidle');

    const orderBtn = page.getByRole('button', { name: /^Order card$/i });
    if (await orderBtn.isVisible()) {
      await orderBtn.click();
      await expect(page.getByText(/Added to card cart/i)).toBeVisible({ timeout: 10_000 });
    }

    expect(errors).toHaveLength(0);
  });
});
