import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { normalizePhone } from '@/lib/utils/phone';

/**
 * Login lookup API: Find user by phone (public.users) and return auth email.
 * Uses service role to bypass RLS. Client then calls signInWithPassword with returned email + PIN.
 */
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const phoneRaw = typeof (body as { phone?: unknown })?.phone === 'string'
      ? (body as { phone: string }).phone.trim()
      : '';
    const ip = getClientIp(request);
    const normalizedForLoginKey = phoneRaw ? normalizePhone(phoneRaw) : '';
    const loginKey =
      normalizedForLoginKey.length > 0 ? `login:${normalizedForLoginKey}` : `login:${ip}`;
    const loginWindowSec = 900;
    const { success } = await rateLimit(loginKey, 5, loginWindowSec);
    if (!success) {
      return rateLimitExceededResponse(loginWindowSec);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const phone = phoneRaw;

    if (!phone) {
      return NextResponse.json(
        { error: 'Phone required' },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: user, error } = await supabase
      .from('users')
      .select('id, phone, role, center_id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (error) {
      console.error('[login] Supabase query error:', error);
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Phone number not registered' },
        { status: 404 }
      );
    }

    // Auth email format: phoneDigits@centerhq.local (matches signup/accept-invite)
    const phoneDigits = normalizedPhone.replace(/\D/g, '');
    const emailForAuth = `${phoneDigits}@centerhq.local`;

    return NextResponse.json({
      email: emailForAuth,
      userId: user.id,
    });
  } catch (err) {
    console.error('[login] Error:', err);
    return NextResponse.json(
      { error: 'Login failed', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
