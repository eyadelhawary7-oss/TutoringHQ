// src/types/ceo.ts

export type LeadStage = 'lead' | 'demo' | 'trial' | 'closed' | 'lost'
export type ActionPriority = 'red' | 'amber' | 'green'
export type ActionType = 'churn_risk' | 'activation' | 'collection' | 'sales' | 'ops' | 'renewal'

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
