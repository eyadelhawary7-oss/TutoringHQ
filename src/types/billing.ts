import type { BillingPeriod, PlanKey } from '@/lib/pricing'

export type { BillingPeriod, PlanKey }

/** Center fields used by billing UI (subset of DB row) */
export interface CenterBillingFields {
  all_in_price?: number | null
  whatsapp_opted_in?: boolean | null
  billing_period?: BillingPeriod | string | null
  plan?: PlanKey | string | null
  parent_pack_enabled?: boolean | null
  parent_pack_active_parents?: number | null
}
