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

  return NextResponse.json({
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
  });
}
