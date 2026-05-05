/**
 * PIN Reset Route
 *
 * Production flow: OTP sent via chq_pin_delivery WhatsApp template.
 * Blocked until: Vodafone postpaid SIM active + Meta approves chq_pin_delivery.
 *
 * Manual admin fallback (use while WA is not live):
 * 1. User contacts support
 * 2. Admin runs in Supabase SQL Editor:
 *    SELECT id, otp_hash, expires_at FROM pin_reset_otps
 *    WHERE phone = '+20XXXXXXXXXX'
 *    ORDER BY created_at DESC LIMIT 1;
 * 3. Admin reads OTP hash — bcrypt compare externally to find the 6-digit code
 *    OR: Admin directly resets PIN:
 *    UPDATE users SET pin_code = '$2a$10$[hash_of_new_pin]'
 *    WHERE phone = '+20XXXXXXXXXX';
 * 4. Generate a bcrypt hash for any 6-digit PIN at: https://bcrypt-generator.com (cost 10)
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { sendPinDelivery } from '@/lib/centerNotify';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { resetPinPhoneRatelimit, rateLimitedResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';

function generateSixDigitOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900000;
  return String(100000 + n);
}

/**
 * POST /api/auth/reset-pin
 * Public. No requireCenterAuth. Always returns { success: true } when not rate limited,
 * to avoid phone enumeration (invalid or unknown phones behave the same).
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ success: true });
    }

    const rawPhone = typeof (body as { phone?: unknown })?.phone === 'string' ? (body as { phone: string }).phone.trim() : '';
    if (!rawPhone) {
      return NextResponse.json({ success: true });
    }

    const normalizedPhone = normalizePhone(rawPhone);
    if (!isValidEgyptianMobileE164(normalizedPhone)) {
      return NextResponse.json({ success: true });
    }

    if (resetPinPhoneRatelimit) {
      const { success, reset } = await resetPinPhoneRatelimit.limit(normalizedPhone);
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return rateLimitedResponse(retryAfter);
      }
    }

    const admin = getSupabaseAdmin();

    const { data: user, error: userErr } = await admin
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('is_active', true)
      .maybeSingle();

    if (userErr) {
      console.error('[reset-pin] users lookup:', userErr);
      return NextResponse.json({ success: true });
    }

    if (!user) {
      return NextResponse.json({ success: true });
    }

    const otp = generateSixDigitOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin.from('pin_reset_otps').insert({
      phone: normalizedPhone,
      otp_hash: otpHash,
      expires_at: expiresAt,
    });

    if (insertErr) {
      console.error('[reset-pin] pin_reset_otps insert:', insertErr);
      return NextResponse.json({ success: true });
    }

    try {
      await sendPinDelivery(normalizedPhone, otp);
    } catch {
      console.error('[reset-pin] sendPinDelivery failed — WA not yet live');
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[reset-pin]', e);
    return NextResponse.json({ success: true });
  }
}
