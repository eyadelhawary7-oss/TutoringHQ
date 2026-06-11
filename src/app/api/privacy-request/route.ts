import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizePhone } from '@/lib/utils/phone';

/**
 * PUBLIC PDPL (Law 151/2020) data-rights request intake. No auth - the data
 * subject may not have an account, so the insert uses the service-role admin
 * client (privacy_requests RLS permits service_role inserts). Each request is
 * persisted to public.privacy_requests as the authoritative, timestamped PDPL
 * record; a Sentry info message is emitted as a redundant ops notification, and
 * an insert failure is captured to Sentry + returned as 500 so a rights request
 * is never silently lost. Rate-limited to 5 requests/hour per IP to prevent
 * abuse of the public form (NOT per-phone: the data subject may have no account
 * and the phone field is free-text, so IP is the only reliable abuse key).
 */
const VALID_TYPES = new Set([
  'access',
  'correction',
  'deletion',
  'portability',
  'objection',
]);

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const { success } = await rateLimit(`privacy-request:${ip}`, 5, 3600);
  if (!success) {
    return rateLimitExceededResponse(3600);
  }

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 16384)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'INVALID_BODY' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
  const requestType = typeof body.requestType === 'string' ? body.requestType : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (name.length < 2 || !rawPhone || !VALID_TYPES.has(requestType)) {
    return NextResponse.json({ error: 'Invalid request', code: 'INVALID_FIELDS' }, { status: 400 });
  }

  const phone = normalizePhone(rawPhone) || rawPhone;

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured', code: 'server_error' }, { status: 500 });
  }

  // status is server-set ('pending'), never from the body. request_types is an
  // array column; wrap the single form value.
  const { error: insertErr } = await admin.from('privacy_requests').insert({
    full_name: name,
    phone,
    email,
    request_types: [requestType],
    description: message || null,
    status: 'pending',
  });

  if (insertErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/privacy-request');
      scope.setTag('step', 'insert_privacy_request');
      Sentry.captureException(insertErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  // Belt-and-suspenders: the DB row is the authoritative record; this info
  // message is a redundant ops notification (harmless when the insert succeeds).
  Sentry.captureMessage('PDPL data-rights request submitted', {
    level: 'info',
    tags: { route: 'api/privacy-request', request_type: requestType },
  });

  return NextResponse.json({ message: 'Request received' }, { status: 201 });
}
