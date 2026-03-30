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

  await page.context().clearCookies()
  await page.goto(`${base}/ar/login`)
  await page.getByPlaceholder('+20 1XXXXXXXXX').waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByPlaceholder('+20 1XXXXXXXXX').fill(process.env.TEST_OWNER_PHONE)
  await page.getByPlaceholder('••••••').waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByPlaceholder('••••••').fill(process.env.TEST_OWNER_PIN)
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click()

  try {
    await page.waitForURL(/\/(ar|en)\/(admin|dashboard|onboarding|suspended)/, { timeout: 60_000 })
  } catch (error) {
    console.error('Owner login failed. Current URL:', page.url())
    const content = await page.textContent('body').catch(() => '')
    console.error('Page body snippet:', content?.substring(0, 500))
    throw new Error(`Owner auth timeout. URL was: ${page.url()}`)
  }

  const dir = path.dirname(OWNER_AUTH_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  await page.context().storageState({ path: OWNER_AUTH_FILE })
})
