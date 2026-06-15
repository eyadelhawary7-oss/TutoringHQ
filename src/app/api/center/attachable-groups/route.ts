import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';

const ROUTE_TAG = 'api/center/attachable-groups';

/**
 * GET /api/center/attachable-groups
 * Plain center groups eligible for a teacher-attach proposal: kind='center',
 * THIS center, and teacher_id IS NULL (no teacher yet). Owner/admin only. Used
 * by the Requests panel's "attach to an existing group" picker.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.supabaseAdmin
    .from('student_groups')
    .select('id, name, subject, fee_per_class')
    .eq('center_id', ctx.centerId)
    .eq('kind', 'center')
    .is('teacher_id', null)
    .order('name', { ascending: true });
  if (error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'list_attachable');
      Sentry.captureException(error);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  const groups = ((data ?? []) as {
    id: string;
    name: string | null;
    subject: string | null;
    fee_per_class: number | string | null;
  }[]).map((g) => ({
    id: g.id,
    name: g.name,
    subject: g.subject,
    feePerClass: g.fee_per_class == null ? null : Number(g.fee_per_class),
  }));

  return NextResponse.json({ groups });
}
