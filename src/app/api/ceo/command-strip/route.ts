import { requireSuperAdminApi } from '@/lib/admin-auth';
import type {
  ActionQueueItem,
  CommandStripResponse,
  PendingCenter,
} from '@/types/founder-dash';
import { NextResponse } from 'next/server';

type CeoActionQueueRow = {
  id: string;
  type: string;
  priority: string;
  title: string;
  subtitle: string | null;
  action_label: string | null;
  action_url: string | null;
  revenue_at_risk: number | string | null;
  center_id: string | null;
  lead_id: string | null;
  snoozed_until: string | null;
};

type InvoiceCenterRow = { center_id: string | null };

function isPriority(p: string): p is ActionQueueItem['priority'] {
  return p === 'red' || p === 'amber' || p === 'green';
}

export async function GET(req: Request) {
  const auth = await requireSuperAdminApi(req);
  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = auth.supabaseAdmin;

  const [
    pendingApprovalsRes,
    leadsNeedingReplyRes,
    overdueInvoicesRes,
    atRiskCentersRes,
    actionQueueRes,
    pendingCentersRes,
    activePayingRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabaseAdmin
      .from('sales_leads')
      .select('id', { count: 'exact', head: true })
      .in('stage', ['lead', 'demo']),
    supabaseAdmin.from('invoices').select('center_id').eq('status', 'overdue'),
    supabaseAdmin
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .in('health_score_band', ['At Risk', 'Critical'])
      .eq('status', 'active'),
    supabaseAdmin
      .from('ceo_action_queue')
      .select(
        'id, type, priority, title, subtitle, action_label, action_url, revenue_at_risk, center_id, lead_id, snoozed_until',
      )
      .is('resolved_at', null),
    supabaseAdmin
      .from('centers')
      .select(
        'id, name, phone, owner_name, city, district, plan, created_at, signup_notes',
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .eq('subscription_status', 'active'),
  ]);

  const pendingApprovals = pendingApprovalsRes.error
    ? 0
    : (pendingApprovalsRes.count ?? 0);

  const leadsNeedingReply = leadsNeedingReplyRes.error
    ? 0
    : (leadsNeedingReplyRes.count ?? 0);

  let overduePayments = 0;
  if (!overdueInvoicesRes.error && overdueInvoicesRes.data) {
    const rows = overdueInvoicesRes.data as InvoiceCenterRow[];
    overduePayments = new Set(
      rows.map((r) => r.center_id).filter((id): id is string => id != null),
    ).size;
  }

  const atRiskCenters = atRiskCentersRes.error ? 0 : (atRiskCentersRes.count ?? 0);

  const now = new Date();
  let actionQueue: ActionQueueItem[] = [];
  if (!actionQueueRes.error && actionQueueRes.data) {
    const rawRows = actionQueueRes.data as CeoActionQueueRow[];
    const filtered = rawRows.filter(
      (r) => !r.snoozed_until || new Date(r.snoozed_until) < now,
    );
    const priorityOrder: Record<string, number> = { red: 0, amber: 1, green: 2 };
    filtered.sort(
      (a, b) =>
        (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3),
    );
    actionQueue = filtered.slice(0, 5).map((r) => {
      const pr = r.priority;
      const priority: ActionQueueItem['priority'] = isPriority(pr)
        ? pr
        : 'green';
      return {
        id: r.id,
        type: r.type,
        priority,
        title: r.title,
        subtitle: r.subtitle,
        action_label: r.action_label,
        action_url: r.action_url,
        revenue_at_risk: Number(r.revenue_at_risk ?? 0),
        center_id: r.center_id,
        lead_id: r.lead_id,
      };
    });
  }

  let pendingCenters: PendingCenter[] = [];
  if (!pendingCentersRes.error && pendingCentersRes.data) {
    pendingCenters = pendingCentersRes.data as PendingCenter[];
  }

  const activePayingCenters = activePayingRes.error
    ? 0
    : (activePayingRes.count ?? 0);

  return NextResponse.json({
    stats: {
      pendingApprovals,
      leadsNeedingReply,
      overduePayments,
      atRiskCenters,
    },
    actionQueue,
    pendingCenters,
    breakeven: { target: 77, activePayingCenters },
  } satisfies CommandStripResponse);
}
