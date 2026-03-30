import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

export const AUTH_FILE = path.join(__dirname, '../../playwright/.auth/user.json')
export const OWNER_AUTH_FILE = path.join(__dirname, '../../playwright/.auth/owner.json')

setup('authenticate once for all tests', async ({ page }) => {
  const base = process.env.PLAYWRIGHT_BASE_URL || 'https://center-hq.vercel.app'

  await page.goto(`${base}/ar/login`)
  await page.getByPlaceholder('+20 1XXXXXXXXX').fill(process.env.TEST_PHONE!)
  await page.getByPlaceholder('••••••').fill(process.env.TEST_PIN!)
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
  await page.waitForURL(/\/(ar|en)\/(admin|dashboard)/, { timeout: 60_000 })

  // Ensure directory exists
  const dir = path.dirname(AUTH_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  await page.context().storageState({ path: AUTH_FILE })
})

setup('authenticate as center owner', async ({ page }) => {
  const base = process.env.PLAYWRIGHT_BASE_URL || 'https://center-hq.vercel.app'

  if (!process.env.TEST_OWNER_PHONE || !process.env.TEST_OWNER_PIN) {
    throw new Error('TEST_OWNER_PHONE and TEST_OWNER_PIN environment variables are required')
  }

  // Call login API directly — bypasses React form validation entirely
  const response = await page.request.post(`${base}/api/login`, {
    data: {
      phone: process.env.TEST_OWNER_PHONE,
      pin: process.env.TEST_OWNER_PIN
    }
  })

  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Owner API login failed (${response.status()}): ${body}`)
  }

  // Navigate to trigger session cookie to be set in browser context
  await page.goto(`${base}/ar/dashboard`)
  await page.waitForURL(/\/(ar|en)\/(dashboard|admin|onboarding|suspended)/, { timeout: 30_000 })

  const dir = path.dirname(OWNER_AUTH_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  await page.context().storageState({ path: OWNER_AUTH_FILE })
})
