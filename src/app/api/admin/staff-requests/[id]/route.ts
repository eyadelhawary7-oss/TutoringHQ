// /api/admin/staff-requests/[id]
//
// PATCH: the CEO reviews a pending intake. super_admin ONLY, CSRF-required.
//
//   action = 'decline' → mark declined (optional reason). Provisions NOTHING.
//   action = 'approve' → provision the login via the EXISTING primitive
//                        (provisionStaffLogin — auth identity + single-use set-PIN link),
//                        create the admin_users row, link the staff row, and issue the
//                        set-PIN link. Role + permissions come ONLY from the request (frozen
//                        from the invite the CEO created) — never from anything the invitee
//                        supplied.
//
// SECURITY:
//   * super_admin can never be granted here — the request.role enum excludes it (DB CHECK +
//     the isAssignableInternalRole guard below).
//   * A user cannot approve their OWN request — blocked by phone match AND by the
//     resolved-login === approver self-add guard (defense in depth).
//   * Only super_admin reaches this route; the pending queue is likewise super_admin-only.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import { staffRequestReviewSchema } from '@/lib/validations';
import { isAssignableInternalRole } from '@/lib/admin-roles';
import { provisionStaffLogin } from '@/lib/staffLoginProvision';
import type { SupabaseClient } from '@supabase/supabase-js';

interface StaffRequestRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  custom_permissions: string[] | null;
  status: string;
}

/** Last 10 digits = Egyptian subscriber number; a form-independent identity key. */
function phoneKey(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').slice(-10);
}

/** All phone-digit keys that identify the APPROVER (admin_users.phone + auth email). */
async function approverPhoneKeys(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const { data: adminRow } = await admin
      .from('admin_users')
      .select('phone')
      .eq('id', userId)
      .maybeSingle();
    const p = (adminRow as { phone?: string | null } | null)?.phone;
    if (p) keys.add(phoneKey(p));
  } catch {
    /* fall through — the auth-email key below is the authoritative one */
  }
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data?.user?.email ?? '';
    const m = email.match(/^(\d+)@/);
    if (m) keys.add(phoneKey(m[1]));
  } catch {
    /* ignore */
  }
  keys.delete('');
  return keys;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.internalRole !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 8192)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = staffRequestReviewSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { action, decline_reason } = parsed.data;

  const admin = ctx.supabaseAdmin;

  // Load the request. Only a PENDING request may be actioned (idempotency + no re-provision).
  const { data: reqRow, error: reqErr } = await admin
    .from('staff_requests')
    .select('id, name, phone, email, role, custom_permissions, status')
    .eq('id', id)
    .maybeSingle();
  if (reqErr) {
    console.error('[PATCH /api/admin/staff-requests] load', reqErr);
    return NextResponse.json({ error: 'Failed to load request' }, { status: 500 });
  }
  if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  const req = reqRow as StaffRequestRow;
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 });
  }

  // reviewed_by FK -> admin_users.id; a phone-based super_admin has no admin_users row → NULL.
  const reviewedBy = ctx.adminRole ? ctx.userId : null;

  // ---------------------------------------------------------------- DECLINE
  if (action === 'decline') {
    const { data: declined, error: updErr } = await admin
      .from('staff_requests')
      .update({
        status: 'declined',
        decline_reason: (decline_reason || '').trim() || null,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', req.id)
      .eq('status', 'pending') // atomic guard: only a still-pending row transitions
      .select('id')
      .maybeSingle();
    if (updErr) {
      console.error('[PATCH /api/admin/staff-requests] decline', updErr);
      return NextResponse.json({ error: 'Failed to decline request' }, { status: 500 });
    }
    if (!declined) {
      // Lost the race to a concurrent approve/decline — the row is no longer pending. Report
      // honestly instead of a phantom "declined" success.
      return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 });
    }
    try {
      await admin.from('audit_log').insert({
        user_id: ctx.userId,
        action: 'staff_request_declined',
        details: { request_id: req.id },
      });
    } catch (e) {
      console.error('[PATCH /api/admin/staff-requests] audit decline', e);
    }
    return NextResponse.json({ ok: true, status: 'declined' });
  }

  // ---------------------------------------------------------------- APPROVE

  // Role is FROZEN on the request (copied from the invite). Defense in depth: refuse to
  // provision anything that is not an assignable role — super_admin/admin can never pass.
  if (!isAssignableInternalRole(req.role)) {
    return NextResponse.json(
      { error: 'Cannot provision this role', code: 'ROLE_NOT_ASSIGNABLE' },
      { status: 400 },
    );
  }

  // A user may never approve their OWN request (early, friendly block; a second, definitive
  // guard on the resolved login id follows below).
  const approverKeys = await approverPhoneKeys(admin, ctx.userId);
  if (approverKeys.has(phoneKey(req.phone))) {
    return NextResponse.json({ error: 'You cannot approve your own request' }, { status: 403 });
  }

  // Normalize the request phone into the same forms the team route uses.
  let formattedPhone = req.phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) formattedPhone = formattedPhone.slice(1);
  if (!formattedPhone.startsWith('20')) formattedPhone = '20' + formattedPhone;
  const phoneWithPlus = '+' + formattedPhone;
  const phoneVariants = [
    formattedPhone,
    phoneWithPlus,
    '0' + formattedPhone.slice(2),
    formattedPhone.slice(2),
  ];

  // An existing INTERNAL team member has an admin_users row but NO public.users row (the
  // documented invariant), so the center-owner reuse lookup below would MISS them and
  // provisionStaffLogin would then collide on the duplicate <digits>@centerhq.local auth
  // email → a permanent 500. Catch that case FIRST, keyed by phone: they are already in the
  // team, so retire the request (guarded so a concurrent decline still wins honestly) and
  // do NOT re-provision or change their role.
  const { data: existingByPhone } = await admin
    .from('admin_users')
    .select('id')
    .in('phone', phoneVariants)
    .limit(1)
    .maybeSingle();
  if (existingByPhone) {
    const existingId = (existingByPhone as { id: string }).id;
    const { data: claimed } = await admin
      .from('staff_requests')
      .update({
        status: 'approved',
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
        provisioned_user_id: existingId,
      })
      .eq('id', req.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claimed) return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 });
    return NextResponse.json({ ok: true, status: 'approved', alreadyInTeam: true });
  }

  // A center owner DOES have a public.users row — reuse that login if the phone matches one;
  // otherwise we provision a fresh login below.
  let reusedUserId: string | null = null;
  for (const p of phoneVariants) {
    const { data: userRow } = await admin.from('users').select('id').eq('phone', p).maybeSingle();
    if (userRow) {
      reusedUserId = (userRow as { id: string }).id;
      break;
    }
  }
  // Self-add guard on a reused login (a freshly provisioned id can never equal the approver).
  if (reusedUserId && reusedUserId === ctx.userId) {
    return NextResponse.json({ error: 'You cannot approve your own request' }, { status: 403 });
  }

  // CLAIM the request atomically BEFORE any provisioning side effect. Only a still-pending
  // row transitions; a concurrent decline/approve makes this match 0 rows → 409 and we
  // provision nothing. On ANY downstream failure we revert to 'pending' so the request never
  // leaves the queue half-provisioned (the CEO can simply retry).
  const { data: claim } = await admin
    .from('staff_requests')
    .update({ status: 'approved', reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq('id', req.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!claim) return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 });

  const revertClaim = async () => {
    try {
      await admin
        .from('staff_requests')
        .update({ status: 'pending', reviewed_by: null, reviewed_at: null, provisioned_user_id: null })
        .eq('id', req.id);
    } catch {
      /* best-effort — logged by the caller */
    }
  };

  let userId: string | null = reusedUserId;
  let setupUrl: string | null = null;
  let provisioned = false;
  let staffLinked = false;

  try {
    if (!userId) {
      const result = await provisionStaffLogin(admin, { phone: phoneWithPlus, name: req.name.trim() });
      userId = result.userId;
      setupUrl = result.setupUrl;
      provisioned = true;
    }

    // Defensive self-add guard (a fresh id can't be the approver; belt-and-braces).
    if (ctx.userId === userId) {
      if (provisioned && userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
      await revertClaim();
      return NextResponse.json({ error: 'You cannot approve your own request' }, { status: 403 });
    }

    // Edge: a reused center-owner login that is ALREADY an admin_users member (their
    // admin_users.phone didn't match the variants above). Don't double-insert or change role.
    const { data: existingAdmin } = await admin
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (existingAdmin) {
      await admin.from('staff_requests').update({ provisioned_user_id: userId }).eq('id', req.id);
      return NextResponse.json({ ok: true, status: 'approved', alreadyInTeam: true });
    }

    const adminEmail = (req.email || '').trim() || `${formattedPhone}@centerhq.placeholder`;
    const customPerms = req.role === 'custom' ? req.custom_permissions ?? [] : [];
    const { error: insertError } = await admin.from('admin_users').insert({
      id: userId,
      name: req.name.trim(),
      email: adminEmail,
      phone: formattedPhone,
      role: req.role, // FROZEN from the invite
      custom_permissions: customPerms,
    });
    if (insertError) throw insertError;

    // Link the HR staff row (sm/sr) to this login. Match by phone; only link an unlinked row.
    let staffRow: { id: string; user_id: string | null } | null = null;
    for (const p of phoneVariants) {
      const { data } = await admin.from('staff').select('id, user_id').eq('phone', p).maybeSingle();
      if (data) {
        staffRow = data as { id: string; user_id: string | null };
        break;
      }
    }
    if (staffRow && !staffRow.user_id) {
      const { error: linkErr } = await admin
        .from('staff')
        .update({ user_id: userId })
        .eq('id', staffRow.id)
        .is('user_id', null);
      if (!linkErr) staffLinked = true;
    }

    // Stamp the provisioned identity onto the already-approved request.
    await admin.from('staff_requests').update({ provisioned_user_id: userId }).eq('id', req.id);
  } catch (e) {
    // Roll back a freshly provisioned auth user AND revert the claim so the request returns
    // to the queue for a clean retry — never a half-provisioned 'approved' row.
    if (provisioned && userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    await revertClaim();
    console.error('[PATCH /api/admin/staff-requests] provision/approve', e);
    return NextResponse.json({ error: 'Failed to add team member' }, { status: 500 });
  }

  try {
    await admin.from('audit_log').insert({
      user_id: ctx.userId,
      action: 'staff_request_approved',
      details: { request_id: req.id, provisioned_user_id: userId, role: req.role, provisioned, staffLinked },
    });
  } catch (e) {
    console.error('[PATCH /api/admin/staff-requests] audit approve', e);
  }

  return NextResponse.json({ ok: true, status: 'approved', provisioned, setupUrl, staffLinked });
}
