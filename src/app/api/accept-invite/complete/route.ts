import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { normalizePhone, authEmailFromPhone } from '@/lib/utils/phone';
import { isWeakPin } from '@/lib/weakPins';

function generatePin(): string {
  let pin: string;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (isWeakPin(pin));
  return pin;
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const normalizedPhone = normalizePhone(user.phone || '');
    const digits = (user.phone || '').replace(/\D/g, '');
    const phoneVariants = [
      normalizedPhone,
      user.phone,
      digits.startsWith('0') ? digits : '0' + digits,
    ].filter(Boolean);

    let invite: { id: string; center_id: string; role: string; invited_name?: string; phone: string; teacher_group_ids?: string[]; invited_permissions?: Record<string, boolean> } | null = null;
    for (const p of phoneVariants) {
      const { data } = await supabaseAdmin
        .from('center_invites')
        .select('id, center_id, role, invited_name, phone, teacher_group_ids, invited_permissions')
        .eq('phone', p)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (data) {
        invite = data;
        break;
      }
    }

    if (!invite) {
      return NextResponse.json(
        { error: 'No pending invitation found for this phone number.' },
        { status: 404 }
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
    const storedPhone = normalizePhone(user.phone || invite.phone);
    const emailForAuth = authEmailFromPhone(storedPhone);
    if (!emailForAuth) {
      return NextResponse.json(
        { error: 'A valid phone number is required to complete the invitation.' },
        { status: 400 },
      );
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: emailForAuth,
      password: pin,
      email_confirm: true,
    });
    if (updateAuthError) {
      console.error('Accept invite complete auth update:', updateAuthError);
      return NextResponse.json(
        { error: 'Failed to set credentials', details: updateAuthError.message },
        { status: 500 }
      );
    }

    const userPayload: Record<string, unknown> = {
      id: user.id,
      center_id: invite.center_id,
      role: invite.role || 'assistant',
      phone: storedPhone,
      name: invite.invited_name || null,
      // Real PIN was set on the auth user via updateUserById above.
      pin_set_at: new Date().toISOString(),
      preferred_locale: 'ar',
      is_active: true,
    };
    if (invite.role === 'teacher' && invite.teacher_group_ids?.length) {
      userPayload.teacher_group_ids = invite.teacher_group_ids;
    }
    if (invite.role === 'assistant' && invite.invited_permissions && typeof invite.invited_permissions === 'object') {
      const perms = invite.invited_permissions as Record<string, boolean>;
      if (typeof perms.can_scan === 'boolean') userPayload.can_scan = perms.can_scan;
      if (typeof perms.can_view_payments === 'boolean') userPayload.can_view_payments = perms.can_view_payments;
      if (typeof perms.can_record_payments === 'boolean') userPayload.can_record_payments = perms.can_record_payments;
      if (typeof perms.can_view_dashboard === 'boolean') userPayload.can_view_dashboard = perms.can_view_dashboard;
      if (typeof perms.can_view_revenue === 'boolean') userPayload.can_view_revenue = perms.can_view_revenue;
      if (typeof perms.can_manage_students === 'boolean') userPayload.can_manage_students = perms.can_manage_students;
      if (typeof perms.can_manage_groups === 'boolean') userPayload.can_manage_groups = perms.can_manage_groups;
      if (typeof perms.can_allow_late_entry === 'boolean') userPayload.can_allow_late_entry = perms.can_allow_late_entry;
      if (typeof perms.can_manage_rooms === 'boolean') userPayload.can_manage_rooms = perms.can_manage_rooms;
      if (typeof perms.can_view_schedule === 'boolean') userPayload.can_view_schedule = perms.can_view_schedule;
      const settingsPerm = perms.can_view_settings ?? perms.can_manage_settings;
      if (typeof settingsPerm === 'boolean') userPayload.can_view_settings = settingsPerm;
    }
    const { error: userInsertError } = await supabaseAdmin.from('users').insert(userPayload);

    if (userInsertError) {
      console.error('Accept invite complete user insert:', userInsertError);
      return NextResponse.json(
        { error: 'Failed to complete invitation', details: userInsertError.message },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from('center_invites')
      .update({ status: 'accepted' })
      .eq('id', invite.id);

    return NextResponse.json({
      success: true,
      pin,
      centerId: invite.center_id,
      needsOnboarding: false,
      message: 'Invitation accepted! Use your phone number and PIN to log in.',
    });
  } catch (err) {
    console.error('Accept invite complete:', err);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
