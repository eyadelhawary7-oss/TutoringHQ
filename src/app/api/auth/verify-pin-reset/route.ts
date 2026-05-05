import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import {
  verifyPinResetPhoneRatelimit,
  rateLimitedResponse,
} from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';

const SIX_DIGITS = /^\d{6}$/;

/**
 * POST /api/auth/verify-pin-reset
 * Public. No requireCenterAuth.
 * 1) Bcrypt-hash new PIN into public.users.pin_code (cost 10). This is the stored PIN hash.
 * 2) Sets the same digits on the Supabase Auth user so /login signInWithPassword still works.
 *    (Calling updateUserById updates auth password only, not pin_code; it does not replace step 1.)
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }

    const rawPhone = typeof (body as { phone?: unknown })?.phone === 'string' ? (body as { phone: string }).phone.trim() : '';
    const otp = typeof (body as { otp?: unknown })?.otp === 'string' ? (body as { otp: string }).otp.trim() : '';
    const newPin = typeof (body as { newPin?: unknown })?.newPin === 'string' ? (body as { newPin: string }).newPin.trim() : '';

    if (!rawPhone || !SIX_DIGITS.test(otp) || !SIX_DIGITS.test(newPin)) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }

    const normalizedPhone = normalizePhone(rawPhone);
    if (!isValidEgyptianMobileE164(normalizedPhone)) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
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
      .eq('is_active', true)
      .maybeSingle();

    if (userErr || !user) {
      console.error('[verify-pin-reset] user missing after valid OTP', userErr);
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
    }

    const newPinHash = await bcrypt.hash(newPin, 10);

    const { error: updateError } = await admin
      .from('users')
      .update({ pin_code: newPinHash })
      .eq('id', user.id);

    if (updateError) {
      console.error('[verify-pin-reset] failed to update pin_code:', updateError);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }

    const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
      password: newPin,
    });
    if (authErr) {
      console.error('[verify-pin-reset] Supabase Auth password sync failed:', authErr);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[verify-pin-reset]', e);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
}
