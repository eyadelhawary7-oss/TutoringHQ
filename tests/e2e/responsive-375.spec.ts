/**
 * Session 14 — Mobile 375px baseline (iPhone SE / compact Android).
 * Viewport 375×812; captures screenshots and asserts layout sanity (no horizontal page scroll, 44px touch targets).
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { mkdirSync } from 'fs';
import { gotoWithRetry } from './goto-with-retry';

const LOCALE = 'ar';
const BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'https://centerhq.app';

const shotDir = path.join(__dirname, '__screenshots__', '375px');

function ensureShotDir() {
  try {
    mkdirSync(shotDir, { recursive: true });
  } catch {
    /* exists */
  }
}

async function assertNoHorizontalScroll(page: import('@playwright/test').Page) {
  const delta = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(delta, 'document should not overflow horizontally').toBeLessThanOrEqual(1);
}

/** Visible in-viewport controls should meet ~44px minimum (WCAG 2.5.5). */
async function assertTouchTargets(page: import('@playwright/test').Page) {
  const failures = await page.evaluate(() => {
    const min = 44;
    const selectors =
      'button, a[href], [role="button"], [role="tab"], input:not([type="hidden"]), select, textarea';
    const nodes = Array.from(document.querySelectorAll(selectors)) as HTMLElement[];
    const bad: string[] = [];
    for (const el of nodes) {
      if (el.closest('[data-responsive-skip-targets]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const st = window.getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
      if (r.bottom < -2 || r.top > window.innerHeight + 2) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;
      if (r.width + 0.5 < min || r.height + 0.5 < min) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32);
        bad.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)} "${label}"`);
      }
    }
    return bad.slice(0, 25);
  });
  expect(failures, failures.join('\n')).toEqual([]);
}

async function walk(page: import('@playwright/test').Page, name: string, url: string) {
  await gotoWithRetry(page, url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await assertNoHorizontalScroll(page);
  ensureShotDir();
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true });
  await assertTouchTargets(page);
}

test.describe('375px — public routes', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    storageState: { cookies: [], origins: [] },
  });

  test('landing, pricing, login, terms, privacy', async ({ page }) => {
    await walk(page, 'public-home', `${BASE}/`);
    await walk(page, 'public-pricing', `${BASE}/${LOCALE}/pricing`);
    await walk(page, 'public-login', `${BASE}/${LOCALE}/login`);
    await walk(page, 'public-terms', `${BASE}/${LOCALE}/terms`);
    await walk(page, 'public-privacy', `${BASE}/${LOCALE}/privacy`);
  });

  test('signup funnel (steps surfaced on one page)', async ({ page }) => {
    await walk(page, 'signup-step1', `${BASE}/${LOCALE}/signup`);
  });
});

test.describe('375px — centre owner (authenticated)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('owner shell routes', async ({ page }) => {
    await walk(page, 'owner-dashboard', `${BASE}/${LOCALE}/dashboard`);
    await walk(page, 'owner-scan', `${BASE}/${LOCALE}/scan`);
    await walk(page, 'owner-students', `${BASE}/${LOCALE}/students`);
    await walk(page, 'owner-schedule', `${BASE}/${LOCALE}/schedule`);
    await walk(page, 'owner-groups', `${BASE}/${LOCALE}/groups`);
    await walk(page, 'owner-branches', `${BASE}/${LOCALE}/branches`);
    await walk(page, 'owner-whatsapp', `${BASE}/${LOCALE}/whatsapp`);
    await walk(page, 'owner-orders', `${BASE}/${LOCALE}/orders`);
    await walk(page, 'owner-orders-new', `${BASE}/${LOCALE}/orders/new`);
    await walk(page, 'owner-settings-billing', `${BASE}/${LOCALE}/settings/billing`);
    await walk(page, 'owner-settings-profile', `${BASE}/${LOCALE}/settings/profile`);
  });
});

test.describe('375px — admin (super_admin only)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('admin surfaces', async ({ page }) => {
    await gotoWithRetry(page, `${BASE}/${LOCALE}/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    test.skip(
      page.url().includes('/login'),
      'TEST_SUPER_ADMIN_PHONE not configured or user is not super_admin — admin 375 matrix needs elevated session',
    );

    const adminUrls: [string, string][] = [
      ['admin-overview', `${BASE}/${LOCALE}/admin`],
      ['admin-finance', `${BASE}/${LOCALE}/admin/finance`],
      ['admin-billing', `${BASE}/${LOCALE}/admin/billing`],
      ['admin-centers-tab', `${BASE}/${LOCALE}/admin?tab=centers`],
      ['admin-health', `${BASE}/${LOCALE}/admin/health`],
      ['admin-staff', `${BASE}/${LOCALE}/admin/staff`],
      ['admin-whatsapp-pack', `${BASE}/${LOCALE}/admin/whatsapp-pack`],
      ['admin-pending-signups', `${BASE}/${LOCALE}/admin/pending-signups`],
      ['admin-pricing', `${BASE}/${LOCALE}/admin/pricing`],
      ['admin-internal-team', `${BASE}/${LOCALE}/admin?tab=internalTeam`],
      ['admin-platform-config', `${BASE}/${LOCALE}/admin/platform-config`],
      ['admin-center-assignments', `${BASE}/${LOCALE}/admin/center-assignments`],
    ];
    for (const [name, url] of adminUrls) {
      await walk(page, name, url);
    }
  });
});
