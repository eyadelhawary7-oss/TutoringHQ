/**
 * GET /api/verification/return — where Valify sends the browser back.
 *
 * ============================================================================
 * THIS ROUTE CANNOT MAKE ANYONE VERIFIED. IT WRITES NOTHING. AT ALL.
 * ============================================================================
 * It is a UX destination and nothing more. design/VERIFICATION-SPEC.md §2 names
 * this as the security boundary of the entire feature: "if verified state is
 * settable from whatever comes back on the redirect, hitting the success URL
 * makes you verified." Valify's own docs confirm the redirect and the webhook
 * fire together, and only the webhook is authenticated
 * (VERIFICATION-SPEC §2b, step 6).
 *
 * So this handler performs exactly one job: read where things stand and send the
 * browser somewhere that says so. It takes NO outcome from the query string. A
 * hand-crafted `?status=success` changes nothing, because nothing here reads it.
 * The state machine enforces the same rule independently — `canTransition(...,
 * 'verified', 'user')` returns `verified_requires_provider_webhook`.
 *
 * THE PENDING CASE IS THE POINT. A provider who finishes at Valify and returns
 * before the webhook lands must see "still running", never "not verified".
 * VERIFICATION-SPEC §9.1 flags that today they would land on "Not verified",
 * which reads as REJECTED. The `verification` query param below carries the real
 * state so the destination can say the true thing.
 *
 * ----------------------------------------------------------------------------
 * WHERE IT REDIRECTS, AND WHY NOT TO THE DESIGNED SCREEN
 * ----------------------------------------------------------------------------
 * It lands on `/{locale}/settings?verification=<state>`. The designed
 * destination is `Merged-Verification-Payouts` §01 "Settings Verification",
 * which is one of the SIX PROTECTED FILES and is Eyad's own phase — this
 * territory does not build it. `/settings` is the live hub that will host that
 * row, it is already in AUTHENTICATED_ROUTE_PREFIXES, and it renders today. When
 * §01 is built it reads the same query param and nothing here changes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth, requireTeacherAuth } from '@/lib/centerAuth';
import { getValifyConfigStatus } from '@/lib/valifyGuardLogic';
import {
  VerificationStoreError,
  getEffectiveVerification,
  type VerificationSubject,
} from '@/lib/verificationStore';

export const dynamic = 'force-dynamic';

const LOCALES = ['ar', 'en'] as const;
const DEFAULT_LOCALE = 'ar';

/**
 * Locale for the destination. Read from the raw Cookie header rather than
 * `NextRequest.cookies` so this works on any `Request` — the redirect target
 * must resolve even when the helper is exercised outside a Next server context.
 * Falls back to `ar`, the app's defaultLocale, never to a locale-less path:
 * `localePrefix: 'always'` means an unprefixed URL is not a valid destination.
 */
function resolveLocale(request: NextRequest): string {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.split('=');
    if (name?.trim() !== 'NEXT_LOCALE') continue;
    const value = rest.join('=').trim();
    if ((LOCALES as readonly string[]).includes(value)) return value;
  }
  return DEFAULT_LOCALE;
}

function settingsRedirect(
  request: NextRequest,
  params: Record<string, string>,
): NextResponse {
  const locale = resolveLocale(request);
  const url = new URL(`/${locale}/settings`, new URL(request.url).origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  // Unconfigured is reachable here in only one way — someone opened the URL by
  // hand, since no link was ever issued. Say so plainly rather than 404.
  const guard = getValifyConfigStatus();
  if (!guard.configured && guard.cause) {
    return settingsRedirect(request, { verification: 'unconfigured', cause: guard.cause });
  }

  let subject: VerificationSubject;
  let supabaseAdmin;

  const centerAuth = await requireCenterAuth(request);
  if (centerAuth.ok) {
    subject = { kind: 'center', centerId: centerAuth.centerId };
    supabaseAdmin = centerAuth.supabaseAdmin;
  } else {
    const teacherAuth = await requireTeacherAuth(request);
    if (!teacherAuth.ok) {
      // Session lost during the round trip to Valify. Send them to log in
      // rather than showing a state we cannot attribute to anyone.
      const locale = resolveLocale(request);
      return NextResponse.redirect(
        new URL(`/${locale}/login`, new URL(request.url).origin),
      );
    }
    subject = { kind: 'teacher', userId: teacherAuth.userId };
    supabaseAdmin = teacherAuth.supabaseAdmin;
  }

  try {
    const effective = await getEffectiveVerification(supabaseAdmin, subject);
    // `pending` is the expected value on a normal, successful return: the user
    // is back before the webhook. The destination must read that as "running",
    // not as a rejection.
    return settingsRedirect(request, {
      verification: effective.state,
      ...(effective.cause ? { cause: effective.cause } : {}),
    });
  } catch (e) {
    if (e instanceof VerificationStoreError) {
      return settingsRedirect(request, {
        verification: 'unconfigured',
        cause:
          e.cause_code === 'verification_schema_not_applied'
            ? 'verification_schema_not_applied'
            : 'verification_unavailable',
      });
    }
    throw e;
  }
}
