import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';

export async function GET(request: Request) {
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

    // Try full query first, fallback to basic columns if extended columns don't exist
    let pendingCenters: Record<string, unknown>[] | null = null;
    let error: { message: string } | null = null;

    const fullResult = await adminClient
      .from('centers')
      .select('id, name, phone, email, plan, status, subscription_status, requested_at, created_at, referred_by, referral_code_used_at, city, signup_notes')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (fullResult.error) {
      const basicResult = await adminClient
        .from('centers')
        .select('id, name, phone, plan, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      pendingCenters = basicResult.data;
      error = basicResult.error;
    } else {
      pendingCenters = fullResult.data;
      error = fullResult.error;
    }

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

    return NextResponse.json({ signups: rows });
  } catch (error) {
    console.error('[admin/pending-signups] Error:', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/admin/pending-signups — approve a single pending centre signup
export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin']);
  if (roleErr) return roleErr;

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const center_id = typeof body.center_id === 'string' ? body.center_id : null;
  if (!center_id) {
    return NextResponse.json({ error: 'center_id is required' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: center, error: fetchErr } = await adminClient
    .from('centers')
    .select('id, status, plan, all_in_price, billing_period')
    .eq('id', center_id)
    .eq('status', 'pending')
    .single();

  if (fetchErr || !center) {
    return NextResponse.json({ error: 'Center not found or not pending' }, { status: 404 });
  }

  const nextPaymentDue = new Date();
  nextPaymentDue.setDate(nextPaymentDue.getDate() + 30);
  const autoSuspendAt = new Date();
  autoSuspendAt.setDate(autoSuspendAt.getDate() + 38);
  const today = new Date().toISOString().split('T')[0];

  const { error: updateErr } = await adminClient
    .from('centers')
    .update({
      status: 'active',
      subscription_status: 'active',
      billing_status: 'active',
      approved_at: new Date().toISOString(),
      approved_by: ctx.userId,
      subscription_start_date: today,
      next_payment_due: nextPaymentDue.toISOString().split('T')[0],
      auto_suspend_at: autoSuspendAt.toISOString().split('T')[0],
    })
    .eq('id', center_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  try {
    const { createCommissionsForCenter } = await import('@/lib/commissions');
    await createCommissionsForCenter(center_id);
  } catch (err) {
    console.error('[admin/pending-signups] Commission creation failed:', err);
  }

  return NextResponse.json({ success: true, center_id }, { status: 200 });
}

// DELETE /api/admin/pending-signups?id=<center_id> — reject a pending signup
export async function DELETE(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin']);
  if (roleErr) return roleErr;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await adminClient
    .from('centers')
    .update({ status: 'rejected' })
    .eq('id', id)
    .eq('status', 'pending');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
