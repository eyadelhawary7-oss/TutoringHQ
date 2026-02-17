import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  console.log('==========================================');
  console.log('[admin/pending-signups] 🔍 Route called');

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    let userId: string | null = null;

    const cookieStore = await cookies();
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    });

    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      userId = session.user.id;
    } else {
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (user && !error) userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: adminUser } = await adminClient
      .from('admin_users')
      .select('*')
      .eq('id', userId)
      .single();

    const { data: userData } = await adminClient
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();

    const superAdminPhones = (process.env.SUPER_ADMIN_PHONES || '')
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);
    const isPhoneAdmin = !!userData?.phone && superAdminPhones.includes(userData.phone);

    if (!adminUser && !isPhoneAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    console.log('[admin/pending-signups] ✅ Admin authorized');

    console.log('[admin/pending-signups] 📡 Querying pending centers...');

    const { data: pendingCenters, error } = await adminClient
      .from('centers')
      .select('id, name, phone, email, plan, status, subscription_status, requested_at, created_at, referred_by, referral_code_used_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    console.log('[admin/pending-signups] 📊 Query result:', {
      count: pendingCenters?.length || 0,
      error: error?.message,
    });

    if (error) {
      console.error('[admin/pending-signups] ❌ Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const centers = pendingCenters || [];
    const referredByIds = [...new Set(centers.map((c) => c.referred_by).filter(Boolean))];
    const { data: referringCenters } = referredByIds.length > 0
      ? await adminClient
          .from('centers')
          .select('id, name, referral_code')
          .in('id', referredByIds)
      : { data: [] };
    const referringMap = new Map(
      (referringCenters || []).map((r: { id: string; name: string; referral_code: string }) => [
        r.id,
        { name: r.name, referral_code: r.referral_code },
      ])
    );

    const rows = centers.map((c: Record<string, unknown>) => {
      const referredBy = c.referred_by as string | null;
      const referring = referredBy ? referringMap.get(referredBy) : null;
      return {
        ...c,
        referral_code_used: referring?.referral_code ?? null,
        referring_center_name: referring?.name ?? null,
      };
    });

    console.log('[admin/pending-signups] ✅ Returning', rows.length, 'pending signups');
    console.log('==========================================');

    return NextResponse.json({ signups: rows });
  } catch (error) {
    console.error('==========================================');
    console.error('[admin/pending-signups] 💥 Error:', error);
    console.error('==========================================');

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
