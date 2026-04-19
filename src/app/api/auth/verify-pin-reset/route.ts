import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import {
  verifyPinResetPhoneRatelimit,
  rateLimitedResponse,
} from '@/lib/ratelimit';

const SIX_DIGITS = /^\d{6}$/;

/**
 * POST /api/auth/verify-pin-reset
 * Public. Validates OTP hash and sets auth password to the new 6-digit PIN.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawPhone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';
    const newPin = typeof body?.newPin === 'string' ? body.newPin.trim() : '';

    if (!rawPhone || !SIX_DIGITS.test(otp) || !SIX_DIGITS.test(newPin)) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const normalizedPhone = normalizePhone(rawPhone);
    if (!isValidEgyptianMobileE164(normalizedPhone)) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    if (verifyPinResetPhoneRatelimit) {
      const { success, reset } = await verifyPinResetPhoneRatelimit.limit(normalizedPhone);
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return rateLimitedResponse(retryAfter);
      }
    }

    const admin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data: row, error: rowErr } = await admin
      .from('pin_reset_otps')
      .select('id, otp_hash')
      .eq('phone', normalizedPhone)
      .eq('used', false)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rowErr || !row) {
      return NextResponse.json({ error: 'invalid_otp' }, { status: 400 });
    }

    const match = await bcrypt.compare(otp, row.otp_hash);
    if (!match) {
      return NextResponse.json({ error: 'invalid_otp' }, { status: 400 });
    }

    const { error: useErr } = await admin
      .from('pin_reset_otps')
      .update({ used: true })
      .eq('id', row.id)
      .eq('used', false);

    if (useErr) {
      console.error('[verify-pin-reset] mark used:', useErr);
      return NextResponse.json({ error: 'invalid_otp' }, { status: 400 });
    }

    const { data: user, error: userErr } = await admin
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (userErr || !user) {
      console.error('[verify-pin-reset] user missing after valid OTP', userErr);
      return NextResponse.json({ error: 'invalid_otp' }, { status: 400 });
    }

    const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
      password: newPin,
    });

    if (authErr) {
      console.error('[verify-pin-reset] updateUserById:', authErr);
      return NextResponse.json({ error: 'reset_failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[verify-pin-reset]', e);
    return NextResponse.json({ error: 'reset_failed' }, { status: 500 });
  }
}
