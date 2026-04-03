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

// ActionQueueSummary and PipelineSummary already exist in this file — reference directly
export interface CeoDashboardData {
  hero: CeoHero
  action_queue: ActionQueueSummary
  pipeline: PipelineSummary
  activation: { centers: CeoActivationCenter[] }
  centers_health: CeoCenterHealth[]
  cash: CeoCash
  ops: CeoOps
}
