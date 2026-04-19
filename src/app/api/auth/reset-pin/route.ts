import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { sendPinDelivery } from '@/lib/centerNotify';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { resetPinPhoneRatelimit, rateLimitedResponse } from '@/lib/ratelimit';

function generateSixDigitOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900000;
  return String(100000 + n);
}

/**
 * POST /api/auth/reset-pin
 * Public. Always returns { success: true } on valid input to avoid phone enumeration.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawPhone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    if (!rawPhone) {
      return NextResponse.json({ error: 'phone_required' }, { status: 400 });
    }

    const normalizedPhone = normalizePhone(rawPhone);
    if (!isValidEgyptianMobileE164(normalizedPhone)) {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
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

    const sent = await sendPinDelivery(normalizedPhone, otp);
    if (!sent) {
      console.error('[reset-pin] sendPinDelivery returned false', {
        phone: normalizedPhone,
      });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[reset-pin]', e);
    return NextResponse.json({ success: true });
  }
}
