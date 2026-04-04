import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

async function getAdminUser(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseAdmin) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          /* read-only cookie context */
        }
      },
    },
  });

  let userId: string | null = null;
  const {
    data: { user: cookieUser },
  } = await supabase.auth.getUser();
  if (cookieUser) userId = cookieUser.id;
  else {
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const {
        data: { user: bearerUser },
        error,
      } = await supabase.auth.getUser(token);
      if (bearerUser && !error) userId = bearerUser.id;
    }
  }

  if (!userId) return null;
  const { data: adminUser } = await supabaseAdmin.from('admin_users').select('id,role').eq('id', userId).single();
  if (adminUser) return adminUser;
  const { data: userRecord } = await supabaseAdmin.from('users').select('phone').eq('id', userId).single();
  const phones = (process.env.SUPER_ADMIN_PHONES || '')
    .split(',')
    .map((p: string) => p.trim())
    .filter(Boolean);
  if (userRecord?.phone && phones.includes(String(userRecord.phone))) {
    return { id: userId, role: 'super_admin' as const };
  }
  return null;
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'admin.export.configError' }, { status: 500 });
  }

  const admin = await getAdminUser(request);
  if (!admin) {
    return NextResponse.json({ errorKey: 'admin.export.unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') ?? '';
  const planFilter = searchParams.get('plan') ?? '';

  let query = supabaseAdmin
    .from('centers')
    .select(
      `
      center_code, name, owner_name, phone, email, city, governorate,
      plan, billing_period, billing_status, subscription_status,
      all_in_price, billing_amount, next_payment_due, auto_suspend_at,
      is_early_adopter, early_adopter_price, parent_pack_enabled,
      parent_pack_active_parents, health_score, health_score_band,
      onboarding_completed, is_blacklisted, created_at, approved_at
    `,
    )
    .neq('status', 'deleted')
    .order('center_code');

  if (statusFilter) query = query.eq('status', statusFilter);
  if (planFilter) query = query.eq('plan', planFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const csv = toCSV((data ?? []) as Record<string, unknown>[]);
  const date = new Date().toISOString().split('T')[0];

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="centers-${date}.csv"`,
    },
  });
}
