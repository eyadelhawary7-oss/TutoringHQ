import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';

/**
 * Payment methods the teacher can accept (parent pays the teacher directly).
 * Two only — design/NEW-MODEL.md. This gates writes to
 * teacher_profiles.default_payment_method, which the tuition-narrowing
 * migration constrains to cash | instapay | NULL.
 */
const PAYMENT_METHODS = ['cash', 'instapay'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === 'string' && (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** Trim a free-text handle to null when blank, capped at 200 chars. */
function normHandle(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, 200) : null;
}

/**
 * GET the authenticated teacher's own profile (display_name / subject) so the
 * settings form can prefill. Scoped to user_id = auth.userId via service role;
 * nothing identity-bearing is read from the request body/query. Returns null
 * fields when no row exists yet (the form then starts empty). Rule 151: a read
 * error surfaces as 500 + Sentry.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { data, error: readErr } = await auth.supabaseAdmin
    .from('teacher_profiles')
    .select(
      'display_name, subject, referral_code, instapay_address, wallet_phone, payment_phone, accepted_methods, default_payment_method',
    )
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (readErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/teacher/profile');
      scope.setTag('step', 'profile_read');
      Sentry.captureException(readErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  const acceptedRaw = data?.accepted_methods as unknown;
  const acceptedMethods = Array.isArray(acceptedRaw)
    ? acceptedRaw.filter((m): m is PaymentMethod => isPaymentMethod(m))
    : [];

  return NextResponse.json({
    displayName: (data?.display_name as string | null) ?? null,
    subject: (data?.subject as string | null) ?? null,
    referralCode: (data?.referral_code as string | null) ?? null,
    paymentDetails: {
      instapayAddress: (data?.instapay_address as string | null) ?? null,
      walletPhone: (data?.wallet_phone as string | null) ?? null,
      paymentPhone: (data?.payment_phone as string | null) ?? null,
      acceptedMethods,
      defaultPaymentMethod: isPaymentMethod(data?.default_payment_method)
        ? data.default_payment_method
        : null,
    },
  });
}

/**
 * PATCH the authenticated teacher's profile (display_name / subject). Scoped
 * to the teacher's own row by user_id = auth.userId - nothing identity-bearing
 * is read from the body. Upserts teacher_profiles on conflict(user_id) so it
 * works whether or not the signup-time row exists. At least one field is
 * required. Rule 151: a write error surfaces as 500 + Sentry.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'invalid_body' }, { status: 400 });
  }
  const {
    displayName: rawName,
    subject: rawSubject,
    checklistDismissed: rawDismissedCamel,
    checklist_dismissed: rawDismissedSnake,
    paymentDetails: rawPaymentDetails,
  } = (body ?? {}) as {
    displayName?: unknown;
    subject?: unknown;
    checklistDismissed?: unknown;
    checklist_dismissed?: unknown;
    paymentDetails?: unknown;
  };

  const hasName = rawName !== undefined;
  const hasSubject = rawSubject !== undefined;
  // Either key spelling is accepted; only `true` latches (no un-dismissing).
  const hasDismiss = rawDismissedCamel === true || rawDismissedSnake === true;
  const hasPayment =
    rawPaymentDetails !== undefined &&
    rawPaymentDetails !== null &&
    typeof rawPaymentDetails === 'object';
  if (!hasName && !hasSubject && !hasDismiss && !hasPayment) {
    return NextResponse.json(
      { error: 'Nothing to update', code: 'no_fields' },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = { user_id: auth.userId };
  if (hasName) {
    const displayName = typeof rawName === 'string' ? rawName.trim() : '';
    if (displayName.length < 2 || displayName.length > 120) {
      return NextResponse.json(
        { error: 'Invalid name', code: 'invalid_name' },
        { status: 400 },
      );
    }
    updates.display_name = displayName;
  }
  if (hasSubject) {
    updates.subject =
      typeof rawSubject === 'string' && rawSubject.trim() ? rawSubject.trim() : null;
  }
  // Dismiss is a one-way latch (only ever set to true here); the column lives
  // on teacher_profiles (migration 20260612000000).
  if (hasDismiss) {
    updates.checklist_dismissed = true;
  }
  // Payment details: the parent pays the teacher directly; the platform only
  // relays these handles in the fee-reminder template (no payment link). The
  // default method must be one the teacher accepts so the reminder copy is
  // coherent. Columns added in migration 20260620123000.
  if (hasPayment) {
    const pd = rawPaymentDetails as {
      instapayAddress?: unknown;
      walletPhone?: unknown;
      paymentPhone?: unknown;
      acceptedMethods?: unknown;
      defaultPaymentMethod?: unknown;
    };

    const acceptedRaw = Array.isArray(pd.acceptedMethods) ? pd.acceptedMethods : [];
    const acceptedMethods = Array.from(
      new Set(acceptedRaw.filter((m): m is PaymentMethod => isPaymentMethod(m))),
    );

    let defaultMethod: PaymentMethod | null = null;
    if (pd.defaultPaymentMethod !== undefined && pd.defaultPaymentMethod !== null && pd.defaultPaymentMethod !== '') {
      if (!isPaymentMethod(pd.defaultPaymentMethod)) {
        return NextResponse.json(
          { error: 'Invalid default method', code: 'invalid_default_method' },
          { status: 400 },
        );
      }
      if (!acceptedMethods.includes(pd.defaultPaymentMethod)) {
        return NextResponse.json(
          { error: 'Default method must be accepted', code: 'default_not_accepted' },
          { status: 400 },
        );
      }
      defaultMethod = pd.defaultPaymentMethod;
    }

    updates.instapay_address = normHandle(pd.instapayAddress);
    updates.wallet_phone = normHandle(pd.walletPhone);
    updates.payment_phone = normHandle(pd.paymentPhone);
    updates.accepted_methods = acceptedMethods;
    updates.default_payment_method = defaultMethod;
    updates.payment_details_updated_at = new Date().toISOString();
  }

  const { error: upsertErr } = await auth.supabaseAdmin
    .from('teacher_profiles')
    .upsert(updates, { onConflict: 'user_id' });
  if (upsertErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/teacher/profile');
      scope.setTag('step', 'profile_upsert');
      Sentry.captureException(upsertErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
