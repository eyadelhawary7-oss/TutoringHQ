import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './goto-with-retry'

const BASE_URL = process.env.BASE_URL ?? 'https://centerhq.app'

test.describe('Center Platform Pages', () => {
  test('dashboard loads with key sections', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await gotoWithRetry(page, `${BASE_URL}/ar/dashboard`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('scanner page loads without crashing', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await gotoWithRetry(page, `${BASE_URL}/ar/scan`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('students page loads with table or empty state', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await gotoWithRetry(page, `${BASE_URL}/ar/students`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('payments page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await gotoWithRetry(page, `${BASE_URL}/ar/payments`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('settings page loads with all sections', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await gotoWithRetry(page, `${BASE_URL}/ar/settings`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('WhatsApp pack page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await gotoWithRetry(page, `${BASE_URL}/ar/whatsapp-pack`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('orders page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await gotoWithRetry(page, `${BASE_URL}/ar/orders`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
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

      await gotoWithRetry(page, `${BASE_URL}${path}`)
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

    const response = await gotoWithRetry(page, '/ar/this-route-does-not-exist-xyz')
    expect(response?.status()).toBe(404)
    expect(errors).toHaveLength(0)
  })
})
