// src/lib/parent-pack.ts
// Business logic for Parent WhatsApp Pack — no UI, no i18n
//
// Pass a Supabase client from route handlers (typically service role for `/api/*`
// with Bearer auth, matching `/api/me`). Cookie-based routes may use `createClient` from `@/lib/supabase/server`.

import type { SupabaseClient } from '@supabase/supabase-js'
import { PARENT_PACK } from '@/types/parent-pack'

/**
 * Returns count of opted-in parents for a center this month.
 * Only counts students who are: is_active=true AND parent_pack_opted_in=true
 * AND have a non-null parent_phone.
 */
export async function getActivePackParentCount(
  supabase: SupabaseClient,
  centerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('center_id', centerId)
    .eq('is_active', true)
    .eq('parent_pack_opted_in', true)
    .not('parent_phone', 'is', null)

  if (error) {
    console.error('[parent-pack] getActivePackParentCount', error)
    return 0
  }
  return count ?? 0
}

/**
 * Syncs centers.parent_pack_active_parents for a given center.
 * Call this after any parent opt-in/out change.
 */
export async function syncPackParentCount(
  supabase: SupabaseClient,
  centerId: string,
): Promise<number> {
  const count = await getActivePackParentCount(supabase, centerId)
  const { error } = await supabase
    .from('centers')
    .update({ parent_pack_active_parents: count })
    .eq('id', centerId)

  if (error) {
    console.error('[parent-pack] syncPackParentCount', error)
  }
  return count
}

/**
 * Calculates monthly pack charge for a center.
 * Returns 0 if pack is disabled.
 */
export function calculatePackCharge(packEnabled: boolean, activeParents: number): number {
  if (!packEnabled || activeParents === 0) return 0
  return activeParents * PARENT_PACK.ALL_IN_PRICE
}

/**
 * Returns the current month as a DATE string: 'YYYY-MM-01'
 */
export function getCurrentBillingMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * Check if a pack billing record already exists for center+student+month.
 * Used to prevent duplicate charges.
 */
export async function packBillingRecordExists(
  supabase: SupabaseClient,
  centerId: string,
  studentId: string,
  month: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('parent_pack_billing')
    .select('*', { count: 'exact', head: true })
    .eq('center_id', centerId)
    .eq('student_id', studentId)
    .eq('month', month)

  if (error) {
    console.error('[parent-pack] packBillingRecordExists', error)
    return false
  }
  return (count ?? 0) > 0
}

/**
 * Get a platform config value by key.
 * Returns null if key not found.
 */
export async function getPlatformConfig(
  supabase: SupabaseClient,
  key: string,
): Promise<unknown> {
  const { data, error } = await supabase.from('platform_config').select('value').eq('key', key).maybeSingle()

  if (error) {
    console.error('[parent-pack] getPlatformConfig', error)
    return null
  }
  return data?.value ?? null
}

/**
 * Check if WA sending is globally enabled.
 */
export async function isWaSendingEnabled(supabase: SupabaseClient): Promise<boolean> {
  const val = await getPlatformConfig(supabase, 'wa_sending_enabled')
  return val !== false
}
