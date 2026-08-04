/**
 * POST /api/verification/start — begin the hosted Valify identity check.
 *
 * Returns the URL to redirect the provider to. It does NOT verify anyone, and
 * nothing it can return marks an account verified — only the HMAC-verified
 * webhook can do that (design/VERIFICATION-SPEC.md §2b).
 *
 * TODAY THIS ROUTE ALWAYS REFUSES, with `cause: valify_not_configured` and HTTP
 * 503, because no Valify credentials exist. That is the intended behaviour, not
 * an unfinished state: the whole path behind it is built and switches on with an
 * env change. It never returns a fabricated link and never reports success.
 *
 * Serves BOTH provider types:
 *   - centre owners  → subject { kind: 'center' }, centre-scoped
 *   - teachers       → subject { kind: 'teacher' }, centre-less by design
 *
 * ⚠ OPEN PRODUCT QUESTION, deliberately answered conservatively.
 * VERIFICATION-SPEC §3 open question 5 asks who may start verification, and no
 * design answers it. §6 notes that verification is what makes "withdraw money"
 * and "change payout account" owner-only and undelegatable — so as drawn, a
 * manager could verify with their OWN national ID and thereby unlock the
 * owner's money. This route restricts starting to `role === 'owner'` until Eyad
 * decides. Widening a gate later is cheap; a manager's ID sitting on a centre's
 * tax receipts is not.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth, requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { getValifyConfigStatus } from '@/lib/valifyGuardLogic';
import {
  ValifyLinkError,
  VALIFY_LINK_TTL_MINUTES,
  requestValifyVerificationLink,
} from '@/lib/valifyClient';
import { ValifyNotConfiguredError } from '@/lib/valifyGuardLogic';
import {
  VerificationStoreError,
  getEffectiveVerification,
  recordAttemptStarted,
  type VerificationSubject,
} from '@/lib/verificationStore';
import {
  valifyUnconfiguredResponse,
  verificationUnavailableResponse,
} from '@/lib/verificationRefusal';

export const dynamic = 'force-dynamic';

function appOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.trim().length > 0) return configured.trim().replace(/\/+$/, '');
  return new URL(request.url).origin;
}

export async function POST(request: NextRequest) {
  // ---------------------------------------------------------------------
  // 1. The guard, FIRST — before auth, before any database read.
  //
  // Ordering is deliberate. An unconfigured provider is not a per-user fact,
  // so making the caller authenticate only to be told the feature does not
  // exist wastes a round trip and leaks nothing useful. It also guarantees
  // there is no ordering in which a credential-less deploy touches Valify.
  // ---------------------------------------------------------------------
  const guard = getValifyConfigStatus();
  if (!guard.configured && guard.cause) {
    return valifyUnconfiguredResponse(guard.cause, guard.missing);
  }

  // 2. Authenticate and derive the subject SERVER-SIDE. Never from the body.
  let subject: VerificationSubject;
  let userId: string;
  let supabaseAdmin;

  const centerAuth = await requireCenterAuth(request);
  if (centerAuth.ok) {
    if (!validateCSRFRequest(request, centerAuth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }
    if (centerAuth.role !== 'owner') {
      return NextResponse.json(
        {
          error: 'Only the centre owner can start identity verification.',
          cause: 'owner_only',
        },
        { status: 403 },
      );
    }
    subject = { kind: 'center', centerId: centerAuth.centerId };
    userId = centerAuth.userId;
    supabaseAdmin = centerAuth.supabaseAdmin;
  } else {
    const teacherAuth = await requireTeacherAuth(request);
    if (!teacherAuth.ok) return teacherAuth.response;
    if (!validateCSRFRequest(request, teacherAuth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }
    // Teachers are centre-less (users.center_id NULL, membership via
    // teacher_center). The subject is the teacher's own user id and that is
    // correct — a teacher verifies as a person, not through a centre.
    subject = { kind: 'teacher', userId: teacherAuth.userId };
    userId = teacherAuth.userId;
    supabaseAdmin = teacherAuth.supabaseAdmin;
  }

  // 3. Refuse to start a second check over a live one.
  let current;
  try {
    current = await getEffectiveVerification(supabaseAdmin, subject);
  } catch (e) {
    if (e instanceof VerificationStoreError) {
      return handleStoreError(e, userId);
    }
    throw e;
  }

  if (current.state === 'unconfigured' && current.cause) {
    return valifyUnconfiguredResponse(current.cause);
  }
  if (current.state === 'verified') {
    return NextResponse.json(
      { error: 'This account is already verified.', cause: 'already_verified' },
      { status: 409 },
    );
  }
  if (current.state === 'pending') {
    return NextResponse.json(
      {
        error: 'A verification check is already running. We will update you when it finishes.',
        cause: 'already_pending',
      },
      { status: 409 },
    );
  }

  // 4. Mint OUR reference. Opaque and unguessable: it is the only identifier
  //    that travels to Valify and back, and it must not encode the subject.
  //    The subject binding lives in our own row (verification_attempts).
  const referenceId = randomUUID();
  const expiresAt = new Date(Date.now() + VALIFY_LINK_TTL_MINUTES * 60_000).toISOString();
  const origin = appOrigin(request);

  let link;
  try {
    link = await requestValifyVerificationLink({
      referenceId,
      returnUrl: `${origin}/api/verification/return?ref=${encodeURIComponent(referenceId)}`,
      expiresAt,
    });
  } catch (e) {
    if (e instanceof ValifyNotConfiguredError) {
      // Belt and braces: the guard already ran, but if config changed
      // mid-request we still refuse with the named cause rather than 500.
      return valifyUnconfiguredResponse(e.cause_code, e.missing);
    }
    if (e instanceof ValifyLinkError) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'verification/start');
        scope.setTag('valify_cause', e.cause_code);
        Sentry.captureException(e);
      });
      return verificationUnavailableResponse(
        e.cause_code,
        'We could not reach our verification provider just now. Nothing was recorded against your account. Please try again shortly.',
        'تعذّر الوصول إلى مزوّد التحقق في الوقت الحالي. لم يُسجَّل أي شيء على حسابك. برجاء المحاولة مرة أخرى بعد قليل.',
      );
    }
    throw e;
  }

  // 5. Record the attempt BEFORE handing the browser over. If this write fails
  //    the webhook would arrive unbound and we would not know whose result it
  //    is, so we refuse rather than redirect into a result we cannot attribute.
  try {
    await recordAttemptStarted(supabaseAdmin, subject, { referenceId, expiresAt });
  } catch (e) {
    if (e instanceof VerificationStoreError) return handleStoreError(e, userId);
    throw e;
  }

  return NextResponse.json({
    // Named `redirectUrl`, never `verified`. Nothing in this response can be
    // misread as an outcome.
    redirectUrl: link.redirectUrl,
    referenceId,
    expiresAt: link.expiresAt,
    state: 'pending',
    verified: false,
  });
}

function handleStoreError(e: VerificationStoreError, userId: string) {
  if (e.cause_code === 'verification_schema_not_applied') {
    return valifyUnconfiguredResponse('verification_schema_not_applied');
  }
  Sentry.withScope((scope) => {
    scope.setTag('route', 'verification/start');
    scope.setTag('store_cause', e.cause_code);
    scope.setUser({ id: userId });
    Sentry.captureException(e);
  });
  return verificationUnavailableResponse(
    e.cause_code,
    'We could not start identity verification. Nothing was recorded against your account.',
    'تعذّر بدء التحقق من الهوية. لم يُسجَّل أي شيء على حسابك.',
    500,
  );
}
