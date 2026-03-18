import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyPasswordForSensitiveAction } from '@/lib/verify-password';
import { logAdminAction } from '@/lib/audit';
import { validateCSRFRequest } from '@/lib/csrf';
import { normalizePhone } from '@/lib/utils/phone';
import { generateReferralCode } from '@/lib/referral';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

function isSuperAdmin(phone: string | null): boolean {
  const admins = process.env.SUPER_ADMIN_PHONES || '';
  return !!phone && admins.split(',').map((p: string) => p.trim()).includes(phone);
}

async function isAdminUser(supabaseAdmin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('admin_users')
    .select('id')
    .eq('id', userId)
    .single();
  return !!data;
}

function generatePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let userId: string | null = null;

    // Try 1: Cookie-based auth
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

    const { data: { session: cookieSession } } = await supabase.auth.getSession();

    if (cookieSession) {
      userId = cookieSession.user.id;
    } else {
      // Try 2: Authorization header
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (user && !error) {
          userId = user.id;
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - no session found' }, { status: 401 });
    }

    // Check if user is admin
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
    const userPhone = cookieSession?.user?.phone ?? userData?.phone ?? null;
    const isPhoneAdmin = !!userPhone && superAdminPhones.includes(String(userPhone));

    if (!adminUser && !isPhoneAdmin) {
      return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') || 'all';
    const planFilter = searchParams.get('plan') || 'all';
    const search = searchParams.get('search') || '';

    let query = adminClient
      .from('centers')
      .select('id, name, created_at, status, phone, email, plan, requested_at, billing_period, next_payment_due, next_billing_date, referral_code, referred_by, referral_code_used_at, billing_status, billing_type, is_early_adopter, early_adopter_price')
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
      console.error('[admin/centers] ❌ Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const centers = centersData || [];

    const centerIds = centers.map((c: { id: string }) => c.id);
    const { data: counts } = await adminClient
      .from('students')
      .select('center_id')
      .in('center_id', centerIds);
    const studentCounts: Record<string, number> = {};
    for (const row of counts || []) {
      const cid = (row as { center_id: string }).center_id;
      studentCounts[cid] = (studentCounts[cid] ?? 0) + 1;
    }

    // Weekly unique students (past 7 days) per center for limit display
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { data: weeklyScans } = centerIds.length > 0
      ? await adminClient
          .from('attendance_scans')
          .select('center_id, student_id, scanned_at')
          .in('center_id', centerIds)
          .gte('scanned_at', weekAgo.toISOString())
      : { data: [] };
    const weeklyUniqueByCenter: Record<string, Set<string>> = {};
    const lastScanByCenter: Record<string, string> = {};
    for (const row of (weeklyScans || []) as { center_id: string; student_id: string; scanned_at?: string }[]) {
      if (!weeklyUniqueByCenter[row.center_id]) weeklyUniqueByCenter[row.center_id] = new Set();
      weeklyUniqueByCenter[row.center_id].add(row.student_id);
      if (row.scanned_at && (!lastScanByCenter[row.center_id] || row.scanned_at > lastScanByCenter[row.center_id])) {
        lastScanByCenter[row.center_id] = row.scanned_at;
      }
    }
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const { data: allScansForLast } = centerIds.length > 0
      ? await adminClient
          .from('attendance_scans')
          .select('center_id, scanned_at')
          .in('center_id', centerIds)
          .gte('scanned_at', ninetyDaysAgo.toISOString())
          .order('scanned_at', { ascending: false })
          .limit(1000)
      : { data: [] };
    for (const row of (allScansForLast || []) as { center_id: string; scanned_at: string }[]) {
      if (!lastScanByCenter[row.center_id]) lastScanByCenter[row.center_id] = row.scanned_at;
    }
    const { data: monthScans } = centerIds.length > 0
      ? await adminClient
          .from('attendance_scans')
          .select('center_id')
          .in('center_id', centerIds)
          .gte('scanned_at', monthStart.toISOString())
      : { data: [] };
    const usageScansByCenter: Record<string, number> = {};
    for (const row of (monthScans || []) as { center_id: string }[]) {
      usageScansByCenter[row.center_id] = (usageScansByCenter[row.center_id] ?? 0) + 1;
    }

    const { data: owners } = await adminClient
      .from('users')
      .select('center_id, phone')
      .eq('role', 'owner')
      .in('center_id', centerIds);
    const ownerMap = new Map((owners || []).map((o: { center_id: string; phone?: string }) => [o.center_id, { name: o.phone, phone: o.phone }]));

    const lastPaymentByCenter: Record<string, string> = {};
    const { data: latestPayments } = await adminClient
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
      ? await adminClient.from('centers').select('id, name, referral_code').in('id', referredByIds)
      : { data: [] };
    const referringMap = new Map((referringCenters || []).map((r: { id: string; name: string; referral_code: string }) => [r.id, { name: r.name, referral_code: r.referral_code }]));

    const PLAN_LIMITS: Record<string, number> = {
      starter: 150, pro: 500, business: 1000, enterprise: 2000, top_centers: 999999, payg: 999999,
    };
    const rows = centers.map((c: Record<string, unknown>) => {
      const referredBy = (c as { referred_by?: string }).referred_by;
      const referring = referredBy ? referringMap.get(referredBy) : null;
      const plan = (c as { plan?: string }).plan || 'starter';
      const maxStudents = PLAN_LIMITS[plan] ?? 150;
      const weeklyUnique = weeklyUniqueByCenter[c.id as string]?.size ?? 0;
      const limitStatus = maxStudents < 999999
        ? (weeklyUnique >= maxStudents ? 'over' : weeklyUnique >= maxStudents * 0.9 ? 'approaching' : 'ok')
        : 'unlimited';
      const lastScan = lastScanByCenter[c.id as string];
      const now = new Date();
      let lastActive = 'Never';
      if (lastScan) {
        const d = new Date(lastScan);
        const diffMs = now.getTime() - d.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffMins < 60) lastActive = `${diffMins}m ago`;
        else if (diffHours < 24) lastActive = `${diffHours}h ago`;
        else if (diffDays < 7) lastActive = `${diffDays}d ago`;
        else lastActive = `${diffDays} days ago`;
      }
      return {
        ...c,
        students_count: studentCounts[c.id as string] ?? 0,
        weekly_unique_students: weeklyUnique,
        max_students: maxStudents,
        limit_status: limitStatus,
        owner: ownerMap.get(c.id as string) ?? null,
        last_payment: lastPaymentByCenter[c.id as string] ?? null,
        next_due: (c as { next_payment_due?: string }).next_payment_due || (c as { next_billing_date?: string }).next_billing_date,
        referring_center_name: referring?.name ?? null,
        referral_code_used: referring?.referral_code ?? null,
        last_active: lastActive,
        usage_scans: usageScansByCenter[c.id as string] ?? 0,
      };
    });

    const pendingCenters = rows.filter((c: Record<string, unknown>) => c.status === 'pending');

    return NextResponse.json({ centers: rows, pendingCenters });
  } catch (error) {
    console.error('[admin/centers] Error:', error instanceof Error ? error.message : error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        type: error instanceof Error ? error.constructor?.name : undefined,
      },
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
    if (!validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = (await import('@/lib/validations')).adminCentersCreateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { name, ownerPhone, plan } = parsed.data;

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
    if (!validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = (await import('@/lib/validations')).adminCentersUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { centerId, action, newPlan, confirmName, billing_period, next_payment_due, password } = parsed.data;

    const { data: center, error: centerError } = await supabaseAdmin
      .from('centers')
      .select('id, name, phone, email, plan, status, owner_name')
      .eq('id', centerId)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    if (action === 'change_plan') {
      if (!newPlan || !['starter', 'pro', 'business', 'enterprise', 'top_centers', 'payg'].includes(newPlan as string)) {
        return NextResponse.json({ error: 'Valid newPlan required' }, { status: 400 });
      }
      const oldPlan = center.plan || 'starter';
      await supabaseAdmin.from('centers').update({ plan: newPlan }).eq('id', centerId);
      await logAdminAction(user.id, 'change_plan', { centerId, oldPlan, newPlan }, centerId);
      return NextResponse.json({ success: true, action: 'change_plan' });
    }

    if (action === 'suspend') {
      const verify = await verifyPasswordForSensitiveAction(
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
        password || ''
      );
      if (!verify.ok) {
        return NextResponse.json({ error: verify.error }, { status: 401 });
      }
      await supabaseAdmin.from('centers').update({ status: 'suspended' }).eq('id', centerId);
      await logAdminAction(user.id, 'suspend_center', { centerId, reason: 'manual' }, centerId);
      return NextResponse.json({ success: true, action: 'suspend' });
    }

    if (action === 'reactivate') {
      await supabaseAdmin.from('centers').update({ status: 'active' }).eq('id', centerId);
      await logAdminAction(user.id, 'reactivate_center', { centerId }, centerId);
      return NextResponse.json({ success: true, action: 'reactivate' });
    }

    if (action === 'delete') {
      if (confirmName !== center.name) {
        return NextResponse.json({ error: 'Center name confirmation does not match' }, { status: 400 });
      }
      const verify = await verifyPasswordForSensitiveAction(
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
        password || ''
      );
      if (!verify.ok) {
        return NextResponse.json({ error: verify.error }, { status: 401 });
      }
      await supabaseAdmin
        .from('centers')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .eq('id', centerId);
      await logAdminAction(user.id, 'delete_center', { centerId, centerName: center.name }, centerId);
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

      await logAdminAction(user.id, 'reject_signup', { centerId, centerName: center.name }, centerId);

      return NextResponse.json({ success: true, action: 'rejected' });
    }

    // Approve - create auth user with username+password for hybrid login
    const pin = generatePin();
    const intlPhone = normalizePhone(phone);

    const ownerName = center.name;
    const emailForAuth = `${intlPhone.replace(/\D/g, '')}@centerhq.local`;

    const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: emailForAuth,
      phone: intlPhone,
      phone_confirm: true,
      email_confirm: true,
      password: pin,
      user_metadata: { name: ownerName },
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
      name: ownerName,
      phone_verified: true,
    });

    if (userInsertError) {
      await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
      return NextResponse.json({ error: 'Failed to create user profile' }, { status: 500 });
    }

    const now = new Date();
    const dueDate = now.toISOString().slice(0, 10);
    const suspendAt = new Date(now);
    suspendAt.setDate(suspendAt.getDate() + 1);

    // Early Adopter: first 10 approved centers get 40% discount locked in
    const plan = (center.plan as string) || 'starter';
    const EARLY_ADOPTER_PRICES: Record<string, number> = {
      starter: 1200, pro: 2700, business: 3900, enterprise: 5400,
    };
    const { count: earlyAdopterCount } = await supabaseAdmin
      .from('centers')
      .select('*', { count: 'exact', head: true })
      .eq('is_early_adopter', true);
    const canBeEarlyAdopter = (earlyAdopterCount ?? 0) < 10 && plan in EARLY_ADOPTER_PRICES;
    const earlyAdopterNumber = canBeEarlyAdopter ? (earlyAdopterCount ?? 0) + 1 : null;
    const earlyAdopterPrice = canBeEarlyAdopter ? EARLY_ADOPTER_PRICES[plan] : null;

    const centerUpdates: Record<string, unknown> = {
      status: 'active',
      approved_at: now.toISOString(),
      approved_by: user.id,
      subscription_status: 'active',
      payment_due_date: dueDate,
      auto_suspend_at: suspendAt.toISOString(),
      billing_start_date: dueDate,
    };
    if (canBeEarlyAdopter) {
      centerUpdates.is_early_adopter = true;
      centerUpdates.early_adopter_price = earlyAdopterPrice;
      centerUpdates.early_adopter_number = earlyAdopterNumber;
      centerUpdates.early_adopter_date = now.toISOString();
    }

    await supabaseAdmin
      .from('centers')
      .update(centerUpdates)
      .eq('id', centerId);

    await logAdminAction(user.id, 'approve_signup', { centerId, centerName: center.name }, centerId);

    // Auto-generate referral code and insert into referral_codes (also sync centers.referral_code)
    let generatedCode = generateReferralCode(center.name as string);
    for (let attempts = 0; attempts < 5; attempts++) {
      const { error: rcError } = await supabaseAdmin
        .from('referral_codes')
        .insert({ center_id: centerId, code: generatedCode });
      if (!rcError) {
        await supabaseAdmin.from('centers').update({ referral_code: generatedCode }).eq('id', centerId);
        break;
      }
      generatedCode = generateReferralCode(center.name as string);
    }

    const displayOwnerName = (center.owner_name || center.name) as string;
    const centerName = center.name as string;
    const referralCode = generatedCode || '';
    const normalizedPhone = (phone || '').replace(/^\+/, '').replace(/^0(\d{10})$/, '20$1');

    await sendWhatsAppMessage(
      normalizedPhone,
      `أهلاً ${displayOwnerName} 👋\n\nتم تفعيل حساب ${centerName} على CenterHQ بنجاح! 🎉`
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await sendWhatsAppMessage(
      normalizedPhone,
      `📱 رابط تسجيل الدخول:\nhttps://center-hq.vercel.app/ar/login\n\n🔐 رقم الهاتف المسجل: ${phone}\n📋 الباقة: ${plan}`
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await sendWhatsAppMessage(
      normalizedPhone,
      `🎁 كود الإحالة الخاص بك: ${referralCode}\nشارك الكود مع أصحاب السناتر وأكسب 25% من اشتراكاتهم الشهرية!`
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await sendWhatsAppMessage(
      normalizedPhone,
      `كيف سير الأمور مع CenterHQ؟ 😊\nنحن هنا للمساعدة — رد على هذه الرسالة في أي وقت.`
    );

    // Referral rewards are now created only when admin approves the referred center's first payment (in admin billing)

    if (center.email) {
      // TODO: Send email if email service is configured
      // For now we rely on WhatsApp
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://center-hq.vercel.app';
    const credentialsMessage = `تم تفعيل حسابك في CenterHQ! 🎉

🔐 بيانات الدخول:
📱 رقم الهاتف: ${intlPhone}
🔑 رمز PIN: ${pin}

🌐 رابط الدخول:
${appUrl}/login

مرحباً بك في CenterHQ! 💙`;

    return NextResponse.json({
      success: true,
      action: 'approved',
      credentials: { phone: intlPhone, pin },
      credentialsMessage,
      whatsappUrl: `https://wa.me/${intlPhone.replace(/\D/g, '')}?text=${encodeURIComponent(credentialsMessage)}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
