// src/types/parent-pack.ts

export type PackBillingStatus = 'pending' | 'charged' | 'failed'

export interface ParentPackBilling {
  id: string
  center_id: string
  student_id: string
  month: string // ISO date string: '2026-05-01'
  amount: number // 10.00 all-in
  base_amount: number // 8.40
  status: PackBillingStatus
  charged_at: string | null
  created_at: string
}

export type PlatformConfigKey =
  | 'maintenance_mode'
  | 'wa_sending_enabled'
  | 'read_only_mode'
  | 'announcement_banner'
  | 'cron_paused'

export interface PlatformConfig {
  id: string
  key: PlatformConfigKey
  value: unknown
  updated_at: string
  updated_by: string | null
}

// Pack pricing constants — single source of truth
export const PARENT_PACK = {
  ALL_IN_PRICE: 12.0, // EGP charged to center per parent/month (align with platform_config / centers.pack_price_per_parent)
  BASE_AMOUNT: 10.08, // derived base at 12 EGP tier
  WA_COST_PER_PARENT: 1.06, // COGS (6.25 msgs × EGP 0.17)
  NET_PROFIT_PER_PARENT: 9.38, // illustrative: all-in minus COGS and fees
  CENTER_CHARGE_TO_PARENT: 25, // suggested price center charges parents
  CENTER_PROFIT_PER_PARENT: 15, // center keeps this
  MAX_ANNOUNCEMENTS_PER_MONTH: 2,
} as const

export type PackMessageType =
  | 'absence_alert'
  | 'balance_statement'
  | 'payment_confirmation'
  | 'term_report'
  | 'announcement'

// Response shape from GET /api/parent-pack/status
export interface PackStatusResponse {
  pack_enabled: boolean
  active_parents: number
  monthly_charge: number
  price_per_parent: number            // always PARENT_PACK.ALL_IN_PRICE
  center_profit_per_parent: number    // always PARENT_PACK.CENTER_PROFIT_PER_PARENT
  suggested_center_price: number      // always PARENT_PACK.CENTER_CHARGE_TO_PARENT
  max_announcements_per_month: number
}

// Student row shape with pack-relevant fields
export interface StudentPackRow {
  id: string
  name: string
  parent_phone: string | null
  parent_pack_opted_in: boolean
  is_active: boolean
  // Note: can_opt_in is derived client-side as:
  // is_active === true && parent_phone !== null
  // Do NOT add can_opt_in as a DB column
}
