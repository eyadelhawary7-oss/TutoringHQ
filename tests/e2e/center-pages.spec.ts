import { test, expect } from '@playwright/test'

test.describe('Center Platform Pages', () => {
  test('dashboard loads with key sections', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'لوحة القيادة' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('scanner page loads without crashing', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/scan')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'الماسح الضوئي QR:' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('students page loads with table or empty state', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/students')
    await page.waitForLoadState('networkidle')

    const title = page.getByRole('heading', { name: 'الطلبة' }).first()
    const emptyTitle = page.getByRole('heading', { name: 'لا يوجد طلاب بعد' })
    await expect(title.or(emptyTitle)).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('payments page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/payments')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'المدفوعات' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('settings page loads with all sections', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/settings')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'الإعدادات' })).toBeVisible()
    await expect(page.getByText('معلومات المركز')).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  test('WhatsApp pack page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/whatsapp-pack')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/login/)
    expect(errors).toHaveLength(0)
  })

  test('orders page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/ar/orders')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'طلباتي' })).toBeVisible()
    expect(errors).toHaveLength(0)
  })

  const NAV_PAGES = [
    '/ar/groups',
    '/ar/schedule',
    '/ar/rooms',
    '/ar/attendance',
    '/ar/analytics',
    '/ar/referrals',
    '/ar/academic',
  ]

  for (const path of NAV_PAGES) {
    test(`${path} loads without crashing`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))

      await page.goto(path)
      await page.waitForLoadState('networkidle')

      await expect(page.locator('body')).not.toBeEmpty()
      expect(errors).toHaveLength(0)
    })
  }
})

test.describe('Center Platform Pages — unauthenticated', () => {
  test('404 page renders for unknown route', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    const response = await page.goto('/ar/this-route-does-not-exist-xyz')
    expect(response?.status()).toBe(404)
    expect(errors).toHaveLength(0)
  })
})
