// /api/admin/staff-invites
//
// Internal-portal rebuild: CEO mints a single-use, expiring INVITE LINK for a pre-chosen
// role. The link grants nothing — it only permits submitting one intake for that role.
//
// POST : super_admin only, CSRF-required. Picks role (+ optional custom permissions),
//        mints the invite, returns the shareable URL (plaintext token shown ONCE).
// GET  : super_admin only. Lists OPEN (unused, unrevoked, unexpired) invites so the CEO
//        can see what is outstanding.
//
// Nothing here creates an auth identity or credential — provisioning happens only on
// approval of the resulting request (see /api/admin/staff-requests/[id]).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import { staffInviteCreateSchema } from '@/lib/validations';
import { mintStaffInvite } from '@/lib/staffInviteTokens';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.internalRole !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await ctx.supabaseAdmin
    .from('staff_invites')
    .select('id, role, custom_permissions, expires_at, created_at')
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/admin/staff-invites]', error);
    return NextResponse.json({ error: 'Failed to load invites' }, { status: 500 });
  }
  return NextResponse.json({ invites: data ?? [] });
}

export async function POST(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.internalRole !== 'super_admin') {
    return NextResponse.json({ error: 'Only super_admin can create staff invites' }, { status: 403 });
  }
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 8192)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = staffInviteCreateSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
    return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
  }
  const { role, custom_permissions } = parsed.data;

  // created_by FK -> admin_users.id. A phone-based super_admin has no admin_users row,
  // so store NULL to avoid an FK violation (mirrors promo_code_requests.requested_by).
  const createdBy = ctx.adminRole ? ctx.userId : null;

  let invite: { id: string; plaintext: string; expiresAt: string };
  try {
    invite = await mintStaffInvite(ctx.supabaseAdmin, {
      role,
      customPermissions: custom_permissions ?? [],
      createdBy,
    });
  } catch (e) {
    console.error('[POST /api/admin/staff-invites]', e);
    return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
  }

  // Audit the mint (best-effort). Never log the plaintext token.
  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      user_id: ctx.userId,
      action: 'staff_invite_created',
      details: { invite_id: invite.id, role, expires_at: invite.expiresAt },
    });
  } catch (auditErr) {
    console.error('[POST /api/admin/staff-invites] audit_log', auditErr);
  }

  // Same base-URL resolution as staffLoginProvision / centerNotify.
  const base =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://tutoringhq.app').replace(/\/+$/, '') ||
    'https://tutoringhq.app';
  const inviteUrl = `${base}/ar/staff-invite?t=${encodeURIComponent(invite.plaintext)}`;

  return NextResponse.json(
    { id: invite.id, role, inviteUrl, expiresAt: invite.expiresAt },
    { status: 201 },
  );
}
