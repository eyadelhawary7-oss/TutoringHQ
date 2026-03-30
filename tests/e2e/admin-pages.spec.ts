import { test, expect } from '@playwright/test'

test.describe('Admin Platform Pages', () => {
  test('CEO dashboard loads all three founder panels', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/ceo-dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'لوحة معلومات الرئيس التنفيذي' })).toBeVisible()
    await expect(page.getByText(/الموافقات المعلقة/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'تدفقات المبيعات' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'صحة المركز والمخاطر' })).toBeVisible()
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

    await expect(page).not.toHaveURL(/login/)
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

    await expect(page.getByRole('heading', { name: 'تجديد الاشتراك' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })
})

test.describe('Admin Platform Pages — public', () => {
  test('status page loads (public or redirects to login)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/status')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\/(status|login)/)
    expect(errors).toHaveLength(0)
  })
})
