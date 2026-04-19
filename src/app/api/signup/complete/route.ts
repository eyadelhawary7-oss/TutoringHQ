import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/utils/phone';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function generatePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = (await request.json()) as { centerId?: unknown };

    let supabaseAdmin: SupabaseClient;
    try {
      supabaseAdmin = getSupabaseAdmin();
    } catch {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const normPhone = (p: string) => normalizePhone(p).replace(/\D/g, '');
    const userDigits = normPhone(user.phone || '');
    if (!userDigits) {
      return NextResponse.json({ error: 'Phone number is required on your account to complete signup.' }, { status: 400 });
    }

    const { data: pendingCenters, error: pendingErr } = await supabaseAdmin
      .from('centers')
      .select('id, phone, status, name')
      .eq('status', 'pending_verification');

    if (pendingErr) {
      console.error('Signup complete pending centers:', pendingErr);
      return NextResponse.json({ error: 'Failed to resolve center' }, { status: 500 });
    }

    const matching = (pendingCenters ?? []).filter((row) => {
      const cd = normPhone((row as { phone?: string | null }).phone || '');
      return cd && cd === userDigits;
    });

    if (matching.length === 0) {
      return NextResponse.json(
        { error: 'No pending center found for this phone. Please start signup again.' },
        { status: 404 },
      );
    }

    if (matching.length > 1) {
      return NextResponse.json(
        { error: 'Multiple pending signups share this phone. Please contact support.' },
        { status: 409 },
      );
    }

    const center = matching[0] as { id: string; phone: string | null; status: string; name: string | null };
    const centerId = center.id;

    if (typeof body.centerId === 'string' && /^[0-9a-f-]{36}$/i.test(body.centerId) && body.centerId !== centerId) {
      return NextResponse.json({ error: 'Center selection does not match your verified signup.' }, { status: 403 });
    }

    if (center.status !== 'pending_verification') {
      return NextResponse.json(
        { error: 'Center is not in verification state. Please start signup again.' },
        { status: 400 }
      );
    }

    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json(
        { error: 'User already exists. Please log in instead.' },
        { status: 400 }
      );
    }

    // Generate PIN and phone-based email
    const pin = generatePin();
    const normalizedPhone = normalizePhone(user.phone || center.phone || '');
    const phoneDigits = normalizedPhone.replace(/\D/g, '');
    const emailForAuth = `${phoneDigits}@centerhq.local`;

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: emailForAuth,
      password: pin,
      email_confirm: true,
    });
    if (updateAuthError) {
      console.error('Signup complete auth update:', updateAuthError);
      return NextResponse.json(
        { error: 'Failed to set credentials', details: updateAuthError.message },
        { status: 500 }
      );
    }

    const hashedPin = createHash('sha256').update(pin).digest('hex');
    const { error: userInsertError } = await supabaseAdmin.from('users').insert({
      id: user.id,
      center_id: centerId,
      role: 'owner',
      phone: normalizedPhone,
      name: center.name || null,
      pin_code: hashedPin,
      preferred_locale: 'ar',
      can_scan: true,
      can_view_payments: true,
      can_record_payments: true,
      can_view_dashboard: true,
      can_view_revenue: true,
      can_manage_students: true,
      can_manage_groups: true,
      can_manage_rooms: true,
      can_view_schedule: true,
      can_view_settings: true,
      can_allow_late_entry: true,
      is_active: true,
    });

    if (userInsertError) {
      console.error('Signup complete user insert:', userInsertError);
      return NextResponse.json(
        { error: 'Failed to complete signup', details: userInsertError.message },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from('centers')
      .update({ status: 'pending' })
      .eq('id', centerId);

    return NextResponse.json({
      success: true,
      pin,
      message: 'Signup complete! Use your phone number and PIN to log in.',
    });
  } catch (err) {
    console.error('Signup complete error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
