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
  ALL_IN_PRICE: 10.0, // EGP charged to center per parent/month
  BASE_AMOUNT: 8.4, // derived base
  WA_COST_PER_PARENT: 1.06, // COGS (6.25 msgs × EGP 0.17)
  NET_PROFIT_PER_PARENT: 7.38, // 10.00 - 1.06 - 0.56 (tax/fee)
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
