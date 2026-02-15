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
    if (!accessToken) return NextResponse.json({ isAdmin: false });

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error } = await supabaseAuth.auth.getUser();
    if (error || !user) return NextResponse.json({ isAdmin: false });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: adminRow } = await supabaseAdmin
      .from('admin_users')
      .select('id, role')
      .eq('id', user.id)
      .single();

    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('phone')
      .eq('id', user.id)
      .single();

    const adminByPhone = isSuperAdmin(userRecord?.phone ?? null);

    if (!adminRow && !adminByPhone) return NextResponse.json({ isAdmin: false });

    let role = 'internal_viewer';
    if (adminByPhone) role = 'super_admin';
    else if (adminRow?.role === 'super_admin' || adminRow?.role === 'admin') role = 'super_admin';
    else if (adminRow?.role === 'internal_admin') role = 'internal_admin';
    else if (adminRow?.role === 'internal_viewer') role = 'internal_viewer';

    return NextResponse.json({ isAdmin: true, role });
  } catch {
    return NextResponse.json({ isAdmin: false });
  }
}
