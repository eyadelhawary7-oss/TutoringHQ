import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/utils/phone';

/**
 * Login lookup API: Find user by phone (public.users) and return auth email.
 * Uses service role to bypass RLS. Client then calls signInWithPassword with returned email + PIN.
 */
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';

    if (!phone) {
      return NextResponse.json(
        { error: 'Phone required' },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    console.log('[login] Raw phone input:', JSON.stringify(phone));
    console.log('[login] Normalized phone:', JSON.stringify(normalizedPhone));

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: user, error } = await supabase
      .from('users')
      .select('id, phone, name, role, center_id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    console.log('[login] Query result:', {
      user: user ? { id: user.id, phone: user.phone } : null,
      error: error ? { message: error.message, code: error.code } : null,
    });

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
