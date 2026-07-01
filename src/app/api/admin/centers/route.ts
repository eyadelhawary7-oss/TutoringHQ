import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyPasswordForSensitiveAction } from '@/lib/verify-password';
import { logAdminAction } from '@/lib/audit';
import { validateCSRFRequest } from '@/lib/csrf';
import { normalizePhone } from '@/lib/utils/phone';
import { generateReferralCode } from '@/lib/referral';
import { sendWelcomeTemplate } from '@/lib/centerNotify';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { customPermissionsToKeys, fetchAdminAccessFlags } from '@/lib/admin-access';
import { getAdminPermissions } from '@/lib/admin-roles';
import { PLANS, type PlanKey } from '@/lib/pricing';
import { todayISO } from '@/lib/parentPack';
import { parseBodyWithLimit } from '@/lib/validate';
import { parseIncludeTestCenters } from '@/lib/adminIncludeTest';

function calendarAddDays(baseYmd: string, delta: number): string {
  const [y, m, d] = baseYmd.split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

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

function isCenterRowAtRisk(lastActive: unknown): boolean {
  if (lastActive === 'Never') return true;
  return typeof lastActive === 'string' && lastActive.includes('days');
}

async function enrichCentersList(
  adminClient: SupabaseClient,
  centers: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const centerIds = centers.map((c) => c.id as string);
  if (centerIds.length === 0) return [];

  const { data: counts } = await adminClient
    .from('students')
    .select('center_id')
    .in('center_id', centerIds);
  const studentCounts: Record<string, number> = {};
  for (const row of counts || []) {
    const cid = (row as { center_id: string }).center_id;
    studentCounts[cid] = (studentCounts[cid] ?? 0) + 1;
  }

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { data: weeklyScans } = await adminClient
    .from('attendance_scans')
    .select('center_id, student_id, scanned_at')
    .in('center_id', centerIds)
    .gte('scanned_at', weekAgo.toISOString());
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
  const { data: allScansForLast } = await adminClient
    .from('attendance_scans')
    .select('center_id, scanned_at')
    .in('center_id', centerIds)
    .gte('scanned_at', ninetyDaysAgo.toISOString())
    .order('scanned_at', { ascending: false })
    .limit(1000);
  for (const row of (allScansForLast || []) as { center_id: string; scanned_at: string }[]) {
    if (!lastScanByCenter[row.center_id]) lastScanByCenter[row.center_id] = row.scanned_at;
  }
  const { data: monthScans } = await adminClient
    .from('attendance_scans')
    .select('center_id')
    .in('center_id', centerIds)
    .gte('scanned_at', monthStart.toISOString());
  const usageScansByCenter: Record<string, number> = {};
  for (const row of (monthScans || []) as { center_id: string }[]) {
    usageScansByCenter[row.center_id] = (usageScansByCenter[row.center_id] ?? 0) + 1;
  }

  const { data: owners } = await adminClient
    .from('users')
    .select('id, center_id, phone')
    .eq('role', 'owner')
    .in('center_id', centerIds);
  const ownerRowByCenter = new Map<string, { id: string; phone: string | null }>();
  for (const row of (owners || []) as { id: string; center_id: string | null; phone: string | null }[]) {
    if (row.center_id && !ownerRowByCenter.has(row.center_id)) {
      ownerRowByCenter.set(row.center_id, { id: row.id, phone: row.phone ?? null });
    }
  }
  // N+1 fix per docs/AUDIT_n_plus_1_hotpath_may13.md
  // Drop per-owner auth.admin.getUserById calls (N round-trips to auth API per page).
  // users.phone already holds the contact phone - no auth API lookup needed.
  const centerById = new Map(centers.map((c) => [String((c as { id: string }).id), c as Record<string, unknown>]));
  const ownerMap = new Map<string, { name: string; phone: string | null }>();
  for (const [cid, row] of ownerRowByCenter) {
    const phone = (row.phone && row.phone.trim()) ? row.phone : null;
    const cr = centerById.get(cid) as { owner_name?: string | null } | undefined;
    const dispName =
      (cr?.owner_name && String(cr.owner_name).trim()) ||
      (row.phone && String(row.phone).trim()) ||
      '';
    ownerMap.set(cid, { name: dispName, phone });
  }

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

  const referredByIds = [...new Set(centers.map((c) => c.referred_by as string | undefined).filter(Boolean))];
  const { data: referringCenters } =
    referredByIds.length > 0
      ? await adminClient.from('centers').select('id, name, referral_code').in('id', referredByIds)
      : { data: [] };
  const referringMap = new Map(
    (referringCenters || []).map((r: { id: string; name: string; referral_code: string }) => [
      r.id,
      { name: r.name, referral_code: r.referral_code },
    ]),
  );

  const PLAN_LIMITS: Record<string, number> = {
    nano: 100,
    starter: 250,
    pro: 500,
    business: 1000,
    enterprise: 2000,
    top_centers: 999999,
    payg: 999999,
  };

  return centers.map((c) => {
    const referredBy = (c as { referred_by?: string }).referred_by;
    const referring = referredBy ? referringMap.get(referredBy) : null;
    const plan = (c as { plan?: string }).plan || 'starter';
    const maxStudents = PLAN_LIMITS[plan] ?? 250;
    const weeklyUnique = weeklyUniqueByCenter[c.id as string]?.size ?? 0;
    const limitStatus =
      maxStudents < 999999
        ? weeklyUnique >= maxStudents
          ? 'over'
          : weeklyUnique >= maxStudents * 0.9
            ? 'approaching'
            : 'ok'
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
      next_due: (c as { next_payment_due?: string }).next_payment_due,
      referring_center_name: referring?.name ?? null,
      referral_code_used: referring?.referral_code ?? null,
      last_active: lastActive,
      usage_scans: usageScansByCenter[c.id as string] ?? 0,
    };
  });
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

    const flags = await fetchAdminAccessFlags(adminClient, userId);
    const effRole = flags.isSuperAdmin ? 'super_admin' : (adminUser?.role ?? 'internal_viewer');
    const customKeys = customPermissionsToKeys(adminUser?.custom_permissions);
    const perms = getAdminPermissions(effRole, customKeys);
    if (!flags.isSuperAdmin && !flags.canApproveSignups && !perms.includes('centers')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50));
    const searchRaw = searchParams.get('search')?.trim() ?? '';
    const searchSanitized = searchRaw.replace(/[%_\\,]/g, ' ').replace(/\s+/g, ' ').trim();
    const statusParam = searchParams.get('status') ?? '';
    const planParam = searchParams.get('plan') ?? '';
    const billingFilter = searchParams.get('billing_status') ?? '';
    const cityFilter = searchParams.get('city') ?? '';
    const govFilter = searchParams.get('governorate') ?? '';
    const sortParam = searchParams.get('sort') ?? 'newest';
    const offset = (page - 1) * limit;
    const isAtRisk = statusParam === 'at_risk';
    const sortOldest = sortParam === 'oldest';

    const includeTestCenters = parseIncludeTestCenters(request);

    const buildFilteredQuery = (withCount: boolean) => {
      let q = withCount
        ? adminClient.from('centers').select('*', { count: 'exact' }).neq('status', 'deleted')
        : adminClient.from('centers').select('*').neq('status', 'deleted');
      // Canonical admin aggregate semantic (CLAUDE.md): exclude is_test rows unless
      // include_test=1 explicitly requested. Keeps Total Centers / Active Centers KPIs
      // aligned with /api/admin/overview, /api/admin/billing, /api/admin/health.
      if (!includeTestCenters) {
        q = q.eq('is_test', false);
      }
      q = q.order('created_at', { ascending: sortOldest });

      if (!isAtRisk && statusParam && statusParam !== 'all') {
        q = q.eq('status', statusParam);
      }
      if (planParam && planParam !== 'all') {
        q = q.eq('plan', planParam);
      }
      if (billingFilter) {
        q = q.eq('billing_status', billingFilter);
      }
      if (cityFilter) {
        q = q.eq('city', cityFilter);
      }
      if (govFilter) {
        q = q.eq('governorate', govFilter);
      }
      if (searchSanitized) {
        const term = `%${searchSanitized}%`;
        q = q.or(
          `name.ilike.${term},phone.ilike.${term},owner_name.ilike.${term},center_code.ilike.${term}`,
        );
      }
      return q;
    };

    let rows: Record<string, unknown>[] = [];
    let totalCount = 0;

    if (isAtRisk) {
      const query = buildFilteredQuery(false).limit(2500);
      const { data: centersData, error } = await query;
      if (error) {
        console.error('[admin/centers] ❌ Query error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const enriched = await enrichCentersList(adminClient, (centersData || []) as Record<string, unknown>[]);
      const atRiskRows = enriched.filter((c) => isCenterRowAtRisk(c.last_active));
      totalCount = atRiskRows.length;
      rows = atRiskRows.slice(offset, offset + limit);
    } else {
      const query = buildFilteredQuery(true).range(offset, offset + limit - 1);
      const { data: centersData, error, count } = await query;
      if (error) {
        console.error('[admin/centers] ❌ Query error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      totalCount = count ?? 0;
      rows = await enrichCentersList(adminClient, (centersData || []) as Record<string, unknown>[]);
    }

    const { data: pendingRaw } = await adminClient
      .from('centers')
      .select('*')
      .eq('status', 'pending')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
      .limit(500);
    const pendingCenters = await enrichCentersList(adminClient, (pendingRaw || []) as Record<string, unknown>[]);

    const pagination = {
      page,
      limit,
      total: totalCount,
      total_pages: Math.ceil(totalCount / limit),
      has_next: offset + limit < totalCount,
      has_prev: page > 1,
    };

    return NextResponse.json({ centers: rows, pendingCenters, pagination });
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

async function safeDelete(
  adminSupabase: SupabaseClient,
  table: string,
  column: string,
  value: string,
  label?: string
): Promise<void> {
  try {
    const { error } = await adminSupabase.from(table).delete().eq(column, value);
    if (error) console.warn(`[admin/centers DELETE] ${label ?? table} failed:`, error.message);
  } catch (e) {
    console.warn(`[admin/centers DELETE] ${label ?? table} error:`, e);
  }
}

export async function DELETE(request: NextRequest) {
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

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const adminByTable = await isAdminUser(adminSupabase, user.id);
    const { data: userRecord } = await adminSupabase.from('users').select('phone').eq('id', user.id).single();
    const adminByPhone = isSuperAdmin(userRecord?.phone ?? null);

    if (!adminByTable && !adminByPhone) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const centerId = searchParams.get('id');
    if (!centerId) {
      return NextResponse.json({ error: 'Missing center id' }, { status: 400 });
    }

    const { data: center, error: fetchError } = await adminSupabase
      .from('centers')
      .select('id, name, phone')
      .eq('id', centerId)
      .single();

    if (fetchError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const { data: centerUsers } = await adminSupabase
      .from('users')
      .select('id')
      .eq('center_id', centerId);
    const userIds = centerUsers?.map((u: { id: string }) => u.id) ?? [];

    await safeDelete(adminSupabase, 'attendance_scans', 'center_id', centerId);
    await safeDelete(adminSupabase, 'wa_message_queue', 'center_id', centerId);
    await safeDelete(adminSupabase, 'wa_conversations', 'center_id', centerId);
    await safeDelete(adminSupabase, 'wa_inactivity_alerts', 'center_id', centerId);
    await safeDelete(adminSupabase, 'student_notes', 'center_id', centerId);

    const { data: studentRows } = await adminSupabase.from('students').select('id').eq('center_id', centerId);
    const studentIds = studentRows?.map((s: { id: string }) => s.id) ?? [];
    if (studentIds.length > 0) {
      // N+1 fix per docs/AUDIT_n_plus_1_hotpath_may13.md
      try {
        const { error: tokErr } = await adminSupabase
          .from('parent_portal_tokens')
          .delete()
          .in('student_id', studentIds);
        if (tokErr) {
          console.warn('[admin/centers DELETE] parent_portal_tokens failed:', tokErr.message);
        }
      } catch {
        /* continue */
      }
    }

    await safeDelete(adminSupabase, 'schedule_slots', 'center_id', centerId);
    await safeDelete(adminSupabase, 'students', 'center_id', centerId);
    await safeDelete(adminSupabase, 'student_groups', 'center_id', centerId);
    await safeDelete(adminSupabase, 'rooms', 'center_id', centerId);
    await safeDelete(adminSupabase, 'referrals', 'referrer_center_id', centerId);
    await safeDelete(adminSupabase, 'referrals', 'referred_center_id', centerId);
    await safeDelete(adminSupabase, 'referral_rewards', 'referrer_center_id', centerId);
    await safeDelete(adminSupabase, 'referral_rewards', 'referred_center_id', centerId);
    await safeDelete(adminSupabase, 'academic_periods', 'center_id', centerId);
    await safeDelete(adminSupabase, 'academic_years', 'center_id', centerId);
    await safeDelete(adminSupabase, 'holidays', 'center_id', centerId);
    await safeDelete(adminSupabase, 'admin_alerts', 'center_id', centerId);
    await safeDelete(adminSupabase, 'center_invites', 'center_id', centerId);

    try {
      await adminSupabase.from('referral_codes').delete().eq('center_id', centerId);
    } catch {
      /* continue */
    }
    try {
      await adminSupabase.from('admin_payments').delete().eq('center_id', centerId);
    } catch {
      /* continue */
    }
    try {
      await adminSupabase.from('payments').delete().eq('center_id', centerId);
    } catch {
      /* continue */
    }
    try {
      await adminSupabase.from('invoices').delete().eq('center_id', centerId);
    } catch {
      /* continue */
    }

    await adminSupabase.from('users').delete().eq('center_id', centerId);

    const { error: centerDeleteError } = await adminSupabase
      .from('centers')
      .delete()
      .eq('id', centerId);

    if (centerDeleteError) {
      return NextResponse.json({ error: centerDeleteError.message }, { status: 500 });
    }

    for (const uid of userIds) {
      try {
        await adminSupabase.auth.admin.deleteUser(uid);
      } catch {
        /* continue */
      }
    }

    if (center.phone) {
      try {
        const phoneDigits = (center.phone as string).replace(/\D/g, '');
        const authEmail = `${phoneDigits}@centerhq.local`;
        const { data: { users: authUsers } } = await adminSupabase.auth.admin.listUsers({ perPage: 100 });
        const authUser = authUsers?.find((u) => u.email === authEmail);
        if (authUser) {
          await adminSupabase.auth.admin.deleteUser(authUser.id);
        }
      } catch {
        /* continue */
      }
    }

    await logAdminAction(user.id, 'delete_center', {
      centerId,
      centerName: center.name,
      center_phone: center.phone,
      users_deleted: userIds.length,
    }, centerId);

    return NextResponse.json({ success: true });
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
    if (!validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
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
        terms_version: 'v1-2026-05',
        terms_accepted_at: new Date().toISOString(),
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

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
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
      if (!newPlan || !['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers', 'payg'].includes(newPlan as string)) {
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

    // Approve - create auth user and owner profile
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const normalizedPhone = normalizePhone(center.phone as string);
    const phoneDigits = normalizedPhone.replace(/\D/g, '');
    const authEmail = `${phoneDigits}@centerhq.local`;

    const { data: authData, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password: pin,
      email_confirm: true,
    });

    if (createAuthError) {
      const msg = createAuthError.message || '';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('user already registered')) {
        return NextResponse.json(
          { error: 'This phone number is already registered. The center owner may have an existing account.' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to create auth user: ' + msg },
        { status: 500 }
      );
    }
    if (!authData?.user?.id) {
      return NextResponse.json({ error: 'Failed to create auth user' }, { status: 500 });
    }

    const { error: userError } = await supabaseAdmin.from('users').insert({
      id: authData.user.id,
      center_id: centerId,
      role: 'owner',
      phone: normalizedPhone,
      name: (center.owner_name as string) ?? null,
      // Real PIN was set on the auth user via createUser above.
      pin_set_at: new Date().toISOString(),
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

    if (userError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: 'Failed to create user profile: ' + userError.message },
        { status: 500 }
      );
    }

    const now = new Date();
    const approveDay = todayISO();
    const nextPaymentDue = calendarAddDays(approveDay, 30);
    const autoSuspendDay = calendarAddDays(nextPaymentDue, 6);

    // Early Adopter: first 10 approved centers get 40% discount locked in (quarterly all-in base)
    const plan = (center.plan as string) || 'starter';
    const planKey = (plan in PLANS ? plan : 'starter') as PlanKey;
    const listAllInPerMonth = PLANS[planKey]?.quarterlyAllIn ?? PLANS.starter.quarterlyAllIn;
    const earlyAdopterEligiblePlans = new Set(['solo', 'nano', 'starter', 'pro', 'business', 'enterprise']);
    const { count: earlyAdopterCount } = await supabaseAdmin
      .from('centers')
      .select('*', { count: 'exact', head: true })
      .eq('is_early_adopter', true);
    const canBeEarlyAdopter = (earlyAdopterCount ?? 0) < 10 && earlyAdopterEligiblePlans.has(plan);
    const earlyAdopterNumber = canBeEarlyAdopter ? (earlyAdopterCount ?? 0) + 1 : null;
    const effectiveAllInPerMonth = canBeEarlyAdopter ? Math.round(listAllInPerMonth * 0.6) : listAllInPerMonth;
    const quarterlyInvoiceAmount = Math.round(effectiveAllInPerMonth * 3);

    const centerUpdates: Record<string, unknown> = {
      status: 'active',
      approved_at: now.toISOString(),
      approved_by: user.id,
      subscription_status: 'active',
      next_payment_due: nextPaymentDue,
      subscription_start_date: nextPaymentDue,
      auto_suspend_at: `${autoSuspendDay}T12:00:00.000Z`,
      billing_status: 'active',
      subscription_billing_period: 'quarterly',
      billing_amount: quarterlyInvoiceAmount,
      all_in_price: effectiveAllInPerMonth,
    };
    if (canBeEarlyAdopter) {
      centerUpdates.is_early_adopter = true;
      centerUpdates.early_adopter_price = quarterlyInvoiceAmount;
      centerUpdates.early_adopter_number = earlyAdopterNumber;
      centerUpdates.early_adopter_date = now.toISOString();
    }

    await supabaseAdmin
      .from('centers')
      .update(centerUpdates)
      .eq('id', centerId);

    try {
      await sendWelcomeTemplate(supabaseAdmin, {
        id: centerId,
        name: (center.name as string) ?? '',
        phone: (center.phone as string | null) ?? (phone as string | null) ?? null,
      });
    } catch (waErr) {
      console.error('[admin/centers] WA send error:', waErr);
    }

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

    // Referral rewards are now created only when admin approves the referred center's first payment (in admin billing)

    if (center.email) {
      // Email notifications not implemented - WhatsApp only
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://centerhq.app';
    const credentialsMessage = `تم تفعيل حسابك في TutoringHQ! 🎉

🔐 بيانات الدخول:
📱 رقم الهاتف: ${phone}
🔑 رمز PIN: ${pin}

🌐 رابط الدخول:
${appUrl}/login

مرحباً بك في TutoringHQ! 💙`;

    return NextResponse.json({
      success: true,
      action: 'approved',
      pin,
      phone: center.phone,
      center_name: center.name,
      credentials: { phone, pin },
      credentialsMessage,
      whatsappUrl: `https://wa.me/${phoneDigits}?text=${encodeURIComponent(credentialsMessage)}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
