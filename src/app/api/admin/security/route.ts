import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAdminContext } from '@/lib/admin-auth';

interface AuditLogRow {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  user_id: string;
  center_id: string | null;
}

interface EnrichedLog extends AuditLogRow {
  user?: { name?: string | null; phone?: string } | null;
  center?: { name?: string } | null;
}

export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized - admin access required' }, { status: 401 });
    }

    const { supabaseAdmin } = ctx;
    const url = new URL(request.url);
    const exportCsv = url.searchParams.get('export') === 'csv';

    // Fetch recent audit logs
    const { data: logs, error: logsError } = await supabaseAdmin
      .from('audit_log')
      .select('id, action, details, created_at, user_id, center_id')
      .order('created_at', { ascending: false })
      .limit(exportCsv ? 5000 : 100);

    if (logsError) {
      console.error('[admin/security] Audit log error:', logsError);
      return NextResponse.json({ error: logsError.message }, { status: 500 });
    }

    const auditLogs = (logs || []) as AuditLogRow[];

    // Enrich with user and center names
    const userIds = [...new Set(auditLogs.map((l) => l.user_id))];
    const centerIds = [...new Set(auditLogs.map((l) => l.center_id).filter(Boolean))] as string[];

    const [usersRes, adminUsersRes, centersRes] = await Promise.all([
      userIds.length > 0
        ? supabaseAdmin.from('users').select('id, phone').in('id', userIds)
        : { data: [] },
      userIds.length > 0
        ? supabaseAdmin.from('admin_users').select('id, name').in('id', userIds)
        : { data: [] },
      centerIds.length > 0
        ? supabaseAdmin.from('centers').select('id, name').in('id', centerIds)
        : { data: [] },
    ]);

    const usersById: Record<string, { name?: string | null; phone?: string }> = {};
    (usersRes.data || []).forEach((u: { id: string; phone?: string }) => {
      usersById[u.id] = { name: u.phone ?? null, phone: u.phone };
    });
    (adminUsersRes.data || []).forEach((u: { id: string; name?: string | null }) => {
      if (!usersById[u.id]) usersById[u.id] = { name: u.name ?? 'Admin' };
    });
    const centersById = Object.fromEntries(
      (centersRes.data || []).map((c: { id: string; name?: string }) => [c.id, c])
    );

    const recentLogs: EnrichedLog[] = auditLogs.map((log) => ({
      ...log,
      user: usersById[log.user_id] ?? null,
      center: log.center_id ? (centersById[log.center_id] ?? null) : null,
    }));

    if (exportCsv) {
      const header = 'created_at,action,user_name,user_phone,center_name,details\n';
      const rows = recentLogs
        .map(
          (log) =>
            `${escapeCsv(new Date(log.created_at).toISOString())},${escapeCsv(log.action)},${escapeCsv(log.user?.name ?? '')},${escapeCsv(log.user?.phone ?? '')},${escapeCsv(log.center?.name ?? '')},${escapeCsv(JSON.stringify(log.details || {}))}`
        )
        .join('\n');
      const csv = header + rows;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // Action counts (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: actionCounts } = await supabaseAdmin
      .from('audit_log')
      .select('action')
      .gte('created_at', thirtyDaysAgo);

    const actionStats = (actionCounts || []).reduce((acc: Record<string, number>, row: { action: string }) => {
      acc[row.action] = (acc[row.action] || 0) + 1;
      return acc;
    }, {});

    // Center status counts
    const { data: centerRows } = await supabaseAdmin.from('centers').select('status');
    const centerStats = (centerRows || []).reduce((acc: Record<string, number>, c: { status?: string }) => {
      const s = c.status || 'unknown';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      recentLogs,
      actionStats,
      centerStats,
      period: 'last_30_days',
    });
  } catch (error) {
    console.error('[admin/security] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
