import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/** Convert Egyptian phone (01XXXXXXXXX) to E.164 (+201XXXXXXXXX) */
function toE164(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    return '+20' + cleaned.slice(1);
  }
  if (cleaned.startsWith('20')) {
    return '+' + cleaned;
  }
  return '+20' + cleaned;
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

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, phone, role } = body;

    if (!name || !phone || !role) {
      return NextResponse.json({ error: 'Name, phone, and role are required' }, { status: 400 });
    }

    if (role !== 'assistant') {
      return NextResponse.json({ error: 'Invalid role. Must be assistant' }, { status: 400 });
    }

    const phoneRegex = /^01[0-9]{9}$/;
    const cleanPhone = String(phone).trim().replace(/\D/g, '');
    const normalizedPhone = cleanPhone.startsWith('0') ? cleanPhone : '0' + cleanPhone;
    if (!phoneRegex.test(normalizedPhone)) {
      return NextResponse.json({ error: 'Invalid Egyptian phone number format (01XXXXXXXXX)' }, { status: 400 });
    }
    const phoneE164 = toE164(normalizedPhone);

    const { data: currentUser, error: currentUserError } = await supabase
      .from('users')
      .select('center_id, role')
      .eq('id', user.id)
      .single();

    if (currentUserError || !currentUser?.center_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (currentUser.role !== 'owner' && currentUser.role !== 'admin') {
      return NextResponse.json({ error: 'Only center owners and admins can invite team members' }, { status: 403 });
    }

    const { data: existingByE164 } = await supabase
      .from('users')
      .select('id')
      .eq('center_id', currentUser.center_id)
      .eq('phone', phoneE164)
      .maybeSingle();

    if (existingByE164) {
      return NextResponse.json({
        error: 'هذا الرقم مسجل بالفعل في السنتر / This phone number is already registered for your center',
      }, { status: 409 });
    }

    const { data: existingByLocal } = await supabase
      .from('users')
      .select('id')
      .eq('center_id', currentUser.center_id)
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (existingByLocal) {
      return NextResponse.json({
        error: 'هذا الرقم مسجل بالفعل في السنتر / This phone number is already registered for your center',
      }, { status: 409 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const tempPassword = Math.random().toString(36).slice(-12) + 'Aa1!';

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      phone: phoneE164,
      password: tempPassword,
      user_metadata: { name, role, center_id: currentUser.center_id },
      phone_confirm: true,
    });

    if (authError || !authData.user) {
      console.error('Auth creation error:', authError);
      return NextResponse.json({
        error: `Failed to create user: ${authError?.message || 'Unknown error'}`,
      }, { status: 500 });
    }

    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        center_id: currentUser.center_id,
        role,
        phone: phoneE164,
        name: name.trim() || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('User insert error:', insertError);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({
        error: `فشل في إنشاء المستخدم / Failed to create user: ${insertError.message}`,
      }, { status: 500 });
    }

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id: currentUser.center_id,
        user_id: user.id,
        action: 'team_member_invited',
        entity_type: 'users',
        details: {
          invited_user_id: newUser.id,
          invited_phone: normalizedPhone,
          invited_name: name,
          invited_role: role,
        },
      });
    } catch {
      // Don't fail if audit log fails
    }

    return NextResponse.json({
      success: true,
      member: newUser,
      tempPassword,
      message: 'تم إضافة العضو بنجاح / Team member added successfully',
    });
  } catch (error) {
    console.error('Invite user error:', error);
    return NextResponse.json({
      error: 'حدث خطأ / Internal server error',
    }, { status: 500 });
  }
}
