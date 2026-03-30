import { test as setup, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
  }

  // Step 1: Get email from /api/login
  const loginRes = await page.request.post(`${base}/api/login`, {
    data: { phone: process.env.TEST_OWNER_PHONE, pin: process.env.TEST_OWNER_PIN }
  })
  if (!loginRes.ok()) {
    throw new Error(`Phone lookup failed (${loginRes.status()}): ${await loginRes.text()}`)
  }
  const { email, userId } = await loginRes.json()

  // Step 2: Use admin client to reset password via GoTrue (guarantees compatibility)
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  await adminClient.auth.admin.updateUserById(userId, { password: process.env.TEST_OWNER_PIN })

  // Step 3: Sign in with the now-valid password
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  )
  const { data, error } = await anonClient.auth.signInWithPassword({
    email,
    password: process.env.TEST_OWNER_PIN
  })
  if (error || !data.session) {
    throw new Error(`Supabase signIn failed: ${error?.message}`)
  }

  // Step 4: Inject session tokens into browser context as cookies
  const url = new URL(base)
  await page.context().addCookies([
    {
      name: `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token`,
      value: JSON.stringify([
        data.session.access_token,
        data.session.refresh_token
      ]),
      domain: url.hostname,
      path: '/',
      httpOnly: false,
      secure: url.protocol === 'https:',
      sameSite: 'Lax'
    }
  ])

  // Step 5: Navigate and confirm session works
  await page.goto(`${base}/ar/dashboard`)
  await page.waitForURL(/\/(ar|en)\/(dashboard|admin|onboarding|suspended)/, { timeout: 30_000 })

  const dir = path.dirname(OWNER_AUTH_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  await page.context().storageState({ path: OWNER_AUTH_FILE })
})
