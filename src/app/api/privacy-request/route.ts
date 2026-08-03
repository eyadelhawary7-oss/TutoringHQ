import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizePhone } from '@/lib/utils/phone';
import { sendPrivacyRequestConfirmation } from '@/lib/privacyRequestConfirmation';

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
 *
 * `request_types` is multi-value: a subject asking for access AND deletion used
 * to have to file the form twice, because the route wrapped one `requestType`
 * into a single-element array. The column was `text[]` all along.
 *
 * Stored values are the PDPL right-names, not the form's button labels. The
 * admin erasure path (`api/admin/privacy-requests/anonymize`) gates on
 * `types.includes('deletion')`, so that spelling is load-bearing.
 */
export const VALID_TYPES = new Set([
  'access',
  'correction',
  'deletion',
  'restriction',
  'portability',
  'objection',
]);

const VALID_RELATIONSHIPS = new Set([
  'center_owner',
  'staff',
  'parent',
  'student',
  'other',
]);

/** Deliberately permissive: reject obvious non-addresses, not unusual valid ones. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const locale = typeof body.locale === 'string' ? body.locale : 'ar';

  const relationshipRaw = typeof body.relationship === 'string' ? body.relationship.trim() : '';
  const relationship = relationshipRaw || null;

  // De-duplicate while preserving the order the subject picked them in.
  const rawTypes = Array.isArray(body.requestTypes) ? body.requestTypes : [];
  const types = Array.from(
    new Set(rawTypes.filter((t): t is string => typeof t === 'string')),
  );

  // Email is required: with the phone confirmation off by default it is the only
  // channel a reply can actually reach, so calling it optional would be untrue.
  if (
    name.length < 2 ||
    !rawPhone ||
    !EMAIL_RE.test(email) ||
    types.length === 0 ||
    !types.every((t) => VALID_TYPES.has(t)) ||
    (relationship !== null && !VALID_RELATIONSHIPS.has(relationship))
  ) {
    return NextResponse.json({ error: 'Invalid request', code: 'INVALID_FIELDS' }, { status: 400 });
  }

  const phone = normalizePhone(rawPhone) || rawPhone;

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured', code: 'server_error' }, { status: 500 });
  }

  // status is server-set ('pending'), never from the body. Every column written
  // here is confirmed present in the live catalog (information_schema.columns
  // on privacy_requests): full_name, phone, email, relationship, request_types,
  // description, status.
  const { data: inserted, error: insertErr } = await admin.from('privacy_requests').insert({
    full_name: name,
    phone,
    email,
    relationship,
    request_types: types,
    description: message || null,
    status: 'pending',
  }).select('id').single();

  if (insertErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/privacy-request');
      scope.setTag('step', 'insert_privacy_request');
      Sentry.captureException(insertErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  const typeList = types.join(', ');

  // H8: make the request unmissable — an admin_alerts row (shown in the admin
  // panel) plus an in-app notification to every platform admin. Best-effort:
  // the privacy_requests row above is the authoritative record, so a failure
  // here must not fail the data subject's request.
  const requestId = (inserted as { id: string } | null)?.id ?? null;
  try {
    await admin.from('admin_alerts').insert({
      center_id: null,
      type: 'privacy_request',
      message: `New PDPL request from ${name} (${typeList}). Due within 30 days.`,
      is_resolved: false,
    });

    const { data: admins } = await admin.from('admin_users').select('id');
    const adminRows = (admins ?? []) as { id: string }[];
    if (adminRows.length > 0) {
      await admin.from('in_app_notifications').insert(
        adminRows.map((a) => ({
          user_id: a.id,
          center_id: null,
          kind: 'privacy_request',
          title: 'New data-rights request',
          body: `${typeList} request from ${name}. Action due within 30 days.`,
          href: '/admin/privacy-requests',
          metadata: requestId
            ? { privacy_request_id: requestId, request_types: types }
            : { request_types: types },
        })),
      );
    }
  } catch (notifyErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/privacy-request');
      scope.setTag('step', 'notify_admins');
      Sentry.captureException(notifyErr);
    });
  }

  // Best-effort confirmation to the requester. Unconfigured by default — see
  // lib/privacyRequestConfirmation.ts. `confirmationSent` drives which sentence
  // the confirmation screen shows, so it must never be optimistic.
  let confirmationSent = false;
  try {
    const result = await sendPrivacyRequestConfirmation(admin, phone, locale);
    confirmationSent = result.sent;
    if (!result.sent) {
      Sentry.captureMessage('PDPL confirmation not sent', {
        level: 'info',
        tags: { route: 'api/privacy-request', reason: result.reason },
      });
    }
  } catch (confirmErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/privacy-request');
      scope.setTag('step', 'send_confirmation');
      Sentry.captureException(confirmErr);
    });
  }

  // Belt-and-suspenders: the DB row is the authoritative record; this info
  // message is a redundant ops notification (harmless when the insert succeeds).
  Sentry.captureMessage('PDPL data-rights request submitted', {
    level: 'info',
    tags: { route: 'api/privacy-request', request_types: typeList },
  });

  return NextResponse.json({ message: 'Request received', confirmationSent }, { status: 201 });
}
