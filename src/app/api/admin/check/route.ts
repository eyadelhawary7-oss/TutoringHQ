import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function isSuperAdmin(phone: string | null): boolean {
  const admins = process.env.SUPER_ADMIN_PHONES || '';
  return !!phone && admins.split(',').map((p: string) => p.trim()).includes(phone);
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
      return NextResponse.json({ isAdmin: false });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error } = await supabaseAuth.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ isAdmin: false });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Admin users are identified by admin_users table (source of truth)
    const { data: adminUser } = await supabaseAdmin
      .from('admin_users')
      .select('id, role, custom_permissions')
      .eq('id', user.id)
      .single();

    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('phone')
      .eq('id', user.id)
      .single();

    const adminByPhone = isSuperAdmin(userRecord?.phone ?? null);

    if (!adminUser && !adminByPhone) {
      return NextResponse.json({ isAdmin: false });
    }

    let role = adminUser?.role ?? 'admin';
    if (adminByPhone) role = 'super_admin';
    const customPermissions = (adminUser?.custom_permissions as string[] | null) ?? [];

    return NextResponse.json({
      isAdmin: true,
      role,
      customPermissions,
      hasCenter: false, // Admins don't have centers; they manage the platform globally
    });
  } catch (err) {
    console.error('❌ [admin/check] Error:', err);
    return NextResponse.json({ isAdmin: false });
  }
}
