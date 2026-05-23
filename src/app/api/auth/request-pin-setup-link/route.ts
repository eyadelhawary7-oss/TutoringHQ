import * as Sentry from '@sentry/nextjs';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { resetPinPhoneRatelimit, rateLimitedResponse } from '@/lib/ratelimit';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { parseBodyWithLimit } from '@/lib/validate';
import { mintForFallback } from '@/lib/pinSetupTokens';
import { sendPinSetupLink } from '@/lib/centerNotify';

/**
 * POST /api/auth/request-pin-setup-link
 *
 * Cross-device / closed-tab fallback for the Set-PIN onboarding flow.
 * Looks up the owner user by phone; if and only if the user exists, has no
 * PIN yet (pin_code IS NULL), and the center is paid+activated, issues a
 * fresh fallback pin_setup_tokens row and sends a Set-PIN link via the new
 * chq_pin_setup_link WhatsApp template.
 *
 * ANTI-ENUMERATION: always returns { success: true }. Registered vs. unregistered
 * phones are indistinguishable from the client perspective. Matches the
 * established /api/auth/reset-pin pattern.
 *
 * Rate-limit fail-open here is acceptable (this is a delivery request, not an
 * auth-credential mutation; failing closed would let a transient Upstash blip
 * block legitimate recovery).
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await parseBodyWithLimit(request, 65536);
    } catch {
      return NextResponse.json({ success: true });
    }

    const rawPhone =
      typeof (body as { phone?: unknown })?.phone === 'string'
        ? (body as { phone: string }).phone.trim()
        : '';
    if (!rawPhone) return NextResponse.json({ success: true });

    const normalizedPhone = normalizePhone(rawPhone);
    if (!isValidEgyptianMobileE164(normalizedPhone)) {
      return NextResponse.json({ success: true });
    }

    if (resetPinPhoneRatelimit) {
      const { success, reset } = await resetPinPhoneRatelimit.limit(
        `pin-setup-link:${normalizedPhone}`,
      );
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return rateLimitedResponse(retryAfter);
      }
    }

    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      Sentry.captureException(e, {
        tags: { route: 'request-pin-setup-link', step: 'admin_init' },
      });
      return NextResponse.json({ success: true });
    }

    // Owner lookup. Anti-enumeration: unknown phone → return success without
    // doing further work.
    const { data: user, error: userErr } = await admin
      .from('users')
      .select('id, pin_code, center_id, is_active')
      .eq('phone', normalizedPhone)
      .eq('role', 'owner')
      .maybeSingle();

    if (userErr) {
      Sentry.captureException(userErr, {
        tags: { route: 'request-pin-setup-link', step: 'user_lookup' },
      });
      return NextResponse.json({ success: true });
    }
    if (!user) return NextResponse.json({ success: true });
    if (!(user as { is_active?: boolean }).is_active) {
      return NextResponse.json({ success: true });
    }

    // Already has a PIN → silently no-op. The fallback is ONLY for owners who
    // never finished initial setup. Owners with a PIN use forgot-PIN.
    if ((user as { pin_code?: string | null }).pin_code) {
      return NextResponse.json({ success: true });
    }

    const centerId = (user as { center_id?: string | null }).center_id;
    if (!centerId) return NextResponse.json({ success: true });

    const { data: center, error: cErr } = await admin
      .from('centers')
      .select('id, status, billing_status, approved_at')
      .eq('id', centerId)
      .maybeSingle();
    if (cErr) {
      Sentry.captureException(cErr, {
        tags: { route: 'request-pin-setup-link', step: 'center_lookup' },
      });
      return NextResponse.json({ success: true });
    }
    if (!center) return NextResponse.json({ success: true });
    const cs = center as {
      status?: string | null;
      billing_status?: string | null;
      approved_at?: string | null;
    };
    const paidActivated =
      cs.status === 'paid_pending_activation' ||
      (cs.status === 'active' && !!cs.approved_at);
    if (!paidActivated) return NextResponse.json({ success: true });

    let plaintext: string;
    try {
      const minted = await mintForFallback(admin, {
        userId: (user as { id: string }).id,
      });
      plaintext = minted.plaintext;
    } catch (e) {
      Sentry.captureException(e, {
        tags: { route: 'request-pin-setup-link', step: 'mint' },
      });
      return NextResponse.json({ success: true });
    }

    const appUrl =
      (process.env.NEXT_PUBLIC_APP_URL || 'https://centerhq.app').replace(/\/+$/, '') ||
      'https://centerhq.app';
    const setupUrl = `${appUrl}/ar/set-pin?t=${encodeURIComponent(plaintext)}`;

    try {
      await sendPinSetupLink(normalizedPhone, setupUrl);
    } catch (e) {
      // Send failure is non-fatal — owner can retry. Log to Sentry.
      Sentry.captureException(e, {
        tags: { route: 'request-pin-setup-link', step: 'send' },
      });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'request-pin-setup-link' } });
    return NextResponse.json({ success: true });
  }
}
