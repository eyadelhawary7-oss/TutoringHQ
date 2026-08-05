// src/types/ceo.ts

export type LeadStage = 'lead' | 'demo' | 'trial' | 'closed' | 'lost'
export type ActionPriority = 'red' | 'amber' | 'green'
export type ActionType =
  | 'churn_risk'
  | 'activation'
  | 'collection'
  | 'sales'
  | 'ops'
  | 'renewal'
  | 'cancellation_request'
  | 'pack_billing_blocked'
  | 'billing_blocked'

export interface SalesLead {
  id: string
  name: string
  phone: string
  district: string | null
  governorate: string
  plan_interest: string | null
  stage: LeadStage
  next_followup: string | null
  assigned_to: string | null
  source: string | null
  notes: string | null
  center_id: string | null
  converted_at: string | null
  created_at: string
  updated_at: string
}

export type CreateLeadInput = Pick<SalesLead,
  'name' | 'phone' | 'district' | 'governorate' | 'plan_interest' | 'stage' | 'source' | 'notes'
> & { next_followup?: string | null }

export type UpdateLeadInput = Partial<CreateLeadInput> & {
  stage?: LeadStage
  next_followup?: string | null
  notes?: string | null
  center_id?: string | null
  converted_at?: string | null
}

export interface CeoAction {
  id: string
  type: ActionType
  priority: ActionPriority
  center_id: string | null
  lead_id: string | null
  title: string
  subtitle: string | null
  action_label: string | null
  action_url: string | null
  revenue_at_risk: number
  snoozed_until: string | null
  resolved_at: string | null
  auto_generated: boolean
  created_at: string
  updated_at: string
  // Joined fields (when fetched with center data)
  center?: {
    id: string
    name: string
    plan: string
    health_score: number | null
  } | null
}

export interface CreateActionInput {
  type: ActionType
  priority: ActionPriority
  center_id?: string | null
  lead_id?: string | null
  title: string
  subtitle?: string | null
  action_label?: string | null
  action_url?: string | null
  revenue_at_risk?: number
  auto_generated?: boolean
}

// Pipeline summary for CEO dashboard Section C
export interface PipelineSummary {
  lead: number
  demo: number
  trial: number
  closed: number
  lost: number
  overdue_followups: number  // next_followup < now() AND stage NOT IN ('closed','lost')
}

// Action queue summary for CEO dashboard Section B
export interface ActionQueueSummary {
  red: number
  amber: number
  green: number
  total: number
  actions: CeoAction[]
}

export interface CeoHero {
  active_centers: number
  cash_collected_mtd: number
  live_trials: number
  at_risk_centers: number
  open_alerts: number
}

export interface CeoActivationCenter {
  id: string
  name: string
  plan: string
  onboarding_step: number
  onboarding_completed: boolean
  has_scanned: boolean      // TRUE if ANY attendance_scans row exists for this center (all-time)
  has_payment: boolean      // TRUE if ANY payments row exists for this center (all-time)
  created_at: string
}

export interface CeoCenterHealth {
  id: string
  name: string
  phone: string | null      // included for WhatsApp button — always select from DB
  plan: string
  status: string
  health_score: number | null
  health_score_band: string | null
  scans_today: number       // COUNT attendance_scans WHERE session_date = today
  renewal_date: string | null
  days_to_renewal: number | null  // null = no date; 0 = expired (clamped, never negative)
  district: string | null
  all_in_price: number | null
}

/** Tier table rows for CEO Center Health (automation score) */
export interface CeoCenterHealthTierRow {
  id: string
  name: string
  plan: string
  health_score: number | null
  days_since_owner_login: number | null
  owner_phone: string | null
}

export interface CeoCenterHealthTiers {
  green: number
  amber: number
  red: number
  red_centers: CeoCenterHealthTierRow[]
  amber_centers: CeoCenterHealthTierRow[]
}

export interface CeoCash {
  collected_this_quarter: number
  cash_collected_mtd: number
  overdue_count: number
  due_soon_count: number
  pack_revenue_mtd: number
  total_centers: number
}

export interface CeoOps {
  wa_queue_pending: number
  wa_queue_failed: number
  platform_config: Record<string, unknown>
  last_status_check: {
    service: string
    status: string
    checked_at: string
  } | null
}

/**
 * Trials-watch summary (super_admin only). Center trials use the summer promo
 * enrollment (`centers.summer_status`); teacher trials use the regular
 * subscription status (`teacher_subscriptions.status = 'trialing'`). Test rows
 * (`centers.is_test`, `teacher_profiles.is_test`) are excluded.
 */
export interface CeoTrialsWatch {
  centers_in_trial: number
  teachers_in_trial: number
  converted_to_paid: number
  trials_ending_7d: number
}

/** Combined center + teacher-side top-line (Section A, owner-only). */
export interface CeoTeacherCombined {
  center_mrr: number
  teacher_mrr: number
  combined_mrr: number
  teacher_active_subs: number
  teacher_trials: number
  total_teachers: number
}

/** One tier of `Merged-CEO` §02's plan-mix bars. */
export interface CeoTeacherPlanMix {
  plan_key: string
  /** VAT-inclusive monthly list price from `TEACHER_PLANS`, EGP. */
  price_gross: number
  /** Teachers on this tier with a billable subscription. */
  teachers: number
}

/**
 * `Merged-CEO` §02 overview strip. See `getCeoTeacherOverview` for which of the
 * design's tiles are omitted and the exact column missing behind each.
 */
export interface CeoTeacherOverview {
  /** Cairo month these figures describe, `YYYY-MM`. */
  month: string
  /** Non-test teacher profiles. */
  active_teachers: number
  /** Subscriptions in a billable status (`active` | `past_due`). */
  billable_subscriptions: number
  /** Sessions finished this Cairo month on a non-test teacher's group. */
  classes_this_month: number
  teacher_mrr: number
  plans: CeoTeacherPlanMix[]
}

/** One Cairo calendar month of paid-invoice revenue (`Merged-CEO` §01 chart). */
export interface CeoBoardMonthPoint {
  /** Cairo calendar month, `YYYY-MM`. */
  month: string
  /** Sum of `invoices.total_amount` for paid invoices in that month, EGP. */
  revenue: number
}

/** One side of `Merged-CEO` §01's two segment cards. */
export interface CeoBoardSegment {
  accounts: number
  mrr: number
  /**
   * Center MRR recorded in `mrr_snapshots` on the first Cairo day of the month,
   * used for the segment's growth row. Null when no snapshot exists for that
   * date — and null always on the teacher side, which `mrr_snapshots` does not
   * cover (the table has `active_centers`, no teacher equivalent).
   */
  mrr_at_month_start: number | null
  /** Paid-invoice revenue this Cairo month for this segment. */
  revenue_this_month: number
}

/**
 * `Merged-CEO` §01 board figures. Read-only aggregates — see `src/lib/ceoBoard.ts`
 * for the source of each field and why churn/net-new are center-scoped.
 */
export interface CeoBoardData {
  /** Cairo month these figures describe, `YYYY-MM`. */
  month: string
  revenue_this_month: number
  revenue_prior_month: number
  /** Oldest → newest, always `REVENUE_MONTHS` entries long. */
  revenue_series: CeoBoardMonthPoint[]
  mrr_total: number
  active_accounts: number
  /** Centers + teachers created this Cairo month. */
  new_accounts: number
  /** Centers whose cancellation was approved this Cairo month. */
  churned_centers: number
  /** `new centers − churned centers`. Center-scoped: teacher churn is undatable. */
  net_new_centers: number
  center: CeoBoardSegment
  teacher: CeoBoardSegment
  /** Center churn as a percent of centers active at month start. Null when unknown. */
  churn_rate_pct: number | null
  /** The churn denominator, surfaced so the UI can omit rather than mislead. */
  active_centers_at_month_start: number | null
  /** Total MRR per active account. Null when there are no accounts. */
  arpu: number | null
}

// ActionQueueSummary and PipelineSummary already exist in this file — reference directly
export interface CeoDashboardData {
  hero: CeoHero
  action_queue: ActionQueueSummary
  pipeline: PipelineSummary
  activation: { centers: CeoActivationCenter[] }
  centers_health: CeoCenterHealth[]
  center_health_tiers: CeoCenterHealthTiers
  cash: CeoCash
  ops: CeoOps
  /** Optional: present once the dashboard route computes teacher-side aggregates. */
  teacher_combined?: CeoTeacherCombined
}
