import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';

const PERMISSION_COLUMNS = [
  'can_record_payments',
  'can_view_payments',
  'can_manage_billing',
  'can_edit_center_profile',
  'can_delete_students',
  'can_manage_academic_calendar',
  'can_place_card_orders',
  'can_request_referral_payouts',
] as const;

type PermissionColumn = (typeof PERMISSION_COLUMNS)[number];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  }

  const { success } = await rateLimit(`staff-perms:${auth.centerId}`, 20, 300);
  if (!success) return rateLimitExceededResponse(300);

  const { userId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 4096)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // CORE lookup: identity only. A DB error here is infrastructure failure, not
  // "user not found" — bucketing it into 404 would hide cache-staleness errors
  // from the owner and corrupt the audit "before" snapshot. Mirrors centerAuth's
  // CORE+best-effort split.
  const { data: coreUser, error: coreErr } = await auth.supabaseAdmin
    .from('users')
    .select('id, center_id, role')
    .eq('id', userId)
    .maybeSingle();

  if (coreErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/settings/staff/permissions');
      scope.setTag('step', 'core_user_lookup');
      Sentry.captureException(coreErr);
    });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  if (!coreUser || (coreUser as { center_id?: string }).center_id !== auth.centerId) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  // PERMISSIONS lookup: best-effort. On a permission-column read error the
  // target user provably exists (CORE succeeded) and the owner is already
  // authorized, so a transient failure must not block recording the change.
  // before[*] defaults to false; the after snapshot from the UPDATE's
  // returning select stays authoritative for what the values actually became.
  const { data: permsRow, error: permsErr } = await auth.supabaseAdmin
    .from('users')
    .select(PERMISSION_COLUMNS.join(', '))
    .eq('id', userId)
    .maybeSingle();

  if (permsErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/settings/staff/permissions');
      scope.setTag('step', 'permission_flags');
      Sentry.captureMessage(
        `staff-permissions before-snapshot read failed: ${permsErr.message}`,
        'warning',
      );
    });
  }

  const updates: Partial<Record<PermissionColumn, boolean>> = {};
  const before: Record<string, boolean> = {};
  const permsRecord = (permsRow ?? {}) as Record<string, unknown>;
  for (const col of PERMISSION_COLUMNS) {
    before[col] = Boolean(permsRecord[col]);
    if (typeof body[col] === 'boolean') {
      updates[col] = body[col] as boolean;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid permission fields in body' }, { status: 400 });
  }

  const { data: updatedRow, error: updateErr } = await auth.supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', userId)
    .eq('center_id', auth.centerId)
    .select(PERMISSION_COLUMNS.join(', '))
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const after: Record<string, boolean> = {};
  for (const col of PERMISSION_COLUMNS) {
    after[col] = Boolean((updatedRow as Record<string, unknown> | null)?.[col]);
  }

  await auth.supabaseAdmin.from('audit_log').insert({
    center_id: auth.centerId,
    user_id: auth.userId,
    action: 'update_staff_permissions',
    entity_type: 'users',
    details: {
      target_user_id: userId,
      actor_user_id: auth.userId,
      before,
      after,
    },
  });

  return NextResponse.json({ permissions: after });
}
