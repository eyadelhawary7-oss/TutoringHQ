import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const TEST_PHONE = process.env.TEST_PHONE ?? ''
const TEST_PIN = process.env.TEST_PIN ?? ''

/** Selectors from `src/app/[locale]/login/page.tsx` — Arabic copy from `messages/ar.json` (`login`). */
async function fillLoginForm(page: Page, phone: string, pin: string): Promise<void> {
  await page.getByPlaceholder('+20 1XXXXXXXXX').fill(phone)
  await page.getByPlaceholder('••••••').fill(pin)
  await page.getByRole('button', { name: 'الدخول إلى المنصة' }).click()
}

test.describe('Authentication', () => {
  test('login page loads and renders correctly', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/ar/login')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveTitle(/.+/)
    await expect(page.getByRole('heading', { name: 'CenterHQ' })).toBeVisible()
    await expect(page.getByText('تسجيل الدخول إلى CenterHQ')).toBeVisible()
    await expect(page.getByText('رقم الهاتف', { exact: true })).toBeVisible()
    await expect(page.getByText('الرمز السري', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('+20 1XXXXXXXXX')).toBeVisible()
    await expect(page.getByPlaceholder('••••••')).toBeVisible()
    await expect(page.getByRole('button', { name: 'الدخول إلى المنصة' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('successful login redirects to admin or dashboard', async ({ page }) => {
    test.skip(!TEST_PHONE || !TEST_PIN, 'Set TEST_PHONE and TEST_PIN for this test')

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/ar/login')
    await page.waitForLoadState('networkidle')

    await fillLoginForm(page, TEST_PHONE, TEST_PIN)
    await page.waitForURL(/\/(ar|en)\/(admin|dashboard)/)

    await expect(page).toHaveURL(/\/(ar|en)\/(admin|dashboard)/)
    // Super-admin test account lands on admin; owners land on dashboard — smoke either shell.
    const onAdmin = /\/(ar|en)\/admin/.test(page.url())
    if (onAdmin) {
      await expect(page.getByRole('banner').getByText('CenterHQ', { exact: true })).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible()
    }
    expect(errors).toHaveLength(0)
  })

  test('wrong PIN shows error — one attempt only to avoid rate limit', async ({ page }) => {
    test.skip(!TEST_PHONE, 'Set TEST_PHONE for this test')

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/ar/login')
    await page.waitForLoadState('networkidle')

    await fillLoginForm(page, TEST_PHONE, '000000')
    await expect(page.getByText('رقم هاتف غير صالح')).toBeVisible()
    await expect(page).toHaveURL(/\/(ar|en)\/login/)
    expect(errors).toHaveLength(0)
  })

  test('unauthenticated visit to /dashboard redirects to login', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/ar/dashboard')
    await page.waitForURL(/\/(ar|en)\/login/)
    await expect(page).toHaveURL(/\/(ar|en)\/login/)
    expect(errors).toHaveLength(0)
  })

  test('unauthenticated visit to /ceo-dashboard redirects to login', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/ar/ceo-dashboard')
    await page.waitForURL(/\/(ar|en)\/login/)
    await expect(page).toHaveURL(/\/(ar|en)\/login/)
    expect(errors).toHaveLength(0)
  })

  test('logout clears session and redirects to login', async ({ page }) => {
    test.skip(!TEST_PHONE || !TEST_PIN, 'Set TEST_PHONE and TEST_PIN for this test')

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/ar/login')
    await page.waitForLoadState('networkidle')

    await fillLoginForm(page, TEST_PHONE, TEST_PIN)
    await page.waitForURL(/\/(ar|en)\/(admin|dashboard)/)

    if (/\/(ar|en)\/admin/.test(page.url())) {
      await page.locator('header [data-user-menu-container] button').click()
      await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
    } else {
      await page.goto('/ar/settings')
      await page.waitForLoadState('networkidle')
      await page.getByRole('button', { name: 'تسجيل الخروج' }).click()
    }

    await page.waitForURL(/\/(ar|en)\/login/)
    await expect(page).toHaveURL(/\/(ar|en)\/login/)
    expect(errors).toHaveLength(0)
  })
})
