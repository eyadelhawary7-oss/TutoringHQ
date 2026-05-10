import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { test as setup } from '@playwright/test';
import path from 'path';
import { gotoWithRetry } from './goto-with-retry';
import { SUPER_ADMIN_AUTH_FILE } from './paths';

const LOGIN_LOCALE = process.env.PLAYWRIGHT_LOGIN_LOCALE?.trim() || 'en';

const EMPTY_STORAGE = JSON.stringify({ cookies: [], origins: [] }, null, 2);

setup('super admin auth', async ({ page }) => {
  const dir = path.dirname(SUPER_ADMIN_AUTH_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const phone = process.env.TEST_SUPER_ADMIN_PHONE?.trim();
  const pin = process.env.TEST_SUPER_ADMIN_PIN?.trim();

  if (!phone || !pin) {
    writeFileSync(SUPER_ADMIN_AUTH_FILE, EMPTY_STORAGE, 'utf8');
    return;
  }

  const base = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'https://centerhq.app';

  await gotoWithRetry(page, `${base}/${LOGIN_LOCALE}/login`);
  await page.locator('input[type="tel"]').fill(phone, { timeout: 30_000 });
  await page.locator('input[type="password"]').fill(pin, { timeout: 30_000 });
  await page.getByRole('button', { name: /إرسال|تسجيل|Submit|Sign/i }).click();

  await page.waitForURL(
    /\/(en|ar)\/(dashboard|admin|scan|orders)(\/|$|\?)/,
    { timeout: 90_000 },
  );

  await page.context().storageState({ path: SUPER_ADMIN_AUTH_FILE });
});
