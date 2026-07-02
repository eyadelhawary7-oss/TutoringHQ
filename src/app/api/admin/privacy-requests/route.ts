import { NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';

// PDPL data-rights request queue (H8 minimum). Sensitive data-subject PII +
// legal obligation — super_admin only.
const PDPL_SLA_DAYS = 30;

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin']);
  if (denied) return denied;

  const { data, error } = await ctx.supabaseAdmin
    .from('privacy_requests')
    .select('id, full_name, phone, email, relationship, request_types, description, correction_detail, status, handled_by, handled_at, response_notes, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((r) => {
    const created = r.created_at ? new Date(r.created_at as string) : null;
    const dueAt = created ? new Date(created.getTime() + PDPL_SLA_DAYS * 86400000).toISOString() : null;
    return { ...r, due_at: dueAt };
  });

  return NextResponse.json({ requests: rows, slaDays: PDPL_SLA_DAYS });
}
