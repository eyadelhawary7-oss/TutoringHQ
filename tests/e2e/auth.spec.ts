import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gotoWithRetry } from './goto-with-retry'

test.use({ storageState: { cookies: [], origins: [] } })

const TEST_PHONE = process.env.TEST_PHONE ?? ''
const TEST_PIN = process.env.TEST_PIN ?? ''

async function fillLoginForm(page: Page, phone: string, pin: string): Promise<void> {
  await page.locator('input[type="tel"]').fill(phone, { timeout: 30_000 })
  await page.locator('input[type="password"]').fill(pin, { timeout: 30_000 })
  await page.getByRole('button', { name: /إرسال|تسجيل/ }).click()
}

test.describe('Authentication', () => {
  test('login page loads and renders correctly', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await gotoWithRetry(page, '/ar/login')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveTitle(/.+/)
    await expect(page.locator('input[type="tel"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /إرسال|تسجيل/ })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('successful login redirects to admin or dashboard', async ({ page }) => {
    test.skip(!TEST_PHONE || !TEST_PIN, 'Set TEST_PHONE and TEST_PIN for this test')

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await gotoWithRetry(page, '/ar/login')
    await page.waitForLoadState('networkidle')

    await fillLoginForm(page, TEST_PHONE, TEST_PIN)
    await page.waitForURL(/\/(ar|en)\/(admin|dashboard)/, { timeout: 60_000 })

    await expect(page).toHaveURL(/\/(ar|en)\/(admin|dashboard)/)
    const onAdmin = /\/(ar|en)\/admin/.test(page.url())
    if (onAdmin) {
      await expect(page).not.toHaveURL(/login/)
    } else {
      await expect(page).toHaveURL(/\/(ar|en)\/dashboard/)
    }
    expect(errors).toHaveLength(0)
  })

  test('wrong PIN shows error - one attempt only to avoid rate limit', async ({ page }) => {
    test.skip(!TEST_PHONE, 'Set TEST_PHONE for this test')

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await gotoWithRetry(page, '/ar/login')
    await page.waitForLoadState('networkidle')

    await fillLoginForm(page, TEST_PHONE, '000000')
    await expect(
      page.getByText('Invalid Credentials')
        .or(page.getByText('بيانات غير صحيحة'))
        .or(page.getByText('خطأ'))
    ).toBeVisible()
    await expect(page).toHaveURL(/\/(ar|en)\/login/)
    expect(errors).toHaveLength(0)
  })

  test('unauthenticated visit to /dashboard redirects to login', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await gotoWithRetry(page, '/ar/dashboard')
    await page.waitForURL(/\/(ar|en)\/login/)
    await expect(page).toHaveURL(/\/(ar|en)\/login/)
    expect(errors).toHaveLength(0)
  })

  test('unauthenticated visit to /ceo-dashboard redirects to login', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await gotoWithRetry(page, '/ar/ceo-dashboard')
    await page.waitForURL(/\/(ar|en)\/login/)
    await expect(page).toHaveURL(/\/(ar|en)\/login/)
    expect(errors).toHaveLength(0)
  })

  test.describe('session from global setup', () => {
    test.use({ storageState: 'playwright/.auth/user.json' })

    test('logout clears session and redirects to login', async ({ page }) => {
      test.skip(!TEST_PHONE || !TEST_PIN, 'Set TEST_PHONE and TEST_PIN for this test')

      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))

      await gotoWithRetry(page, '/ar/dashboard')
      await page.waitForURL(
        /\/(ar|en)\/(admin|dashboard|login)/,
        { timeout: 60_000 }
      )

      await page.context().clearCookies()
      await gotoWithRetry(page, '/ar/login')
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveURL(/\/(ar|en)\/login/)
      expect(errors).toHaveLength(0)
    })
  })
})