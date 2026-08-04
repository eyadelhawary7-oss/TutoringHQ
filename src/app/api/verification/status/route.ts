/**
 * GET /api/verification/status — the honest answer to "am I verified?".
 *
 * The ONE endpoint any surface should ask. It returns the effective state after
 * the guard has had its say, so a client cannot accidentally render a verified
 * badge on a deployment where verification does not exist.
 *
 * TODAY IT ALWAYS RETURNS `state: 'unconfigured'`, `isVerified: false`, with the
 * named cause and human-readable copy in both locales. It returns HTTP 200 for
 * this — unlike the mutating entry points — because "we cannot verify anyone" is
 * a true, complete, successfully-computed answer to the question asked, and the
 * body says so unmistakably. There is no argument to this endpoint that yields
 * `isVerified: true` while Valify is unconfigured.
 *
 * DELIBERATELY NOT RETURNED: `national_id` and `legal_name`. They are read by
 * the server for the ETA receipt pipeline only and are never rendered in any UI
 * (VERIFICATION-SPEC §9.2, §9.5, and the §7.7/§7.8 PDPL conflicts). An endpoint
 * that returns them is one careless component away from putting a national ID on
 * a screen.
 *
 * ALSO DELIBERATELY NOT RETURNED: the Valify provider reference. A second
 * endpoint, `GET /api/verification/state`, briefly existed alongside this one and
 * returned it as `providerRef` while its own type comment said "BACKEND ONLY —
 * never rendered in any UI (VERIFICATION-SPEC §9.7)". Both endpoints answered the
 * same question, so that one is DELETED and its callers point here. The reference
 * did not come with it: shipping a field to the browser labelled "never render
 * this" is a dare, and the surfaces that consume this route need the state, not
 * the vendor's transaction id.
 *
 * `subjectKind` DID come with it, and is returned below. Callers legitimately
 * need to know whether they are looking at a centre or a solo teacher — the copy
 * and the destination screens differ — and it is derived server-side from the
 * session, never from request input.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth, requireTeacherAuth } from '@/lib/centerAuth';
import { refusalMessage } from '@/lib/valifyGuardLogic';
import {
  VerificationStoreError,
  getEffectiveVerification,
  type VerificationSubject,
} from '@/lib/verificationStore';
import { capabilitiesFor } from '@/lib/verificationState';
import { verificationUnavailableResponse } from '@/lib/verificationRefusal';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let subject: VerificationSubject;
  let supabaseAdmin;

  const centerAuth = await requireCenterAuth(request);
  if (centerAuth.ok) {
    subject = { kind: 'center', centerId: centerAuth.centerId };
    supabaseAdmin = centerAuth.supabaseAdmin;
  } else {
    const teacherAuth = await requireTeacherAuth(request);
    if (!teacherAuth.ok) return teacherAuth.response;
    subject = { kind: 'teacher', userId: teacherAuth.userId };
    supabaseAdmin = teacherAuth.supabaseAdmin;
  }

  let effective;
  try {
    effective = await getEffectiveVerification(supabaseAdmin, subject);
  } catch (e) {
    if (e instanceof VerificationStoreError) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'verification/status');
        scope.setTag('store_cause', e.cause_code);
        Sentry.captureException(e);
      });
      // A failed READ must never resolve to "not verified" as if that were the
      // answer — that is a silent downgrade dressed as a result. Refuse.
      return verificationUnavailableResponse(
        e.cause_code,
        'We could not read your verification status just now.',
        'تعذّر قراءة حالة التحقق الخاصة بك في الوقت الحالي.',
        500,
      );
    }
    throw e;
  }

  return NextResponse.json(
    {
      subjectKind: subject.kind,
      state: effective.state,
      cause: effective.cause,
      isVerified: effective.isVerified,
      canStartVerification: effective.canStartVerification,
      verifiedAt: effective.verified_at,
      lastOutcome: effective.last_outcome,
      capabilities: capabilitiesFor(effective.state),
      // Present only when there is something to explain, so a client rendering
      // `message` unconditionally shows nothing in the normal case.
      message: effective.cause ? refusalMessage(effective.cause) : null,
    },
    // Verification state changes out of band, when the webhook lands. A cached
    // "unverified" outliving the pass that replaced it is the one staleness this
    // surface cannot afford.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
