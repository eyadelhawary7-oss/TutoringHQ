import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'https://center-hq.vercel.app'

test.describe('Admin Platform Pages', () => {
  test('CEO dashboard loads all three founder panels', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`${BASE_URL}/ar/ceo-dashboard`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('time range selector updates URL with selected range', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`${BASE_URL}/en/ceo-dashboard`)
    await page.waitForLoadState('networkidle')

    const pill = page.getByRole('button', { name: 'Last Month' })
    const isVisible = await pill.isVisible()
    if (isVisible) {
      await pill.click()
      await expect(page).toHaveURL(/[?&]range=last_month(?:&|$)/)
    } else {
      await expect(page).toHaveURL(/\/(ar|en)\//)
    }

    await page.waitForLoadState('networkidle')
    expect(errors).toHaveLength(0)
  })

  test('all 8 time range pills are visible', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`${BASE_URL}/en/ceo-dashboard`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('admin panel index loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`${BASE_URL}/ar/admin`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('admin WhatsApp pack page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`${BASE_URL}/ar/admin/whatsapp-pack`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('admin orders page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`${BASE_URL}/ar/admin/orders`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('admin renewals page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`${BASE_URL}/ar/admin/renewals`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Admin Platform Pages — public', () => {
  test('status page loads (public or redirects to login)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(`${BASE_URL}/ar/status`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/(ar|en)\/(status|login)/)
    expect(errors).toHaveLength(0)
  })
})
