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

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') || 'all';
    const planFilter = searchParams.get('plan') || 'all';
    const search = searchParams.get('search') || '';

    let query = supabaseAdmin
      .from('centers')
      .select('id, name, created_at, status, phone, email, plan, requested_at, billing_period, next_payment_due, next_billing_date, referral_code, referred_by, referral_code_used_at')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (planFilter !== 'all') {
      query = query.eq('plan', planFilter);
    }
    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`name.ilike.${term},phone.ilike.${term}`);
    }

    const { data: centersData, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const centers = centersData || [];

    const centerIds = centers.map((c: { id: string }) => c.id);
    const { data: counts } = await supabaseAdmin
      .from('students')
      .select('center_id')
      .in('center_id', centerIds);
    const studentCounts: Record<string, number> = {};
    for (const row of counts || []) {
      const cid = (row as { center_id: string }).center_id;
      studentCounts[cid] = (studentCounts[cid] ?? 0) + 1;
    }

    const { data: owners } = await supabaseAdmin
      .from('users')
      .select('center_id, name, phone')
      .eq('role', 'owner')
      .in('center_id', centerIds);
    const ownerMap = new Map((owners || []).map((o: { center_id: string; name?: string; phone?: string }) => [o.center_id, { name: o.name, phone: o.phone }]));

    let lastPaymentByCenter: Record<string, string> = {};
    const { data: latestPayments } = await supabaseAdmin
      .from('admin_payments')
      .select('center_id, paid_at')
      .in('center_id', centerIds)
      .order('paid_at', { ascending: false });
    if (latestPayments) {
      for (const p of latestPayments) {
        const cid = (p as { center_id: string; paid_at: string }).center_id;
        if (!lastPaymentByCenter[cid]) lastPaymentByCenter[cid] = (p as { paid_at: string }).paid_at;
      }
    }

    const referredByIds = [...new Set((centers || []).map((c: { referred_by?: string }) => c.referred_by).filter(Boolean))];
    const { data: referringCenters } = referredByIds.length > 0
      ? await supabaseAdmin.from('centers').select('id, name, referral_code').in('id', referredByIds)
      : { data: [] };
    const referringMap = new Map((referringCenters || []).map((r: { id: string; name: string; referral_code: string }) => [r.id, { name: r.name, referral_code: r.referral_code }]));

    const rows = centers.map((c: Record<string, unknown>) => {
      const referredBy = (c as { referred_by?: string }).referred_by;
      const referring = referredBy ? referringMap.get(referredBy) : null;
      return {
        ...c,
        students_count: studentCounts[c.id as string] ?? 0,
        owner: ownerMap.get(c.id as string) ?? null,
        last_payment: lastPaymentByCenter[c.id as string] ?? null,
        next_due: (c as { next_payment_due?: string }).next_payment_due || (c as { next_billing_date?: string }).next_billing_date,
        referring_center_name: referring?.name ?? null,
        referral_code_used: referring?.referral_code ?? null,
      };
    });

    const pendingCenters = rows.filter((c: Record<string, unknown>) => c.status === 'pending');

    return NextResponse.json({ centers: rows, pendingCenters });
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
    const { centerId, action, newPlan, confirmName, billing_period, next_payment_due } = body as {
      centerId?: string; action?: string; newPlan?: string; confirmName?: string;
      billing_period?: string; next_payment_due?: string;
    };
    if (!centerId || !action) {
      return NextResponse.json({ error: 'Invalid centerId or action' }, { status: 400 });
    }

    const validActions = ['approve', 'reject', 'change_plan', 'suspend', 'reactivate', 'delete', 'update_billing'];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const { data: center, error: centerError } = await supabaseAdmin
      .from('centers')
      .select('id, name, phone, email, plan, status')
      .eq('id', centerId)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    if (action === 'change_plan') {
      if (!newPlan || !['starter', 'pro', 'pro_plus', 'enterprise', 'payg'].includes(newPlan)) {
        return NextResponse.json({ error: 'Valid newPlan required' }, { status: 400 });
      }
      const oldPlan = center.plan || 'starter';
      await supabaseAdmin.from('centers').update({ plan: newPlan }).eq('id', centerId);
      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: centerId,
          user_id: user.id,
          action: 'admin_plan_change',
          entity_type: 'center',
          details: { center_id: centerId, old_plan: oldPlan, new_plan: newPlan },
        });
      } catch { /* ignore */ }
      return NextResponse.json({ success: true, action: 'change_plan' });
    }

    if (action === 'suspend') {
      await supabaseAdmin.from('centers').update({ status: 'suspended' }).eq('id', centerId);
      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: centerId,
          user_id: user.id,
          action: 'admin_suspend',
          entity_type: 'center',
          details: { center_id: centerId, reason: 'manual' },
        });
      } catch { /* ignore */ }
      return NextResponse.json({ success: true, action: 'suspend' });
    }

    if (action === 'reactivate') {
      await supabaseAdmin.from('centers').update({ status: 'active' }).eq('id', centerId);
      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: centerId,
          user_id: user.id,
          action: 'admin_reactivate',
          entity_type: 'center',
          details: { center_id: centerId },
        });
      } catch { /* ignore */ }
      return NextResponse.json({ success: true, action: 'reactivate' });
    }

    if (action === 'delete') {
      if (confirmName !== center.name) {
        return NextResponse.json({ error: 'Center name confirmation does not match' }, { status: 400 });
      }
      await supabaseAdmin
        .from('centers')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .eq('id', centerId);
      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: centerId,
          user_id: user.id,
          action: 'admin_delete_center',
          entity_type: 'center',
          details: { center_id: centerId, center_name: center.name },
        });
      } catch { /* ignore */ }
      return NextResponse.json({ success: true, action: 'delete' });
    }

    if (action === 'update_billing') {
      const updates: Record<string, unknown> = {};
      if (billing_period) updates.billing_period = billing_period;
      if (next_payment_due) {
        updates.next_payment_due = next_payment_due;
        updates.next_billing_date = next_payment_due;
      }
      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No billing updates provided' }, { status: 400 });
      }
      await supabaseAdmin.from('centers').update(updates).eq('id', centerId);
      return NextResponse.json({ success: true, action: 'update_billing' });
    }

    if (action === 'approve' || action === 'reject') {
      if (center.status !== 'pending') {
        return NextResponse.json({ error: 'Center is not pending' }, { status: 400 });
      }
    }

    const phone = (center.phone as string || '').trim();
    if (action === 'approve' && !phone) {
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

    const now = new Date();
    const dueDate = now.toISOString().slice(0, 10);
    const suspendAt = new Date(now);
    suspendAt.setDate(suspendAt.getDate() + 1);

    await supabaseAdmin
      .from('centers')
      .update({
        status: 'active',
        approved_at: now.toISOString(),
        approved_by: user.id,
        subscription_status: 'active',
        payment_due_date: dueDate,
        auto_suspend_at: suspendAt.toISOString(),
        billing_start_date: dueDate,
      })
      .eq('id', centerId);

    let referralMessage: string | null = null;
    const referredBy = (center as { referred_by?: string }).referred_by;
    if (referredBy) {
      const PLAN_FEES: Record<string, number> = { starter: 4000, pro: 7200, pro_plus: 8000, enterprise: 9000 };
      const plan = (center.plan as string) || 'starter';
      const fee = PLAN_FEES[plan] ?? 4000;
      const reward = Math.round(fee * 0.4);
      const { data: referringCenter } = await supabaseAdmin.from('centers').select('name').eq('id', referredBy).single();
      await supabaseAdmin.from('referral_rewards').upsert(
        {
          referring_center_id: referredBy,
          referred_center_id: centerId,
          referred_center_plan: plan,
          first_month_fee: fee,
          reward_amount: reward,
          reward_status: 'approved',
        },
        { onConflict: 'referring_center_id,referred_center_id' }
      );
      referralMessage = `Referral reward of EGP ${reward.toLocaleString()} credited to ${(referringCenter as { name?: string })?.name ?? 'referring center'}`;
    }

    if (center.email) {
      // TODO: Send email if email service is configured
      // For now we rely on WhatsApp
    }

    return NextResponse.json({
      success: true,
      action: 'approved',
      credentials: { password },
      referralMessage,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
