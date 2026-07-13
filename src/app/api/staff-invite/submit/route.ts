// /api/staff-invite/submit
//
// PUBLIC route — the invite token is the authority. The invited person submits ONLY their
// name / phone / email. This creates an INERT pending request:
//   * NO auth identity, NO admin_users row, NO credential is created here.
//   * The role + permissions are copied FROM the invite (frozen at submit) — the submitter
//     cannot choose, change, or escalate them. Any `role` field in the body is ignored
//     (it is not part of staffInviteSubmitSchema and is stripped).
//   * The invite is consumed atomically (single-use) BEFORE the request is inserted.
//
// Provisioning happens ONLY when a super_admin later approves the request.

import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getClientIp, getUpstashRedis, rateLimit } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';
import { staffInviteSubmitSchema } from '@/lib/validations';
import { findOpenInviteByPlaintext, consumeStaffInvite } from '@/lib/staffInviteTokens';

const SUBMIT_RATE_LIMIT_MAX = 5;
const SUBMIT_RATE_LIMIT_WINDOW_SECS = 900; // 5 intakes / 15 min / IP

/** Egypt phone → stored digit form `20XXXXXXXXXX` (matches admin_users.phone convention). */
function toStoredPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!digits.startsWith('20')) digits = '20' + digits;
  return digits;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await parseBodyWithLimit(request, 8192);
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const parsed = staffInviteSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { token, name, phone, email } = parsed.data;

  // Rate-limit — fail CLOSED (abuse-prone public insert; same posture as scanner inserts /
  // auth mutations). Without Upstash we cannot bound intake spam, so refuse.
  if (getUpstashRedis() === null) {
    Sentry.captureMessage('staff-invite/submit: Upstash not configured — refusing', {
      level: 'error',
      tags: { route: 'staff-invite-submit', reason: 'redis_not_configured' },
    });
    return NextResponse.json({ error: 'temporarily_unavailable', retry_after: 10 }, {
      status: 503,
      headers: { 'Retry-After': '10' },
    });
  }
  const ip = getClientIp(request);
  try {
    const { success } = await rateLimit(
      `staff-invite-submit:ip:${ip}`,
      SUBMIT_RATE_LIMIT_MAX,
      SUBMIT_RATE_LIMIT_WINDOW_SECS,
    );
    if (!success) {
      return NextResponse.json(
        { error: 'too_many_requests', retry_after: SUBMIT_RATE_LIMIT_WINDOW_SECS },
        { status: 429 },
      );
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'staff-invite-submit', step: 'rate_limit' } });
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 503 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'staff-invite-submit', step: 'admin_init' } });
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 500 });
  }

  // Resolve the invite by token hash. Generic response for unknown/used/revoked/expired so
  // the endpoint is not a token oracle beyond "usable or not".
  let invite;
  try {
    invite = await findOpenInviteByPlaintext(admin, token);
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'staff-invite-submit', step: 'invite_lookup' } });
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 500 });
  }
  if (!invite) {
    return NextResponse.json({ error: 'invite_invalid_or_used' }, { status: 400 });
  }

  // Consume the invite ATOMICALLY first (single-use gate). If this returns false, another
  // submit won the race — insert nothing.
  let consumed = false;
  try {
    consumed = await consumeStaffInvite(admin, invite.id);
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'staff-invite-submit', step: 'consume' } });
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 500 });
  }
  if (!consumed) {
    return NextResponse.json({ error: 'invite_invalid_or_used' }, { status: 400 });
  }

  // Insert the INERT pending request. role + custom_permissions come ONLY from the invite.
  const { error: insertErr } = await admin.from('staff_requests').insert({
    invite_id: invite.id,
    name: name.trim(),
    phone: toStoredPhone(phone),
    email: (email || '').trim() || null,
    role: invite.role,
    custom_permissions: invite.role === 'custom' ? invite.custom_permissions ?? [] : [],
    status: 'pending',
  });

  if (insertErr) {
    // The invite is already consumed (burned) — safe failure: no request exists and the
    // link cannot be reused. The CEO can mint a fresh invite. Log for follow-up.
    Sentry.captureException(insertErr, {
      tags: { route: 'staff-invite-submit', step: 'insert' },
      extra: { invite_id: invite.id },
    });
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
