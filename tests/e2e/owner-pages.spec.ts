import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'https://center-hq.vercel.app'

test.describe('Center Owner Pages', () => {
  test('dashboard loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/dashboard`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('scanner loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/scan`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('students page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/students`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('payments page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/payments`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('groups page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/groups`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('schedule page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/schedule`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('rooms page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/rooms`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('attendance page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/attendance`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('settings page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/settings`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('settings billing loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/settings/billing`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('orders page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/orders`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('analytics page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/analytics`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('referrals page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/referrals`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('academic page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/academic`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('onboarding redirects to dashboard (already completed)', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}/ar/onboarding`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })
})
