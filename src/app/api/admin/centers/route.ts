import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function isSuperAdmin(phone: string | null): boolean {
  const admins = process.env.SUPER_ADMIN_PHONES || '';
  return !!phone && admins.split(',').map((p: string) => p.trim()).includes(phone);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isAdminUser(supabaseAdmin: any, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('admin_users')
    .select('id')
    .eq('id', userId)
    .single();
  return !!data;
}

function generatePassword(len = 8): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Send WhatsApp to a phone (optional) */
async function sendWhatsApp(toPhone: string, message: string) {
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!waToken || !waPhoneId) return;
  const to = toPhone.replace(/[^0-9]/g, '');
  if (!to) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message, preview_url: false },
      }),
    });
  } catch (e) {
    console.error('WhatsApp send error:', e);
  }
}

export async function GET(request: Request) {
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

    const adminByTable = await isAdminUser(supabaseAdmin, user.id);
    const { data: userRecordForAdmin } = await supabaseAdmin
      .from('users')
      .select('phone')
      .eq('id', user.id)
      .single();
    const adminByPhone = isSuperAdmin(userRecordForAdmin?.phone ?? null);

    if (!adminByTable && !adminByPhone) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: centersData, error } = await supabaseAdmin
      .from('centers')
      .select('id, name, created_at, status, phone, email, plan, requested_at')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const centers = centersData || [];
    const pendingCenters = centers.filter((c: { status?: string }) => c.status === 'pending');

    return NextResponse.json({ centers, pendingCenters });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
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

    const adminByTable = await isAdminUser(supabaseAdmin, user.id);
    const { data: userRecord } = await supabaseAdmin.from('users').select('phone').eq('id', user.id).single();
    const adminByPhone = isSuperAdmin(userRecord?.phone ?? null);

    if (!adminByTable && !adminByPhone) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { name, ownerPhone, plan } = body;

    if (!name || !ownerPhone) {
      return NextResponse.json({ error: 'Missing name or ownerPhone' }, { status: 400 });
    }

    const { data: center, error: centerError } = await supabaseAdmin
      .from('centers')
      .insert({
        name: name.trim(),
        plan: plan || 'starter',
        subscription_status: 'active',
        status: 'active',
      })
      .select('id')
      .single();

    if (centerError) {
      return NextResponse.json({ error: centerError.message }, { status: 500 });
    }

    const phone = String(ownerPhone).replace(/\s/g, '');
    const { error: inviteError } = await supabaseAdmin
      .from('center_invites')
      .upsert(
        {
          center_id: center.id,
          phone,
          role: 'owner',
          status: 'pending',
        },
        { onConflict: 'center_id,phone' }
      );

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, centerId: center.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
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

    const adminByTable = await isAdminUser(supabaseAdmin, user.id);
    const { data: userRecord } = await supabaseAdmin.from('users').select('phone').eq('id', user.id).single();
    const adminByPhone = isSuperAdmin(userRecord?.phone ?? null);

    if (!adminByTable && !adminByPhone) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { centerId, action } = body as { centerId?: string; action?: string };
    if (!centerId || !action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid centerId or action' }, { status: 400 });
    }

    const { data: center, error: centerError } = await supabaseAdmin
      .from('centers')
      .select('id, name, phone, email, plan')
      .eq('id', centerId)
      .eq('status', 'pending')
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found or not pending' }, { status: 404 });
    }

    const phone = (center.phone as string || '').trim();
    if (!phone) {
      return NextResponse.json({ error: 'Center has no phone number' }, { status: 400 });
    }

    if (action === 'reject') {
      await supabaseAdmin
        .from('centers')
        .update({ status: 'rejected' })
        .eq('id', centerId);

      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: centerId,
          user_id: user.id,
          action: 'center_rejected',
          entity_type: 'center',
          details: { centerName: center.name },
        });
      } catch {
        // Ignore audit_log errors
      }

      return NextResponse.json({ success: true, action: 'rejected' });
    }

    // Approve
    const password = generatePassword(8);
    const intlPhone = phone.startsWith('+') ? phone : `+20${phone.replace(/^0/, '')}`;

    const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      phone: intlPhone,
      phone_confirm: true,
      password,
      user_metadata: { name: center.name },
    });

    if (createError || !newAuthUser.user) {
      return NextResponse.json(
        { error: createError?.message || 'Failed to create user' },
        { status: 500 }
      );
    }

    const { error: userInsertError } = await supabaseAdmin.from('users').insert({
      id: newAuthUser.user.id,
      center_id: centerId,
      role: 'owner',
      phone: intlPhone,
      name: center.name,
    });

    if (userInsertError) {
      await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
      return NextResponse.json({ error: 'Failed to create user profile' }, { status: 500 });
    }

    await supabaseAdmin
      .from('centers')
      .update({
        status: 'active',
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        subscription_status: 'active',
      })
      .eq('id', centerId);

    const loginUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://centerhq.app';
    const credsMsg = `تم الموافقة على طلبك!\nمرحباً بك في CenterHQ.\n\nسجّل الدخول عبر: ${loginUrl}\nرقم الهاتف: ${phone}\nكلمة المرور: ${password}\n\nيمكنك تغيير كلمة المرور من الإعدادات.`;
    await sendWhatsApp(phone, credsMsg);

    if (center.email) {
      // TODO: Send email if email service is configured
      // For now we rely on WhatsApp
    }

    return NextResponse.json({
      success: true,
      action: 'approved',
      credentials: { password },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
