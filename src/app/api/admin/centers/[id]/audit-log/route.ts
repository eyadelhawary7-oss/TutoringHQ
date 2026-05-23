import { NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';

type AuditRow = {
  id: string;
  action: string;
  entity_type: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  user_id: string;
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext(_request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Per-centre audit log reveals admin actions. Tighter than the finance
  // gate, no accountant (consistent with the security audit-log dump).
  const denied = requireAdminRole(ctx, ['super_admin', 'admin', 'internal_admin']);
  if (denied) return denied;

  const { id } = await params;

  const { data, error } = await ctx.supabaseAdmin
    .from('audit_log')
    .select('id, action, entity_type, details, created_at, user_id')
    .eq('center_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as AuditRow[];
  const userIds = [...new Set(rows.map((r) => r.user_id))];

  const [usersRes, adminUsersRes] = await Promise.all([
    userIds.length > 0
      ? ctx.supabaseAdmin.from('users').select('id, phone').in('id', userIds)
      : { data: [] as { id: string; phone?: string | null }[] },
    userIds.length > 0
      ? ctx.supabaseAdmin.from('admin_users').select('id, name').in('id', userIds)
      : { data: [] as { id: string; name?: string | null }[] },
  ]);

  const labelById: Record<string, string> = {};
  (usersRes.data ?? []).forEach((u: { id: string; phone?: string | null }) => {
    labelById[u.id] = u.phone ? String(u.phone) : u.id.slice(0, 8) + '…';
  });
  (adminUsersRes.data ?? []).forEach((u: { id: string; name?: string | null }) => {
    if (u.name) labelById[u.id] = u.name;
  });

  const logs = rows.map((r) => ({
    ...r,
    actor_label: labelById[r.user_id] ?? r.user_id.slice(0, 8) + '…',
  }));

  return NextResponse.json({ logs });
}
