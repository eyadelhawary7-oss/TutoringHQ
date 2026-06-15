import { test, expect } from '@playwright/test'
import { gotoWithRetry } from './goto-with-retry'

/** Production smoke tests: console listener filters 404/resource failures, next-intl MISSING_MESSAGE, and camera Permissions-Policy noise. */
const BASE_URL = process.env.BASE_URL ?? 'https://centerhq.app'

test.describe('Center Owner Pages', () => {
  test('dashboard loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/dashboard`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('scanner loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await page.context().grantPermissions(['camera'], { origin: new URL(BASE_URL).origin })
    await gotoWithRetry(page, `${BASE_URL}/ar/scan`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('students page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/students`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('payments page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/payments`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('groups page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/groups`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('schedule page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/schedule`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('rooms page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/rooms`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('attendance route is removed (404)', async ({ page }) => {
    // Standalone Attendance page was folded into Students (per-student history)
    // and Groups (per-session breakdown). The route must no longer resolve.
    const resp = await page.goto(`${BASE_URL}/ar/attendance`)
    expect(resp?.status()).toBe(404)
  })

  test('settings page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/settings`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('settings billing loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/settings/billing`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('orders page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/orders`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('analytics page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/analytics`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('referrals page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/referrals`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
    expect(errors).toHaveLength(0)
  })

  test('academic route is removed from owner view (404)', async ({ page }) => {
    // Academic Year page was removed from the owner portal (data kept for
    // analytics). The owner-facing route must no longer resolve.
    const resp = await page.goto(`${BASE_URL}/ar/academic`)
    expect(resp?.status()).toBe(404)
  })

  test('onboarding redirects to dashboard (already completed)', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('404') &&
        !msg.text().includes('Failed to load resource') &&
        !msg.text().includes('MISSING_MESSAGE') &&
        !msg.text().includes('Permissions policy violation')
      ) {
        errors.push(msg.text())
      }
    })

    await gotoWithRetry(page, `${BASE_URL}/ar/onboarding`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/(ar|en)\//)
  })
})
