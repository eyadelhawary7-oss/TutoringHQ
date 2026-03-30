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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for owner setup'
    )
  }

  // Step 1: Get the email format from /api/login
  const loginRes = await page.request.post(`${base}/api/login`, {
    data: {
      phone: process.env.TEST_OWNER_PHONE,
      pin: process.env.TEST_OWNER_PIN
    }
  })

  if (!loginRes.ok()) {
    const body = await loginRes.text()
    throw new Error(`Owner phone lookup failed (${loginRes.status()}): ${body}`)
  }

  const { email } = (await loginRes.json()) as { email: string }

  // Step 2: Navigate to app so Supabase client is available in browser context
  await page.goto(`${base}/ar/login`)
  await page.waitForLoadState('networkidle')

  // Step 3: Call supabase.auth.signInWithPassword inside the browser context
  // (Bare "@supabase/ssr" is not resolvable in page.evaluate; load matching version from esm.sh.)
  const result = await page.evaluate(
    async ({ email, pin, supabaseUrl, supabaseAnonKey }) => {
      // Dynamic URL import runs in Chromium only; TS does not resolve esm.sh modules.
      const ssrMod = (await import(
        'https://esm.sh/@supabase/ssr@0.8.0' as unknown as string
      )) as { createBrowserClient: (url: string, key: string) => import('@supabase/supabase-js').SupabaseClient }
      const { createBrowserClient } = ssrMod
      const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pin })
      return { userId: data?.user?.id, error: error?.message }
    },
    {
      email,
      pin: process.env.TEST_OWNER_PIN,
      supabaseUrl,
      supabaseAnonKey
    }
  )

  if (result.error || !result.userId) {
    throw new Error(`Supabase signIn failed: ${result.error}`)
  }

  // Step 4: Navigate to dashboard to confirm session is active
  await page.goto(`${base}/ar/dashboard`)
  await page.waitForURL(/\/(ar|en)\/(dashboard|admin|onboarding|suspended)/, { timeout: 30_000 })

  const dir = path.dirname(OWNER_AUTH_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  await page.context().storageState({ path: OWNER_AUTH_FILE })
})
