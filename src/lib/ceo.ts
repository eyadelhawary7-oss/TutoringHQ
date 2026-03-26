// src/lib/ceo.ts
// CEO dashboard data helpers — all take SupabaseClient as first arg

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  SalesLead, CeoAction, CreateLeadInput, UpdateLeadInput,
  CreateActionInput, PipelineSummary, ActionQueueSummary, LeadStage
} from '@/types/ceo'

const PIPELINE_STAGES: LeadStage[] = ['lead', 'demo', 'trial', 'closed', 'lost']

function isPipelineStage(s: string): s is LeadStage {
  return (PIPELINE_STAGES as readonly string[]).includes(s)
}

function toNumber(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string' && v !== '') return Number(v)
  return 0
}

function normalizeActionRow(row: Record<string, unknown>): CeoAction {
  const centerRaw = row.center as Record<string, unknown> | null | undefined
  const center =
    centerRaw && typeof centerRaw === 'object' && 'id' in centerRaw
      ? {
          id: String(centerRaw.id),
          name: String(centerRaw.name ?? ''),
          plan: String(centerRaw.plan ?? ''),
          health_score:
            centerRaw.health_score == null ? null : toNumber(centerRaw.health_score),
        }
      : null

  const { center: _c, ...rest } = row
  const a = rest as unknown as CeoAction
  return {
    ...a,
    revenue_at_risk: toNumber(rest.revenue_at_risk),
    center: center ?? undefined,
  }
}

// ─── SALES LEADS ─────────────────────────────────────────────

export async function getLeads(
  supabase: SupabaseClient,
  stage?: string
): Promise<SalesLead[]> {
  let query = supabase
    .from('sales_leads')
    .select('*')
    .order('next_followup', { ascending: true, nullsFirst: false })
  if (stage) query = query.eq('stage', stage)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SalesLead[]
}

export async function createLead(
  supabase: SupabaseClient,
  input: CreateLeadInput
): Promise<SalesLead> {
  const { data, error } = await supabase
    .from('sales_leads')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as SalesLead
}

export async function updateLead(
  supabase: SupabaseClient,
  id: string,
  input: UpdateLeadInput
): Promise<SalesLead> {
  const { data, error } = await supabase
    .from('sales_leads')
    .update(input)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as SalesLead
}

export async function getPipelineSummary(
  supabase: SupabaseClient
): Promise<PipelineSummary> {
  const { data, error } = await supabase
    .from('sales_leads')
    .select('stage, next_followup')
  if (error) throw error
  const rows = (data ?? []) as { stage: string; next_followup: string | null }[]
  const now = new Date().toISOString()
  const summary: PipelineSummary = {
    lead: 0, demo: 0, trial: 0, closed: 0, lost: 0,
    overdue_followups: 0,
  }
  for (const row of rows) {
    if (isPipelineStage(row.stage)) {
      summary[row.stage]++
    }
    if (
      row.next_followup &&
      row.next_followup < now &&
      row.stage !== 'closed' &&
      row.stage !== 'lost'
    ) {
      summary.overdue_followups++
    }
  }
  return summary
}

// ─── CEO ACTION QUEUE ─────────────────────────────────────────

export async function getActionQueue(
  supabase: SupabaseClient,
  limit = 20
): Promise<ActionQueueSummary> {
  const { data, error } = await supabase
    .from('ceo_action_queue')
    .select(`
      *,
      center:centers (id, name, plan, health_score)
    `)
    .is('resolved_at', null)
    .is('snoozed_until', null)
    .order('priority', { ascending: true })
    .order('revenue_at_risk', { ascending: false })
    .limit(limit)
  if (error) throw error
  const raw = (data ?? []) as Record<string, unknown>[]
  const actions = raw.map(normalizeActionRow)
  const priorityOrder: Record<string, number> = { red: 0, amber: 1, green: 2 }
  actions.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 1
    const pb = priorityOrder[b.priority] ?? 1
    if (pa !== pb) return pa - pb
    return (b.revenue_at_risk ?? 0) - (a.revenue_at_risk ?? 0)
  })
  const summary: ActionQueueSummary = {
    red: actions.filter(a => a.priority === 'red').length,
    amber: actions.filter(a => a.priority === 'amber').length,
    green: actions.filter(a => a.priority === 'green').length,
    total: actions.length,
    actions,
  }
  return summary
}

export async function resolveAction(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from('ceo_action_queue')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function snoozeAction(
  supabase: SupabaseClient,
  id: string,
  until: string  // ISO timestamp
): Promise<void> {
  const { error } = await supabase
    .from('ceo_action_queue')
    .update({ snoozed_until: until })
    .eq('id', id)
  if (error) throw error
}

export async function createAction(
  supabase: SupabaseClient,
  input: CreateActionInput
): Promise<CeoAction> {
  const { data, error } = await supabase
    .from('ceo_action_queue')
    .insert({ ...input, auto_generated: input.auto_generated ?? false })
    .select()
    .single()
  if (error) throw error
  return normalizeActionRow(data as Record<string, unknown>)
}
