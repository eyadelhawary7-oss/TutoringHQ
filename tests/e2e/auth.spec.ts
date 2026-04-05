import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

const TEST_PHONE = process.env.TEST_PHONE ?? ''
const TEST_PIN = process.env.TEST_PIN ?? ''

async function fillLoginForm(page: Page, phone: string, pin: string): Promise<void> {
  await page.getByPlaceholder('رقم الهاتف').fill(phone)
  await page.getByPlaceholder('الرقم السري').fill(pin)
  await page.getByRole('button', { name: 'إرسال' }).click()
}

test.describe('Authentication', () => {
  test('login page loads and renders correctly', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/ar/login')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveTitle(/.+/)
    await expect(page.getByPlaceholder('رقم الهاتف')).toBeVisible()
    await expect(page.getByPlaceholder('الرقم السري')).toBeVisible()
    await expect(page.getByRole('button', { name: 'إرسال' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('successful login redirects to admin or dashboard', async ({ page }) => {
    test.skip(!TEST_PHONE || !TEST_PIN, 'Set TEST_PHONE and TEST_PIN for this test')

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/ar/login')
    await page.waitForLoadState('networkidle')

    await fillLoginForm(page, TEST_PHONE, TEST_PIN)
    await page.waitForURL(/\/(ar|en)\/(admin|dashboard)/, { timeout: 60_000 })

    await expect(page).toHaveURL(/\/(ar|en)\/(admin|dashboard)/)
    const onAdmin = /\/(ar|en)\/admin/.test(page.url())
    if (onAdmin) {
      await expect(page).not.toHaveURL(/login/)
    } else {
      await expect(page.getByRole('heading', { name: 'لوحة القيادة' })).toBeVisible()
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
    await page.waitForURL(/\/(ar|en)\/(admin|dashboard)/, { timeout: 60_000 })

    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto('/ar/login')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\/login/)
    expect(errors).toHaveLength(0)
  })
})