import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const TEST_PHONE = process.env.TEST_PHONE ?? ''
const TEST_PIN = process.env.TEST_PIN ?? ''

async function login(page: Page): Promise<void> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto('/ar/login')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('+20 1XXXXXXXXX').fill(TEST_PHONE)
  await page.getByPlaceholder('••••••').fill(TEST_PIN)
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
  await page.waitForURL(/\/(ar|en)\/(admin|dashboard)/)
  expect(errors).toHaveLength(0)
}

test.describe('Admin Platform Pages', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!TEST_PHONE || !TEST_PIN, 'Set TEST_PHONE and TEST_PIN')
    await login(page)
  })

  test('CEO dashboard loads all three founder panels', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/ceo-dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'لوحة المدير التنفيذي' })).toBeVisible()
    await expect(page.getByText('موافقات معلقة')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'خط المبيعات' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'صحة السناتر والمخاطر' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('time range selector updates URL with selected range', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/en/ceo-dashboard')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Last Month' }).click()

    await expect(page).toHaveURL(/[?&]range=last_month(?:&|$)/)

    await page.waitForLoadState('networkidle')
    expect(errors).toHaveLength(0)
  })

  test('all 8 time range pills are visible', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/en/ceo-dashboard')
    await page.waitForLoadState('networkidle')

    for (const label of [
      'This Month',
      'Last Month',
      'This Quarter',
      'Last Quarter',
      'Last 6 Months',
      'This Year',
      'Last Year',
      'All Time',
    ]) {
      await expect(page.getByRole('button', { name: label })).toBeVisible()
    }
    expect(errors).toHaveLength(0)
  })

  test('admin panel index loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/admin')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('إجمالي السناتر')).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('admin WhatsApp pack page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/admin/whatsapp-pack')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'إدارة باقة واتساب' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('admin orders page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/admin/orders')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'طلبات البطاقات' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('admin renewals page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/admin/renewals')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'تجديدات الاشتراك' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('public status page loads without authentication', async ({ page }) => {
    await page.context().clearCookies()

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/status')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByRole('heading', { name: /CenterHQ/ })).toBeVisible()
    expect(errors).toHaveLength(0)
  })
})
