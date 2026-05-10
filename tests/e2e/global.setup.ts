import { mkdirSync, existsSync } from 'fs';
import { expect, test as setup } from '@playwright/test';
import path from 'path';
import { gotoWithRetry } from './goto-with-retry';
import { seedE2EDatabase } from './setup/seed';
import { CENTRE_OWNER_AUTH_FILE } from './paths';

const LOGIN_LOCALE = process.env.PLAYWRIGHT_LOGIN_LOCALE?.trim() || 'en';

setup('centre owner auth', async ({ page }) => {
  const phone = process.env.TEST_PHONE?.trim();
  const pin = process.env.TEST_PIN?.trim();
  if (!phone || !pin) {
    throw new Error('TEST_PHONE and TEST_PIN must be set for Playwright setup (see docs/E2E_TESTING.md)');
  }

  await seedE2EDatabase();

  const base = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'https://centerhq.app';

  await gotoWithRetry(page, `${base}/${LOGIN_LOCALE}/login`);
  await page.locator('input[type="tel"]').fill(phone, { timeout: 30_000 });
  await page.locator('input[type="password"]').fill(pin, { timeout: 30_000 });
  await page.getByRole('button', { name: /إرسال|تسجيل|Submit|Sign/i }).click();

  await page.waitForURL(
    /\/(en|ar)\/(dashboard|admin|scan|orders)(\/|$|\?)/,
    { timeout: 90_000 },
  );

  const dir = path.dirname(CENTRE_OWNER_AUTH_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  await page.context().storageState({ path: CENTRE_OWNER_AUTH_FILE });

  const state = await page.context().storageState();
  const names = state.cookies.map((c) => c.name.toLowerCase());
  const hasSession = names.some((n) => n.includes('sb-') && (n.includes('auth') || n.includes('token')));
  expect(hasSession, 'expected Supabase session cookie after login').toBeTruthy();
});
