import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { normalizePhone, authEmailFromPhone } from '@/lib/utils/phone';
import { parseBodyWithLimit } from '@/lib/validate';

/**
 * Login lookup API: Find user by phone (public.users) and return auth email.
 * Uses service role to bypass RLS. Client then calls signInWithPassword with returned email + PIN.
 */
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
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

    // Auth email via the shared derivation (matches signup/accept-invite exactly).
    // phoneDigits is still needed for the admin_users.phone digit-form match below.
    const phoneDigits = normalizedPhone.replace(/\D/g, '');
    const emailForAuth = authEmailFromPhone(normalizedPhone);
    if (!emailForAuth) {
      // A phone that is not a valid Egyptian mobile can never own an account.
      return NextResponse.json({ error: 'Phone number not registered' }, { status: 404 });
    }

    if (!user) {
      // No public.users row. The phone may still belong to an internal/admin-only
      // account: super-admins and internal team have an admin_users row but NO
      // public.users row (see getAdminContext and centerAuth, which already treat
      // such users as super_admin with center_id null). Resolve those here so the
      // shared login page can proceed to /api/auth/login-verify and then
      // /api/admin/check, which routes them to /admin.
      //
      // admin_users is keyed by auth.users.id and is NOT writable via the /api/db
      // proxy, so it is a safe source of truth. We match the same phone identity
      // the rest of the app uses, without an auth-schema lookup (auth is not
      // exposed to PostgREST and supabase-js has no getUserByEmail):
      //   - email column: the derived `<digits>@centerhq.local` auth email
      //     (audit/seed internal accounts store the auth email here), OR
      //   - phone column: the E.164 phone or its bare digits (production internal
      //     accounts store a human email but a real phone; the `+` prefix is
      //     inconsistent across rows, so match both forms).
      // public.users.role is NEVER consulted for admin status (documented prior P0).
      // This only gates whether we return the derived email; the actual admin
      // authorization still happens downstream in /api/admin/check.
      const { data: adminUser, error: adminError } = await supabase
        .from('admin_users')
        .select('id')
        .or(
          `email.eq.${emailForAuth},phone.eq.${normalizedPhone},phone.eq.${phoneDigits}`,
        )
        .limit(1)
        .maybeSingle();

      if (adminError) {
        console.error('[login] admin_users lookup error:', adminError);
        return NextResponse.json(
          { error: 'Database error', details: adminError.message },
          { status: 500 }
        );
      }

      if (!adminUser) {
        return NextResponse.json(
          { error: 'Phone number not registered' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        email: emailForAuth,
        userId: adminUser.id,
      });
    }

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
